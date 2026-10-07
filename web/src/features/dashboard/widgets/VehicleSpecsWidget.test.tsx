/**
 * VehicleSpecsWidget — behaviour, hardening & a11y contract.
 *
 * The widget resolves a vehicle (explicit prop → first vehicle → none) and fans
 * three independent reads — `/vehicles/{id}/specs`, `/vehicles/{id}/options`,
 * `/vehicle-config/latest?vehicle_id={id}` — into either a labelled detail card
 * (standard), a Model+Trim hero (compact 1×1), or the loading / empty / error
 * states. This suite drives the whole component through its accessible surface
 * and pins two regressions this elevation fixed:
 *
 *   1. **No-vehicle blank-card bug.** `hasAnyData` used `configData !== null`,
 *      but a *disabled* config query resolves `undefined` (`undefined !== null`
 *      is `true`), so a widget with no vehicle rendered a detail card full of
 *      "—" placeholders instead of the empty state. The guard is now `!= null`
 *      plus a non-empty-options check, so "nothing to show" always renders the
 *      `EmptyState` (role="status") — never a phantom dashes card, and never a
 *      wasted request.
 *   2. **Swallowed error bug.** The hooks' `error` was never forwarded to
 *      `<WidgetShell>`, so a total fetch failure masqueraded as "No specs
 *      available". A failure with no data now surfaces a `QueryError`
 *      (role="alert"), while a *partial* failure (one source down, another up)
 *      keeps showing the data it does have.
 *
 * Also covered: vehicle resolution + request-URL contract, the specs→config
 * fallback chain, decoded option badges (+ the 8-row cap), null-safety ("—", no
 * "undefined"/"NaN"), the compact layout, and the freshness refresh interaction.
 *
 * The network boundary (`request` from `@/api/client`) is mocked; TanStack Query
 * runs for real against it, so the request URLs and `enabled` gating are
 * exercised end to end. `useVehicles` is overridden while the sibling
 * specs/options/config hooks (same module) stay REAL via `importActual`.
 * `react-i18next` is stubbed to echo the English fallback.
 * `@testing-library/user-event` is not installed in this repo (see the sibling
 * RouteEfficiencyWidget / SleepEfficiencyWidget suites), so the one interaction
 * goes through `fireEvent`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options bag so any interpolated copy renders as real text.
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

// Override ONLY `useVehicles`; the widget's data hooks (useVehicleSpecs /
// useVehicleOptions / useVehicleConfigLatest) live in the same module and must
// stay real so they hit the mocked `request`.
vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>(
    '@/api/hooks/useVehicles',
  );
  return { ...actual, useVehicles: vi.fn() };
});

import VehicleSpecsWidget from './VehicleSpecsWidget';
import { request } from '@/api/client';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { WidgetProps } from './types';

const mockRequest = vi.mocked(request);
const mockUseVehicles = vi.mocked(useVehicles);

// jsdom lacks matchMedia; framer-motion (via <FadeIn> / <DataFreshness> inside
// <WidgetShell>) reads it.
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

// ── Fixtures ────────────────────────────────────────────────────────────────

type Dict = Record<string, unknown>;

function specsData(over: Dict = {}): Dict {
  return {
    car_type: 'Model 3',
    trim_badging: 'Performance',
    exterior_color: 'Deep Blue Metallic',
    wheel_type: 'Uberturbine',
    interior: 'All Black',
    aux_battery_type: 'Li-Ion',
    car_version: 'specs-fallback-ver',
    ...over,
  };
}

function configData(over: Dict = {}): Dict {
  return {
    id: 1,
    vehicle_id: 1,
    created_at: '2026-01-01T00:00:00Z',
    version: '2024.44.30 abcd',
    car_type: 'Model3-cfg',
    trim: 'AWD-cfg',
    exterior_color: 'Red-cfg',
    wheel_type: 'Aero-cfg',
    ...over,
  };
}

function envelope(data: unknown) {
  return { data, fetched_at: '2026-01-01T00:00:00Z' };
}

/** Route each read to a resolved payload (undefined key → resolves null). */
function routeAll(opts: { specs?: unknown; options?: unknown; config?: unknown }) {
  mockRequest.mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/specs')) return Promise.resolve('specs' in opts ? opts.specs : null);
    if (p.includes('/options')) return Promise.resolve('options' in opts ? opts.options : null);
    if (p.startsWith('/vehicle-config/latest')) return Promise.resolve('config' in opts ? opts.config : null);
    return Promise.resolve(null);
  });
}

const specsCalls = () => mockRequest.mock.calls.filter((c) => String(c[0]).includes('/specs'));
const optionsCalls = () => mockRequest.mock.calls.filter((c) => String(c[0]).includes('/options'));
const configCalls = () =>
  mockRequest.mock.calls.filter((c) => String(c[0]).startsWith('/vehicle-config/latest'));

