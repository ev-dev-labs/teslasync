import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { queryResult, renderWidget } from '../components/continuation-dashboard-2/testSupport';
import SpeedHeatmapWidget from './SpeedHeatmapWidget';

const hooks = vi.hoisted(() => ({ query: vi.fn(), chart: vi.fn(), vehicles: vi.fn() }));
vi.mock('@tanstack/react-query', async (original) => {
  const actual = await original<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: (...args: unknown[]) => hooks.query(...args) };
});
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => hooks.vehicles() }));
vi.mock('@/components/charts', async (original) => {
  const actual = await original<typeof import('@/components/charts')>();
  return {
    ...actual,
    EmbeddedChart: (props: { data: unknown; children?: ReactNode }) => {
      hooks.chart(props);
      return <div data-testid="heatmap-frame">{props.children}</div>;
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  hooks.vehicles.mockReturnValue(queryResult([{ id: 7 }]));
  hooks.query.mockReturnValue(queryResult([
    { id: 1, start_ts: '2026-09-14T00:00:00', avg_speed_mps: 0 },
    { id: 2, start_ts: '2026-09-14T01:00:00', avg_speed_mps: 10 },
  ]));
});

describe('specialist speed heatmap canonical frame', () => {
  it('retains all 168 SVG cells, original titles, legend and full-data alternative', () => {
    const { container } = renderWidget(<SpeedHeatmapWidget size={{ cols: 3, rows: 4 }} />);
    expect(screen.getByRole('img', { name: 'Average speed by day of week and hour of day' })).toBeVisible();
    expect(container.querySelectorAll('svg[role="img"] rect')).toHaveLength(168);
    expect(container.querySelectorAll('svg[role="img"] rect title')).toHaveLength(168);
    expect(screen.getByText('Slow')).toBeVisible();
    expect(screen.getByText('Fast')).toBeVisible();
    expect(hooks.chart).toHaveBeenCalledWith(expect.objectContaining({
      chartKey: 'dashboard-speed-heatmap',
      data: expect.arrayContaining([
        { day: 0, hour: 0, avgSpeed: 0, count: 1 },
        { day: 0, hour: 2, avgSpeed: null, count: 0 },
      ]),
      dataColumns: [
        expect.objectContaining({ key: 'day' }),
        expect.objectContaining({ key: 'hour' }),
        expect.objectContaining({ key: 'avgSpeed' }),
        expect.objectContaining({ key: 'count' }),
      ],
    }));
    expect(hooks.chart.mock.calls[0][0].data).toHaveLength(168);
  });

  it('keeps compact mode metric-only rather than injecting a second chart', () => {
    renderWidget(<SpeedHeatmapWidget size={{ cols: 1, rows: 2 }} />);
    expect(screen.getByText('Peak')).toBeVisible();
    expect(hooks.chart).not.toHaveBeenCalled();
    expect(screen.queryByTestId('heatmap-frame')).not.toBeInTheDocument();
  });

  it('retains real measured zero in the heatmap after a refresh error', () => {
    hooks.query.mockReturnValue(queryResult([
      { id: 1, start_ts: '2026-09-14T00:00:00', avg_speed_mps: 0 },
    ], { error: new Error('offline'), isError: true }));
    renderWidget(<SpeedHeatmapWidget size={{ cols: 2, rows: 4 }} />);
    expect(screen.getByTestId('heatmap-frame')).toBeVisible();
    expect(hooks.chart).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([{ day: 0, hour: 0, avgSpeed: 0, count: 1 }]),
    }));
    expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
  });
});
