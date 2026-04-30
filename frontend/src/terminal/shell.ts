import type {
  Command,
  ExecCtx,
  ParsedArgs,
  RichNode,
  ShellApi,
  Stdio,
  TerminalLine,
  VirtualFs,
} from './types';

// ---- tokenisation ---------------------------------------------------

/**
 * Splits a command line into tokens, respecting single quotes, double
 * quotes, and backslash escapes. Pipes are recognised as their own
 * token so the higher-level pipeline parser can split on them.
 */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < line.length) {
    const c = line[i];
    if (inSingle) {
      if (c === "'") {
        inSingle = false;
      } else {
        buf += c;
      }
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"') {
        inDouble = false;
      } else if (c === '\\' && i + 1 < line.length) {
        buf += line[i + 1];
        i += 2;
        continue;
      } else {
        buf += c;
      }
      i++;
      continue;
    }
    if (c === "'") { inSingle = true; i++; continue; }
    if (c === '"') { inDouble = true; i++; continue; }
    if (c === '\\' && i + 1 < line.length) {
      buf += line[i + 1];
      i += 2;
      continue;
    }
    if (c === '|') {
      if (buf) { out.push(buf); buf = ''; }
      out.push('|');
      i++;
      continue;
    }
    if (c === ' ' || c === '\t') {
      if (buf) { out.push(buf); buf = ''; }
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Splits a tokenised line on pipe markers into pipeline stages.
 */
export function splitPipeline(tokens: string[]): string[][] {
  const stages: string[][] = [];
  let cur: string[] = [];
  for (const t of tokens) {
    if (t === '|') {
      if (cur.length) stages.push(cur);
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length) stages.push(cur);
  return stages;
}

/**
 * Argument parser. Recognises:
 *   --foo            → flags.foo = true
 *   --foo=bar        → flags.foo = 'bar'
 *   --foo bar        → flags.foo = 'bar' (when caller passes nextValueAware)
 *   -abc             → flags.a = flags.b = flags.c = true
 *   -n 5             → flags.n = '5'
 * Anything else is positional.
 *
 * `valueFlags` is the set of short flags that take a value (so `-n 5`
 * gets treated as one flag-value pair instead of `n=true, positional='5'`).
 */
export function parseArgs(
  argv: string[],
  valueFlags: Set<string> = new Set(),
): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq >= 0) {
        flags[tok.slice(2, eq)] = tok.slice(eq + 1);
      } else {
        flags[tok.slice(2)] = true;
      }
      continue;
    }
    if (tok.startsWith('-') && tok.length > 1 && !/^-?\d/.test(tok.slice(1))) {
      const letters = tok.slice(1);
      if (letters.length === 1 && valueFlags.has(letters) && i + 1 < argv.length) {
        flags[letters] = argv[++i];
        continue;
      }
      for (const ch of letters) flags[ch] = true;
      continue;
    }
    positional.push(tok);
  }
  return { positional, flags, raw: argv };
}

// ---- stdio implementations ----------------------------------------
//
// Two flavours:
//   - BufferStdio   collects everything (text + nodes) for non-final
//                   stages, then emits a flat text representation
//                   that the next pipeline stage reads.
//   - StreamingStdio  used for the final stage; pushes lines straight
//                     to the renderer as soon as the command produces
//                     them. This is what makes `tail -f` actually
//                     stream live (the command never returns until
//                     Ctrl+C, so a buffer-then-flush approach would
//                     show nothing for the entire follow window).

class BufferStdio implements Stdio {
  private input: string;
  private text = '';
  private errBuf = '';
  constructor(input = '') { this.input = input; }
  read(): string { return this.input; }
  writeln(s: string): void { this.text += s + '\n'; }
  write(s: string): void { this.text += s; }
  errln(s: string): void { this.errBuf += s + '\n'; }
  writeNode(node: RichNode): void {
    // Inside a pipe, rich nodes degrade to their text representation.
    const t = node.textRepr;
    this.text += t.endsWith('\n') ? t : t + '\n';
  }
  takeOut(): string {
    const out = this.text;
    this.text = '';
    return out;
  }
  takeErr(): string { return this.errBuf; }
}

class StreamingStdio implements Stdio {
  private input: string;
  private partial = '';
  private onLine: (l: TerminalLine) => void;
  /** Errors are still buffered so the runner can report them in the
   *  same place as for non-final stages. */
  private errBuf = '';
  constructor(input: string, onLine: (l: TerminalLine) => void) {
    this.input = input;
    this.onLine = onLine;
  }
  read(): string { return this.input; }
  writeln(s: string): void {
    if (this.partial) {
      this.onLine({ kind: 'out', text: this.partial + s });
      this.partial = '';
    } else {
      this.onLine({ kind: 'out', text: s });
    }
  }
  write(s: string): void {
    this.partial += s;
    let i = this.partial.indexOf('\n');
    while (i !== -1) {
      this.onLine({ kind: 'out', text: this.partial.slice(0, i) });
      this.partial = this.partial.slice(i + 1);
      i = this.partial.indexOf('\n');
    }
  }
  errln(s: string): void { this.errBuf += s + '\n'; }
  writeNode(node: RichNode): void {
    if (this.partial) {
      this.onLine({ kind: 'out', text: this.partial });
      this.partial = '';
    }
    this.onLine({ kind: 'node', node });
  }
  flushPartial(): void {
    if (this.partial) {
      this.onLine({ kind: 'out', text: this.partial });
      this.partial = '';
    }
  }
  takeErr(): string { return this.errBuf; }
}

// ---- pipeline runner -----------------------------------------------

