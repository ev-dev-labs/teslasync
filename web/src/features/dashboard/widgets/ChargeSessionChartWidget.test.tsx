/**
 * ChargeSessionChartWidget — behaviour, hardening & a11y contract.
 *
 * The widget fans a single `useQuery('/charging')` result into two responsive
 * layouts (compact 1×1 stats-only / standard bar-chart + legend) plus one pure
 * export (`classifyChargerType`). This suite drives every export:
 *
 *   - `classifyChargerType` preserves canonical AC/DC/Supercharger evidence
 *     and keeps missing or unrecognized charger types unknown;
 *   - the component is exercised through its accessible surface for the
 *     loading / empty / no-vehicle / error paths, the populated standard
 *     layout (title, summary stats, chart `role="img"` alt text, colour
 *     legend), the compact layout (stats only — no title / chart / legend),
 *     the SI→kWh energy maths, the non-finite-energy hardening (a single
 *     corrupt `total_energy_added_wh` must NOT collapse the whole total to 0),
 *     and the freshness refresh interaction.
 *
 * The network boundary (`request` from `@/api/client`) is mocked; every other
 * module (TanStack Query, `useVehicles`, `useDateFormat`) runs for real against
 * that mock. `react-i18next` is stubbed to echo the English fallback and
 * interpolate `{{var}}` tokens. `@testing-library/user-event` is not installed
 * in this repo (see the sibling BackupMonitorWidget suite), so the one
 * interaction goes through `fireEvent`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useMeasuredAxisWidth } from '@/components/charts';
import { getGlobalPrecision, setGlobalPrecision } from '@/lib/numberFormat';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options bag so any count-bearing copy renders as real text.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const base = typeof fallback === 'string' ? fallback : key;
      if (opts && typeof opts === 'object') {
        return base.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in opts ? String(opts[name]) : `{{${name}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Replace only the network primitive; keep the real `isApiError` etc. so
// <QueryError> classifies failures correctly.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

const axisCapture = vi.hoisted(() => ({
  chart: {} as Record<string, unknown>,
  axis: {} as Record<string, unknown>,
}));
vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual, ...chartTestDoubles,
    useMeasuredAxisWidth: vi.fn(actual.useMeasuredAxisWidth),
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
    BarChart: (props: Record<string, unknown>) => {
      axisCapture.chart = props;
      return <svg>{props.children as ReactNode}</svg>;
    },
    YAxis: (props: Record<string, unknown>) => { axisCapture.axis = props; return null; },
    XAxis: () => null,
    Bar: () => null,
    Tooltip: () => null,
  };
});

import ChargeSessionChartWidget, { classifyChargerType } from './ChargeSessionChartWidget';

it.each([1, 2, 3])('identifies charge session charts at %i columns', (cols) => {
  renderWidget({ cols, rows: 4 });
  expect(screen.getByRole('heading', { name: 'Charge sessions' })).toBeInTheDocument();
});
import { request } from '@/api/client';
import type { ChargingSession } from '@/api/types';
import type { WidgetSize } from './types';

const mockRequest = vi.mocked(request);

// jsdom lacks matchMedia; framer-motion's useReducedMotion (via <DataFreshness>
// inside <WidgetShell>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

let seq = 0;
function makeSession(over: Partial<ChargingSession> = {}): ChargingSession {
  seq += 1;
  return {
    id: seq,
    vehicle_id: 1,
    started_at: '2024-05-01T10:00:00Z',
    ended_at: '2024-05-01T11:00:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 10_000,
    peak_power_w: null,
    avg_power_w: null,
    cost_decimal: null,
    cost_currency: null,
    charger_type: 'AC',
    cable_type: null,
    startedAt: '2024-05-01T10:00:00Z',
    duration_min: 60,
    ...over,
  };
}

/** Route `/charging` reads to the supplied sessions; everything else → []. */
function routeCharging(sessions: ChargingSession[]) {
  mockRequest.mockImplementation((path: string) =>
    String(path).startsWith('/charging')
      ? Promise.resolve(sessions)
      : Promise.resolve([]),
  );
}

const chargingCallCount = () =>
  mockRequest.mock.calls.filter((c) => String(c[0]).startsWith('/charging')).length;

function renderWidget(size: WidgetSize, vehicleId: number | undefined = 1) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChargeSessionChartWidget size={size} vehicleId={vehicleId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(view.container.querySelector('h3')).toHaveAccessibleName('Charge sessions');
  return view;
}

const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const STANDARD: WidgetSize = { cols: 3, rows: 2 };

beforeEach(() => {
  seq = 0;
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  axisCapture.chart = {};
  axisCapture.axis = {};
  routeCharging([]);
});
afterEach(() => vi.restoreAllMocks());

