/**
 * GlancePage — behaviour + hardening coverage.
 *
 * GlancePage is the compact, live "at a glance" dashboard for a single
 * vehicle. It exposes a default page export plus two pure helpers
 * (`getLocationLabel`, `batteryNeon`). This suite drives every meaningful
 * branch by mocking the four data hooks (`useVehicles` / `useVehicleState` /
 * `useLocationSnapshotLatest` / `useVehicleCommand`) and the unit-formatting
 * bridge (`useUnits`). Network is never touched.
 *
 * Facets covered:
 *   - pure helpers: every getLocationLabel branch (+ precedence) and every
 *     batteryNeon threshold, asserted directly.
 *   - no-vehicle guard: renders a guided vehicle-setup state and no
 *     header actions / KPI scaffolding.
 *   - vehicles-loading: page title renders but no content (PageContainer
 *     spinner).
 *   - populated happy path: honest KPI tiles, hero identity + battery ring,
 *     charging/climate + security/location panels, and the footer link.
 *   - SI display boundary: the six KPI formatters receive raw SI values and
 *     their output is rendered verbatim.
 *   - per-panel state: loading → panel shells stay but content is withheld;
 *     empty → per-panel EmptyState; error → per-panel QueryError + working
 *     Retry that re-invokes refetch.
 *   - command band: lock/climate/horn dispatch the right command; offline and
 *     in-flight states disable the controls and surface the offline hint.
 *   - URL-state wiring: ?vehicle_id= selects that vehicle, unknown ids fall
 *     back to the first, and workspace changes update the selection without
 *     mounting a competing local picker.
 *   - null-safety: absent location flags/destination/ETA collapse to the "—"
 *     glyph and the not-charging / unlocked / climate-off branches render.
 *   - a11y: labelled region landmarks, workspace-owned selection, and icon-only
 *     controls all expose accessible names.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Button } from '@/components/ui';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { getWorkspaceRouteScope } from '@/lib/workspaceScope';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/resilience';
import type { VehicleState, LocationSnapshot } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';

// ── i18n stub: return the fallback string, interpolating {{var}} options ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
          return s;
        }
        return fallbackOrOpts;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── framer-motion: strip animation props (keep motion.div + useReducedMotion) ──
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              k === 'animate' ||
              k === 'initial' ||
              k === 'exit' ||
              k === 'transition' ||
              k === 'whileHover' ||
              k === 'whileTap' ||
              k === 'variants'
            )
              continue;
            safe[k] = v;
          }
          return <div {...(safe as Record<string, unknown>)}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

// ── Data + environment hooks, driven per test ──
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
  useVehicleState: vi.fn(),
  useLocationSnapshotLatest: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicleCommand', () => ({ useVehicleCommand: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));

import {
  useVehicles,
  useVehicleState,
  useLocationSnapshotLatest,
} from '@/api/hooks/useVehicles';
import { useVehicleCommand } from '@/api/hooks/useVehicleCommand';
import { useUnits } from '@/hooks/useUnits';
import GlancePage, { getLocationLabel, batteryNeon } from './GlancePage';

const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockState = useVehicleState as unknown as ReturnType<typeof vi.fn>;
const mockLocation = useLocationSnapshotLatest as unknown as ReturnType<typeof vi.fn>;
const mockCommand = useVehicleCommand as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;

// ── Fixtures ──
const STATE: VehicleState = {
  vehicle_id: 1,
  state: 'online',
  latitude: 37.1,
  longitude: -122.1,
  speed: 20, // m/s (SI)
  power: 5,
  battery_level: 72,
  rated_range: 402336, // m (SI)
  ideal_range: 410000,
  odometer: 123456, // m (SI)
  inside_temp: 21, // °C (SI)
  outside_temp: 15, // °C (SI)
  is_climate_on: true,
  is_charging: true,
  charger_power: 11, // kW
  charge_rate: 30000,
  time_to_full_charge: 1.5,
  is_locked: true,
  sentry_mode: true,
  software_version: '2024.20.1',
};

const LOCATION: LocationSnapshot = {
  id: 9,
  vehicle_id: 1,
  located_at_home: true,
  destination_name: 'Office',
  minutes_to_arrival: 15,
  created_at: '2024-06-01T00:00:00Z',
};

const VEHICLES = [
  { id: 1, display_name: 'Car A', model: 'Model 3', vin: 'VINAAAA' },
  { id: 2, display_name: 'Car B', model: 'Model Y', vin: 'VINBBBB' },
] as unknown as Vehicle[];

 
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

// Tagged echo formatters — assert BOTH the SI value passed and the rendered
// output without coupling to unitConversion's real math.
function makeUnits() {
  return {
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: undefined,
    },
    formatDistance: vi.fn((v: number | null | undefined) => v == null ? 'dist(nil)' : `dist(${v})`),
    formatSpeed: vi.fn((v: number | null | undefined) => v == null ? 'spd(nil)' : `spd(${v})`),
    formatTemperature: vi.fn((v: number | null | undefined) =>
      v == null ? 'temp(nil)' : `temp(${v})`,
    ),
    formatPressure: vi.fn((v: number | null | undefined) => `pres(${v ?? 0})`),
    formatEnergy: vi.fn((v: number | null | undefined) => `energy(${v ?? 0})`),
    formatDuration: vi.fn((v: number | null | undefined) => `dur(${v ?? 0})`),
    formatPower: vi.fn((v: number | null | undefined) => `pow(${v ?? 0})`),
  };
}

let units: ReturnType<typeof makeUnits>;
 
let stateQuery: any;
 
let sendCommand: any;

function WorkspaceSelectionControl() {
  const { setVehicleId } = useSelectedVehicle();
  return <Button onClick={() => setVehicleId(2)}>Change workspace vehicle</Button>;
}

function renderPage(path = '/glance', withWorkspaceControl = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        {withWorkspaceControl && <WorkspaceSelectionControl />}
        <GlancePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const kpiRegion = () => screen.getByRole('region', { name: 'Vehicle overview' });
const liveRegion = () => screen.getByRole('region', { name: 'Live status' });
const controlsRegion = () => screen.getByRole('region', { name: 'Controls' });

/** Read the real OperationalBrief measurement, independently from its caption. */
function cardValue(region: HTMLElement, label: string): string {
  const metric = within(region).getByText(label).closest('[data-operational-metric]');
  return metric?.querySelector('[data-operational-value]')?.textContent ?? '';
}

