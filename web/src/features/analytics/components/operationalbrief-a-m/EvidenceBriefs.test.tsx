import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildCarbonIntelligence } from '../../lib/carbonIntelligence';
import { summarizeArchetypes } from '../../lib/driveArchetypes';
import type { CarbonDisplay, CarbonQueryState } from '../carbon-intelligence/types';
import type { ArchetypeDisplay, ArchetypeQueryState } from '../drive-archetypes/types';
import { CarbonEvidenceBrief } from './CarbonEvidenceBrief';
import { CarbonFootprintBrief } from './CarbonFootprintBrief';
import { CarbonLifetimeBrief } from './CarbonLifetimeBrief';
import { CarbonCoverageBrief } from './CarbonCoverageBrief';
import { CarbonDirectoryBrief } from './CarbonDirectoryBrief';
import { CarbonRecommendationBrief } from './CarbonRecommendationBrief';
import { CarbonOpportunityBrief } from './CarbonOpportunityBrief';
import { ArchetypeEvidenceBrief } from './ArchetypeEvidenceBrief';
import { ArchetypeSourceBrief } from './ArchetypeSourceBrief';
import { ArchetypeCoverageBrief } from './ArchetypeCoverageBrief';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C',
    pressure: 'kPa', energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US' } }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtInt: (raw: number) => String(raw),
    fmtScientificNumber: (raw: number, precision: number) => raw.toFixed(precision),
    fmtPercent: (raw: number) => `${raw.toFixed(2)}%`,
  }),
}));
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const carbonState = (overrides: Partial<CarbonQueryState> = {}): CarbonQueryState => ({
  enabled: true, hasData: true, isLoading: false, isResolved: true, isFetching: false,
  isPaused: false, refreshPaused: false, error: null, refreshError: null, onRetry: vi.fn(), ...overrides,
});
const archetypeState = (overrides: Partial<ArchetypeQueryState> = {}): ArchetypeQueryState => ({
  vehicleSelected: true, hasData: true, isLoading: false, isResolved: true, isFetching: false,
  isPaused: false, refreshPaused: false, error: null, refreshError: null, onRetry: vi.fn(), ...overrides,
});
const number = (raw: number | null | undefined) => raw == null ? '—' : raw.toFixed(2);
const carbonDisplay: CarbonDisplay = {
  energyUnit: 'kWh', energyValue: raw => raw / 1000,
  formatEnergy: raw => raw == null ? '—' : `${number(raw / 1000)} kWh`,
  formatDistance: raw => raw == null ? '—' : `${number(raw / 1000)} km`,
  formatKg: raw => raw == null ? '—' : `${number(raw)} kg CO₂`,
  formatSignedKg: raw => raw == null ? '—' : `${raw > 0 ? '+' : ''}${number(raw)} kg CO₂`,
  formatIntensity: raw => raw == null ? '—' : `${number(raw)} g CO₂/kWh`,
  formatPercent: raw => `${number(raw)}%`, formatNumber: number,
  formatHour: raw => raw == null ? '—' : `${String(raw).padStart(2, '0')}:00`, formatMonth: raw => raw,
};
const archetypeDisplay: ArchetypeDisplay = {
  distanceUnit: 'km', speedUnit: 'km/h', temperatureUnit: '°C', energyUnit: 'kWh',
  efficiencyUnit: 'Wh/km', locale: 'en-US', distanceValue: raw => raw / 1000,
  speedValue: raw => raw * 3.6, temperatureValue: raw => raw, energyValue: raw => raw / 1000,
  efficiencyValue: raw => raw * 1000, formatDistance: number, formatSpeed: number,
  formatTemperature: number, formatEnergy: number, formatDuration: raw => `${number(raw)} s`,
  formatEfficiency: number, formatDateTime: raw => raw == null ? '—' : new Date(raw).toISOString(),
  formatMonth: raw => raw, formatHour: raw => `${raw}:00`,
};
const analysis = buildCarbonIntelligence({
  intensity: { curve: [{ hour_of_day: 0, g_co2_per_kwh: 100 }] },
  periodSummary: { total_energy_kwh: 2.5, total_co2_kg: 0.5, gas_equiv_co2_kg: 0.4,
    co2_saved_kg: -0.1, green_score: 50, sessions_scored: 1, monthly: [] },
  lifetimeSummary: { total_energy_kwh: 10, total_co2_kg: 2, gas_equiv_co2_kg: 4,
    co2_saved_kg: 2, green_score: 50, sessions_scored: 4, monthly: [] },
  recommendation: undefined,
  window: { startLabel: '2026-01-01', endLabel: '2026-06-30',
    startInstant: '2026-01-01T00:00:00Z', endInstantExclusive: '2026-07-01T00:00:00Z', timezone: 'UTC' },
});

