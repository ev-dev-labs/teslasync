/** AUTHORED / NOTRUN. Private content tests, never a mobile/runtime acceptance claim. */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { YearReview, YearReviewDriveHighlight } from '@/api/types';
import { YearDriveRecord } from './YearDriveRecord';
import { YearPatterns } from './YearPatterns';
import { YearEnvironment } from './YearEnvironment';
import { YearSavings } from './YearSavings';
import { YearRecap } from './YearRecap';
import { YearFunFacts } from './YearFunFacts';

const state = vi.hoisted(() => ({
  distance: 'km',
  metrics: {} as Record<string, { rawValue: unknown; label: string }[]>,
  bars: [] as Record<string, unknown>[],
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string | Record<string, unknown>) => typeof fallback === 'string'
      ? fallback : String(fallback?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(fallback[name])),
  }),
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ unitPrefs: { distance: state.distance } }) }));
vi.mock('@/hooks/useNumberFormatting', () => ({ useNumberFormatting: () => ({
  fmtInt: (n: number) => Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—',
  fmtNumber: (n: number) => Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—',
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ formatCurrency: (n: number) => `$${n.toFixed(2)}` }) }));
vi.mock('@/components/data-display/stat-reference', () => ({
  useMetricPreferences: () => ({ units: { distance: state.distance, precision: 2 }, currency: { kind: 'symbol', value: '$' } }),
  StatGroup: ({ id, metrics }: { id: string; metrics: { rawValue: unknown; label: string }[] }) => {
    state.metrics[id] = metrics;
    return <div>{metrics.map((metric, index) => <p key={index}>{metric.label}: {String(metric.rawValue)}</p>)}</div>;
  },
}));
vi.mock('@/lib/metric-reference', () => ({ formatMetric: (_id: string, raw: number) => ({ text: `$${raw.toFixed(2)}` }) }));
vi.mock('@/components/data-display', () => ({
  MetricBar: (props: Record<string, unknown>) => {
    state.bars.push(props);
    return <div>{String(props.label)}: {String(props.sublabel)}</div>;
  },
}));
vi.mock('@/components/feedback', () => ({ EmptyState: ({ message }: { message: string }) => <p>{message}</p> }));
vi.mock('@/components/ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Caption: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  HelperText: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Heading: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
}));
vi.mock('@/components/layout/layout-reference', () => ({
  LayoutCard: ({ children, title }: { children: ReactNode; title: string }) => <article><h3>{title}</h3>{children}</article>,
  CardGrid: ({ items }: { items: { id: string; content: ReactNode }[] }) => <div>{items.map(item => <div key={item.id}>{item.content}</div>)}</div>,
}));

const period = { kind: 'event' as const, label: '2024', eventId: 'year-review:2024',
  start: '2024-01-01', end: '2024-12-31', provenance: 'Year in review' };
const drive: YearReviewDriveHighlight = { drive_id: 42, date: '2024-08-18',
  start_address: 'Unabridged origin, with a long localized address',
  end_address: 'Unabridged destination, with a long localized address',
  distance_km: 100, efficiency_wh_km: 200, duration_min: 119.7 };
beforeEach(() => { state.distance = 'km'; state.metrics = {}; state.bars = []; });