function renderWidget(opts: { vehicleId?: number; cols?: number } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const props = {
    vehicleId: opts.vehicleId,
    size: { cols: opts.cols ?? 2, rows: 2 },
  } as WidgetProps;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VehicleSpecsWidget {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] } as never);
  routeAll({});
});

// ── Vehicle resolution ──────────────────────────────────────────────────────

describe('VehicleSpecsWidget vehicle resolution', () => {
  it('prefers the explicit vehicleId prop over the vehicle list', async () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as never);
    routeAll({ specs: envelope(specsData()), config: configData() });
    renderWidget({ vehicleId: 42 });

    await waitFor(() => expect(specsCalls()[0]?.[0]).toBe('/vehicles/42/specs'));
    expect(optionsCalls()[0]?.[0]).toBe('/vehicles/42/options');
    expect(configCalls()[0]?.[0]).toBe('/vehicle-config/latest?vehicle_id=42');
    // The list vehicle (7) must never be queried.
    expect(mockRequest.mock.calls.some((c) => String(c[0]).includes('vehicle_id=7'))).toBe(false);
    expect(mockRequest.mock.calls.some((c) => String(c[0]).includes('/vehicles/7/'))).toBe(false);
  });

  it('falls back to the first vehicle when no prop is given', async () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }, { id: 9 }] } as never);
    routeAll({ specs: envelope(specsData()) });
    renderWidget();

    await waitFor(() => expect(specsCalls()[0]?.[0]).toBe('/vehicles/7/specs'));
    expect(configCalls()[0]?.[0]).toBe('/vehicle-config/latest?vehicle_id=7');
    expect(mockRequest.mock.calls.some((c) => String(c[0]).includes('/vehicles/9/'))).toBe(false);
  });

  it('never queries when no vehicle resolves and shows an empty state (never a blank dashes card)', async () => {
    mockUseVehicles.mockReturnValue({ data: [] } as never);
    routeAll({ specs: envelope(specsData()), config: configData() }); // would show data IF the guard were wrong
    renderWidget();

    const empty = await screen.findByText('No specs available');
    expect(empty.closest('[role="status"]')).not.toBeNull();
    // Regression guard: a disabled config query resolves `undefined`; the old
    // `!== null` check leaked it as "data" and rendered a card of "—".
    expect(screen.queryByText('Model')).toBeNull();
    expect(specsCalls()).toHaveLength(0);
    expect(optionsCalls()).toHaveLength(0);
    expect(configCalls()).toHaveLength(0);
  });
});

// ── States: loading / empty / error ─────────────────────────────────────────

describe('VehicleSpecsWidget states', () => {
  it('renders a loading skeleton (no title, no empty copy) while fetching', () => {
    mockRequest.mockImplementation(() => new Promise(() => {})); // hang
    const { container } = renderWidget({ vehicleId: 1 });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Vehicle Specs')).toBeNull();
    expect(screen.queryByText('No specs available')).toBeNull();
  });

  it('shows an empty state with role=status when every source is empty', async () => {
    routeAll({ specs: envelope(null), options: envelope({}), config: null });
    renderWidget({ vehicleId: 1 });

    const empty = await screen.findByText('No specs available');
    expect(empty.closest('[role="status"]')).not.toBeNull();
    // An empty options object ({}) alone must NOT count as data — so the
    // detail card (and its "Model" row) never renders.
    expect(screen.queryByText('Model')).toBeNull();
    expect(screen.queryByText('Car Version')).toBeNull();
  });

  it('surfaces a QueryError — not the empty state — when ALL requests fail', async () => {
    mockRequest.mockImplementation(() => Promise.reject(new Error('boom')));
    renderWidget({ vehicleId: 1 });

    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Regression guard: the failure must NOT masquerade as an empty state or
    // render the populated card.
    expect(screen.queryByText('No specs available')).toBeNull();
    expect(screen.queryByText('Vehicle Specs')).toBeNull();
  });

  it('keeps showing partial data (no error takeover) when only some sources fail', async () => {
    mockRequest.mockImplementation((path: string) =>
      String(path).includes('/specs')
        ? Promise.resolve(envelope(specsData({ car_type: 'Model S Plaid' })))
        : Promise.reject(new Error('boom')), // options + config down
    );
    renderWidget({ vehicleId: 1 });

    expect(await screen.findByText('Model S Plaid')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).toBeNull();
    expect(screen.queryByText('No specs available')).toBeNull();
  });
});

// ── Populated detail card ───────────────────────────────────────────────────