describe('real carbon and archetype raw bridge and retained drawers', () => {
  it('retains Wh, signed kg, counts, intensity source units and exact analysis bounds', () => {
    const original = JSON.stringify(analysis);
    const state = carbonState({ refreshPaused: true });
    const { container } = render(<MemoryRouter><CarbonEvidenceBrief analysis={analysis}
      display={carbonDisplay} states={{ period: state, intensity: carbonState(), lifetime: carbonState(), recommendation: carbonState() }} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(screen.getByText('Retained evidence')).toBeInTheDocument();
    expect(screen.getByText('2.50 kWh')).toBeInTheDocument();
    expect(screen.getByText('-0.10 kg CO₂')).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01T00:00:00Z – 2026-07-01T00:00:00Z · UTC/)).toBeInTheDocument();
    expect(vi.mocked(useOperationalMetrics).mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ occurrenceId: 'carbon-period-energy', metricId: 'energy', rawValue: 2500 }),
      expect.objectContaining({ occurrenceId: 'carbon-period-net', metricId: 'mass', rawValue: analysis.period.netAvoidedCo2Kg }),
    ]));
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('Gas baseline minus attributed charging CO₂')).toBeInTheDocument();
    expect(JSON.stringify(analysis)).toBe(original);
  });
  it.each([
    [CarbonFootprintBrief, 4], [CarbonLifetimeBrief, 4], [CarbonCoverageBrief, 5],
    [CarbonDirectoryBrief, 5], [CarbonRecommendationBrief, 4], [CarbonOpportunityBrief, 5],
  ] as const)('keeps the supplemental carbon band and real review drawer', (Component, count) => {
    const state = carbonState({ hasData: false, isLoading: true, isResolved: false });
    const { container } = render(<MemoryRouter><Component analysis={analysis} display={carbonDisplay}
      states={{ period: state, intensity: state, lifetime: state, recommendation: state }} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(count);
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[data-value-state="value"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('keeps all thirteen disposition counts and all six bounded coverage fields', () => {
    const summary = summarizeArchetypes([], { timeZone: 'UTC' });
    const state = archetypeState({ refreshError: new Error('refresh failed') });
    const { container } = render(<MemoryRouter>
      <ArchetypeSourceBrief summary={summary} state={state} />
      <ArchetypeCoverageBrief summary={summary} state={state} display={archetypeDisplay} />
    </MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(19);
    expect(screen.getAllByText('Retained evidence')).toHaveLength(2);
    expect(vi.mocked(useOperationalMetrics).mock.calls[0]?.[0].every(metric => typeof metric.rawValue === 'number')).toBe(true);
    const sourceDrawerButton = screen.getAllByRole('button', { name: 'Review details' })[0];
    if (!sourceDrawerButton) throw new Error('Missing source disposition Review details action');
    fireEvent.click(sourceDrawerButton);
    expect(within(screen.getByRole('dialog')).getByText('Eligible · imputed temperature')).toBeInTheDocument();
  });
  it('distinguishes initial archetype loading from resolved empty evidence', () => {
    const summary = summarizeArchetypes([], { timeZone: 'UTC' });
    const state = archetypeState({ hasData: false, isLoading: true, isResolved: false });
    const { container } = render(<MemoryRouter><ArchetypeEvidenceBrief summary={summary} state={state} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(vi.mocked(useOperationalMetrics).mock.calls[0]?.[0].every(metric => metric.rawValue == null)).toBe(true);
  });
});
