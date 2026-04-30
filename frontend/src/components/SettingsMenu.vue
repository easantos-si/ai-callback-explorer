<template>
  <div class="settings-wrapper">
    <button
      ref="triggerRef"
      class="settings-trigger"
      :title="t('settings.open')"
      :aria-label="t('settings.open')"
      @click="toggle"
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        />
      </svg>
    </button>

    <Teleport to="body">
      <div v-if="open" class="settings-backdrop" @click="open = false" />
      <div
        v-if="open"
        ref="popoverRef"
        class="settings-popover"
        :style="popoverStyle"
        @click.stop
      >
        <header class="popover-header">
          <h3>
            {{ t('settings.title') }}
            <span
              v-if="auth.originFilteringEnabled && superMode.unlocked"
              class="super-badge"
            >
              ⚡ {{ t('superMode.title') }}
            </span>
          </h3>
          <button class="popover-close" :title="t('detail.close')" @click="open = false">
            ✕
          </button>
        </header>

        <div class="popover-scroll">
          <section
            v-if="auth.originFilteringEnabled && superMode.unlocked"
            class="popover-section super-section"
          >
            <div class="super-header">
              <label class="section-label">⚡ {{ t('superMode.subtitle') }}</label>
              <button class="btn-link-danger" @click="exitSuper">
                {{ t('superMode.exit') }}
              </button>
            </div>

            <template v-if="!authenticated">
              <label class="field-label">{{ t('superMode.tokenLabel') }}</label>
              <input
                ref="tokenInputRef"
                v-model="tokenDraft"
                type="password"
                class="field-input small"
                :placeholder="t('superMode.tokenPlaceholder')"
                autocomplete="off"
                @keyup.enter="validateToken"
              />
              <button
                class="btn-super"
                :disabled="validating || !tokenDraft"
                @click="validateToken"
              >
                {{ validating ? t('superMode.validating') : t('superMode.validate') }}
              </button>
            </template>

            <template v-else>
              <label class="field-label">{{ t('superMode.originLabel') }}</label>
              <input
                v-model="newOrigin"
                type="text"
                class="field-input small"
                :placeholder="t('superMode.originPlaceholder')"
                autocomplete="off"
                @keyup.enter="addOrigin"
              />
              <button
                class="btn-super"
                :disabled="adding || !newOrigin"
                @click="addOrigin"
              >
                {{ adding ? t('superMode.adding') : t('superMode.add') }}
              </button>

              <div v-if="origins.length > 0" class="origins-list">
                <label class="section-label">
                  <span>{{ t('superMode.list') }}</span>
                  <button class="btn-icon" :title="t('superMode.refresh')" @click="loadOrigins">
                    ⟳
                  </button>
                </label>
                <ul>
                  <li v-for="o in origins" :key="o.origin" class="origin-row">
                    <code>{{ o.origin }}</code>
                    <span
                      v-if="o.source === 'env'"
                      class="origin-tag"
                      :title="t('superMode.envProtected')"
                    >
                      🔒 .env
                    </span>
                    <button
                      v-else
                      class="btn-remove-origin"
                      :title="t('superMode.remove')"
                      :disabled="removing === o.origin"
                      @click="removeOrigin(o.origin)"
                    >
                      ✕
                    </button>
                  </li>
                </ul>
              </div>
            </template>

            <p v-if="message" class="super-message" :class="messageClass">
              {{ message }}
            </p>
          </section>

          <section class="popover-section">
            <label class="section-label">{{ t('settings.viewMode') }}</label>
            <div class="view-toggle">
              <button
                type="button"
                class="view-option"
                :class="{ active: settings.viewMode === 'gui' }"
                @click="settings.setViewMode('gui')"
              >
                <span>{{ t('settings.viewModeGui') }}</span>
              </button>
              <button
                type="button"
                class="view-option"
                :class="{ active: settings.viewMode === 'tui' }"
                @click="settings.setViewMode('tui')"
              >
                <span>{{ t('settings.viewModeTui') }}</span>
              </button>
            </div>
          </section>

          <section class="popover-section">
            <label class="section-label">{{ t('settings.language') }}</label>
            <div class="locale-grid">
              <button
                v-for="opt in AVAILABLE_LOCALES"
                :key="opt.code"
                class="locale-option"
                :class="{ active: settings.locale === opt.code }"
                :title="opt.label"
                @click="settings.setLocale(opt.code)"
              >
                <span class="locale-flag">{{ opt.flag }}</span>
                <span class="locale-label">{{ opt.label }}</span>
              </button>
            </div>
          </section>

          <section class="popover-section">
            <label class="section-label">{{ t('settings.theme') }}</label>
            <div class="theme-grid">
              <button
                v-for="theme in THEMES"
                :key="theme.id"
                class="theme-option"
                :class="{ active: settings.themeId === theme.id }"
                :title="t(`themes.${theme.i18nKey}`)"
                @click="settings.setTheme(theme.id)"
              >
                <span class="theme-swatches">
                  <span
                    class="swatch"
                    :style="{ background: theme.colors.bgPrimary }"
                  />
                  <span
                    class="swatch"
                    :style="{ background: theme.colors.bgSecondary }"
                  />
                  <span
                    class="swatch"
                    :style="{ background: theme.colors.accent }"
                  />
                </span>
                <span class="theme-label">
                  {{ t(`themes.${theme.i18nKey}`) }}
                </span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/stores/settings';
