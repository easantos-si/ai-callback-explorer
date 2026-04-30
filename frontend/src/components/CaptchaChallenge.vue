<template>
  <div class="captcha">
    <div class="captcha-frame">
      <div
        v-if="auth.captcha"
        class="captcha-svg"
        v-html="auth.captcha.svg"
      />
      <div v-else class="captcha-loading">…</div>
      <button
        type="button"
        class="captcha-refresh"
        :title="t('auth.refreshChallenge')"
        :disabled="refreshing"
        @click="onRefresh"
      >
        ⟳
      </button>
    </div>
    <input
      ref="inputRef"
      v-model="answer"
      type="text"
      class="captcha-input"
      :placeholder="t('auth.captchaPlaceholder')"
      :maxlength="8"
      autocomplete="off"
      autocapitalize="characters"
      spellcheck="false"
      :disabled="locked || submitting"
      @keydown.enter.prevent="onSubmit"
    />
    <button
      type="button"
      class="btn-primary"
      :disabled="!answer || submitting || locked"
      @click="onSubmit"
    >
      {{ submitting ? t('auth.checking') : t('auth.continue') }}
    </button>
    <p v-if="errorMsg" class="captcha-error">{{ errorMsg }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';

const { t } = useI18n();
const auth = useAuthStore();

const answer = ref('');
const submitting = ref(false);
const refreshing = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);

// Reading clockTick lets this re-evaluate as the lockout clock advances.
const locked = computed(() => {
  void auth.clockTick;
  return Date.now() < auth.lockedUntil;
});

const errorMsg = computed(() => {
  const e = auth.lastError;
  if (!e) return '';
  if (e.retryAfter) {
    return t('auth.lockedRetry', { seconds: e.retryAfter });
  }
  if (typeof e.failuresLeft === 'number') {
    return t('auth.wrongAnswer', { left: e.failuresLeft });
  }
  if (e.generic) return t('auth.networkError');
  return '';
});

async function onSubmit(): Promise<void> {
  if (!answer.value || submitting.value || locked.value) return;
  submitting.value = true;
  try {
    const ok = await auth.submitCaptcha(answer.value);
    if (!ok) {
      answer.value = '';
      nextTick(() => inputRef.value?.focus());
    }
  } finally {
    submitting.value = false;
  }
}

async function onRefresh(): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await auth.fetchCaptcha();
    answer.value = '';
    nextTick(() => inputRef.value?.focus());
  } finally {
    refreshing.value = false;
  }
}

watch(
  () => auth.captcha?.id,
  () => {
    answer.value = '';
    nextTick(() => inputRef.value?.focus());
  },
);

onMounted(() => {
  nextTick(() => inputRef.value?.focus());
});
</script>

<style scoped>
.captcha {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.captcha-frame {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 12px;
  min-height: 80px;
  color: var(--text-primary);
  overflow: hidden;
}

.captcha-svg {
  width: 100%;
  max-width: 240px;
  display: flex;
  justify-content: center;
}

.captcha-svg :deep(svg) {
  width: 100%;
  height: auto;
  display: block;
}

.captcha-loading {
  font-size: 22px;
  color: var(--text-muted);
}

.captcha-refresh {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  transition: all var(--transition);
}

.captcha-refresh:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.captcha-refresh:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.captcha-input {
  width: 100%;
  padding: 12px 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 16px;
  font-family: var(--font-mono);
  letter-spacing: 0.3em;
  text-align: center;
  text-transform: uppercase;
  outline: none;
  transition: border-color var(--transition);
}

.captcha-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.captcha-input:disabled {
  opacity: 0.5;
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

.captcha-error {
  font-size: 12px;
  color: var(--danger);
  text-align: center;
  margin-top: 4px;
}
</style>
