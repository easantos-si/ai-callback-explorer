<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="logo">
        <span class="logo-icon">🔬</span>
        <div>
          <h1 class="logo-title">Callback Explorer</h1>
          <p class="logo-subtitle">AI API Inspector</p>
        </div>
      </div>
      <button
        class="btn-create"
        title="Nova sessão"
        @click="$emit('create-session')"
      >
        <span>+</span>
      </button>
    </div>

    <div class="sidebar-search">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Buscar sessão..."
        class="search-input"
      />
    </div>

    <div class="session-list">
      <div v-if="filteredSessions.length === 0" class="no-sessions">
        <p>
          {{
            store.sessions.length === 0
              ? 'Nenhuma sessão criada'
              : 'Nenhum resultado'
          }}
        </p>
      </div>

      <div
        v-for="session in filteredSessions"
        :key="session.id"
        class="session-item"
        :class="{ active: store.activeSessionId === session.id }"
        @click="store.selectSession(session.id)"
      >
        <div class="session-item-header">
          <span class="session-label">{{ session.label }}</span>
          <span v-if="session.entryCount > 0" class="session-badge">
            {{ session.entryCount }}
          </span>
        </div>
        <div class="session-item-meta">
          <span class="session-date">{{
            formatDateShort(session.createdAt)
          }}</span>
          <button
            class="btn-delete-session"
            title="Remover sessão"
            @click.stop="confirmDelete(session.id)"
          >
            ✕
          </button>
        </div>
        <div
          class="session-url"
          @click.stop="copyUrl(session)"
        >
          <code>{{ truncateUrl(session.callbackUrl) }}</code>
          <span class="copy-hint">{{
            copiedId === session.id ? '✓' : '📋'
          }}</span>
        </div>
      </div>
    </div>

    <div v-if="store.sessions.length > 0" class="sidebar-footer">
      <button class="btn-clear-all" @click="confirmClearAll">
        🗑 Limpar tudo
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSessionStore } from '@/stores/sessions';
import { formatDateShort } from '@/utils/formatters';
import type { Session } from '@/types';

defineEmits<{
  'create-session': [];
}>();

const store = useSessionStore();
const searchQuery = ref('');
const copiedId = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const filteredSessions = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  if (!q) return store.sessions;
  return store.sessions.filter(
    (s) =>
      s.label.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
  );
});

function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname;
    return path.length > 40 ? '...' + path.slice(-37) : path;
  } catch {
    return url.length > 40 ? '...' + url.slice(-37) : url;
  }
}

async function copyUrl(session: Session): Promise<void> {
  try {
    await navigator.clipboard.writeText(session.callbackUrl);
  } catch {
    // Fallback for non-HTTPS contexts
    const ta = document.createElement('textarea');
    ta.value = session.callbackUrl;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  if (copiedTimer) clearTimeout(copiedTimer);
  copiedId.value = session.id;
  copiedTimer = setTimeout(() => {
    copiedId.value = null;
  }, 2000);
}

function confirmDelete(sessionId: string): void {
  if (
    confirm(
      'Tem certeza que deseja remover esta sessão e todos os seus callbacks?',
    )
  ) {
    store.deleteSessionById(sessionId);
  }
}

function confirmClearAll(): void {
  if (
    confirm('Tem certeza que deseja remover TODAS as sessões e dados?')
  ) {
    store.clearAll();
  }
}
</script>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 16px 12px;
  border-bottom: 1px solid var(--border-color);
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-icon {
  font-size: 28px;
}

.logo-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.logo-subtitle {
  font-size: 11px;
  color: var(--text-muted);
}

.btn-create {
  width: 34px;
  height: 34px;
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent);
  border-radius: var(--radius-sm);
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition);
  line-height: 1;
}

.btn-create:hover {
  background: var(--accent);
  color: white;
}

.sidebar-search {
  padding: 12px 16px;
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color var(--transition);
}

.search-input:focus {
  border-color: var(--accent);
}

.search-input::placeholder {
  color: var(--text-muted);
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
}

.no-sessions {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.session-item {
  padding: 12px;
  margin-bottom: 4px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition);
  border: 1px solid transparent;
}

.session-item:hover {
  background: var(--bg-hover);
}

.session-item.active {
  background: var(--bg-active);
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-glow);
}

.session-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.session-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  margin-right: 8px;
}

.session-badge {
  background: var(--accent);
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
  min-width: 20px;
  text-align: center;
}

.session-item-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.session-date {
  font-size: 11px;
  color: var(--text-muted);
}

.btn-delete-session {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 3px;
  opacity: 0;
  transition: all var(--transition);
}

.session-item:hover .btn-delete-session {
  opacity: 1;
}

.btn-delete-session:hover {
  color: var(--danger);
  background: rgba(255, 61, 113, 0.1);
}

.session-url {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 8px;
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition);
}

.session-url:hover {
  background: var(--bg-tertiary);
}

.session-url code {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.copy-hint {
  font-size: 11px;
  flex-shrink: 0;
  color: var(--text-muted);
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
}

.btn-clear-all {
  width: 100%;
  padding: 8px;
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition);
}

.btn-clear-all:hover {
  border-color: var(--danger);
  color: var(--danger);
  background: rgba(255, 61, 113, 0.05);
}
</style>
