import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

@Injectable()
export class AdminTokenGuard implements CanActivate {
  private readonly logger = new Logger(AdminTokenGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected) {
      this.logger.warn(
        'ADMIN_TOKEN not configured — rejecting admin requests.',
      );
      throw new UnauthorizedException();
    }

    const req = context.switchToHttp().getRequest<Request>();
    const provided =
      (req.header('x-admin-token') || '').toString();

    if (!provided) throw new UnauthorizedException();

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) throw new UnauthorizedException();
    if (!timingSafeEqual(a, b)) throw new UnauthorizedException();
    return true;
  }
}
