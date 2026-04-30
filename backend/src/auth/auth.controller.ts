import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  HttpException,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { CaptchaSolveDto } from './dto/captcha-solve.dto';
import { LoginDto } from './dto/login.dto';
import { QrRevealDto } from './dto/qr-reveal.dto';
import { QrShareDto } from './dto/qr-share.dto';
import { getClientIp } from '../common/util/client-ip';
import { isFilteringEnabled } from '../admin/allowed-origins.state';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly captcha: CaptchaService,
  ) {}

  /**
   * Public — the SPA hits this on bootstrap to know whether to render the
   * login screen, whether Super Mode is reachable, etc.
   */
  @Get('config')
  @SkipThrottle()
  config(): {
    enabled: boolean;
    tokenTtlSec: number;
    urlBase: string;
    originFilteringEnabled: boolean;
    webhookBindsEnabled: boolean;
    sessionTtlHours: number;
  } {
    return {
      ...this.auth.config(),
      originFilteringEnabled: isFilteringEnabled(),
      // Mirrors WEBHOOK_BINDS_ENABLED on the server. Gates the `bind`
      // family of terminal commands (add/list/rm). The forwarding
      // itself runs on the SPA — this flag controls visibility, not
      // delivery. Default off because outgoing fetches from the SPA
      // hit arbitrary URLs and that's not always desirable.
      webhookBindsEnabled:
        (process.env.WEBHOOK_BINDS_ENABLED ?? 'false').toLowerCase() ===
        'true',
      // Mirrors SESSION_TTL_HOURS so the SPA can tag sessions older
      // than this as visually expired. Server-side cleanup is still
      // authoritative; this is just for the operator's eyes.
      sessionTtlHours:
        parseInt(process.env.SESSION_TTL_HOURS || '24', 10) || 24,
    };
  }

  /**
   * Issues a fresh anti-bot challenge. Caller must solve it before /login
   * accepts a TOTP code. Throttled tightly to prevent enumeration of
   * challenge IDs.
   */
  @Get('captcha')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  challenge(@Req() req: Request): {
    id: string;
    svg: string;
    expiresAt: number;
  } {
    if (!this.auth.enabled) {
      throw new BadRequestException('Auth disabled');
    }
    const ip = getClientIp(req);
    const lock = this.captcha.isLockedOut(ip);
    if (lock.locked) {
      throw new HttpException(
        { message: 'Too many attempts', retryAfter: lock.retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.captcha.createChallenge();
  }

  @Post('captcha/solve')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  solve(
    @Req() req: Request,
    @Body() dto: CaptchaSolveDto,
  ): { token?: string; expiresAt?: number; failuresLeft?: number; retryAfter?: number } {
    if (!this.auth.enabled) {
      throw new BadRequestException('Auth disabled');
    }
    const ip = getClientIp(req);
    const result = this.captcha.solveChallenge(dto.id, dto.answer, ip);

    if (result.token) return result;
    if (result.retryAfter) {
      throw new HttpException(
        {
          message: 'Too many failed attempts',
          retryAfter: result.retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    throw new HttpException(
      { message: 'Wrong answer', failuresLeft: result.failuresLeft },
      HttpStatus.UNAUTHORIZED,
    );
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  login(
    @Req() req: Request,
    @Body() dto: LoginDto,
  ): { token: string; expiresAt: number } {
    if (!this.auth.enabled) {
      throw new BadRequestException('Auth disabled');
    }

    const ip = getClientIp(req);

    const lock = this.captcha.isLockedOut(ip);
    if (lock.locked) {
      throw new HttpException(
        { message: 'Too many attempts', retryAfter: lock.retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!this.captcha.consumeToken(dto.captchaToken)) {
      throw new UnauthorizedException('Captcha required');
    }

    if (!this.auth.verifyTotp(dto.totp)) {
      const fail = this.captcha.recordTotpFailure(ip);
      if (fail.retryAfter) {
        throw new HttpException(
          {
            message: 'Too many failed attempts',
            retryAfter: fail.retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new HttpException(
        { message: 'Invalid TOTP code', failuresLeft: fail.failuresLeft },
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.captcha.resetTotpFailures(ip);
    return this.auth.issueToken();
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  refresh(
    @Headers('authorization') authorization?: string,
  ): { token: string; expiresAt: number } {
    if (!this.auth.enabled) {
      throw new BadRequestException('Auth disabled');
    }
    const match = (authorization ?? '').match(/^Bearer\s+(.+)$/i);
    if (!match) throw new UnauthorizedException('Missing bearer token');
    return this.auth.refresh(match[1]);
  }

  /**
   * Master-password gated. Returns the otpauth:// URI plus a freshly
   * minted share token. The frontend hides the share section by default
   * and reveals it only on explicit click.
   */
  @Post('qr')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  qr(
    @Body() dto: QrRevealDto,
  ): { otpauthUri: string; shareToken: string; shareUrl: string } {
    if (!this.auth.enabled) {
      throw new BadRequestException('Auth disabled');
    }
    const result = this.auth.revealOtpAuthUri(dto.password);
    if (!result) throw new UnauthorizedException('Invalid master password');
    return result;
  }

  /**
   * Share-token gated. Returns the otpauth:// URI without a share token
   * — visitors who arrived via a share link cannot mint new shares.
   */
  @Post('qr/share')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  qrByShare(@Body() dto: QrShareDto): { otpauthUri: string } {
    if (!this.auth.enabled) {
      throw new BadRequestException('Auth disabled');
    }
    if (!this.auth.verifyShareToken(dto.token)) {
      throw new UnauthorizedException('Invalid or expired share link');
    }
    const uri = this.auth.getOtpAuthUri();
    if (!uri) {
      throw new UnauthorizedException('TOTP secret is not configured');
    }
    return { otpauthUri: uri };
  }
}