describe('ChargeSessionChartWidget axis gutter', () => {
  it.each([2, 3])('fits full converted energy labels at %i columns without dropping precision', async cols => {
    const precision = getGlobalPrecision();
    setGlobalPrecision(6);
    try {
      routeCharging([
        makeSession({ total_energy_added_wh: 1234567.89 }),
        Object.assign(makeSession(), { total_energy_added_wh: null }),
        makeSession({ total_energy_added_wh: Number.POSITIVE_INFINITY }),
      ]);
      renderWidget({ cols, rows: 2 });
      await waitFor(() => expect(axisCapture.axis.width).toBeDefined());
      const options = vi.mocked(useMeasuredAxisWidth).mock.lastCall![0];
      const formatter = axisCapture.axis.tickFormatter as (value: number) => string;
      expect(options.labels).toEqual([formatter(0), formatter(1234.56789)]);
      expect(formatter(1234.56789)).toBe('1,234.567890');
      expect(options.fontSize).toBe(cols === 3 ? 11 : 10);
      expect(options.minWidth).toBe(36);
      expect(options.padding).toBe(20);
      expect(axisCapture.axis.width).toBeGreaterThanOrEqual(Math.ceil('1,234.567890'.length * options.fontSize * 0.75) + 20);
      expect((axisCapture.chart.margin as { left: number }).left).toBe(4);
      expect(axisCapture.axis.domain).toBeUndefined();
      const energies = (axisCapture.chart.data as { energy: number | null }[]).map(point => point.energy);
      expect(energies.slice(0, 2)).toEqual([null, null]);
      expect(energies[2]).toBeCloseTo(1234.56789, 6);
    } finally {
      act(() => setGlobalPrecision(precision));
    }
  });

  it('preserves the compact stats-only layout with measurement disabled', async () => {
    routeCharging([makeSession()]);
    renderWidget(COMPACT);
    await screen.findAllByText('10.00');
    expect(axisCapture.chart).toEqual({});
    expect(vi.mocked(useMeasuredAxisWidth).mock.lastCall![0].enabled).toBe(false);
  });
});

// ── Pure helper: classifyChargerType ───────────────────────────────────────

describe('classifyChargerType', () => {
  it.each([
    ['AC', 'home'],
    [' ac ', 'home'],
    ['DC', 'dc'],
    [' dc ', 'dc'],
    ['SUPERCHARGER', 'supercharger'],
    [' Supercharger ', 'supercharger'],
    [null, 'unknown'],
    ['', 'unknown'],
    [' ', 'unknown'],
    ['<invalid>', 'unknown'],
    ['Tesla Wall connector', 'unknown'],
    ['CCS_COMBO_2', 'unknown'],
    ['J1772', 'unknown'],
    ['home', 'unknown'],
  ])('preserves charger evidence %s as %s', (charger_type, expected) => {
    expect(classifyChargerType(makeSession({ charger_type }))).toBe(expected);
  });
});

// ── Component: async states ────────────────────────────────────────────────

describe('ChargeSessionChartWidget states', () => {
  it('retains its heading above a loading skeleton without empty copy', () => {
    // Both reads hang so the query stays in its initial loading state.
    mockRequest.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Charge sessions')).toBeInTheDocument();
    expect(screen.queryByText('No charge sessions yet')).toBeNull();
  });

  it('shows an empty state (never a blank panel) when there are no sessions', async () => {
    routeCharging([]);
    renderWidget(STANDARD);

    const empty = await screen.findByText('No charge sessions yet');
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(empty).toBeInTheDocument();
    expect(empty.closest('[role="status"]')).not.toBeNull();
  });

  it('never queries /charging when no vehicle resolves (id === 0)', async () => {
    routeCharging([makeSession()]); // would show data IF the guard were wrong
    // Render WITHOUT a vehicleId so id falls back through the empty
    // /vehicles list to 0, which disables the sessions query entirely.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ChargeSessionChartWidget size={STANDARD} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('No charge sessions yet')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(chargingCallCount()).toBe(0);
  });

  it('surfaces a QueryError when the sessions request fails', async () => {
    mockRequest.mockImplementation((path: string) =>
      String(path).startsWith('/charging')
        ? Promise.reject(new Error('boom'))
        : Promise.resolve([]),
    );
    renderWidget(STANDARD);

    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Charge sessions')).toBeInTheDocument();
  });
});

// ── Component: standard layout (title + stats + chart + legend) ─────────────

