import { createHash } from 'crypto';

const SESSION_ID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

export function redactSessionId(id: string): string {
  if (!id) return 'sess_unknown';
  return `sess_${createHash('sha256').update(id).digest('hex').slice(0, 8)}`;
}

export function redactUrl(url: string | undefined): string {
  if (!url) return '';
  return url.replace(SESSION_ID_RE, (m) => redactSessionId(m));
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
]);

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.toLowerCase());
}

export function redactHeaderValue(value: string): string {
  if (!value) return '';
  if (value.length <= 12) return '[REDACTED]';
  return `${value.slice(0, 4)}…[REDACTED ${value.length} chars]`;
}
