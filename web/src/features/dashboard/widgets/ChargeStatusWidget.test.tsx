/**
 * ChargeStatusWidget — behaviour + hardening tests.
 *
 * ChargeStatusWidget is a dashboard tile that resolves a target vehicle
 * (`vehicleId` prop → first vehicle → 0) and renders its live charge state
 * (`useVehicleState`). After-spec layout (Phase 2 redesign):
 *   - charging     → "Charging" pill, headline battery ("64 → 80 %" when a
 *                    validated charge_limit_soc is present, else "64 %"),
 *                    done-at time via the shared date layer plus time-left,
 *                    battery meter with limit marker, stat grid
 *                    Power (kW, 1 decimal) / Rate (distance-unit/h) / Range.
 *   - not charging → "Not charging" pill, headline battery %, meter, range.
 *   - unknown      → "Unknown" pill with the same battery/range face.
 *   - no state     → an explicit "No charge data" empty state (never blank).
 * The surrounding `WidgetShell` owns the loading skeleton and the single
 * top-right `FreshnessDot` / refresh affordance.
 *
 * The two data hooks are mocked at the `@/api/hooks/useVehicles` boundary so
 * every orchestration branch is deterministic. `react-i18next` is echo-mocked
 * so assertions target the rendered English fallback; `useSettings` /
 * `useTimezone` come from the global stub in src/test-setup.ts (metric — km).
 * Network never touches the real backend.
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

// jsdom lacks matchMedia; useMotionPreference (via <FreshnessDot>) reads it.
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

it.each([1, 2, 3])('identifies charge status at %i columns', (cols) => {
  renderWidget({ size: { cols, rows: 2 } });
  expect(screen.getByRole('heading', { name: 'Charge status' })).toBeInTheDocument();
});
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import type { VehicleState } from '@/api/types';
import type { WidgetProps, WidgetSize } from './types';

const mockVehicles = vi.mocked(useVehicles);
const mockVehicleState = vi.mocked(useVehicleState);

const SIZE: WidgetSize = { cols: 1, rows: 1 };

/** Minimal `UseQueryResult`-shaped stub (incl. the FreshnessDot fields). */
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

/** A state object with an extra (untyped) `charge_limit_soc` field attached. */
function stateWithLimit(limit: unknown, over: Partial<VehicleState> = {}) {
  return { state: { ...makeState(over), charge_limit_soc: limit } as unknown as VehicleState, live: true };
}

// A charging state with clean, deterministic display values:
//   charger_power 11    → "11.0 kW" (1 decimal)
//   charge_rate  32000  → 32 km/h  (32000 m/h ÷ 1000, whole)
//   battery_level 72    → "72%"
//   time_to_full 2.5    → "2h 30m" left
const CHARGING: Partial<VehicleState> = {
  is_charging: true,
  charger_power: 11,
  charge_rate: 32_000,
  battery_level: 72,
  time_to_full_charge: 2.5,
};

it('animates only verified current charging and keeps the true current-to-limit readout', () => {
  mockVehicleState.mockReturnValue(qr({
    data: {
      ...stateWithLimit(80, { ...CHARGING, battery_level: 64 }),
      freshness: 'fresh', observedAt: Date.now(), verifiedFields: ['is_charging'],
    },
  }));
  const { container } = renderWidget({ vehicleId: 42 });
  expect(container.querySelector('.widget-energy-stream')).toHaveClass('widget-state-motion');
  expect(container.querySelector('.widget-cell-stream')).toHaveClass('widget-state-motion');
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '64');
  expect(screen.getByTestId('charge-limit-marker')).toHaveStyle({ left: '80%' });
  expect(screen.getByText('64 → 80')).toBeInTheDocument();
});

function renderWidget(props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChargeStatusWidget size={SIZE} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(view.container.querySelector('h3')).toHaveAccessibleName('Charge status');
  return view;
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
    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByText('Charging')).toBeNull();
    expect(screen.queryByText('No charge data')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Refresh/i })).toBeInTheDocument();
  });

  it('renders an explicit empty state when no vehicle state has arrived', () => {
    mockVehicleState.mockReturnValue(qr({ data: { state: undefined, live: false } }));
    renderWidget();
    expect(screen.getByText('No charge data')).toBeInTheDocument();
    expect(screen.queryByText('Charging')).toBeNull();
    expect(screen.queryByText('Not charging')).toBeNull();
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
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(container.querySelector('[class~="bg-[var(--semantic-danger)]"]')).not.toBeNull();
  });
});

