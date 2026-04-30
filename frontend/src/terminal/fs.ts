import type { Session } from '@/types';
import { useSessionStore } from '@/stores/sessions';
import { useIndexedDB } from '@/composables/useIndexedDB';
import type { FsEntry, FsSession, VirtualFs } from './types';

/**
 * Builds slugs from session labels. ASCII-fold + lowercase + non-alnum
 * collapsed to dashes. If the resulting slug collides with an earlier
 * one we suffix the first 8 chars of the UUID — guaranteeing uniqueness
 * without making the operator type the full id.
 */
function slugify(label: string): string {
  const base = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'session';
}

function buildSlugMap(sessions: Session[]): Map<string, FsSession> {
  const counts = new Map<string, number>();
  const out = new Map<string, FsSession>();
  for (const s of sessions) {
    const base = slugify(s.label);
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    const slug = n === 1 ? base : `${base}-${s.id.slice(0, 8)}`;
    out.set(slug, { slug, session: s });
  }
  return out;
}

export function useVirtualFs(): VirtualFs {
  const store = useSessionStore();
  const db = useIndexedDB();

  // Slug map is recomputed on every call so freshly created sessions
  // appear without a cache-bust dance.
  function snapshot(): Map<string, FsSession> {
    return buildSlugMap(store.sessions);
  }

  return {
    listSessions(): FsSession[] {
      return Array.from(snapshot().values());
    },
    findSession(slug: string): FsSession | null {
      return snapshot().get(slug) ?? null;
    },
    async listEntries(slug: string): Promise<FsEntry[]> {
      const fs = snapshot().get(slug);
      if (!fs) return [];
      const list = await db.getEntriesBySession(fs.session.id);
      return list.map((e) => ({ slug: e.id.slice(0, 8), entry: e }));
    },
    async findEntry(
      sessionSlug: string,
      entrySlug: string,
    ): Promise<FsEntry | null> {
      const all = await this.listEntries(sessionSlug);
      return all.find((e) => e.slug === entrySlug) ?? null;
    },
  };
}
