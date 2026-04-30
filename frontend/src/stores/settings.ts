import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { useIndexedDB } from '@/composables/useIndexedDB';
import { i18n, DEFAULT_LOCALE, type LocaleCode } from '@/i18n';
import {
  THEMES,
  DEFAULT_THEME_ID,
  applyTheme,
  getThemeById,
} from '@/themes';

const KEY_LOCALE = 'locale';
const KEY_THEME = 'themeId';
const KEY_VIEW_MODE = 'viewMode';
const KEY_TUI_THEME = 'tuiThemeId';

export type ViewMode = 'gui' | 'tui';

export const useSettingsStore = defineStore('settings', () => {
  const db = useIndexedDB();

  const locale = ref<LocaleCode>(DEFAULT_LOCALE);
  const themeId = ref<string>(DEFAULT_THEME_ID);
  // Optional separate theme used while the TUI shell is active. Falls
  // back to the GUI theme when unset.
  const tuiThemeId = ref<string>('');
  const viewMode = ref<ViewMode>('gui');
  const hydrated = ref(false);

  applyTheme(getThemeById(themeId.value));
  i18n.global.locale.value = locale.value;

  async function hydrate(): Promise<void> {
    try {
      const storedLocale = await db.getSetting<LocaleCode>(KEY_LOCALE);
      const storedTheme = await db.getSetting<string>(KEY_THEME);
      const storedView = await db.getSetting<ViewMode>(KEY_VIEW_MODE);
      const storedTui = await db.getSetting<string>(KEY_TUI_THEME);

      if (storedLocale) {
        locale.value = storedLocale;
        i18n.global.locale.value = storedLocale;
      }
      if (storedTheme && THEMES.some((t) => t.id === storedTheme)) {
        themeId.value = storedTheme;
        applyTheme(getThemeById(storedTheme));
      }
      if (storedView === 'tui' || storedView === 'gui') {
        viewMode.value = storedView;
      }
      if (storedTui) {
        tuiThemeId.value = storedTui;
      }
    } catch (e) {
      console.warn('Failed to hydrate settings from IndexedDB:', e);
    } finally {
      hydrated.value = true;
    }
  }

  function setLocale(code: LocaleCode): void {
    locale.value = code;
    i18n.global.locale.value = code;
    db.setSetting(KEY_LOCALE, code).catch((e) =>
      console.warn('Failed to persist locale:', e),
    );
  }

  function setTheme(id: string): void {
    const theme = getThemeById(id);
    themeId.value = theme.id;
    applyTheme(theme);
    db.setSetting(KEY_THEME, theme.id).catch((e) =>
      console.warn('Failed to persist theme:', e),
    );
  }

  function setViewMode(mode: ViewMode): void {
    viewMode.value = mode;
    db.setSetting(KEY_VIEW_MODE, mode).catch(() => {});
  }

  function setTuiTheme(id: string): void {
    tuiThemeId.value = id;
    db.setSetting(KEY_TUI_THEME, id).catch(() => {});
  }

  watch(locale, (val) => {
    document.documentElement.lang = val;
  }, { immediate: true });

  return {
    locale,
    themeId,
    tuiThemeId,
    viewMode,
    hydrated,
    hydrate,
    setLocale,
    setTheme,
    setViewMode,
    setTuiTheme,
  };
});
