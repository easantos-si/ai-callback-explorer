<template>
  <!--
    The terminal swaps the whole pane between modes:
      - 'shell'    : the prompt + output history
      - 'language' : language picker (TUI list)
      - 'theme'    : theme picker (TUI list)
      - 'session'  : interactive session viewer (list + detail)
  -->
  <TuiPicker
    v-if="mode === 'language'"
    mode="language"
    @close="mode = 'shell'"
  />

  <TuiPicker
    v-else-if="mode === 'theme'"
    mode="theme"
    @close="mode = 'shell'"
  />

  <SessionView
    v-else-if="mode === 'session' && sessionSlug"
    :slug="sessionSlug"
    :initial-entry-id="sessionInitialEntryId"
    :subscribe="subscribeToCallbacks"
    @close="onSessionViewClose"
  />

  <div v-else class="tui" @click="focusInput">
    <div ref="scrollRef" class="tui-scroll">
      <div
        v-for="(line, i) in lines"
        :key="i"
        class="tui-line"
        :class="line.kind === 'node' ? 'tui-node' : `tui-${line.kind}`"
      >
        <template v-if="line.kind === 'in'">
          <span class="tui-prompt">{{ prompt }}</span>
          <span class="tui-input-echo">{{ line.text }}</span>
        </template>
        <template v-else-if="line.kind === 'node' && line.node">
          <TerminalNode
            :node="line.node"
            @open-session="onOpenSessionFromNode"
          />
        </template>
        <template v-else>{{ line.text }}</template>
      </div>

      <div class="tui-line tui-prompt-line">
        <span class="tui-prompt">{{ prompt }}</span>
        <input
          ref="inputRef"
          v-model="input"
          type="text"
          class="tui-input"
          :placeholder="interactiveActive ? t('terminal.runningHint') : ''"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          @keydown="onKeydown"
        />
      </div>

      <div v-if="completions.length > 1" class="tui-line tui-completions">
        {{ completions.join('  ') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/stores/settings';
import { useSessionStore } from '@/stores/sessions';
import { useBindsStore } from '@/stores/binds';
import { useWebSocket } from '@/composables/useWebSocket';
import { applyTuiTheme, getTuiTheme, DEFAULT_TUI_THEME_ID } from './themes';
import { useVirtualFs } from './fs';
import { runLine, History, complete } from './shell';
import { REGISTRY, fetchBannerNode } from './commands';
import TuiPicker from './TuiPicker.vue';
import SessionView from './SessionView.vue';
import TerminalNode from './TerminalNode.vue';
import type { TerminalLine, ShellApi } from './types';
import type { CallbackEntry } from '@/types';

type Mode = 'shell' | 'language' | 'theme' | 'session';

const { t, locale } = useI18n();
const settings = useSettingsStore();
const store = useSessionStore();
const binds = useBindsStore();
const ws = useWebSocket();
const fs = useVirtualFs();

const lines = ref<TerminalLine[]>([]);
const input = ref('');
const inputRef = ref<HTMLInputElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);
const mode = ref<Mode>('shell');
const sessionSlug = ref<string | null>(null);
const sessionInitialEntryId = ref<string | null>(null);
const completions = ref<string[]>([]);
const completionIdx = ref(0);

const history = new History();

// ---- callback fan-out ---------------------------------------------
//
// The WebSocket composable only supports a single callback handler at
// a time, but `tail -f` (and the SessionView component) want to
// listen alongside the always-on persistence handler. We funnel
// everything through the local Set below so multiple subscribers can
// coexist.
const callbackListeners = new Set<(entry: CallbackEntry) => void>();

function subscribeToCallbacks(fn: (e: CallbackEntry) => void): () => void {
  callbackListeners.add(fn);
  return () => { callbackListeners.delete(fn); };
}

// ---- interactive job (foreground process) -------------------------
const activeAbort = ref<AbortController | null>(null);
const interactiveActive = computed(() => activeAbort.value !== null);

const prompt = computed(() => {
  const sess = store.activeSession ? `:${truncate(store.activeSession.label, 20)}` : '';
  return `❯ admin@callback${sess}`;
});

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function focusInput(): void {
  inputRef.value?.focus();
}

function onOpenSessionFromNode(slug: string, entryId: string): void {
  void shell.openSessionView(slug, entryId);
}

function onSessionViewClose(): void {
  // Drop the pre-selection so the next "open" without a target picks
  // the freshest entry instead of the one we arrived on last time.
  sessionInitialEntryId.value = null;
  mode.value = 'shell';
}

const shell: ShellApi = {
  clear() {
    lines.value = [];
  },
  switchToGui() {
    settings.setViewMode('gui');
  },
  async openLanguagePicker() {
    mode.value = 'language';
  },
  async openThemePicker() {
    mode.value = 'theme';
  },
  async openSessionView(slug, entryId) {
    sessionSlug.value = slug;
    sessionInitialEntryId.value = entryId ?? null;
    mode.value = 'session';
  },
  async runInteractive(setup) {
    const ctrl = new AbortController();
    activeAbort.value = ctrl;
    try {
      await setup(ctrl.signal);
    } finally {
      if (activeAbort.value === ctrl) activeAbort.value = null;
    }
  },
  onCallbackArrival(handler) {
    return subscribeToCallbacks(handler);
  },
  async selectSession(sessionId) {
    // App.vue watches `store.activeSessionId` and calls
    // `ws.joinSession()` when it changes, but a watch doesn't fire
    // when the same id is re-selected. Always join explicitly so a
    // freshly-created session (or a re-tail of the same one) actually
    // subscribes to the WS room. `joinSession` already handles the
    // "leave previous, join new" case internally, so calling it
    // unconditionally is safe.
    await store.selectSession(sessionId);
    ws.joinSession(sessionId);
  },
};

async function execLine(raw: string): Promise<void> {
  // Echo the input first so it's part of the history.
  lines.value.push({ kind: 'in', text: raw });
  history.push(raw);
  if (!raw.trim()) return;
  await runLine({
    line: raw,
    registry: REGISTRY,
    fs,
    shell,
    t: (k, p) => t(k, p ?? {}) as string,
    locale: locale.value,
    onLine: (l) => {
      lines.value.push(l);
      void scrollToBottom();
    },
  });
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (interactiveActive.value) return;
    const raw = input.value;
    input.value = '';
    completions.value = [];
    void execLine(raw).then(() => scrollToBottom());
    return;
  }
  if (e.key === 'l' && e.ctrlKey) {
    e.preventDefault();
    shell.clear();
    return;
  }
  if (e.key === 'c' && e.ctrlKey) {
    e.preventDefault();
    if (activeAbort.value) {
      lines.value.push({ kind: 'sys', text: '^C' });
      activeAbort.value.abort();
      return;
    }
    if (input.value) {
      lines.value.push({ kind: 'in', text: input.value + '^C' });
      input.value = '';
    }
    return;
  }
  if (interactiveActive.value) {
    e.preventDefault();
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    input.value = history.prev(input.value);
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    input.value = history.next(input.value);
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    onTab();
    return;
  }
  completions.value = [];
}

