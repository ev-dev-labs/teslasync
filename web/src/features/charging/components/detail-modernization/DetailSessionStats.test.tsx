import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  const item = Array.from(container.querySelectorAll('[data-operational-metric]'))
    .find(tile => tile.querySelector(':scope > div:first-child')?.textContent === label);
  if (!item) throw new Error(`Missing retained metric: ${label}`);
  return item;
}
function text(container: HTMLElement, label: string): string {
  const tile = metric(container, label);
  return tile.querySelector('[data-operational-value]')?.textContent ?? '';
}
// The redesigned face shows live values only; context, scope and hidden
// counts live in the Review-details drawer.
function openDetails(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
  return screen.getByRole('dialog');
}
function groupByLabel(dialog: HTMLElement, label: string): HTMLElement {
  return within(dialog).getByRole('group', { name: label });
}

describe('detail stats bind real canonical formatting without changing specialist semantics', () => {
  it('retains eight readings, cabinet/pack distinctions, cost/rate contracts and exact event period', () => {
    const before = JSON.stringify(props);
    const { container } = render(<DetailSessionStats {...props} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(7);
    expect(text(container, 'Energy')).toBe('44.49 kWh');
    expect(text(container, 'Duration')).toBe('60.00 min');
    expect(text(container, 'Peak Power')).toBe('150.00 kW');
    expect(text(container, 'SoC Range')).toBe('20.00–80.00%');
    expect(text(container, 'Total Cost')).toBe('$21.80');
    expect(text(container, 'Per kWh')).toBe('$0.49/kWh');
    expect(text(container, 'kWh/h Avg')).toBe('44.49 kWh/h');
    const dialog = openDetails();
    expect(within(dialog).getByText('1 empty field is hidden.')).toBeInTheDocument();
    expect(groupByLabel(dialog, 'Energy')).toHaveTextContent('Vehicle measured 42.62 kWh');
    expect(groupByLabel(dialog, 'Total Cost')).toHaveTextContent('Tesla invoice');
    expect(dialog.querySelector('[data-help-key]')).toHaveAttribute('data-help-key', 'charging.detail.billedEnergyHelp');
    expect(container.querySelector('[data-period-kind]')).toHaveAttribute('data-period-kind', 'event');
    expect(within(dialog).getByText(/Charge Session #42/)).toBeInTheDocument();
    expect(JSON.stringify(props)).toBe(before);
  });
  it('retains settings estimates, meaningful zero, absent rate/distance and ongoing event without all-time claims', () => {
    const { container } = render(<DetailSessionStats {...props}
      session={{ ...session, ended_at: null, cost_decimal: null, peak_power_w: null, end_soc_pct: null }}
      energy={50000} duration={0} billedEnergy={null} cost={null} billedCost={null}
      costText="$6.00" calculatedRate={null} rateText="$0.12/kWh" averageRate={null} />);
    expect(text(container, 'Est. Cost')).toBe('$6.00');
    expect(text(container, 'SoC Range')).toBe('20.00–—%');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    const dialog = openDetails();
    expect(within(dialog).getByText('4 empty fields are hidden.')).toBeInTheDocument();
    expect(groupByLabel(dialog, 'Est. Cost')).toHaveTextContent('at $0.12/kWh');
    expect(groupByLabel(dialog, 'Per kWh')).toHaveTextContent('from settings');
    expect(container.textContent).not.toMatch(/all time|lifetime|complete window/i);
  });
  it.each([null, NaN, Infinity, -Infinity])('keeps missing/invalid measurements unavailable (%s)', value => {
    const { container } = render(<DetailSessionStats {...props}
      session={{ ...session, total_energy_added_wh: value, peak_power_w: value,
        start_soc_pct: value, end_soc_pct: value }}
      energy={value} duration={value} vehicleEnergy={value} billedEnergy={null}
      cost={value} billedCost={null} configuredRate={null} calculatedRate={value}
      costText="$0.00" rateText="$0.00/kWh" distanceM={value} distanceText="0 km"
      averageRate={value} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(screen.getByText('No metric values are available yet.')).toBeInTheDocument();
    const dialog = openDetails();
    expect(within(dialog).getByText('8 empty fields are hidden.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });
  it.each([
    ['invalid', 'not-a-date', session.ended_at],
    ['invalid end', session.started_at, 'not-a-date'],
    ['reversed', session.ended_at!, session.started_at],
  ])('does not present %s timestamps as a zero duration', (_name, started_at, ended_at) => {
    const { container } = render(<DetailSessionStats {...props}
      session={{ ...session, started_at, ended_at }} duration={0} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(5);
    expect(text(container, 'Energy')).toBe('44.49 kWh');
    const dialog = openDetails();
    expect(within(dialog).getByText('3 empty fields are hidden.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('0.00 min');
  });
  it('preserves measured zero including completed zero duration and both SoC endpoints', () => {
    const { container } = render(<DetailSessionStats {...props}
      session={{ ...session, ended_at: session.started_at, total_energy_added_wh: 0,
        peak_power_w: 0, start_soc_pct: 0, end_soc_pct: 0 }}
      energy={0} duration={0} vehicleEnergy={0} cost={0} billedCost={0}
      calculatedRate={0} costText="$0.00" rateText="$0.00/kWh"
      distanceM={0} distanceText="0 km" averageRate={0} />);
    for (const label of ['Energy', 'Duration', 'Peak Power', 'SoC Range', 'Total Cost',
      'Per kWh', 'Miles Added', 'kWh/h Avg']) {
      expect(metric(container, label)).toHaveAttribute('data-value-state', 'value');
    }
    expect(text(container, 'Energy')).toBe('0.00 kWh');
    expect(text(container, 'Duration')).toBe('0.00 min');
    expect(text(container, 'Peak Power')).toBe('0.00 kW');
    expect(text(container, 'SoC Range')).toBe('0.00–0.00%');
    expect(text(container, 'Total Cost')).toBe('$0.00');
    const dialog = openDetails();
    expect(groupByLabel(dialog, 'Energy')).toHaveTextContent('Vehicle measured 0.00 kWh');
  });
  it('retains signed and fractional measurements without positive-only filtering', () => {
    const { container } = render(<DetailSessionStats {...props}
      session={{ ...session, peak_power_w: -1250, start_soc_pct: 0, end_soc_pct: 0.25 }}
      energy={-1250} duration={0.25} vehicleEnergy={-250} cost={-0.125}
      calculatedRate={-0.5} costText="-$0.125" rateText="-$0.50/kWh"
      distanceM={-125.5} distanceText="-0.1255 km" averageRate={-0.125} />);
    expect(text(container, 'Energy')).toBe('-1.25 kWh');
    expect(text(container, 'Duration')).toBe('0.25 min');
    expect(text(container, 'Peak Power')).toBe('-1.25 kW');
    expect(text(container, 'SoC Range')).toBe('0.00–0.25%');
    expect(text(container, 'Total Cost')).toBe('-$0.125');
    expect(text(container, 'Per kWh')).toBe('-$0.50/kWh');
    expect(text(container, 'Miles Added')).toBe('-0.1255 km');
    expect(text(container, 'kWh/h Avg')).toBe('-0.13 kWh/h');
    const dialog = openDetails();
    expect(groupByLabel(dialog, 'Energy')).toHaveTextContent('Vehicle measured -0.25 kWh');
  });
  it('keeps the known end SoC when the starting endpoint is unknown', () => {
    const { container } = render(<DetailSessionStats {...props}
      session={{ ...session, start_soc_pct: null, end_soc_pct: 0 }} />);
    expect(text(container, 'SoC Range')).toBe('—–0.00%');
  });
  it('does not mistake upstream zero fallbacks for recorded energy or derived statistics', () => {
    const { container } = render(<DetailSessionStats {...props}
      session={{ ...session, total_energy_added_wh: null, cost_decimal: null }}
      energy={0} vehicleEnergy={0} billedEnergy={null} cost={null} billedCost={null}
      costText="$0.00" averageRate={0} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(text(container, 'Per kWh')).toBe('$0.49/kWh');
    const dialog = openDetails();
    expect(within(dialog).getByText('4 empty fields are hidden.')).toBeInTheDocument();
  });
  it('retains cabinet energy without inventing a zero pack reading', () => {
    const { container } = render(<DetailSessionStats {...props}
      session={{ ...session, total_energy_added_wh: null }} vehicleEnergy={0} />);
    expect(text(container, 'Energy')).toBe('44.49 kWh');
    expect(container.textContent).not.toContain('Vehicle measured');
    const dialog = openDetails();
    expect(groupByLabel(dialog, 'Energy')).not.toHaveTextContent('Vehicle measured');
    expect(dialog.querySelector('[data-help-key]')).toBeInTheDocument();
  });
  it('updates chosen energy units and precision while fixed source power/duration and supplied currency text survive', () => {
    const { container, rerender } = render(<DetailSessionStats {...props} />);
    act(() => { setGlobalPrecision(3); });
    expect(text(container, 'Energy')).toBe('44.491 kWh');
    state.energy = 'Wh';
    rerender(<DetailSessionStats {...props} retained distanceM={45000} distanceText="source specialist range" />);
    expect(text(container, 'Energy')).toBe('44,490.600 Wh');
    expect(text(container, 'Duration')).toBe('60.000 min');
    expect(text(container, 'Peak Power')).toBe('150.000 kW');
    expect(text(container, 'Total Cost')).toBe('$21.80');
    expect(text(container, 'Miles Added')).toBe('source specialist range');
    const dialog = openDetails();
    expect(within(dialog).getByText('Retained source measurements')).toBeInTheDocument();
  });
});
