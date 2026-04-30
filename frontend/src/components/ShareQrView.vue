<template>
  <div class="share-screen" @keydown.esc="$emit('close')">
    <div class="share-card" tabindex="-1">
      <header class="share-header">
        <div class="share-title-block">
          <span class="share-icon">🔬</span>
          <div>
            <h1>{{ t('app.title') }}</h1>
            <p class="share-sub">{{ t('auth.qrTitle') }}</p>
          </div>
        </div>
        <button
          class="share-close"
          :title="t('detail.close')"
          @click="$emit('close')"
        >
          ✕
        </button>
      </header>

      <div class="share-body">
        <div v-if="loading" class="share-loading">
          <div class="spinner" />
        </div>

        <div v-else-if="error" class="share-error">
          <p>{{ error }}</p>
          <button class="share-btn" @click="$emit('close')">
            {{ t('detail.close') }}
          </button>
        </div>

        <template v-else>
          <div class="share-frame">
            <div class="share-canvas" v-html="qrSvg" />
          </div>
          <p class="share-instructions">{{ t('auth.qrScanHint') }}</p>
          <details class="share-uri">
            <summary>{{ t('auth.qrShowUri') }}</summary>
            <code>{{ otpauthUri }}</code>
          </details>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import QRCode from 'qrcode';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const props = defineProps<{
  token: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();

const loading = ref(true);
const error = ref('');
const otpauthUri = ref('');
const qrSvg = ref('');

async function bootstrap(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const res = await fetch(`${API_BASE}/api/auth/qr/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: props.token }),
    });
    if (res.status === 401 || res.status === 403) {
      error.value = t('auth.qrShareInvalid');
      return;
    }
    if (!res.ok) {
      error.value = t('auth.networkError');
      return;
    }
    const body = (await res.json()) as { otpauthUri: string };
    otpauthUri.value = body.otpauthUri;
    await renderQr();
  } catch {
    error.value = t('auth.networkError');
  } finally {
    loading.value = false;
  }
}

async function renderQr(): Promise<void> {
  if (!otpauthUri.value) return;
  // Black on white regardless of theme — same rationale as the
  // QrRevealDialog: maximises camera contrast.
  qrSvg.value = await QRCode.toString(otpauthUri.value, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
}

function onKeydown(e: KeyboardEvent): void {
  // Bound at the window level so ESC closes the view regardless of
  // which element happens to have focus.
  if (e.key === 'Escape') {
    e.stopPropagation();
    emit('close');
  }
}

onMounted(() => {
  bootstrap();
  window.addEventListener('keydown', onKeydown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true);
});
</script>

<style scoped>
.share-screen {
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
  z-index: 600;
}

.share-card {
  width: 100%;
  max-width: 420px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  outline: none;
  overflow: hidden;
}

.share-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--border-color);
}

.share-title-block {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.share-icon {
  font-size: 30px;
  line-height: 1;
}

.share-header h1 {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.share-sub {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 2px;
}

.share-close {
  flex-shrink: 0;
  background: none;
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  font-size: 14px;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition);
}

.share-close:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.share-body {
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.share-loading {
  display: flex;
  justify-content: center;
  padding: 40px 0;
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

.share-error {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 0;
  text-align: center;
}

.share-error p {
  color: var(--danger);
  font-size: 13px;
}

.share-btn {
  align-self: center;
  padding: 8px 18px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.share-frame {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 18px;
  /* Always white — same reasoning as QrRevealDialog. */
  background: #ffffff;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}

.share-canvas {
  width: 240px;
  height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-canvas :deep(svg) {
  width: 100%;
  height: 100%;
  shape-rendering: crispEdges;
  border-radius: 4px;
}

.share-instructions {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  line-height: 1.5;
}

.share-uri {
  font-size: 11px;
  color: var(--text-muted);
}

.share-uri summary {
  cursor: pointer;
  padding: 6px 0;
  user-select: none;
}

.share-uri summary:hover {
  color: var(--text-secondary);
}

.share-uri code {
  display: block;
  margin: 6px 0 0;
  padding: 8px 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-primary);
  word-break: break-all;
}
</style>
