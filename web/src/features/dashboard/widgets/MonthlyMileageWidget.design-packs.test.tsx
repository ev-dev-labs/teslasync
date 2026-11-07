import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { MonthlyMileageBucket } from '@/types/analytics';
import { chartTokens } from '@/lib/tokens';
import { PackBoundary } from './designPacks/PackBoundary';
import MonthlyMileageWidget, { currentMonthKey } from './MonthlyMileageWidget';
import type { WidgetProps } from './types';

type SourceBucket = Omit<MonthlyMileageBucket, 'total_km'> & { total_km: number | null };

const api = vi.hoisted(() => {
  const result = {
    data: undefined as SourceBucket[] | undefined,
    error: null as Error | null,
    isLoading: false,
    isPending: false,
    isSuccess: true,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: 0,
    refetch: vi.fn(),
  };
  return {
    result,
    mileage: vi.fn(() => result),
    vehicles: vi.fn(() => ({ data: [{ id: 41 }] })),
  };
});

vi.mock('@/api/hooks/useAnalytics', () => ({ useMonthlyMileage: api.mileage }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: api.vehicles }));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { cloneElement } = await import('react');
  return {
    ...actual,
    // Supply jsdom's missing layout measurement; keep the chart, axes,
    // tooltip, accessible table and presentation implementations real.
    ResponsiveContainer: ({ children }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 640, height: 240 }),
  };
});

const packs = [
  ['v1', 'studio'],
  ['v2', 'elevated'],
  ['v3', 'precision'],
  ['v4', 'owner'],
  ['v5', 'iconic'],
  ['v6', 'expressive'],
  ['v7', 'pixel'],
] as const;

function bucket(yearMonth: string, distance: number | null): SourceBucket {
  return {
    year_month: yearMonth,
    total_km: distance,
    drive_count: 2,
    total_wh_consumed: null,
    avg_efficiency_wh_per_km: null,
  };
}

function widget(packId: unknown, props: Partial<WidgetProps> = {}) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <MonthlyMileageWidget vehicleId={7} size={{ cols: 2, rows: 4 }} {...props} />
      </PackBoundary>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(api.result, {
    data: [bucket('2020-01', 77), bucket(currentMonthKey('UTC'), 123)],
    error: null,
    isLoading: false,
    isPending: false,
    isSuccess: true,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
  });
});

afterEach(cleanup);

