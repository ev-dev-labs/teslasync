/**
 * ChargeStatusWidget — behaviour + hardening tests.
 *
 * ChargeStatusWidget is a 1×1 dashboard tile that resolves a target vehicle
 * (`vehicleId` prop → first vehicle → 0) and renders its live charge state
 * (`useVehicleState`). The body has three mutually-exclusive branches:
 *   - charging     → a "Charging" header plus a compact source brief of Power (kW), Rate
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
 *   - time-to-full < 0 renders "—"; a real zero remains a measured estimate.
 *   - not charging → "Not Charging" + battery% · rated range (400000 m → km).
 *   - null-safety: missing battery/range readings render "—", never fake zero.
 *   - refresh: activating the freshness control invokes the query refetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
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

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
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
    expect(screen.getByText('32.00 km/h')).toBeInTheDocument(); // 32000 m/h → 32 km/h
    expect(screen.getByText('72.00%')).toBeInTheDocument();
    expect(screen.getByText('2.50h')).toBeInTheDocument();

    // Not-charging copy must be absent on the charging branch.
    expect(screen.queryByText('Not charging')).toBeNull();
  });

  it('labels every metric through i18n', () => {
    renderWidget();

    expect(screen.getByText('Power')).toBeInTheDocument();
    expect(screen.getByText('Rate')).toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('Time to full')).toBeInTheDocument();
  });

  it('preserves a real zero time-to-full estimate', () => {
    mockVehicleState.mockReturnValue(
      qr({ data: stateData({ ...CHARGING, time_to_full_charge: 0 }) }),
    );
    renderWidget();

    expect(screen.getByText('0.00h')).toBeInTheDocument();
    // The other charging metrics still render.
    expect(screen.getByText('72.00%')).toBeInTheDocument();
  });
});

describe('ChargeStatusWidget — not charging', () => {
  it('shows the not-charging line with battery % and SI→display rated range', () => {
    mockVehicleState.mockReturnValue(
      qr({ data: stateData({ is_charging: false, battery_level: 80, rated_range: 400_000 }) }),
    );
    const { container } = renderWidget();

    expect(screen.getByText('Not charging')).toBeInTheDocument();
    // "80% · 400 km" — assert the pieces to stay robust to the middot spacing.
    expect(container.textContent).toContain('80.00%');
    expect(container.textContent).toContain('400.00 km'); // 400000 m → 400 km
    // Charging-only copy must be absent.
    expect(screen.queryByText('Charging')).toBeNull();
  });
});

describe('ChargeStatusWidget — null-safety hardening', () => {
  it('keeps an unknown charging status distinct from idle in a fitted stat grid', () => {
    mockVehicleState.mockReturnValue(qr({
      data: stateData({ is_charging: undefined as unknown as boolean, battery_level: 0, rated_range: 0 }),
    }));
    const { container } = renderWidget();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('Not charging')).not.toBeInTheDocument();
    expect(screen.getByText('0.00%')).toBeInTheDocument();
    expect(screen.getByText('0.00 km')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('data-testid', 'dashboard-charge-status-idle-brief');
  });
  it('keeps a missing charging battery level unknown', () => {
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

    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
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
    const { container } = renderWidget();

    expect(screen.getByText('Not charging')).toBeInTheDocument();
    // Without the `?? 0` hardening this line would read "% · 0 km".
    expect(container.textContent).not.toContain('0.00%');
    expect(container.textContent).not.toContain('0.00 km');
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});

describe('ChargeStatusWidget — refresh wiring', () => {
  it('retains signed rates and real zero readings on a cached refetch error', () => {
    mockVehicleState.mockReturnValue(qr({
      data: stateData({ ...CHARGING, charger_power: 0, battery_level: 0, charge_rate: -1000 }),
      isError: true,
      error: new Error('refresh failed'),
    }));
    renderWidget();
    expect(screen.getByText('0.00 kW')).toBeInTheDocument();
    expect(screen.getByText('0.00%')).toBeInTheDocument();
    expect(screen.getByText('-1.00 km/h')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });

  describe('ChargeStatusWidget — actual source briefs', () => {
    it('keeps all four charging operands, zero versus missing and retained source trust in the actual brief', () => {
      const refetch = vi.fn();
      mockVehicleState.mockReturnValue(qr({
        data: stateData({
          ...CHARGING,
          charger_power: 0,
          charge_rate: -1000,
          battery_level: null as unknown as number,
          time_to_full_charge: -1,
        }),
        isError: true,
        error: new Error('refresh failed'),
        refetch,
      }));
      renderWidget({ vehicleId: 42 });

      const brief = screen.getByTestId('dashboard-charge-status-charging-brief');
      expect(within(brief).getAllByRole('listitem')).toHaveLength(4);
      expect(within(brief).getByText('0.00 kW')).toBeInTheDocument();
      expect(within(brief).getByText('-1.00 km/h')).toBeInTheDocument();
      expect(within(brief).queryByText('0.00%')).not.toBeInTheDocument();
      expect(within(brief).getAllByText('—')).toHaveLength(2);
      expect(brief.querySelector('[data-operational-metric="charge-status-power"]')).toHaveAttribute('data-value-state', 'value');
      expect(brief.querySelector('[data-operational-metric="charge-status-battery"]')).toHaveAttribute('data-value-state', 'missing');
      expect(within(brief).getByText('Retained readings')).toBeInTheDocument();
      expect(within(brief).getByText('Vehicle 42 · returned state snapshot; not a completed charging session or continuous recording.')).toBeInTheDocument();
      expect(screen.getByText('Charging')).toBeInTheDocument();
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('keeps both idle operands and unknown charging status distinct from discovery and missing source states', () => {
      const refetch = vi.fn();
      mockVehicleState.mockReturnValue(qr({
        data: stateData({
          is_charging: undefined as unknown as boolean,
          battery_level: 0,
          rated_range: null as unknown as number,
        }),
        refetch,
      }));
      renderWidget();

      const brief = screen.getByTestId('dashboard-charge-status-idle-brief');
      expect(within(brief).getAllByRole('listitem')).toHaveLength(2);
      expect(within(brief).getByText('0.00%')).toBeInTheDocument();
      expect(within(brief).getByText('—')).toBeInTheDocument();
      expect(brief.querySelector('[data-operational-metric="charge-status-battery"]')).toHaveAttribute('data-value-state', 'value');
      expect(brief.querySelector('[data-operational-metric="charge-status-range"]')).toHaveAttribute('data-value-state', 'missing');
      expect(within(brief).getByText('Source available')).toBeInTheDocument();
      expect(screen.getByText('Unknown')).toBeInTheDocument();
      expect(screen.queryByText('Not charging')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-charge-status-charging-brief')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
      expect(refetch).toHaveBeenCalledTimes(1);

      cleanup();
      const discover = vi.fn();
      mockVehicles.mockReturnValue(qr({ isLoading: true, refetch: discover }));
      mockVehicleState.mockReturnValue(qr());
      const discovery = renderWidget();
      expect(discovery.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initial');
      expect(discovery.container.querySelector('.animate-pulse')).toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-charge-status-idle-brief')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
      expect(discover).toHaveBeenCalledTimes(1);

      cleanup();
      mockVehicles.mockReturnValue(vehicles([1]));
      mockVehicleState.mockReturnValue(qr({ data: { state: undefined, live: false } }));
      const empty = renderWidget();
      expect(empty.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'unavailable');
      expect(screen.getByText('No charge data')).toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-charge-status-idle-brief')).not.toBeInTheDocument();
    });
  });
  it('invokes the query refetch when the freshness control is activated', () => {
    const refetch = vi.fn();
    mockVehicleState.mockReturnValue(qr({ data: stateData(CHARGING), refetch }));
    renderWidget();

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
