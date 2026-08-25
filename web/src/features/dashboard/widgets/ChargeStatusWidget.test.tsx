/**
 * ChargeStatusWidget — behaviour + hardening tests.
 *
 * ChargeStatusWidget is a 1×1 dashboard tile that resolves a target vehicle
 * (`vehicleId` prop → first vehicle → 0) and renders its live charge state
 * (`useVehicleState`). The body has three mutually-exclusive branches:
 *   - charging     → a "Charging" header plus a 2×2 grid of Power (kW), Rate
 *                    (distance-unit/h), Battery (%) and Time-to-Full (h or "—").
 *   - not charging → a "Not Charging" line with battery % · rated range.
 *   - no state     → an explicit "No charge data" empty state (never blank).
 * The surrounding `WidgetShell` owns the loading skeleton and the compact
 * data-freshness / refresh affordance (the tile has no title, so the chip is
 * icon-only but still exposes `role="button"` labelled "Refresh").
 *
 * The two data hooks are mocked at the `@/api/hooks/useVehicles` boundary so
 * every orchestration branch is deterministic. `react-i18next` is echo-mocked
 * so assertions target the rendered English fallback; `useSettings` /
 * `useTimezone` come from the global stub in src/test-setup.ts (metric — km).
 * Network never touches the real backend.
 *
 * Facets covered:
 *   - vehicle resolution: explicit prop wins; else first vehicle; else 0.
 *   - loading  → skeleton, no refresh control, no body (never a blank panel).
 *   - empty    → explicit "No charge data" empty state.
 *   - error    → non-blank empty state + the freshness chip's error dot.
 *   - charging → SI→display conversion for rate (32000 m/h → "32 km/h"),
 *                power/battery/time-to-full formatting, and the i18n labels.
 *   - time-to-full ≤ 0 renders the "—" placeholder (branch coverage).
 *   - not charging → "Not Charging" + battery% · rated range (400000 m → km).
 *   - null-safety (the hardening): a null battery_level renders "0%" (not a
 *     bare "%"); null battery_level + rated_range render "0% · 0 km".
 *   - refresh: activating the freshness control invokes the query refetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

// Both vehicle hooks are mocked so the widget's orchestration is deterministic.
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: vi.fn(), useVehicleState: vi.fn() };
});

// jsdom lacks matchMedia; useMotionPreference (via <DataFreshness>) reads it.
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

import ChargeStatusWidget from './ChargeStatusWidget';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import type { VehicleState } from '@/api/types';
import type { WidgetProps, WidgetSize } from './types';

const mockVehicles = vi.mocked(useVehicles);
const mockVehicleState = vi.mocked(useVehicleState);

const SIZE: WidgetSize = { cols: 1, rows: 1 };

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
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

/** `useVehicles()` stub — the widget only reads `.data[i].id`. */
function vehicles(ids: number[]): never {
  return { data: ids.map((id) => ({ id })) } as never;
}

/** Fully-populated VehicleState with sensible SI defaults; override per test. */
function makeState(over: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 50,
    rated_range: 300_000,
    ideal_range: 300_000,
    odometer: 0,
    inside_temp: 20,
    outside_temp: 15,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '2025.1',
    ...over,
  };
}

/** Wrap the assembled state in the `{ state, live }` envelope the hook returns. */
function stateData(over: Partial<VehicleState> = {}) {
  return { state: makeState(over), live: true };
}

// A charging state with clean, deterministic display values:
//   charger_power 11    → "11.00 kW"
//   charge_rate  32000  → 32 km/h  (32000 m/h ÷ 1000)
//   battery_level 72    → "72%"
//   time_to_full 2.5    → "2.5h"
const CHARGING: Partial<VehicleState> = {
  is_charging: true,
  charger_power: 11,
  charge_rate: 32_000,
  battery_level: 72,
  time_to_full_charge: 2.5,
};

function renderWidget(props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChargeStatusWidget size={SIZE} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockVehicles.mockReset();
  mockVehicleState.mockReset();
  mockVehicles.mockReturnValue(vehicles([1]));
  mockVehicleState.mockReturnValue(qr({ data: stateData(CHARGING) }));
});

afterEach(() => {
  cleanup();
});

describe('ChargeStatusWidget — vehicle resolution', () => {
  it('prefers the explicit vehicleId prop over the vehicle list', () => {
    mockVehicles.mockReturnValue(vehicles([7, 9]));
    renderWidget({ vehicleId: 42 });

    expect(mockVehicleState).toHaveBeenCalledWith(42);
  });

  it('falls back to the first vehicle when no vehicleId prop is given', () => {
    mockVehicles.mockReturnValue(vehicles([7, 9]));
    renderWidget();

    expect(mockVehicleState).toHaveBeenCalledWith(7);
  });

  it('falls back to 0 when there is neither a prop nor any vehicle', () => {
    mockVehicles.mockReturnValue(vehicles([]));
    renderWidget();

    expect(mockVehicleState).toHaveBeenCalledWith(0);
  });
});

