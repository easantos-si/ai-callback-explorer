<template>
  <div class="qr-overlay" @click.self="$emit('close')">
    <div class="qr-dialog" tabindex="-1">
      <header class="qr-header">
        <h3>{{ t('auth.qrTitle') }}</h3>
        <button class="qr-close" :title="t('detail.close')" @click="$emit('close')">
          ✕
        </button>
      </header>

      <div class="qr-body">
        <template v-if="!qrSvg">
          <p class="qr-help">{{ t('auth.qrPasswordHint') }}</p>
          <input
            ref="passwordRef"
            v-model="password"
            type="password"
            class="qr-input"
            :placeholder="t('auth.qrPasswordPlaceholder')"
            autocomplete="off"
            :disabled="loading"
            @keyup.enter="reveal"
          />
          <button
            class="qr-btn"
            :disabled="!password || loading"
            @click="reveal"
          >
            {{ loading ? t('auth.qrLoading') : t('auth.qrReveal') }}
          </button>
          <p v-if="error" class="qr-error">{{ error }}</p>
        </template>

        <template v-else>
          <div class="qr-frame">
            <div class="qr-canvas" v-html="qrSvg" />
          </div>
          <p class="qr-instructions">{{ t('auth.qrScanHint') }}</p>
          <details class="qr-uri">
            <summary>{{ t('auth.qrShowUri') }}</summary>
            <code>{{ otpauthUri }}</code>
            <button class="qr-copy" @click="copyUri">
              {{ copied ? t('panel.copied') : t('detail.copy') }}
            </button>
          </details>

          <!--
            Share-link section — only visible when the operator entered
            the master password (i.e. shareUrl is populated). Visitors
            who arrive via a share link use ShareQrView, which never
            renders this widget.
          -->
          <div v-if="shareUrl" class="qr-share">
            <button
              v-if="!shareRevealed"
              type="button"
              class="qr-share-toggle"
              @click="shareRevealed = true"
            >
              🔗 {{ t('auth.qrRevealShare') }}
            </button>
            <div v-else class="qr-share-panel">
              <p class="qr-share-info">{{ t('auth.qrShareInfo') }}</p>
              <code class="qr-share-url">{{ resolvedShareUrl }}</code>
              <button class="qr-copy" @click="copyShareUrl">
                {{ shareCopied ? t('panel.copied') : t('auth.qrShareCopy') }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import QRCode from 'qrcode';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const { t } = useI18n();

defineEmits<{
  close: [];
}>();

const password = ref('');
const loading = ref(false);
const error = ref('');
const otpauthUri = ref('');
const qrSvg = ref('');
const copied = ref(false);
const passwordRef = ref<HTMLInputElement | null>(null);

// Share-link state — populated only on the master-password reveal path.
const shareUrl = ref('');
const shareRevealed = ref(false);
const shareCopied = ref(false);

// Backend may return a relative `/?share=...` when URL_BASE is unset;
// resolve against the live origin so what the operator copies is always
// a complete clickable URL.
const resolvedShareUrl = computed(() => {
  if (!shareUrl.value) return '';
  if (/^https?:\/\//i.test(shareUrl.value)) return shareUrl.value;
  return `${window.location.origin}${shareUrl.value}`;
});

let copyTimer: ReturnType<typeof setTimeout> | null = null;
let shareCopyTimer: ReturnType<typeof setTimeout> | null = null;

async function reveal(): Promise<void> {
  if (!password.value || loading.value) return;
  error.value = '';
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/auth/qr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    });
    if (res.status === 401) {
      error.value = t('auth.qrInvalidPassword');
      return;
    }
    if (!res.ok) {
      error.value = t('auth.networkError');
      return;
    }
    const body = (await res.json()) as {
      otpauthUri: string;
      shareToken?: string;
      shareUrl?: string;
    };
    otpauthUri.value = body.otpauthUri;
    shareUrl.value = body.shareUrl ?? '';
    shareRevealed.value = false;
    password.value = '';
    await renderQr();
  } catch {
    error.value = t('auth.networkError');
  } finally {
    loading.value = false;
  }
}

async function renderQr(): Promise<void> {
  if (!otpauthUri.value) return;
  // Always black on white regardless of the active theme — maximises
  // scanner contrast and keeps the QR readable across every camera.
  const svg = await QRCode.toString(otpauthUri.value, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
  qrSvg.value = svg;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

async function copyUri(): Promise<void> {
  await copyToClipboard(otpauthUri.value);
  if (copyTimer) clearTimeout(copyTimer);
  copied.value = true;
  copyTimer = setTimeout(() => {
    copied.value = false;
  }, 2000);
}

async function copyShareUrl(): Promise<void> {
  if (!resolvedShareUrl.value) return;
  await copyToClipboard(resolvedShareUrl.value);
  if (shareCopyTimer) clearTimeout(shareCopyTimer);
  shareCopied.value = true;
  shareCopyTimer = setTimeout(() => {
    shareCopied.value = false;
  }, 2000);
}

onMounted(() => {
  nextTick(() => passwordRef.value?.focus());
});
</script>

<style scoped>
.qr-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
  padding: 16px;
}

.qr-dialog {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  width: 100%;
  max-width: 380px;
  box-shadow: var(--shadow);
  outline: none;
}

.qr-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 12px;
}

.qr-header h3 {
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-primary);
}

.qr-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
  padding: 4px 8px;
  border-radius: 4px;
}

.qr-close:hover {
  color: var(--text-primary);
}

.qr-body {
  padding: 0 22px 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.qr-help {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.55;
}

.qr-input {
  width: 100%;
  padding: 11px 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  font-family: var(--font-mono);
  transition: border-color var(--transition);
}

.qr-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.qr-btn {
  width: 100%;
  padding: 10px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition);
}

.qr-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.qr-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.qr-error {
  font-size: 12px;
  color: var(--danger);
  text-align: center;
}

.qr-frame {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 18px;
  /* Always white — guarantees scanning contrast regardless of theme. */
  background: #ffffff;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}

.qr-canvas {
  width: 220px;
  height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qr-canvas :deep(svg) {
  width: 100%;
  height: 100%;
  shape-rendering: crispEdges;
  border-radius: 4px;
}

.qr-instructions {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  line-height: 1.5;
}

.qr-uri {
  font-size: 11px;
  color: var(--text-muted);
}

.qr-uri summary {
  cursor: pointer;
  padding: 6px 0;
  user-select: none;
}

.qr-uri summary:hover {
  color: var(--text-secondary);
}

.qr-uri code {
  display: block;
  margin: 6px 0;
  padding: 8px 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-primary);
  word-break: break-all;
}

.qr-copy {
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition);
}

.qr-copy:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.qr-share {
  margin-top: 4px;
  border-top: 1px dashed var(--border-color);
  padding-top: 12px;
}

.qr-share-toggle {
  width: 100%;
  padding: 9px 12px;
  background: transparent;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition);
}

.qr-share-toggle:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.qr-share-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.qr-share-info {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

.qr-share-url {
  display: block;
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
