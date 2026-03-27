<template>
  <div class="detail">
    <header class="detail-header">
      <div class="detail-title-row">
        <span
          class="method-badge"
          :style="{ background: getMethodColor(entry.method) }"
        >
          {{ entry.method }}
        </span>
        <h3 class="detail-title">Callback Detail</h3>
      </div>
      <button class="btn-close" @click="$emit('close')">✕</button>
    </header>

    <div class="detail-body">
      <!-- Meta -->
      <section class="detail-section">
        <h4 class="section-title">📋 Informações</h4>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">ID</span>
            <code class="info-value">{{ entry.id }}</code>
          </div>
          <div class="info-item">
            <span class="info-label">Recebido</span>
            <span class="info-value">{{
              formatDate(entry.receivedAt)
            }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Content-Type</span>
            <code class="info-value">{{ entry.contentType }}</code>
          </div>
          <div class="info-item">
            <span class="info-label">IP Origem</span>
            <code class="info-value">{{ entry.ip }}</code>
          </div>
          <div class="info-item full-width">
            <span class="info-label">Path</span>
            <code class="info-value">{{ entry.path }}</code>
          </div>
          <div class="info-item full-width">
            <span class="info-label">User-Agent</span>
            <code class="info-value small">{{ entry.userAgent }}</code>
          </div>
        </div>
      </section>

      <!-- Headers -->
      <section
        v-if="headerEntries.length > 0"
        class="detail-section"
      >
        <div
          class="section-header clickable"
          @click="showHeaders = !showHeaders"
        >
          <h4 class="section-title-inline">🏷️ Headers</h4>
          <span class="section-toggle">{{
            showHeaders ? '▲' : '▼'
          }}</span>
        </div>
        <div v-if="showHeaders" class="headers-table">
          <div
            v-for="[key, value] in headerEntries"
            :key="key"
            class="header-row"
          >
            <span class="header-key">{{ key }}</span>
            <span class="header-value">{{ value }}</span>
          </div>
        </div>
      </section>

      <!-- Query -->
      <section
        v-if="hasQuery"
        class="detail-section"
      >
        <div
          class="section-header clickable"
          @click="showQuery = !showQuery"
        >
          <h4 class="section-title-inline">❓ Query Parameters</h4>
          <span class="section-toggle">{{
            showQuery ? '▲' : '▼'
          }}</span>
        </div>
        <div v-if="showQuery" class="code-block">
          <JsonViewer :data="entry.query" />
        </div>
      </section>

      <!-- Body -->
      <section class="detail-section">
        <div class="section-header">
          <h4 class="section-title-inline">📦 Body</h4>
          <div class="section-actions">
            <button
              class="btn-action"
              :title="bodyCopied ? 'Copiado!' : 'Copiar'"
              @click="copyBody"
            >
              {{ bodyCopied ? '✓' : '📋' }}
            </button>
            <button class="btn-action" @click="showRawBody = !showRawBody">
              {{ showRawBody ? 'Tree' : 'Raw' }}
            </button>
          </div>
        </div>
        <div class="body-content">
          <div v-if="entry.body === null || entry.body === undefined" class="empty-body">
            (empty)
          </div>
          <template v-else>
            <pre v-if="showRawBody" class="code-block raw">{{
              rawBodyStr
            }}</pre>
            <div v-else class="code-block">
              <JsonViewer :data="entry.body" />
            </div>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { CallbackEntry } from '@/types';
import { formatDate, getMethodColor } from '@/utils/formatters';
import JsonViewer from './JsonViewer.vue';

const props = defineProps<{
  entry: CallbackEntry;
}>();

defineEmits<{
  close: [];
}>();

const showHeaders = ref(false);
const showQuery = ref(true);
const showRawBody = ref(false);
const bodyCopied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const headerEntries = computed((): [string, string][] =>
  Object.entries(props.entry.headers || {}),
);

const hasQuery = computed(
  (): boolean =>
    !!props.entry.query && Object.keys(props.entry.query).length > 0,
);

const rawBodyStr = computed((): string => {
  const b = props.entry.body;
  if (b === null || b === undefined) return '';
  try {
    return typeof b === 'string' ? b : JSON.stringify(b, null, 2);
  } catch {
    return String(b);
  }
});

async function copyBody(): Promise<void> {
  try {
    await navigator.clipboard.writeText(rawBodyStr.value);
  } catch {
    // Silent fallback
  }
  if (copyTimer) clearTimeout(copyTimer);
  bodyCopied.value = true;
  copyTimer = setTimeout(() => {
    bodyCopied.value = false;
  }, 2000);
}
</script>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.detail-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.method-badge {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  color: white;
  padding: 3px 8px;
  border-radius: 4px;
}

.detail-title {
  font-size: 15px;
  font-weight: 700;
}

.btn-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
  transition: color var(--transition);
}

.btn-close:hover {
  color: var(--text-primary);
}

.detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.detail-section {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
}

.section-header.clickable {
  cursor: pointer;
  transition: background var(--transition);
}

.section-header.clickable:hover {
  background: var(--bg-hover);
}

.section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 12px 16px 8px;
}

.section-title-inline {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
  padding: 0;
}

.section-toggle {
  font-size: 10px;
  color: var(--text-muted);
}

.section-actions {
  display: flex;
  gap: 4px;
}

.btn-action {
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition);
}

.btn-action:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--border-color);
  margin: 0 1px 1px;
}

.info-item {
  background: var(--bg-tertiary);
  padding: 10px 16px;
}

.info-item.full-width {
  grid-column: 1 / -1;
}

.info-label {
  display: block;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.info-value {
  font-size: 12px;
  color: var(--text-primary);
  word-break: break-all;
}

.info-value.small {
  font-size: 10px;
  color: var(--text-secondary);
}

code.info-value {
  font-family: var(--font-mono);
  font-size: 11px;
}

.headers-table {
  border-top: 1px solid var(--border-color);
}

.header-row {
  display: flex;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-color);
  font-size: 11px;
}

.header-row:last-child {
  border-bottom: none;
}

.header-key {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--accent);
  min-width: 140px;
  flex-shrink: 0;
}

.header-value {
  font-family: var(--font-mono);
  color: var(--text-secondary);
  word-break: break-all;
}

.code-block {
  padding: 16px;
  border-top: 1px solid var(--border-color);
  overflow-x: auto;
}

.code-block.raw {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  background: transparent;
  border: none;
  border-top: 1px solid var(--border-color);
}

.body-content {
  min-height: 60px;
}

.empty-body {
  padding: 20px 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  font-style: italic;
}
</style>