import { useSuperModeStore } from '@/stores/superMode';
import { useAuthStore } from '@/stores/auth';
import { THEMES } from '@/themes';
import { AVAILABLE_LOCALES } from '@/i18n';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const { t } = useI18n();
const settings = useSettingsStore();
const superMode = useSuperModeStore();
const auth = useAuthStore();

const open = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const tokenInputRef = ref<HTMLInputElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});

interface AllowedOrigin {
  origin: string;
  source: 'env' | 'runtime';
}

const tokenDraft = ref('');
const validating = ref(false);
const newOrigin = ref('');
const adding = ref(false);
const message = ref('');
const messageClass = ref<'ok' | 'err' | ''>('');
const origins = ref<AllowedOrigin[]>([]);
const removing = ref<string | null>(null);

const authenticated = computed(() => superMode.adminToken.length > 0);

function toggle(): void {
  open.value = !open.value;
}

async function positionPopover(): Promise<void> {
  await nextTick();
  if (!triggerRef.value || !popoverRef.value) return;
  const rect = triggerRef.value.getBoundingClientRect();
  const pop = popoverRef.value;
  const popWidth = pop.offsetWidth;
  const popHeight = pop.offsetHeight;
  const margin = 8;

  let left = rect.right - popWidth;
  let top = rect.bottom + 6;

  if (left < margin) left = margin;
  if (left + popWidth > window.innerWidth - margin) {
    left = window.innerWidth - popWidth - margin;
  }
  if (top + popHeight > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - popHeight - 6);
  }

  popoverStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
  };
}

function onResize(): void {
  if (open.value) positionPopover();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) {
    open.value = false;
  }
}

watch(open, (val) => {
  superMode.popoverOpen = val;
  if (val) {
    positionPopover();
    if (superMode.unlocked && !authenticated.value) {
      nextTick(() => tokenInputRef.value?.focus());
    }
    if (superMode.unlocked && authenticated.value && origins.value.length === 0) {
      loadOrigins();
    }
  } else {
    message.value = '';
  }
});

// Auto-open the popover only on a fresh 12-press activation. Hydration of
// a previously-unlocked state on page load just flips `unlocked` true and
// must not pop the panel open.
watch(
  () => superMode.activationTick,
  () => {
    open.value = true;
    message.value = t('superMode.activated');
    messageClass.value = 'ok';
    nextTick(() => {
      positionPopover();
      if (!authenticated.value) tokenInputRef.value?.focus();
    });
  },
);

// Lock event: clear all draft state.
watch(
  () => superMode.unlocked,
  (val) => {
    if (!val) {
      tokenDraft.value = '';
      newOrigin.value = '';
      origins.value = [];
      message.value = '';
    }
  },
);

