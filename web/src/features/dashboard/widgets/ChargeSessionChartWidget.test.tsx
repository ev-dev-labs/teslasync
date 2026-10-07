/**
 * ChargeSessionChartWidget — behaviour, hardening & a11y contract.
 *
 * The widget fans a single `useQuery('/charging')` result into two responsive
 * layouts (compact 1×1 stats-only / standard bar-chart + legend) plus one pure
 * export (`classifyChargerType`). This suite drives every export:
 *
 *   - `classifyChargerType` is unit-tested across all three buckets
 *     (supercharger/tesla → supercharger, any other non-empty → dc,
 *     null / '' / '<invalid>' → home);
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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

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

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

import ChargeSessionChartWidget, { classifyChargerType } from './ChargeSessionChartWidget';
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
    charger_type: 'home',
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
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChargeSessionChartWidget size={size} vehicleId={vehicleId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const STANDARD: WidgetSize = { cols: 3, rows: 2 };

beforeEach(() => {
  seq = 0;
  vi.clearAllMocks();
  routeCharging([]);
});

// ── Pure helper: classifyChargerType ───────────────────────────────────────

describe('classifyChargerType', () => {
  it('buckets Supercharger / Tesla connectors as "supercharger"', () => {
    expect(classifyChargerType(makeSession({ charger_type: 'SUPERCHARGER' }))).toBe('supercharger');
    expect(classifyChargerType(makeSession({ charger_type: 'Tesla Wall Connector' }))).toBe(
      'supercharger',
    );
  });

  it('buckets any other non-empty charger type as "dc"', () => {
    expect(classifyChargerType(makeSession({ charger_type: 'CCS' }))).toBe('dc');
    expect(classifyChargerType(makeSession({ charger_type: 'J1772' }))).toBe('dc');
  });

  it('falls back to "home" for null, empty, or "<invalid>" charger types', () => {
    expect(classifyChargerType(makeSession({ charger_type: null }))).toBe('home');
    expect(classifyChargerType(makeSession({ charger_type: '' }))).toBe('home');
    expect(classifyChargerType(makeSession({ charger_type: '<invalid>' }))).toBe('home');
  });
});

// ── Component: async states ────────────────────────────────────────────────

describe('ChargeSessionChartWidget states', () => {
  it('renders a loading skeleton (no title, no empty copy) while fetching', () => {
    // Both reads hang so the query stays in its initial loading state.
    mockRequest.mockImplementation(() => new Promise(() => {}));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Charge Sessions')).toBeNull();
    expect(screen.queryByText('No charge sessions yet')).toBeNull();
  });

  it('shows an empty state (never a blank panel) when there are no sessions', async () => {
    routeCharging([]);
    renderWidget(STANDARD);

    const empty = await screen.findByText('No charge sessions yet');
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
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Charge Sessions')).toBeNull();
  });
});

// ── Component: standard layout (title + stats + chart + legend) ─────────────

describe('ChargeSessionChartWidget standard layout', () => {
  it('renders the title, summary stats, chart alt text and colour legend', async () => {
    routeCharging([
      makeSession({ total_energy_added_wh: 10_000, charger_type: 'home' }),
      makeSession({ total_energy_added_wh: 20_000, charger_type: 'SUPERCHARGER' }),
      makeSession({ total_energy_added_wh: 30_000, charger_type: 'CCS' }),
    ]);
    renderWidget(STANDARD);

    expect(await screen.findByText('Charge Sessions')).toBeInTheDocument();

    // Summary stats: total (60 kWh), avg (20 kWh), session count (3).
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Avg')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('60.0')).toBeInTheDocument();
    expect(screen.getByText('20.0')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getAllByText('kWh')).toHaveLength(2);

    // The chart carries a single text alternative for assistive tech.
    expect(
      screen.getByRole('img', { name: 'Bar chart of energy added per charge session' }),
    ).toBeInTheDocument();

    // Legend labels are always present and accessible (colour swatches hidden).
    expect(screen.getByText('Home / AC')).toBeInTheDocument();
    expect(screen.getByText('Supercharger')).toBeInTheDocument();
    expect(screen.getByText('DC Fast')).toBeInTheDocument();
  });

  it('derives total/avg from SI energy converted to kWh (÷1000)', async () => {
    routeCharging([
      makeSession({ total_energy_added_wh: 5_000 }),
      makeSession({ total_energy_added_wh: 15_000 }),
    ]);
    renderWidget(STANDARD);

    expect(await screen.findByText('20.0')).toBeInTheDocument(); // total 5 + 15 kWh
    expect(screen.getByText('10.0')).toBeInTheDocument(); // avg (20 / 2)
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

    expect(await screen.findByText('20.0')).toBeInTheDocument(); // total
    expect(screen.getByText('10.0')).toBeInTheDocument(); // avg (20 / 2)
    expect(screen.queryByText('NaN')).toBeNull();
    expect(screen.queryByText('0.0')).toBeNull();
  });
});

// ── Component: compact layout (stats only) ─────────────────────────────────

describe('ChargeSessionChartWidget compact layout', () => {
  it('drops the title, chart and legend, showing only the summary stats', async () => {
    routeCharging([
      makeSession({ total_energy_added_wh: 5_000 }),
      makeSession({ total_energy_added_wh: 5_000 }),
    ]);
    renderWidget(COMPACT);

    expect(await screen.findByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('10.0')).toBeInTheDocument(); // total
    expect(screen.getByText('2')).toBeInTheDocument(); // count

    // Compact widgets hide the header title, the chart, and the legend.
    expect(screen.queryByText('Charge Sessions')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText('Home / AC')).toBeNull();
  });
});

// ── Component: refresh interaction ─────────────────────────────────────────

describe('ChargeSessionChartWidget refresh', () => {
  it('refetches the sessions when the freshness refresh control is activated', async () => {
    routeCharging([makeSession()]);
    renderWidget(STANDARD);

    const refresh = await screen.findByRole('button', { name: /Refresh data/ });
    const before = chargingCallCount();
    expect(before).toBeGreaterThanOrEqual(1);

    fireEvent.click(refresh);

    await waitFor(() => expect(chargingCallCount()).toBe(before + 1));
  });
});
