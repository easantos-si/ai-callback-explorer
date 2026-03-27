import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly store = new Map<string, RateLimitEntry>();
  private readonly ttl: number;
  private readonly max: number;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.ttl = parseInt(process.env.RATE_LIMIT_TTL || '60', 10) * 1000;
    this.max = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);

    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (now > entry.resetAt) {
          this.store.delete(key);
        }
      }
    }, 60_000);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const key =
      request.ip ||
      request.socket?.remoteAddress ||
      'unknown';

    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.ttl };
      this.store.set(key, entry);
    }

    entry.count++;

    if (entry.count > this.max) {
      this.logger.warn(`Rate limit exceeded for ${key}`);
      throw new HttpException(
        'Too many requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
