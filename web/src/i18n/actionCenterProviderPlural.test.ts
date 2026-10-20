import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import canonical from './en.json';
import actionCenter from './en/locale-action-center.json';

const catalogs = [
  { name: 'canonical English', resource: canonical },
  { name: 'generated Action Center bundle', resource: actionCenter },
];

const cases = [
  { count: 0, expected: '0 findings' },
  { count: 1, expected: '1 finding' },
  { count: 2, expected: '2 findings' },
];

describe.each(catalogs)('Action Center provider copy in $name', ({ resource }) => {
  it.each(cases)('renders numeric count $count with the correct English plural', async ({ count, expected }) => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'en',
      fallbackLng: false,
      resources: { en: { translation: resource } },
      interpolation: { escapeValue: false },
    });

    expect(i18n.exists('actionCenter.providers.findings', { count })).toBe(true);
    expect(i18n.t('actionCenter.providers.findings', { count })).toBe(expected);
    expect(i18n.t(
      'actionCenter.providers.findings',
      '{{count}} findings',
      { count },
    )).toBe(expected);
  });

  it('preserves provider coverage copy and the base beside both plural variants', () => {
    expect(resource.actionCenter.providers).toEqual({
      title: 'Source coverage',
      description: 'Unavailable sources are shown explicitly; the inbox never invents substitute findings.',
      empty: 'No provider status was returned.',
      findings: '{{count}} findings',
      findings_one: '{{count}} finding',
      findings_other: '{{count}} findings',
    });
  });
});