describe('VehicleSpecsWidget populated detail card', () => {
  it('renders the title and every spec row from the specs + config payloads', async () => {
    routeAll({
      specs: envelope(specsData()),
      options: envelope({ ADX1: 'Enhanced Autopilot' }),
      config: configData(),
    });
    renderWidget({ vehicleId: 1 });

    expect(await screen.findByText('Vehicle Specs')).toBeInTheDocument();
    // Labels
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('Paint Color')).toBeInTheDocument();
    expect(screen.getByText('Car Version')).toBeInTheDocument();
    // Values (specs wins over config for the overlapping fields)
    expect(screen.getByText('Model 3')).toBeInTheDocument();
    expect(screen.getByText('Performance')).toBeInTheDocument();
    expect(screen.getByText('Deep Blue Metallic')).toBeInTheDocument();
    expect(screen.getByText('Uberturbine')).toBeInTheDocument();
    expect(screen.getByText('All Black')).toBeInTheDocument();
    expect(screen.getByText('Li-Ion')).toBeInTheDocument();
    // Car Version is sourced from config.version (not the specs fallback).
    expect(screen.getByText('2024.44.30 abcd')).toBeInTheDocument();
    expect(screen.queryByText('specs-fallback-ver')).toBeNull();
  });

  it('falls back to config values when the specs fields are absent', async () => {
    routeAll({
      specs: envelope({ trim_badging: 'Perf' }), // no car_type / model
      config: configData({ car_type: 'Model Y (cfg)', version: '2025.2.6' }),
    });
    renderWidget({ vehicleId: 1 });

    // Model resolves through specs.car_type → specs.model → config.car_type.
    expect(await screen.findByText('Model Y (cfg)')).toBeInTheDocument();
    expect(screen.getByText('Perf')).toBeInTheDocument();
    expect(screen.getByText('2025.2.6')).toBeInTheDocument();
  });

  it('renders decoded option rows with an "Option" badge, capped at eight', async () => {
    const options: Dict = {};
    for (let i = 0; i < 10; i += 1) options[`OPT${i}`] = `Decoded ${i}`;
    routeAll({ specs: envelope(specsData()), options: envelope(options) });
    renderWidget({ vehicleId: 1 });

    expect(await screen.findByText('Decoded 0')).toBeInTheDocument();
    // Only the first eight option codes survive the slice.
    expect(screen.getAllByText('Option')).toHaveLength(8);
    expect(screen.getByText('OPT7')).toBeInTheDocument();
    expect(screen.queryByText('Decoded 9')).toBeNull();
    expect(screen.queryByText('OPT9')).toBeNull();
  });

  it('is null-safe: missing fields render "—" and never leak "undefined"/"NaN"', async () => {
    routeAll({ specs: envelope({ car_type: 'Model 3' }), options: null, config: null });
    renderWidget({ vehicleId: 1 });

    await screen.findByText('Model 3');
    // Trim / Paint / Wheels / Interior / Aux / Car Version → six placeholders.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText(/undefined|NaN|null/)).toBeNull();
  });
});

// ── Compact (1×1) layout ────────────────────────────────────────────────────

describe('VehicleSpecsWidget compact layout', () => {
  it('renders the title-less Model + Trim hero (no detail rows, no option badges)', async () => {
    routeAll({
      specs: envelope(specsData({ car_type: 'Model X', trim_badging: 'Plaid' })),
      options: envelope({ ADX1: 'Enhanced Autopilot' }),
    });
    renderWidget({ vehicleId: 1, cols: 1 });

    expect(await screen.findByText('Model X')).toBeInTheDocument();
    expect(screen.getByText('Trim: Plaid')).toBeInTheDocument();
    // Compact drops the header title, the labelled detail rows, and options.
    expect(screen.queryByText('Vehicle Specs')).toBeNull();
    expect(screen.queryByText('Paint Color')).toBeNull();
    expect(screen.queryByText('Enhanced Autopilot')).toBeNull();
  });

  it('is null-safe in compact mode: an absent trim renders "Trim: —"', async () => {
    routeAll({ specs: envelope({ car_type: 'Model 3' }) }); // no trim
    renderWidget({ vehicleId: 1, cols: 1 });

    expect(await screen.findByText('Model 3')).toBeInTheDocument();
    expect(screen.getByText('Trim: —')).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).toBeNull();
  });
});

// ── Refresh interaction ─────────────────────────────────────────────────────

describe('VehicleSpecsWidget refresh', () => {
  it('re-issues all three reads when the freshness refresh control is activated', async () => {
    routeAll({ specs: envelope(specsData()), options: envelope({ ADX1: 'EAP' }), config: configData() });
    renderWidget({ vehicleId: 1 });

    const refresh = await screen.findByRole('button', { name: /^Refresh/i });
    const before = specsCalls().length;
    expect(before).toBeGreaterThanOrEqual(1);

    fireEvent.click(refresh);

    await waitFor(() => expect(specsCalls().length).toBe(before + 1));
    expect(optionsCalls().length).toBeGreaterThanOrEqual(2);
    expect(configCalls().length).toBeGreaterThanOrEqual(2);
  });
});
