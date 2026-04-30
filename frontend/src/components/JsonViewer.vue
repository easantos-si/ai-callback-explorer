<template>
  <div class="json-viewer">
    <!-- Max depth guard -->
    <template v-if="depth > MAX_DEPTH">
      <pre class="json-raw">{{ JSON.stringify(data, null, 2) }}</pre>
    </template>

    <!-- Object or Array -->
    <template v-else-if="isCompoundData">
      <div class="json-compound">
        <div
          v-for="item in entries"
          :key="item.key"
          class="json-row"
        >
          <span
            v-if="!isArrayData"
            class="json-key"
            @click="toggle(item.key)"
          >
            "{{ item.key }}"<span class="colon">: </span>
          </span>
          <span
            v-else
            class="json-index"
            @click="toggle(item.key)"
          >
            [{{ item.key }}]<span class="colon">: </span>
          </span>

          <template v-if="isCompound(item.value)">
            <span class="json-toggle" @click="toggle(item.key)">
              {{ isCollapsed(item.key) ? '▶' : '▼' }}
              {{ compoundPreview(item.value) }}
            </span>
            <div
              v-if="!isCollapsed(item.key)"
              class="json-nested"
            >
              <JsonViewer :data="item.value" :depth="depth + 1" />
            </div>
          </template>
          <template v-else>
            <span :class="valueClass(item.value)">{{
              formatValue(item.value)
            }}</span>
          </template>
        </div>
      </div>
    </template>

    <!-- Primitive -->
    <template v-else>
      <span :class="valueClass(data)">{{ formatValue(data) }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue';

const MAX_DEPTH = 15;

const props = withDefaults(
  defineProps<{
    data: unknown;
    depth?: number;
  }>(),
  {
    depth: 0,
  },
);

const collapsedKeys = reactive<Record<string, boolean>>({});

const isArrayData = computed((): boolean => Array.isArray(props.data));

const isCompoundData = computed(
  (): boolean => props.data !== null && typeof props.data === 'object',
);

interface EntryItem {
  key: string;
  value: unknown;
}

const entries = computed((): EntryItem[] => {
  if (Array.isArray(props.data)) {
    return props.data.map((value, index) => ({
      key: String(index),
      value,
    }));
  }
  if (props.data && typeof props.data === 'object') {
    return Object.entries(props.data as Record<string, unknown>).map(
      ([key, value]) => ({ key, value }),
    );
  }
  return [];
});

function isCompound(value: unknown): boolean {
  return value !== null && typeof value === 'object';
}

function isCollapsed(key: string): boolean {
  return !!collapsedKeys[key];
}

function toggle(key: string): void {
  collapsedKeys[key] = !collapsedKeys[key];
}

function compoundPreview(value: unknown): string {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return `{${keys.length} key${keys.length !== 1 ? 's' : ''}}`;
  }
  return '';
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    // Truncate very long strings in the viewer
    if (value.length > 500) {
      return `"${value.slice(0, 500)}…" (${value.length} chars)`;
    }
    return `"${value}"`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function valueClass(value: unknown): string {
  if (value === null || value === undefined) return 'json-null';
  if (typeof value === 'string') return 'json-string';
  if (typeof value === 'number') return 'json-number';
  if (typeof value === 'boolean') return 'json-boolean';
  return 'json-value';
}
</script>

<style scoped>
.json-viewer {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.7;
}

.json-raw {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}

.json-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
}

.json-key {
  color: var(--json-key);
  cursor: pointer;
  user-select: none;
}

.json-index {
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}

.colon {
  color: var(--text-muted);
}

.json-toggle {
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
  font-size: 10px;
}

.json-toggle:hover {
  color: var(--accent);
}

.json-nested {
  width: 100%;
  padding-left: 20px;
  border-left: 1px solid var(--border-color);
  margin-left: 4px;
}

.json-string {
  color: var(--json-string);
  word-break: break-all;
}

.json-number {
  color: var(--json-number);
}

.json-boolean {
  color: var(--json-boolean);
}

.json-null {
  color: var(--json-null);
  font-style: italic;
}

.json-value {
  color: var(--text-secondary);
}
</style>