function onTab(): void {
  const target = inputRef.value;
  const caret = target?.selectionStart ?? input.value.length;
  const { matches, tokenStart, tokenEnd } = complete(
    input.value,
    caret,
    REGISTRY,
    fs,
  );
  if (matches.length === 0) {
    completions.value = [];
    return;
  }
  if (matches.length === 1) {
    const replaced =
      input.value.slice(0, tokenStart) +
      matches[0] +
      input.value.slice(tokenEnd);
    input.value = replaced + (replaced.endsWith(' ') ? '' : ' ');
    completions.value = [];
    return;
  }
  const prefix = longestCommonPrefix(matches);
  if (prefix.length > tokenEnd - tokenStart) {
    input.value =
      input.value.slice(0, tokenStart) +
      prefix +
      input.value.slice(tokenEnd);
  }
  completions.value = matches;
  completionIdx.value = 0;
}

function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return '';
  let p = strs[0];
  for (const s of strs) {
    while (!s.startsWith(p)) {
      p = p.slice(0, -1);
      if (!p) return '';
    }
  }
  return p;
}

async function scrollToBottom(): Promise<void> {
  await nextTick();
  if (scrollRef.value) {
    scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
  }
}

watch(
  () => settings.tuiThemeId,
  (id) => applyTuiTheme(getTuiTheme(id || DEFAULT_TUI_THEME_ID)),
);

