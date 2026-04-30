// All types used by the terminal subsystem live here. Keeping them in
// one place makes the whole `terminal/` folder grep-discoverable and
// trivial to delete if the experiment is rolled back.

import type { Session, CallbackEntry } from '@/types';

export interface TerminalLine {
  // 'in'   — echoed user input
  // 'out'  — stdout from a command (text)
  // 'err'  — stderr (rendered red)
  // 'sys'  — banners, messages from the shell, etc. (rendered muted)
  // 'node' — rich Vue-rendered output (final stage only)
  kind: 'in' | 'out' | 'err' | 'sys' | 'node';
  text?: string;
  node?: RichNode;
}

/**
 * Rich output emitted by commands when running as the final stage of
 * a pipeline. Intermediate stages still see only `textRepr` so pipes
 * keep working in plain text.
 */
export interface RichNode {
  /** Discriminator handled by `TerminalNode.vue`. */
  kind:
    | 'json'
    | 'kv'
    | 'callback-row'
    | 'callback-block'
    | 'session-row'
    | 'help-grid'
    | 'man-page'
    | 'callout'
    | 'callback-url'
    | 'arrival-link'
    | 'fetch-banner';
  data: unknown;
  /** Plain-text fallback for piping into another command. */
  textRepr: string;
}

export interface ParsedArgs {
  /** Positional arguments, after flags are stripped. */
  positional: string[];
  /** Long/short flags. Boolean for `-x`, string for `-x value` or `--x=value`. */
  flags: Record<string, string | boolean>;
  /** Original argv slice (excluding command name) — kept for tools that
   *  want to inspect quoting or order verbatim. */
  raw: string[];
}

export interface Stdio {
  /** Read whatever upstream wrote (joined). Returns '' when this is the
   *  first stage in a pipeline. */
  read(): string;
  /** Append a line to stdout. Trailing newline implicit. */
  writeln(s: string): void;
  /** Append text without a trailing newline (rare). */
  write(s: string): void;
  /** Append to stderr. */
  errln(s: string): void;
  /** Emit a rich node. In intermediate stages it falls back to `textRepr`
   *  so the receiving command sees text. The final stage renders it. */
  writeNode(node: RichNode): void;
}

export interface ShellApi {
  /** Wipe the rendered output (Ctrl+L / `clear`). */
  clear(): void;
  /** Switch back to the GUI mode. */
  switchToGui(): void;
  /** Open the language picker (full-screen TUI). */
  openLanguagePicker(): Promise<void>;
  /** Open the theme picker (full-screen TUI, GUI + TUI palettes). */
  openThemePicker(): Promise<void>;
  /** Open the session view (interactive list + detail) for a given slug.
   *  When `entryId` is provided, that entry is pre-selected. */
  openSessionView(sessionSlug: string, entryId?: string): Promise<void>;
  /**
   * Run a long-lived job (e.g. `tail -f`) until the user hits Ctrl+C.
   * The setup function receives an AbortSignal and should resolve only
   * when the signal aborts.
   */
  runInteractive(setup: (signal: AbortSignal) => Promise<void>): Promise<void>;
  /** Subscribe to live callback events. Returns the unsubscribe fn. */
  onCallbackArrival(handler: (entry: CallbackEntry) => void): () => void;
  /** Make `sessionId` the active session — joins WS, loads entries.
   *  Required by `tail -f` so the backend pushes events for that room. */
  selectSession(sessionId: string): Promise<void>;
}

export interface ExecCtx {
  args: ParsedArgs;
  stdio: Stdio;
  fs: VirtualFs;
  shell: ShellApi;
  /** Translator forwarded from vue-i18n. */
  t: (key: string, params?: Record<string, unknown>) => string;
  /** Current locale code — for `man` page selection. */
  locale: string;
}

export interface Command {
  name: string;
  /** One-line summary for `help` (i18n key). */
  briefKey: string;
  run(ctx: ExecCtx): Promise<number> | number;
  /** Returns possible completions for the given partial argument. */
  complete?(partial: string, fs: VirtualFs): string[];
  /**
   * Short flags that take an inline value, e.g. `cut -d ' ' -f 1` ←
   * 'd' and 'f'. Keeps the parser per-command so `tail -f` (boolean)
   * and `cut -f` (value) can coexist.
   */
  valueFlags?: ReadonlyArray<string>;
  /** Hide from `help` and command-completion. Used for super-mode
   *  commands that should only surface when their gate is open. */
  hidden?(): boolean;
}

// ---- Virtual filesystem ----------------------------------------------

export interface FsSession {
  slug: string;     // unique slug derived from label (collisions get -<hex8>)
  session: Session;
}

export interface FsEntry {
  slug: string;     // short id (first 8 chars of the entry id)
  entry: CallbackEntry;
}

export interface VirtualFs {
  listSessions(): FsSession[];
  findSession(slug: string): FsSession | null;
  listEntries(slug: string): Promise<FsEntry[]>;
  findEntry(sessionSlug: string, entrySlug: string): Promise<FsEntry | null>;
}