async function validateToken(): Promise<void> {
  if (validating.value) return;
  message.value = '';
  messageClass.value = '';
  validating.value = true;

  try {
    const res = await fetch(`${API_BASE}/api/admin/origins`, {
      headers: { 'X-Admin-Token': tokenDraft.value },
    });
    if (res.status === 401 || res.status === 403) {
      message.value = t('superMode.invalidToken');
      messageClass.value = 'err';
      return;
    }
    if (!res.ok) {
      message.value = t('superMode.networkError');
      messageClass.value = 'err';
      return;
    }
    const data = (await res.json()) as { origins?: AllowedOrigin[] };
    superMode.setAdminToken(tokenDraft.value);
    tokenDraft.value = '';
    if (data.origins) origins.value = data.origins;
    message.value = t('superMode.tokenValid');
    messageClass.value = 'ok';
    nextTick(() => positionPopover());
  } catch {
    message.value = t('superMode.networkError');
    messageClass.value = 'err';
  } finally {
    validating.value = false;
  }
}

async function addOrigin(): Promise<void> {
  if (adding.value || !authenticated.value) return;
  message.value = '';
  messageClass.value = '';

  try {
    new URL(newOrigin.value);
  } catch {
    message.value = t('superMode.invalidOrigin');
    messageClass.value = 'err';
    return;
  }

  adding.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/admin/origins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': superMode.adminToken,
      },
      body: JSON.stringify({ origin: newOrigin.value.trim() }),
    });

    if (res.status === 401 || res.status === 403) {
      message.value = t('superMode.invalidToken');
      messageClass.value = 'err';
      // Server rejected our cached token — drop it so the user re-auths.
      superMode.setAdminToken('');
      return;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      message.value = txt || t('superMode.networkError');
      messageClass.value = 'err';
      return;
    }
    const data = (await res.json()) as { origins?: AllowedOrigin[] };
    if (data.origins) origins.value = data.origins;
    message.value = t('superMode.addSuccess');
    messageClass.value = 'ok';
    newOrigin.value = '';
    nextTick(() => positionPopover());
  } catch {
    message.value = t('superMode.networkError');
    messageClass.value = 'err';
  } finally {
    adding.value = false;
  }
}

async function loadOrigins(): Promise<void> {
  if (!authenticated.value) return;
  try {
    const res = await fetch(`${API_BASE}/api/admin/origins`, {
      headers: { 'X-Admin-Token': superMode.adminToken },
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        superMode.setAdminToken('');
        message.value = t('superMode.invalidToken');
        messageClass.value = 'err';
      }
      return;
    }
    const data = (await res.json()) as { origins?: AllowedOrigin[] };
    if (data.origins) origins.value = data.origins;
  } catch {
    // Ignore network errors here
  }
}

async function removeOrigin(origin: string): Promise<void> {
  if (!authenticated.value || removing.value) return;
  if (!confirm(t('superMode.confirmRemove', { origin }))) return;

  message.value = '';
  messageClass.value = '';
  removing.value = origin;
  try {
    const res = await fetch(`${API_BASE}/api/admin/origins`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': superMode.adminToken,
      },
      body: JSON.stringify({ origin }),
    });

    if (res.status === 401 || res.status === 403) {
      // 403 here can also mean "protected env origin" — distinguish by body.
      const txt = await res.text().catch(() => '');
      if (txt.toLowerCase().includes('ui_origin')) {
        message.value = t('superMode.envProtected');
      } else {
        superMode.setAdminToken('');
        message.value = t('superMode.invalidToken');
      }
      messageClass.value = 'err';
      return;
    }
    if (!res.ok) {
      message.value = t('superMode.networkError');
      messageClass.value = 'err';
      return;
    }
    const data = (await res.json()) as { origins?: AllowedOrigin[] };
    if (data.origins) origins.value = data.origins;
    message.value = t('superMode.removeSuccess');
    messageClass.value = 'ok';
    nextTick(() => positionPopover());
  } catch {
    message.value = t('superMode.networkError');
    messageClass.value = 'err';
  } finally {
    removing.value = null;
  }
}

function exitSuper(): void {
  superMode.lock();
  message.value = t('superMode.locked');
  messageClass.value = '';
}

onMounted(() => {
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, true);
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  window.removeEventListener('scroll', onResize, true);
  document.removeEventListener('keydown', onKeydown);
  superMode.popoverOpen = false;
});
</script>