describe('ChargeStatusWidget — shell states', () => {
  it('shows a skeleton (never a blank panel) and no refresh control while loading', () => {
    mockVehicleState.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Charging')).toBeNull();
    expect(screen.queryByText('No charge data')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Refresh/i })).toBeNull();
  });

  it('renders an explicit empty state when no vehicle state has arrived', () => {
    mockVehicleState.mockReturnValue(qr({ data: { state: undefined, live: false } }));
    renderWidget();

    expect(screen.getByText('No charge data')).toBeInTheDocument();
    expect(screen.queryByText('Charging')).toBeNull();
    expect(screen.queryByText('Not Charging')).toBeNull();
  });

  it('is resilient when the query resolves to undefined data', () => {
    mockVehicleState.mockReturnValue(qr({ data: undefined }));
    renderWidget();

    expect(screen.getByText('No charge data')).toBeInTheDocument();
  });

  it('surfaces a fetch error as a non-blank panel plus the freshness error dot', () => {
    mockVehicleState.mockReturnValue(
      qr({ isError: true, error: new Error('state down'), data: undefined }),
    );
    const { container } = renderWidget();

    // Body is never blank — the empty state stands in for the missing data…
    expect(screen.getByText('No charge data')).toBeInTheDocument();
    // …and the error is still communicated through the freshness chip.
    expect(container.querySelector('.bg-red-400')).not.toBeNull();
  });
});

describe('ChargeStatusWidget — charging', () => {
  it('renders the charging header, formatted metrics and SI→display rate conversion', () => {
    renderWidget();

    expect(screen.getByText('Charging')).toBeInTheDocument();

    // Metric values (each is a single <p> once text nodes are joined).
    expect(screen.getByText('11.00 kW')).toBeInTheDocument();
    expect(screen.getByText('32 km/h')).toBeInTheDocument(); // 32000 m/h → 32 km/h
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('2.5h')).toBeInTheDocument();

    // Not-charging copy must be absent on the charging branch.
    expect(screen.queryByText('Not Charging')).toBeNull();
  });

  it('labels every metric through i18n', () => {
    renderWidget();

    expect(screen.getByText('Power')).toBeInTheDocument();
    expect(screen.getByText('Rate')).toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('Time to Full')).toBeInTheDocument();
  });

  it('renders "—" for time-to-full when the estimate is not positive', () => {
    mockVehicleState.mockReturnValue(
      qr({ data: stateData({ ...CHARGING, time_to_full_charge: 0 }) }),
    );
    renderWidget();

    expect(screen.getByText('—')).toBeInTheDocument();
    // The other charging metrics still render.
    expect(screen.getByText('72%')).toBeInTheDocument();
  });
});

describe('ChargeStatusWidget — not charging', () => {
  it('shows the not-charging line with battery % and SI→display rated range', () => {
    mockVehicleState.mockReturnValue(
      qr({ data: stateData({ is_charging: false, battery_level: 80, rated_range: 400_000 }) }),
    );
    const { container } = renderWidget();

    expect(screen.getByText('Not Charging')).toBeInTheDocument();
    // "80% · 400 km" — assert the pieces to stay robust to the middot spacing.
    expect(container.textContent).toContain('80%');
    expect(container.textContent).toContain('400 km'); // 400000 m → 400 km
    // Charging-only copy must be absent.
    expect(screen.queryByText('Charging')).toBeNull();
  });
});

describe('ChargeStatusWidget — null-safety hardening', () => {
  it('renders "0%" (not a bare "%") when a charging battery_level is null', () => {
    mockVehicleState.mockReturnValue(
      qr({
        data: stateData({
          is_charging: true,
          charger_power: 7,
          charge_rate: 0,
          time_to_full_charge: 0,
          battery_level: null as unknown as number,
        }),
      }),
    );
    renderWidget();

    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders "0% · 0 km" when a not-charging battery_level and rated_range are null', () => {
    mockVehicleState.mockReturnValue(
      qr({
        data: stateData({
          is_charging: false,
          battery_level: null as unknown as number,
          rated_range: null as unknown as number,
        }),
      }),
    );
    const { container } = renderWidget();

    expect(screen.getByText('Not Charging')).toBeInTheDocument();
    // Without the `?? 0` hardening this line would read "% · 0 km".
    expect(container.textContent).toContain('0%');
    expect(container.textContent).toContain('0 km');
  });
});

describe('ChargeStatusWidget — refresh wiring', () => {
  it('invokes the query refetch when the freshness control is activated', () => {
    const refetch = vi.fn();
    mockVehicleState.mockReturnValue(qr({ data: stateData(CHARGING), refetch }));
    renderWidget();

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
