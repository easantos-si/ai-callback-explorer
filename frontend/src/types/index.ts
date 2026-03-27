export interface Session {
  id: string;
  label: string;
  createdAt: string;
  callbackUrl: string;
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
