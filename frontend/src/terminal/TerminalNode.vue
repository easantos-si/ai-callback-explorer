<template>
  <div class="tnode" :class="`tnode-${node.kind}`">
    <!-- JSON value: collapsible tree with TUI-tinted colours -->
    <template v-if="node.kind === 'json'">
      <JsonViewer :data="(node.data as unknown)" />
    </template>

    <!-- Key/value table (config, headers, …) -->
    <template v-else-if="node.kind === 'kv'">
      <table class="tnode-kv">
        <tbody>
          <tr v-for="row in (node.data as KvData).rows" :key="row.key">
            <th>{{ row.key }}</th>
            <td>{{ row.value }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- Single callback summary row (used by ls -l, head) -->
    <template v-else-if="node.kind === 'callback-row'">
      <div class="tnode-row">
        <span class="cell slug">{{ row.slug }}</span>
        <span class="cell ts">{{ row.ts }}</span>
        <span class="cell method" :data-method="row.method">{{ row.method }}</span>
        <span class="cell path">{{ row.path }}</span>
        <span class="cell ct">{{ row.contentType }}</span>
        <span class="cell preview">{{ row.preview }}</span>
      </div>
    </template>

    <!--
      Full structured block — used by tail / cat <session>/<entry>.
      Everything the GUI detail panel shows, fully expanded, no
      truncation, with separated info blocks.
    -->
    <template v-else-if="node.kind === 'callback-block'">
      <div class="tnode-block">
        <header class="block-head">
          <span class="badge" :data-method="block.method">{{ block.method }}</span>
          <span class="path">{{ block.path }}</span>
          <span class="ts">{{ block.ts }}</span>
        </header>
        <div class="block-section">
          <table class="tnode-kv">
            <tbody>
              <tr><th>id</th><td>{{ block.id }}</td></tr>
              <tr><th>content-type</th><td>{{ block.contentType }}</td></tr>
              <tr><th>ip</th><td>{{ block.ip }}</td></tr>
              <tr><th>user-agent</th><td>{{ block.userAgent }}</td></tr>
            </tbody>
          </table>
        </div>
        <div v-if="block.headers.length" class="block-section">
          <div class="section-title">headers</div>
          <table class="tnode-kv">
            <tbody>
              <tr v-for="[k, v] in block.headers" :key="k">
                <th>{{ k }}</th>
                <td>{{ v }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="block.query.length" class="block-section">
          <div class="section-title">query</div>
          <table class="tnode-kv">
            <tbody>
              <tr v-for="[k, v] in block.query" :key="k">
                <th>{{ k }}</th>
                <td>{{ v }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="block-section body-section">
          <div class="section-title">body</div>
          <JsonViewer
            v-if="isObject(block.body)"
            :data="block.body"
          />
          <pre v-else-if="block.body !== undefined && block.body !== null" class="body-raw">{{ formatPrim(block.body) }}</pre>
          <span v-else class="muted">(empty)</span>
        </div>
      </div>
    </template>

    <!-- Session row (ls -l of root) -->
    <template v-else-if="node.kind === 'session-row'">
      <div
        class="tnode-row"
        :class="{
          expired: sess.status === 'expired',
          orphaned: sess.status === 'orphaned',
        }"
      >
        <span class="cell count">{{ sess.count }}</span>
        <span class="cell ts">{{ sess.createdAt }}</span>
        <span class="cell slug">{{ sess.slug }}</span>
        <span class="cell label">
          {{ sess.label }}
          <span v-if="sess.status === 'expired'" class="status-tag expired-tag">[expired]</span>
          <span v-else-if="sess.status === 'orphaned'" class="status-tag orphaned-tag">[orphaned]</span>
        </span>
      </div>
    </template>

    <!-- Callback URL with copy button -->
    <template v-else-if="node.kind === 'callback-url'">
      <div class="tnode-url">
        <div v-if="urlNode.intro" class="intro">{{ urlNode.intro }}</div>
        <div class="url-row">
          <span class="url-label">URL</span>
          <code class="url" :title="urlNode.label">{{ urlNode.url }}</code>
          <button
            class="url-copy"
            :title="t('panel.copyUrl')"
            @click="copyUrl"
          >
            {{ copied ? '✓' : '⧉' }}
          </button>
        </div>
      </div>
    </template>

    <!-- help: grouped command grid -->
    <template v-else-if="node.kind === 'help-grid'">
      <div class="tnode-help">
        <header v-if="help.intro">{{ help.intro }}</header>
        <section
          v-for="(g, gi) in help.groups"
          :key="gi"
          class="group"
        >
          <h3 class="group-label">{{ g.label }}</h3>
          <div class="grid">
            <div
              v-for="c in g.commands"
              :key="c.name"
              class="cmd"
            >
              <span class="name">{{ c.name }}</span>
              <span class="dot">·</span>
              <span class="brief">{{ c.brief }}</span>
            </div>
          </div>
        </section>
        <footer v-if="help.shortcuts && help.shortcuts.length">
          <div class="title">{{ help.shortcutsTitle }}</div>
          <ul>
            <li v-for="(s, i) in help.shortcuts" :key="i">{{ s }}</li>
          </ul>
        </footer>
      </div>
    </template>

    <!-- man page -->
    <template v-else-if="node.kind === 'man-page'">
      <div class="tnode-man">
        <header>
          <span class="title">{{ man.title }}</span>
          <span class="brief">{{ man.brief }}</span>
        </header>
        <pre class="body">{{ man.full }}</pre>
      </div>
    </template>

    <!-- callout (info/warn/ok/error blocks) -->
    <template v-else-if="node.kind === 'callout'">
      <div class="tnode-callout" :data-tone="callout.tone">
        <span class="bullet">●</span>
        <span class="msg">{{ callout.message }}</span>
      </div>
    </template>

    <!-- Live-arrival link (clicking opens the SessionView at the entry) -->
    <template v-else-if="node.kind === 'arrival-link'">
      <button
        type="button"
        class="tnode-arrival"
        :data-method="arrival.method"
        @click="$emit('open-session', arrival.sessionSlug, arrival.entryId)"
      >
        <span class="bracket">[</span>
        <span class="method">{{ arrival.method }}</span>
        <span class="path">{{ arrival.path }}</span>
        <span class="bracket">]</span>
        <span v-if="arrival.ts" class="ts">{{ arrival.ts }}</span>
        <span class="action">↗ {{ t('terminal.arrivalOpen') }}</span>
      </button>
    </template>

    <!-- fastfetch-style banner -->
    <template v-else-if="node.kind === 'fetch-banner'">
      <div class="tnode-fetch">
        <span class="logo-icon">🔬</span>
        <table class="info">
          <tbody>
            <tr v-for="row in fetch.rows" :key="row.key">
              <th>{{ row.key }}</th>
              <td><span class="sep">:</span> {{ row.value }}</td>
            </tr>
          </tbody>
        </table>
        <ul v-if="fetch.tips?.length" class="tips">
          <li v-for="(tip, i) in fetch.tips" :key="i">{{ tip }}</li>
        </ul>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import JsonViewer from '@/components/JsonViewer.vue';
import type { RichNode } from './types';

const props = defineProps<{ node: RichNode }>();
defineEmits<{
  'open-session': [slug: string, entryId: string];
}>();
const { t } = useI18n();

interface KvData { rows: Array<{ key: string; value: string }>; }
interface RowData {
  slug: string;
  ts: string;
  method: string;
  path: string;
  contentType: string;
  preview: string;
}
interface BlockData {
  slug: string;
  method: string;
  path: string;
  ts: string;
  id: string;
  contentType: string;
  ip: string;
  userAgent: string;
  headers: Array<[string, string]>;
  query: Array<[string, string]>;
  body: unknown;
}
interface SessionRowData {
  count: number;
  createdAt: string;
  slug: string;
  label: string;
  status?: 'live' | 'expired' | 'orphaned' | 'unknown';
}
interface UrlData {
  label: string;
  url: string;
  intro?: string;
}
interface HelpData {
  intro: string;
  shortcutsTitle: string;
  groups: Array<{
    label: string;
    commands: Array<{ name: string; brief: string }>;
  }>;
  shortcuts: string[];
}
interface ManData { title: string; brief: string; full: string }
interface CalloutData {
  tone: 'info' | 'ok' | 'warn' | 'err';
  message: string;
}
interface ArrivalData {
  method: string;
  path: string;
  sessionSlug: string;
  entryId: string;
  ts?: string;
}
interface FetchBannerData {
  rows: Array<{ key: string; value: string }>;
  tips?: string[];
}

const row = computed(() => props.node.data as RowData);
const block = computed(() => props.node.data as BlockData);
const sess = computed(() => props.node.data as SessionRowData);
const urlNode = computed(() => props.node.data as UrlData);
const help = computed(() => props.node.data as HelpData);
const man = computed(() => props.node.data as ManData);
const callout = computed(() => props.node.data as CalloutData);
const arrival = computed(() => props.node.data as ArrivalData);
const fetch = computed(() => props.node.data as FetchBannerData);

const copied = ref(false);

async function copyUrl(): Promise<void> {
  const text = urlNode.value.url;
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
  copied.value = true;
  window.setTimeout(() => { copied.value = false; }, 1500);
}

function isObject(v: unknown): boolean {
  return v !== null && typeof v === 'object';
}
function formatPrim(v: unknown): string {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}
</script>

<style scoped>
.tnode {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  color: var(--tui-fg);
}

/* ---- KV table ---------------------------------------------------- */
.tnode-kv {
  border-collapse: collapse;
  width: 100%;
  table-layout: auto;
}
.tnode-kv th,
.tnode-kv td {
  padding: 1px 14px 1px 0;
  text-align: left;
  vertical-align: top;
  font-weight: normal;
  border: none;
  word-break: break-word;
}
.tnode-kv th {
  color: var(--tui-fg-dim);
  padding-right: 18px;
  white-space: nowrap;
  width: 1%;
}
.tnode-kv td { color: var(--tui-fg); }

/* ---- callback row & session row --------------------------------- */
.tnode-row {
  display: grid;
  gap: 12px;
  padding: 1px 0;
  border-bottom: 1px dashed transparent;
}
.tnode-callback-row .tnode-row {
  grid-template-columns: 8ch 17ch 7ch minmax(14ch, 24ch) minmax(10ch, 22ch) 1fr;
}
.tnode-session-row .tnode-row {
  /* count | full timestamp (DD/MM/YYYY:HH:MM:SS = 19ch) | slug | label */
  grid-template-columns: 6ch 22ch 18ch 1fr;
}
.tnode-row:hover {
  background: var(--tui-sel-bg);
  border-bottom-color: var(--tui-fg-dim);
}
.tnode-row .cell {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tnode-row .slug { color: var(--tui-prompt); }
.tnode-row .ts { color: var(--tui-fg-dim); }
.tnode-row .method {
  color: var(--tui-warn);
  font-weight: 600;
}
.tnode-row .method[data-method="GET"] { color: var(--tui-ok); }
.tnode-row .method[data-method="DELETE"] { color: var(--tui-err); }
.tnode-row .path { color: var(--tui-accent); }
.tnode-row .ct { color: var(--tui-fg-dim); }
.tnode-row .preview {
  color: var(--tui-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.tnode-row .count {
  color: var(--tui-warn);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.tnode-row .label { color: var(--tui-accent); }

/* Expired (TTL elapsed): muted + struck-through, error-toned tag. */
.tnode-row.expired .slug,
.tnode-row.expired .label,
.tnode-row.expired .count {
  color: var(--tui-fg-dim);
}
.tnode-row.expired .slug { text-decoration: line-through; }

/* Orphaned (server's in-memory map was wiped): TTL HASN'T elapsed,
   but the backend doesn't know the session anymore. Use the warn
   tone — it's recoverable by re-creating, not an end-of-life state. */
.tnode-row.orphaned .slug,
.tnode-row.orphaned .count {
  color: var(--tui-fg-dim);
}
.tnode-row.orphaned .label { color: var(--tui-warn); }

.tnode-row .status-tag {
  display: inline-block;
  margin-left: 8px;
  padding: 0 6px;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-radius: 3px;
  white-space: nowrap;
}
.tnode-row .expired-tag {
  color: var(--tui-err);
  border: 1px solid var(--tui-err);
}
.tnode-row .orphaned-tag {
  color: var(--tui-warn);
  border: 1px solid var(--tui-warn);
}

/* ---- callback block (tail / cat) -------------------------------- */
.tnode-block {
  border-left: 2px solid var(--tui-fg-dim);
  padding: 6px 12px;
  margin: 8px 0;
  background: var(--tui-surface);
  width: 100%;
  box-sizing: border-box;
}
.tnode-block .block-head {
  display: flex;
  gap: 12px;
  align-items: baseline;
  flex-wrap: wrap;
  padding-bottom: 6px;
  margin-bottom: 6px;
  border-bottom: 1px dashed var(--tui-fg-dim);
}
.tnode-block .badge {
  display: inline-block;
  padding: 1px 8px;
  border: 1px solid var(--tui-fg-dim);
  border-radius: 3px;
  font-size: 11px;
  letter-spacing: 0.05em;
  color: var(--tui-warn);
}
.tnode-block .badge[data-method="GET"] { color: var(--tui-ok); border-color: var(--tui-ok); }
.tnode-block .badge[data-method="DELETE"] { color: var(--tui-err); border-color: var(--tui-err); }
.tnode-block .path {
  flex: 1;
  color: var(--tui-accent);
  word-break: break-all;
  min-width: 0;
}
.tnode-block .ts {
  color: var(--tui-fg-dim);
  font-size: 12px;
}
.tnode-block .block-section { margin-bottom: 8px; }
.tnode-block .block-section:last-child { margin-bottom: 0; }
.tnode-block .section-title {
  color: var(--tui-fg-dim);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 4px 0 2px;
}
.tnode-block .body-raw {
  margin: 0;
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--tui-fg);
}
.tnode-block .muted { color: var(--tui-fg-dim); }

/* ---- callback URL with copy ------------------------------------- */
.tnode-url { margin: 4px 0 8px; }
.tnode-url .intro {
  color: var(--tui-fg-dim);
  font-size: 12px;
  margin-bottom: 4px;
}
.tnode-url .url-row {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--tui-fg-dim);
  border-radius: 3px;
  padding: 5px 10px;
  background: var(--tui-surface);
}
.tnode-url .url-label {
  color: var(--tui-fg-dim);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.tnode-url .url {
  flex: 1;
  color: var(--tui-prompt);
  background: transparent;
  word-break: break-all;
  font-family: var(--font-mono);
  min-width: 0;
}
.tnode-url .url-copy {
  background: transparent;
  color: var(--tui-fg);
  border: 1px solid var(--tui-fg-dim);
  border-radius: 3px;
  padding: 2px 8px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 12px;
  flex-shrink: 0;
}
.tnode-url .url-copy:hover {
  color: var(--tui-accent);
  border-color: var(--tui-accent);
}

/* ---- help ------------------------------------------------------- */
.tnode-help {
  margin: 2px 0 6px;
}
.tnode-help > header {
  color: var(--tui-fg-dim);
  margin-bottom: 12px;
}
.tnode-help .group { margin: 0 0 12px; }
.tnode-help .group-label {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--tui-warn);
  border-bottom: 1px dashed var(--tui-fg-dim);
  padding-bottom: 2px;
}
.tnode-help .grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1px 24px;
  padding: 4px 0 0;
}
.tnode-help .cmd {
  display: grid;
  grid-template-columns: 11ch 1ch 1fr;
  gap: 6px;
  align-items: baseline;
  padding: 1px 0;
}
.tnode-help .cmd:hover {
  background: var(--tui-sel-bg);
}
.tnode-help .name {
  color: var(--tui-prompt);
  font-weight: 600;
  font-family: var(--font-mono);
}
.tnode-help .dot { color: var(--tui-fg-dim); }
.tnode-help .brief {
  color: var(--tui-fg);
  word-break: break-word;
}
.tnode-help footer {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--tui-fg-dim);
}
.tnode-help footer .title {
  color: var(--tui-fg-dim);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.tnode-help footer ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1px 24px;
}
.tnode-help footer li {
  color: var(--tui-fg-dim);
  font-size: 11px;
}
.tnode-help footer li::before {
  content: '› ';
  color: var(--tui-fg-dim);
}

/* ---- man -------------------------------------------------------- */
.tnode-man { margin: 4px 0; }
.tnode-man header {
  display: flex;
  align-items: baseline;
  gap: 14px;
  border-bottom: 1px solid var(--tui-fg-dim);
  padding-bottom: 4px;
  margin-bottom: 6px;
}
.tnode-man .title {
  color: var(--tui-accent);
  font-weight: 700;
  letter-spacing: 0.06em;
}
.tnode-man .brief { color: var(--tui-fg-dim); }
.tnode-man .body {
  margin: 0;
  font-family: var(--font-mono);
  color: var(--tui-fg);
  white-space: pre-wrap;
}

/* ---- callout ---------------------------------------------------- */
.tnode-callout {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 2px 10px;
  border-left: 2px solid var(--tui-fg-dim);
  margin: 2px 0;
}
.tnode-callout[data-tone="ok"] { border-left-color: var(--tui-ok); }
.tnode-callout[data-tone="warn"] { border-left-color: var(--tui-warn); }
.tnode-callout[data-tone="err"] { border-left-color: var(--tui-err); }
.tnode-callout .bullet { color: var(--tui-fg-dim); }
.tnode-callout[data-tone="ok"] .bullet { color: var(--tui-ok); }
.tnode-callout[data-tone="warn"] .bullet { color: var(--tui-warn); }
.tnode-callout[data-tone="err"] .bullet { color: var(--tui-err); }
.tnode-callout .msg { color: var(--tui-fg); }

/* ---- arrival link --------------------------------------------- */
.tnode-arrival {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: 1px dashed var(--tui-fg-dim);
  border-radius: 3px;
  padding: 2px 10px;
  margin: 1px 0;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--tui-fg);
  transition: background 0.1s, border-color 0.1s;
}
.tnode-arrival:hover {
  background: var(--tui-sel-bg);
  border-color: var(--tui-accent);
  border-style: solid;
}
.tnode-arrival .bracket { color: var(--tui-fg-dim); }
.tnode-arrival .method {
  color: var(--tui-warn);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.tnode-arrival[data-method="GET"] .method { color: var(--tui-ok); }
.tnode-arrival[data-method="DELETE"] .method { color: var(--tui-err); }
.tnode-arrival .path {
  color: var(--tui-accent);
  word-break: break-all;
}
.tnode-arrival .ts {
  color: var(--tui-fg-dim);
  font-size: 11px;
  margin-left: 6px;
}
.tnode-arrival .action {
  color: var(--tui-fg-dim);
  font-size: 11px;
  opacity: 0;
  transition: opacity 0.1s;
}
.tnode-arrival:hover .action { opacity: 1; color: var(--tui-prompt); }

/* ---- fastfetch banner ----------------------------------------- */
.tnode-fetch {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 24px 32px;
  padding: 8px 0 12px;
  align-items: center;
}
.tnode-fetch .logo-icon {
  /*
   * Plain glyph, fastfetch-style: no frame, no shadow, no fill —
   * just a big emoji to anchor the info table on its right.
   */
  display: inline-block;
  font-size: 9rem;
  line-height: 1;
  text-align: center;
  padding: 0 8px;
  user-select: none;
}
.tnode-fetch .info {
  border-collapse: collapse;
  font-family: var(--font-mono);
}
.tnode-fetch .info th,
.tnode-fetch .info td {
  text-align: left;
  vertical-align: top;
  font-weight: normal;
  padding: 1px 0;
  border: none;
}
.tnode-fetch .info th {
  color: var(--tui-warn);
  padding-right: 8px;
  white-space: nowrap;
  width: 1%;
}
.tnode-fetch .info td {
  color: var(--tui-fg);
  word-break: break-word;
}
.tnode-fetch .info .sep { color: var(--tui-fg-dim); margin-right: 4px; }
.tnode-fetch .tips {
  grid-column: 1 / -1;
  margin: 6px 0 0;
  padding: 6px 0 0;
  border-top: 1px dashed var(--tui-fg-dim);
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 2px 18px;
}
.tnode-fetch .tips li {
  color: var(--tui-fg-dim);
  font-size: 11px;
}
.tnode-fetch .tips li::before { content: '› '; color: var(--tui-fg-dim); }

@media (max-width: 720px) {
  .tnode-fetch { grid-template-columns: 1fr; }
}
</style>
