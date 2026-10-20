import { createElement, type ComponentProps, type PropsWithChildren, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import english from '@/i18n/en.json';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { ChargingThermalTaxSummary, ThermalTaxSample } from '../lib/chargingThermalTax';
import { ThermalTaxStats } from '../components/charging-thermal-tax-modernization/ThermalTaxStats';
import type { ThermalPowerChart } from '../components/charging-thermal-tax-modernization/ThermalPowerChart';
import { ThermalPhases } from '../components/charging-thermal-tax-modernization/ThermalPhases';
import { analyzeChargingThermalTax } from '../lib/chargingThermalTax';
import type { ChargingSession } from '@/types/charging';
import ChargingThermalTaxPage from './ChargingThermalTaxPage';

interface SessionFixture {
  id: string;
  vehicle_id: string;
  started_at: string;
  ended_at: string | null;
  charger_type: string | null;
}

const sources = vi.hoisted(() => ({
  locale: 'fr-FR',
  timezone: 'UTC',
  language: 'en-US',
  history: {} as DataStateSource<SessionFixture[]>,
  telemetry: {} as DataStateSource<ThermalTaxSample[]>,
  historyHook: vi.fn(),
  telemetryHook: vi.fn(),
  stats: vi.fn(),
  chart: vi.fn(),
  phases: vi.fn(),
  t: (_key: string, fallback?: string, options?: Record<string, unknown>) =>
    (fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) =>
      options?.[key] == null ? placeholder : String(options[key])),
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    locale: sources.locale,
    settings: { tz_display_default: 'user' },
  }),
}));
vi.mock('@/lib/timezone', () => ({ useTimezone: () => sources.timezone }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatPower: (value: number) => `${value} W` }),
}));
vi.mock('../components/operationalbrief-all/ChargingSummaryBrief', () => ({
  ChargingSummaryBrief: ({ period }: { period: { start?: string; end?: string | null } }) =>
    createElement('section', { 'aria-label': 'Summary timestamps' }, period.start, ' – ', period.end),
}));
vi.mock('@/components/layout/layout-reference', () => ({
  LayoutCard: ({ title, children }: PropsWithChildren<{ title: string }>) =>
    createElement('section', { 'aria-label': title }, children),
}));
vi.mock('@/components/ui', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/ui')>(),
  DataTable: ({ columns, data }: {
    columns: { key: string; render?: (row: unknown) => ReactNode }[];
    data: unknown[];
  }) => createElement('div', null, data.map((row, index) =>
    createElement('div', { key: index }, columns.map(column =>
      createElement('div', { key: column.key }, column.render?.(row)))))),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: sources.t, i18n: { language: sources.language } }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/api/hooks/useCharging', () => ({
  useChargingHistory: (vehicleId?: string) => {
    sources.historyHook(vehicleId);
    return sources.history;
  },
  useChargeTelemetry: (sessionId: number | null) => {
    sources.telemetryHook(sessionId);
    return sources.telemetry;
  },
}));
vi.mock('@/components/layout', () => ({
  PageLayout: ({ children }: PropsWithChildren) => createElement('main', null, children),
  LayoutCard: ({ title, children }: PropsWithChildren<{ title: string }>) =>
    createElement('section', { 'aria-label': title }, children),
  CardGrid: ({ items }: { items: { id: string; content: ReactNode }[] }) =>
    createElement('div', null, items.map(item => createElement('div', { key: item.id }, item.content))),
}));
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: PropsWithChildren) => <>{children}</>,
}));
vi.mock('../components/charging-thermal-tax-modernization', async () => {
  const actual = await import('../components/charging-thermal-tax-modernization/thermalPresentation');
  return {
    thermalPowerRows: actual.thermalPowerRows,
    ThermalTaxStats: (props: ComponentProps<typeof ThermalTaxStats>) => {
      sources.stats(props);
      return createElement('section', { 'aria-label': 'Charging thermal tax metrics' });
    },
    ThermalPowerChart: (props: ComponentProps<typeof ThermalPowerChart>) => {
      sources.chart(props);
      return createElement('section', { 'aria-label': 'Heater vs. Charge Power' });
    },
    ThermalPhases: (props: ComponentProps<typeof ThermalPhases>) => {
      sources.phases(props);
      return createElement('section', { 'aria-label': 'Thermal Phases' });
    },
  };
});

