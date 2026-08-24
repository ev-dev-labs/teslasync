/**
 * ChargingHeatmapPage — behaviour, branch, and a11y coverage.
 *
 * The page is the "Charging Patterns" surface: a 7×24 weekday/hour density
 * heatmap plus a derived insights side panel and two breakdown charts, all
 * scoped to the header-selected vehicle and a persisted date range. Its own
 * responsibilities (what these tests exercise) are:
 *
 *   1. One `useChargingSessionsPaginated(vehicleId, {limit:2000,start,end})`
 *      feed keyed on the derived active vehicle + the range.
 *   2. A KPI band derived from the sessions — count, SI watt-hours → kWh at the
 *      render boundary, currency cost, and the average of *completed* durations.
 *   3. Section-local loading / error / empty branches for EVERY panel — no panel
 *      is gated away or left blank.
 *   4. Deterministic grid / insight derivations surfaced in the hero + side panel.
 *   5. Toolbar wiring (vehicle select + range picker + refresh) and a11y
 *      (labelled regions, an icon-only refresh button, the heatmap `img`).
 *
 * Strategy mirrors PeriodComparePage: render the REAL page + REAL shared subtree
 * (PageContainer, MetricCard, MetricBar, HeatmapGrid, QueryError, charts). Only
 * the network `request` helper and i18n are mocked — the vehicle store, range
 * state, and settings-driven unit/format hooks all run for real so the SI →
 * display conversion and active-vehicle fallback are genuinely exercised.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (via <FadeIn>, <MetricBar>, and the
// PageContainer freshness chip's useReducedMotion) reads it at module load.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));

// Replace only `request`; keep the real isApiError/ApiError so <QueryError>
// classifies an injected ApiError(500) into its "Server error" branch.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: mockRequest };
});

// i18n → developer fallback with {{var}} interpolation so assertions read real
// sentences rather than raw keys.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import ChargingHeatmapPage from '../ChargingHeatmapPage';
import { SelectedVehicleProvider } from '@/store/selectedVehicle';
import { ApiError } from '@/lib/resilience';

// ── Fixtures ────────────────────────────────────────────────────────────────
const TWO_VEHICLES = [
  { id: 10, vehicle_id: 10, vin: 'VIN00010', display_name: 'Model 3', state: 'online' },
  { id: 20, vehicle_id: 20, vin: 'VIN00020', display_name: 'Model Y', state: 'asleep' },
];

// Metric units, en-US, 2-dp so the KPI band formats deterministically.
const SETTINGS = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  decimal_precision: 2,
  currency_symbol: '$',
  locale: 'en-US',
  base_cost_per_kwh: 0.12,
};

// Build an ISO instant from a LOCAL wall-clock so getDay()/getHours() inside
// buildGrid round-trip to the same weekday/hour regardless of the runner's tz.
function localIso(y: number, mo: number, d: number, h: number, mi = 0): string {
  return new Date(y, mo, d, h, mi, 0, 0).toISOString();
}

interface SessionOverrides {
  id: number;
  started_at: string;
  ended_at?: string | null;
  start_place?: string | null;
  total_energy_added_wh?: number;
  cost_decimal?: number | null;
}
function session(o: SessionOverrides) {
  return {
    id: o.id,
    vehicle_id: 10,
    started_at: o.started_at,
    ended_at: o.ended_at ?? null,
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: o.start_place ?? null,
    total_energy_added_wh: o.total_energy_added_wh ?? 0,
    peak_power_w: null,
    avg_power_w: null,
    cost_decimal: o.cost_decimal ?? null,
    cost_currency: 'USD',
    charger_type: 'AC',
    cable_type: null,
    duration_min: 0,
    startedAt: o.started_at,
  };
}

// Jan 2024: 1=Mon(1) 2=Tue(2) 6=Sat(6) 7=Sun(0). Three sessions share the
// Mon-10:00 slot (the busiest); three others are still "live" (no ended_at) so
// they must be counted but must NOT contribute to the average-duration mean.
const SESSIONS = [
  session({ id: 1, started_at: localIso(2024, 0, 1, 10, 0), ended_at: localIso(2024, 0, 1, 12, 0), start_place: 'Home', total_energy_added_wh: 10000, cost_decimal: 4 }),
  session({ id: 2, started_at: localIso(2024, 0, 1, 10, 30), ended_at: localIso(2024, 0, 1, 12, 30), start_place: 'Home', total_energy_added_wh: 10000, cost_decimal: 4 }),
  session({ id: 3, started_at: localIso(2024, 0, 1, 10, 45), ended_at: localIso(2024, 0, 1, 12, 45), start_place: 'Home', total_energy_added_wh: 10000, cost_decimal: 4 }),
  session({ id: 4, started_at: localIso(2024, 0, 2, 14, 0), ended_at: null, start_place: 'Work', total_energy_added_wh: 10000, cost_decimal: 4 }),
  session({ id: 5, started_at: localIso(2024, 0, 6, 9, 0), ended_at: null, start_place: 'Work', total_energy_added_wh: 10000, cost_decimal: 4 }),
  session({ id: 6, started_at: localIso(2024, 0, 7, 20, 0), ended_at: null, start_place: 'Cafe', total_energy_added_wh: 5000, cost_decimal: 5 }),
];

const GRID_ARIA = 'Charging sessions by weekday and hour of day';

type ChargingMode = 'resolve' | 'pending' | 'reject';
interface InstallOpts {
  vehicles?: unknown[];
  sessions?: unknown[];
  chargingMode?: ChargingMode;
  chargingError?: unknown;
  settings?: Record<string, unknown>;
}
function installRequest({
  vehicles = TWO_VEHICLES,
  sessions = SESSIONS,
  chargingMode = 'resolve',
  chargingError,
  settings = SETTINGS,
}: InstallOpts = {}) {
  mockRequest.mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.startsWith('/charging')) {
      if (chargingMode === 'pending') return new Promise(() => {});
      if (chargingMode === 'reject') return Promise.reject(chargingError ?? new Error('boom'));
      return Promise.resolve(sessions);
    }
    if (u.startsWith('/settings')) return Promise.resolve(settings);
    if (u.startsWith('/vehicles')) return Promise.resolve(vehicles);
    return Promise.resolve({});
  });
}

function chargingCalls(): string[] {
  return mockRequest.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith('/charging'));
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/charging/heatmap']}>
        <SelectedVehicleProvider>
          <ChargingHeatmapPage />
        </SelectedVehicleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Read a KPI card's value by its label text via MetricCard's stable semantic
// hooks: the card root is `[data-role="metric-card"]` and its value node is
// `[data-role="metric-value"]` (both siblings of `[data-role="metric-label"]`).
function kpiValue(label: string): string {
  const card = screen.getByText(label).closest('[data-role="metric-card"]');
  expect(card).not.toBeNull();
  const value = card!.querySelector('[data-role="metric-value"]');
  expect(value).not.toBeNull();
  return value!.textContent ?? '';
}

beforeEach(() => {
  mockRequest.mockReset();
  window.localStorage.clear();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('ChargingHeatmapPage — happy path', () => {
  it('renders the page shell, every section/panel heading, and the heatmap image', async () => {
    installRequest();
    renderPage();

    // The heatmap image only mounts once sessions resolve — a reliable "loaded" signal.
    await screen.findByRole('img', { name: GRID_ARIA });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Charging Patterns' }),
    ).toBeInTheDocument();
    expect(screen.getByText('When and where you charge')).toBeInTheDocument();

    // Every labelled section region is mounted (none gated away).
    expect(screen.getByRole('region', { name: 'Charging summary' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'When You Charge' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Charging Breakdowns' })).toBeInTheDocument();

    // All four panel headings render.
    for (const name of [
      'Weekly Charging Heatmap',
      'Charging Insights',
      'Top Charging Locations',
      'Sessions by Day of Week',
    ]) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
  });

  it('derives the KPI band from the sessions (count, SI-Wh→kWh energy, cost)', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    // 6 sessions, 55,000 Wh → 55 kWh, $4×5 + $5 = $25.00.
    expect(kpiValue('Total Sessions')).toBe('6');
    expect(kpiValue('Total Energy')).toMatch(/^55(?:\.0+)?\s*kWh$/);
    expect(kpiValue('Total Cost')).toBe('$25.00');
  });

  it('renders the insights side panel with favorite slot + busiest day/hour', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    // Busiest slot = Monday 10:00 with 3 sessions (DAYS[1] === 'Mon').
    expect(screen.getByText('Mons at 10:00')).toBeInTheDocument();
    expect(screen.getByText('3 sessions')).toBeInTheDocument();
    // MetricBar sublabels are distinctive "<label> · <count>" strings.
    expect(screen.getByText('Mon · 3')).toBeInTheDocument();
    expect(screen.getByText('10:00 · 3')).toBeInTheDocument();
  });

  it('shows the real breakdown charts (not their empty states) when data exists', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    expect(screen.queryByText('No repeat charging locations yet')).toBeNull();
    expect(screen.queryByText('No charging sessions in this range')).toBeNull();
  });
});

describe('ChargingHeatmapPage — average-duration derivation (regression)', () => {
  it('averages only sessions with a measured duration, not live/open ones', async () => {
    // 3 completed 2h sessions + 3 live (no ended_at). Correct mean = 2.0h.
    // The pre-fix bug divided the 6h total by ALL six sessions → a diluted 1.0h.
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    const avg = parseFloat(kpiValue('Avg Duration'));
    expect(avg).toBe(2);
    expect(avg).not.toBe(1);
  });

  it('shows a guarded zero (never NaN) when no session has an end time', async () => {
    const openOnly = [
      session({ id: 1, started_at: localIso(2024, 0, 1, 10, 0), ended_at: null, total_energy_added_wh: 10000, cost_decimal: 4 }),
      session({ id: 2, started_at: localIso(2024, 0, 2, 11, 0), ended_at: null, total_energy_added_wh: 10000, cost_decimal: 4 }),
    ];
    installRequest({ sessions: openOnly });
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    const text = kpiValue('Avg Duration');
    expect(text).not.toContain('NaN');
    expect(parseFloat(text)).toBe(0);
    expect(kpiValue('Total Sessions')).toBe('2');
  });
});

describe('ChargingHeatmapPage — loading / error / empty branches', () => {
  it('shows skeletons (never blank panels) while the feed is in flight', async () => {
    installRequest({ chargingMode: 'pending' });
    const { container } = renderPage();

    await waitFor(() =>
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0),
    );
    // Panel chrome stays mounted — only the bodies are skeletons.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Weekly Charging Heatmap' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Charging Insights' }),
    ).toBeInTheDocument();
    // KPI values are replaced by skeletons, so no metric label leaks.
    expect(screen.queryByText('Total Sessions')).toBeNull();
    // The heatmap image is not rendered while loading.
    expect(screen.queryByRole('img', { name: GRID_ARIA })).toBeNull();
  });

  it('renders per-section QueryError with a Retry that refetches the feed', async () => {
    installRequest({ chargingMode: 'reject', chargingError: new ApiError('kaboom', 500) });
    renderPage();

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0),
    );
    // The error is surfaced in the data panels, not swallowed.
    expect(screen.getAllByText('Server error').length).toBeGreaterThan(0);

    const before = chargingCalls().length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    await waitFor(() => expect(chargingCalls().length).toBeGreaterThan(before));
  });

  it('shows empty states (not blank) when the vehicle has no sessions in range', async () => {
    installRequest({ sessions: [] });
    renderPage();

    // Wait until the feed has actually fired for the resolved active vehicle.
    await waitFor(() => expect(chargingCalls().length).toBeGreaterThan(0));

    // Both the heatmap and the day-of-week panels share the no-data copy.
    await waitFor(() =>
      expect(
        screen.getAllByText('No charging sessions in this range').length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(
      screen.getByText('Insights appear once you have charging history'),
    ).toBeInTheDocument();
    expect(screen.getByText('No repeat charging locations yet')).toBeInTheDocument();
    // No heatmap image in the empty branch.
    expect(screen.queryByRole('img', { name: GRID_ARIA })).toBeNull();
  });
});

describe('ChargingHeatmapPage — data contract & toolbar', () => {
  it('requests /charging with snake_case vehicle_id + limit=2000 and no /api/v1 prefix', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    const calls = chargingCalls();
    expect(calls.length).toBeGreaterThan(0);
    // Active vehicle falls back to the first fleet vehicle (id 10).
    expect(calls.some((u) => /[?&]vehicle_id=10\b/.test(u))).toBe(true);
    expect(calls.every((u) => /[?&]limit=2000\b/.test(u))).toBe(true);
    expect(calls.every((u) => !u.includes('/api/v1'))).toBe(true);
    expect(calls.every((u) => !/vehicleId=/.test(u))).toBe(true);
  });

  it('refetches the feed when the refresh control is pressed', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    // PageContainer's freshness chip also exposes a "Refresh" control; the
    // page's own toolbar button renders last.
    const refreshButtons = screen.getAllByRole('button', { name: 'Refresh' });
    const before = chargingCalls().length;
    fireEvent.click(refreshButtons[refreshButtons.length - 1]);
    await waitFor(() => expect(chargingCalls().length).toBeGreaterThan(before));
  });

  it('re-scopes the feed to the newly selected vehicle', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    expect(chargingCalls().some((u) => /vehicle_id=20\b/.test(u))).toBe(false);
    fireEvent.change(screen.getByRole('combobox', { name: 'Select vehicle' }), {
      target: { value: '20' },
    });
    await waitFor(() =>
      expect(chargingCalls().some((u) => /vehicle_id=20\b/.test(u))).toBe(true),
    );
  });
});

describe('ChargingHeatmapPage — a11y & edge cases', () => {
  it('exposes an icon-only refresh control with an accessible name', async () => {
    installRequest();
    renderPage();
    await screen.findByRole('img', { name: GRID_ARIA });

    // The page's toolbar control is a real <button> (the freshness chip is a
    // role="button" span); target the former specifically.
    const refresh = screen
      .getAllByRole('button', { name: 'Refresh' })
      .find((el) => el.tagName === 'BUTTON');
    expect(refresh).toBeDefined();
    expect(refresh).toHaveAttribute('aria-label', 'Refresh');
  });

  it('degrades the favorite slot to an em-dash when sessions carry unparseable dates', async () => {
    const badDates = [
      session({ id: 1, started_at: 'not-a-date', ended_at: null, start_place: 'Home', total_energy_added_wh: 10000, cost_decimal: 4 }),
      session({ id: 2, started_at: 'also-bad', ended_at: null, start_place: 'Home', total_energy_added_wh: 10000, cost_decimal: 4 }),
    ];
    installRequest({ sessions: badDates });
    renderPage();

    // The insights panel still mounts (hasData is true) but the busiest slot is
    // empty → the favorite value degrades to '—' instead of crashing.
    await screen.findByText('—');
    expect(screen.getByText('0 sessions')).toBeInTheDocument();
    // KPIs still count the sessions and sum their (date-independent) energy.
    expect(kpiValue('Total Sessions')).toBe('2');
    expect(kpiValue('Total Energy')).toMatch(/^20(?:\.0+)?\s*kWh$/);
  });
});
