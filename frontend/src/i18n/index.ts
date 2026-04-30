import { createI18n } from 'vue-i18n';
import en from './locales/en';
import enGB from './locales/en-GB';
import ptBR from './locales/pt-BR';
import ptPT from './locales/pt-PT';
import esES from './locales/es-ES';
import fr from './locales/fr';
import ca from './locales/ca';
import de from './locales/de';

export type LocaleCode =
  | 'en'
  | 'en-GB'
  | 'pt-BR'
  | 'pt-PT'
  | 'es-ES'
  | 'fr'
  | 'ca'
  | 'de';

export interface LocaleOption {
  code: LocaleCode;
  label: string;
  flag: string;
}

export const AVAILABLE_LOCALES: LocaleOption[] = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'en-GB', label: 'English (UK)', flag: '🇬🇧' },
  { code: 'pt-BR', label: 'Português (Brasil)', flag: '🇧🇷' },
  { code: 'pt-PT', label: 'Português (Portugal)', flag: '🇵🇹' },
  { code: 'es-ES', label: 'Español (España)', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'ca', label: 'Català', flag: '🇦🇩' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
];

export const DEFAULT_LOCALE: LocaleCode = 'en';

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  inheritLocale: true,
  locale: DEFAULT_LOCALE,
  fallbackLocale: 'en',
  messages: {
    en,
    'en-GB': enGB,
    'pt-BR': ptBR,
    'pt-PT': ptPT,
    'es-ES': esES,
    fr,
    ca,
    de,
  },
});

const LOCALE_TO_INTL: Record<LocaleCode, string> = {
  en: 'en-US',
  'en-GB': 'en-GB',
  'pt-BR': 'pt-BR',
  'pt-PT': 'pt-PT',
  'es-ES': 'es-ES',
  fr: 'fr-FR',
  ca: 'ca-ES',
  de: 'de-DE',
};

export function intlLocaleFor(code: LocaleCode): string {
  return LOCALE_TO_INTL[code] || 'en-US';
}
