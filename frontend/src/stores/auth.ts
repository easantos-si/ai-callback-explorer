import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export type AuthPhase = 'loading' | 'disabled' | 'captcha' | 'totp' | 'ok';

interface AuthConfig {
  enabled: boolean;
  tokenTtlSec: number;
  originFilteringEnabled: boolean;
  sessionTtlHours: number;
  urlBase: string;
}

interface CaptchaChallenge {
  id: string;
  svg: string;
  expiresAt: number;
}

interface SolveError {
  failuresLeft?: number;
  retryAfter?: number;
  generic?: boolean;
}

export const useAuthStore = defineStore('auth', () => {
  const phase = ref<AuthPhase>('loading');
  const tokenTtlSec = ref(900);
  // Mirrors ORIGIN_FILTERING_ENABLED on the server. Controls whether the
  // Super Mode 12-press gate does anything and whether the SettingsMenu
  // renders the Super section at all.
  const originFilteringEnabled = ref(false);
  // Mirrors SESSION_TTL_HOURS. We don't enforce it client-side — the
  // server cleans up — but we use it to grey out sessions that have
  // probably already expired.
  const sessionTtlHours = ref(24);
  // Mirrors URL_BASE on the server. The SPA derives every callback URL
  // and share link from this — never trusting a stored value.
  const urlBase = ref('');

  // In-memory only. We also mirror to sessionStorage so a page reload in
  // the same tab keeps the user signed in, but closing the tab drops it.
  const token = ref<string>('');
  const expiresAt = ref(0);

  const captcha = ref<CaptchaChallenge | null>(null);
  const captchaToken = ref<string>('');
  const lastError = ref<SolveError | null>(null);
  const lockedUntil = ref(0);
  // Bumped once a second by a tick timer while the user is locked out,
  // so any computed() that wants to derive a "still locked?" boolean from
  // Date.now() picks up the change without manual refreshes.
  const clockTick = ref(0);

  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let lockoutTimer: ReturnType<typeof setInterval> | null = null;

  function startLockoutTicker(): void {
    if (lockoutTimer) return;
    lockoutTimer = setInterval(() => {
      clockTick.value++;
      if (Date.now() >= lockedUntil.value && lockoutTimer) {
        clearInterval(lockoutTimer);
        lockoutTimer = null;
      }
    }, 1000);
  }

  const isAuthenticated = computed(
    () => phase.value === 'disabled' || phase.value === 'ok',
  );
  const requiresLogin = computed(
    () => phase.value === 'captcha' || phase.value === 'totp',
  );

  // Pull a token left over by a previous tab-local reload.
  function restoreFromSession(): boolean {
    try {
      const raw = sessionStorage.getItem('auth.token');
      const exp = parseInt(sessionStorage.getItem('auth.expiresAt') || '0', 10);
      if (raw && exp > Date.now()) {
        token.value = raw;
        expiresAt.value = exp;
        return true;
      }
    } catch {
      // sessionStorage may be unavailable in some contexts
    }
    return false;
  }

  function persistToken(): void {
    try {
      sessionStorage.setItem('auth.token', token.value);
      sessionStorage.setItem('auth.expiresAt', String(expiresAt.value));
    } catch {
      // Ignore
    }
  }

  function clearPersistedToken(): void {
    try {
      sessionStorage.removeItem('auth.token');
      sessionStorage.removeItem('auth.expiresAt');
    } catch {
      // Ignore
    }
  }

  async function loadConfig(): Promise<void> {
    phase.value = 'loading';
    try {
      const res = await fetch(`${API_BASE}/api/auth/config`);
      if (!res.ok) throw new Error('Failed to load auth config');
      const cfg = (await res.json()) as AuthConfig;
      tokenTtlSec.value = cfg.tokenTtlSec;
      originFilteringEnabled.value = !!cfg.originFilteringEnabled;
      if (cfg.sessionTtlHours && cfg.sessionTtlHours > 0) {
        sessionTtlHours.value = cfg.sessionTtlHours;
      }
      urlBase.value = (cfg.urlBase ?? '').replace(/\/+$/, '');

      if (!cfg.enabled) {
        phase.value = 'disabled';
        return;
      }

      // Auth is on. Try to restore a token from sessionStorage; if it
      // verifies, jump straight to 'ok'.
      if (restoreFromSession()) {
        phase.value = 'ok';
        scheduleRefresh();
        return;
      }
      phase.value = 'captcha';
      await fetchCaptcha();
    } catch (e) {
      // If the config endpoint is unreachable, fall back to "disabled" so
      // local dev / proxy misconfig doesn't lock the operator out.
      console.warn('[auth] config fetch failed:', e);
      phase.value = 'disabled';
    }
  }

  async function fetchCaptcha(): Promise<void> {
    lastError.value = null;
    try {
      const res = await fetch(`${API_BASE}/api/auth/captcha`);
      if (res.status === 429) {
        const body = (await res.json()) as { retryAfter?: number };
        lockedUntil.value = Date.now() + (body.retryAfter ?? 60) * 1000;
        lastError.value = { retryAfter: body.retryAfter };
        startLockoutTicker();
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch captcha');
      captcha.value = (await res.json()) as CaptchaChallenge;
    } catch (e) {
      console.warn('[auth] captcha fetch failed:', e);
      lastError.value = { generic: true };
    }
  }

  async function submitCaptcha(answer: string): Promise<boolean> {
    if (!captcha.value) return false;
    lastError.value = null;
    try {
      const res = await fetch(`${API_BASE}/api/auth/captcha/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: captcha.value.id, answer }),
      });

      if (res.status === 429) {
        const body = (await res.json()) as { retryAfter?: number };
        lockedUntil.value = Date.now() + (body.retryAfter ?? 60) * 1000;
        lastError.value = { retryAfter: body.retryAfter };
        startLockoutTicker();
        captcha.value = null;
        return false;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          failuresLeft?: number;
        };
        lastError.value = { failuresLeft: body.failuresLeft };
        // Challenge is single-use — get a fresh one for the retry.
        await fetchCaptcha();
        return false;
      }

      const body = (await res.json()) as { token: string; expiresAt: number };
      captchaToken.value = body.token;
      phase.value = 'totp';
      return true;
    } catch (e) {
      console.warn('[auth] captcha submit failed:', e);
      lastError.value = { generic: true };
      return false;
    }
  }

  async function submitTotp(code: string): Promise<boolean> {
    lastError.value = null;
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captchaToken: captchaToken.value, totp: code }),
      });

      if (res.status === 429) {
        const body = (await res.json()) as { retryAfter?: number };
        lockedUntil.value = Date.now() + (body.retryAfter ?? 60) * 1000;
        lastError.value = { retryAfter: body.retryAfter };
        startLockoutTicker();
        // Reset to captcha so the user must solve a fresh challenge after
        // the lockout expires.
        captchaToken.value = '';
        phase.value = 'captcha';
        await fetchCaptcha();
        return false;
      }
      if (res.status === 401) {
        const body = (await res.json().catch(() => ({}))) as {
          failuresLeft?: number;
          message?: string;
        };
        lastError.value = { failuresLeft: body.failuresLeft };
        // Captcha token is consumed on the first call — back to captcha
        // step so the user re-validates anti-bot before the next attempt.
        captchaToken.value = '';
        phase.value = 'captcha';
        await fetchCaptcha();
        return false;
      }
      if (!res.ok) {
        lastError.value = { generic: true };
        return false;
      }

      const body = (await res.json()) as { token: string; expiresAt: number };
      token.value = body.token;
      expiresAt.value = body.expiresAt;
      persistToken();
      captchaToken.value = '';
      captcha.value = null;
      phase.value = 'ok';
      scheduleRefresh();
      return true;
    } catch (e) {
      console.warn('[auth] login failed:', e);
      lastError.value = { generic: true };
      return false;
    }
  }

  async function refresh(): Promise<boolean> {
    if (!token.value) return false;
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.value}` },
      });
      if (!res.ok) {
        logout();
        return false;
      }
      const body = (await res.json()) as { token: string; expiresAt: number };
      token.value = body.token;
      expiresAt.value = body.expiresAt;
      persistToken();
      return true;
    } catch (e) {
      console.warn('[auth] refresh failed:', e);
      return false;
    }
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    // Renew well before expiry — every TTL/3, capped to a sane minimum.
    const ms = Math.max(60_000, Math.floor((tokenTtlSec.value * 1000) / 3));
    refreshTimer = setInterval(() => {
      refresh();
    }, ms);
  }

  function logout(): void {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    token.value = '';
    expiresAt.value = 0;
    captchaToken.value = '';
    captcha.value = null;
    lastError.value = null;
    clearPersistedToken();
    if (phase.value !== 'disabled') {
      phase.value = 'captcha';
      fetchCaptcha();
    }
  }

  /**
   * Decorates a fetch RequestInit with the Bearer header when auth is on.
   * Other API clients (sessions store, super mode) should call this so a
   * single source of truth controls the header.
   */
  function authHeaders(extra?: HeadersInit): HeadersInit {
    if (phase.value !== 'ok' || !token.value) return extra ?? {};
    const headers = new Headers(extra);
    headers.set('Authorization', `Bearer ${token.value}`);
    return headers;
  }

  return {
    phase,
    token,
    expiresAt,
    captcha,
    lastError,
    lockedUntil,
    clockTick,
    originFilteringEnabled,
    sessionTtlHours,
    urlBase,
    isAuthenticated,
    requiresLogin,
    loadConfig,
    fetchCaptcha,
    submitCaptcha,
    submitTotp,
    refresh,
    logout,
    authHeaders,
  };
});
