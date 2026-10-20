/**
 * FleetStatsWidget — behaviour + hardening tests.
 *
 * FleetStatsWidget is the dashboard orchestrator behind the fleet KPI strip. It
 * resolves the primary vehicle (`useVehicles().data[0]`), pulls the 30-day fleet
 * rollup (`useFleetAnalytics`), streams that vehicle's five most-recent drives
 * and charges via a raw `useQuery` + `request`, derives display-unit converters
 * from `useUnits`, and hands everything to the pure `FleetStatsBar` inside a
 * `WidgetShell` (freshness + refresh affordance, never a blank panel).
 *
 * The data hooks are mocked at their module boundaries so orchestration is
 * deterministic; the raw drive/charge queries run through a REAL
 * QueryClientProvider against a mocked `request`, so the snake-case SI URLs and
 * the `enabled: primaryId > 0` gate are exercised for real without touching the
 * network. `useUnits` is stubbed so the km / mi branch flips per test while the
 * REAL SI converters (`convertDistanceFromSI`) still run — this is what proves
 * the distance fix. `react-i18next` is echo-mocked (returns the English
 * fallback, interpolating `{{var}}`); `useSettings` / `useTimezone` come from
 * the global stub in src/test-setup.ts. `matchMedia` reports reduced-motion so
 * the `AnimatedNumber` count-ups land on their final values synchronously and
 * the rendered magnitudes are inspectable.
 *
 * Facets covered:
 *   - fleet counts: vehicle count, online-only filter, energy pass-through.
 *   - distance conversion (the fix / regression): total_distance_km is already
 *     kilometres, so it is restated to SI metres before convertDistanceFromSI —
 *     1,000 km must render at full magnitude ("1,000 km"), and 1,609.344 km must
 *     become "1,000 mi", not the 1000×-too-small "1 km" / "1 mi".
 *   - efficiency conversion: Wh/km passes straight through for metric users and
 *     is restated as Wh/mi (× 1.609344) for imperial users, with a matching unit.
 *   - recent queries: the primary vehicle's drives & charges are fetched with
 *     snake_case, prefix-free, limit-capped URLs, and both sparklines paint.
 *   - the `enabled` gate: with no primary vehicle the queries never fire.
 *   - resilience: undefined vehicles + analytics still render all five tiles
 *     with placeholder zeros (never a blank panel); an analytics error is
 *     surfaced through the freshness dot without blanking the strip.
 *   - refresh wiring: activating the freshness control retries the analytics query.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n echo mock: returns the fallback string (or key when none), interpolating
// {{var}} tokens from the options object so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      const options = (opts && typeof opts === 'object' ? opts : undefined) as
        | Record<string, unknown>
        | undefined;
      let base = typeof fb === 'string' ? fb : key;
      if (options) {
        base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, n: string) =>
          n in options && options[n] != null ? String(options[n]) : `{{${n}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// The two orchestration hooks are mocked so the widget's inputs are deterministic.
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: vi.fn() };
});
vi.mock('@/api/hooks/useAnalytics', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useAnalytics')>();
  return { ...actual, useFleetAnalytics: vi.fn() };
});

// useUnits stub — lets each test flip the display distance unit (km / mi) while
// the real SI converters in @/lib/unitConversion still execute.
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));

// The raw drive/charge queries go through the real QueryClient against a mocked
// request(); the rest of the client surface is preserved.
vi.mock('@/api/client', async (importActual) => {
  const actual = await importActual<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn() };
});

// jsdom lacks matchMedia. Report reduced-motion so AnimatedNumber lands on its
// final value synchronously and the count-up magnitudes are assertable.
window.matchMedia = ((query: string) => ({
  matches: /prefers-reduced-motion/.test(query),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import FleetStatsWidget from './FleetStatsWidget';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';
import type { FleetAnalytics, Drive, ChargingSession } from '../types';
import type { WidgetSize } from './types';

const mockVehicles = vi.mocked(useVehicles);
const mockAnalytics = vi.mocked(useFleetAnalytics);
const mockUnits = vi.mocked(useUnits);
const mockRequest = vi.mocked(request);

const SIZE: WidgetSize = { cols: 5, rows: 1 };

/** Minimal analytics `UseQueryResult` stub (incl. the FreshnessDot fields). */
function qr(over: Record<string, unknown> = {}): never {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as never;
}

/** `useVehicles()` stub — the widget reads `.data[0].id`, `.length`, `.state`. */
function vehicles(list: Array<{ id: number; state?: string }>): never {
  return { data: list } as never;
}