describe('specialist source behavior preserved inside shared card shells', () => {
  it.each([['km', '100', '200'], ['mi', '62', '322']])('keeps %s record distance/intensity, full addresses, date and rounded duration', (unit, distance, efficiency) => {
    state.distance = unit;
    render(<YearDriveRecord drive={drive} id="record" period={period} />);
    expect(state.metrics.record.map(metric => metric.rawValue)).toEqual([distance, '2h 0m', efficiency]);
    expect(screen.getByText(drive.start_address)).toBeInTheDocument();
    expect(screen.getByText(drive.end_address, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(drive.date)).toBeInTheDocument();
  });
  it('null records keep a recoverable empty state rather than invented zero records', () => {
    render(<YearDriveRecord drive={null} id="record" period={period} />);
    expect(screen.getByText('No drive data for this year')).toBeInTheDocument();
    expect(state.metrics.record).toBeUndefined();
  });
  it('nonpositive efficiency remains a dash; corrupt duration still follows original zero-minute policy', () => {
    render(<YearDriveRecord drive={{ ...drive, efficiency_wh_km: 0, duration_min: NaN }} id="record" period={period} />);
    expect(state.metrics.record.map(metric => metric.rawValue)).toEqual(['100', '0m', '—']);
  });
  it('patterns retain source weekday, wrapped peak hour, fractional weekly average and specialist unit conversion', () => {
    state.distance = 'mi';
    render(<YearPatterns data={{ most_active_day_of_week: 'Dienstag', most_active_hour: -1,
      avg_drives_per_week: 2.5, avg_distance_per_drive_km: 100, avg_efficiency_wh_km: 200 } as YearReview} period={period} />);
    expect(screen.getByText('Dienstag')).toBeInTheDocument();
    expect(screen.getByText('11 PM')).toBeInTheDocument();
    expect(state.metrics['year-review-patterns'].map(metric => metric.rawValue)).toEqual(['2.50', '62', '322']);
  });
  it('savings preserve exact source amounts, gas-equivalent sum, zero max guard and nonnegative coffee count', () => {
    const { rerender } = render(<YearSavings data={{ gas_savings: -10, total_charging_cost: 25 } as YearReview} period={period} />);
    expect(state.metrics['year-review-savings'].map(metric => metric.rawValue)).toEqual([-10, 25]);
    expect(state.bars[0]).toMatchObject({ value: 15, max: 15, sublabel: '$15.00' });
    expect(state.bars[1]).toMatchObject({ value: 25, max: 15, sublabel: '$25.00' });
    expect(screen.getByText("That's 0 cups of coffee!")).toBeInTheDocument();
    state.bars = [];
    rerender(<YearSavings data={{ gas_savings: NaN, total_charging_cost: Infinity } as YearReview} period={period} />);
    expect(state.metrics['year-review-savings'].map(metric => metric.rawValue)).toEqual([0, 0]);
    expect(state.bars.map(bar => bar.max)).toEqual([1, 1]);
  });
  it('environment keeps rounded kg display, 21kg/tree divisor, 30-icon cap and the overflow count', () => {
    render(<YearEnvironment data={{ co2_offset_kg: 840.25 } as YearReview} period={period} />);
    expect(state.metrics['year-review-environment'][0].rawValue).toBe('840 kg');
    expect(screen.getByText('Like planting 40 trees')).toBeInTheDocument();
    expect(screen.getAllByText('🌳')).toHaveLength(30);
    expect(screen.getByText('+10 more')).toBeInTheDocument();
  });
  it('recap retains all five source values, vehicle metadata, conditional savings and screenshot share instruction', () => {
    const data = { year: 2024, vehicle: { id: 7, display_name: 'Source name', model: 'Source model' },
      total_drives: 5, total_distance_km: 12.7, total_energy_kwh: 6.9, total_charge_sessions: 2,
      co2_offset_kg: 44.6, gas_savings: 8.25 } as YearReview;
    const { rerender } = render(<YearRecap data={data} period={period} />);
    expect(state.metrics['year-review-recap'].map(metric => metric.rawValue)).toEqual([5, '13', '7', 2, '45']);
    expect(screen.getByText('Source name')).toBeInTheDocument();
    expect(screen.getByText('Source model')).toBeInTheDocument();
    expect(screen.getByText('Saved $8.25 vs. gas')).toBeInTheDocument();
    expect(screen.getByText('Screenshot to share your year')).toBeInTheDocument();
    rerender(<YearRecap data={{ ...data, gas_savings: -1 }} period={period} />);
    expect(screen.queryByText(/vs\. gas/)).not.toBeInTheDocument();
  });
  it('fun facts preserve repeated labels, both source values and empty-array recovery', () => {
    const { rerender } = render(<YearFunFacts comparisons={[
      { emoji: '🚗', label: 'Distance', value: 'First source fact' },
      { emoji: '🌍', label: 'Distance', value: 'Second source fact' },
    ]} />);
    expect(screen.getAllByText('Distance')).toHaveLength(2);
    expect(screen.getByText('First source fact')).toBeInTheDocument();
    expect(screen.getByText('Second source fact')).toBeInTheDocument();
    rerender(<YearFunFacts comparisons={undefined} />);
    expect(screen.getByText('No fun facts available for this year yet')).toBeInTheDocument();
  });
});
