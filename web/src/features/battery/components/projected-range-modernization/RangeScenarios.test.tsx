import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import type { RangeProjection, RangeScenario } from '@/api/hooks/useAnalytics';
import catalog from '@/i18n/en.json';
import batteryCatalog from '@/i18n/en/locale-battery.json';
import { RangeScenarios } from './RangeScenarios';

vi.unmock('react-i18next');
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km' },
    formatDistance: (meters: number) => `${meters / 1000} km`,
    formatSpeed: (mps: number) => `${mps * 3.6} km/h`,
    formatTemperature: (celsius: number) => `${celsius} C`,
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: (value: number) => String(value) }),
}));

const english = createInstance();
beforeAll(async () => {
  await english.init({
    lng: 'en', fallbackLng: 'en',
    resources: { en: { translation: catalog } },
    interpolation: { escapeValue: false },
  });
});
afterEach(cleanup);

function mount(sampleCount: number) {
  const scenario: RangeScenario = {
    name: 'Highway', speed_kmh: 108, temp_c: 20,
    efficiency_wh_km: 180, range_km: 250,
    sample_count: sampleCount, extras: ['sentry'], is_current: true,
  };
  const data: RangeProjection = {
    current_range_km: 300, projected_range_km: 280, battery_level: 72,
    efficiency_factor: 0.92, factors: [], projection_curve: [],
    current_battery_pct: 72, usable_capacity_wh: 75000, health_factor: 0.95,
    scenarios: [scenario], efficiency_matrix: [], tesla_estimate_km: 300,
    your_estimate_km: 280, accuracy_note: '',
  };
  render(
    <I18nextProvider i18n={english}>
      <RangeScenarios source={deriveDataState({ data, isSuccess: true })} loading={false} />
    </I18nextProvider>,
  );
}

describe('RangeScenarios drive-count plurals', () => {
  it.each([[1, '1 drive'], [2, '2 drives'], [37, '37 drives']] as const)(
    'preserves the real sample count %i and populated scenario content',
    (count, label) => {
      mount(count);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByText(count === 1 ? '1 drives' : `${count} drive`)).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Range scenarios' })).toBeInTheDocument();
      for (const text of ['Highway', 'Current', '250 km', '108 km/h', '20 C', '180 Wh/km', 'sentry']) {
        expect(screen.getByText(text)).toBeInTheDocument();
      }
    },
  );

  it.each([0, -1, NaN])('does not invent a drive count for %s', count => {
    mount(count);
    expect(screen.queryByText(/\bdrives?\b/)).not.toBeInTheDocument();
    expect(screen.getByText('Highway')).toBeInTheDocument();
    expect(screen.getByText('250 km')).toBeInTheDocument();
  });

  it('ships singular and plural forms in the generated battery catalog', async () => {
    const generated = createInstance();
    await generated.init({ lng: 'en', resources: { en: { translation: batteryCatalog } } });
    expect(generated.t('range.drivesCount', { count: 1 })).toBe('1 drive');
    expect(generated.t('range.drivesCount', { count: 37 })).toBe('37 drives');
  });
});
