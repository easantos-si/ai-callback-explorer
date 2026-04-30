import {
  Controller,
  All,
  Req,
  Res,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { CallbackService } from './callback.service';
import { CallbackGateway } from './callback.gateway';
import { SessionService } from '../session/session.service';
import { redactSessionId } from '../common/util/redact';
import { getClientIp } from '../common/util/client-ip';

// The callback endpoint is invoked by third-party services (potentially
// many users sharing the same egress IP, e.g. Cloudflare/Vercel). Per-IP
// throttling at the application layer would penalize legitimate bursts.
// Per-session caps in SessionService.recordCallback + Cloudflare WAF
// rules cover this surface instead.
@SkipThrottle()
@Controller()
export class CallbackController {
  private readonly logger = new Logger(CallbackController.name);

  private static readonly SESSION_ID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  constructor(
    private readonly callbackService: CallbackService,
    private readonly callbackGateway: CallbackGateway,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * Health endpoint at /api/health. Nginx/Cloudflare proxy /health → /api/health.
   */
  @All('health')
  health(): Record<string, unknown> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @All('callback/:sessionId')
  handleCallback(@Req() req: Request, @Res() res: Response): void {
    this.processCallback(req, res);
  }

  @All('callback/:sessionId/*')
  handleCallbackWildcard(@Req() req: Request, @Res() res: Response): void {
    this.processCallback(req, res);
  }

  /**
   * Unified callback handler. Always returns the same body so the response
   * cannot be used as an oracle for hash existence (ID-008). Real ingestion
   * runs after the response, on `setImmediate`.
   */
  private processCallback(req: Request, res: Response): void {
    const pathParts = req.path.split('/');
    const callbackIndex = pathParts.indexOf('callback');
    const sessionId =
      callbackIndex >= 0 ? pathParts[callbackIndex + 1] : undefined;

    const known =
      !!sessionId &&
      CallbackController.SESSION_ID_REGEX.test(sessionId) &&
      this.sessionService.validateSession(sessionId);

    // Constant response shape — no leak of existence.
    res.status(HttpStatus.OK).json({ received: true });

    if (!known || !sessionId) return;

    const ingest = (): void => {
      try {
        const ip = getClientIp(req);
        const size = this.callbackService.estimateSize(req.body);

        if (!this.sessionService.recordCallback(sessionId, size)) {
          this.logger.warn(
            `Quota exceeded — dropping callback for ${redactSessionId(sessionId)}`,
          );
          return;
        }

        const entry = this.callbackService.buildCallbackEntry(
          sessionId,
          req.method,
          req.originalUrl,
          req.headers as Record<string, string | string[] | undefined>,
          req.query as Record<string, unknown>,
          req.body,
          ip,
        );

        this.callbackGateway.emitToSession(sessionId, entry);
      } catch (error) {
        this.logger.error(
          `Error processing callback for ${redactSessionId(sessionId)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    setImmediate(ingest);
  }
}
