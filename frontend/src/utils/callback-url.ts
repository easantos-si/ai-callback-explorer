import { useAuthStore } from '@/stores/auth';

/**
 * Builds the public callback URL for a session ID. Pulls the base from
 * the auth store (mirrors URL_BASE on the server). Falls back to
 * window.location.origin only when URL_BASE wasn't configured — fine
 * for local dev, but in production set URL_BASE so the SPA never has
 * to guess.
 *
 * Why a function and not a stored field on the Session record:
 *   IndexedDB is browser-side state. Anyone with DevTools can edit it,
 *   and a tampered callbackUrl row would silently redirect any URL
 *   the user copies out of the UI. Recomputing on demand from a
 *   server-supplied base eliminates that footgun.
 */
export function buildCallbackUrl(sessionId: string): string {
  const auth = useAuthStore();
  const base = auth.urlBase || window.location.origin;
  return `${base}/api/callback/${sessionId}`;
}
