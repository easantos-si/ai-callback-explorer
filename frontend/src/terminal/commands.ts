/**
 * Command implementations for the TUI shell. Each command is small
 * and self-contained. They all access the surrounding world via the
 * ExecCtx — never via direct Pinia imports — so the shell stays easy
 * to test and refactor.
 *
 * Output strategy:
 *   - Commands meant for piping (echo, grep, sed, awk, cut, wc, uniq,
 *     jq, head when chained) emit plain text via `stdio.writeln`.
 *   - Commands whose value is mostly visual (cat, ls -l, head/tail of
 *     a session, config, help, man) emit rich nodes via
 *     `stdio.writeNode`. Those nodes carry a plain-text fallback so
 *     they still work mid-pipeline.
 */

import type { Command, ExecCtx, FsEntry, RichNode } from './types';
import { useSessionStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';
import { useAuthStore } from '@/stores/auth';
import { useSuperModeStore } from '@/stores/superMode';
import { AVAILABLE_LOCALES, type LocaleCode } from '@/i18n';
import { TUI_THEMES, getTuiTheme } from './themes';
import { THEMES } from '@/themes';
import { intlLocaleFor } from '@/i18n';
import { formatDate, formatDateTimeLong } from '@/utils/formatters';
import { buildCallbackUrl } from '@/utils/callback-url';
import { getSessionStatus } from '@/utils/session-status';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// ---- helpers --------------------------------------------------------

function lines(s: string): string[] {
  return s.split('\n').filter((l) => l.length > 0);
}

function entryRowText(e: FsEntry): string {
  // Plain-text fallback used when the row is piped into another command.
  const ts = formatDate(e.entry.receivedAt);
  const method = e.entry.method.padEnd(7);
  const ct = (e.entry.contentType || '-').slice(0, 22).padEnd(22);
  const preview = bodyPreview(e.entry.body, 80);
  return `${e.slug}  ${ts}  ${method}  ${ct}  ${preview}`;
}

function bodyPreview(body: unknown, max: number): string {
  if (body == null) return '(empty)';
  try {
    const s = typeof body === 'string' ? body : JSON.stringify(body);
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return '(binary)';
  }
}

function entryRowNode(e: FsEntry): RichNode {
  return {
    kind: 'callback-row',
    data: {
      slug: e.slug,
      ts: formatDate(e.entry.receivedAt),
      method: e.entry.method,
      path: e.entry.path,
      contentType: e.entry.contentType || '-',
      preview: bodyPreview(e.entry.body, 120),
    },
    textRepr: entryRowText(e),
  };
}

function entryBlockNode(e: FsEntry): RichNode {
  // Full structured block — same fields the GUI detail panel shows.
  // No truncation. Headers separated from explicit fields so they
  // don't duplicate.
  const skip = new Set(['content-type', 'user-agent']);
  const headers = Object.entries(e.entry.headers || {})
    .filter(([k]) => !skip.has(k.toLowerCase()))
    .map(([k, v]) => [k, String(v)] as [string, string]);
  const query = Object.entries(e.entry.query || {}).map(
    ([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)] as [string, string],
  );
  return {
    kind: 'callback-block',
    data: {
      slug: e.slug,
      method: e.entry.method,
      path: e.entry.path,
      ts: formatDate(e.entry.receivedAt),
      id: e.entry.id,
      contentType: e.entry.contentType || '-',
      ip: e.entry.ip,
      userAgent: e.entry.userAgent,
      headers,
      query,
      body: e.entry.body,
    },
    textRepr: entryBlockText(e),
  };
}

function entryBlockText(e: FsEntry): string {
  const out: string[] = [];
  out.push(`──── ${e.entry.method} ${e.entry.path} ────`);
  out.push(`id:           ${e.entry.id}`);
  out.push(`received:     ${formatDate(e.entry.receivedAt)}`);
  out.push(`content-type: ${e.entry.contentType}`);
  out.push(`ip:           ${e.entry.ip}`);
  out.push(`user-agent:   ${e.entry.userAgent}`);
  for (const [k, v] of Object.entries(e.entry.headers || {})) {
    out.push(`${k}: ${v}`);
  }
  out.push('');
  const b = e.entry.body;
  if (b != null) {
    out.push(typeof b === 'string' ? b : (() => {
      try { return JSON.stringify(b, null, 2); } catch { return String(b); }
    })());
  }
  return out.join('\n');
}

function urlNode(label: string, sessionId: string, intro?: string): RichNode {
  const url = buildCallbackUrl(sessionId);
  return {
    kind: 'callback-url',
    data: { label, url, intro },
    textRepr: intro ? `${intro}\n${url}` : url,
  };
}

// ---- commands -------------------------------------------------------

const ls: Command = {
  name: 'ls',
  briefKey: 'terminal.man.ls.brief',
  complete(_partial, fs) {
    return fs.listSessions().map((s) => s.slug);
  },
  async run({ args, stdio, fs }: ExecCtx) {
    const target = args.positional[0];
    if (!target || target === '/' || target === '.') {
      const list = fs.listSessions();
      if (args.flags.l || args.flags.a) {
        for (const s of list) {
          const localDate = formatDateTimeLong(s.session.createdAt);
          const status = getSessionStatus(s.session);
          const tagPrefix =
            status === 'expired' ? '[expired] '
            : status === 'orphaned' ? '[orphaned] '
            : '';
          stdio.writeNode({
            kind: 'session-row',
            data: {
              count: s.session.entryCount,
              createdAt: localDate,
              slug: s.slug,
              label: s.session.label,
              status,
            },
            textRepr:
              tagPrefix +
              `${String(s.session.entryCount).padStart(6)}  ${localDate}  ${s.slug}  ${s.session.label}`,
          });
        }
      } else {
        for (const s of list) stdio.writeln(s.slug);
      }
      return 0;
    }
    const fsess = fs.findSession(target.replace(/^\/+|\/+$/g, ''));
    if (!fsess) { stdio.errln(`ls: ${target}: no such session`); return 1; }
    const entries = await fs.listEntries(fsess.slug);
    for (const e of entries) {
      if (args.flags.l) stdio.writeNode(entryRowNode(e));
      else stdio.writeln(e.slug);
    }
    return 0;
  },
};

const pwd: Command = {
  name: 'pwd',
  briefKey: 'terminal.man.pwd.brief',
  run({ stdio }) { stdio.writeln('/'); return 0; },
};

const cat: Command = {
  name: 'cat',
  briefKey: 'terminal.man.cat.brief',
  complete(_partial, fs) { return fs.listSessions().map((s) => s.slug); },
  async run({ args, stdio, fs, t }) {
    if (args.positional.length === 0) {
      stdio.write(stdio.read());
      return 0;
    }
    for (const target of args.positional) {
      const path = target.replace(/^\/+/, '').split('/');
      const sessionSlug = path[0];
      const entrySlug = path[1];
      const fsess = fs.findSession(sessionSlug);
      if (!fsess) { stdio.errln(`cat: ${target}: not found`); continue; }
      if (!entrySlug) {
        // Bare session: callback URL + structured callback blocks.
        stdio.writeNode(urlNode(
          fsess.session.label,
          fsess.session.id,
          t('terminal.cat.urlIntro'),
        ));
        const entries = (await fs.listEntries(sessionSlug)).slice().reverse();
        if (entries.length === 0) {
          stdio.writeNode({
            kind: 'callout',
            data: { tone: 'info', message: t('terminal.cat.empty') },
            textRepr: t('terminal.cat.empty'),
          });
        }
        for (const e of entries) stdio.writeNode(entryBlockNode(e));
        continue;
      }
      const e = await fs.findEntry(sessionSlug, entrySlug);
      if (!e) { stdio.errln(`cat: ${target}: not found`); continue; }
      stdio.writeNode(entryBlockNode(e));
    }
    return 0;
  },
};

const head: Command = {
  name: 'head',
  briefKey: 'terminal.man.head.brief',
  complete(_partial, fs) { return fs.listSessions().map((s) => s.slug); },
  async run({ args, stdio, fs }) {
    const n = parseInt(String(args.flags.n ?? '10'), 10) || 10;
    const target = args.positional[0];
    if (target) {
      const slug = target.replace(/^\/+/, '');
      // Same structured-block format as `tail` so the operator can
      // read the first or last few callbacks in full detail without
      // jumping back to GUI mode.
      const entries = (await fs.listEntries(slug)).slice().reverse();
      for (const e of entries.slice(0, n)) stdio.writeNode(entryBlockNode(e));
      return 0;
    }
    for (const l of lines(stdio.read()).slice(0, n)) stdio.writeln(l);
    return 0;
  },
};

const tail: Command = {
  name: 'tail',
  briefKey: 'terminal.man.tail.brief',
  complete(_partial, fs) { return fs.listSessions().map((s) => s.slug); },
  async run({ args, stdio, fs, shell, t }) {
    const n = parseInt(String(args.flags.n ?? '10'), 10) || 10;
    const target = args.positional[0];
    if (!target) {
      const ll = lines(stdio.read());
      for (const l of ll.slice(-n)) stdio.writeln(l);
      return 0;
    }

    const slug = target.replace(/^\/+/, '');
    const fsess = fs.findSession(slug);
    if (!fsess) { stdio.errln(`tail: ${target}: not found`); return 1; }

    // Auto-select the session — the backend joins WS rooms keyed by
    // session id, so without this `tail -f` would never receive events.
    await shell.selectSession(fsess.session.id);

    // Oldest → newest, like a real log file.
    const entries = (await fs.listEntries(slug)).slice().reverse();
    const seen = new Set<string>();
    for (const e of entries) seen.add(e.entry.id);
    for (const e of entries.slice(-n)) stdio.writeNode(entryBlockNode(e));

    if (!args.flags.f) return 0;

    stdio.writeNode({
      kind: 'callout',
      data: {
        tone: 'info',
        message: t('terminal.tail.follow', { slug }),
      },
      textRepr: `==> following ${slug} (Ctrl+C to stop)`,
    });

    await shell.runInteractive(async (signal) => {
      const unsubscribe = shell.onCallbackArrival((entry) => {
        if (entry.sessionId !== fsess.session.id) return;
        if (seen.has(entry.id)) return;
        seen.add(entry.id);
        stdio.writeNode(entryBlockNode({
          slug: entry.id.slice(0, 8),
          entry,
        }));
      });
      await new Promise<void>((resolve) => {
        const onAbort = (): void => {
          unsubscribe();
          signal.removeEventListener('abort', onAbort);
          resolve();
        };
        signal.addEventListener('abort', onAbort);
      });
    });
    return 0;
  },
};

const rm: Command = {
  name: 'rm',
  briefKey: 'terminal.man.rm.brief',
  complete(_partial, fs) { return fs.listSessions().map((s) => s.slug); },
  async run({ args, stdio, fs }) {
    const store = useSessionStore();
    if (args.positional.length === 0) {
      stdio.errln('rm: missing operand'); return 1;
    }
    for (const target of args.positional) {
      const path = target.replace(/^\/+/, '').split('/');
      const fsess = fs.findSession(path[0]);
      if (!fsess) { stdio.errln(`rm: ${target}: not found`); continue; }
      if (!path[1]) {
        await store.deleteSessionById(fsess.session.id);
        stdio.writeNode({
          kind: 'callout',
          data: { tone: 'ok', message: `removed session '${fsess.slug}'` },
          textRepr: `removed session '${fsess.slug}'`,
        });
      } else {
        const e = await fs.findEntry(path[0], path[1]);
        if (!e) { stdio.errln(`rm: ${target}: not found`); continue; }
        await store.deleteEntryById(e.entry.id);
        stdio.writeNode({
          kind: 'callout',
          data: { tone: 'ok', message: `removed ${path[0]}/${e.slug}` },
          textRepr: `removed ${path[0]}/${e.slug}`,
        });
      }
    }
    return 0;
  },
};

const newCmd: Command = {
  name: 'new',
  briefKey: 'terminal.man.new.brief',
  async run({ args, stdio, shell, t }) {
    const store = useSessionStore();
    const label = args.positional.join(' ').trim() || `Session ${new Date().toISOString().slice(0, 16)}`;
    try {
      const s = await store.createSession(label);
      // Auto-select so the WS server joins us into the new room and we
      // actually receive callbacks the moment they're delivered. The
      // backend only forwards to clients in the room — anything that
      // arrives before the join is lost (no replay endpoint).
      await shell.selectSession(s.id);
      stdio.writeNode({
        kind: 'callout',
        data: { tone: 'ok', message: t('terminal.new.created', { label }) },
        textRepr: `created '${label}' (${s.id})`,
      });
      stdio.writeNode(urlNode(label, s.id, t('terminal.new.urlIntro')));
      return 0;
    } catch (e) {
      stdio.errln(`new: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  },
};

const grep: Command = {
  name: 'grep',
  briefKey: 'terminal.man.grep.brief',
  async run({ args, stdio }) {
    const pattern = args.positional[0];
    if (!pattern) { stdio.errln('grep: missing pattern'); return 2; }
    const flags = args.flags.i ? 'gi' : 'g';
    let re: RegExp;
    try { re = new RegExp(pattern, flags); }
    catch (e) { stdio.errln(`grep: ${(e as Error).message}`); return 2; }
    const inv = !!args.flags.v;
    let matched = 0;
    for (const line of lines(stdio.read())) {
      const hit = re.test(line);
      if (hit !== inv) {
        matched++;
        stdio.writeln(line);
      }
    }
    return matched > 0 ? 0 : 1;
  },
};

const echoCmd: Command = {
  name: 'echo',
  briefKey: 'terminal.man.echo.brief',
  run({ args, stdio }) {
    stdio.writeln(args.positional.join(' '));
    return 0;
  },
};

const wc: Command = {
  name: 'wc',
  briefKey: 'terminal.man.wc.brief',
  run({ args, stdio }) {
    const text = stdio.read();
    const ll = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    const words = (text.match(/\S+/g) ?? []).length;
    const chars = text.length;
    if (args.flags.l) stdio.writeln(String(ll));
    else if (args.flags.w) stdio.writeln(String(words));
    else if (args.flags.c) stdio.writeln(String(chars));
    else stdio.writeln(`${ll} ${words} ${chars}`);
    return 0;
  },
};

const uniq: Command = {
  name: 'uniq',
  briefKey: 'terminal.man.uniq.brief',
  run({ args, stdio }) {
    const ll = lines(stdio.read());
    const out: string[] = [];
    let prev: string | null = null;
    for (const l of ll) {
      if (l !== prev) { out.push(l); prev = l; }
    }
    if (args.flags.c) {
      const counts = new Map<string, number>();
      for (const l of ll) counts.set(l, (counts.get(l) ?? 0) + 1);
      for (const [l, n] of counts) stdio.writeln(`${String(n).padStart(7)} ${l}`);
      return 0;
    }
    for (const l of out) stdio.writeln(l);
    return 0;
  },
};

/**
 * Parses `cut`-style range lists like "1", "1,3", "2-5", "1,3-5,9".
 * Returns the 1-based indices the user asked for, expanded.
 */
function parseRangeList(spec: string, max: number): number[] {
  const out: number[] = [];
  for (const part of spec.split(',')) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    const lo = Math.min(a, b);
    const hi = Math.min(Math.max(a, b), max);
    for (let i = lo; i <= hi; i++) out.push(i);
  }
  return out;
}

const cut: Command = {
  name: 'cut',
  briefKey: 'terminal.man.cut.brief',
  // -d, -f, -c all take inline values.
  valueFlags: ['d', 'f', 'c'],
  run({ args, stdio }) {
    if (args.flags.c !== undefined) {
      // -c <range>: characters at the given 1-based positions.
      const spec = String(args.flags.c);
      for (const line of lines(stdio.read())) {
        const idxs = parseRangeList(spec, line.length);
        stdio.writeln(idxs.map((i) => line[i - 1] ?? '').join(''));
      }
      return 0;
    }

    // -f <range>: fields by index. Default delimiter is TAB; -d picks one.
    if (args.flags.f === undefined) {
      stdio.errln('cut: must give -c <list> or -f <list>');
      return 2;
    }
    const delim = (args.flags.d as string) ?? '\t';
    const spec = String(args.flags.f);
    for (const line of lines(stdio.read())) {
      const cols = line.split(delim);
      const idxs = parseRangeList(spec, cols.length);
      stdio.writeln(idxs.map((i) => cols[i - 1] ?? '').join(delim));
    }
    return 0;
  },
};

const sed: Command = {
  name: 'sed',
  briefKey: 'terminal.man.sed.brief',
  run({ args, stdio }) {
    const expr = args.positional[0];
    if (!expr) { stdio.errln('sed: usage: sed s/pat/rep/[gi]'); return 2; }
    const m = expr.match(/^s\/((?:\\\/|[^/])+)\/((?:\\\/|[^/])*)\/([gi]*)$/);
    if (!m) { stdio.errln('sed: only s/pat/rep/flags is supported'); return 2; }
    const re = new RegExp(m[1], m[3]);
    const rep = m[2];
    for (const line of lines(stdio.read())) {
      stdio.writeln(line.replace(re, rep));
    }
    return 0;
  },
};

const awk: Command = {
  name: 'awk',
  briefKey: 'terminal.man.awk.brief',
  run({ args, stdio }) {
    const prog = args.positional[0] ?? '{print $0}';
    const m = prog.match(/^\{\s*print\s+(.+?)\s*\}$/);
    if (!m) { stdio.errln('awk: only {print $1, $2, ...} is supported'); return 2; }
    const refs = m[1].split(',').map((s) => s.trim());
    for (const line of lines(stdio.read())) {
      const cols = line.split(/\s+/);
      const out = refs.map((r) => {
        if (r === '$0') return line;
        const idx = parseInt(r.replace('$', ''), 10);
        return Number.isFinite(idx) ? (cols[idx - 1] ?? '') : r.replace(/^"|"$/g, '');
      });
      stdio.writeln(out.join(' '));
    }
    return 0;
  },
};

const jq: Command = {
  name: 'jq',
  briefKey: 'terminal.man.jq.brief',
  run({ args, stdio }) {
    // Minimal jq — supports `.`, `.foo`, `.foo.bar`, `.foo[0]`,
    // `.foo[]` (flatten), and `length`. Renders the result as a
    // collapsible JSON tree when it's a final stage.
    const expr = args.positional[0] ?? '.';
    const text = stdio.read().trim();
    if (!text) return 0;
    let data: unknown;
    try { data = JSON.parse(text); }
    catch (e) { stdio.errln(`jq: ${(e as Error).message}`); return 2; }
    let result: unknown[] = [data];
    if (expr === 'length') {
      stdio.writeln(String(Array.isArray(data) ? data.length : Object.keys(data as object).length));
      return 0;
    }
    const parts = expr.replace(/^\./, '').split('.');
    for (const part of parts) {
      if (!part) continue;
      const next: unknown[] = [];
      for (const cur of result) {
        if (cur == null) continue;
        const idxMatch = part.match(/^([^[]*)\[(\d+|)]$/);
        if (idxMatch) {
          const key = idxMatch[1];
          const v = key ? (cur as Record<string, unknown>)[key] : cur;
          if (idxMatch[2] === '') {
            if (Array.isArray(v)) next.push(...v);
          } else {
            const i = parseInt(idxMatch[2], 10);
            if (Array.isArray(v)) next.push(v[i]);
          }
        } else {
          next.push((cur as Record<string, unknown>)[part]);
        }
      }
      result = next;
    }
    for (const r of result) {
      if (r === null || typeof r !== 'object') {
        stdio.writeln(typeof r === 'string' ? r : JSON.stringify(r));
        continue;
      }
      stdio.writeNode({
        kind: 'json',
        data: r,
        textRepr: JSON.stringify(r, null, 2),
      });
    }
    return 0;
  },
};

const copy: Command = {
  name: 'copy',
  briefKey: 'terminal.man.copy.brief',
  async run({ stdio, t }) {
    const text = stdio.read();
    if (!text) { stdio.errln('copy: no input'); return 2; }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    stdio.writeNode({
      kind: 'callout',
      data: { tone: 'ok', message: t('terminal.copied') },
      textRepr: t('terminal.copied'),
    });
    return 0;
  },
};

const clear: Command = {
  name: 'clear',
  briefKey: 'terminal.man.clear.brief',
  run({ shell }) { shell.clear(); return 0; },
};

const time: Command = {
  name: 'time',
  briefKey: 'terminal.man.time.brief',
  run({ stdio, locale }) {
    const intl = intlLocaleFor(locale as LocaleCode);
    const now = new Date();
    stdio.writeln(now.toLocaleString(intl));
    return 0;
  },
};

const dateCmd: Command = {
  name: 'date',
  briefKey: 'terminal.man.date.brief',
  run({ stdio, locale }) {
    const intl = intlLocaleFor(locale as LocaleCode);
    stdio.writeln(new Date().toLocaleDateString(intl));
    return 0;
  },
};

const hour: Command = {
  name: 'hour',
  briefKey: 'terminal.man.hour.brief',
  run({ stdio, locale }) {
    const intl = intlLocaleFor(locale as LocaleCode);
    stdio.writeln(new Date().toLocaleTimeString(intl));
    return 0;
  },
};

const gui: Command = {
  name: 'gui',
  briefKey: 'terminal.man.gui.brief',
  run({ shell }) { shell.switchToGui(); return 0; },
};

// `exit` is the muscle-memory alias — operators reach for it when they
// want to leave a terminal session, regardless of context. Same outcome
// as `gui`, just kinder to fingers trained on real shells.
const exitCmd: Command = {
  name: 'exit',
  briefKey: 'terminal.man.exit.brief',
  run({ shell }) { shell.switchToGui(); return 0; },
};

const config: Command = {
  name: 'config',
  briefKey: 'terminal.man.config.brief',
  run({ stdio }) {
    const settings = useSettingsStore();
    const rows = [
      { key: 'view', value: settings.viewMode },
      { key: 'locale', value: settings.locale },
      { key: 'gui-theme', value: settings.themeId },
      { key: 'tui-theme', value: settings.tuiThemeId || '(default)' },
    ];
    stdio.writeNode({
      kind: 'kv',
      data: { rows },
      textRepr: rows.map((r) => `${r.key.padEnd(12)} ${r.value}`).join('\n'),
    });
    return 0;
  },
};

const language: Command = {
  name: 'language',
  briefKey: 'terminal.man.language.brief',
  async run({ shell }) {
    await shell.openLanguagePicker();
    return 0;
  },
};

const theme: Command = {
  name: 'theme',
  briefKey: 'terminal.man.theme.brief',
  async run({ shell }) {
    await shell.openThemePicker();
    return 0;
  },
};

/**
 * Renders an arrival-link node — the same kind the live WS handler
 * pushes when a callback comes in. Clicking it opens the SessionView
 * pre-selected on that callback. Used by `select` for the existing
 * entries so the operator can reach details from the terminal.
 */
function arrivalLinkNode(
  fsess: { slug: string; session: { id: string } },
  e: FsEntry,
  formattedTs: string,
): RichNode {
  return {
    kind: 'arrival-link',
    data: {
      method: e.entry.method,
      path: e.entry.path,
      sessionSlug: fsess.slug,
      entryId: e.entry.id,
      ts: formattedTs,
    },
    textRepr: `[ ${e.entry.method} ${e.entry.path} ]`,
  };
}

const select: Command = {
  // Bare-slug shortcut redirects here. Selects the session (joining
  // the WS room) and lists its existing callbacks as clickable
  // arrival-link rows. New callbacks then keep coming in via the
  // ambient handler; clicking any of them opens the SessionView.
  name: 'select',
  briefKey: 'terminal.man.select.brief',
  complete(_partial, fs) { return fs.listSessions().map((s) => s.slug); },
  async run({ args, stdio, fs, shell, t }) {
    const target = args.positional[0];
    if (!target) {
      stdio.errln('select: missing session slug');
      return 2;
    }
    const fsess = fs.findSession(target.replace(/^\/+/, ''));
    if (!fsess) {
      stdio.errln(`select: ${target}: no such session`);
      return 1;
    }

    await shell.selectSession(fsess.session.id);

    const entries = (await fs.listEntries(fsess.slug)).slice().reverse();
    stdio.writeNode({
      kind: 'callout',
      data: {
        tone: 'info',
        message: t('terminal.select.selected', {
          slug: fsess.slug,
          count: entries.length,
        }),
      },
      textRepr: `selected ${fsess.slug} (${entries.length} cb)`,
    });
    if (entries.length === 0) {
      stdio.writeNode({
        kind: 'callout',
        data: { tone: 'info', message: t('terminal.select.waiting') },
        textRepr: t('terminal.select.waiting'),
      });
      return 0;
    }
    for (const e of entries) {
      stdio.writeNode(arrivalLinkNode(fsess, e, formatDate(e.entry.receivedAt)));
    }
    return 0;
  },
};

const open: Command = {
  // Explicit launcher for the easySQL-like SessionView. Reachable via
  // `open <slug>` or by clicking any arrival-link node in the shell.
  name: 'open',
  briefKey: 'terminal.man.open.brief',
  complete(_partial, fs) { return fs.listSessions().map((s) => s.slug); },
  async run({ args, stdio, fs, shell }) {
    const target = args.positional[0];
    if (!target) {
      stdio.errln('open: missing session slug');
      return 2;
    }
    const fsess = fs.findSession(target.replace(/^\/+/, ''));
    if (!fsess) {
      stdio.errln(`open: ${target}: not found`);
      return 1;
    }
    await shell.openSessionView(fsess.slug);
    return 0;
  },
};

// ---- wget / ping ---------------------------------------------------

interface WgetEnvelope {
  url: string;
  method: string;
  status: number | null;
  ok: boolean;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  body: unknown;
  error?: string;
}

async function doFetch(
  url: string,
  init: RequestInit,
): Promise<WgetEnvelope> {
  const started = performance.now();
  const env: WgetEnvelope = {
    url,
    method: init.method || 'GET',
    status: null,
    ok: false,
    statusText: '',
    durationMs: 0,
    headers: {},
    body: null,
  };
  try {
    const res = await fetch(url, init);
    env.status = res.status;
    env.ok = res.ok;
    env.statusText = res.statusText;
    res.headers.forEach((v, k) => { env.headers[k] = v; });
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    if (ct.includes('application/json')) {
      try { env.body = JSON.parse(text); } catch { env.body = text; }
    } else {
      env.body = text;
    }
  } catch (e) {
    env.error = e instanceof Error ? e.message : String(e);
  } finally {
    env.durationMs = Math.round(performance.now() - started);
  }
  return env;
}

const wget: Command = {
  name: 'wget',
  briefKey: 'terminal.man.wget.brief',
  // -X method, -d body, -H header, -A user-agent
  valueFlags: ['X', 'd', 'H', 'A'],
  async run({ args, stdio }) {
    const url = args.positional[0];
    if (!url) { stdio.errln('wget: missing URL'); return 2; }

    const init: RequestInit = {
      method: typeof args.flags.X === 'string' ? args.flags.X : 'GET',
      headers: {},
    };
    const headers = new Headers();
    if (typeof args.flags.A === 'string') {
      headers.set('User-Agent', args.flags.A);
    }
    if (typeof args.flags.H === 'string') {
      // Single header form `Key: Value`. Multiple are not supported by
      // the tiny argv parser; users can pipe `wget` for that.
      const i = args.flags.H.indexOf(':');
      if (i > 0) {
        headers.set(args.flags.H.slice(0, i).trim(), args.flags.H.slice(i + 1).trim());
      }
    }
    if (typeof args.flags.d === 'string') {
      init.body = args.flags.d;
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }
    init.headers = headers;

    const envelope = await doFetch(url, init);
    // Final stage → render as a collapsible JSON tree so the operator
    // can drill in. Mid-pipeline the BufferStdio degrades the node to
    // its `textRepr` (the stringified envelope), which `jq` parses
    // happily — `wget url | jq .body.foo` works the same as before.
    stdio.writeNode({
      kind: 'json',
      data: envelope,
      textRepr: JSON.stringify(envelope),
    });
    return envelope.error ? 1 : 0;
  },
};

const ping: Command = {
  name: 'ping',
  briefKey: 'terminal.man.ping.brief',
  async run({ args, stdio, t }) {
    const url = args.positional[0];
    if (!url) { stdio.errln('ping: missing URL'); return 2; }
    const env = await doFetch(url, { method: 'GET' });
    if (env.ok) {
      stdio.writeNode({
        kind: 'callout',
        data: {
          tone: 'ok',
          message: t('terminal.ping.ok', {
            status: env.status,
            ms: env.durationMs,
            url,
          }),
        },
        textRepr: `ok  ${env.status}  ${env.durationMs}ms  ${url}`,
      });
      return 0;
    }
    const reason = env.error
      ? env.error
      : `HTTP ${env.status} ${env.statusText}`;
    stdio.writeNode({
      kind: 'callout',
      data: {
        tone: 'err',
        message: t('terminal.ping.fail', {
          reason,
          ms: env.durationMs,
          url,
        }),
      },
      textRepr: `fail  ${reason}  ${env.durationMs}ms  ${url}`,
    });
    return 1;
  },
};

// ---- super-mode commands -------------------------------------------
//
// All four are gated on `superMode.unlocked`. They appear in
// autocomplete and `help` only after the operator unlocks the mode
// (12-press 's' sequence), and refuse to run otherwise.

function superGate(t: ExecCtx['t'], stdio: ExecCtx['stdio']): boolean {
  const sm = useSuperModeStore();
  if (!sm.unlocked) {
    stdio.errln(t('terminal.super.locked'));
    return false;
  }
  if (!sm.adminToken) {
    stdio.errln(t('terminal.super.noToken'));
    return false;
  }
  return true;
}

interface AllowedOriginRow { origin: string; source: 'env' | 'runtime' }

async function fetchOrigins(): Promise<AllowedOriginRow[]> {
  const sm = useSuperModeStore();
  const res = await fetch(`${API_BASE}/api/admin/origins`, {
    headers: { 'X-Admin-Token': sm.adminToken },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) sm.setAdminToken('');
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as { origins?: AllowedOriginRow[] };
  return data.origins ?? [];
}

const origins: Command = {
  name: 'origins',
  briefKey: 'terminal.man.origins.brief',
  hidden() { return !useSuperModeStore().unlocked; },
  async run({ stdio, t }) {
    if (!superGate(t, stdio)) return 1;
    try {
      const list = await fetchOrigins();
      if (list.length === 0) {
        stdio.writeNode({
          kind: 'callout',
          data: { tone: 'info', message: t('terminal.super.noOrigins') },
          textRepr: t('terminal.super.noOrigins'),
        });
        return 0;
      }
      const rows = list.map((o) => ({
        key: o.source === 'env' ? '🔒 env' : '⌁ runtime',
        value: o.origin,
      }));
      stdio.writeNode({
        kind: 'kv',
        data: { rows },
        textRepr: rows.map((r) => `${r.key.padEnd(12)} ${r.value}`).join('\n'),
      });
      return 0;
    } catch (e) {
      stdio.errln(`origins: ${(e as Error).message}`);
      return 1;
    }
  },
};

const originAdd: Command = {
  name: 'origin-add',
  briefKey: 'terminal.man.originAdd.brief',
  hidden() { return !useSuperModeStore().unlocked; },
  async run({ args, stdio, t }) {
    if (!superGate(t, stdio)) return 1;
    const origin = args.positional[0];
    if (!origin) { stdio.errln('origin-add: missing origin URL'); return 2; }
    try { new URL(origin); }
    catch { stdio.errln(`origin-add: ${t('superMode.invalidOrigin')}`); return 2; }

    const sm = useSuperModeStore();
    try {
      const res = await fetch(`${API_BASE}/api/admin/origins`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': sm.adminToken,
        },
        body: JSON.stringify({ origin: origin.trim() }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) sm.setAdminToken('');
        const txt = await res.text().catch(() => '');
        stdio.errln(`origin-add: ${txt || `HTTP ${res.status}`}`);
        return 1;
      }
      stdio.writeNode({
        kind: 'callout',
        data: { tone: 'ok', message: t('superMode.addSuccess') },
        textRepr: t('superMode.addSuccess'),
      });
      return 0;
    } catch (e) {
      stdio.errln(`origin-add: ${(e as Error).message}`);
      return 1;
    }
  },
};

const originRm: Command = {
  name: 'origin-rm',
  briefKey: 'terminal.man.originRm.brief',
  hidden() { return !useSuperModeStore().unlocked; },
  async run({ args, stdio, t }) {
    if (!superGate(t, stdio)) return 1;
    const origin = args.positional[0];
    if (!origin) { stdio.errln('origin-rm: missing origin URL'); return 2; }
    const sm = useSuperModeStore();
    try {
      const res = await fetch(`${API_BASE}/api/admin/origins`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': sm.adminToken,
        },
        body: JSON.stringify({ origin: origin.trim() }),
      });
      if (res.status === 403) {
        // Could be invalid token OR env-protected. Distinguish by body.
        const txt = await res.text().catch(() => '');
        if (txt.toLowerCase().includes('ui_origin')) {
          stdio.writeNode({
            kind: 'callout',
            data: { tone: 'warn', message: t('superMode.envProtected') },
            textRepr: t('superMode.envProtected'),
          });
          return 1;
        }
        sm.setAdminToken('');
        stdio.errln(`origin-rm: ${t('superMode.invalidToken')}`);
        return 1;
      }
      if (res.status === 404) {
        stdio.errln(`origin-rm: not found`);
        return 1;
      }
      if (!res.ok) {
        stdio.errln(`origin-rm: HTTP ${res.status}`);
        return 1;
      }
      stdio.writeNode({
        kind: 'callout',
        data: { tone: 'ok', message: t('superMode.removeSuccess') },
        textRepr: t('superMode.removeSuccess'),
      });
      return 0;
    } catch (e) {
      stdio.errln(`origin-rm: ${(e as Error).message}`);
      return 1;
    }
  },
};

const share: Command = {
  name: 'share',
  briefKey: 'terminal.man.share.brief',
  hidden() { return !useSuperModeStore().unlocked; },
  async run({ args, stdio, t }) {
    const sm = useSuperModeStore();
    if (!sm.unlocked) {
      stdio.errln(t('terminal.super.locked'));
      return 1;
    }
    const password = args.positional.join(' ');
    if (!password) { stdio.errln('share: missing master password'); return 2; }
    try {
      const res = await fetch(`${API_BASE}/api/auth/qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) {
        stdio.errln(`share: ${t('auth.qrInvalidPassword')}`);
        return 1;
      }
      if (!res.ok) { stdio.errln(`share: HTTP ${res.status}`); return 1; }
      const body = (await res.json()) as { shareUrl?: string };
      const raw = body.shareUrl ?? '';
      if (!raw) { stdio.errln('share: server did not return a share URL'); return 1; }
      const url = /^https?:\/\//i.test(raw) ? raw : `${window.location.origin}${raw}`;
      // Reuse the URL+copy-icon node so the operator can copy with one
      // click — same UX as the new/cat URL block.
      stdio.writeNode({
        kind: 'callback-url',
        data: { label: 'share', url, intro: t('terminal.share.intro') },
        textRepr: url,
      });
      return 0;
    } catch (e) {
      stdio.errln(`share: ${(e as Error).message}`);
      return 1;
    }
  },
};

// ---- info / fetch (fastfetch-style banner) -------------------------

export function fetchBannerNode(t: ExecCtx['t'], locale: string): RichNode {
  const settings = useSettingsStore();
  const auth = useAuthStore();
  const store = useSessionStore();
  const sm = useSuperModeStore();

  const intl = intlLocaleFor(locale as LocaleCode);
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localeOpt = AVAILABLE_LOCALES.find((l) => l.code === locale);
  const localeLabel = localeOpt ? `${localeOpt.flag} ${localeOpt.label}` : locale;
  const guiTheme = THEMES.find((th) => th.id === settings.themeId);
  const tuiTheme = getTuiTheme(settings.tuiThemeId || TUI_THEMES[0].id);

  const ua = navigator.userAgent;
  // A tiny bit of UA parsing — enough to label the host browser without
  // pulling in a UA library.
  const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edg|Opera)\/([\d.]+)/);
  const browser = browserMatch
    ? `${browserMatch[1].replace('Edg', 'Edge')} ${browserMatch[2].split('.')[0]}`
    : 'unknown';
  const platform = navigator.platform || '—';

  const authState = auth.requiresLogin
    ? t('terminal.info.notAuthed')
    : auth.token
      ? t('terminal.info.authed')
      : t('terminal.info.disabled');

  const sessionState = store.activeSession
    ? `${store.activeSession.label} (${store.activeSession.entryCount} cb)`
    : t('terminal.info.noSession');

  const rows = [
    { key: 'user',     value: 'admin@callback' },
    { key: 'host',     value: window.location.host },
    { key: 'browser',  value: `${browser} · ${platform}` },
    { key: 'auth',     value: authState },
    { key: 'super',    value: sm.unlocked ? '✓ active' : '—' },
    { key: 'session',  value: sessionState },
    { key: 'sessions', value: String(store.sessions.length) },
    { key: 'locale',   value: localeLabel },
    { key: 'gui-theme', value: guiTheme ? `${t(`themes.${guiTheme.i18nKey}`)} (${guiTheme.mode})` : settings.themeId },
    { key: 'tui-theme', value: t(`tuiThemes.${tuiTheme.i18nKey}`) as string },
    { key: 'timezone', value: tz },
    { key: 'now',      value: now.toLocaleString(intl) },
  ];
  const tips = [
    t('terminal.help.tab'),
    t('terminal.help.upDown'),
    t('terminal.help.ctrlL'),
    t('terminal.help.ctrlC'),
    t('terminal.help.bareSlug'),
  ];

  return {
    kind: 'fetch-banner',
    data: { rows, tips },
    textRepr: rows.map((r) => `${r.key.padEnd(10)}: ${r.value}`).join('\n'),
  };
}

