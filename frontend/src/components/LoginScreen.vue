<template>
  <div class="login-screen">
    <div class="login-card">
      <header class="login-header">
        <span class="login-icon">🔬</span>
        <h1>{{ t('app.title') }}</h1>
        <p class="login-sub">{{ t('app.subtitle') }}</p>
      </header>

      <CaptchaChallenge v-if="auth.phase === 'captcha'" />

      <div v-else-if="auth.phase === 'totp'" class="totp">
        <label class="totp-label">{{ t('auth.totpLabel') }}</label>
        <p class="totp-help">{{ t('auth.totpHint') }}</p>
        <input
          ref="totpRef"
          v-model="totpCode"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          :placeholder="t('auth.totpPlaceholder')"
          class="totp-input"
          maxlength="6"
          :disabled="submitting || locked"
          @input="onTotpInput"
          @keydown.enter.prevent="onSubmitTotp"
        />
        <button
          class="btn-primary"
          :disabled="totpCode.length !== 6 || submitting || locked"
          @click="onSubmitTotp"
        >
          {{ submitting ? t('auth.checking') : t('auth.signIn') }}
        </button>
        <button class="btn-link" @click="auth.logout()">
          {{ t('auth.startOver') }}
        </button>
        <p v-if="totpError" class="totp-error">{{ totpError }}</p>
      </div>

      <div v-else class="loading">
        <div class="spinner" />
      </div>

      <footer class="login-footer">
        <button
          class="btn-icon"
          :title="t('settings.open')"
          @click="settingsOpen = !settingsOpen"
        >
          ⚙
        </button>
        <!--
          Counter only appears from press 7 onwards. Earlier presses
          stay invisible so a casual visitor typing on the page can't
          accidentally discover the hidden gate.
        -->
        <span class="hint" v-if="superHintCount >= 7 && superHintCount < 12">
          {{ superHintCount }} / 12
        </span>
      </footer>
    </div>

    <QrRevealDialog v-if="qrOpen" @close="closeQr" />

    <div v-if="settingsOpen" class="login-settings">
      <header>
        <strong>{{ t('settings.title') }}</strong>
        <button class="btn-icon" @click="settingsOpen = false">✕</button>
      </header>
      <section>
        <label>{{ t('settings.language') }}</label>
        <select :value="settings.locale" @change="onLocaleChange">
          <option v-for="opt in AVAILABLE_LOCALES" :key="opt.code" :value="opt.code">
            {{ opt.flag }} {{ opt.label }}
          </option>
        </select>
      </section>
      <section>
        <label>{{ t('settings.theme') }}</label>
        <select :value="settings.themeId" @change="onThemeChange">
          <option v-for="th in THEMES" :key="th.id" :value="th.id">
            {{ t(`themes.${th.i18nKey}`) }}
          </option>
        </select>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import CaptchaChallenge from './CaptchaChallenge.vue';
import QrRevealDialog from './QrRevealDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';
import { AVAILABLE_LOCALES, type LocaleCode } from '@/i18n';
import { THEMES } from '@/themes';

const { t } = useI18n();
const auth = useAuthStore();
const settings = useSettingsStore();

const totpCode = ref('');
const totpRef = ref<HTMLInputElement | null>(null);
const submitting = ref(false);
const settingsOpen = ref(false);
const qrOpen = ref(false);

// Hidden 12-press gate — surfaces the QR-reveal dialog so a fresh
// operator can register the shared TOTP secret in their authenticator
// app. We use the physical A key (layout-independent: `e.code` is
// always 'KeyA' regardless of locale). Note that the in-app Super
// Mode trigger uses 'KeyS' instead — keeping them distinct so the
// operator can't accidentally cross the streams.
const TRIGGER_CODE = 'KeyA';
const REQUIRED_PRESSES = 12;
const PRESS_WINDOW_MS = 8_000;
const lastPressAt = ref(0);
const pressCount = ref(0);
const superHintCount = computed(() => pressCount.value);

// clockTick is bumped every second by the auth store while a lockout is
// active — touch it so this computed re-runs and unfreezes the inputs.
const locked = computed(() => {
  void auth.clockTick;
  return Date.now() < auth.lockedUntil;
});