describe('ChargeStatusWidget — charging', () => {
  it('renders the charging pill, formatted metrics and SI→display rate conversion', () => {
    const { container } = renderWidget();
    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(container.textContent).toContain('11.0');
    expect(container.textContent).toContain('32');
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText(/2h 30m/)).toBeInTheDocument();
    expect(screen.queryByText('Not charging')).toBeNull();
  });

  it('labels every metric through i18n', () => {
    renderWidget();
    expect(screen.getByText('Power')).toBeInTheDocument();
    expect(screen.getByText('Rate')).toBeInTheDocument();
    expect(screen.getByText('Range')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Battery' })).toBeInTheDocument();
    expect(screen.getByText(/Time to full/)).toBeInTheDocument();
  });

  it('renders a done-at clock time through the shared date layer', () => {
    const { container } = renderWidget();
    expect(container.textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it('preserves a real zero time-to-full estimate', () => {
    mockVehicleState.mockReturnValue(
      qr({ data: stateData({ ...CHARGING, time_to_full_charge: 0 }) }),
    );
    renderWidget();
    expect(screen.getByText(/0m/)).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
  });

  it('shows current → limit headline and limit marker when charge_limit_soc is valid', () => {
    mockVehicleState.mockReturnValue(qr({ data: stateWithLimit(80, { ...CHARGING, battery_level: 64 }) }));
    const { container } = renderWidget();
    expect(screen.getByText('64 → 80')).toBeInTheDocument();
    const marker = container.querySelector('[data-testid="charge-limit-marker"]');
    expect(marker).not.toBeNull();
    expect(marker).toHaveStyle({ left: '80%' });
    expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '64');
  });

  it('omits the limit headline and marker when charge_limit_soc is invalid', () => {
    mockVehicleState.mockReturnValue(qr({ data: stateWithLimit('high', { ...CHARGING, battery_level: 64 }) }));
    const { container } = renderWidget();
    expect(container.querySelector('[data-testid="charge-limit-marker"]')).toBeNull();
    expect(screen.getByText('64')).toBeInTheDocument();
    expect(screen.queryByText(/→/)).toBeNull();
  });

  it('retains an out-of-scale reading as the headline without a clipped meter', () => {
    mockVehicleState.mockReturnValue(qr({ data: stateData({ ...CHARGING, battery_level: 125 }) }));
    renderWidget();
    expect(screen.getByText('125')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).toBeNull();
  });
});

describe('ChargeStatusWidget — not charging', () => {
  it('shows the not-charging line with battery % and SI→display rated range', () => {
    mockVehicleState.mockReturnValue(
      qr({ data: stateData({ is_charging: false, battery_level: 80, rated_range: 400_000 }) }),
    );
    const { container } = renderWidget();
    expect(screen.getByText('Not charging')).toBeInTheDocument();
    expect(container.textContent).toContain('80');
    expect(container.textContent).toContain('400');
    expect(screen.queryByText('Charging')).toBeNull();
  });
});

describe('ChargeStatusWidget — null-safety hardening', () => {
  it('keeps an unknown charging status distinct from idle', () => {
    mockVehicleState.mockReturnValue(qr({
      data: stateData({ is_charging: undefined as unknown as boolean, battery_level: 0, rated_range: 0 }),
    }));
    renderWidget();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('Not charging')).not.toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps a missing charging battery level unknown, never a fake zero', () => {
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
    const { container } = renderWidget();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.textContent).toContain('7.0');
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('keeps missing idle battery and range unknown', () => {
    mockVehicleState.mockReturnValue(
      qr({
        data: stateData({
          is_charging: false,
          battery_level: null as unknown as number,
          rated_range: null as unknown as number,
        }),
      }),
    );
    renderWidget();
    expect(screen.getByText('Not charging')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});

describe('ChargeStatusWidget — refresh wiring', () => {
  it('retains signed rates and real zero readings on a cached refetch error', () => {
    mockVehicleState.mockReturnValue(qr({
      data: stateData({ ...CHARGING, charger_power: 0, battery_level: 0, charge_rate: -1000 }),
      isError: true,
      error: new Error('refresh failed'),
    }));
    const { container } = renderWidget();
    expect(container.textContent).toContain('0.0');
    expect(container.textContent).toContain('-1');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });

  it('invokes the query refetch when the freshness control is activated', () => {
    const refetch = vi.fn();
    mockVehicleState.mockReturnValue(qr({ data: stateData(CHARGING), refetch }));
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps retained charging readings visible on a refetch error', () => {
    const refetch = vi.fn();
    mockVehicleState.mockReturnValue(qr({
      data: stateData({ ...CHARGING, charger_power: 0, charge_rate: -1000, battery_level: 72, time_to_full_charge: -1 }),
      isError: true,
      error: new Error('refresh failed'),
      refetch,
    }));
    renderWidget({ vehicleId: 42 });
    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data ·/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