const info: Command = {
  name: 'info',
  briefKey: 'terminal.man.info.brief',
  run({ stdio, t, locale }) {
    stdio.writeNode(fetchBannerNode(t, locale));
    return 0;
  },
};

const help: Command = {
  name: 'help',
  briefKey: 'terminal.man.help.brief',
  run({ stdio, t }) {
    const known = new Set<string>();
    const groups = HELP_GROUPS.map((g) => {
      const commands = g.commands
        .map((name) => REGISTRY.get(name))
        .filter((c): c is Command => !!c && !c.hidden?.())
        .map((c) => {
          known.add(c.name);
          return { name: c.name, brief: t(c.briefKey) };
        });
      return {
        label: t(`terminal.help.groups.${g.key}`),
        commands,
      };
    }).filter((g) => g.commands.length > 0);

    // Anything in the registry that wasn't listed above lands in
    // "misc" — keeps newly-added commands discoverable without
    // requiring a HELP_GROUPS edit.
    const misc = REGISTRY_LIST
      .filter((c) => !c.hidden?.() && !known.has(c.name))
      .map((c) => ({ name: c.name, brief: t(c.briefKey) }));
    if (misc.length) {
      groups.push({
        label: t('terminal.help.groups.misc'),
        commands: misc,
      });
    }

    const shortcuts = [
      t('terminal.help.tab'),
      t('terminal.help.upDown'),
      t('terminal.help.ctrlL'),
      t('terminal.help.ctrlC'),
      t('terminal.help.bareSlug'),
    ];

    const textLines: string[] = [t('terminal.help.intro'), ''];
    for (const g of groups) {
      textLines.push(`-- ${g.label} --`);
      for (const c of g.commands) {
        textLines.push(`  ${c.name.padEnd(12)} ${c.brief}`);
      }
      textLines.push('');
    }
    textLines.push(t('terminal.help.shortcuts'));
    for (const s of shortcuts) textLines.push(`  ${s}`);

    stdio.writeNode({
      kind: 'help-grid',
      data: {
        intro: t('terminal.help.intro'),
        shortcutsTitle: t('terminal.help.shortcuts'),
        groups,
        shortcuts,
      },
      textRepr: textLines.join('\n'),
    });
    return 0;
  },
};