const totpError = computed(() => {
  const e = auth.lastError;
  if (!e) return '';
  if (e.retryAfter) {
    return t('auth.lockedRetry', { seconds: e.retryAfter });
  }
  if (typeof e.failuresLeft === 'number') {
    return t('auth.wrongTotp', { left: e.failuresLeft });
  }
  if (e.generic) return t('auth.networkError');
  return '';
});

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (qrOpen.value) {
      qrOpen.value = false;
      return;
    }
    if (settingsOpen.value) {
      settingsOpen.value = false;
      return;
    }
  }

  if (qrOpen.value || settingsOpen.value) return;
  if (isTypingTarget(e.target)) return;
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code !== TRIGGER_CODE) {
    // Any other physical key resets the streak.
    pressCount.value = 0;
    return;
  }
  const now = Date.now();
  if (now - lastPressAt.value > PRESS_WINDOW_MS) {
    pressCount.value = 1;
  } else {
    pressCount.value += 1;
  }
  lastPressAt.value = now;
  if (pressCount.value >= REQUIRED_PRESSES) {
    pressCount.value = 0;
    qrOpen.value = true;
  }
}

function onTotpInput(): void {
  totpCode.value = totpCode.value.replace(/\D/g, '').slice(0, 6);
}

async function onSubmitTotp(): Promise<void> {
  if (totpCode.value.length !== 6 || submitting.value || locked.value) return;
  submitting.value = true;
  try {
    const ok = await auth.submitTotp(totpCode.value);
    if (!ok) {
      totpCode.value = '';
      nextTick(() => totpRef.value?.focus());
    }
  } finally {
    submitting.value = false;
  }
}

function closeQr(): void {
  qrOpen.value = false;
}

function onLocaleChange(e: Event): void {
  const code = (e.target as HTMLSelectElement).value as LocaleCode;
  settings.setLocale(code);
}

function onThemeChange(e: Event): void {
  settings.setTheme((e.target as HTMLSelectElement).value);
}

watch(
  () => auth.phase,
  (p) => {
    if (p === 'totp') {
      nextTick(() => totpRef.value?.focus());
    }
  },
);

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
.login-screen {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 20% 0%, var(--accent-glow), transparent 50%),
    radial-gradient(circle at 80% 100%, var(--accent-glow), transparent 60%),
    var(--bg-primary);
  padding: 16px;
  overflow: auto;
}

.login-card {
  width: 100%;
  max-width: 380px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 28px 24px 18px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 18px;
  position: relative;
}

.login-header {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.login-icon {
  font-size: 40px;
  line-height: 1;
}

.login-header h1 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.login-sub {
  font-size: 12px;
  color: var(--text-muted);
}

.totp {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.totp-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.7px;
}

.totp-help {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}

.totp-input {
  width: 100%;
  padding: 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 22px;
  font-family: var(--font-mono);
  letter-spacing: 0.5em;
  text-align: center;
  outline: none;
  transition: border-color var(--transition);
}

.totp-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.btn-primary {
  width: 100%;
  padding: 11px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition);
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-link {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  margin-top: 2px;
}

.btn-link:hover {
  color: var(--accent);
}

.totp-error {
  font-size: 12px;
  color: var(--danger);
  text-align: center;
}

.loading {
  display: flex;
  justify-content: center;
  padding: 30px 0;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 2px solid var(--border-color);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.login-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
  font-size: 11px;
  color: var(--text-muted);
}

.btn-icon {
  background: none;
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition);
}

.btn-icon:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.hint {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--accent);
  letter-spacing: 0.05em;
  opacity: 0.85;
  padding: 2px 8px;
  background: var(--accent-glow);
  border-radius: 10px;
  border: 1px solid var(--accent);
}

.login-settings {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 14px 16px;
  width: min(380px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: var(--shadow);
  z-index: 400;
}

.login-settings header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
}

.login-settings section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.login-settings select {
  padding: 7px 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}

.login-settings select:focus {
  border-color: var(--accent);
}
</style>
