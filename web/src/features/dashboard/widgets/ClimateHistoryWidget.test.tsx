/**
 * ClimateHistoryWidget contract + hardening tests.
 *
 * The widget is a self-refreshing dashboard tile that plots a vehicle's cabin
 * ("inside") and ambient ("outside") temperature history. Its whole shape is a
 * function of three inputs: the resolved vehicle id (`vehicleId` prop, else the
 * first fleet vehicle, else none), the `/climate?...` query result, and the
 * widget `size`:
 *
 *   - size.cols <= 1  → compact tile: summary stats only, no chart, no title.
 *   - otherwise       → full tile: titled header + area chart + summary stats.
 *   - no rows         → the accessible empty state in either layout.
 *
 * The suite locks, facet by facet:
 *   1. Full view: the SI °C on disk are converted to the user's unit at the
 *      display boundary, the rows are sorted ascending by time, and the chart
 *      receives the exact data/series it needs plus a screen-reader label; the
 *      header summary shows the LATEST cabin + outside temps.
 *   2. Formatters: x tick + tooltip label go through the date formatter, the y
 *      tick appends a degree glyph via the real `fmt`, and the tooltip maps the
 *      series key to a translated label + unit-suffixed value.
 *   3. Unit awareness: flipping the preference to °F re-derives every value.
 *   4. Compact view: stats render, chart + title do NOT, and the id falls back
 *      to the first fleet vehicle — with a snake_case `vehicle_id` and NO
 *      `/api/v1` double-prefix.
 *   5. Empty (resolved []) → accessible empty state, never a bare chart.
 *   6. Loading → skeleton only.
 *   7. No vehicle → the query is disabled and the network is never touched.
 *   8. Failure path → the tile degrades to the empty state instead of throwing.
 *   9. Refresh: the accessible "Refresh" freshness control refetches on click.
 *
 * i18n is stubbed to echo the English fallback so copy is deterministic; the
 * unit + date hooks are stubbed for a deterministic display boundary; the
 * shared `request` seam is mocked so no network is touched; and the recharts
 * primitives (which render nothing measurable in jsdom) are swapped for
 * prop-capturing markers while `convertTempFromSI` + `fmt` stay real so the
 * conversion + formatting are exercised end-to-end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

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

// Display-unit preference injected per-test; `convertTempFromSI` stays real.
let MOCK_TEMP: '°C' | '°F' = '°C';
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { temperature: MOCK_TEMP } }),
}));

// Deterministic date boundary so tick / tooltip-label formatting is assertable.
// The widget reads `formatDateTime`; the shared `<DataFreshness>` chip in
// `<WidgetShell>` reads `formatTime` — both must resolve to a function.
vi.mock('@/hooks/useDateFormat', () => {
  const fmtDate = (v: string | Date | null | undefined) => `ts(${String(v)})`;
  return {
    useDateFormat: () => ({ formatDateTime: fmtDate, formatTime: fmtDate }),
  };
});

// Neutralise the shared fetch seam; keep ApiError/isApiError etc. real.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// Prop-capturing stubs for the recharts primitives — recharts renders nothing
// measurable in jsdom, so we assert on the props the widget hands each piece.
// `fmt` / `chartMargin` / `axisTick*` (re-exported from the same module) stay
// real via `...actual`; `chartGrid` is neutralised so no real CartesianGrid
// mounts outside a chart context.
const cap = vi.hoisted(() => ({
  areaData: null as unknown,
  areaByKey: {} as Record<string, { stroke?: unknown; name?: unknown }>,
  xTick: null as null | ((v: string) => string),
  yTick: null as null | ((v: number) => string),
  tooltip: null as null | ((value: number, name: string) => [string, string]),
  label: null as null | ((v: string) => string),
}));

vi.mock('@/components/charts', async (importActual) => {
  const actual = await importActual<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual,
    ...chartTestDoubles,
    chartGrid: null,
    ResponsiveContainer: (props: Record<string, unknown>) => (
      <div data-testid="chart-shell">{props.children as ReactNode}</div>
    ),
    AreaChart: (props: Record<string, unknown>) => {
      cap.areaData = props.data;
      // Nest the captured children in an <svg> so the widget's real <defs>/
      // <linearGradient> render in the correct namespace (no casing warnings).
      return (
        <div data-testid="area-chart">
          <svg>{props.children as ReactNode}</svg>
        </div>
      );
    },
    XAxis: (props: Record<string, unknown>) => {
      cap.xTick = props.tickFormatter as (v: string) => string;
      return null;
    },
    YAxis: (props: Record<string, unknown>) => {
      cap.yTick = props.tickFormatter as (v: number) => string;
      return null;
    },
    Tooltip: (props: Record<string, unknown>) => {
      cap.tooltip = props.formatter as (value: number, name: string) => [string, string];
      cap.label = props.labelFormatter as (v: string) => string;
      return null;
    },
    Area: (props: Record<string, unknown>) => {
      const key = props.dataKey as string;
      if (key) cap.areaByKey[key] = { stroke: props.stroke, name: props.name };
      return null;
    },
  };
});

import ClimateHistoryWidget from './ClimateHistoryWidget';
import { fmt } from '@/components/charts';
import { request } from '@/api/client';
import type { WidgetSize } from './types';
import type { ClimateState } from '@/types/vehicle-systems';
import type { Vehicle } from '@/types/vehicle';

// The generic `request<T>` fights `mockResolvedValue`'s inference; the repo's
// convention is to treat it as a plain untyped mock at the call site.
const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

const CHART_LABEL = 'Cabin and outside temperature history';

function climate(
  created_at: string,
  insideTemp: number | null,
  outsideTemp: number | null,
): ClimateState {
  return { created_at, insideTemp, outsideTemp };
}

function fleet(...ids: number[]): { data: Vehicle[] } {
  return { data: ids.map((id) => ({ id })) as unknown as Vehicle[] };
}

function renderWidget(size: WidgetSize, vehicleId?: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClimateHistoryWidget vehicleId={vehicleId} size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  MOCK_VEHICLES = { data: [] };
  MOCK_TEMP = '°C';
  cap.areaData = null;
  cap.areaByKey = {};
  cap.xTick = null;
  cap.yTick = null;
  cap.tooltip = null;
  cap.label = null;
  mockedRequest.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ClimateHistoryWidget — full view (°C)', () => {
  it('sorts ascending, feeds the chart + latest-value summary, and labels the SVG', async () => {
    // Deliberately out-of-order so the ascending sort is exercised.
    mockedRequest.mockResolvedValue([
      climate('2026-07-01T00:00:00Z', 20, 10),
      climate('2026-07-01T02:00:00Z', 22, 12), // newest
      climate('2026-07-01T01:00:00Z', 21, 11),
    ]);
    renderWidget(FULL, 7);

    // Full tile shows a header title once the query resolves.
    expect(await screen.findByText('Climate History')).toBeInTheDocument();
    expect(await screen.findByTestId('area-chart')).toBeInTheDocument();

    // Snake_case param, no /api/v1 double-prefix.
    expect(mockedRequest.mock.calls[0]?.[0]).toBe('/climate?vehicle_id=7');

    // Rows are sorted oldest→newest; °C is an identity conversion.
    expect(cap.areaData).toEqual([
      { time: '2026-07-01T00:00:00Z', inside: 20, outside: 10 },
      { time: '2026-07-01T01:00:00Z', inside: 21, outside: 11 },
      { time: '2026-07-01T02:00:00Z', inside: 22, outside: 12 },
    ]);

    // Two series with the right colours + keys.
    expect(cap.areaByKey.inside).toEqual({ stroke: '#f97316', name: 'inside' });
    expect(cap.areaByKey.outside).toEqual({ stroke: '#3b82f6', name: 'outside' });

    // Summary shows the LATEST (last-after-sort) cabin + outside temps.
    expect(screen.getByText('Cabin')).toBeInTheDocument();
    expect(screen.getByText('Outside')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getAllByText('°C')).toHaveLength(2);

    // a11y: the otherwise-opaque SVG announces a one-line summary.
    expect(screen.getByRole('img', { name: CHART_LABEL })).toBeInTheDocument();
  });

  it('wires unit-aware tick + tooltip formatters', async () => {
    mockedRequest.mockResolvedValue([
      climate('2026-07-01T00:00:00Z', 20, 10),
      climate('2026-07-01T01:00:00Z', 21, 11),
    ]);
    renderWidget(FULL, 7);
    await screen.findByTestId('area-chart');

    // x tick + tooltip label both route through the date formatter.
    expect(cap.xTick?.('2026-07-01T00:00:00Z')).toBe('ts(2026-07-01T00:00:00Z)');
    expect(cap.label?.('2026-07-01T00:00:00Z')).toBe('ts(2026-07-01T00:00:00Z)');

    // y tick appends a degree glyph via the real chart `fmt`.
    expect(cap.yTick?.(30)).toBe(`${fmt(30, 0)}°`);

    // Tooltip maps the series key to a translated label + unit-suffixed value.
    expect(cap.tooltip?.(21, 'inside')).toEqual(['21°C', 'Cabin']);
    expect(cap.tooltip?.(11, 'outside')).toEqual(['11°C', 'Outside']);
  });
});

describe('ClimateHistoryWidget — unit awareness (°F)', () => {
  it('re-derives every value from SI °C when the preference is Fahrenheit', async () => {
    MOCK_TEMP = '°F';
    mockedRequest.mockResolvedValue([
      climate('2026-07-01T01:00:00Z', 25, 15), // 77 / 59
      climate('2026-07-01T02:00:00Z', 30, 20), // 86 / 68 (newest)
    ]);
    renderWidget(FULL, 7);
    await screen.findByTestId('area-chart');

    expect(cap.areaData).toEqual([
      { time: '2026-07-01T01:00:00Z', inside: 77, outside: 59 },
      { time: '2026-07-01T02:00:00Z', inside: 86, outside: 68 },
    ]);

    // Latest cabin 86°F, outside 68°F.
    expect(screen.getByText('86')).toBeInTheDocument();
    expect(screen.getByText('68')).toBeInTheDocument();
    expect(screen.getAllByText('°F')).toHaveLength(2);
    expect(cap.tooltip?.(86, 'inside')).toEqual(['86°F', 'Cabin']);
  });
});

describe('ClimateHistoryWidget — compact view', () => {
  it('renders stats from the first fleet vehicle, with no chart and no title', async () => {
    MOCK_VEHICLES = fleet(3);
    mockedRequest.mockResolvedValue([
      climate('2026-07-01T00:00:00Z', 18, 5),
      climate('2026-07-01T01:00:00Z', 19, 6), // newest
    ]);
    renderWidget(COMPACT); // no explicit vehicleId → fall back to the fleet

    // The id resolves to the first vehicle in the fleet.
    await waitFor(() =>
      expect(mockedRequest.mock.calls[0]?.[0]).toBe('/climate?vehicle_id=3'),
    );

    expect(await screen.findByText('19')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('Cabin')).toBeInTheDocument();

    // A compact tile drops the chart, the header title, and the SVG region.
    expect(screen.queryByTestId('area-chart')).toBeNull();
    expect(screen.queryByText('Climate History')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('ClimateHistoryWidget — empty / lifecycle states', () => {
  it('shows an accessible empty state (not a chart) when there are no rows', async () => {
    mockedRequest.mockResolvedValue([]);
    renderWidget(FULL, 7);

    expect(await screen.findByText('No climate history')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).toBeNull();
    // No summary stats when there is nothing to summarise.
    expect(screen.queryByText('Cabin')).toBeNull();
  });

  it('renders only a skeleton (no title / empty copy / chart) while pending', () => {
    mockedRequest.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderWidget(FULL, 7);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Climate History')).toBeNull();
    expect(screen.queryByText('No climate history')).toBeNull();
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });

  it('disables the query and never hits the network when no vehicle exists', () => {
    MOCK_VEHICLES = { data: [] }; // no vehicleId + empty fleet → id 0 → disabled
    renderWidget(FULL);

    expect(mockedRequest).not.toHaveBeenCalled();
    expect(screen.getByText('No climate history')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });

  it('degrades to the empty state (no crash) when the request rejects', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'));
    renderWidget(FULL, 7);

    expect(await screen.findByText('No climate history')).toBeInTheDocument();
    expect(mockedRequest.mock.calls[0]?.[0]).toBe('/climate?vehicle_id=7');
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });
});

describe('ClimateHistoryWidget — refresh', () => {
  it('refetches when the accessible "Refresh" freshness control is activated', async () => {
    mockedRequest.mockResolvedValue([
      climate('2026-07-01T00:00:00Z', 20, 10),
      climate('2026-07-01T01:00:00Z', 21, 11),
    ]);
    renderWidget(FULL, 7);

    // Wait for the first load to settle — a mounted chart implies the query is
    // no longer fetching, so the refresh control is armed.
    expect(await screen.findByTestId('area-chart')).toBeInTheDocument();
    expect(mockedRequest).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
  });
});
