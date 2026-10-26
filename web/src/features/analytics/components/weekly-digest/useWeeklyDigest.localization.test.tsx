import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import en from '@/i18n/en.json';
import { formatDateShort } from '@/lib/dateFormat';
import { getWeekRange } from './helpers';
import { useWeeklyDigest } from './useWeeklyDigest';
import { DrivingSection } from './DrivingSection';
import { ChargingSection } from './ChargingSection';

const state = vi.hoisted(() => ({
  locale: 'de-DE',
  language: 'de',
  distance: 'km' as 'km' | 'mi',
}));
const translations = createInstance();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translations.getFixedT(state.language),
    i18n: translations,
  }),
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ locale: state.locale, settings: { timezone_user: '', tz_display_default: 'vehicle' } }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: state.distance, energy: 'kWh' },
    formatDistance: (value: number) => String(value),
    formatDuration: (value: number) => String(value),
    formatEnergy: (value: number) => String(value),
    formatPower: (value: number) => String(value),
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: (value: number) => String(value) }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 1, vehicles: [], setVehicleId: vi.fn() }),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ isLoading: false }),
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: () => {
    const [start] = getWeekRange(0);
    start.setHours(12);
    return { data: [{ id: 7, startTs: start.toISOString(), distanceM: 12_345, energyUsedWh: 2_500, durationS: 600 }] };
  },
}));
vi.mock('@/api/hooks/useCharging', () => ({
  useChargingSessionsPaginated: () => {
    const [start] = getWeekRange(0);
    start.setDate(start.getDate() + 6);
    start.setHours(12);
    return { data: [{ id: 8, started_at: start.toISOString(), total_energy_added_wh: 4_567 }] };
  },
}));
vi.mock('@/api/hooks/useNotifications', () => ({
  useAlertHistory: () => {
    const [start] = getWeekRange(0);
    start.setHours(12);
    return { data: ['warning', 'info', 'critical', 'mystery'].map((severity, id) => ({
      id, vehicle_id: 1, severity, created_at: start.toISOString(),
    })) };
  },
}));
vi.mock('@/api/hooks/useAnalytics', () => ({
  useFsdInsightsRange: () => ({ data: null }),
}));
vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    EmbeddedChart: ({ title }: { title: string }) => <div role="img" aria-label={title} />,
  };
});

beforeAll(async () => {
  await translations.init({
    lng: 'de',
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      de: {
        translation: {
          analytics: {
            weeklyDigest: {
              weekdays: { mon: 'Mo', tue: 'Di', wed: 'Mi', thu: 'Do', fri: 'Fr', sat: 'Sa', sun: 'So' },
              severities: { info: 'Information', warning: 'Warnung', critical: 'Kritisch' },
            },
          },
        },
      },
    },
  });
});
beforeEach(() => {
  state.locale = 'de-DE';
  state.language = 'de';
  state.distance = 'km';
});

describe('weekly digest localization', () => {
  it('translates known labels while retaining Monday-first bins, severity order, counts and SI values', () => {
    const { result, rerender } = renderHook(() => useWeeklyDigest());
    expect(result.current.dailyDistanceData.map(entry => entry.day)).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
    expect(result.current.dailyDistanceData.map(entry => entry.distanceM)).toEqual([12_345, 0, 0, 0, 0, 0, 0]);
    expect(result.current.dailyEnergyData.map(entry => entry.day)).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
    expect(result.current.dailyEnergyData.map(entry => entry.energyWh)).toEqual([0, 0, 0, 0, 0, 0, 4_567]);
    expect(result.current.alertPieData.map(entry => entry.name)).toEqual(['Warnung', 'Information', 'Kritisch', 'Mystery']);
    const colors = result.current.alertPieData.map(entry => entry.color);
    expect(result.current.metrics.alertsByType).toEqual({ warning: 1, info: 1, critical: 1, mystery: 1 });
    state.language = 'en';
    rerender();
    expect(result.current.dailyDistanceData.map(entry => entry.day)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(result.current.alertPieData.map(entry => entry.name)).toEqual(['Warning', 'Info', 'Critical', 'Mystery']);
    expect(result.current.alertPieData.map(entry => entry.color)).toEqual(colors);
    expect(result.current.alertPieData.map(entry => entry.value)).toEqual([1, 1, 1, 1]);
    expect(result.current.metrics.totalDistanceM).toBe(12_345);
    expect(result.current.metrics.topDrive?.id).toBe(7);
  });

  it('uses the saved date locale independently of the translation language and responds to changes', () => {
    const { result, rerender } = renderHook(() => useWeeklyDigest());
    // Mirror the hook: weeks framed in the resolved zone (UTC under these
    // stubs: vehicle mode, no vehicle zone, empty override).
    const [start, end] = getWeekRange(0, 'UTC');
    const expected = (locale: string) =>
      `${formatDateShort(start, { locale, tz: 'UTC' })} – ${formatDateShort(end, { locale, tz: 'UTC' })}`;
    expect(result.current.weekLabel).toBe(expected('de-DE'));
    state.locale = 'fr-FR';
    rerender();
    expect(result.current.weekLabel).toBe(expected('fr-FR'));
    expect(result.current.weekLabel).not.toBe(expected('de-DE'));
  });

  it.each(['km', 'mi'] as const)('interpolates chart titles using the displayed %s and energy units', distance => {
    state.language = 'en';
    state.distance = distance;
    const { result } = renderHook(() => useWeeklyDigest());
    const { metrics, dailyDistanceData, dailyEnergyData } = result.current;
    render(<>
      <DrivingSection metrics={{ ...metrics, topDrive: undefined }} dailyDistanceData={dailyDistanceData} />
      <ChargingSection metrics={metrics} dailyEnergyData={dailyEnergyData} />
    </>);
    expect(screen.getByRole('img', { name: `Daily distance (${distance})` })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Daily energy added (kWh)' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /{{unit}}/ })).not.toBeInTheDocument();
  });
});