describe.each(packs)('monthly mileage %s / %s', (packId, appearance) => {
  it('uses the actual pack with the original monthly plot, summaries and refresh action', async () => {
    const { container } = render(widget(packId));
    await waitFor(() => expect(container.querySelector(
      `[data-widget-family="bars"][data-widget-appearance="${appearance}"]`,
    )).not.toBeNull());

    expect(container.querySelector('.widget-big-number')).toHaveTextContent('123');
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('km');
    expect(screen.getByText(/so far/)).toBeInTheDocument();
    expect(screen.getByText('12-month average').parentElement?.parentElement).toHaveTextContent('100');
    expect(screen.getByText('Month to date')).toBeInTheDocument();
    expect(screen.getByText('Only available distances are plotted; missing readings remain gaps.')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Monthly mileage — data table' });
    expect(within(table).getByRole('columnheader', { name: 'Distance (km)' })).toBeInTheDocument();
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Jan');
    expect(rows[1]).toHaveTextContent('77');
    expect(rows[2]).toHaveTextContent('123');
    expect(screen.getByRole('img', { name: 'Distance driven by month' })).toBeInTheDocument();
    expect(container.querySelector('.recharts-xAxis')).not.toBeNull();
    expect(container.querySelector('.recharts-yAxis')).not.toBeNull();
    await waitFor(() => {
      const bars = container.querySelectorAll('.recharts-bar-rectangle path');
      expect(bars).toHaveLength(2);
      expect(bars[0]).toHaveAttribute('fill', chartTokens.axisStroke);
      expect(bars[1]).toHaveAttribute('fill', chartTokens.series[5]);
    });
    expect(container.querySelector('[data-widget-family="bars"] [aria-hidden="true"] > svg')).not.toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(api.mileage).toHaveBeenCalledExactlyOnceWith('7', 'UTC');
    expect(api.vehicles).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(api.result.refetch).toHaveBeenCalledTimes(1);
  });

  it('preserves the compact summary without mounting a plot or extra data controller', async () => {
    const { container } = render(widget(packId, { size: { cols: 1, rows: 1 } }));
    await waitFor(() => expect(container.querySelector(
      `[data-instrument-appearance="${appearance}"]`,
    )).not.toBeNull());
    expect(screen.getByRole('heading', { name: 'Monthly mileage' })).toBeInTheDocument();
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('123');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Distance driven by month' })).not.toBeInTheDocument();
    expect(screen.queryByText('12-month average')).not.toBeInTheDocument();
    expect(api.mileage).toHaveBeenCalledTimes(1);
  });

  it('retains a missing current month as an unknown headline and chart gap, not zero', async () => {
    api.result.data = [bucket('2020-01', 77), bucket(currentMonthKey('UTC'), null)];
    const { container } = render(widget(packId));
    await waitFor(() => expect(container.querySelector(
      `[data-widget-appearance="${appearance}"]`,
    )).not.toBeNull());
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
    expect(container.querySelector('.widget-big-number')).not.toHaveTextContent('0');
    const table = screen.getByRole('table', { name: 'Monthly mileage — data table' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('77');
    expect(rows[2]).toHaveTextContent('—');
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('keeps the empty source shell and summary sections visible without invented bars', async () => {
    api.result.data = [];
    const { container } = render(widget(packId));
    await waitFor(() => expect(container.querySelector(
      `[data-widget-appearance="${appearance}"]`,
    )).not.toBeNull());
    expect(screen.getByRole('heading', { name: 'Monthly mileage' })).toBeInTheDocument();
    expect(screen.getByText('No mileage data')).toBeInTheDocument();
    expect(screen.getByText('12-month average')).toBeInTheDocument();
    expect(screen.getByText('Window')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });
});

it.each([undefined, 'classic', 'not-a-pack'])('retains the original Classic body for %s', packId => {
  const { container } = render(widget(packId));
  expect(container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
  expect(container.querySelector('.widget-big-number')).toHaveTextContent('123');
  expect(screen.getByText('12-mo avg 100 km')).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Monthly mileage — data table' })).toBeInTheDocument();
});

it('retains the same controller and cached distances while switching packs after a failed refresh', async () => {
  api.result.isError = true;
  api.result.isStale = true;
  api.result.error = new Error('Refresh failed');
  const view = render(widget('classic'));
  expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();

  for (const [packId, appearance] of packs) {
    view.rerender(widget(packId));
    await waitFor(() => expect(view.container.querySelector(
      `[data-widget-appearance="${appearance}"]`,
    )).not.toBeNull());
    expect(view.container.querySelector('.widget-big-number')).toHaveTextContent('123');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Monthly mileage — data table' })).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  }
  expect(api.result.refetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
  expect(api.result.refetch).toHaveBeenCalledTimes(1);
});

it('shows initial loading and fatal failure honestly, then recovers into the requested pack', async () => {
  Object.assign(api.result, { data: undefined, isLoading: true, isPending: true, isSuccess: false });
  const view = render(widget('v7'));
  expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.queryByText('No mileage data')).not.toBeInTheDocument();
  expect(view.container.querySelector('.widget-big-number')).toBeNull();

  Object.assign(api.result, { isLoading: false, isPending: false, isError: true, error: new Error('Unavailable') });
  view.rerender(widget('v7'));
  expect(screen.getByText("Can't reach server")).toBeInTheDocument();
  expect(screen.queryByText('No mileage data')).not.toBeInTheDocument();

  Object.assign(api.result, {
    data: [bucket(currentMonthKey('UTC'), 0)],
    isSuccess: true,
    isError: false,
    error: null,
  });
  view.rerender(widget('v7'));
  await waitFor(() => expect(view.container.querySelector('[data-widget-appearance="pixel"]')).not.toBeNull());
  expect(view.container.querySelector('.widget-big-number')).toHaveTextContent('0');
  expect(screen.queryByText('No mileage data')).not.toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Monthly mileage — data table' })).toBeInTheDocument();
});

it('retains the plot and disables duplicate refreshes while the existing request is in flight', async () => {
  api.result.isFetching = true;
  const view = render(widget('v4'));
  await waitFor(() => expect(view.container.querySelector('[data-widget-appearance="owner"]')).not.toBeNull());
  const refresh = screen.getByRole('button', { name: /Refresh data/ });
  expect(refresh).toBeDisabled();
  fireEvent.click(refresh);
  expect(api.result.refetch).not.toHaveBeenCalled();
  expect(screen.getByRole('table', { name: 'Monthly mileage — data table' })).toBeInTheDocument();

  api.result.isFetching = false;
  view.rerender(widget('v4'));
  expect(screen.getByRole('button', { name: /Refresh data/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
  expect(api.result.refetch).toHaveBeenCalledTimes(1);
});
