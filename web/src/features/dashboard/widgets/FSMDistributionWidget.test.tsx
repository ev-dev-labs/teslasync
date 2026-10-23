import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { queryResult, renderWidget } from '../components/continuation-dashboard-2/testSupport';
import FSMDistributionWidget from './FSMDistributionWidget';

const hooks = vi.hoisted(() => ({ stats: vi.fn(), vehicles: vi.fn(), pie: vi.fn() }));

vi.mock('@/api/hooks/useFSM', () => ({
  useFSMStats: (...args: unknown[]) => hooks.stats(...args),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => hooks.vehicles(),
}));
vi.mock('@/components/charts', async (original) => {
  const actual = await original<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual,
    ...chartTestDoubles,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    PieChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Pie: ({ data }: { data?: unknown[] }) => {
      hooks.pie(data ?? []);
      return <div data-testid="fsm-pie" />;
    },
    Cell: () => null,
    Tooltip: () => null,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  hooks.vehicles.mockReturnValue(queryResult([{ id: 7 }]));
  hooks.stats.mockReturnValue(queryResult({
    enabled: true,
    stats: { driving: 3_600_000, charging: 1_800_000, asleep: 600_000 },
  }));
});

describe('FSMDistributionWidget redesign', () => {
  it('renders the leading state and honest ranked shares in the After-card layout', () => {
    renderWidget(<FSMDistributionWidget size={{ cols: 2, rows: 4 }} />);

    expect(screen.getByRole('heading', { name: 'State distribution' })).toBeVisible();
    expect(screen.getAllByText('60%').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^(Driving|driving)$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^(Charging|charging)$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^(Asleep|asleep)$/i).length).toBeGreaterThan(0);
    expect(hooks.pie).toHaveBeenCalledWith([
      { state: 'driving', value: 3_600_000, pct: 60 },
      { state: 'charging', value: 1_800_000, pct: 30 },
      { state: 'asleep', value: 600_000, pct: 10 },
    ]);
  });

  it('uses only returned non-negative finite stats and no fabricated fallback values', () => {
    hooks.stats.mockReturnValue(queryResult({
      enabled: true,
      stats: { driving: 3_599_000, asleep: 0, unknown: Number.POSITIVE_INFINITY },
    }));
    renderWidget(<FSMDistributionWidget size={{ cols: 1, rows: 1 }} />);

    expect(screen.getAllByText('100%').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^(Asleep|asleep)$/i)).not.toBeInTheDocument();
  });

  it('keeps the compact title and empty state when stats are unavailable', () => {
    hooks.stats.mockReturnValue(queryResult({ enabled: true, stats: {} }));
    renderWidget(<FSMDistributionWidget size={{ cols: 1, rows: 1 }} />);

    expect(screen.getByRole('heading', { name: 'State distribution' })).toBeVisible();
    expect(screen.getByText('No state data')).toBeVisible();
  });

  it('preserves retained data during refresh and exposes one freshness refresh action', () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    hooks.stats.mockReturnValue(queryResult(
      { enabled: true, stats: { driving: 3_600_000, charging: 1_800_000 } },
      { isError: true, error: new Error('refresh failed'), refetch },
    ));
    renderWidget(<FSMDistributionWidget size={{ cols: 2, rows: 4 }} />);

    expect(screen.getByTestId('fsm-pie')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not enable stats without a valid resolved vehicle', () => {
    hooks.vehicles.mockReturnValue(queryResult([]));
    hooks.stats.mockReturnValue(queryResult(undefined));
    renderWidget(<FSMDistributionWidget size={{ cols: 2, rows: 4 }} />);

    expect(hooks.stats).toHaveBeenCalledWith('');
    expect(screen.getByText('No state data')).toBeVisible();
  });
});
