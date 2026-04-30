// Self-contained RFC 6238 TOTP (HMAC-SHA1) + RFC 4648 base32 helpers.
// We rolled our own to avoid the otplib dependency tree (which kept
// deprecating sub-packages between majors). The public API mirrors the
// subset of otplib we previously consumed.

import { createHmac, randomBytes } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decodes an RFC 4648 base32 string (uppercase A–Z + 2–7, optional `=`
 * padding, whitespace tolerated) into raw bytes. Throws on any invalid
 * character so a malformed TOTP_SECRET fails loudly at first use.
 */
function base32Decode(secret: string): Buffer {
  const cleaned = secret
    .toUpperCase()
    .replace(/=+$/, '')
    .replace(/\s+/g, '');

  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error(`Invalid base32 character in TOTP secret: ${ch}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * Encodes raw bytes as RFC 4648 base32 (no padding). Used by
 * generateBase32Secret() for the one-shot TOTP_SECRET helper.
 */
function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

/**
 * Generates the TOTP code for a given counter — RFC 6238 step 5.
 * `digits` controls truncation length (default 6). Counter is encoded
 * as a 64-bit big-endian integer split into hi/lo halves to avoid the
 * BigInt vs Number precision dance for the next ~285 years.
 */
function generateAt(
  secret: string,
  counter: number,
  digits: number,
): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(truncated % 10 ** digits).padStart(digits, '0');
}

export interface TotpOptions {
  step?: number;     // seconds per counter increment (default 30)
  window?: number;   // ± steps to accept (default 1, ≈ ±30 s clock skew)
  digits?: number;   // code length (default 6)
}

/**
 * Constant-time-ish TOTP verification. We always iterate the full
 * window even after finding a match so a successful verify takes the
 * same wall-clock time as a failure for the same window size.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: TotpOptions = {},
): boolean {
  const step = options.step ?? 30;
  const window = options.window ?? 1;
  const digits = options.digits ?? 6;
  const trimmed = (code ?? '').replace(/\s+/g, '');
  if (!new RegExp(`^[0-9]{${digits}}$`).test(trimmed)) return false;

  const counter = Math.floor(Date.now() / 1000 / step);
  let matched = false;
  try {
    for (let delta = -window; delta <= window; delta++) {
      const candidate = generateAt(secret, counter + delta, digits);
      // Plain === is fine here — both sides are short strings of the
      // same length, and the secret never enters the comparison.
      if (candidate === trimmed) matched = true;
    }
  } catch {
    return false;
  }
  return matched;
}

/**
 * Builds the otpauth:// URI consumed by Google/Microsoft Authenticator
 * et al. Format follows the de-facto Google spec — issuer is repeated
 * both inside the path and as a query param so older readers still
 * pick it up.
 *
 * The optional `image` parameter is non-standard but widely supported
 * (Microsoft Authenticator, 1Password, Authy). Setting it points the
 * authenticator app at a public icon URL so the entry shows the
 * project's logo instead of a generic placeholder. Apps that don't
 * support it ignore the parameter.
 */
export function buildOtpAuthUri(
  label: string,
  issuer: string,
  secret: string,
  options: {
    algorithm?: 'SHA1' | 'SHA256' | 'SHA512';
    digits?: number;
    period?: number;
    image?: string;
  } = {},
): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: options.algorithm ?? 'SHA1',
    digits: String(options.digits ?? 6),
    period: String(options.period ?? 30),
  });
  if (options.image) params.set('image', options.image);
  const path = `${encodeURIComponent(issuer)}:${encodeURIComponent(label)}`;
  return `otpauth://totp/${path}?${params.toString()}`;
}

/**
 * Generates a 160-bit (20-byte) base32 secret. Matches what every
 * mainstream authenticator app expects.
 */
export function generateBase32Secret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}
