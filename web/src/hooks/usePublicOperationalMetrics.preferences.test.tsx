import type { PropsWithChildren } from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { createInstance, type i18n } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import type { MetricPreferences } from '@/lib/metric-reference';
import { formatCurrencyValue } from '@/lib/currencyFormat';
import { fmtNumber, getFormatterPreferences } from '@/lib/numberFormat';
import {
  convertDistanceFromSI, convertSpeedFromSI, convertTempFromSI,
  convertPressureFromSI, convertEnergyFromSI, convertPowerFromSI,
  convertDurationFromSI,
} from '@/lib/unitConversion';
import { usePublicOperationalMetrics } from './usePublicOperationalMetrics';

const authenticated = vi.hoisted(() => ({
  settings: vi.fn(() => { throw new Error('Public preference rendering subscribed to authenticated settings'); }),
  apiSettings: vi.fn(() => { throw new Error('Public preference rendering requested API settings'); }),
  units: vi.fn(() => { throw new Error('Public preference rendering used authenticated units'); }),
  formatting: vi.fn(() => { throw new Error('Public preference rendering used authenticated currency'); }),
  numberFormatting: vi.fn(() => { throw new Error('Public preference rendering subscribed to global preferences'); }),
  metricPreferences: vi.fn(() => { throw new Error('Public preference rendering used the authenticated preference bridge'); }),
}));
vi.mock('./useSettings', () => ({ useSettings: authenticated.settings }));
vi.mock('@/api/hooks/useSettings', () => ({ useSettings: authenticated.apiSettings }));
vi.mock('./useUnits', () => ({ useUnits: authenticated.units }));
vi.mock('./useFormatting', () => ({ useFormatting: authenticated.formatting }));
vi.mock('./useNumberFormatting', () => ({ useNumberFormatting: authenticated.numberFormatting }));
vi.mock('@/components/data-display/stat-reference/useMetricPreferences', () => ({
  useMetricPreferences: authenticated.metricPreferences,
}));

type ExplicitPreferences = MetricPreferences & {
  readonly units: MetricPreferences['units'] & { readonly locale: string; readonly precision: number };
};
type PublicMetrics = ReturnType<typeof usePublicOperationalMetrics>;

const metricProfile: ExplicitPreferences = {
  units: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'Wh', power: 'W', duration: 's', locale: 'en-US', precision: 2 },
  currency: { kind: 'symbol', value: '$' },
};
const profiles: readonly { readonly name: string; readonly preferences: ExplicitPreferences }[] = [
  { name: 'metric / literal dollar / en-US / two decimals', preferences: metricProfile },
  { name: 'imperial / ISO EUR / de-DE / three decimals', preferences: {
    units: { distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi',
      energy: 'kWh', power: 'kW', duration: 'h', locale: 'de-DE', precision: 3 },
    currency: { kind: 'iso', value: 'EUR' },
  } },
  { name: 'feet and bar / literal CHF / fr-FR / zero decimals', preferences: {
    units: { distance: 'ft', speed: 'km/h', temperature: '°C', pressure: 'bar',
      energy: 'Wh', power: 'kW', duration: 'min', locale: 'fr-FR', precision: 0 },
    currency: { kind: 'symbol', value: 'CHF ' },
  } },
  { name: 'mixed public units / ISO KWD / ar-EG / four decimals', preferences: {
    units: { distance: 'km', speed: 'mph', temperature: '°F', pressure: 'bar',
      energy: 'kWh', power: 'W', duration: 'd', locale: 'ar-EG', precision: 4 },
    currency: { kind: 'iso', value: 'KWD' },
  } },
];
for (const { preferences } of profiles) {
  Object.freeze(preferences.units);
  Object.freeze(preferences.currency);
  Object.freeze(preferences);
}

