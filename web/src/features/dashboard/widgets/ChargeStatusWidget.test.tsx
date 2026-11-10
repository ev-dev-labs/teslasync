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
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
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
  return { state: { ...makeState(over), charge_limit_soc_pct: limit } as unknown as VehicleState, live: true };
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

function renderWidget(props: Partial<WidgetProps> = {}, packId: PackId = 'classic') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={packId}>
          <ChargeStatusWidget size={SIZE} {...props} />
        </PackBoundary>
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
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
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

type StateEnvelope = NonNullable<ReturnType<typeof useVehicleState>['data']>;

function packState(over: Partial<NonNullable<StateEnvelope['state']>> = {}): StateEnvelope {
  return {
    state: { ...makeState(), ...over },
    live: true,
    freshness: 'fresh',
    observedAt: Date.now(),
    verifiedFields: ['is_charging'],
  };
}

async function renderPackWidget(packId: PackId, props: Partial<WidgetProps> = {}) {
  const view = renderWidget(props, packId);
  expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId !== 'classic') {
    await waitFor(() => {
      expect(view.container.querySelector('[data-instrument-family="ring"]'))
        .toHaveAttribute('data-instrument-appearance', PACK_APPEARANCES[packId]);
    });
  }
  return view;
}

describe.each(PACK_IDS)('ChargeStatusWidget — %s acceptance', (packId) => {
  it.each([2, 4])('preserves verified charging content and display units at %i rows', async (rows) => {
    mockVehicleState.mockReturnValue(qr({
      data: packState({ ...CHARGING, battery_level: 64, charge_limit_soc_pct: 80, charge_amps_a: 16 }),
    }));
    const { container } = await renderPackWidget(packId, { vehicleId: 42, size: { cols: 2, rows } });
    expect(mockVehicleState).toHaveBeenLastCalledWith(42);
    expect(screen.getByRole('button', { name: 'Charging' })).toBeInTheDocument();
    expect(screen.getByText('64 → 80')).toBeInTheDocument();
    expect(screen.getByText('Charge limit 80%')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '64');
    expect(screen.getByTestId('charge-limit-marker')).toHaveStyle({ left: '80%' });
    for (const text of ['Power', '11.0', 'kW', 'Current', '16.0', 'A', 'Rate', '32', 'km/h', 'Range', '300', 'km', 'Time to full', '2h 30m', 'Done']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(container.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(container.querySelector('.widget-energy-stream')).toHaveClass('widget-state-motion');
    expect(container.querySelector('.widget-cell-stream')).toHaveClass('widget-state-motion');
  });

  it.each([
    { name: 'cached', evidence: { live: false } },
    { name: 'unverified', evidence: { verifiedFields: [] } },
    { name: 'stale', evidence: { freshness: 'stale' } },
  ] satisfies { name: string; evidence: Partial<StateEnvelope> }[])(
    'does not promote $name charging evidence to active charging',
    async ({ evidence }) => {
      mockVehicleState.mockReturnValue(qr({ data: { ...packState(CHARGING), ...evidence } }));
      const { container } = await renderPackWidget(packId);
      expect(screen.getByRole('button', { name: 'Charging · Last reported' })).toBeInTheDocument();
      expect(screen.getByText('72')).toBeInTheDocument();
      expect(container.querySelector('.widget-energy-stream, .widget-cell-stream')).toBeNull();
    },
  );

  it('retains signed and zero readings on refresh failure and retries the selected vehicle', async () => {
    const refetch = vi.fn();
    mockVehicleState.mockReturnValue(qr({
      data: packState({
        ...CHARGING, battery_level: 0, charger_power: 0, charge_amps_a: 0,
        charge_rate: -1000, rated_range: 0, time_to_full_charge: -1,
      }),
      isError: true,
      error: new Error('refresh failed'),
      refetch,
    }));
    const { container } = await renderPackWidget(packId, { vehicleId: 42 });
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'stale');
    expect(container.querySelector('[data-motion-suppressed]')).toHaveAttribute('data-motion-suppressed', 'true');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Charging · Last reported' })).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getAllByText('0.0')).toHaveLength(2);
    expect(screen.getByText('-1')).toBeInTheDocument();
    expect(screen.queryByText('0m')).not.toBeInTheDocument();
    expect(container.querySelector('.widget-energy-stream, .widget-cell-stream')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mockVehicleState).toHaveBeenLastCalledWith(42);
  });

  it('keeps idle zero battery, current, range and charge limit as real measurements', async () => {
    mockVehicleState.mockReturnValue(qr({
      data: packState({
        is_charging: false, battery_level: 0, charge_amps_a: 0, rated_range: 0, charge_limit_soc_pct: 0,
      }),
    }));
    const { container } = await renderPackWidget(packId);
    expect(screen.getByRole('button', { name: 'Not charging' })).toBeInTheDocument();
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('0%');
    expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByTestId('charge-limit-marker')).toHaveStyle({ left: '0%' });
    expect(screen.getByText('Charge limit 0%')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.getByText('Range')).toBeInTheDocument();
    expect(screen.getByText('km')).toBeInTheDocument();
    expect(screen.queryByText('Power')).not.toBeInTheDocument();
    expect(container.querySelector('.widget-energy-stream, .widget-cell-stream')).toBeNull();
  });

  it('keeps unknown charging and missing measurements distinct from idle and zero', async () => {
    mockVehicleState.mockReturnValue(qr({
      data: packState({ is_charging: null, battery_level: null, rated_range: null, charge_amps_a: null }),
    }));
    const { container } = await renderPackWidget(packId);
    expect(screen.getByRole('button', { name: 'Unknown' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not charging' })).not.toBeInTheDocument();
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
    expect(container.querySelector('[data-charge-pack]')).toHaveAttribute('data-charge-pack', 'unknown');
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Range')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(container.querySelector('.widget-energy-stream, .widget-cell-stream')).toBeNull();
  });

  it('preserves out-of-scale battery text without inventing valid measurements or estimates', async () => {
    mockVehicleState.mockReturnValue(qr({
      data: packState({
        ...CHARGING, battery_level: 125, charge_limit_soc_pct: -1,
        charger_power: NaN, charge_amps_a: -1, charge_rate: Infinity,
        rated_range: NaN, time_to_full_charge: -1,
      }),
    }));
    const { container } = await renderPackWidget(packId);
    expect(screen.getByText('125')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('charge-limit-marker')).not.toBeInTheDocument();
    expect(container.querySelector('[data-charge-pack]')).toHaveAttribute('data-charge-pack', 'unknown');
    expect(container.textContent).not.toMatch(/NaN|Infinity|0m/);
    for (const label of ['Power', 'Current', 'Rate', 'Range', 'Time to full', 'Done']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(6);
  });

  it('keeps initial loading separate from empty charge data', () => {
    mockVehicleState.mockReturnValue(qr({ data: undefined, isLoading: true, isFetching: true }));
    const { container } = renderWidget({}, packId);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initial');
    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByText('No charge data')).not.toBeInTheDocument();
  });

  it('keeps fatal errors recoverable through the vehicle-state refresh control', () => {
    const refetch = vi.fn();
    mockVehicleState.mockReturnValue(qr({ data: undefined, isError: true, error: new Error('state down'), refetch }));
    const { container } = renderWidget({ vehicleId: 42 }, packId);
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initialFailure');
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No charge data')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('preserves the empty message and vehicle-list retry when no vehicle is available', async () => {
    const refetch = vi.fn();
    mockVehicles.mockReturnValue(qr({ data: [], refetch }));
    mockVehicleState.mockReturnValue(qr({ data: { ...packState(), state: undefined, live: false } }));
    await renderPackWidget(packId);
    expect(mockVehicleState).toHaveBeenLastCalledWith(0);
    expect(screen.getByText('No charge data')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Charging' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
