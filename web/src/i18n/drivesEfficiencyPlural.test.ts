import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import canonical from './en.json';
import driving from './en/locale-driving.json';
import operations from './en/locale-detail-operations.json';

const catalogs = [
  { name: 'canonical English', resource: canonical },
  { name: 'generated driving bundle', resource: driving },
  { name: 'generated operations fallback', resource: operations },
];

const cases = [
  { count: 0, expected: '0 drives excluded from efficiency' },
  { count: 1, expected: '1 drive excluded from efficiency' },
  { count: 2, expected: '2 drives excluded from efficiency' },
];

describe.each(catalogs)('drive efficiency exclusion copy in $name', ({ resource }) => {
  it.each(cases)('renders numeric count $count with the correct English plural', async ({ count, expected }) => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'en',
      fallbackLng: false,
      resources: { en: { translation: resource } },
      interpolation: { escapeValue: false },
    });

    expect(i18n.t(
      'operations.drives.partialEnergyTitle',
      '{{count}} drives excluded from efficiency',
      { count },
    )).toBe(expected);
  });

  it('preserves the base title and accepted count detail beside both plural variants', () => {
    expect(resource.operations.drives.partialEnergyTitle).toBe(
      '{{count}} drives excluded from efficiency',
    );
    expect(resource.operations.drives.partialEnergyTitle_one).toBe(
      '{{count}} drive excluded from efficiency',
    );
    expect(resource.operations.drives.partialEnergyTitle_other).toBe(
      '{{count}} drives excluded from efficiency',
    );
    expect(resource.operations.drives.countDetail).toBe(
      'Drives in the selected analysis window, including ongoing activity.',
    );
  });
});