const operands = Object.freeze({
  distance: 1234567.89, speed: 27.12345, temperature: -12.34567,
  pressure: 245.6789, energy: 12345.6789, power: 98765.4321,
  duration: 9876.54321, currency: 1234.56789,
});
const sourceMetrics: readonly StatMetric[] = [
  { metricId: 'distance', occurrenceId: 'source-distance', rawValue: operands.distance,
    context: <span data-testid="canonical-context">Public source distance is recorded in meters</span>,
    comparisonContent: <span data-testid="canonical-comparison">Comparison operand: 1200 m</span>,
    comparison: { metricId: 'distance', rawValue: 1200, label: 'Published comparison', signed: true,
      period: { kind: 'unknown', label: 'Source comparison window', reason: 'Unbounded public report' } } },
  { metricId: 'speed', rawValue: operands.speed },
  { metricId: 'temperature', rawValue: operands.temperature },
  { metricId: 'pressure', rawValue: operands.pressure },
  { metricId: 'energy', rawValue: operands.energy },
  { metricId: 'power', rawValue: operands.power },
  { metricId: 'duration', rawValue: operands.duration },
  { metricId: 'currency', rawValue: operands.currency },
  { metricId: 'distance', occurrenceId: 'missing-distance', rawValue: null },
  { metricId: 'energy', occurrenceId: 'invalid-energy', rawValue: Number.NaN },
  { metricId: 'count', occurrenceId: 'zero-count', rawValue: 0 },
];
const metrics = Object.freeze(sourceMetrics.map(metric => Object.freeze(metric)));

let translations: i18n;
function PublicTranslationContext({ children }: PropsWithChildren) {
  return <I18nextProvider i18n={translations}>{children}</I18nextProvider>;
}

