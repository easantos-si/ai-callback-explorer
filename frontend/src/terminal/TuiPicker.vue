<template>
  <div class="picker" @keydown="onKeydown" tabindex="0" ref="rootRef">
    <header class="picker-titlebar">
      <span class="title">{{ title }}</span>
      <span class="hint">{{ t('terminal.picker.hint') }}</span>
    </header>

    <div class="picker-body">
      <template v-for="(group, gi) in groups" :key="gi">
        <div v-if="group.label" class="group-label">{{ group.label }}</div>
        <div
          v-for="(item, ii) in group.items"
          :key="`${gi}-${ii}`"
          class="row"
          :class="{
            current: item.current,
            focused: focusedIndex === absoluteIndex(gi, ii),
          }"
          @mouseenter="focusedIndex = absoluteIndex(gi, ii)"
          @click="apply(absoluteIndex(gi, ii))"
        >
          <span class="cursor">{{ focusedIndex === absoluteIndex(gi, ii) ? '❯' : ' ' }}</span>
          <span class="mark">{{ item.current ? '●' : '○' }}</span>
          <span class="label">{{ item.label }}</span>
          <span v-if="item.note" class="note">{{ item.note }}</span>
        </div>
      </template>
    </div>

    <footer class="picker-status">
      <span class="status-cmd" v-if="message">{{ message }}</span>
      <span class="status-hint" v-else>{{ t('terminal.picker.legend') }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/stores/settings';
import { AVAILABLE_LOCALES, type LocaleCode } from '@/i18n';
import { THEMES } from '@/themes';
import { TUI_THEMES } from './themes';

const props = defineProps<{
  mode: 'language' | 'theme';
}>();

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const settings = useSettingsStore();

interface PickerItem {
  label: string;
  note?: string;
  current: boolean;
  apply: () => void;
}
interface PickerGroup {
  label?: string;
  items: PickerItem[];
}

const focusedIndex = ref(0);
const message = ref('');
const rootRef = ref<HTMLElement | null>(null);

const title = computed(() =>
  props.mode === 'language'
    ? t('terminal.picker.languageTitle')
    : t('terminal.picker.themeTitle'),
);

const groups = computed<PickerGroup[]>(() => {
  if (props.mode === 'language') {
    return [
      {
        items: AVAILABLE_LOCALES.map((l) => ({
          label: `${l.flag}  ${l.label}`,
          note: l.code,
          current: l.code === settings.locale,
          apply: () => {
            settings.setLocale(l.code as LocaleCode);
            message.value = t('terminal.picker.applied', { name: l.label });
          },
        })),
      },
    ];
  }
  return [
    {
      label: t('terminal.picker.guiSection'),
      items: THEMES.map((th) => ({
        label: t(`themes.${th.i18nKey}`) as string,
        note: `${th.id} · ${th.mode}`,
        current: th.id === settings.themeId,
        apply: () => {
          settings.setTheme(th.id);
          message.value = t('terminal.picker.applied', {
            name: t(`themes.${th.i18nKey}`),
          });
        },
      })),
    },
    {
      label: t('terminal.picker.tuiSection'),
      items: TUI_THEMES.map((th) => ({
        label: t(`tuiThemes.${th.i18nKey}`) as string,
        note: th.id,
        current: th.id === (settings.tuiThemeId || TUI_THEMES[0].id),
        apply: () => {
          settings.setTuiTheme(th.id);
          message.value = t('terminal.picker.applied', {
            name: t(`tuiThemes.${th.i18nKey}`),
          });
        },
      })),
    },
  ];
});

const flat = computed<PickerItem[]>(() => groups.value.flatMap((g) => g.items));

function absoluteIndex(gi: number, ii: number): number {
  let acc = 0;
  for (let i = 0; i < gi; i++) acc += groups.value[i].items.length;
  return acc + ii;
}

function move(delta: number): void {
  const total = flat.value.length;
  if (total === 0) return;
  focusedIndex.value = (focusedIndex.value + delta + total) % total;
}

function apply(idx?: number): void {
  const i = idx ?? focusedIndex.value;
  const item = flat.value[i];
  if (!item) return;
  item.apply();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown' || e.key === 'j') { move(1); e.preventDefault(); return; }
  if (e.key === 'ArrowUp' || e.key === 'k') { move(-1); e.preventDefault(); return; }
  if (e.key === 'Home') { focusedIndex.value = 0; e.preventDefault(); return; }
  if (e.key === 'End') { focusedIndex.value = flat.value.length - 1; e.preventDefault(); return; }
  if (e.key === 'Enter') { apply(); e.preventDefault(); return; }
  if (e.key === 'Escape' || e.key === 'q') { emit('close'); e.preventDefault(); return; }
}

onMounted(async () => {
  // Land focus on the currently-selected item so the picker opens on
  // what the operator already has.
  const i = flat.value.findIndex((it) => it.current);
  if (i >= 0) focusedIndex.value = i;
  await nextTick();
  rootRef.value?.focus();
});
</script>

<style scoped>
.picker {
  position: fixed;
  inset: 0;
  background: var(--tui-bg);
  color: var(--tui-fg);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  display: flex;
  flex-direction: column;
  z-index: 600;
  outline: none;
}

.picker-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 18px;
  background: var(--tui-surface);
  border-bottom: 1px solid var(--tui-fg-dim);
}
.picker-titlebar .title {
  color: var(--tui-accent);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-size: 12px;
}
.picker-titlebar .hint {
  color: var(--tui-fg-dim);
  font-size: 11px;
}

.picker-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.group-label {
  color: var(--tui-fg-dim);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 11px;
  padding: 8px 18px 4px;
  border-bottom: 1px dashed var(--tui-fg-dim);
  margin: 6px 12px 4px;
}
.row {
  display: grid;
  grid-template-columns: 2ch 2ch 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 3px 22px;
  cursor: pointer;
}
.row .cursor { color: var(--tui-prompt); }
.row .mark { color: var(--tui-fg-dim); }
.row .label { color: var(--tui-fg); }
.row .note {
  color: var(--tui-fg-dim);
  font-size: 11px;
}
.row.current .mark,
.row.current .label { color: var(--tui-warn); }
.row.focused {
  background: var(--tui-sel-bg);
}
.row.focused .label { color: var(--tui-accent); }
.row.focused.current .label { color: var(--tui-warn); }

.picker-status {
  border-top: 1px solid var(--tui-fg-dim);
  padding: 4px 18px;
  font-size: 11px;
  background: var(--tui-surface);
  color: var(--tui-fg-dim);
  min-height: 22px;
}
.picker-status .status-cmd { color: var(--tui-ok); }
</style>
