/**
 * Private behavioral regressions for digest presenters. Shared layout/stat
 * chrome is mocked here deliberately: these cases prove domain preservation,
 * NOT shared responsive geometry, accessibility or browser acceptance.
 * Parent owns execution of this Vitest suite after concurrent writers stop.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render as renderWithoutRouter, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { StatMetric } from '@/components/data-display/stat-reference';
import type { StatPeriod } from '@/lib/metric-reference';
import type { DigestMetrics } from '../weekly-digest/types';
import { fsdInsights } from '@/features/driving/components/fsd-insights/__tests__/fixtures';
import { DigestSummary, WeekNavigation, DrivingPanel, ChargingPanel, BatteryPanel, FsdPanel, AlertsPanel } from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/{{(\w+)}}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km', energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 2 },
    formatDistance: (value: number) => `${(value / 1000).toFixed(2)} km`,
    formatEnergy: (value: number) => `${(value / 1000).toFixed(2)} kWh`,
    formatDuration: (value: number) => `${(value / 3600).toFixed(2)} h`,
    formatPower: (value: number) => `${(value / 1000).toFixed(2)} kW`,
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: (value: number) => `€${value.toFixed(2)}` }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtInt: (value: number) => value.toFixed(0),
    fmtNumber: (value: number) => value.toFixed(2),
  }),
}));
vi.mock('@/components/layout/layout-reference', () => ({
  LayoutCard: ({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) => (
    <section aria-label={title}><h2>{title}</h2>{actions}{children}</section>
  ),
  ChartCard: ({ title, data, dataColumns, empty, emptyMessage, loading, error, onRetry, footer }: {
    title: string; data: unknown; dataColumns: unknown; empty?: boolean; emptyMessage?: string;
    loading?: boolean; error?: unknown; onRetry?: () => void; footer?: ReactNode;
  }) => (
    <section aria-label={title} data-testid={`chart-${title}`} data-chart-data={JSON.stringify(data)}
      data-chart-columns={JSON.stringify(dataColumns)}>
      {loading ? 'Chart loading' : error ? <button onClick={onRetry}>Retry chart</button>
        : empty ? emptyMessage : 'Chart ready'}
      {footer}
    </section>
  ),
  CardGrid: ({ items, label }: {
    items: { id: string; content: ReactNode }[]; label: string;
  }) => <div aria-label={label}>{items.map(item => <div key={item.id}>{item.content}</div>)}</div>,
}));
vi.mock('@/components/data-display/stat-reference', () => {
  function Stats({ metrics, period, loading }: {
    metrics: StatMetric[]; period: StatPeriod; loading?: boolean;
  }) {
    return <div data-testid="stats" data-loading={loading}>
      <span>{period.label}</span>
      {metrics.map(metric => <div data-testid="metric" key={metric.occurrenceId}>
        <span>{metric.label}</span><span>{String(metric.rawValue)}</span>
        {metric.context}{metric.comparisonContent}
      </div>)}
    </div>;
  }
  return { StatStrip: Stats, StatGroup: Stats };
});
vi.mock('@/components/charts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...original,
    EmbeddedChart: ({ title, data, empty, emptyMessage }: {
      title: string; data: unknown; empty?: boolean; emptyMessage?: string;
    }) => (
      <section data-testid={`chart-${title}`} data-chart-data={JSON.stringify(data)}>
        {empty ? emptyMessage : 'Chart ready'}
      </section>
    ),
  };
});

const period: StatPeriod = {
  kind: 'analysis', label: 'Sep 28 – Oct 4', start: '2026-09-28T00:00:00Z',
  endExclusive: '2026-10-05T00:00:00Z', timezone: 'UTC',
  completeness: 'unknown', provenance: 'Available history',
};
function digest(overrides: Partial<DigestMetrics> = {}): DigestMetrics {
  return {
    totalDistanceM: 20_000, prevDistanceM: 10_000, totalDrives: 2, prevDriveCount: 1,
    energyUsedWh: 4000, prevEnergyWh: 5000, chargingCost: 12, prevChargingCost: 15,
    co2Saved: 3, prevCo2: 2, avgEfficiencyWhPerM: 0.2, prevAvgEfficiencyWhPerM: 0.25,
    totalDurationS: 3600, topDrive: undefined, chargeEnergyAddedWh: 6000, prevChargeEnergyWh: 3000,
    avgChargePowerW: 7000, chargingSessionCount: 2, batteryStart: 20.4, batteryEnd: 80.6,
    alertsByType: {}, alertTotal: 0, ...overrides,
  };
}

/** RTL retains this wrapper for rerender, so real error recovery and links
 * always have router context without mocking the feedback components. */
