import { i18n, intlLocaleFor, type LocaleCode } from '@/i18n';

function currentIntl(): string {
  return intlLocaleFor(i18n.global.locale.value as LocaleCode);
}

function tr(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params || {}) as string;
}

export function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleString(currentIntl(), {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Long-form timestamp using the locale's date convention with a
 * 4-digit year, joined to a 24-hour HH:MM:SS clock by a colon.
 *
 *   pt-BR  → 21/04/2026:14:30:45
 *   en-US  → 04/21/2026:14:30:45
 *   de     → 21.04.2026:14:30:45
 *
 * The unusual `:` between date and time is intentional — it gives a
 * single-token timestamp that's easy to scan as a column in `ls -l`
 * output.
 */
export function formatDateTimeLong(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const intl = currentIntl();
    const datePart = date.toLocaleDateString(intl, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const timePart = date.toLocaleTimeString(intl, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    return `${datePart}:${timePart}`;
  } catch {
    return dateStr;
  }
}

export function formatDateShort(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    if (diffMs < 0) return formatDate(dateStr);

    const diffMin = Math.floor(diffMs / 60_000);
    const diffHr = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffMin < 1) return tr('time.now');
    if (diffMin < 60) return tr('time.minAgo', { n: diffMin });
    if (diffHr < 24) return tr('time.hAgo', { n: diffHr });
    if (diffDays < 7) return tr('time.dAgo', { n: diffDays });

    return date.toLocaleDateString(currentIntl(), {
      day: '2-digit',
      month: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

export function getMethodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: '#61affe',
    POST: '#49cc90',
    PUT: '#fca130',
    DELETE: '#f93e3e',
    PATCH: '#50e3c2',
    HEAD: '#9012fe',
    OPTIONS: '#0d5aa7',
  };
  return colors[(method || '').toUpperCase()] || '#999';
}

export function guessContentType(body: unknown): string {
  if (body === null || body === undefined) return 'empty';
  if (typeof body === 'string') return 'text';
  if (Array.isArray(body)) return 'array';
  if (typeof body === 'object') return 'json';
  return typeof body;
}
