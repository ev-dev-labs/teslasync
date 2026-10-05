import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { LifetimeStats } from '@/api/hooks/useAnalytics';

const state = vi.hoisted(() => ({
  locale: 'de-DE', precision: 3, distance: 'mi' as 'mi' | 'km',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: {
    distance: state.distance, speed: 'mph', energy: 'Wh', power: 'kW',
    duration: 'h', temperature: '°C', pressure: 'bar',
    locale: 'en-US', precision: 1,
  } }),
}));
vi.mock('@/hooks/useNumberFormatting', async () => {
  const { fmtNumber } = await import('@/lib/numberFormat');
  return { useNumberFormatting: () => ({
    precision: state.precision, locale: state.locale,
    fmtNumber: (value: unknown) => fmtNumber(value, state.precision, state.locale),
    fmtInt: (value: unknown) => fmtNumber(value, 0, state.locale),
  }) };
});
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '€', formatCurrency: (value: number) => `specialist:${value}` }),
}));
vi.mock('@/components/data-display', () => ({
  StatCard: ({ label, value, unit, sublabel, loading }: {
    label: string; value: string; unit?: string; sublabel?: string; loading?: boolean;
  }) => <div data-specialist aria-label={label}>{loading ? 'pending' : <>{value} {unit} {sublabel}</>}</div>,
}));
// Keep actual shared StatStrip/formatMetric/StatTile. Isolate only peripheral UI.
vi.mock('@/components/ui', () => ({
  GlassPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Heading: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  QueryError: ({ onRetry }: { onRetry: () => void }) =>
    <div role="alert" onClick={onRetry}>source refresh failed</div>,
}));

import { LifetimeKeyStats } from './LifetimeKeyStats';

function stats(overrides: Partial<LifetimeStats> = {}): LifetimeStats {
  // Only these source fields are consumed by this component. The existing
  // full-page suite retains its full deterministic all-section fixture.
  return {
    total_drives: 1234, total_distance_km: 1609.344, total_energy_kwh: 3456.7,
    total_driving_hours: 320.5, total_charge_sessions: 89, total_savings: 956.79,
    ...overrides,
  } as LifetimeStats;
}
function show(data: LifetimeStats | undefined, options = {}) {
  return render(<LifetimeKeyStats stats={data} loading={false}
    fatalError={false} error={null} onRetry={vi.fn()} {...options} />);
}
afterEach(cleanup);

describe('lifetime shared-stat adoption preserves source display contracts', () => {
  it('keeps global numeric locale/precision, preferred distance, fixed kWh and source contexts', () => {
    const data = stats();
    const before = JSON.stringify(data);
    const { container } = show(data);
    expect(screen.getByText('1.234')).toBeInTheDocument();
    expect(screen.getByText('1.000,000')).toBeInTheDocument();
    expect(screen.getByText('3.456,700')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();
    expect(screen.getByText(/320,500 hrs/)).toBeInTheDocument();
    expect(screen.getByText(/89 sessions/)).toBeInTheDocument();
    expect(screen.getByText(/specialist:956.79/)).toBeInTheDocument();
    expect(container.querySelector('[data-period-kind="alltime"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-stat-value]')).toHaveLength(3);
    expect(JSON.stringify(data)).toBe(before);
  });
  it('retains all metrics during refresh failure and offers recovery', () => {
    show(stats(), { error: new Error('offline') });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('1.000,000')).toBeInTheDocument();
    expect(screen.getByText(/specialist:956.79/)).toBeInTheDocument();
    expect(screen.getByText('Showing retained measurements')).toBeInTheDocument();
  });
  it('does not replace retained values with loading placeholders', () => {
    const { container } = show(stats(), { loading: true });
    expect(container.querySelectorAll('[data-stat-value]')).toHaveLength(3);
    expect(screen.queryByText('pending')).not.toBeInTheDocument();
  });
  it.each([1.5, -1, NaN, Infinity, -0])('keeps specialist formatting for an unproved count %s', value => {
    const { container } = show(stats({ total_drives: value }));
    expect(container.querySelector('[data-stat-strip]')).toBeNull();
    expect(container.querySelectorAll('[data-specialist]')).toHaveLength(4);
  });
  it('fatal source errors render recovery rather than fabricated measurements', () => {
    const { container } = show(undefined, { fatalError: true, error: new Error('failed') });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(container.querySelector('[data-stat-value]')).toBeNull();
    expect(container.querySelector('[data-specialist]')).toBeNull();
  });
});
