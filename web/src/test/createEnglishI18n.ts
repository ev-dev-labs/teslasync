import { createInstance } from 'i18next';
import english from '@/i18n/en.json';

export async function createEnglishI18n() {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: false,
    defaultNS: 'dashboard',
    fallbackNS: 'translation',
    resources: { en: { translation: english } },
    interpolation: { escapeValue: false },
  });
  return i18n;
}
