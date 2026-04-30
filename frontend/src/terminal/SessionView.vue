<template>
  <div class="sv" ref="rootRef" tabindex="0" @keydown="onKeydown">
    <header class="sv-titlebar">
      <span class="title">{{ session?.label ?? '—' }}</span>
      <span class="meta">
        <span class="count">{{ entries.length }}</span>
        <span class="dot">·</span>
        <span class="slug">{{ slug }}</span>
      </span>
      <span class="hint">{{ t('terminal.sessionView.hint') }}</span>
    </header>

    <div class="sv-url-row">
      <span class="url-label">URL</span>
      <code class="url">{{ url }}</code>
      <button
        class="url-copy"
        :title="t('panel.copyUrl')"
        @click="copyUrl"
      >
        {{ urlCopied ? '✓' : '⧉' }}
      </button>
    </div>

    <div class="sv-body">
      <aside class="sv-list" ref="listRef">
        <div v-if="entries.length === 0" class="empty">
          {{ t('terminal.sessionView.waiting') }}
        </div>
        <div
          v-for="(e, i) in entries"
          :key="e.id"
          class="item"
          :class="{
            focused: focusedIndex === i,
            selected: selectedIndex === i,
          }"
          @click="select(i)"
        >
          <span class="cursor">{{ focusedIndex === i ? '❯' : ' ' }}</span>
          <span class="method" :data-method="e.method">{{ e.method }}</span>
          <span class="path" :title="e.path">{{ e.path }}</span>
          <span class="ts">{{ formatDate(e.receivedAt) }}</span>
        </div>
      </aside>

      <section class="sv-detail">
        <div v-if="selectedEntry" class="detail">
          <header class="detail-head">
            <span class="badge" :data-method="selectedEntry.method">
              {{ selectedEntry.method }}
            </span>
            <span class="path">{{ selectedEntry.path }}</span>
            <span class="ts">{{ formatDate(selectedEntry.receivedAt) }}</span>
          </header>

          <div class="kv-block">
            <div class="block-title">{{ t('detail.info') }}</div>
            <table class="kv">
              <tbody>
                <tr><th>id</th><td>{{ selectedEntry.id }}</td></tr>
                <tr><th>content-type</th><td>{{ selectedEntry.contentType }}</td></tr>
                <tr><th>ip</th><td>{{ selectedEntry.ip }}</td></tr>
                <tr><th>user-agent</th><td>{{ selectedEntry.userAgent }}</td></tr>
              </tbody>
            </table>
          </div>

          <div v-if="filteredHeaders.length" class="kv-block">
            <div class="block-title">{{ t('detail.headers') }}</div>
            <table class="kv">
              <tbody>
                <tr v-for="[k, v] in filteredHeaders" :key="k">
                  <th>{{ k }}</th>
                  <td>{{ v }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="queryEntries.length" class="kv-block">
            <div class="block-title">{{ t('detail.queryParams') }}</div>
            <table class="kv">
              <tbody>
                <tr v-for="[k, v] in queryEntries" :key="k">
                  <th>{{ k }}</th>
                  <td>{{ v }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="kv-block">
            <div class="block-title">{{ t('detail.body') }}</div>
            <JsonViewer
              v-if="isObj(selectedEntry.body)"
              :data="selectedEntry.body"
            />
            <pre v-else-if="selectedEntry.body !== null && selectedEntry.body !== undefined" class="body-raw">{{ formatPrim(selectedEntry.body) }}</pre>
            <span v-else class="muted">{{ t('detail.empty') }}</span>
          </div>
        </div>
        <div v-else class="placeholder">
          {{ t('terminal.sessionView.placeholder') }}
        </div>
      </section>
    </div>

    <footer class="sv-status">
      <span>{{ t('terminal.sessionView.legend') }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '@/stores/sessions';
import { useVirtualFs } from './fs';
import { buildCallbackUrl } from '@/utils/callback-url';
import { formatDate } from '@/utils/formatters';
import JsonViewer from '@/components/JsonViewer.vue';
import type { CallbackEntry } from '@/types';

const props = defineProps<{
  slug: string;
  /** Caller-provided arrival subscription (so the list updates live). */
  subscribe: (handler: (e: CallbackEntry) => void) => () => void;
  /** When set, that entry is pre-selected on mount (used by the
   *  arrival-link click in the shell). */
  initialEntryId?: string | null;
}>();

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const store = useSessionStore();
const fs = useVirtualFs();

const focusedIndex = ref(0);
const selectedIndex = ref<number | null>(null);
const urlCopied = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

const session = computed(() => fs.findSession(props.slug)?.session ?? null);
const url = computed(() =>
  session.value ? buildCallbackUrl(session.value.id) : '',
);

// Bind directly to the store's reactive `entries` so as soon as
// `tail`-style fan-out (or the GUI's own onCallback) saves a new
// entry, this list reflects it.
const entries = computed<CallbackEntry[]>(() => store.entries);

const selectedEntry = computed<CallbackEntry | null>(() =>
  selectedIndex.value === null
    ? null
    : entries.value[selectedIndex.value] ?? null,
);

const SKIP_HEADERS = new Set(['content-type', 'user-agent']);
const filteredHeaders = computed<Array<[string, string]>>(() => {
  const e = selectedEntry.value;
  if (!e) return [];
  return Object.entries(e.headers || {})
    .filter(([k]) => !SKIP_HEADERS.has(k.toLowerCase()))
    .map(([k, v]) => [k, String(v)]);
});

const queryEntries = computed<Array<[string, string]>>(() => {
  const e = selectedEntry.value;
  if (!e) return [];
  return Object.entries(e.query || {}).map(([k, v]) => [
    k,
    typeof v === 'string' ? v : JSON.stringify(v),
  ]);
});

function isObj(v: unknown): boolean {
  return v !== null && typeof v === 'object';
}
function formatPrim(v: unknown): string {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function move(delta: number): void {
  const total = entries.value.length;
  if (total === 0) return;
  focusedIndex.value = (focusedIndex.value + delta + total) % total;
  scrollIntoView();
}

function select(i: number): void {
  focusedIndex.value = i;
  selectedIndex.value = i;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown' || e.key === 'j') { move(1); e.preventDefault(); return; }
  if (e.key === 'ArrowUp' || e.key === 'k') { move(-1); e.preventDefault(); return; }
  if (e.key === 'Home') { focusedIndex.value = 0; scrollIntoView(); e.preventDefault(); return; }
  if (e.key === 'End') {
    focusedIndex.value = Math.max(0, entries.value.length - 1);
    scrollIntoView();
    e.preventDefault();
    return;
  }
  if (e.key === 'Enter') {
    select(focusedIndex.value);
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape' || e.key === 'q') { emit('close'); e.preventDefault(); return; }
  if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
    // Allow native copy from selection — don't preventDefault.
    return;
  }
}

async function scrollIntoView(): Promise<void> {
  await nextTick();
  const list = listRef.value;
  if (!list) return;
  const child = list.children[focusedIndex.value] as HTMLElement | undefined;
  if (child) child.scrollIntoView({ block: 'nearest' });
}

async function copyUrl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(url.value);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url.value;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  urlCopied.value = true;
  window.setTimeout(() => { urlCopied.value = false; }, 1500);
}

let unsubscribe: (() => void) | null = null;

onMounted(async () => {
  const fsess = fs.findSession(props.slug);
  if (!fsess) {
    emit('close');
    return;
  }
  // Activate the session so WS pushes events for it AND the store's
  // reactive `entries` array reflects what we want to show.
  await store.selectSession(fsess.session.id);

  if (props.initialEntryId) {
    // Pre-select the entry the user arrived from (e.g. clicking the
    // arrival callout in the shell). If we can't find it now (race
    // with WS arrival), the entries-length watcher below will retry.
    const i = entries.value.findIndex((e) => e.id === props.initialEntryId);
    if (i >= 0) {
      focusedIndex.value = i;
      selectedIndex.value = i;
    }
  } else if (entries.value.length > 0) {
    focusedIndex.value = 0;
  }
  unsubscribe = props.subscribe(() => {
    // The store handles the actual insertion; we just want the cursor
    // to stay anchored on the user's selected row, even as new rows
    // shift downward as `selectSession` returns newest-first.
    if (selectedEntry.value) {
      const newIdx = entries.value.findIndex(
        (e) => e.id === selectedEntry.value!.id,
      );
      if (newIdx >= 0) {
        selectedIndex.value = newIdx;
        focusedIndex.value = newIdx;
      }
    }
  });
  await nextTick();
  rootRef.value?.focus();
});

onBeforeUnmount(() => {
  unsubscribe?.();
});

watch(
  () => entries.value.length,
  (newLen, oldLen) => {
    // If the user requested an initial entry but it wasn't loaded
    // yet, retry now that more entries have arrived.
    if (
      props.initialEntryId &&
      selectedIndex.value === null &&
      newLen > oldLen
    ) {
      const i = entries.value.findIndex((e) => e.id === props.initialEntryId);
      if (i >= 0) {
        focusedIndex.value = i;
        selectedIndex.value = i;
        return;
      }
    }
    // If the user hasn't picked anything yet, follow the head (newest).
    if (selectedIndex.value === null && newLen > oldLen) {
      focusedIndex.value = 0;
    }
  },
);
</script>

<style scoped>
.sv {
  position: fixed;
  inset: 0;
  background: var(--tui-bg);
  color: var(--tui-fg);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  z-index: 600;
  outline: none;
}

.sv-titlebar {
  display: flex;
  align-items: baseline;
  gap: 18px;
  padding: 8px 18px;
  background: var(--tui-surface);
  border-bottom: 1px solid var(--tui-fg-dim);
}
.sv-titlebar .title {
  color: var(--tui-accent);
  font-weight: 700;
  flex: 1;
}
.sv-titlebar .meta { color: var(--tui-fg-dim); font-size: 11px; }
.sv-titlebar .meta .count { color: var(--tui-warn); }
.sv-titlebar .meta .dot { margin: 0 6px; }
.sv-titlebar .hint { color: var(--tui-fg-dim); font-size: 11px; }

.sv-url-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 18px;
  border-bottom: 1px dashed var(--tui-fg-dim);
  background: var(--tui-bg);
}
.sv-url-row .url-label {
  color: var(--tui-fg-dim);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.sv-url-row .url {
  flex: 1;
  color: var(--tui-prompt);
  word-break: break-all;
  font-family: var(--font-mono);
  background: transparent;
}
.sv-url-row .url-copy {
  background: transparent;
  color: var(--tui-fg);
  border: 1px solid var(--tui-fg-dim);
  border-radius: 3px;
  padding: 2px 8px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 12px;
}
.sv-url-row .url-copy:hover {
  color: var(--tui-accent);
  border-color: var(--tui-accent);
}

.sv-body {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(280px, 38%) 1fr;
  min-height: 0;
}
.sv-list {
  border-right: 1px solid var(--tui-fg-dim);
  overflow-y: auto;
  padding: 4px 0;
}
.sv-list .empty {
  padding: 14px 18px;
  color: var(--tui-fg-dim);
  font-style: italic;
}
.sv-list .item {
  display: grid;
  grid-template-columns: 2ch 7ch 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 3px 14px;
  cursor: pointer;
  border-bottom: 1px dashed transparent;
}
.sv-list .item:hover { background: var(--tui-sel-bg); }
.sv-list .item.focused {
  background: var(--tui-sel-bg);
  border-bottom-color: var(--tui-fg-dim);
}
.sv-list .item.selected {
  background: var(--tui-sel-bg);
  border-left: 2px solid var(--tui-accent);
  padding-left: 12px;
}
.sv-list .cursor { color: var(--tui-prompt); }
.sv-list .method {
  color: var(--tui-warn);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.sv-list .method[data-method="GET"] { color: var(--tui-ok); }
.sv-list .method[data-method="DELETE"] { color: var(--tui-err); }
.sv-list .path {
  color: var(--tui-accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.sv-list .ts {
  color: var(--tui-fg-dim);
  font-size: 11px;
  white-space: nowrap;
}

.sv-detail {
  overflow-y: auto;
  padding: 12px 18px;
}
.sv-detail .placeholder {
  color: var(--tui-fg-dim);
  font-style: italic;
  padding: 18px 0;
}
.detail-head {
  display: flex;
  gap: 12px;
  align-items: baseline;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--tui-fg-dim);
  margin-bottom: 10px;
}
.detail-head .badge {
  display: inline-block;
  padding: 2px 8px;
  border: 1px solid var(--tui-fg-dim);
  border-radius: 3px;
  font-size: 11px;
  letter-spacing: 0.05em;
  color: var(--tui-warn);
}
.detail-head .badge[data-method="GET"] { color: var(--tui-ok); border-color: var(--tui-ok); }
.detail-head .badge[data-method="DELETE"] { color: var(--tui-err); border-color: var(--tui-err); }
.detail-head .path {
  flex: 1;
  color: var(--tui-accent);
  word-break: break-all;
}
.detail-head .ts { color: var(--tui-fg-dim); font-size: 12px; }

.kv-block { margin-bottom: 14px; }
.block-title {
  color: var(--tui-fg-dim);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.kv {
  border-collapse: collapse;
  width: 100%;
}
.kv th, .kv td {
  text-align: left;
  vertical-align: top;
  font-weight: normal;
  padding: 1px 14px 1px 0;
  border: none;
  word-break: break-word;
}
.kv th {
  color: var(--tui-fg-dim);
  white-space: nowrap;
  width: 1%;
  padding-right: 18px;
}
.kv td { color: var(--tui-fg); }
.body-raw {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--tui-fg);
  font-family: var(--font-mono);
}
.muted { color: var(--tui-fg-dim); }

.sv-status {
  border-top: 1px solid var(--tui-fg-dim);
  padding: 4px 18px;
  font-size: 11px;
  background: var(--tui-surface);
  color: var(--tui-fg-dim);
}

@media (max-width: 720px) {
  .sv-body {
    grid-template-columns: 1fr;
    grid-template-rows: 40% 1fr;
  }
  .sv-list { border-right: none; border-bottom: 1px solid var(--tui-fg-dim); }
}
</style>
