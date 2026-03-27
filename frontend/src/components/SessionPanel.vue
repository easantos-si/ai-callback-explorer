<template>
  <div class="session-panel">
    <header class="panel-header">
      <div class="header-info">
        <h2 class="panel-title">{{ store.activeSession?.label }}</h2>
        <div class="header-meta">
          <span class="meta-item">
            📡 {{ store.entries.length }} callback{{
              store.entries.length !== 1 ? 's' : ''
            }}
          </span>
          <span class="meta-divider">·</span>
          <span
            class="meta-item callback-url"
            title="Clique para copiar"
            @click="copyCallbackUrl"
          >
            🔗 {{ copied ? 'Copiado!' : 'Copiar URL' }}
          </span>
        </div>
      </div>
    </header>

    <div v-if="store.entries.length === 0" class="empty-entries">
      <EmptyState
        icon="⏳"
        title="Aguardando callbacks..."
        :subtitle="`Use a URL abaixo como callback_url na AI API`"
      />
      <div class="url-display" @click="copyCallbackUrl">
        <code>{{ store.activeSession?.callbackUrl }}</code>
        <span class="copy-icon">{{ copied ? '✓' : '📋' }}</span>
      </div>
    </div>

    <div v-else class="entries-list">
      <CallbackEntry
        v-for="entry in store.entries"
        :key="entry.id"
        :entry="entry"
        :selected="store.selectedEntryId === entry.id"
        @click="store.selectEntry(entry.id)"
        @delete="store.deleteEntryById(entry.id)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useSessionStore } from '@/stores/sessions';
import CallbackEntry from './CallbackEntry.vue';
import EmptyState from './EmptyState.vue';

const store = useSessionStore();
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

async function copyCallbackUrl(): Promise<void> {
  const url = store.activeSession?.callbackUrl;
  if (!url) return;

  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  if (copiedTimer) clearTimeout(copiedTimer);
  copied.value = true;
  copiedTimer = setTimeout(() => {
    copied.value = false;
  }, 2000);
}
</script>

<style scoped>
.session-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.panel-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.header-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.panel-title {
  font-size: 18px;
  font-weight: 700;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.meta-divider {
  color: var(--border-light);
}

.callback-url {
  cursor: pointer;
  transition: color var(--transition);
}

.callback-url:hover {
  color: var(--accent);
}

.empty-entries {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 40px;
}

.url-display {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition);
  max-width: 100%;
}

.url-display:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.url-display code {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.copy-icon {
  flex-shrink: 0;
  font-size: 14px;
}

.entries-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