const man: Command = {
  name: 'man',
  briefKey: 'terminal.man.man.brief',
  complete() {
    return REGISTRY_LIST.filter((c) => !c.hidden?.()).map((c) => c.name);
  },
  run({ args, stdio, t }) {
    const target = args.positional[0];
    if (!target) { stdio.errln('man: which command?'); return 2; }
    const c = REGISTRY.get(target);
    if (!c || c.hidden?.()) { stdio.errln(`man: no entry for ${target}`); return 1; }
    // Command names may use kebab-case (`origin-add`); the i18n keys
    // are camelCase (`originAdd`). Normalise so they meet in the middle.
    const i18nName = target.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    const fullKey = `terminal.man.${i18nName}.full`;
    const full = t(fullKey);
    const fullBody = full && full !== fullKey ? full : '';
    stdio.writeNode({
      kind: 'man-page',
      data: {
        title: `${target.toUpperCase()}(1)`,
        brief: t(c.briefKey),
        full: fullBody,
      },
      textRepr: [
        `${target.toUpperCase()}(1)`,
        '',
        t(c.briefKey),
        '',
        fullBody,
      ].join('\n'),
    });
    return 0;
  },
};

// ---- registry ------------------------------------------------------

const REGISTRY_LIST: Command[] = [
  ls, pwd, cat, head, tail, rm, newCmd, grep, echoCmd, wc, uniq, cut,
  sed, awk, jq, copy, clear, time, dateCmd, hour,
  gui, exitCmd, config,
  language, theme, select, open, wget, ping, info,
  origins, originAdd, originRm, share,
  help, man,
];

