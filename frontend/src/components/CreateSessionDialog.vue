<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <h2>Nova Sessão</h2>
        <button class="btn-close" @click="$emit('close')">✕</button>
      </div>
      <div class="dialog-body">
        <label class="field-label" for="session-label">
          Nome da sessão
        </label>
        <input
          id="session-label"
          ref="inputRef"
          v-model="label"
          type="text"
          class="field-input"
          placeholder="Ex: Teste transcrição de áudio"
          maxlength="200"
          @keyup.enter="create"
        />
        <p class="field-hint">
          Uma URL de callback será gerada automaticamente. Use-a no
          parâmetro <code>callback_url</code> da AI API.
        </p>
      </div>
      <div class="dialog-footer">
        <button class="btn btn-cancel" @click="$emit('close')">
          Cancelar
        </button>
        <button
          class="btn btn-primary"
          :disabled="creating"
          @click="create"
        >
          {{ creating ? 'Criando...' : 'Criar Sessão' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSessionStore } from '@/stores/sessions';
import type { Session } from '@/types';

const emit = defineEmits<{
  close: [];
  created: [session: Session];
}>();

const store = useSessionStore();
const label = ref('');
const creating = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);

onMounted(() => {
  // Focus input after dialog mounts
  setTimeout(() => inputRef.value?.focus(), 50);
});

async function create(): Promise<void> {
  if (creating.value) return;
  creating.value = true;

  try {
    const sessionLabel =
      label.value.trim() ||
      `Sessão ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

    const session = await store.createSession(sessionLabel);
    emit('created', session);
  } catch (e) {
    console.error('Failed to create session:', e);
    alert(
      'Erro ao criar sessão. Verifique se o backend está acessível.',
    );
  } finally {
    creating.value = false;
  }
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.dialog {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  width: 90%;
  max-width: 480px;
  box-shadow: var(--shadow);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 0;
}

.dialog-header h2 {
  font-size: 18px;
  font-weight: 700;
}

.btn-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
  transition: color var(--transition);
}

.btn-close:hover {
  color: var(--text-primary);
}

.dialog-body {
  padding: 20px 24px;
}

.field-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.field-input {
  width: 100%;
  padding: 10px 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  transition: border-color var(--transition);
}

.field-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.field-hint {
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.field-hint code {
  font-family: var(--font-mono);
  background: var(--bg-tertiary);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
  color: var(--accent);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 24px 20px;
}

.btn {
  padding: 9px 20px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition);
  border: 1px solid transparent;
}

.btn-cancel {
  background: transparent;
  border-color: var(--border-color);
  color: var(--text-secondary);
}

.btn-cancel:hover {
  background: var(--bg-hover);
}

.btn-primary {
  background: var(--accent);
  color: white;
  border: none;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
