import {
  Controller,
  All,
  Req,
  Res,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CallbackService } from './callback.service';
import { CallbackGateway } from './callback.gateway';
import { SessionService } from '../session/session.service';

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
   * Health endpoint at root level (outside /api prefix).
   * Since globalPrefix is /api, we define this at /health
   * which becomes /api/health. Nginx proxies /health → /api/health.
   */
  @All('health')
  health(): Record<string, unknown> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  /**
   * Catch-all callback handler.
   * Matches: /api/callback/:sessionId and /api/callback/:sessionId/any/sub/path
   * Uses @All to accept any HTTP method (GET, POST, PUT, etc.)
   */
  @All('callback/:sessionId')
  handleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    this.processCallback(req, res);
  }

  @All('callback/:sessionId/*')
  handleCallbackWildcard(
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    this.processCallback(req, res);
  }

  private processCallback(req: Request, res: Response): void {
    // Extract sessionId from path: /api/callback/<sessionId>[/...]
    const pathParts = req.path.split('/');
    // Path is like /api/callback/<sessionId>/... or /callback/<sessionId>/...
    const callbackIndex = pathParts.indexOf('callback');
    const sessionId = callbackIndex >= 0 ? pathParts[callbackIndex + 1] : undefined;

    if (
      !sessionId ||
      !CallbackController.SESSION_ID_REGEX.test(sessionId)
    ) {
      this.logger.warn(`Callback with invalid session ID format: ${sessionId}`);
      res.status(HttpStatus.OK).json({
        received: true,
        warning: 'Invalid session ID format',
      });
      return;
    }

    if (!this.sessionService.validateSession(sessionId)) {
      this.logger.warn(`Callback for unknown/expired session: ${sessionId}`);
      // Still return 200 so the AI API doesn't retry
      res.status(HttpStatus.OK).json({
        received: true,
        warning: 'Session not found or expired',
      });
      return;
    }

    try {
      const ip =
        req.ip ||
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        'unknown';

      const entry = this.callbackService.buildCallbackEntry(
        sessionId,
        req.method,
        req.originalUrl,
        req.headers as Record<string, string | string[] | undefined>,
        req.query as Record<string, unknown>,
        req.body,
        ip,
      );

      // Emit via WebSocket to connected clients
      this.callbackGateway.emitToSession(sessionId, entry);

      // Touch session to keep it alive
      this.sessionService.touchSession(sessionId);

      res.status(HttpStatus.OK).json({
        received: true,
        id: entry.id,
        timestamp: entry.receivedAt,
      });
    } catch (error) {
      this.logger.error(
        `Error processing callback for session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      res.status(HttpStatus.OK).json({
        received: true,
        warning: 'Error processing callback data',
      });
    }
  }
}