function makeAnalytics(over: Partial<FleetAnalytics> = {}): FleetAnalytics {
  return {
    total_vehicles: 3,
    total_drives: 10,
    total_charging_sessions: 5,
    total_distance_km: 1000,
    total_energy_kwh: 250,
    total_cost: 0,
    avg_efficiency_wh_km: 160,
    period_days: 30,
    ...over,
  };
}

const DRIVES = [
  { distance_m: 3000 },
  { distance_m: 5000 },
  { distance_m: 4000 },
] as Drive[];

const CHARGES = [
  { total_energy_added_wh: 12000 },
  { total_energy_added_wh: 8000 },
  { total_energy_added_wh: 15000 },
] as ChargingSession[];

function renderWidget(size = SIZE) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FleetStatsWidget size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(view.container.querySelector('h3')).toHaveAccessibleName('Fleet stats');
  return view;
}

it.each([1, 2, 3])('identifies fleet statistics at %i columns', (cols) => {
  renderWidget({ cols, rows: 2 });
  expect(screen.getByRole('heading', { name: 'Fleet stats' })).toBeInTheDocument();
});

function briefEl(): HTMLElement {
  return screen.getByTestId('fleet-stats-operational-brief');
}

function openDrawer(): HTMLElement {
  const brief = briefEl();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
  return screen.getByRole('dialog');
}

