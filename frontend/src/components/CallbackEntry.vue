<template>
  <div class="entry" :class="{ selected }" @click="$emit('click')">
    <div class="entry-left">
      <span
        class="method-badge"
        :style="{ background: getMethodColor(entry.method) }"
      >
        {{ entry.method }}
      </span>
      <div class="entry-info">
        <span class="entry-type">{{ guessContentType(entry.body) }}</span>
        <span class="entry-time">{{ formatDate(entry.receivedAt) }}</span>
      </div>
    </div>
    <div class="entry-right">
      <span class="entry-preview">{{ bodyPreview }}</span>
      <button
        class="btn-delete-entry"
        title="Remover"
        @click.stop="$emit('delete')"
      >
        ✕
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CallbackEntry as EntryType } from '@/types';
import {
  formatDate,
  getMethodColor,
  guessContentType,
} from '@/utils/formatters';

const props = defineProps<{
  entry: EntryType;
  selected: boolean;
}>();

defineEmits<{
  click: [];
  delete: [];
}>();

const bodyPreview = computed((): string => {
  const body = props.entry.body;
  if (body === null || body === undefined) return '(empty)';
  try {
    const str = typeof body === 'string' ? body : JSON.stringify(body);
    return str.length > 120 ? str.slice(0, 120) + '…' : str;
  } catch {
    return '(binary)';
  }
});
</script>

<style scoped>
.entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition);
  min-height: 56px;
}

.entry:hover {
  background: var(--bg-hover);
  border-color: var(--border-light);
}

.entry.selected {
  background: var(--bg-active);
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-glow);
}

.entry-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.method-badge {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  color: white;
  padding: 3px 8px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.entry-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.entry-type {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.entry-time {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.entry-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  justify-content: flex-end;
}

.entry-preview {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
}

.btn-delete-entry {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 4px 6px;
  border-radius: 4px;
  opacity: 0;
  transition: all var(--transition);
  flex-shrink: 0;
}

.entry:hover .btn-delete-entry {
  opacity: 1;
}

.btn-delete-entry:hover {
  color: var(--danger);
  background: rgba(255, 61, 113, 0.1);
}
</style>