beforeEach(async () => {
  translations = createInstance();
  await translations.use(initReactI18next).init({
    lng: 'en', fallbackLng: 'en', interpolation: { escapeValue: false },
    resources: {
      en: { translation: { developerReference: { stats: {
        metric: { distance: { label: 'Published distance', description: 'Distance supplied by the public report' } },
        reason: { missing: 'No published measurement', nonfinite: 'Published measurement is not finite' },
      } } } },
      fr: { translation: { developerReference: { stats: {
        metric: { distance: { label: 'Distance publiée', description: 'Distance fournie par le rapport public' } },
        reason: { missing: 'Aucune mesure publiée', nonfinite: 'La mesure publiée est non finie' },
      } } } },
    },
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// Independent oracle: real SI converters, numeric and currency formatters, not the adapter under test.
function expectedValues(preferences: ExplicitPreferences): readonly string[] {
  const { units, currency } = preferences;
  const number = (value: number) => fmtNumber(value, units.precision, units.locale);
  return [
    `${number(convertDistanceFromSI(operands.distance, units.distance))} ${units.distance}`,
    `${number(convertSpeedFromSI(operands.speed, units.speed))} ${units.speed}`,
    `${number(convertTempFromSI(operands.temperature, units.temperature))}${units.temperature}`,
    `${number(convertPressureFromSI(operands.pressure, units.pressure))} ${units.pressure}`,
    `${number(convertEnergyFromSI(operands.energy, units.energy))} ${units.energy}`,
    `${number(convertPowerFromSI(operands.power, units.power))} ${units.power}`,
    `${number(convertDurationFromSI(operands.duration, units.duration))} ${units.duration}`,
    currency.kind === 'iso'
      ? formatCurrencyValue(operands.currency, currency.value, units.locale, units.precision, { useGrouping: true })
      : `${currency.value}${number(operands.currency)}`,
    '—', '—', fmtNumber(0, 0, units.locale),
  ];
}

function expectPublicIsolation() {
  for (const hook of Object.values(authenticated)) expect(hook).not.toHaveBeenCalled();
}

function expectPreserved(result: PublicMetrics, preferences: ExplicitPreferences) {
  expect(result.map(metric => metric.value)).toEqual(expectedValues(preferences));
  expect(result.map(metric => metric.valueState)).toEqual([
    'value', 'value', 'value', 'value', 'value', 'value', 'value', 'value', 'missing', 'invalid', 'value',
  ]);
  result.forEach((metric, index) => {
    expect(Object.is(metric.rawValue, metrics[index].rawValue)).toBe(true);
  });
  expect(result.map(metric => metric.key)).toEqual([
    'source-distance', 'speed:1', 'temperature:2', 'pressure:3', 'energy:4', 'power:5',
    'duration:6', 'currency:7', 'missing-distance', 'invalid-energy', 'zero-count',
  ]);
  const details = render(<>{result.map(metric => <div key={metric.key}>{metric.detail}</div>)}</>);
  expect(screen.getByTestId('canonical-context')).toHaveTextContent('Public source distance is recorded in meters');
  expect(screen.getByTestId('canonical-comparison')).toHaveTextContent('Comparison operand: 1200 m');
  const comparison = fmtNumber(convertDistanceFromSI(1200, preferences.units.distance),
    preferences.units.precision, preferences.units.locale);
  expect(screen.getByText(`Published comparison: +${comparison} ${preferences.units.distance}; Source comparison window; Unbounded public report`))
    .toBeInTheDocument();
  details.unmount();
  expectPublicIsolation();
}

interface PreferenceChange {
  readonly name: string;
  readonly units?: Partial<ExplicitPreferences['units']>;
  readonly currency?: ExplicitPreferences['currency'];
  readonly changedIndex: number;
}
const changes: readonly PreferenceChange[] = [
  { name: 'distance', units: { distance: 'mi' }, changedIndex: 0 },
  { name: 'speed independently of distance', units: { speed: 'mph' }, changedIndex: 1 },
  { name: 'temperature', units: { temperature: '°F' }, changedIndex: 2 },
  { name: 'pressure', units: { pressure: 'bar' }, changedIndex: 3 },
  { name: 'energy', units: { energy: 'kWh' }, changedIndex: 4 },
  { name: 'power', units: { power: 'kW' }, changedIndex: 5 },
  { name: 'duration', units: { duration: 'h' }, changedIndex: 6 },
  { name: 'literal currency symbol', currency: { kind: 'symbol', value: 'CA$' }, changedIndex: 7 },
  { name: 'ISO currency', currency: { kind: 'iso', value: 'EUR' }, changedIndex: 7 },
  { name: 'locale only', units: { locale: 'de-DE' }, changedIndex: 0 },
  { name: 'precision only', units: { precision: 4 }, changedIndex: 0 },
];

describe('public operational metrics explicit preference matrix and rerender contract', () => {
  it.each(profiles)('renders $name without a query provider or authenticated preference subscriptions', ({ preferences }) => {
    const globalBefore = getFormatterPreferences();
    const preferenceBefore = { units: { ...preferences.units }, currency: { ...preferences.currency } };
    const { result } = renderHook(() => usePublicOperationalMetrics(metrics, preferences),
      { wrapper: PublicTranslationContext });
    expectPreserved(result.current, preferences);
    expect(result.current[0].label).toBe('Published distance');
    expect(preferences).toEqual(preferenceBefore);
    expect(getFormatterPreferences()).toBe(globalBefore);
  });

  it.each(changes)('rerenders a $name change and reversal while preserving SI, states and source context', change => {
    const globalBefore = getFormatterPreferences();
    const { result, rerender } = renderHook(
      ({ preferences }: { preferences: ExplicitPreferences }) => usePublicOperationalMetrics(metrics, preferences),
      { initialProps: { preferences: metricProfile }, wrapper: PublicTranslationContext },
    );
    const before = result.current;
    const updated: ExplicitPreferences = Object.freeze({
      units: Object.freeze({ ...metricProfile.units, ...change.units }),
      currency: Object.freeze({ ...(change.currency ?? metricProfile.currency) }),
    });
    rerender({ preferences: updated });
    expect(result.current).not.toBe(before);
    expect(result.current[change.changedIndex].value).not.toBe(before[change.changedIndex].value);
    expectPreserved(result.current, updated);
    expect(before.map(metric => metric.value)).toEqual(expectedValues(metricProfile));
    rerender({ preferences: metricProfile });
    expectPreserved(result.current, metricProfile);
    expect(getFormatterPreferences()).toBe(globalBefore);
  });

  it('retains memoized output on unrelated rerenders with unchanged metric and preference references', () => {
    const { result, rerender } = renderHook(
      ({ revision }: { revision: number }) => {
        void revision;
        return usePublicOperationalMetrics(metrics, metricProfile);
      },
      { initialProps: { revision: 0 }, wrapper: PublicTranslationContext },
    );
    const before = result.current;
    rerender({ revision: 1 });
    expect(result.current).toBe(before);
    expectPreserved(result.current, metricProfile);
  });

  it('refreshes real translated labels and unavailable reasons without replacing explicit display locale or SI', async () => {
    const { result } = renderHook(() => usePublicOperationalMetrics(metrics, profiles[1].preferences),
      { wrapper: PublicTranslationContext });
    const before = result.current;
    await act(async () => { await translations.changeLanguage('fr'); });
    expect(result.current).not.toBe(before);
    expect(result.current[0].label).toBe('Distance publiée');
    expectPreserved(result.current, profiles[1].preferences);
    render(<>{result.current[0].detail}{result.current[8].detail}{result.current[9].detail}</>);
    expect(screen.getAllByText('Distance fournie par le rapport public')).toHaveLength(2);
    expect(screen.getByText('Aucune mesure publiée')).toBeInTheDocument();
    expect(screen.getByText('La mesure publiée est non finie')).toBeInTheDocument();
    expect(before[0].label).toBe('Published distance');
  });
});
