import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Adds the headers Helmet 8 does not cover.
 *
 *   - Permissions-Policy: minimal allowlist (everything off).
 *
 * Everything else (HSTS, CSP, Referrer-Policy, X-Frame-Options,
 * X-Content-Type-Options, X-Powered-By removal, COOP/CORP) is configured
 * inside `helmet({...})` in `main.ts` and is the single source of truth.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader(
      'Permissions-Policy',
      [
        'accelerometer=()',
        'camera=()',
        'geolocation=()',
        'gyroscope=()',
        'magnetometer=()',
        'microphone=()',
        'payment=()',
        'usb=()',
      ].join(', '),
    );
    next();
  }
}
