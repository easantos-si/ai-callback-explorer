import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';
import { redactUrl } from '../util/redact';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const { method, url } = request;
    const safeUrl = redactUrl(url);
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const elapsed = Date.now() - start;
        this.logger.log(`${method} ${safeUrl} ${elapsed}ms`);
      }),
    );
  }
}