const session: SessionFixture = {
  id: '42', vehicle_id: '7', charger_type: 'DC',
  started_at: '2026-10-01T12:00:00Z', ended_at: '2026-10-01T12:02:00Z',
};
const samples: ThermalTaxSample[] = [
  {
    ts: '2026-10-01T12:00:00Z', battery_heater_power_w: 1000,
    ac_charging_power_w: 0, dc_charging_power_w: 5000,
    ac_charging_energy_in_wh: 0, dc_charging_energy_in_wh: 0,
  },
  {
    ts: '2026-10-01T12:01:00Z', battery_heater_power_w: 1000,
    ac_charging_power_w: 0, dc_charging_power_w: 5000,
    ac_charging_energy_in_wh: 0, dc_charging_energy_in_wh: 500,
  },
  {
    ts: '2026-10-01T12:02:00Z', battery_heater_power_w: 0,
    ac_charging_power_w: 0, dc_charging_power_w: 5000,
    ac_charging_energy_in_wh: 0, dc_charging_energy_in_wh: 1000,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  sources.locale = 'fr-FR';
  sources.timezone = 'UTC';
  sources.language = 'en-US';
  sources.history = { data: [session], fetchStatus: 'idle', isLoading: false, dataUpdatedAt: 1 };
  sources.telemetry = { data: samples, fetchStatus: 'idle', isLoading: false, dataUpdatedAt: 1 };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChargingThermalTaxPage observed history context', () => {
  it.each([0, 1, 1000])('describes %i returned rows without changing the history request', async count => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: english } } });
    vi.spyOn(sources, 't').mockImplementation((key, fallback, options) =>
      i18n.t(key, { defaultValue: fallback, ...options }));
    sources.history = {
      ...sources.history,
      data: Array.from({ length: count }, (_, index) => ({ ...session, id: String(index + 42) })),
    };
    render(<ChargingThermalTaxPage />);
    const context = screen.getByText(text => text.startsWith('Session choices use an observed window of '));
    expect(context.textContent?.replace(/\D/g, '')).toContain(`${count}1000`);
    expect(context).toHaveTextContent(/returned charging sessions.*This is not a server total or a guarantee of complete history\./);
    expect(sources.historyHook.mock.calls.every(args => args.length === 1 && args[0] === '7')).toBe(true);
    expect(screen.getAllByRole('region')).toHaveLength(4);
    if (count === 0) {
      expect(screen.getByText('No charging sessions were returned in this observed window.')).toBeInTheDocument();
    }
  });

  it('does not present unresolved history as an observed zero and retains context on refresh failure', () => {
    sources.history = { data: undefined, isLoading: true, fetchStatus: 'fetching' };
    const result = render(<ChargingThermalTaxPage />);
    expect(screen.queryByText(/Session choices use an observed window/)).not.toBeInTheDocument();
    sources.history = {
      data: [session], isLoading: false, fetchStatus: 'idle', dataUpdatedAt: 1,
      error: new Error('History refresh failed'),
    };
    result.rerender(<ChargingThermalTaxPage />);
    expect(screen.getByText(/observed window of 1 returned charging sessions/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '1 oct. · DC' })).toHaveValue('42');
    expect(screen.getAllByRole('region')).toHaveLength(4);
  });
});

