import { createElement, type ComponentProps, type PropsWithChildren, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DataStateSource } from '@/api/dataState';
import type { ChargingThermalTaxSummary, ThermalTaxSample } from '../lib/chargingThermalTax';
import type { ThermalTaxStats } from '../components/charging-thermal-tax-modernization/ThermalTaxStats';
import type { ThermalPowerChart } from '../components/charging-thermal-tax-modernization/ThermalPowerChart';
import type { ThermalPhases } from '../components/charging-thermal-tax-modernization/ThermalPhases';
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
  history: {} as DataStateSource<SessionFixture[]>,
  telemetry: {} as DataStateSource<ThermalTaxSample[]>,
  historyHook: vi.fn(),
  telemetryHook: vi.fn(),
  stats: vi.fn(),
  chart: vi.fn(),
  phases: vi.fn(),
  t: (_key: string, fallback?: string) => fallback ?? _key,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: sources.t, i18n: { language: sources.locale } }),
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
  sources.history = { data: [session], fetchStatus: 'idle', isLoading: false, dataUpdatedAt: 1 };
  sources.telemetry = { data: samples, fetchStatus: 'idle', isLoading: false, dataUpdatedAt: 1 };
});
afterEach(cleanup);

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
});