/** Trailing element (value <Text> or status <Badge>) of a Detail/Status row. */
function rowValue(scope: HTMLElement, label: string): string {
  const el = within(scope).getByText(label);
  const term = el.closest('dt');
  expect(term).not.toBeNull();
  return within(term!.parentElement!).getByRole('definition').textContent ?? '';
}

/** Charging and climate statuses accompany subheadings, not definition terms. */
function subheadStatusValue(scope: HTMLElement, label: string): string {
  const heading = within(scope).getByRole('heading', { name: label, level: 4 });
  expect(heading.nextElementSibling).not.toBeNull();
  return heading.nextElementSibling?.textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  units = makeUnits();
  stateQuery = makeQuery({ data: { state: STATE, live: true } });
  sendCommand = { mutate: vi.fn(), isPending: false, variables: undefined };

  mockUnits.mockReturnValue(units);
  mockVehicles.mockReturnValue({ data: VEHICLES, isLoading: false, error: null });
  mockState.mockReturnValue(stateQuery);
  mockLocation.mockReturnValue({ data: LOCATION });
  mockCommand.mockReturnValue(sendCommand);
});

// ─────────────────────────────────────────────────────────────────────────
describe('getLocationLabel', () => {
  const t = (_k: string, fb: string) => fb;

  it('maps presence flags with home > work > favorite precedence', () => {
    expect(getLocationLabel({ located_at_home: true } as LocationSnapshot, t)).toBe('Home');
    expect(getLocationLabel({ located_at_work: true } as LocationSnapshot, t)).toBe('Work');
    expect(getLocationLabel({ located_at_favorite: true } as LocationSnapshot, t)).toBe('Saved');
    // home wins even when work + destination are also present.
    expect(
      getLocationLabel(
        { located_at_home: true, located_at_work: true, destination_name: 'X' } as LocationSnapshot,
        t,
      ),
    ).toBe('Home');
  });

  it('falls back to destination name then the em-dash glyph', () => {
    expect(getLocationLabel({ destination_name: 'Mall' } as LocationSnapshot, t)).toBe('Mall');
    expect(getLocationLabel({} as LocationSnapshot, t)).toBe('—');
    expect(getLocationLabel(null, t)).toBe('—');
    expect(getLocationLabel(undefined, t)).toBe('—');
  });
});

