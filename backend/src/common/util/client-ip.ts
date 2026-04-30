import { Request } from 'express';

/**
 * Resolve the real client IP under a Cloudflare Tunnel / Nginx HTTPS reverse
 * proxy. Priority:
 *   1. CF-Connecting-IP — Cloudflare always sets this with the original client.
 *   2. X-Real-IP        — Nginx sets this from $remote_addr at the edge.
 *   3. req.ip           — Express derives this from X-Forwarded-For with the
 *                         configured `trust proxy` set. Only safe when a
 *                         specific CIDR allowlist is set (see main.ts).
 *   4. socket.remoteAddress — last resort.
 */
export function getClientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;

  const xri = req.headers['x-real-ip'];
  if (typeof xri === 'string' && xri) return xri;

  if (req.ip) return req.ip;

  return req.socket?.remoteAddress || 'unknown';
}
