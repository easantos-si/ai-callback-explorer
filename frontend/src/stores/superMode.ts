import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useIndexedDB } from '@/composables/useIndexedDB';
import { useAuthStore } from '@/stores/auth';

const TRIGGER_KEY = 's';
const REQUIRED_PRESSES = 12;
const PRESS_WINDOW_MS = 5_000;

const KEY_UNLOCKED = 'super.unlocked';

export const useSuperModeStore = defineStore('superMode', () => {
  const db = useIndexedDB();
  const auth = useAuthStore();

  const unlocked = ref(false);
  const adminToken = ref('');
  const count = ref(0);
  const lastPressAt = ref(0);
  const hydrated = ref(false);
  // Tracked by SettingsMenu so the global key gate can ignore presses
  // while the popover is open.
  const popoverOpen = ref(false);
  // One-shot bump emitted only when the 12-press sequence actually unlocks
  // the mode. Distinguishes a fresh activation from a hydration restoring
  // a previously-unlocked state on page load.
  const activationTick = ref(0);

  async function hydrate(): Promise<void> {
    try {
      // If filtering is off at the server, drop any stale persisted state
      // so a previously-unlocked operator doesn't see a Super badge that
      // can never authenticate. Re-enabling filtering re-arms the gate.
      if (!auth.originFilteringEnabled) {
        await db.deleteSetting(KEY_UNLOCKED).catch(() => {});
        unlocked.value = false;
        adminToken.value = '';
        hydrated.value = true;
        return;
      }
      const u = await db.getSetting<boolean>(KEY_UNLOCKED);
      if (u) unlocked.value = true;
      // adminToken is intentionally NOT hydrated from IndexedDB — it
      // lives only in memory, so a page reload (or a different browser
      // tab on a shared machine) requires the operator to re-enter it.
    } catch (e) {
      console.warn('Failed to hydrate super mode:', e);
    } finally {
      hydrated.value = true;
    }
  }

  function notifyKey(key: string): boolean {
    // Refuse to count anything when origin filtering is off — Super Mode
    // is a no-op in that mode by design.
    if (!auth.originFilteringEnabled) {
      count.value = 0;
      return false;
    }

    if (key.toLowerCase() !== TRIGGER_KEY) {
      count.value = 0;
      return false;
    }

    const now = Date.now();
    if (now - lastPressAt.value > PRESS_WINDOW_MS) {
      count.value = 1;
    } else {
      count.value += 1;
    }
    lastPressAt.value = now;

    if (count.value >= REQUIRED_PRESSES && !unlocked.value) {
      unlocked.value = true;
      count.value = 0;
      activationTick.value++;
      db.setSetting(KEY_UNLOCKED, true).catch(() => {});
      return true;
    }
    return false;
  }

  function setAdminToken(token: string): void {
    // In-memory only. Persisting the admin token to IndexedDB would let
    // any later XSS, browser extension, or shared-machine snoop read it
    // long after the operator left. Page reload re-prompts.
    adminToken.value = token;
  }

  function lock(): void {
    unlocked.value = false;
    adminToken.value = '';
    count.value = 0;
    db.deleteSetting(KEY_UNLOCKED).catch(() => {});
  }

  return {
    unlocked,
    adminToken,
    hydrated,
    popoverOpen,
    activationTick,
    hydrate,
    notifyKey,
    setAdminToken,
    lock,
  };
});