describe('ChargingThermalTaxPage locale adoption', () => {
  it('formats session dates with the selected app locale rather than the browser default', () => {
    render(<ChargingThermalTaxPage />);
    const selector = screen.getByRole('combobox', { name: 'Inspect session' });
    expect(selector).toHaveAttribute('id', 'charging-thermal-tax-session');
    expect(within(selector).getByRole('option', { name: '1 oct. · DC' })).toHaveValue('42');
    expect(sources.historyHook).toHaveBeenLastCalledWith('7');
    expect(sources.telemetryHook).toHaveBeenLastCalledWith(null);
    expect(screen.getAllByRole('region')).toHaveLength(4);
  });

  it('updates date labels on a locale-only change while retaining selection and raw SI analysis', () => {
    const result = render(<ChargingThermalTaxPage />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Inspect session' }), { target: { value: '42' } });
    sources.locale = 'de-DE';
    result.rerender(<ChargingThermalTaxPage />);
    const selector = screen.getByRole('combobox', { name: 'Inspect session' });
    expect(within(selector).getByRole('option', { name: '1. Okt. · DC' })).toHaveValue('42');
    expect(selector).toHaveValue('42');
    expect(sources.telemetryHook).toHaveBeenLastCalledWith(42);
    expect(sources.stats).toHaveBeenLastCalledWith(expect.objectContaining({
      session, samples, selected: true,
      summary: expect.objectContaining({
        heaterWh: 25, deliveredEnergyWh: 1000, heaterSharePct: 2.5,
        heaterOnS: 120, peakHeaterW: 1000, energySource: 'cumulative',
      } satisfies Partial<ChargingThermalTaxSummary>),
    }));
    expect(sources.chart).toHaveBeenLastCalledWith(expect.objectContaining({
      selected: true,
      data: [
        expect.objectContaining({ heaterW: 1000, chargeW: 5000 }),
        expect.objectContaining({ heaterW: 1000, chargeW: 5000 }),
        expect.objectContaining({ heaterW: 0, chargeW: 5000 }),
      ],
    }));
    expect(sources.phases).toHaveBeenLastCalledWith(expect.objectContaining({
      selected: true, samples,
      summary: expect.objectContaining({ heaterWh: 25, heaterOnS: 120 }),
    }));
    expect(screen.getAllByRole('region')).toHaveLength(4);
  });

  it('keeps invalid dates and unknown charger values explicit without inventing readings', () => {
    sources.history = { ...sources.history, data: [{ ...session, started_at: 'invalid', charger_type: null }] };
    sources.telemetry = { ...sources.telemetry, data: [] };
    render(<ChargingThermalTaxPage />);
    const selector = screen.getByRole('combobox', { name: 'Inspect session' });
    expect(within(selector).getByRole('option', { name: '— · Unknown charger' })).toHaveValue('42');
    expect(selector).toHaveValue('');
    expect(sources.telemetryHook).toHaveBeenLastCalledWith(null);
    expect(sources.stats).toHaveBeenLastCalledWith(expect.objectContaining({ selected: false, samples: [] }));
    expect(screen.getAllByRole('region')).toHaveLength(4);
  });

  it('updates the selector and short chart labels across a saved-timezone day boundary without changing raw instants', () => {
    const boundarySession = { ...session, started_at: '2026-10-01T00:30:00Z' };
    const boundarySamples = samples.map((sample, index) => ({
      ...sample, ts: `2026-10-01T00:3${index}:00Z`,
    }));
    sources.history = { ...sources.history, data: [boundarySession] };
    sources.telemetry = { ...sources.telemetry, data: boundarySamples };
    sources.timezone = 'America/Los_Angeles';
    const result = render(<ChargingThermalTaxPage />);
    const selector = screen.getByRole('combobox', { name: 'Inspect session' });
    expect(within(selector).getByRole('option', { name: '30 sept. · DC' })).toHaveValue('42');
    fireEvent.change(selector, { target: { value: '42' } });
    expect(sources.chart).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({
        time: '17:30', tMs: Date.parse(boundarySamples[0].ts),
      })]),
    }));
    sources.timezone = 'Asia/Tokyo';
    result.rerender(<ChargingThermalTaxPage />);
    expect(within(selector).getByRole('option', { name: '1 oct. · DC' })).toHaveValue('42');
    expect(selector).toHaveValue('42');
    expect(sources.chart).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({
        time: '09:30', tMs: Date.parse(boundarySamples[0].ts),
      })]),
    }));
    expect(sources.stats).toHaveBeenLastCalledWith(expect.objectContaining({
      session: boundarySession, samples: boundarySamples,
      summary: analyzeChargingThermalTax(boundarySamples),
    }));
    expect(boundarySession.started_at).toBe('2026-10-01T00:30:00Z');
  });

  it('keeps missing selector dates explicit and excludes unusable chart instants', () => {
    sources.history = { ...sources.history, data: [{ ...session, started_at: '' }] };
    sources.telemetry = { ...sources.telemetry, data: [
      { ...samples[0], ts: '' }, { ...samples[0], ts: 'invalid' }, samples[0],
    ] };
    render(<ChargingThermalTaxPage />);
    expect(screen.getByRole('option', { name: '— · DC' })).toHaveValue('42');
    expect(sources.chart).toHaveBeenLastCalledWith(expect.objectContaining({
      data: [{ tMs: Date.parse(samples[0].ts), timestamp: samples[0].ts, time: '12:00', heaterW: 1000, chargeW: 5000 }],
    }));
  });

  it('updates directly rendered summary timestamps and phase bounds on preference-only changes', () => {
    const boundarySession: ChargingSession = {
      ...session, start_soc_pct: 20, end_soc_pct: null, total_energy_added_wh: 1000,
      peak_power_w: null, cost_decimal: null,
      started_at: '2026-10-01T00:30:00Z', ended_at: '2026-10-01T00:32:00Z',
      start_ts: '2026-10-01T00:30:00Z', startedAt: '2026-10-01T00:30:00Z', duration_min: 2,
    };
    const boundarySamples = samples.map((sample, index) => ({
      ...sample, ts: `2026-10-01T00:3${index}:00Z`,
    }));
    const summary = analyzeChargingThermalTax(boundarySamples);
    function Sections() {
      const props = {
        selected: true, loading: false, samples: boundarySamples, summary,
        state: deriveDataState(sources.telemetry),
      };
      return <>
        <ThermalTaxStats {...props} session={boundarySession} />
        <ThermalPhases {...props} />
      </>;
    }
    sources.timezone = 'America/Los_Angeles';
    const result = render(<Sections />);
    expect(screen.getByRole('region', { name: 'Summary timestamps' })).toHaveTextContent(
      '30 sept. 2026, 17:30 – 30 sept. 2026, 17:32',
    );
    expect(screen.getAllByText('30 sept. 2026, 17:30')).toHaveLength(1);
    sources.locale = 'de-DE';
    sources.timezone = 'Asia/Tokyo';
    result.rerender(<Sections />);
    expect(screen.getByRole('region', { name: 'Summary timestamps' })).toHaveTextContent(
      '1. Okt. 2026, 09:30 – 1. Okt. 2026, 09:32',
    );
    expect(screen.getAllByText('1. Okt. 2026, 09:30')).toHaveLength(1);
    expect(summary.phases[0].startMs).toBe(Date.parse(boundarySamples[0].ts));
    expect(boundarySession.started_at).toBe('2026-10-01T00:30:00Z');
  });

  it('renders invalid summary and phase dates as placeholders and leaves an absent end absent', () => {
    const invalidSession: ChargingSession = {
      ...session, started_at: 'invalid', ended_at: null,
      start_ts: 'invalid', startedAt: 'invalid', duration_min: 2,
      start_soc_pct: 20, end_soc_pct: null, total_energy_added_wh: 1000,
      peak_power_w: null, cost_decimal: null,
    };
    const summary = analyzeChargingThermalTax(samples);
    summary.phases = [{ ...summary.phases[0], startMs: NaN, endMs: NaN }];
    const props = {
      selected: true, loading: false, samples, summary,
      state: deriveDataState(sources.telemetry),
    };
    render(<>
      <ThermalTaxStats {...props} session={invalidSession} />
      <ThermalPhases {...props} />
    </>);
    expect(screen.getByRole('region', { name: 'Summary timestamps' })).toHaveTextContent('— –');
    const phases = screen.getByRole('region', { name: 'Thermal Phases' });
    expect(within(phases).getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Invalid Date|NaN/)).not.toBeInTheDocument();
  });
});
