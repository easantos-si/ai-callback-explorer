import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  isSensitiveHeader,
  redactHeaderValue,
  redactSessionId,
} from '../common/util/redact';

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
  'cf-connecting-ip',
  'origin',
  'referer',
  'authorization',
  'x-api-key',
  'x-auth-token',
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
      const lower = key.toLowerCase();
      if (!ALLOWED_HEADERS.has(lower)) continue;
      const val = headers[key];
      if (val === undefined) continue;

      let str = Array.isArray(val) ? val.join(', ') : String(val);
      if (isSensitiveHeader(lower)) {
        str = redactHeaderValue(str);
      }
      sanitizedHeaders[lower] = str;
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
      `Callback entry created: ${entry.id} for ${redactSessionId(sessionId)} [${entry.method}]`,
    );

    return entry;
  }

  /**
   * Estimate the byte size of a serialized body. Used by the per-session quota
   * before the entry is actually persisted/broadcast.
   */
  estimateSize(body: unknown): number {
    if (body === null || body === undefined) return 0;
    try {
      if (Buffer.isBuffer(body)) return body.length;
      if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
      return Buffer.byteLength(JSON.stringify(body), 'utf8');
    } catch {
      return 0;
    }
  }

  private sanitizeBody(body: unknown): unknown {
    if (body === null || body === undefined) {
      return null;
    }

    if (Buffer.isBuffer(body)) {
      if (body.length > MAX_BODY_SIZE) {
        return {
          _truncated: true,
          _originalSize: body.length,
          _message: 'Binary body too large, truncated to metadata only',
        };
      }
      return {
        _binary: true,
        _size: body.length,
        _base64: body.toString('base64'),
      };
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
