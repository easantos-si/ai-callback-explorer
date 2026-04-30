import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  buildOtpAuthUri,
  generateBase32Secret,
  verifyTotp,
} from './totp';

export interface AuthConfig {
  enabled: boolean;
  // TTL of an access token, in seconds. Frontend refreshes periodically
  // before this expires.
  tokenTtlSec: number;
  // Canonical public URL of the SPA (no trailing slash). The frontend
  // builds callback URLs and share links from this so it never has to
  // trust a tampered IndexedDB row. Empty ⇒ frontend falls back to
  // window.location.origin.
  urlBase: string;
}

export interface QrRevealResult {
  otpauthUri: string;
  shareToken: string;
  shareUrl: string;
}

// Anatomy of a share token:
//   <16-byte salt hex> "." <32-byte HMAC-SHA256 hex>
// The HMAC key is the current MASTER_PASSWORD. Rotating the master
// password makes every previously issued share invalid because the
// recomputed HMAC stops matching.
const SHARE_TOKEN_REGEX = /^[0-9a-f]{32}\.[0-9a-f]{64}$/i;

const DEFAULT_TOKEN_TTL_SEC = 900;       // 15 minutes
const REFRESH_LEEWAY_SEC = 60;           // accept refresh up to this long before expiry-window logic

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  enabled = false;
  private totpSecret = '';
  private masterPassword = '';
  private issuer = 'AI Callback Explorer';
  private label = 'admin';
  private tokenTtlSec = DEFAULT_TOKEN_TTL_SEC;
  private urlBase = '';

  constructor(private readonly jwt: JwtService) {}

  onModuleInit(): void {
    // URL_BASE is read regardless of AUTH_ENABLED — the frontend uses it
    // to build callback URLs locally instead of trusting a stored value.
    this.urlBase = (process.env.URL_BASE ?? '').trim().replace(/\/+$/, '');

    this.enabled =
      (process.env.AUTH_ENABLED ?? '').toLowerCase() === 'true';

    if (!this.enabled) {
      this.logger.log('Auth disabled — UI is publicly accessible.');
      return;
    }

    this.totpSecret = (process.env.TOTP_SECRET ?? '').trim();
    this.masterPassword = (process.env.MASTER_PASSWORD ?? '').trim();
    this.issuer = (process.env.TOTP_ISSUER ?? this.issuer).trim();
    this.label = (process.env.TOTP_LABEL ?? this.label).trim();
    const ttl = parseInt(process.env.AUTH_TOKEN_TTL_SEC ?? '', 10);
    if (!isNaN(ttl) && ttl >= 60 && ttl <= 3600) this.tokenTtlSec = ttl;

    if (!process.env.JWT_SECRET) {
      // Refuse to start: a missing JWT secret falls back to a known
      // string in the JwtModule registration, which would let an attacker
      // forge tokens trivially. Better to crash loudly at boot.
      this.logger.error(
        'AUTH_ENABLED=true but JWT_SECRET is empty. Refusing to start. ' +
          'Generate one with: ' +
          'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      );
      throw new Error('JWT_SECRET required when AUTH_ENABLED=true');
    }
    if (!this.totpSecret) {
      this.logger.error(
        'AUTH_ENABLED=true but TOTP_SECRET is empty — every login attempt will fail. Generate a base32 secret and add it to .env.',
      );
    }
    if (!this.masterPassword) {
      this.logger.warn(
        'AUTH_ENABLED=true but MASTER_PASSWORD is empty — QR reveal will reject every attempt.',
      );
    }
  }

  config(): AuthConfig {
    return {
      enabled: this.enabled,
      tokenTtlSec: this.tokenTtlSec,
      urlBase: this.urlBase,
    };
  }

  verifyTotp(code: string): boolean {
    if (!this.totpSecret) return false;
    // ±1 step ≈ ±30 s, covers clock skew and the case where the user
    // typed the last digit just as the code rolled.
    return verifyTotp(this.totpSecret, code, {
      window: 1,
      step: 30,
      digits: 6,
    });
  }

  issueToken(): { token: string; expiresAt: number } {
    const expiresAt = Date.now() + this.tokenTtlSec * 1000;
    const token = this.jwt.sign(
      { sub: 'admin' },
      { expiresIn: this.tokenTtlSec },
    );
    return { token, expiresAt };
  }

  /**
   * Validates a JWT. Throws UnauthorizedException on any failure so callers
   * can re-throw directly from a guard.
   */
  verifyToken(token: string): { sub: string; iat: number; exp: number } {
    try {
      return this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Sliding-window refresh. We only require the current token to be
   * verifiable (signature + not expired by more than REFRESH_LEEWAY_SEC).
   */
  refresh(currentToken: string): { token: string; expiresAt: number } {
    let payload: { sub: string; iat: number; exp: number };
    try {
      payload = this.jwt.verify(currentToken, {
        // Allow tokens that just expired within the leeway so a request
        // that crossed the boundary still refreshes cleanly.
        clockTolerance: REFRESH_LEEWAY_SEC,
      });
    } catch {
      throw new UnauthorizedException('Cannot refresh: token invalid');
    }
    if (payload.sub !== 'admin') {
      throw new UnauthorizedException('Cannot refresh: bad subject');
    }
    return this.issueToken();
  }

  /**
   * Constant-time master-password check. Returns the otpauth:// URI plus
   * a freshly minted share token on success — the frontend renders the
   * QR locally and exposes the share link as a separate, opt-in reveal.
   */
  revealOtpAuthUri(masterPassword: string): QrRevealResult | null {
    if (!this.masterPassword || !this.totpSecret) return null;
    const provided = (masterPassword ?? '').trim();
    if (provided.length === 0) return null;

    const a = Buffer.from(provided);
    const b = Buffer.from(this.masterPassword);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;

    const otpauthUri = this.buildCurrentOtpAuthUri();
    const shareToken = this.buildShareToken();
    const shareUrl = this.buildShareUrl(shareToken);
    // buildCurrentOtpAuthUri returns null only when totpSecret is empty,
    // which we already short-circuited above.
    return { otpauthUri: otpauthUri!, shareToken, shareUrl };
  }

  /**
   * Returns the otpauth:// URI for a caller who has already proven
   * authority via a valid share token (see verifyShareToken). Used by
   * the share-link landing page so visitors don't see the master
   * password prompt.
   */
  getOtpAuthUri(): string | null {
    return this.buildCurrentOtpAuthUri();
  }

  /**
   * Verifies a share token in constant time. The token's HMAC is keyed
   * by the live MASTER_PASSWORD, so rotating the password instantly
   * invalidates every previously issued share — no server-side state
   * to track or revoke.
   */
  verifyShareToken(token: string): boolean {
    if (!this.enabled || !this.masterPassword) return false;
    if (typeof token !== 'string' || !SHARE_TOKEN_REGEX.test(token)) {
      return false;
    }
    const [saltHex, hashHex] = token.split('.');
    let salt: Buffer;
    let providedHash: Buffer;
    try {
      salt = Buffer.from(saltHex, 'hex');
      providedHash = Buffer.from(hashHex, 'hex');
    } catch {
      return false;
    }
    const expectedHash = createHmac('sha256', this.masterPassword)
      .update(salt)
      .digest();
    if (providedHash.length !== expectedHash.length) return false;
    return timingSafeEqual(providedHash, expectedHash);
  }

  // ---- internals ------------------------------------------------------

  /**
   * Single source of truth for the otpauth:// URI. Both the master-
   * password path and the share-link path go through this so the QR
   * is byte-for-byte identical no matter how the operator arrived at
   * it. The `image` parameter points authenticator apps at the
   * project's icon hosted by the SPA — apps that don't support it
   * just ignore the field.
   */
  private buildCurrentOtpAuthUri(): string | null {
    if (!this.totpSecret) return null;
    const image = this.urlBase ? `${this.urlBase}/icon.svg` : undefined;
    return buildOtpAuthUri(this.label, this.issuer, this.totpSecret, {
      image,
    });
  }

  private buildShareToken(): string {
    // 16-byte (128-bit) random salt makes every issued link unique
    // even when the master password is unchanged.
    const salt = randomBytes(16);
    const hash = createHmac('sha256', this.masterPassword)
      .update(salt)
      .digest();
    return `${salt.toString('hex')}.${hash.toString('hex')}`;
  }

  private buildShareUrl(token: string): string {
    if (this.urlBase) return `${this.urlBase}/?share=${token}`;
    // urlBase unset — return a path-only URL; the frontend will resolve
    // it against window.location.origin when displaying it.
    return `/?share=${token}`;
  }

  /**
   * Helper for setup: generates a fresh base32 secret on demand. Not used
   * in the auth flow — exposed so admins can call it from a one-off script
   * if they need a starting value for TOTP_SECRET.
   */
  static generateSecret(): string {
    // 160-bit / 20-byte RFC 4648 base32 — what every authenticator
    // app expects.
    return generateBase32Secret(20);
  }
}
