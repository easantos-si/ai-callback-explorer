import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';

interface PendingChallenge {
  answer: string;
  expiresAt: number;
}

interface CaptchaToken {
  expiresAt: number;
  consumed: boolean;
}

interface IpAttemptState {
  failures: number;
  lockedUntil: number;
  windowStart: number;
}

const CHALLENGE_TTL_MS = 2 * 60_000;      // 2 minutes to solve
const TOKEN_TTL_MS = 5 * 60_000;          // 5 minutes to use the token in /login
const MAX_FAILURES = 5;
const LOCKOUT_MS = 60_000;                // 1 minute lockout after MAX_FAILURES
const ATTEMPT_WINDOW_MS = 10 * 60_000;    // failures decay outside this window

// Visually distinct alphabet (no 0/O, 1/I/l, etc).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

export interface CaptchaChallenge {
  id: string;
  svg: string;
  expiresAt: number;
}

export interface CaptchaSolveResult {
  token?: string;
  expiresAt?: number;
  retryAfter?: number; // seconds — set when locked out
  failuresLeft?: number;
}

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);
  private readonly challenges = new Map<string, PendingChallenge>();
  private readonly tokens = new Map<string, CaptchaToken>();
  private readonly ipAttempts = new Map<string, IpAttemptState>();

  constructor() {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  createChallenge(): CaptchaChallenge {
    const answer = this.randomCode(CODE_LENGTH);
    const id = randomUUID();
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    this.challenges.set(id, { answer, expiresAt });
    return { id, svg: this.renderSvg(answer), expiresAt };
  }

  solveChallenge(
    id: string,
    answer: string,
    ip: string,
  ): CaptchaSolveResult {
    const state = this.getIpState(ip);
    const now = Date.now();

    if (state.lockedUntil > now) {
      return { retryAfter: Math.ceil((state.lockedUntil - now) / 1000) };
    }

    const challenge = this.challenges.get(id);
    if (!challenge || challenge.expiresAt < now) {
      this.challenges.delete(id);
      this.recordFailure(state);
      return { failuresLeft: this.failuresLeft(state) };
    }

    // Single-use challenge — consume regardless of outcome.
    this.challenges.delete(id);

    const provided = (answer ?? '').trim().toUpperCase();
    if (
      provided.length !== challenge.answer.length ||
      !timingSafeEqual(
        Buffer.from(provided),
        Buffer.from(challenge.answer),
      )
    ) {
      this.recordFailure(state);
      return { failuresLeft: this.failuresLeft(state) };
    }

    // Success — reset the IP counter so future legitimate attempts aren't
    // penalised by stale failures.
    state.failures = 0;
    state.lockedUntil = 0;

    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + TOKEN_TTL_MS;
    this.tokens.set(token, { expiresAt, consumed: false });
    return { token, expiresAt };
  }

  /**
   * Single-use validation. Token is consumed on first call regardless of
   * whether the caller (auth.service) ultimately succeeds — this prevents
   * a TOTP brute-force loop from reusing one captcha token.
   */
  consumeToken(token: string): boolean {
    if (!token) return false;
    const entry = this.tokens.get(token);
    if (!entry) return false;
    this.tokens.delete(token);
    if (entry.consumed) return false;
    if (entry.expiresAt < Date.now()) return false;
    return true;
  }

  recordTotpFailure(ip: string): { failuresLeft: number; retryAfter?: number } {
    const state = this.getIpState(ip);
    this.recordFailure(state);
    if (state.lockedUntil > Date.now()) {
      return {
        failuresLeft: 0,
        retryAfter: Math.ceil((state.lockedUntil - Date.now()) / 1000),
      };
    }
    return { failuresLeft: this.failuresLeft(state) };
  }

  resetTotpFailures(ip: string): void {
    const state = this.ipAttempts.get(ip);
    if (state) {
      state.failures = 0;
      state.lockedUntil = 0;
    }
  }

  isLockedOut(ip: string): { locked: boolean; retryAfter: number } {
    const state = this.ipAttempts.get(ip);
    if (!state) return { locked: false, retryAfter: 0 };
    const now = Date.now();
    if (state.lockedUntil > now) {
      return {
        locked: true,
        retryAfter: Math.ceil((state.lockedUntil - now) / 1000),
      };
    }
    return { locked: false, retryAfter: 0 };
  }

  // ---------- internals --------------------------------------------------

  private getIpState(ip: string): IpAttemptState {
    let state = this.ipAttempts.get(ip);
    const now = Date.now();
    if (!state) {
      state = { failures: 0, lockedUntil: 0, windowStart: now };
      this.ipAttempts.set(ip, state);
    } else if (now - state.windowStart > ATTEMPT_WINDOW_MS) {
      // Decay stale failures.
      state.failures = 0;
      state.lockedUntil = 0;
      state.windowStart = now;
    }
    return state;
  }

  private recordFailure(state: IpAttemptState): void {
    state.failures += 1;
    if (state.failures >= MAX_FAILURES) {
      state.lockedUntil = Date.now() + LOCKOUT_MS;
    }
  }

  private failuresLeft(state: IpAttemptState): number {
    return Math.max(0, MAX_FAILURES - state.failures);
  }

  private randomCode(length: number): string {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
      out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return out;
  }

  /**
   * Renders the captcha as an inline SVG. Uses currentColor so the parent
   * element controls the stroke colour — matches the active theme without
   * the server having to know which theme is active. Light noise lines and
   * small per-character rotation/translation keep simple OCR off.
   */
  private renderSvg(text: string): string {
    const width = 200;
    const height = 70;
    const cx = width / 2;
    const cy = height / 2 + 8;
    const charSpacing = 26;
    const startX = cx - ((text.length - 1) * charSpacing) / 2;

    let chars = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const x = startX + i * charSpacing;
      const rot = ((this.deterministicNoise(text, i, 0) - 0.5) * 30).toFixed(
        1,
      );
      const dy = ((this.deterministicNoise(text, i, 1) - 0.5) * 8).toFixed(1);
      chars += `<text x="${x.toFixed(1)}" y="${(cy + Number(dy)).toFixed(
        1,
      )}" transform="rotate(${rot} ${x.toFixed(1)} ${(
        cy + Number(dy)
      ).toFixed(1)})" font-family="-apple-system, 'Segoe UI', monospace" font-size="32" font-weight="700" text-anchor="middle" fill="currentColor">${ch}</text>`;
    }

    let lines = '';
    for (let i = 0; i < 4; i++) {
      const x1 = (this.deterministicNoise(text, i, 2) * width).toFixed(1);
      const y1 = (this.deterministicNoise(text, i, 3) * height).toFixed(1);
      const x2 = (this.deterministicNoise(text, i, 4) * width).toFixed(1);
      const y2 = (this.deterministicNoise(text, i, 5) * height).toFixed(1);
      lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="1" stroke-opacity="0.25"/>`;
    }

    let dots = '';
    for (let i = 0; i < 30; i++) {
      const cx = (this.deterministicNoise(text, i, 6) * width).toFixed(1);
      const cy = (this.deterministicNoise(text, i, 7) * height).toFixed(1);
      dots += `<circle cx="${cx}" cy="${cy}" r="1.2" fill="currentColor" fill-opacity="0.18"/>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${lines}${dots}${chars}</svg>`;
  }

  private deterministicNoise(text: string, i: number, axis: number): number {
    // Lightweight hash → [0,1). Avoids importing extra deps. Per-text seed
    // means the rendering of a given code is stable across redraws but
    // varies between codes.
    let h = 2166136261 ^ axis;
    h = Math.imul(h ^ i, 16777619);
    for (let k = 0; k < text.length; k++) {
      h = Math.imul(h ^ text.charCodeAt(k), 16777619);
    }
    h ^= h >>> 13;
    h = Math.imul(h, 16777619);
    h ^= h >>> 16;
    return ((h >>> 0) % 10_000) / 10_000;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, c] of this.challenges) {
      if (c.expiresAt < now) this.challenges.delete(id);
    }
    for (const [token, t] of this.tokens) {
      if (t.expiresAt < now) this.tokens.delete(token);
    }
    for (const [ip, state] of this.ipAttempts) {
      if (
        state.lockedUntil < now &&
        now - state.windowStart > ATTEMPT_WINDOW_MS &&
        state.failures === 0
      ) {
        this.ipAttempts.delete(ip);
      }
    }
  }
}
