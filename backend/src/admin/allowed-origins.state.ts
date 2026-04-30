// Shared, in-memory allow list. Module-load initialises it from
// process.env.UI_ORIGIN so the WebSocket gateway (which evaluates its
// `cors` option at decorator time, before Nest DI is ready) and the
// HTTP CORS middleware see the same set. Runtime mutations made via
// the AllowedOriginsService land here too.
//
// Origins are tracked in two buckets so we can offer different policies:
//   - envOrigins: seeded from UI_ORIGIN. Read-only at runtime — removing
//     them via the admin endpoint is rejected. They come back exactly as
//     configured on every restart.
//   - runtimeOrigins: added via the admin endpoint. Live only in process
//     memory; wiped on restart and individually deletable.
//
// Whether the allow list is *enforced* is gated by ORIGIN_FILTERING_ENABLED
// (default off). When disabled, isOriginAllowed returns true for every
// origin and the entire admin/Super-Mode surface is refused. The list is
// still populated from UI_ORIGIN so that flipping the env var on doesn't
// require any code change.

export type OriginSource = 'env' | 'runtime';

export interface AllowedOrigin {
  origin: string;
  source: OriginSource;
}

const envOrigins = new Set<string>();
const runtimeOrigins = new Set<string>();

const FILTERING_ENABLED =
  (process.env.ORIGIN_FILTERING_ENABLED ?? 'false').toLowerCase() === 'true';

(process.env.UI_ORIGIN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .forEach((o) => envOrigins.add(o));

export function isFilteringEnabled(): boolean {
  return FILTERING_ENABLED;
}

export function isOriginAllowed(origin: string): boolean {
  // Filtering off ⇒ permissive. The set is still maintained for the moment
  // the operator flips the flag.
  if (!FILTERING_ENABLED) return true;
  return envOrigins.has(origin) || runtimeOrigins.has(origin);
}

export function listOrigins(): string[] {
  return [...envOrigins, ...runtimeOrigins];
}

export function listOriginsDetailed(): AllowedOrigin[] {
  return [
    ...Array.from(envOrigins, (origin) => ({
      origin,
      source: 'env' as const,
    })),
    ...Array.from(runtimeOrigins, (origin) => ({
      origin,
      source: 'runtime' as const,
    })),
  ];
}

export function addOrigin(origin: string): boolean {
  if (envOrigins.has(origin) || runtimeOrigins.has(origin)) return false;
  runtimeOrigins.add(origin);
  return true;
}

// Removes a runtime-added origin. Returns one of:
//   'removed'    — entry existed in the runtime bucket and was deleted
//   'protected'  — entry exists but came from UI_ORIGIN (cannot be removed)
//   'not_found'  — entry doesn't exist at all
export function removeRuntimeOrigin(
  origin: string,
): 'removed' | 'protected' | 'not_found' {
  if (runtimeOrigins.delete(origin)) return 'removed';
  if (envOrigins.has(origin)) return 'protected';
  return 'not_found';
}