<style scoped>
.settings-wrapper {
  position: relative;
}

.settings-trigger {
  width: 34px;
  height: 34px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition);
}

.settings-trigger:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>

<style>
.settings-backdrop {
  position: fixed;
  inset: 0;
  background: transparent;
  z-index: 299;
}

.settings-popover {
  position: fixed;
  width: min(380px, calc(100vw - 16px));
  max-height: min(80vh, 640px);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  z-index: 300;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-popover .popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.settings-popover .popover-header h3 {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.settings-popover .super-badge {
  font-size: 10px;
  letter-spacing: 0.4px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--accent-glow);
  color: var(--accent);
  border: 1px solid var(--accent);
  text-transform: none;
  white-space: nowrap;
}

.settings-popover .popover-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.settings-popover .popover-close:hover {
  color: var(--text-primary);
}

.settings-popover .popover-scroll {
  overflow-y: auto;
  flex: 1;
}

.settings-popover .popover-section {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
}

.settings-popover .popover-section:last-child {
  border-bottom: none;
}

.settings-popover .section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom: 10px;
}

.settings-popover .locale-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 6px;
}

.settings-popover .locale-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition);
  text-align: left;
  min-width: 0;
}

.settings-popover .locale-option:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.settings-popover .locale-option.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg-active);
}

.settings-popover .locale-flag {
  font-size: 14px;
  flex-shrink: 0;
}

.settings-popover .locale-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.settings-popover .theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 6px;
}

.settings-popover .theme-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition);
  text-align: left;
  min-height: 36px;
  min-width: 0;
}

.settings-popover .theme-option:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.settings-popover .theme-option.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg-active);
}

.settings-popover .theme-swatches {
  display: inline-flex;
  flex-shrink: 0;
  border-radius: 3px;
  overflow: hidden;
  border: 1px solid var(--border-color);
}

.settings-popover .swatch {
  width: 8px;
  height: 18px;
  display: block;
}

.settings-popover .theme-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  font-size: 11px;
  flex: 1;
}

.settings-popover .super-section {
  background: linear-gradient(
    180deg,
    var(--accent-glow),
    transparent 60%
  );
}

.settings-popover .super-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.settings-popover .field-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 8px 0 4px;
}

.settings-popover .field-input.small {
  width: 100%;
  padding: 7px 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-mono);
  outline: none;
  transition: border-color var(--transition);
}

.settings-popover .field-input.small:focus {
  border-color: var(--accent);
}

.settings-popover .btn-super {
  width: 100%;
  margin-top: 10px;
  padding: 8px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition);
}

.settings-popover .btn-super:hover:not(:disabled) {
  background: var(--accent-hover);
}

.settings-popover .btn-super:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.settings-popover .btn-link-danger {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 0;
}

.settings-popover .btn-link-danger:hover {
  color: var(--danger);
}

.settings-popover .btn-icon {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
}

.settings-popover .btn-icon:hover {
  color: var(--accent);
}

.settings-popover .super-message {
  margin-top: 10px;
  font-size: 11px;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  word-break: break-word;
}

.settings-popover .super-message.ok {
  color: var(--success);
  border: 1px solid rgba(0, 214, 143, 0.25);
}

.settings-popover .super-message.err {
  color: var(--danger);
  border: 1px solid rgba(255, 61, 113, 0.25);
}

.settings-popover .origins-list {
  margin-top: 14px;
}

.settings-popover .origins-list ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-popover .origins-list li {
  padding: 6px 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
}

.settings-popover .origin-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.settings-popover .origin-row code {
  flex: 1;
  min-width: 0;
}

.settings-popover .origins-list code {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-primary);
  word-break: break-all;
}

.settings-popover .view-toggle {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.settings-popover .view-option {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition);
}

.settings-popover .view-option:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.settings-popover .view-option.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg-active);
}

.settings-popover .origin-tag {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.4px;
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  text-transform: uppercase;
}

.settings-popover .btn-remove-origin {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
  transition: all var(--transition);
}

.settings-popover .btn-remove-origin:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
  background: rgba(255, 61, 113, 0.08);
}

.settings-popover .btn-remove-origin:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