function closeDrawer(dialog: HTMLElement) {
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

/**
 * Let the real drive/charge queries resolve so both sparklines paint in the
 * drawer (trend context moved off the face). The drawer closes again so later
 * face queries keep their original scope.
 */
async function settleSparklines() {
  const dialog = openDrawer();
  try {
    await waitFor(() => expect(dialog.querySelectorAll('polyline')).toHaveLength(2));
  } finally {
    closeDrawer(dialog);
  }
}

function group(name: string): HTMLElement {
  const metric = screen.getByText(name).closest('[data-operational-metric]');
  expect(metric).not.toBeNull();
  return metric as HTMLElement;
}

beforeEach(() => {
  mockVehicles.mockReturnValue(
    vehicles([
      { id: 1, state: 'online' },
      { id: 2, state: 'offline' },
      { id: 3, state: 'online' },
    ]),
  );
  mockAnalytics.mockReturnValue(qr({ data: makeAnalytics() }));
  mockUnits.mockReturnValue({ unitPrefs: { distance: 'km' } } as never);
  mockRequest.mockImplementation(
    ((path: string) =>
      path.startsWith('/charging')
        ? Promise.resolve(CHARGES)
        : Promise.resolve(DRIVES)) as unknown as typeof request,
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FleetStatsWidget — fleet counts & delegation', () => {
  it('renders all five tiles with the vehicle count, online-only count, and energy pass-through', async () => {
    const { container } = renderWidget();
    await settleSparklines();

    // Four measured KPI tiles on the face (Alerts has no source and is omitted).
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    assertOperationalMetricUnavailable(briefEl(), 'Alerts');

    // Fleet size = data.length (3); online = state === 'online' filter (2 of 3).
    const size = group('Fleet size');
    expect(within(size).getByText('3')).toBeInTheDocument();
    const dialog = openDrawer();
    try {
      expect(within(within(dialog).getByRole('group', { name: 'Fleet size' })).getByText('2 online')).toBeInTheDocument();
    } finally {
      closeDrawer(dialog);
    }

    // total_energy_kwh is already kWh → shown verbatim at one decimal.
    expect(within(group('Energy (30d)')).getByText('250.00 kWh')).toBeInTheDocument();
  });
});

describe('FleetStatsWidget — SI distance conversion (regression)', () => {
  it('restates the already-kilometre total to SI metres so km renders at full magnitude', async () => {
    // total_distance_km = 1000. The bug (feeding km straight to the metres
    // converter) rendered this as "1 km"; the fix restores "1,000 km".
    renderWidget();
    await settleSparklines();

    expect(within(group('Distance (30d)')).getByText('1,000.00 km')).toBeInTheDocument();
    expect(group('Distance (30d)')).not.toHaveTextContent('1 km');
  });

  it('converts kilometres to miles for imperial users (1,609.344 km → 1,000 mi)', async () => {
    mockUnits.mockReturnValue({ unitPrefs: { distance: 'mi' } } as never);
    mockAnalytics.mockReturnValue(qr({ data: makeAnalytics({ total_distance_km: 1609.344 }) }));

    renderWidget();
    await settleSparklines();

    const distance = group('Distance (30d)');
    expect(within(distance).getByText('1,000.00 mi')).toBeInTheDocument();
    expect(distance).not.toHaveTextContent('1 mi');
    // The efficiency tile relabels to the imperial unit alongside it.
    expect(group('Efficiency')).toHaveTextContent('Wh/mi');
  });
});

describe('FleetStatsWidget — efficiency conversion', () => {
  it('passes Wh/km straight through for metric users', async () => {
    mockAnalytics.mockReturnValue(qr({ data: makeAnalytics({ avg_efficiency_wh_km: 160 }) }));
    renderWidget();
    await settleSparklines();

    expect(within(group('Efficiency')).getByText('160.00 Wh/km')).toBeInTheDocument();
  });

  it('restates Wh/km as Wh/mi (× 1.609344) for imperial users', async () => {
    mockUnits.mockReturnValue({ unitPrefs: { distance: 'mi' } } as never);
    mockAnalytics.mockReturnValue(qr({ data: makeAnalytics({ avg_efficiency_wh_km: 200 }) }));

    renderWidget();
    await settleSparklines();

    // 200 Wh/km × 1.609344 km/mi = 321.8688 Wh/mi → "322" at 0 decimals.
    expect(within(group('Efficiency')).getByText('321.87 Wh/mi')).toBeInTheDocument();
  });
});

describe('FleetStatsWidget — recent drive & charge queries', () => {
  it('fetches the primary vehicle drives & charges with snake_case, prefix-free, capped URLs', async () => {
    renderWidget();

    // Both trend sparklines paint in the drawer once their series arrive.
    const dialog = openDrawer();
    try {
      await waitFor(() => expect(dialog.querySelectorAll('polyline')).toHaveLength(2));
    } finally {
      closeDrawer(dialog);
    }

    // Raw SI query strings: vehicle_id (snake_case), limit=5, and NO /api/v1 prefix.
    expect(mockRequest).toHaveBeenCalledWith('/drives?vehicle_id=1&limit=5');
    expect(mockRequest).toHaveBeenCalledWith('/charging?vehicle_id=1&limit=5');
  });

  it('never issues the drive/charge queries when there is no primary vehicle', async () => {
    mockVehicles.mockReturnValue(vehicles([]));
    renderWidget();

    // `enabled: primaryId > 0` keeps both queries idle — request is untouched.
    await waitFor(() => expect(document.querySelectorAll('[data-operational-metric]')).toHaveLength(4));
    expect(mockRequest).not.toHaveBeenCalled();
    expect(within(group('Fleet size')).getByText('0')).toBeInTheDocument();
  });
});

describe('FleetStatsWidget — resilience & shell wiring', () => {
  it('keeps aggregate metrics and the independent charging series when recent drives fail', async () => {
    mockRequest.mockImplementation(((path: string) => path.startsWith('/charging')
      ? Promise.resolve(CHARGES)
      : Promise.reject(new Error('recent drives unavailable'))) as unknown as typeof request);
    renderWidget();

    const dialog = openDrawer();
    try {
      const distance = within(dialog).getByRole('group', { name: 'Distance (30d)' });
      await waitFor(() => expect(within(distance).getByRole('alert')).toBeInTheDocument());
      expect(within(distance).getByText('1,000.00 km')).toBeInTheDocument();
      const energy = within(dialog).getByRole('group', { name: 'Energy (30d)' });
      expect(within(energy).getByText('250.00 kWh')).toBeInTheDocument();
      await waitFor(() => expect(energy.querySelector('polyline')).not.toBeNull());
      expect(distance.querySelector('polyline')).toBeNull();
      const priorDriveReads = mockRequest.mock.calls.filter(([path]) => path.startsWith('/drives')).length;
      const priorChargingReads = mockRequest.mock.calls.filter(([path]) => path.startsWith('/charging')).length;
      fireEvent.click(within(distance).getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(mockRequest.mock.calls.filter(([path]) => path.startsWith('/drives')).length).toBe(priorDriveReads + 1));
      expect(mockRequest.mock.calls.filter(([path]) => path.startsWith('/charging')).length).toBe(priorChargingReads);
    } finally {
      closeDrawer(dialog);
    }
  });

  it('shows independent analytics failure beside the measured fleet count and still loads both recent series', async () => {
    const refetch = vi.fn();
    mockAnalytics.mockReturnValue(qr({ error: new Error('fleet aggregate failed'), isError: true, refetch }));
    renderWidget();
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('/drives?vehicle_id=1&limit=5'));
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('/charging?vehicle_id=1&limit=5'));
    expect(within(group('Fleet size')).getByText('3')).toBeInTheDocument();
    const brief = briefEl();
    assertOperationalMetricUnavailable(brief, 'Distance (30d)');
    assertOperationalMetricUnavailable(brief, 'Energy (30d)');
    assertOperationalMetricUnavailable(brief, 'Efficiency');
    assertOperationalMetricUnavailable(brief, 'Alerts');
    assertOperationalBriefDisclosure(brief, 'Partial evidence');
    expect(within(brief).queryByText('0.00')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('retains measured zero aggregates through refresh failure without blanking their individual tiles', () => {
    mockVehicles.mockReturnValue(vehicles([]));
    mockAnalytics.mockReturnValue(qr({
      data: makeAnalytics({ total_distance_km: 0, total_energy_kwh: 0, avg_efficiency_wh_km: 0 }),
      error: new Error('aggregate refresh failed'),
      isError: true,
    }));
    renderWidget();
    expect(within(group('Distance (30d)')).getByText('0.00 km')).toBeInTheDocument();
    expect(within(group('Energy (30d)')).getByText('0.00 kWh')).toBeInTheDocument();
    expect(within(group('Efficiency')).getByText('0.00 Wh/km')).toBeInTheDocument();
    expect(within(group('Distance (30d)')).queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });

  it('uses a genuine first-load skeleton before either core source resolves', () => {
    mockVehicles.mockReturnValue(qr({ isLoading: true }));
    mockAnalytics.mockReturnValue(qr({ isLoading: true }));
    const { container } = renderWidget();
    expect(container.querySelector('[aria-hidden="true"][class*="--skeleton-bg"]')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Fleet size' })).not.toBeInTheDocument();
  });

  it('does not replace measured zero totals with missing-data placeholders', () => {
    mockVehicles.mockReturnValue(vehicles([]));
    mockAnalytics.mockReturnValue(qr({ data: makeAnalytics({
      total_distance_km: 0, total_energy_kwh: 0, avg_efficiency_wh_km: 0,
    }) }));
    renderWidget();
    expect(within(group('Distance (30d)')).getByText('0.00 km')).toBeInTheDocument();
    expect(within(group('Energy (30d)')).getByText('0.00 kWh')).toBeInTheDocument();
    assertOperationalMetricUnavailable(briefEl(), 'Alerts');
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });
  it('retains all five sections without presenting unknown measurements as zero', () => {
    mockVehicles.mockReturnValue({ data: undefined } as never);
    mockAnalytics.mockReturnValue(qr({ data: undefined }));

    const { container } = renderWidget();

    // Unknown readings are omitted with an explanatory state — never zero-filled.
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(screen.getByText('No metric values are available yet.')).toBeInTheDocument();
    const brief = briefEl();
    for (const label of ['Fleet size', 'Distance (30d)', 'Energy (30d)', 'Efficiency', 'Alerts']) {
      assertOperationalMetricUnavailable(brief, label);
    }
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    // No primary vehicle → the recent queries stay idle.
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('surfaces an analytics fetch error through the freshness dot without blanking the tiles', () => {
    mockVehicles.mockReturnValue(vehicles([]));
    mockAnalytics.mockReturnValue(
      qr({ isError: true, error: new Error('fleet down'), data: undefined }),
    );

    const { container } = renderWidget();

    // The error is communicated by the freshness chip…
    expect(container.querySelector('button[aria-label*="error"] [class~="bg-[var(--semantic-danger)]"]')).not.toBeNull();
    // …while the measured zero fleet count still renders (unknown tiles omitted).
    expect(document.querySelectorAll('[data-operational-metric]')).toHaveLength(1);
    expect(within(group('Fleet size')).getByText('0')).toBeInTheDocument();
    const brief = briefEl();
    for (const label of ['Distance (30d)', 'Energy (30d)', 'Efficiency', 'Alerts']) {
      assertOperationalMetricUnavailable(brief, label);
    }
  });

  it('retries the analytics query when the freshness control is activated', () => {
    const refetch = vi.fn();
    mockVehicles.mockReturnValue(vehicles([]));
    mockAnalytics.mockReturnValue(qr({ data: makeAnalytics(), refetch }));

    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('reviews retained fleet totals without confusing independent recent series with fleet coverage', async () => {
    mockAnalytics.mockReturnValue(qr({
      data: makeAnalytics(), error: new Error('refresh failed'), isError: true,
    }));
    renderWidget();
    await settleSparklines();
    const brief = screen.getByTestId('fleet-stats-operational-brief');
    assertOperationalBriefDisclosure(brief, 'Retained readings');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    assertOperationalMetricUnavailable(brief, 'Alerts');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('1,000.00 km')).toBeInTheDocument();
    expect(within(drawer).getByText('250.00 kWh')).toBeInTheDocument();
    expect(within(drawer).getAllByText(/sparklines are not the fleet-wide analysis window/).length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText(/unread alerts have no source here/).length).toBeGreaterThan(0);
  });
});