describe('ChargeSessionChartWidget standard layout', () => {
  it.each([2, 3])('keeps actual AC session evidence out of the DC bucket at %i columns', async cols => {
    routeCharging([makeSession({ charger_type: 'AC', total_energy_added_wh: 42_000 })]);
    renderWidget({ cols, rows: 4 });
    await screen.findAllByText('42.00');
    expect(axisCapture.chart).toEqual(expect.objectContaining({
      data: [expect.objectContaining({ type: 'home', energy: 42 })],
    }));
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  });

  it('shows unknown charger evidence without inventing AC or DC', async () => {
    routeCharging([makeSession({ charger_type: null, total_energy_added_wh: 42_000 })]);
    renderWidget(STANDARD);
    expect(await screen.findByText('Unknown')).toBeInTheDocument();
    expect(axisCapture.chart).toEqual(expect.objectContaining({
      data: [expect.objectContaining({ type: 'unknown', energy: 42 })],
    }));
  });

  it('renders the title, summary stats, chart alt text and colour legend', async () => {
    routeCharging([
      makeSession({ total_energy_added_wh: 10_000, charger_type: 'AC' }),
      makeSession({ total_energy_added_wh: 20_000, charger_type: 'SUPERCHARGER' }),
      makeSession({ total_energy_added_wh: 30_000, charger_type: 'DC' }),
    ]);
    renderWidget(STANDARD);

    expect(await screen.findByText('Charge sessions')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());

    // Summary stats: total (60 kWh), avg (20 kWh), session count (3).
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Avg')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('60.00')).toBeInTheDocument();
    expect(screen.getByText('20.00')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getAllByText('kWh')).toHaveLength(2);

    // The chart carries a single text alternative for assistive tech.
    expect(
      screen.getByRole('img', { name: 'Bar chart of energy added per charge session' }),
    ).toBeInTheDocument();

    // Legend labels are always present and accessible (colour swatches hidden).
    expect(screen.getByText('Home / AC')).toBeInTheDocument();
    expect(screen.getByText('Supercharger')).toBeInTheDocument();
    expect(screen.getByText('DC fast')).toBeInTheDocument();
  });

  it('derives total/avg from SI energy converted to kWh (÷1000)', async () => {
    routeCharging([
      makeSession({ total_energy_added_wh: 5_000 }),
      makeSession({ total_energy_added_wh: 15_000 }),
    ]);
    renderWidget(STANDARD);

    expect(await screen.findByText('20.00')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull()); // total 5 + 15 kWh
    expect(screen.getByText('10.00')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // session count
  });

  it('guards a single non-finite energy so the total is not collapsed to 0', async () => {
    // Without the safe() guard the NaN row poisons the reduce and the whole
    // total renders "0.0"; with it, the corrupt row counts as 0 and the real
    // 20 kWh session still surfaces.
    routeCharging([
      makeSession({ total_energy_added_wh: Number.NaN }),
      makeSession({ total_energy_added_wh: 20_000 }),
    ]);
    renderWidget(STANDARD);

    expect(await screen.findAllByText('20.00')).toHaveLength(2);
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull()); // total
    expect(screen.getAllByText('20.00')).toHaveLength(2);
    expect(screen.queryByText('NaN')).toBeNull();
    expect(screen.queryByText('0.00')).toBeNull();
  });
});

// ── Component: compact layout (stats only) ─────────────────────────────────

describe('ChargeSessionChartWidget compact layout', () => {
  it('identifies compact summary stats without adding the chart or legend', async () => {
    routeCharging([
      makeSession({ total_energy_added_wh: 5_000 }),
      makeSession({ total_energy_added_wh: 5_000 }),
    ]);
    renderWidget(COMPACT);

    expect(await screen.findByText('Total')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('10.00')).toBeInTheDocument(); // total
    expect(screen.getByText('2')).toBeInTheDocument(); // count

    // Compact widgets hide the header title, the chart, and the legend.
    expect(screen.getByRole('heading', { name: 'Charge sessions' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText('Home / AC')).toBeNull();
  });
});

// ── Component: refresh interaction ─────────────────────────────────────────

describe('ChargeSessionChartWidget refresh', () => {
  it('retains cached summaries, legend and chart after a refresh error', async () => {
    routeCharging([makeSession({ total_energy_added_wh: 0 })]);
    renderWidget(STANDARD);
    expect(await screen.findAllByText('0.00')).toHaveLength(2);
    mockRequest.mockImplementation((path: string) => String(path).startsWith('/charging')
      ? Promise.reject(new Error('refresh failed')) : Promise.resolve([]));
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Bar chart of energy added per charge session' })).toBeInTheDocument();
    expect(screen.getByText('Supercharger')).toBeInTheDocument();
    expect(screen.getAllByText('0.00')).toHaveLength(2);
  });
  it('refetches the sessions when the freshness refresh control is activated', async () => {
    routeCharging([makeSession()]);
    renderWidget(STANDARD);

    const refresh = await screen.findByRole('button', { name: /Refresh data/ });
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    const before = chargingCallCount();
    expect(before).toBeGreaterThanOrEqual(1);

    fireEvent.click(refresh);

    await waitFor(() => expect(chargingCallCount()).toBe(before + 1));
  });
});