function render(ui: ReactNode) {
  return renderWithoutRouter(ui, { wrapper: MemoryRouter });
}

describe('independent weekly navigation', () => {
  it('retains full long ranges, current badge and disabled forward boundary', () => {
    const previous = vi.fn();
    const next = vi.fn();
    const label = 'December 28, 2026 – January 3, 2027';
    render(<WeekNavigation weekLabel={label} isCurrentWeek onPrevWeek={previous} onNextWeek={next} />);
    expect(screen.getByText(label)).toHaveAttribute('title', label);
    expect(screen.getByText('Current')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(previous).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(next).not.toHaveBeenCalled();
  });
  it('allows forward movement only for a historical week', () => {
    const next = vi.fn();
    render(<WeekNavigation weekLabel="" isCurrentWeek={false} onPrevWeek={vi.fn()} onNextWeek={next} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('both summary bands', () => {
  it('keeps five hero totals and exact optional fun-fact metadata', () => {
    const view = render(<DigestSummary metrics={digest()} period={period} />);
    expect(screen.getAllByTestId('metric')).toHaveLength(5);
    expect(screen.getByText('20.00 km')).toBeInTheDocument();
    expect(screen.getByText('€12.00')).toBeInTheDocument();
    expect(screen.getByText('3.00 kg')).toBeInTheDocument();
    view.rerender(<DigestSummary metrics={digest()} period={period}
      funFact={{ from: 'City A', to: 'City B', times: '1.25' }} />);
    expect(screen.getAllByTestId('metric')).toHaveLength(6);
    expect(screen.getByText('1.25×')).toBeInTheDocument();
    expect(screen.getByText('≈ 1.25× City A → City B')).toBeInTheDocument();
  });
  it('keeps six comparison metrics including Wh/distance efficiency, not kWh/distance', () => {
    render(<DigestSummary comparison metrics={digest()} period={period} />);
    expect(screen.getAllByTestId('metric')).toHaveLength(6);
    expect(screen.getByText(/200.*Wh\/km/)).toBeInTheDocument();
    expect(screen.getAllByText('increased')).toHaveLength(3);
    expect(screen.getAllByText('decreased')).toHaveLength(3);
  });
  it('reserves six hero skeleton tiles even without a fun fact', () => {
    render(<DigestSummary metrics={digest()} period={period} isLoading />);
    expect(screen.getAllByTestId('metric')).toHaveLength(6);
    expect(screen.getByTestId('stats')).toHaveAttribute('data-loading', 'true');
  });
  it('preserves the aggregate error shell and aggregate retry', () => {
    const retry = vi.fn();
    render(<DigestSummary metrics={digest()} period={period} isError error={new Error('History unavailable')} onRetry={retry} />);
    expect(screen.getByRole('region', { name: 'Week summary' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('stats')).toBeNull();
  });
});

describe('driving and charging details', () => {
  it('keeps distance series, SI display conversion and all four top-drive facts', () => {
    render(<DrivingPanel metrics={digest({
      topDrive: { id: 1, startTs: '2026-09-29T12:00:00Z', distanceM: 10_000, durationS: 1800, energyUsedWh: 1500 },
    })} period={period} dailyDistanceData={[{ day: 'Mon', distanceM: 20_000 }]} />);
    const chart = screen.getByTestId('chart-Daily distance');
    expect(chart).toHaveAttribute('data-chart-data', '[{"day":"Mon","distance":20}]');
    expect(chart.getAttribute('data-chart-columns')).toContain('"distance"');
    expect(screen.getByText('Top drive')).toBeInTheDocument();
    const groups = screen.getAllByTestId('stats');
    expect(within(groups[1]).getAllByTestId('metric')).toHaveLength(4);
    expect(screen.getByText('10.00 km')).toBeInTheDocument();
    expect(screen.getByText('0.50 h')).toBeInTheDocument();
    expect(screen.getByText(/150.*Wh\/km/)).toBeInTheDocument();
  });
  it('retains driving details when the chart errors, with its own retry', () => {
    const retry = vi.fn();
    render(<DrivingPanel metrics={digest()} period={period} dailyDistanceData={[]}
      isError error={new Error('Drives down')} onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry chart' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getAllByTestId('metric')).toHaveLength(4);
    expect(screen.getByText('No top drive is available for this week yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View drives' })).toHaveAttribute('href', '/drives');
  });
  it('keeps all charging facts, converted daily energy and zero-baseline dash', () => {
    render(<ChargingPanel metrics={digest({ prevChargeEnergyWh: 0 })} period={period}
      dailyEnergyData={[{ day: 'Tue', energyWh: 6000 }]} />);
    expect(screen.getByTestId('chart-Daily energy added'))
      .toHaveAttribute('data-chart-data', '[{"day":"Tue","energy":6}]');
    expect(screen.getAllByTestId('metric')).toHaveLength(4);
    expect(screen.getByText('7.00 kW')).toBeInTheDocument();
    expect(screen.getByText('Energy vs. last week')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('battery, alerts and supervised-driving states', () => {
  it.each(['battery', 'alerts', 'fsd'] as const)('retains the %s error shell and domain retry', (domain) => {
    const retry = vi.fn();
    const failure = { isError: true, error: new Error('Domain history unavailable'), onRetry: retry };
    const panel = domain === 'battery'
      ? <BatteryPanel metrics={digest()} period={period} {...failure} />
      : domain === 'alerts'
        ? <AlertsPanel metrics={digest({ alertTotal: 1 })} period={period} alertPieData={[]} {...failure} />
        : <FsdPanel insights={fsdInsights()} period={period} {...failure} />;
    render(panel);
    expect(screen.getByRole('heading', {
      name: domain === 'battery' ? 'Battery health' : domain === 'alerts' ? 'Alerts' : 'Supervised driving',
    })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('stats')).toBeNull();
  });
  it('keeps rounded battery meters, gain and the 5.5 m/Wh estimate', () => {
    render(<BatteryPanel metrics={digest()} period={period} />);
    const meters = screen.getAllByRole('meter');
    expect(meters[0]).toHaveAttribute('aria-valuetext', '20%');
    expect(meters[1]).toHaveAttribute('aria-valuetext', '81%');
    expect(screen.getByText('60.20%')).toBeInTheDocument();
    expect(screen.getByText('33.00 km')).toBeInTheDocument();
  });
  it('keeps the battery shell when no charging sessions exist', () => {
    render(<BatteryPanel metrics={digest({ chargingSessionCount: 0 })} period={period} />);
    expect(screen.getByRole('region', { name: 'Battery health' })).toBeInTheDocument();
    expect(screen.getByText('No battery data is available for this week.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Charging' })).toHaveAttribute('href', '/charging');
  });
  it('does not turn a healthy zero-alert week into a recovery task', () => {
    render(<AlertsPanel metrics={digest({ alertTotal: 0 })} period={period} alertPieData={[]} />);
    expect(screen.getByText('No alerts this week — everything looks great!')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('keeps severity order/names/counts and the distribution data table', () => {
    render(<AlertsPanel metrics={digest({ alertTotal: 3, alertsByType: { critical: 2, custom: 1 } })}
      period={period} alertPieData={[{ name: 'Critical', value: 2, color: '#f00' }]} />);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('critical2');
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('custom1');
    expect(screen.getByTestId('chart-Alert distribution'))
      .toHaveAttribute('data-chart-data', '[{"name":"Critical","value":2}]');
  });
  it('does not hide the distribution shell when alerts have no breakdown', () => {
    render(<AlertsPanel metrics={digest({ alertTotal: 1 })} period={period} alertPieData={[]} />);
    expect(screen.getByText('No severity breakdown to chart.')).toBeInTheDocument();
    expect(screen.getByTestId('chart-Alert distribution')).toBeInTheDocument();
  });
  it('distinguishes unmeasured FSD from measured zero', () => {
    const insights = fsdInsights();
    insights.totals.fsd_distance_m = null;
    const view = render(<FsdPanel period={period} insights={insights} />);
    expect(screen.getByText('No supervised-driving distance was measured this week.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'FSD insights' })).toHaveAttribute('href', '/fsd?days=7');
    insights.totals.fsd_distance_m = 0;
    view.rerender(<FsdPanel period={period} insights={insights} />);
    expect(screen.getByText('0.00 km')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open FSD insights' })).toHaveAttribute('href', '/fsd?days=7');
    expect(screen.getByText(/Absence is not zero/)).toBeInTheDocument();
  });
  it('keeps absent FSD baselines and suppresses only the current-week notice in past weeks', () => {
    const insights = fsdInsights();
    insights.drive_analytics.comparison.fsd_distance_change_m = null;
    insights.drive_analytics.comparison.fsd_share_change_pct_points = null;
    render(<FsdPanel period={period} insights={insights} isCurrentWeek={false} />);
    expect(screen.getAllByText('No comparable week')).toHaveLength(2);
    expect(screen.queryByText('This week vs last week')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open FSD insights' })).toBeInTheDocument();
  });
});
