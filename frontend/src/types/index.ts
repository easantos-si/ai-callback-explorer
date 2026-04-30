// `callbackUrl` is intentionally NOT stored — IndexedDB is browser-side
// state the operator can edit, and tampering with it would let a copy
// of the URL redirect callbacks elsewhere. Use the buildCallbackUrl()
// helper, which always derives the URL from the auth-store urlBase
// (mirroring URL_BASE in .env).
export interface Session {
  id: string;
  label: string;
  createdAt: string;
  entryCount: number;
}

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
