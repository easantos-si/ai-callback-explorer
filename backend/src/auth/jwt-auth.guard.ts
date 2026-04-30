import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    // Auth disabled at deploy time → guard is a no-op. Frontend never even
    // shows the login screen in this case.
    if (!this.auth.enabled) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new UnauthorizedException('Missing bearer token');

    const payload = this.auth.verifyToken(match[1]);
    (req as Request & { user?: unknown }).user = payload;
    return true;
  }
}
