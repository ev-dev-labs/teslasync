/**
 * ChargeHistoryWidget contract + hardening tests.
 *
 * The widget is a self-refreshing dashboard tile that plots the energy added by
 * each of a vehicle's ten most-recent charging sessions. Its whole shape is a
 * function of three inputs: the resolved vehicle id (`vehicleId` prop, else the
 * first fleet vehicle, else none), the `/charging?...` query result, and the
 * widget `size`:
 *
 *   - size.cols <= 1  → compact tile: summary stats only, no chart, no title.
 *   - otherwise       → full tile: titled header + area chart + summary stats.
 *   - chartData.length <= 1 → the "not enough to chart" empty state in either.
 *
 * The suite locks, facet by facet:
 *   1. Full view: the SI watt-hours land on disk are converted to kWh (÷1000)
 *      and the newest-first API rows are reversed to ascending chronological
 *      x-index; the chart receives the exact data/series/xKey/yFormatter it
 *      needs, plus a screen-reader `ariaLabel`; the header shows Total + Avg.
 *   2. Compact view: stats render, chart + title do NOT, and the id falls back
 *      to the first fleet vehicle — with the request URL carrying a snake_case
 *      `vehicle_id` and NO `/api/v1` double-prefix.
 *   3. Empty (resolved []) → accessible empty state, never a bare chart.
 *   4. The `> 1` min-points gate: a lone session is treated as empty.
 *   5. Loading → skeleton only (no title / empty copy / chart).
 *   6. No vehicle → the query is disabled and the network is never touched.
 *   7. Failure path → the tile degrades to the empty state instead of throwing.
 *   8. Refresh: the accessible "Refresh" freshness control refetches on click.
 *
 * i18n is stubbed to echo the English fallback so visible copy is deterministic;
 * `@/api/hooks/useVehicles` and the shared `request` seam are mocked so no
 * network is touched; and the recharts area chart (which renders nothing
 * measurable in jsdom) is swapped for a prop-capturing marker while `fmt` stays
 * real so the stat formatting is exercised end-to-end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n passthrough: honour the English fallback so every copy assertion is real.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Fleet list injected per-test through a mutable holder.
let MOCK_VEHICLES: { data: Vehicle[] | undefined };
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => MOCK_VEHICLES,
}));

// Neutralise the shared fetch seam; keep ApiError/isApiError etc. real.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// Prop-capturing stub for the area chart — recharts' ResponsiveContainer renders
// nothing measurable in jsdom, so we assert on the props the widget hands it.
// `fmt` (re-exported from the same module) stays real via `...actual`.
const chartCapture = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
}));
vi.mock('@/components/charts', async (importActual) => {
  const actual = await importActual<typeof import('@/components/charts')>();
  return {
    ...actual,
    AreaChartWrapper: (props: Record<string, unknown>) => {
      chartCapture.props = props;
      return (
        <div data-testid="area-chart" role="img" aria-label={props.ariaLabel as string} />
      );
    },
  };
});

import ChargeHistoryWidget from './ChargeHistoryWidget';
import { fmt } from '@/components/charts';
import { request } from '@/api/client';
import type { WidgetSize } from './types';
import type { ChargingSession } from '../types';
import type { Vehicle } from '@/types/vehicle';

// The generic `request<T>` fights `mockResolvedValue`'s inference; the repo's
// convention is to treat it as a plain untyped mock at the call site.
const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

const CHART_LABEL = 'Energy added per recent charge session, in kilowatt-hours';

function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 7,
    started_at: '2026-07-01T00:00:00Z',
    ended_at: '2026-07-01T01:00:00Z',
    total_energy_added_wh: 10_000,
    start_soc_pct: 20,
    end_soc_pct: 80,
    cost_decimal: 5,
    startedAt: '2026-07-01T00:00:00Z',
    duration_min: 60,
    ...overrides,
  };
}

// Newest-first, exactly as `/charging?...&limit=10` returns them.
const THREE_SESSIONS: ChargingSession[] = [
  makeSession({ id: 1, total_energy_added_wh: 10_000 }), // newest → 10 kWh
  makeSession({ id: 2, total_energy_added_wh: 20_000 }), // 20 kWh
  makeSession({ id: 3, total_energy_added_wh: 30_000 }), // oldest → 30 kWh
];

function fleet(...ids: number[]): { data: Vehicle[] } {
  return { data: ids.map((id) => ({ id })) as unknown as Vehicle[] };
}

function renderWidget(size: WidgetSize, vehicleId?: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ChargeHistoryWidget vehicleId={vehicleId} size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  MOCK_VEHICLES = { data: [] };
  chartCapture.props = null;
  mockedRequest.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ChargeHistoryWidget — full view', () => {
  it('feeds the chart ascending-time kWh data, a summary, and an a11y label', async () => {
    mockedRequest.mockResolvedValue(THREE_SESSIONS);
    renderWidget(FULL, 7);

    // The full tile shows a header title.
    expect(await screen.findByText('Charge History')).toBeInTheDocument();

    // Snake_case param, no /api/v1 double-prefix, bounded to 10 rows.
    expect(mockedRequest).toHaveBeenCalledWith('/charging?vehicle_id=7&limit=10');

    // Chart mounts only once the query resolves.
    expect(await screen.findByTestId('area-chart')).toBeInTheDocument();

    // Newest-first rows are reversed to oldest→newest with an ascending index,
    // and every SI watt-hours value is converted to kWh (÷1000).
    expect(chartCapture.props?.data).toEqual([
      { i: '0', energy: 30 },
      { i: '1', energy: 20 },
      { i: '2', energy: 10 },
    ]);
    expect(chartCapture.props?.xKey).toBe('i');
    expect(chartCapture.props?.series).toEqual([
      { key: 'energy', label: 'kWh', color: '#10b981' },
    ]);
    const yFormatter = chartCapture.props?.yFormatter as (v: number) => string;
    expect(yFormatter(30)).toBe('30 kWh');

    // a11y: the otherwise-opaque SVG announces a one-line summary.
    expect(chartCapture.props?.ariaLabel).toBe(CHART_LABEL);
    expect(screen.getByRole('img', { name: /kilowatt-hours/i })).toBeInTheDocument();

    // Summary: total 60 kWh across the three sessions, 20 kWh average.
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Avg')).toBeInTheDocument();
    expect(screen.getByText(fmt(60, 1))).toBeInTheDocument();
    expect(screen.getByText(fmt(20, 1))).toBeInTheDocument();
    expect(screen.getAllByText('kWh')).toHaveLength(2);
  });
});

describe('ChargeHistoryWidget — compact view', () => {
  it('renders stats from the first fleet vehicle, with no chart and no title', async () => {
    MOCK_VEHICLES = fleet(3);
    mockedRequest.mockResolvedValue(THREE_SESSIONS);
    renderWidget(COMPACT); // no explicit vehicleId → fall back to the fleet

    // The id resolves to the first vehicle in the fleet.
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/charging?vehicle_id=3&limit=10'),
    );

    expect(await screen.findByText(fmt(60, 1))).toBeInTheDocument();
    expect(screen.getByText(fmt(20, 1))).toBeInTheDocument();

    // A compact tile drops both the chart and the header title.
    expect(screen.queryByTestId('area-chart')).toBeNull();
    expect(screen.queryByText('Charge History')).toBeNull();
  });
});

describe('ChargeHistoryWidget — empty / gated states', () => {
  it('shows an accessible empty state (not a chart) when there are no sessions', async () => {
    mockedRequest.mockResolvedValue([]);
    renderWidget(FULL, 7);

    expect(await screen.findByText('No charge sessions yet')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).toBeNull();
    // No summary stats when there is nothing to summarise.
    expect(screen.queryByText('Total')).toBeNull();
  });

  it('treats a lone session as "not enough to chart" (the > 1 gate)', async () => {
    mockedRequest.mockResolvedValue([
      makeSession({ id: 9, total_energy_added_wh: 42_000 }),
    ]);
    renderWidget(FULL, 7);

    // The request DID resolve with one row — this is the min-points gate, not a
    // still-loading state.
    expect(await screen.findByText('No charge sessions yet')).toBeInTheDocument();
    expect(mockedRequest).toHaveBeenCalledWith('/charging?vehicle_id=7&limit=10');
    expect(screen.queryByTestId('area-chart')).toBeNull();
    expect(screen.queryByText('Total')).toBeNull();
  });
});

describe('ChargeHistoryWidget — query lifecycle', () => {
  it('renders only a skeleton (no title / empty copy / chart) while pending', () => {
    mockedRequest.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderWidget(FULL, 7);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Charge History')).toBeNull();
    expect(screen.queryByText('No charge sessions yet')).toBeNull();
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });

  it('disables the query and never hits the network when no vehicle exists', () => {
    MOCK_VEHICLES = { data: [] }; // no vehicleId + empty fleet → id 0 → disabled
    renderWidget(FULL);

    expect(mockedRequest).not.toHaveBeenCalled();
    expect(screen.getByText('No charge sessions yet')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });

  it('degrades to the empty state (no crash) when the request rejects', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'));
    renderWidget(FULL, 7);

    expect(await screen.findByText('No charge sessions yet')).toBeInTheDocument();
    expect(mockedRequest).toHaveBeenCalledWith('/charging?vehicle_id=7&limit=10');
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });

  it('refetches when the accessible "Refresh" freshness control is activated', async () => {
    mockedRequest.mockResolvedValue(THREE_SESSIONS);
    renderWidget(FULL, 7);

    // Wait for the first load to settle — visible stats imply the query is no
    // longer fetching, so the refresh control is armed.
    expect(await screen.findByText(fmt(60, 1))).toBeInTheDocument();
    expect(mockedRequest).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
  });
});
