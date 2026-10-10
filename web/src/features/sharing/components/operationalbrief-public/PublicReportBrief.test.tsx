import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MetricPreferences } from '@/lib/metric-reference';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { PublicReportBrief } from './PublicReportBrief';
import { PublicSessionBrief } from './PublicSessionBrief';

const authenticated = vi.hoisted(() => ({
  settings: vi.fn(() => { throw new Error('Public bridge must not subscribe to authenticated settings'); }),
  units: vi.fn(() => { throw new Error('Public bridge must not subscribe to authenticated units'); }),
  formatting: vi.fn(() => { throw new Error('Public bridge must not subscribe to authenticated formatting'); }),
  workspace: vi.fn(() => { throw new Error('Public bridge must not select a workspace vehicle'); }),
}));

vi.mock('@/hooks/useSettings', () => ({ useSettings: authenticated.settings }));
vi.mock('@/api/hooks/useSettings', () => ({ useSettings: authenticated.settings }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: authenticated.units }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: authenticated.formatting }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: authenticated.workspace }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const fallback = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      const values = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : options;
      return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) => String(values?.[name] ?? match));
    },
    i18n: { language: 'en-US' },
  }),
}));

const preferences: MetricPreferences = {
  units: {
    distance: 'mi', speed: 'mph', temperature: '°C', pressure: 'bar',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
  },
  currency: { kind: 'symbol', value: 'NOT THE SOURCE CURRENCY' },
};

describe('PublicReportBrief — real query-free renderer', () => {
  it('renders explicit preferences and raw drawer evidence without authenticated settings, unit or workspace subscriptions', () => {
    const metrics: readonly StatMetric[] = [
      {
        metricId: 'distance', occurrenceId: 'public-test-distance', rawValue: 1609.344,
        label: 'Shared distance', description: 'Distance supplied in meters by the public source.',
      },
    ];
    Object.freeze(metrics[0]);
    Object.freeze(metrics);
    Object.freeze(preferences.units);
    render(<PublicReportBrief title="Public evidence" description="Owner-included source values."
      source="Owner-shared drive payload" eventDate="2026-03-15" metrics={metrics}
      preferences={preferences} evidence={[{ field: 'distance_m', value: 1609.344, unit: 'm' }]}
      testId="public-test-brief" />);
    const brief = screen.getByTestId('public-test-brief');
    expect(within(brief).getByText('1.00 mi')).toBeInTheDocument();
    expect(within(brief).getByText('Distance supplied in meters by the public source.')).toBeInTheDocument();
    expect(within(brief).getByText('The report date describes the event, not data freshness.')).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Public evidence details' });
    expect(within(drawer).getByText('distance_m: 1609.344 m')).toBeInTheDocument();
    expect(within(drawer).getAllByText('Owner-shared drive payload').length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText(/Report event date: 2026-03-15/).length).toBeGreaterThan(0);
    expect(drawer).not.toHaveTextContent('12:00');
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    expect(within(drawer).getByText('Only measurements included by the owner are shown. An omitted measurement is not a measured zero.', { selector: 'p' })).toBeInTheDocument();
    expect(authenticated.settings).not.toHaveBeenCalled();
    expect(authenticated.units).not.toHaveBeenCalled();
    expect(authenticated.formatting).not.toHaveBeenCalled();
    expect(authenticated.workspace).not.toHaveBeenCalled();
    expect(metrics[0].rawValue).toBe(1609.344);
  });

  it('distinguishes measured zero, unknown and invalid source inputs without fabricating raw evidence', () => {
    const metrics: readonly StatMetric[] = [
      { metricId: 'energy', occurrenceId: 'zero-energy', rawValue: 0, label: 'Measured zero energy' },
      { metricId: 'duration', occurrenceId: 'missing-duration', rawValue: null, label: 'Unknown duration' },
      { metricId: 'speed', occurrenceId: 'invalid-speed', rawValue: Number.NaN, label: 'Invalid speed' },
    ];
    render(<PublicReportBrief title="Source states" description="Independent source fields."
      source="Public payload" eventDate="" metrics={metrics} preferences={preferences}
      evidence={[{ field: 'energy_added_wh', value: 0, unit: 'Wh' }, { field: 'duration_s', value: null, unit: 's' }]}
      testId="public-states-brief" />);
    const items = within(screen.getByTestId('public-states-brief')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute('data-value-state', 'value');
    expect(within(items[0]).getByText('0.00 kWh')).toBeInTheDocument();
    expect(items[1]).toHaveAttribute('data-value-state', 'missing');
    expect(within(items[1]).getByText('—')).toBeInTheDocument();
    expect(items[2]).toHaveAttribute('data-value-state', 'invalid');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Source states details' });
    expect(within(drawer).getByText('energy_added_wh: 0 Wh')).toBeInTheDocument();
    expect(within(drawer).queryByText('duration_s: 0 s')).not.toBeInTheDocument();
    expect(within(drawer).queryByText('duration_s: null s')).not.toBeInTheDocument();
  });

  it('preserves source-denominated charging cost and the original efficiency formula with explicit public formatters only', () => {
    const session = {
      date: '2026-03-15', duration_s: 119, energy_added_wh: 45000,
      start_soc_pct: 20.14, end_soc_pct: 80.26, peak_power_w: 250000,
      avg_power_w: null, charger_type: 'supercharger', place: 'Shared place',
      cost: 0, cost_currency: 'CAD', curve: null,
    };
    const snapshot = structuredClone(session);
    Object.freeze(session);
    render(<PublicSessionBrief session={session} preferences={preferences}
      formatEnergy={raw => `${(raw / 1000).toFixed(1)} kWh`}
      formatPower={raw => `${(raw / 1000).toFixed(1)} kW`}
      fmtNumber={raw => Number(raw).toFixed(2)} />);
    const brief = screen.getByTestId('public-session-brief');
    expect(within(brief).getAllByRole('listitem')).toHaveLength(6);
    expect(within(brief).getByText('2m')).toBeInTheDocument();
    expect(within(brief).getByText('20% → 80%')).toBeInTheDocument();
    expect(within(brief).getByText('74.88 kWh/%')).toBeInTheDocument();
    expect(within(brief).getByText('CAD 0.00')).toBeInTheDocument();
    expect(screen.queryByText(/NOT THE SOURCE CURRENCY/)).not.toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Shared charging measurements details' });
    expect(within(drawer).getByText('duration_s: 119 s')).toBeInTheDocument();
    expect(within(drawer).getByText('start_soc_pct: 20.14 %')).toBeInTheDocument();
    expect(within(drawer).getByText('end_soc_pct: 80.26 %')).toBeInTheDocument();
    expect(within(drawer).getByText('cost: 0 CAD')).toBeInTheDocument();
    expect(authenticated.settings).not.toHaveBeenCalled();
    expect(authenticated.units).not.toHaveBeenCalled();
    expect(authenticated.formatting).not.toHaveBeenCalled();
    expect(authenticated.workspace).not.toHaveBeenCalled();
    expect(session).toEqual(snapshot);
  });
});
