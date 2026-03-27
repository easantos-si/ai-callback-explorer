<template>
  <div class="app-layout">
    <SessionSidebar @create-session="showCreateDialog = true" />

    <main class="main-content">
      <div v-if="!store.activeSession" class="empty-main">
        <EmptyState
          icon="📡"
          title="AI Callback Explorer"
          subtitle="Crie uma sessão para começar a receber callbacks da API"
        />
      </div>
      <SessionPanel v-else />
    </main>

    <aside v-if="store.selectedEntry" class="detail-panel">
      <CallbackDetail
        :entry="store.selectedEntry"
        @close="store.selectEntry(null)"
      />
    </aside>

    <CreateSessionDialog
      v-if="showCreateDialog"
      @close="showCreateDialog = false"
      @created="onSessionCreated"
    />

    <div
      class="connection-indicator"
      :class="{ connected: ws.connected.value }"
    >
      <span class="dot" />
      {{ ws.connected.value ? 'Conectado' : 'Desconectado' }}
    </div>

    <div v-if="store.error" class="error-toast" @click="store.error = null">
      ⚠️ {{ store.error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, onBeforeUnmount } from 'vue';
import { useSessionStore } from '@/stores/sessions';
import { useWebSocket } from '@/composables/useWebSocket';
import SessionSidebar from '@/components/SessionSidebar.vue';
import SessionPanel from '@/components/SessionPanel.vue';
import CallbackDetail from '@/components/CallbackDetail.vue';
import CreateSessionDialog from '@/components/CreateSessionDialog.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { Session } from '@/types';

const store = useSessionStore();
const ws = useWebSocket();
const showCreateDialog = ref(false);

onMounted(async () => {
  await store.initialize();
  ws.connect();

  ws.onCallback(async (entry) => {
    await store.addEntry(entry);
  });
});

onBeforeUnmount(() => {
  ws.disconnect();
});

watch(
  () => store.activeSessionId,
  (newId) => {
    if (newId) {
      ws.joinSession(newId);
    } else {
      ws.leaveSession();
    }
  },
);

function onSessionCreated(session: Session) {
  showCreateDialog.value = false;
  store.selectSession(session.id);
}
</script>

<style>
*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --bg-primary: #0f1117;
  --bg-secondary: #161822;
  --bg-tertiary: #1c1f2e;
  --bg-hover: #252838;
  --bg-active: #2a2d42;
  --border-color: #2a2d3e;
  --border-light: #363952;
  --text-primary: #e4e6f0;
  --text-secondary: #8b8fa7;
  --text-muted: #5c6078;
  --accent: #6c5ce7;
  --accent-hover: #7c6ef7;
  --accent-glow: rgba(108, 92, 231, 0.2);
  --success: #00d68f;
  --warning: #ffaa00;
  --danger: #ff3d71;
  --info: #0095ff;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
  --transition: 0.2s ease;
  --sidebar-width: 320px;
  --detail-width: 520px;
  --font-mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', 'Cascadia Code',
    monospace;
}

html,
body {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
}

#app {
  height: 100%;
}

.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.empty-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.detail-panel {
  width: var(--detail-width);
  border-left: 1px solid var(--border-color);
  background: var(--bg-secondary);
  overflow: hidden;
  flex-shrink: 0;
}

.connection-indicator {
  position: fixed;
  bottom: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  font-size: 11px;
  color: var(--text-muted);
  z-index: 100;
  transition: all var(--transition);
  user-select: none;
}

.connection-indicator.connected {
  color: var(--success);
  border-color: rgba(0, 214, 143, 0.3);
}

.connection-indicator .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--danger);
  transition: background var(--transition);
}

.connection-indicator.connected .dot {
  background: var(--success);
  box-shadow: 0 0 8px rgba(0, 214, 143, 0.5);
}

.error-toast {
  position: fixed;
  bottom: 52px;
  right: 16px;
  padding: 10px 18px;
  background: rgba(255, 61, 113, 0.15);
  border: 1px solid var(--danger);
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-size: 12px;
  cursor: pointer;
  z-index: 100;
  max-width: 400px;
}

::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--border-light);
}

@media (max-width: 1200px) {
  .detail-panel {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 50;
    box-shadow: -8px 0 30px rgba(0, 0, 0, 0.4);
  }
}

@media (max-width: 768px) {
  :root {
    --sidebar-width: 260px;
    --detail-width: 100%;
  }
}
</style>
