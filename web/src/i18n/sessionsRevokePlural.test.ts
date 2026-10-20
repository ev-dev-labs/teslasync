import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import canonical from './en.json';
import unreferenced from './en/locale-unreferenced.json';

const catalogs = [
  { name: 'canonical English', resource: canonical, key: 'settingsSessions.toasts.revokedAllOthers' },
  { name: 'generated unreferenced bundle', resource: unreferenced, key: 'settingsSessions.toasts.revokedAllOthers' },
];

const cases = [
  { count: 0, displayCount: '0', expected: 'Signed out 0 other devices.' },
  { count: 1, displayCount: '1', expected: 'Signed out 1 other device.' },
  { count: 3, displayCount: '3', expected: 'Signed out 3 other devices.' },
  { count: 1234, displayCount: '1,234', expected: 'Signed out 1,234 other devices.' },
];

describe.each(catalogs)('session revoke-all toast copy in $name', ({ resource, key }) => {
  it.each(cases)('renders count $count with the correct English plural', async ({ count, displayCount, expected }) => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'en',
      fallbackLng: false,
      resources: { en: { translation: resource } },
      interpolation: { escapeValue: false },
    });

    expect(i18n.t(
      key,
      'Signed out {{displayCount}} other devices.',
      { count, displayCount },
    )).toBe(expected);
  });
});

describe('session revoke-all toast plural leaves', () => {
  it('preserves the base template beside both plural variants in canonical English', () => {
    expect(canonical.settingsSessions.toasts.revokedAllOthers).toBe(
      'Signed out {{count}} other devices.',
    );
    expect(canonical.settingsSessions.toasts.revokedAllOthers_one).toBe(
      'Signed out {{displayCount}} other device.',
    );
    expect(canonical.settingsSessions.toasts.revokedAllOthers_other).toBe(
      'Signed out {{displayCount}} other devices.',
    );
  });

  it('preserves the base template beside both plural variants in the generated bundle', () => {
    expect(unreferenced.settingsSessions.toasts.revokedAllOthers).toBe(
      'Signed out {{count}} other devices.',
    );
    expect(unreferenced.settingsSessions.toasts.revokedAllOthers_one).toBe(
      'Signed out {{displayCount}} other device.',
    );
    expect(unreferenced.settingsSessions.toasts.revokedAllOthers_other).toBe(
      'Signed out {{displayCount}} other devices.',
    );
  });
});