export interface RunOpts {
  line: string;
  registry: Map<string, Command>;
  fs: VirtualFs;
  shell: ShellApi;
  t: ExecCtx['t'];
  locale: string;
  /** Called for every output line so the UI can render it. */
  onLine: (line: TerminalLine) => void;
}

export async function runLine(o: RunOpts): Promise<void> {
  const tokens = tokenize(o.line);
  if (tokens.length === 0) return;

  const stages = splitPipeline(tokens);

  // Each stage's stdout becomes the next stage's stdin. A stderr from
  // any stage is rendered immediately so the user sees diagnostics
  // even when later stages discard the data.
  let upstream = '';
  for (let s = 0; s < stages.length; s++) {
    const stage = stages[s];
    let cmdName = stage[0];
    let cmd = o.registry.get(cmdName);

    // Bare-slug shortcut: if the first token of the FIRST stage isn't a
    // command but matches a session slug, rewrite the call to
    // `select <slug>`. That selects the session (joining the WS room)
    // and lists its callbacks inline as clickable links — the operator
    // gets a continuous feed in the terminal and can open any callback
    // in the SessionView with a click.
    if (!cmd && s === 0 && o.fs.findSession(cmdName)) {
      stage.unshift('select');
      cmdName = 'select';
      cmd = o.registry.get('select');
    }

    if (!cmd) {
      o.onLine({
        kind: 'err',
        text: o.t('terminal.unknownCommand', { cmd: cmdName }),
      });
      return;
    }

    const isFinal = s === stages.length - 1;
    const stdio: BufferStdio | StreamingStdio = isFinal
      ? new StreamingStdio(upstream, o.onLine)
      : new BufferStdio(upstream);

    const argv = stage.slice(1);
    // `n` is centralised because `head -n 5` / `tail -n 5` are common
    // enough to live as a default. Anything else, the command declares.
    const valueFlags = new Set<string>(['n', ...(cmd.valueFlags ?? [])]);
    const ctx: ExecCtx = {
      args: parseArgs(argv, valueFlags),
      stdio,
      fs: o.fs,
      shell: o.shell,
      t: o.t,
      locale: o.locale,
    };
    let code = 0;
    try {
      code = await cmd.run(ctx);
    } catch (e) {
      stdio.errln(e instanceof Error ? e.message : String(e));
      code = 1;
    }
    const errText = stdio.takeErr();
    if (errText) {
      for (const line of errText.split('\n')) {
        if (line) o.onLine({ kind: 'err', text: line });
      }
    }
    if (isFinal) {
      (stdio as StreamingStdio).flushPartial();
    } else {
      upstream = (stdio as BufferStdio).takeOut();
    }
    if (code !== 0) return;
  }
}

// ---- history -------------------------------------------------------

const HIST_LIMIT = 200;

export class History {
  private items: string[] = [];
  private cursor = 0;
  push(line: string): void {
    if (!line.trim()) return;
    if (this.items[this.items.length - 1] === line) return;
    this.items.push(line);
    if (this.items.length > HIST_LIMIT) this.items.shift();
    this.cursor = this.items.length;
  }
  prev(current: string): string {
    if (this.items.length === 0) return current;
    if (this.cursor > 0) this.cursor--;
    return this.items[this.cursor] ?? current;
  }
  next(current: string): string {
    if (this.items.length === 0) return current;
    if (this.cursor < this.items.length) this.cursor++;
    return this.cursor === this.items.length ? '' : this.items[this.cursor];
  }
  reset(): void { this.cursor = this.items.length; }
}

// ---- autocomplete --------------------------------------------------

/**
 * Given the current input and caret position, returns possible
 * completions for the token under the caret. Cycles the caller through
 * matches via repeat-Tab presses (the terminal component manages the
 * cycle index).
 */
export function complete(
  input: string,
  caret: number,
  registry: Map<string, Command>,
  fs: VirtualFs,
): { matches: string[]; tokenStart: number; tokenEnd: number } {
  // Find the token under caret (very simple — works for whitespace
  // boundaries; doesn't try to be quote-aware).
  let start = caret;
  while (start > 0 && !/\s/.test(input[start - 1]) && input[start - 1] !== '|') {
    start--;
  }
  const partial = input.slice(start, caret);
  const before = input.slice(0, start).trimEnd();

  // Decide whether we're completing the command name or an argument.
  const isCommandSlot =
    before.length === 0 || before.endsWith('|') || /\|\s*$/.test(before);

  let matches: string[] = [];
  if (isCommandSlot) {
    // Both real commands AND session slugs (the bare-slug shortcut)
    // are valid in the command slot.
    const cmdMatches = Array.from(registry.values())
      .filter((c) => !c.hidden?.() && c.name.startsWith(partial))
      .map((c) => c.name);
    const slugMatches = fs
      .listSessions()
      .map((s) => s.slug)
      .filter((s) => s.startsWith(partial));
    matches = [...new Set([...cmdMatches, ...slugMatches])].sort();
  } else {
    // Argument completion: ask the command if it has a completer,
    // otherwise default to session slugs.
    const beforeTokens = tokenize(before);
    const cmdName = beforeTokens[beforeTokens.length - 1] ?? beforeTokens[0];
    const cmd = registry.get(cmdName);
    if (cmd?.complete) {
      matches = cmd.complete(partial, fs).filter((s) => s.startsWith(partial)).sort();
    } else {
      matches = fs
        .listSessions()
        .map((s) => s.slug)
        .filter((s) => s.startsWith(partial))
        .sort();
    }
  }

  return { matches, tokenStart: start, tokenEnd: caret };
}
