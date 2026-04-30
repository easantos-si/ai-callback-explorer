<template>
  <ShareQrView
    v-if="shareToken"
    :token="shareToken"
    @close="closeShareView"
  />

  <LoginScreen v-else-if="auth.requiresLogin || auth.phase === 'loading'" />

  <TerminalView v-else-if="settings.viewMode === 'tui'" />

  <div v-else class="app-layout">
    <SessionSidebar @create-session="showCreateDialog = true" />

    <main class="main-content">
      <div v-if="!store.activeSession" class="empty-main">
        <EmptyState
          icon="📡"
          :title="t('panel.emptyTitle')"
          :subtitle="t('panel.emptySubtitle')"
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
      {{ ws.connected.value ? t('connection.connected') : t('connection.disconnected') }}
    </div>

    <div v-if="store.error" class="error-toast" @click="store.error = null">
      ⚠️ {{ store.error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '@/stores/sessions';
import { useSuperModeStore } from '@/stores/superMode';
import { useSettingsStore } from '@/stores/settings';
import { useAuthStore } from '@/stores/auth';
import { useWebSocket } from '@/composables/useWebSocket';
import SessionSidebar from '@/components/SessionSidebar.vue';
import SessionPanel from '@/components/SessionPanel.vue';
import CallbackDetail from '@/components/CallbackDetail.vue';
import CreateSessionDialog from '@/components/CreateSessionDialog.vue';
import EmptyState from '@/components/EmptyState.vue';
import LoginScreen from '@/components/LoginScreen.vue';
import ShareQrView from '@/components/ShareQrView.vue';
import TerminalView from '@/terminal/TerminalView.vue';
import type { Session } from '@/types';

const { t } = useI18n();
const store = useSessionStore();
const superMode = useSuperModeStore();
const settings = useSettingsStore();
const auth = useAuthStore();
const ws = useWebSocket();
const showCreateDialog = ref(false);

// Share-link landing — when the URL carries `?share=<token>`, render the
// QR-only view BEFORE either the login screen or the main app. Closing
// it (ESC or X) clears the query string so the URL resembles a normal
// visit and the standard login/auth flow takes over.
const shareToken = ref('');

function closeShareView(): void {
  shareToken.value = '';
  try {
    history.replaceState({}, '', window.location.pathname);
  } catch {
    // history may be unavailable in some sandboxed contexts; ignore.
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    t.isContentEditable
  );
}

function onGlobalKeydown(e: KeyboardEvent): void {
  if (e.repeat) return;
  if (isTypingTarget(e.target)) return;

  // Always-on shortcuts come before the dialog-open guard so the user
  // can ESC out of an entry detail / session even while the settings
  // popover or create dialog are closed but other modals would block.
  if (showCreateDialog.value) return;
  if (superMode.popoverOpen) return;

  // ---- ESC cascade: detail → session → no-op ----
  if (e.key === 'Escape') {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (store.selectedEntry) {
      store.selectEntry(null);
      e.preventDefault();
      return;
    }
    if (store.activeSessionId) {
      store.deselectSession();
      e.preventDefault();
      return;
    }
    return;
  }

  // ---- Arrow navigation ----
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const direction: -1 | 1 = e.key === 'ArrowDown' ? 1 : -1;
    if (store.activeSessionId) {
      store.moveEntryFocus(direction);
    } else {
      store.moveSessionFocus(direction);
    }
    e.preventDefault();
    return;
  }

  // ---- Enter activates the focused item ----
  if (e.key === 'Enter') {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (store.activeSessionId && store.focusedEntryId) {
      store.selectEntry(store.focusedEntryId);
      e.preventDefault();
      return;
    }
    if (!store.activeSessionId && store.focusedSessionId) {
      store.selectSession(store.focusedSessionId);
      e.preventDefault();
      return;
    }
    return;
  }

  // ---- Hidden 12-press 's' super-mode trigger ----
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (store.activeSessionId) return;
  if (e.key.length !== 1) return;
  superMode.notifyKey(e.key);
}

// Defer the WebSocket connection + global key listener + super-mode hydrate
// until the user is past the login gate (or auth is disabled at deploy
// time). The session/theme/locale IDB state is loaded earlier so the
// login screen renders in the saved theme.
let bootstrapped = false;

async function bootstrapMainApp(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  // Connect the WS and install the callback handler FIRST. Any
  // optional async work (super mode hydrate) runs in parallel
  // afterwards. We learned the hard way that awaiting hydrate before
  // ws.connect lets a slow / blocked IndexedDB swallow the entire
  // callback pipeline — and the operator sees nothing land in
  // either GUI or terminal.
  ws.connect();
  ws.onCallback(async (entry) => {
    try {
      await store.addEntry(entry);
    } catch (e) {
      console.warn('[App] addEntry failed:', e);
    }
  });

  // Side-loaded hydrate: fills in state but shouldn't gate the WS
  // pipeline. Errors are logged but not propagated.
  superMode.hydrate().catch((e) => console.warn('[App] superMode hydrate:', e));

  window.addEventListener('keydown', onGlobalKeydown);
}

onMounted(async () => {
  // Pick up `?share=<token>` first so a share-link visitor lands on the
  // QR view even before settings finish hydrating. The token format is
  // checked again on the backend — bogus values just produce 401.
  try {
    const params = new URLSearchParams(window.location.search);
    const tok = params.get('share');
    if (tok) shareToken.value = tok;
  } catch {
    // URLSearchParams is universally available; ignore if not.
  }

  // Open IndexedDB and pull theme/locale BEFORE rendering anything visible
  // so the login screen (and the main UI later) come up in the operator's
  // saved theme/language instead of flashing the defaults.
  await store.initialize();
  await settings.hydrate();

  // Seed the keyboard-nav cursor on the first session so the very first
  // ↑ / ↓ press is well-defined. selectSession() (called by
  // restoreActiveSession) already overrides this when applicable.
  if (!store.focusedSessionId && store.sessions.length > 0) {
    store.focusSession(store.sessions[0].id);
  }

  // Now decide whether to gate behind login or jump straight in.
  // We still load auth config when arriving via share link — the
  // ShareQrView sits on top, but everything underneath is ready as soon
  // as the visitor closes it.
  await auth.loadConfig();
  if (auth.isAuthenticated) {
    await bootstrapMainApp();
  }
});

watch(
  () => auth.isAuthenticated,
  (val) => {
    if (val) bootstrapMainApp();
  },
);

onBeforeUnmount(() => {
  ws.disconnect();
  window.removeEventListener('keydown', onGlobalKeydown);
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
  transition: background var(--transition), color var(--transition);
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
