import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

export interface CallbackEntry {
  id: string;
  sessionId: string;
  receivedAt: string;
  method: string;
  contentType: string;
  headers: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  ip: string;
  userAgent: string;
  path: string;
}

const ALLOWED_HEADERS = new Set([
  'content-type',
  'content-length',
  'user-agent',
  'accept',
  'x-request-id',
  'x-forwarded-for',
  'x-real-ip',
  'origin',
  'referer',
  'authorization',
]);

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

@Injectable()
export class CallbackService {
  private readonly logger = new Logger(CallbackService.name);

  buildCallbackEntry(
    sessionId: string,
    method: string,
    path: string,
    headers: Record<string, string | string[] | undefined>,
    query: Record<string, unknown>,
    body: unknown,
    ip: string,
  ): CallbackEntry {
    const sanitizedHeaders: Record<string, string> = {};

    for (const key of Object.keys(headers)) {
      if (ALLOWED_HEADERS.has(key.toLowerCase())) {
        const val = headers[key];
        if (val !== undefined) {
          sanitizedHeaders[key.toLowerCase()] = Array.isArray(val)
            ? val.join(', ')
            : String(val);
        }
      }
    }

    const entry: CallbackEntry = {
      id: uuidv4(),
      sessionId,
      receivedAt: new Date().toISOString(),
      method: method.toUpperCase(),
      contentType: sanitizedHeaders['content-type'] || 'unknown',
      headers: sanitizedHeaders,
      query: query && typeof query === 'object' ? query : {},
      body: this.sanitizeBody(body),
      ip: this.sanitizeIp(ip),
      userAgent: sanitizedHeaders['user-agent'] || 'unknown',
      path,
    };

    this.logger.log(
      `Callback entry created: ${entry.id} for session ${sessionId} [${method} ${path}]`,
    );

    return entry;
  }

  private sanitizeBody(body: unknown): unknown {
    if (body === null || body === undefined) {
      return null;
    }

    try {
      const str = JSON.stringify(body);
      if (str.length > MAX_BODY_SIZE) {
        return {
          _truncated: true,
          _originalSize: str.length,
          _message: 'Body too large, truncated to metadata only',
        };
      }
      return JSON.parse(str); // deep clone to prevent mutation
    } catch {
      return { _error: 'Could not serialize body' };
    }
  }

  private sanitizeIp(ip: string | undefined): string {
    if (!ip) return 'unknown';

    // Strip IPv6 prefix for IPv4-mapped addresses
    const cleaned = ip.replace(/^::ffff:/, '');

    const ipv4Regex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    const ipv6Regex = /^[0-9a-fA-F:]+$/;

    if (
      ipv4Regex.test(cleaned) ||
      ipv6Regex.test(cleaned) ||
      cleaned === '::1' ||
      cleaned === '127.0.0.1'
    ) {
      return cleaned;
    }

    return 'unknown';
  }
}