describe('batteryNeon', () => {
  it('returns cyan only for unknown levels', () => {
    expect(batteryNeon(null)).toBe('cyan');
    expect(batteryNeon(undefined)).toBe('cyan');
  });

  it('bands the numeric range at the 60 / 25 thresholds', () => {
    expect(batteryNeon(100)).toBe('green');
    expect(batteryNeon(61)).toBe('green');
    expect(batteryNeon(60)).toBe('amber'); // boundary is exclusive
    expect(batteryNeon(26)).toBe('amber');
    expect(batteryNeon(25)).toBe('red'); // boundary is exclusive
    expect(batteryNeon(0)).toBe('red');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('GlancePage — vehicle guard', () => {
  it('renders the no-vehicle empty state without header actions', () => {
    mockVehicles.mockReturnValue({ data: [], isLoading: false, error: null });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Quick glance', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('No vehicle available')).toBeInTheDocument();
    expect(screen.getByText(/Register or sync a Tesla vehicle/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage vehicles' })).toHaveAttribute(
      'href',
      '/vehicles',
    );
    // No vehicle → no refresh action, no switcher, no KPI region.
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Vehicle overview' })).toBeNull();
  });

  it('shows only the page shell while the fleet is loading', () => {
    mockVehicles.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Quick glance', level: 1 })).toBeInTheDocument();
    // PageContainer spinner replaces children: neither the empty state nor any
    // panel is mounted.
    expect(screen.queryByText('No vehicle available')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Charging & climate' })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('GlancePage — populated overview', () => {
  it('retains independent live evidence and commands when registry, state and location refresh fail', () => {
    mockVehicles.mockReturnValue(makeQuery({ data: VEHICLES, error: new Error('registry refresh'), isError: true }));
    mockState.mockReturnValue(makeQuery({ data: { state: STATE, live: true }, error: new Error('state refresh'), isError: true }));
    mockLocation.mockReturnValue(makeQuery({ data: LOCATION, error: new Error('location refresh'), isError: true }));
    const { container } = renderPage();
    expect(cardValue(kpiRegion(), 'Battery')).toBe('72.00%');
    expect(screen.getByRole('heading', { name: 'Charging & climate' })).toBeInTheDocument();
    expect(screen.getByText('Office')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Horn' })).toBeEnabled();
    expect(screen.getAllByTestId('stale-refresh-warning').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('[data-layout-reference]')).toBeInTheDocument();
    expect(container.querySelector('dl')).toHaveClass('@container/kv-list');
  });
  it('renders honest KPI tiles from the vehicle state', () => {
    renderPage();
    const kpi = kpiRegion();

    expect(cardValue(kpi, 'Battery')).toBe('72.00%');
    expect(cardValue(kpi, 'Range')).toBe('dist(402336)');
    expect(cardValue(kpi, 'Interior')).toBe('temp(21)');
    expect(cardValue(kpi, 'Exterior')).toBe('temp(15)');
    expect(cardValue(kpi, 'Odometer')).toBe('dist(123456)');
    expect(cardValue(kpi, 'Speed')).toBe('spd(20)');
  });

  it('opens the real review drawer while retaining live sections, gauge and command controls', () => {
    renderPage();
    const brief = screen.getByTestId('glance-operational-brief');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(6);
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: 'Vehicle operating summary details' })).toBeInTheDocument();
    expect(within(drawer).getByText('spd(20)')).toBeInTheDocument();
    expect(within(drawer).getAllByText(/Poll completion is not a verified observation time/).length).toBeGreaterThan(0);
    expect(within(drawer).getByText(/lifetime reading, not distance in a selected window/)).toBeInTheDocument();
    expect(within(liveRegion()).getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '72');
    expect(within(controlsRegion()).getByRole('button', { name: 'Horn' })).toBeEnabled();
  });

  it('passes raw SI values to the unit formatters at the display edge', () => {
    renderPage();

    expect(units.formatDistance).toHaveBeenCalledWith(402336);
    expect(units.formatDistance).toHaveBeenCalledWith(123456);
    expect(units.formatSpeed).toHaveBeenCalledWith(20);
    expect(units.formatTemperature).toHaveBeenCalledWith(21);
    expect(units.formatTemperature).toHaveBeenCalledWith(15);
  });

  it('renders the hero identity, battery range badge and footer link', () => {
    renderPage();
    const live = liveRegion();

    // Hero heading uses the vehicle display name; badge echoes the live state.
    expect(within(live).getByRole('heading', { name: 'Car A' })).toBeInTheDocument();
    expect(within(live).getByText('online')).toBeInTheDocument();
    // Rated-range badge (SI → formatter) is distinct from the charge-rate row.
    expect(within(live).getByText('dist(402336)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open full app →' })).toHaveAttribute('href', '/');
  });

  it('renders the active charging + climate details', () => {
    renderPage();
    const live = liveRegion();

    expect(subheadStatusValue(live, 'Charging')).toBe('Charging');
    expect(rowValue(live, 'Charger power')).toBe('11.00 kW');
    expect(rowValue(live, 'Charge rate')).toBe('dist(30000)/h');
    expect(rowValue(live, 'Time to full')).toBe('1.50 h');
    expect(subheadStatusValue(live, 'Climate')).toBe('On');
    expect(rowValue(live, 'Interior')).toBe('temp(21)');
  });

  it('renders the security + location details', () => {
    renderPage();
    const live = liveRegion();

    expect(rowValue(live, 'Doors')).toBe('Locked');
    expect(rowValue(live, 'Sentry mode')).toBe('On');
    expect(rowValue(live, 'Place')).toBe('Home'); // home flag wins
    expect(within(live).getByText('Office')).toBeInTheDocument(); // destination
    expect(within(live).getByText('15.00 min')).toBeInTheDocument(); // ETA
    expect(within(live).getByText(/2024\.20\.1/)).toBeInTheDocument(); // software
  });

  it('exposes labelled region landmarks with workspace-owned vehicle selection', () => {
    renderPage();

    expect(kpiRegion()).toBeInTheDocument();
    expect(liveRegion()).toBeInTheDocument();
    expect(controlsRegion()).toBeInTheDocument();
    expect(getWorkspaceRouteScope('/glance').vehicle).toBe(true);
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).toBeNull();
    expect(within(liveRegion()).getByRole('heading', { name: 'Car A' })).toBeInTheDocument();
    expect(mockState).toHaveBeenCalledWith(1, { refetchInterval: 10_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('GlancePage — per-panel state handling', () => {
  it('keeps panel shells but withholds content while state is loading', () => {
    mockState.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    renderPage();

    // Panel titles always render (section shells never disappear)…
    expect(screen.getByRole('heading', { name: 'Charging & climate' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Security & location' })).toBeInTheDocument();
    // …but no KPI values yet, and loading is not "empty".
    expect(within(kpiRegion()).queryByText('72.00%')).toBeNull();
    expect(screen.getByTestId('glance-operational-brief')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No live data for this vehicle yet')).toBeNull();
  });

  it('shows a per-panel empty state when no live telemetry exists', () => {
    mockState.mockReturnValue(makeQuery({ data: undefined }));
    renderPage();

    // Hero + charging + security each render their own placeholder.
    expect(screen.getAllByText('No live data for this vehicle yet')).toHaveLength(3);
    // KPI tiles degrade to the em-dash rather than a misleading zero.
    expect(cardValue(kpiRegion(), 'Battery')).toBe('—');
  });

  it('surfaces a QueryError per panel and retries on demand', async () => {
    stateQuery = makeQuery({
      data: undefined,
      isError: true,
      error: new ApiError('boom', 500),
    });
    mockState.mockReturnValue(stateQuery);
    renderPage();

    expect(screen.getAllByText('Server error')).toHaveLength(3);
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(3);

    fireEvent.click(retries[0]);
    await waitFor(() => expect(stateQuery.refetch).toHaveBeenCalledTimes(1));
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('GlancePage — command band', () => {
  it('dispatches lock / climate / horn commands with the right payloads', () => {
    renderPage();
    const controls = controlsRegion();

    // is_locked → the button offers Unlock and sends "unlock".
    fireEvent.click(within(controls).getByRole('button', { name: 'Unlock' }));
    expect(sendCommand.mutate).toHaveBeenCalledWith({ vehicleId: 1, command: 'unlock' });

    // is_climate_on → offers Climate Off and sends "climate_off".
    fireEvent.click(within(controls).getByRole('button', { name: 'Climate off' }));
    expect(sendCommand.mutate).toHaveBeenCalledWith({ vehicleId: 1, command: 'climate_off' });

    fireEvent.click(within(controls).getByRole('button', { name: 'Horn' }));
    expect(sendCommand.mutate).toHaveBeenCalledWith({ vehicleId: 1, command: 'honk_horn' });
  });

  it('disables controls and shows the hint when the vehicle is offline', () => {
    mockState.mockReturnValue(
      makeQuery({ data: { state: { ...STATE, state: 'asleep' }, live: false } }),
    );
    renderPage();
    const controls = controlsRegion();

    expect(
      within(controls).getByText('Commands are available when the vehicle is online.'),
    ).toBeInTheDocument();
    // Lock button offered because is_locked stays true, but disabled offline.
    expect(within(controls).getByRole('button', { name: 'Unlock' })).toBeDisabled();
    expect(within(controls).getByRole('button', { name: 'Horn' })).toBeDisabled();
  });

  it('disables controls while a command is in flight', () => {
    mockCommand.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      variables: { vehicleId: 1, command: 'lock' },
    });
    renderPage();
    const controls = controlsRegion();

    expect(within(controls).getByRole('button', { name: 'Unlock' })).toBeDisabled();
    expect(within(controls).getByRole('button', { name: 'Horn' })).toBeDisabled();
  });

  it('refreshes live state from the header action', () => {
    renderPage();

    // The freshness chip also exposes a "Refresh" role=button; target the real
    // <button> header control specifically.
    const refresh = screen
      .getAllByRole('button', { name: 'Refresh' })
      .find((el) => el.tagName === 'BUTTON');
    expect(refresh).toBeDefined();

    fireEvent.click(refresh!);
    expect(stateQuery.refetch).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('GlancePage — vehicle selection (URL state)', () => {
  it('honours the ?vehicle_id= query parameter', () => {
    renderPage('/glance?vehicle_id=2');

    expect(within(liveRegion()).getByRole('heading', { name: 'Car B' })).toBeInTheDocument();
    expect(getWorkspaceRouteScope('/glance').vehicle).toBe(true);
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).toBeNull();
    expect(mockState).toHaveBeenCalledWith(2, { refetchInterval: 10_000 });
  });

  it('falls back to the first vehicle for an unknown id', () => {
    renderPage('/glance?vehicle_id=999');

    expect(within(liveRegion()).getByRole('heading', { name: 'Car A' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).toBeNull();
  });

  it('follows the workspace-owned selection without mounting a competing local picker', async () => {
    renderPage('/glance', true);
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change workspace vehicle' }));
    await waitFor(() => expect(mockState).toHaveBeenCalledWith(2, { refetchInterval: 10_000 }));
    expect(mockState).toHaveBeenCalledWith(2, { refetchInterval: 10_000 });
    expect(within(liveRegion()).getByRole('heading', { name: 'Car B' })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('GlancePage — null safety + idle branches', () => {
  it('preserves independent location evidence even when live security and telemetry are unavailable', () => {
    mockState.mockReturnValue(makeQuery({ error: new Error('live state failed'), isError: true }));
    mockLocation.mockReturnValue(makeQuery({ data: LOCATION }));
    renderPage();
    const live = liveRegion();
    expect(rowValue(live, 'Place')).toBe('Home');
    expect(rowValue(live, 'Destination')).toBe('Office');
    expect(rowValue(live, 'ETA')).toBe('15.00 min');
    expect(within(live).getAllByRole('alert')).toHaveLength(3);
    expect(within(live).getAllByRole('button', { name: 'Retry' })).toHaveLength(3);
    expect(cardValue(kpiRegion(), 'Battery')).toBe('—');
    expect(within(live).queryByText('Locked')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Security & location' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lock' })).toBeDisabled();
  });

  it('does not synthesize zero battery, range, speed or charging measurements', () => {
    mockState.mockReturnValue(makeQuery({ data: { state: {
      ...STATE,
      battery_level: null,
      rated_range: null,
      speed: null,
      charger_power: null,
      charge_rate: null,
    } } }));
    const page = renderPage();
    const live = liveRegion();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(cardValue(kpiRegion(), 'Battery')).toBe('—');
    expect(cardValue(kpiRegion(), 'Range')).toBe('—');
    expect(cardValue(kpiRegion(), 'Speed')).toBe('—');
    expect(units.formatDistance).toHaveBeenCalledWith(null);
    expect(units.formatSpeed).not.toHaveBeenCalledWith(null);
    expect(rowValue(live, 'Charger power')).toBe('—');
    expect(rowValue(live, 'Charge rate')).toBe('—');
    expect(screen.queryByText('0.00 kW')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Charging & climate' })).toBeInTheDocument();

    page.unmount();
    mockState.mockReturnValue(makeQuery({ data: { state: {
      ...STATE,
      battery_level: 0,
      rated_range: 0,
      speed: 0,
      charger_power: 0,
      charge_rate: 0,
    } } }));
    renderPage();
    expect(cardValue(kpiRegion(), 'Battery')).toBe('0.00%');
    expect(cardValue(kpiRegion(), 'Range')).toBe('dist(0)');
    expect(cardValue(kpiRegion(), 'Speed')).toBe('spd(0)');
    expect(within(liveRegion()).getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '0');
    expect(rowValue(liveRegion(), 'Charger power')).toBe('0.00 kW');
    expect(rowValue(liveRegion(), 'Charge rate')).toBe('dist(0)/h');
  });

  it('keeps nullable status fields unknown rather than asserting unlocked, idle or off', () => {
    mockState.mockReturnValue(makeQuery({ data: { state: {
      ...STATE, is_charging: null, is_climate_on: null, is_locked: null, sentry_mode: null,
    } } }));
    renderPage();
    const live = liveRegion();
    expect(rowValue(live, 'Doors')).toBe('Unknown');
    expect(rowValue(live, 'Sentry mode')).toBe('Unknown');
    expect(subheadStatusValue(live, 'Charging')).toBe('Unknown');
    expect(subheadStatusValue(live, 'Climate')).toBe('Unknown');
    expect(screen.queryByText('Unlocked')).toBeNull();
    expect(within(live).queryByText('Idle')).toBeNull();
    expect(within(live).queryByText('Charger power')).toBeNull();
    expect(screen.queryByText('Not currently charging')).toBeNull();
    expect(screen.queryByText('Off')).toBeNull();
  });

  it('collapses missing location details to the em-dash glyph', () => {
    mockLocation.mockReturnValue({
      data: { id: 3, vehicle_id: 1, created_at: '2024-06-01T00:00:00Z' } as LocationSnapshot,
    });
    renderPage();
    const live = liveRegion();

    expect(rowValue(live, 'Place')).toBe('—');
    // No destination → no destination/ETA rows.
    expect(within(live).queryByText('Office')).toBeNull();
    expect(within(live).queryByText('15.00 min')).toBeNull();
  });

  it('renders the not-charging / unlocked / climate-off branches', () => {
    mockState.mockReturnValue(
      makeQuery({
        data: {
          state: {
            ...STATE,
            is_charging: false,
            is_climate_on: false,
            is_locked: false,
            sentry_mode: false,
          },
          live: true,
        },
      }),
    );
    renderPage();
    const live = liveRegion();

    expect(within(live).getByText('Not currently charging')).toBeInTheDocument();
    expect(subheadStatusValue(live, 'Charging')).toBe('Idle');
    expect(within(live).queryByText('Charger power')).toBeNull();
    expect(rowValue(live, 'Doors')).toBe('Unlocked');
    expect(rowValue(live, 'Sentry mode')).toBe('Off');
    expect(subheadStatusValue(live, 'Climate')).toBe('Off');
    // Lock button now offers "Lock" (drives the inverse command payload).
    fireEvent.click(within(controlsRegion()).getByRole('button', { name: 'Lock' }));
    expect(sendCommand.mutate).toHaveBeenCalledWith({ vehicleId: 1, command: 'lock' });
  });
});
