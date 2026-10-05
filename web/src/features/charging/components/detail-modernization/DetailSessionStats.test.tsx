import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ChargingSession } from '@/api/types';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { DetailSessionStats, type DetailSessionStatsProps } from './DetailSessionStats';

const state = vi.hoisted(() => ({ energy: 'kWh' as 'Wh' | 'kWh' }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: state.energy, duration: 'h', power: 'W', locale: 'en-US',
  },
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('@/components/ui', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/ui')>(),
  Tooltip: ({ content, children }: { content: ReactNode; children: ReactNode }) =>
    <span title={String(content)}>{children}</span>,
  HelpTooltip: ({ i18nKey }: { i18nKey: string }) => <span data-help-key={i18nKey} />,
}));

const session: ChargingSession = Object.freeze({
  id: 42, vehicle_id: 7, started_at: '2026-10-01T10:00:00Z', ended_at: '2026-10-01T11:00:00Z',
  start_soc_pct: 20, end_soc_pct: 80, delta_soc_pct: 60, start_odometer_m: null,
  end_odometer_m: null, start_lat: null, start_lng: null, start_place: null,
  total_energy_added_wh: 42620, peak_power_w: 150000, avg_power_w: 100000,
  cost_decimal: 20.88, cost_currency: 'USD', charger_type: 'DC', cable_type: null,
  startedAt: '2026-10-01T10:00:00Z', duration_min: 60,
});
const props: DetailSessionStatsProps = {
  session, energy: 44490.6, duration: 60, vehicleEnergy: 42620, billedEnergy: 44490.6,
  cost: 21.8, billedCost: 21.8, costText: '$21.80', configuredRate: 0.12,
  calculatedRate: 0.49, rateText: '$0.49/kWh', currencySymbol: '$',
  distanceText: '—', averageRate: 44.4906, retained: false,
};
const originalPreferences = getFormatterPreferences();
beforeEach(() => { state.energy = 'kWh'; setGlobalPrecision(2); setGlobalLocale('en-US'); });
afterEach(() => {
  cleanup();
  setGlobalPrecision(originalPreferences.precision);
  setGlobalLocale(originalPreferences.locale);
});

function metric(container: HTMLElement, label: string): Element {
  const item = Array.from(container.querySelectorAll('[data-stat]'))
    .find(tile => tile.querySelector('[data-stat-label]')?.textContent === label);
  if (!item) throw new Error(`Missing retained metric: ${label}`);
  return item;
}
function text(container: HTMLElement, label: string): string {
  const tile = metric(container, label);
  const value = tile.querySelector('[data-stat-value]')?.textContent ?? '';
  const unit = tile.querySelector('[data-stat-unit]')?.textContent ?? '';
  return unit ? `${value} ${unit}` : value;
}

describe('detail stats bind real canonical formatting without changing specialist semantics', () => {
  it('retains eight readings, cabinet/pack distinctions, cost/rate contracts and exact event period', () => {
    const before = JSON.stringify(props);
    const { container } = render(<DetailSessionStats {...props} />);
    expect(container.querySelectorAll('[data-stat]')).toHaveLength(8);
    expect(text(container, 'Energy')).toBe('44.49 kWh');
    expect(text(container, 'Duration')).toBe('60.00 min');
    expect(text(container, 'Peak Power')).toBe('150.00 kW');
    expect(text(container, 'SoC Range')).toBe('20.00–80.00%');
    expect(text(container, 'Total Cost')).toBe('$21.80');
    expect(text(container, 'Per kWh')).toBe('$0.49/kWh');
    expect(text(container, 'Miles Added')).toBe('—');
    expect(text(container, 'kWh/h Avg')).toBe('44.49 kWh/h');
    expect(screen.getByText('Vehicle measured 42.62 kWh')).toBeInTheDocument();
    expect(screen.getByText('Tesla invoice')).toBeInTheDocument();
    expect(container.querySelector('[data-help-key]')).toHaveAttribute('data-help-key', 'charging.detail.billedEnergyHelp');
    expect(container.querySelector('[data-period-kind]')).toHaveAttribute('data-period-kind', 'event');
    expect(container.querySelector('[data-stat-period]')).toHaveTextContent('Charge Session #42');
    expect(JSON.stringify(props)).toBe(before);
  });
  it('retains settings estimates, meaningful zero, absent rate/distance and ongoing event without all-time claims', () => {
    const { container } = render(<DetailSessionStats {...props}
      session={{ ...session, ended_at: null, cost_decimal: null, peak_power_w: null, end_soc_pct: null }}
      energy={50000} duration={0} billedEnergy={null} cost={null} billedCost={null}
      costText="$6.00" calculatedRate={null} rateText="$0.12/kWh" averageRate={null} />);
    expect(text(container, 'Est. Cost')).toBe('$6.00');
    expect(text(container, 'Duration')).toBe('0.00 min');
    expect(text(container, 'Peak Power')).toBe('0.00 kW'); // Original fallback, not a new assumption.
    expect(text(container, 'SoC Range')).toBe('20.00–0.00%');
    expect(text(container, 'kWh/h Avg')).toBe('—');
    expect(screen.getByText('at $0.12/kWh')).toBeInTheDocument();
    expect(screen.getByText('from settings')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/all time|lifetime|complete window/i);
  });
  it('updates chosen energy units and precision while fixed source power/duration and supplied currency text survive', () => {
    const { container, rerender } = render(<DetailSessionStats {...props} />);
    act(() => { setGlobalPrecision(3); });
    expect(text(container, 'Energy')).toBe('44.491 kWh');
    state.energy = 'Wh';
    rerender(<DetailSessionStats {...props} retained distanceText="source specialist range" />);
    expect(text(container, 'Energy')).toBe('44,490.600 Wh');
    expect(text(container, 'Duration')).toBe('60.000 min');
    expect(text(container, 'Peak Power')).toBe('150.000 kW');
    expect(text(container, 'Total Cost')).toBe('$21.80');
    expect(text(container, 'Miles Added')).toBe('source specialist range');
    expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
  });
});
