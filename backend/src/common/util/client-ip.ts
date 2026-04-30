import { Request } from 'express';
import { isIPv4 } from 'node:net';

/**
 * Trust-proxy-aware client IP resolution.
 *
 * Hop-injected headers (CF-Connecting-IP, X-Real-IP) are only consumed
 * when the *immediate* TCP peer of this request is in TRUST_PROXY. That
 * matches the boundary nginx is supposed to enforce upstream, but we
 * re-validate here so a misconfigured nginx (e.g. forgetting to strip
 * CF-Connecting-IP from a bypass route) cannot let a client forge an IP.
 *
 * Order:
 *   1. CF-Connecting-IP (if upstream is trusted) — Cloudflare's canonical
 *      visitor IP.
 *   2. X-Real-IP (if upstream is trusted) — what our own nginx sets from
 *      $remote_addr at the edge.
 *   3. req.ip — Express has already validated XFF against the same
 *      TRUST_PROXY list, so this is safe by construction.
 *   4. socket.remoteAddress — last resort.
 */

interface V4Range {
  base: number;
  mask: number;
}

function parseTrustRanges(): { v4: V4Range[]; v6: Set<string> } {
  const raw = (process.env.TRUST_PROXY ?? '').trim();
  const v4: V4Range[] = [];
  const v6 = new Set<string>();

  if (!raw || raw === 'false' || raw === 'true') {
    // Empty / unsafe values are treated as "trust nobody beyond loopback".
    v4.push(toRange('127.0.0.1/32'));
    v6.add('::1');
    return { v4, v6 };
  }

  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part.includes(':')) {
      // IPv6: exact-match only. CIDR-matching v6 in pure JS is overkill
      // for the typical TRUST_PROXY content (loopback + a few literals).
      v6.add(part.replace(/\/.*$/, ''));
      continue;
    }
    try {
      v4.push(toRange(part));
    } catch {
      // Skip malformed entries silently — bootstrap already logs about
      // TRUST_PROXY when the env var is wrong.
    }
  }
  return { v4, v6 };
}

function toRange(cidr: string): V4Range {
  const [ip, bitsStr] = cidr.split('/');
  const bits = bitsStr === undefined ? 32 : parseInt(bitsStr, 10);
  if (!isIPv4(ip) || isNaN(bits) || bits < 0 || bits > 32) {
    throw new Error(`Invalid IPv4 CIDR: ${cidr}`);
  }
  const base =
    ip
      .split('.')
      .reduce((a, n) => ((a << 8) | (Number(n) & 0xff)) >>> 0, 0) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { base: (base & mask) >>> 0, mask };
}

const TRUSTED = parseTrustRanges();

function isTrustedUpstream(rawIp: string): boolean {
  if (!rawIp) return false;
  const ip = rawIp.replace(/^::ffff:/, '');
  if (isIPv4(ip)) {
    const n =
      ip
        .split('.')
        .reduce((a, x) => ((a << 8) | (Number(x) & 0xff)) >>> 0, 0) >>> 0;
    return TRUSTED.v4.some(({ base, mask }) => ((n & mask) >>> 0) === base);
  }
  return TRUSTED.v6.has(ip);
}

export function getClientIp(req: Request): string {
  const upstream = (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');

  if (isTrustedUpstream(upstream)) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf.split(',')[0].trim();

    const xri = req.headers['x-real-ip'];
    if (typeof xri === 'string' && xri) return xri.split(',')[0].trim();
  }

  // Express already validated X-Forwarded-For against TRUST_PROXY when it
  // populated req.ip, so it is safe to consume directly.
  if (req.ip) return req.ip.replace(/^::ffff:/, '');

  return upstream || 'unknown';
}

/**
 * Same trust-aware logic for socket.io handshakes. The socket.io stack
 * gives us headers + the raw connection address but not Express's req.ip
 * derivation, so we replicate the priority list here.
 */
export function getSocketClientIp(handshake: {
  headers: Record<string, string | string[] | undefined>;
  address?: string;
}): string {
  const upstream = (handshake.address || '').replace(/^::ffff:/, '');

  if (isTrustedUpstream(upstream)) {
    const cf = handshake.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf.split(',')[0].trim();
    const xri = handshake.headers['x-real-ip'];
    if (typeof xri === 'string' && xri) return xri.split(',')[0].trim();
  }

  return upstream || 'unknown';
}