// Refocus the prompt when leaving any of the full-screen modes.
watch(mode, async (m) => {
  if (m === 'shell') {
    await nextTick();
    focusInput();
  }
});

onMounted(() => {
  applyTuiTheme(getTuiTheme(settings.tuiThemeId || DEFAULT_TUI_THEME_ID));
  // Show the fastfetch-style banner as the very first thing the
  // operator sees. Same node `info` produces — the boot banner and
  // the on-demand command share one source of truth.
  lines.value.push({
    kind: 'node',
    node: fetchBannerNode(
      (k, p) => t(k, p ?? {}) as string,
      locale.value,
    ),
  });
  ws.connect();
  ws.onCallback(async (entry) => {
    try {
      await store.addEntry(entry);
    } catch (e) {
      console.warn('[Terminal] addEntry failed:', e);
    }
    // Forward to any bound proxies; show one terminal line per
    // attempt so the operator can see whether the redirect worked.
    // Wrapped so a flaky bind store can't break the rest of the
    // pipeline (live-tail subscribers + ambient arrival link).
    binds.forward(entry).then((results) => {
      for (const r of results) {
        const tone: 'ok' | 'err' = r.ok ? 'ok' : 'err';
        const message = r.ok
          ? `→ ${r.targetUrl}  HTTP ${r.status}  ${r.durationMs}ms`
          : `→ ${r.targetUrl}  ${r.error ?? `HTTP ${r.status}`}  ${r.durationMs}ms`;
        lines.value.push({
          kind: 'node',
          node: {
            kind: 'callout',
            data: { tone, message },
            textRepr: message,
          },
        });
      }
      if (results.length > 0) void scrollToBottom();
    }).catch((e) => console.warn('[Terminal] bind forward failed:', e));
    // Notify shell-level subscribers (`tail -f`, SessionView).
    for (const fn of callbackListeners) {
      try { fn(entry); } catch { /* ignore listener errors */ }
    }
    if (
      mode.value === 'shell' &&
      store.activeSessionId === entry.sessionId &&
      !interactiveActive.value
    ) {
      // Render an arrival callout that opens the SessionView pre-
      // selected on this callback when clicked. The text fallback
      // matches the previous plain-line rendering.
      const slug = fs
        .listSessions()
        .find((s) => s.session.id === entry.sessionId)?.slug ?? '';
      lines.value.push({
        kind: 'node',
        node: {
          kind: 'arrival-link',
          data: {
            method: entry.method,
            path: entry.path,
            sessionSlug: slug,
            entryId: entry.id,
          },
          textRepr: `[ ${entry.method} ${entry.path} ]`,
        },
      });
      void scrollToBottom();
    }
  });
  void scrollToBottom();
  nextTick(() => focusInput());
});
</script>

<style scoped>
.tui {
  position: fixed;
  inset: 0;
  background: var(--tui-bg, #020602);
  color: var(--tui-fg, #33ff66);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  overflow: hidden;
  cursor: text;
}

.tui-scroll {
  height: 100%;
  overflow-y: auto;
  padding: 14px 18px 24px;
}

.tui-line {
  display: block;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.tui-in { color: var(--tui-fg, #33ff66); }
.tui-out { color: var(--tui-fg, #33ff66); }
.tui-err { color: var(--tui-err, #ff6b6b); }
.tui-sys { color: var(--tui-fg-dim, #1f8a37); }
.tui-node { white-space: normal; }

.tui-input-echo { color: var(--tui-fg); }

.tui-prompt {
  color: var(--tui-prompt, #5cff85);
  font-weight: 600;
}

.tui-prompt-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tui-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: inherit;
  font: inherit;
  caret-color: var(--tui-prompt, #5cff85);
}
.tui-input::placeholder {
  color: var(--tui-fg-dim);
  font-style: italic;
  opacity: 0.7;
}

.tui-completions {
  color: var(--tui-fg-dim, #1f8a37);
  margin-top: 4px;
}
</style>