// ---- help groups ---------------------------------------------------
//
// The flat alphabetical list of `help` was getting hard to scan as
// commands grew. Group them into sections that match how operators
// actually reach for them. Each section maps i18n group label → array
// of command names. Commands that exist in the registry but aren't
// listed here fall into "misc".

const HELP_GROUPS: Array<{ key: string; commands: string[] }> = [
  { key: 'sessions', commands: ['new', 'ls', 'select', 'open', 'rm', 'cat', 'head', 'tail'] },
  { key: 'network',  commands: ['wget', 'ping'] },
  { key: 'pipes',    commands: ['grep', 'sed', 'awk', 'cut', 'wc', 'uniq', 'jq', 'echo', 'copy'] },
  { key: 'system',   commands: ['info', 'config', 'language', 'theme', 'time', 'date', 'hour', 'pwd', 'clear', 'gui', 'exit'] },
  { key: 'super',    commands: ['origins', 'origin-add', 'origin-rm', 'share'] },
  { key: 'meta',     commands: ['help', 'man'] },
];

export const REGISTRY: Map<string, Command> = new Map(
  REGISTRY_LIST.map((c) => [c.name, c]),
);

export const COMMAND_NAMES: string[] = REGISTRY_LIST.map((c) => c.name);
export { TUI_THEMES };
export const AVAILABLE_LOCALE_CODES: LocaleCode[] = AVAILABLE_LOCALES.map(
  (l) => l.code,
);
