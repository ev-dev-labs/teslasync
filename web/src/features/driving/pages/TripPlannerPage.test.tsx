/**
 * TripPlannerPage — orchestration contract + hardening tests.
 *
 * TripPlannerPage is an interactive orchestration page: it owns the trip form
 * state (origin/destination geocode picks, current/min-arrival SOC sliders, a
 * speed-factor select), fires two mutations (`usePlanTrip`, `useVehicleCommand`),
 * derives a six-tile KPI band from the returned `TripPlan`, and fans the plan
 * into four presentational children (map, SOC chart, leg list) plus the opt-in
 * AI agent.
 *
 * Strategy:
 *   - The two mutation hooks + `useSelectedVehicle` are mocked at the hook
 *     boundary so every branch is deterministic and no network is touched. The
 *     plan mutation's `mutate` invokes the caller's `onSuccess` with a fixture
 *     plan, exercising the real `setPlan` → re-render → KPI-derivation path.
 *   - The four feature children + the AI agent are replaced with lightweight
 *     prop-surfacing doubles so the assertions target the page's OWN logic
 *     (request-payload shape, unit conversion, feasibility/weather branching,
 *     data threading) rather than the children's internal rendering.
 *   - `useUnits` / `useFormatting` render for real off the global `useSettings`
 *     test stub (metric: km / kWh / $), so the SI→display conversion boundary
 *     is genuinely exercised.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { StrictMode, type ReactNode } from 'react';
import type {
  TripPlan,
  TripPlanRoute,
  TripLeg,
  TripChargeStop,
  TripWeatherImpact,
  TripPlanRequest,
} from '@/types/driving';

// i18n stub: echo the fallback string and interpolate {{tokens}} so assertions
// target rendered English exactly as production would after i18next resolves it.
vi.mock('react-i18next', () => {
  const translate = (key: string, fallback?: unknown, opts?: unknown): string => {
    let out = key;
    let options: Record<string, unknown> | undefined;
    if (typeof fallback === 'string') {
      out = fallback;
      options = (opts && typeof opts === 'object') ? (opts as Record<string, unknown>) : undefined;
    } else if (fallback && typeof fallback === 'object') {
      options = fallback as Record<string, unknown>;
      if (typeof options.defaultValue === 'string') out = options.defaultValue;
    }
    if (options) {
      out = out.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
        options && options[k] != null ? String(options[k]) : `{{${k}}}`,
      );
    }
    return out;
  };
  return {
    useTranslation: () => ({
      t: translate,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// Hook boundary mocks.
vi.mock('@/hooks/useSelectedVehicle', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});
vi.mock('@/api/hooks/useDriving', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useDriving')>();
  return { ...actual, usePlanTrip: vi.fn() };
});
vi.mock('@/api/hooks/useVehicleCommand', () => ({
  useVehicleCommand: vi.fn(),
}));
vi.mock('@/lib/tripShareTarget', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/tripShareTarget')>();
  return { ...actual, consumeTripSharePayload: vi.fn() };
});

// Feature-child doubles — surface the page-computed props the assertions care
// about. AddressInput exposes a "select" button so the test can drive an
// origin/destination pick without the real Combobox + geocode round-trip.
vi.mock('../components/AddressInput', () => ({
  AddressInput: (p: {
    label?: string;
    value: string;
    onChange: (v: string) => void;
    onSelect: (loc: { lat: number; lng: number; name: string }) => void;
  }) => (
    <div data-testid={`address-${p.label}`}>
      <span data-testid={`address-${p.label}-value`}>{p.value}</span>
      <button
        type="button"
        data-testid={`address-select-${p.label}`}
        onClick={() => {
          const loc =
            p.label === 'From'
              ? { lat: 40, lng: -70, name: 'From Location' }
              : { lat: 41, lng: -71, name: 'To Location' };
          p.onChange(loc.name);
          p.onSelect(loc);
        }}
      >
        select {p.label}
      </button>
    </div>
  ),
}));
vi.mock('../components/SOCRouteChart', () => ({
  SOCRouteChart: (p: { socCurve?: unknown[]; chargeStops?: unknown[]; minArrivalSOC: number }) => (
    <div data-testid="soc-chart">
      <span data-testid="soc-points">{p.socCurve?.length ?? -1}</span>
      <span data-testid="soc-stops">{p.chargeStops?.length ?? -1}</span>
      <span data-testid="soc-minarrival">{p.minArrivalSOC}</span>
    </div>
  ),
}));
vi.mock('../components/TripLegList', () => ({
  TripLegList: (p: { legs?: unknown[]; chargeStops?: unknown[] }) => (
    <div data-testid="leg-list">
      <span data-testid="leg-count">{p.legs?.length ?? -1}</span>
      <span data-testid="leg-stops">{p.chargeStops?.length ?? -1}</span>
    </div>
  ),
}));
vi.mock('../components/TripPlannerMap', () => ({
  TripPlannerMap: (p: {
    origin?: { name: string } | null;
    destination?: { name: string } | null;
    legs?: unknown[];
    chargeStops?: unknown[];
  }) => (
    <div data-testid="trip-map">
      <span data-testid="map-origin">{p.origin?.name ?? 'none'}</span>
      <span data-testid="map-dest">{p.destination?.name ?? 'none'}</span>
      <span data-testid="map-legs">{p.legs?.length ?? -1}</span>
      <span data-testid="map-stops">{p.chargeStops?.length ?? -1}</span>
    </div>
  ),
}));
vi.mock('@/components/ai/AITripPlannerLLMAgent', () => ({
  AITripPlannerLLMAgent: (p: {
    vehicleId?: number;
    origin?: { name: string } | null;
    destination?: { name: string } | null;
    currentSoc: number;
    minArrivalSoc: number;
    chargeLimitSoc: number;
    speedFactor: number;
  }) => (
    <div
      data-testid="ai-agent"
      data-vehicle={String(p.vehicleId ?? 'none')}
      data-origin={p.origin?.name ?? 'none'}
      data-dest={p.destination?.name ?? 'none'}
      data-soc={String(p.currentSoc)}
      data-minarrival={String(p.minArrivalSoc)}
      data-chargelimit={String(p.chargeLimitSoc)}
      data-speed={String(p.speedFactor)}
    />
  ),
}));

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) reads it on mount.
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

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePlanTrip } from '@/api/hooks/useDriving';
import { useVehicleCommand } from '@/api/hooks/useVehicleCommand';
import { consumeTripSharePayload } from '@/lib/tripShareTarget';
import TripPlannerPage from './TripPlannerPage';

const mockSelectedVehicle = vi.mocked(useSelectedVehicle);
const mockUsePlanTrip = vi.mocked(usePlanTrip);
const mockUseVehicleCommand = vi.mocked(useVehicleCommand);
const mockConsumeTripSharePayload = vi.mocked(consumeTripSharePayload);

// The plan mutation double: `mutate` forwards to the caller's onSuccess with
// whatever `nextPlan` is primed to, mirroring a resolved TanStack mutation.
let nextPlan: TripPlan | null = null;
const planMutate = vi.fn(
  (_req: TripPlanRequest, opts?: { onSuccess?: (data: TripPlan) => void }) => {
    if (nextPlan) opts?.onSuccess?.(nextPlan);
  },
);
const commandMutate = vi.fn();

/* ── fixtures ─────────────────────────────────────────────── */

function makeRoute(over: Partial<TripPlanRoute> = {}): TripPlanRoute {
  return {
    total_distance_m: 100_000, // 100 km
    total_duration_s: 7_200, // 120 min → "2h 0m"
    driving_duration_s: 5_400, // 90 min → "1h 30m"
    charging_duration_s: 1_800, // 30 min → "30m"
    total_energy_wh: 50_000, // 50 kWh → "50.0 kWh"
    estimated_cost: 12.5, // "$12.50"
    arrival_soc: 35,
    feasible: true,
    is_estimate: false,
    ...over,
  };
}

function makeLeg(over: Partial<TripLeg> = {}): TripLeg {
  return {
    from: { lat: 40, lng: -70, name: 'From Location' },
    to: { lat: 41, lng: -71, name: 'To Location' },
    distance_m: 50_000,
    duration_s: 2_700,
    energy_wh: 25_000,
    start_soc: 80,
    arrival_soc: 55,
    ...over,
  };
}

function makeChargeStop(over: Partial<TripChargeStop> = {}): TripChargeStop {
  return {
    name: 'Supercharger A',
    location: { lat: 40.5, lng: -70.5, name: 'Supercharger A' },
    charge_from_soc: 20,
    charge_to_soc: 80,
    charge_duration_s: 1_800,
    energy_wh: 30_000,
    cost: 12.5,
    is_recommended: true,
    ...over,
  };
}

function makePlan(
  over: {
    route?: Partial<TripPlanRoute>;
    weather?: Partial<TripWeatherImpact>;
  } & Partial<Pick<TripPlan, 'legs' | 'charge_stops' | 'soc_curve'>> = {},
): TripPlan {
  const { route: routeOver, weather: weatherOver, ...planOver } = over;
  return {
    route: makeRoute(routeOver),
    legs: [makeLeg(), makeLeg()],
    charge_stops: [makeChargeStop()],
    weather_impact: {
      avg_temp_c: 5,
      efficiency_factor: 1.15,
      note: 'Cold reduces range',
      ...weatherOver,
    },
    soc_curve: [
      { distance_m: 0, soc: 80 },
      { distance_m: 100_000, soc: 35 },
    ],
    ...planOver,
  };
}

/* ── harness ──────────────────────────────────────────────── */

function renderPage(initialEntry = '/trip-planner', strictMode = false) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const page = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <TripPlannerPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(strictMode ? <StrictMode>{page}</StrictMode> : page);
}

function selectOriginAndDestination() {
  fireEvent.click(screen.getByTestId('address-select-From'));
  fireEvent.click(screen.getByTestId('address-select-To'));
}

/** Prime a plan, select a route, and click "Plan Trip" so state populates. */
function planWith(plan: TripPlan) {
  nextPlan = plan;
  selectOriginAndDestination();
  fireEvent.click(screen.getByRole('button', { name: /Plan Trip/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  nextPlan = null;
  Object.defineProperty(window, 'caches', {
    configurable: true,
    value: {} as CacheStorage,
  });
  mockSelectedVehicle.mockReturnValue({
    vehicleId: 1,
    vehicle: { id: 1, display_name: 'Car One', vin: 'VIN1', battery_level: 72 } as never,
    vehicles: [
      { id: 1, display_name: 'Car One', vin: 'VIN1' },
      { id: 2, display_name: 'Car Two', vin: 'VIN2' },
    ] as never,
    setVehicleId: vi.fn(),
  });
  mockUsePlanTrip.mockReturnValue({
    mutate: planMutate,
    isPending: false,
    isError: false,
  } as never);
  mockUseVehicleCommand.mockReturnValue({
    mutate: commandMutate,
    isPending: false,
  } as never);
  mockConsumeTripSharePayload.mockResolvedValue(null);
});

/* ── structure & a11y ─────────────────────────────────────── */

describe('TripPlannerPage — structure & a11y', () => {
  it('renders the page title, subtitle and the vehicle picker action', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Trip Planner' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Plan your route with range estimation and charging stops'),
    ).toBeInTheDocument();
    // VehicleSelect renders a labelled combobox because the mocked fleet is non-empty.
    expect(
      screen.getByRole('combobox', { name: 'Select vehicle' }),
    ).toBeInTheDocument();
  });

  it('sets the document title via usePageTitle', () => {
    renderPage();
    expect(document.title).toContain('Trip Planner');
  });

  it('exposes the plan form and trip-summary as labelled regions', () => {
    renderPage();
    expect(
      screen.getByRole('region', { name: 'Plan Your Trip' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Trip summary' }),
    ).toBeInTheDocument();
  });

  it('renders the driving-speed select and both SOC sliders with accessible names', () => {
    renderPage();
    expect(screen.getByRole('combobox', { name: 'Driving Speed' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current SOC')).toBeInTheDocument();
    expect(screen.getByLabelText('Min Arrival SOC')).toBeInTheDocument();
  });

  it('shows the current vehicle battery level from the selected vehicle', () => {
    renderPage();
    expect(screen.getByText('Vehicle at 72%')).toBeInTheDocument();
  });
});

/* ── empty / placeholder state ────────────────────────────── */

describe('TripPlannerPage — empty state (no plan yet)', () => {
  it('renders six KPI tiles as placeholders and an insights empty state', () => {
    renderPage();
    // All six KPI values are the em-dash placeholder until a plan exists.
    expect(screen.getAllByText('—')).toHaveLength(6);
    expect(
      screen.getByText('Plan a trip to see feasibility, estimates, and weather impact.'),
    ).toBeInTheDocument();
    // Feature children always render (never a blank panel), with empty data.
    expect(screen.getByTestId('map-origin')).toHaveTextContent('none');
    expect(screen.getByTestId('leg-count')).toHaveTextContent('0');
    expect(screen.getByTestId('soc-points')).toHaveTextContent('0');
  });

  it('does not render the "Send to Car" button before a plan exists', () => {
    renderPage();
    expect(
      screen.queryByRole('button', { name: /Send to Car/i }),
    ).not.toBeInTheDocument();
  });
});

/* ── form gating ──────────────────────────────────────────── */

describe('TripPlannerPage — plan-button gating', () => {
  it('disables "Plan Trip" until BOTH origin and destination are chosen', () => {
    renderPage();
    const planBtn = screen.getByRole('button', { name: /Plan Trip/i });
    expect(planBtn).toBeDisabled();

    // Origin only → still disabled.
    fireEvent.click(screen.getByTestId('address-select-From'));
    expect(screen.getByRole('button', { name: /Plan Trip/i })).toBeDisabled();

    // Both → enabled.
    fireEvent.click(screen.getByTestId('address-select-To'));
    expect(screen.getByRole('button', { name: /Plan Trip/i })).toBeEnabled();
  });

  it('keeps "Plan Trip" disabled when no vehicle is selected', () => {
    mockSelectedVehicle.mockReturnValue({
      vehicleId: null,
      vehicle: null,
      vehicles: [{ id: 1, display_name: 'Car One', vin: 'VIN1' }] as never,
      setVehicleId: vi.fn(),
    });
    renderPage();
    selectOriginAndDestination();
    expect(screen.getByRole('button', { name: /Plan Trip/i })).toBeDisabled();
  });
});

describe('TripPlannerPage — PWA share target', () => {
  it('imports trusted coordinates without exposing the destination in the URL', async () => {
    mockConsumeTripSharePayload.mockResolvedValue({
      version: 1,
      title: 'Service Center',
      text: '',
      url: 'https://maps.example/?query=37.3947,-122.1503',
      captured_at: Date.now(),
    });

    renderPage('/trip-planner?share_target=1');

    expect(
      await screen.findByText(
        'Destination coordinates imported. Review the route settings before planning.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('address-To-value')).toHaveTextContent('Service Center');
    expect(screen.getByTestId('map-dest')).toHaveTextContent('Service Center');

    fireEvent.click(screen.getByTestId('address-select-From'));
    fireEvent.click(screen.getByRole('button', { name: /Plan Trip/i }));
    expect(planMutate.mock.calls[0][0].destination).toEqual({
      lat: 37.3947,
      lng: -122.1503,
      name: 'Service Center',
    });
  });

  it('imports exactly once when React Strict Mode replays the effect', async () => {
    mockConsumeTripSharePayload.mockResolvedValue({
      version: 1,
      title: 'Service Center',
      text: '',
      url: 'https://maps.example/?query=37.3947,-122.1503',
      captured_at: Date.now(),
    });

    renderPage('/trip-planner?share_target=1', true);

    expect(
      await screen.findByText(
        'Destination coordinates imported. Review the route settings before planning.',
      ),
    ).toBeInTheDocument();
    expect(mockConsumeTripSharePayload).toHaveBeenCalledTimes(1);
  });

  it('prefills text shares but still requires a geocoded selection', async () => {
    mockConsumeTripSharePayload.mockResolvedValue({
      version: 1,
      title: '',
      text: 'Tesla Fremont Factory',
      url: '',
      captured_at: Date.now(),
    });

    renderPage('/trip-planner?share_target=1');

    expect(
      await screen.findByText(
        'Destination prefilled. Choose a matching search result to confirm its coordinates.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('address-To-value')).toHaveTextContent(
      'Tesla Fremont Factory',
    );
    fireEvent.click(screen.getByTestId('address-select-From'));
    expect(screen.getByRole('button', { name: /Plan Trip/i })).toBeDisabled();
  });

  it('surfaces an explicit recovery message when the shared payload is missing', async () => {
    renderPage('/trip-planner?share_target=1');

    expect(
      await screen.findByText(
        'The shared item was empty, expired, or could not be read. Share it again or enter the destination manually.',
      ),
    ).toBeInTheDocument();
  });
});

/* ── handlePlan: request payload ──────────────────────────── */

describe('TripPlannerPage — handlePlan request payload', () => {
  it('builds an SI/snake_case TripPlanRequest with default form values', () => {
    renderPage();
    selectOriginAndDestination();
    fireEvent.click(screen.getByRole('button', { name: /Plan Trip/i }));

    expect(planMutate).toHaveBeenCalledTimes(1);
    expect(planMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicle_id: 1,
        origin: { lat: 40, lng: -70, name: 'From Location' },
        destination: { lat: 41, lng: -71, name: 'To Location' },
        current_soc: 80,
        charge_limit_soc: 90,
        min_arrival_soc: 20,
        preferences: {
          speed_factor: 1,
          include_weather: true,
          prefer_superchargers: true,
        },
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('threads the speed select and SOC sliders into the request', () => {
    renderPage();
    fireEvent.change(screen.getByRole('combobox', { name: 'Driving Speed' }), {
      target: { value: '1.2' },
    });
    fireEvent.change(screen.getByLabelText('Current SOC'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('Min Arrival SOC'), { target: { value: '30' } });
    selectOriginAndDestination();
    fireEvent.click(screen.getByRole('button', { name: /Plan Trip/i }));

    const req = planMutate.mock.calls[0][0];
    expect(req.current_soc).toBe(60);
    expect(req.min_arrival_soc).toBe(30);
    expect(req.preferences?.speed_factor).toBe(1.2);
  });
});

/* ── KPI derivation ───────────────────────────────────────── */

describe('TripPlannerPage — KPI derivation after a successful plan', () => {
  it('derives distance, durations, energy and cost via the real converters', () => {
    renderPage();
    planWith(makePlan());

    expect(screen.getByText('100 km')).toBeInTheDocument(); // 100_000 m → km
    expect(screen.getByText('2h 0m')).toBeInTheDocument(); // total 7200s
    expect(screen.getByText('1h 30m')).toBeInTheDocument(); // driving 5400s
    expect(screen.getByText('30m')).toBeInTheDocument(); // charging 1800s
    expect(screen.getByText('50.0 kWh')).toBeInTheDocument(); // 50_000 Wh
    expect(screen.getByText('$12.50')).toBeInTheDocument(); // estimated_cost
    // Placeholders are gone now a plan exists.
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('shows "Free" when the estimated cost is zero and a "—" charging tile with no charging', () => {
    renderPage();
    planWith(makePlan({ route: { estimated_cost: 0, charging_duration_s: 0 } }));

    expect(screen.getByText('Free')).toBeInTheDocument();
    // charging_duration_s === 0 → the charging KPI stays a placeholder.
    expect(screen.getAllByText('—')).toHaveLength(1);
  });

  it('threads the plan into the map, SOC chart and leg list children', () => {
    renderPage();
    planWith(makePlan());

    expect(screen.getByTestId('map-origin')).toHaveTextContent('From Location');
    expect(screen.getByTestId('map-dest')).toHaveTextContent('To Location');
    expect(screen.getByTestId('map-legs')).toHaveTextContent('2');
    expect(screen.getByTestId('leg-count')).toHaveTextContent('2');
    expect(screen.getByTestId('leg-stops')).toHaveTextContent('1');
    expect(screen.getByTestId('soc-points')).toHaveTextContent('2');
    expect(screen.getByTestId('soc-stops')).toHaveTextContent('1');
    expect(screen.getByTestId('soc-minarrival')).toHaveTextContent('20');
  });
});

/* ── formatDuration hardening (the private helper, via KPIs) ─ */

describe('TripPlannerPage — duration formatting edge cases', () => {
  it('rolls a rounded 60-minute remainder into the next hour (no "1h 60m")', () => {
    renderPage();
    // 7199s → 119.98 min and 3599s → 59.98 min both round to a :60 remainder.
    planWith(makePlan({ route: { total_duration_s: 7_199, driving_duration_s: 3_599 } }));

    expect(screen.getByText('2h 0m')).toBeInTheDocument(); // was "1h 60m"
    expect(screen.getByText('1h 0m')).toBeInTheDocument(); // was "60m"
    expect(screen.queryByText('1h 60m')).not.toBeInTheDocument();
    expect(screen.queryByText('60m')).not.toBeInTheDocument();
  });

  it('renders a placeholder instead of "NaNm" when a duration is non-finite', () => {
    renderPage();
    planWith(makePlan({ route: { total_duration_s: Number.NaN } }));

    // Only the total-time tile falls back to the em-dash; the rest are valued.
    expect(screen.getAllByText('—')).toHaveLength(1);
    expect(screen.getByText('1h 30m')).toBeInTheDocument(); // driving still renders
  });
});

/* ── feasibility / insights / weather branches ────────────── */

describe('TripPlannerPage — feasibility, weather and estimate insights', () => {
  it('surfaces the loud infeasibility banner and infeasible insight when a route is not feasible', () => {
    renderPage();
    planWith(makePlan({ route: { feasible: false } }));

    expect(
      screen.getByText(/This trip may not be feasible with the current battery level/),
    ).toBeInTheDocument();
    expect(screen.getByText('Trip may not be feasible')).toBeInTheDocument();
  });

  it('shows the feasible insight and no loud banner for a feasible route', () => {
    renderPage();
    planWith(makePlan({ route: { feasible: true } }));

    expect(screen.getByText('Trip is feasible')).toBeInTheDocument();
    expect(
      screen.queryByText(/This trip may not be feasible with the current battery level/),
    ).not.toBeInTheDocument();
  });

  it('renders the estimate disclaimer only when the route is an estimate', () => {
    renderPage();
    planWith(makePlan({ route: { is_estimate: true } }));
    expect(
      screen.getByText(/This is an estimate based on straight-line distance/),
    ).toBeInTheDocument();
  });

  it('renders a weather-impact block with the efficiency factor when weather matters', () => {
    renderPage();
    planWith(makePlan({ weather: { avg_temp_c: -3, efficiency_factor: 1.2, note: 'Freezing' } }));

    expect(screen.getByText('Weather Impact')).toBeInTheDocument();
    expect(screen.getByText('Freezing')).toBeInTheDocument();
    expect(screen.getByText('Efficiency factor: 1.20×')).toBeInTheDocument();
  });

  it('omits the factor caption when the temperature is unknown but keeps the note', () => {
    renderPage();
    planWith(
      makePlan({ weather: { avg_temp_c: null, efficiency_factor: 1.2, note: 'Windy' } }),
    );

    expect(screen.getByText('Weather Impact')).toBeInTheDocument();
    expect(screen.getByText('Windy')).toBeInTheDocument();
    expect(screen.queryByText(/Efficiency factor:/)).not.toBeInTheDocument();
  });

  it('falls back to the "no significant weather impact" note when the factor is neutral', () => {
    renderPage();
    planWith(makePlan({ weather: { avg_temp_c: 20, efficiency_factor: 1.0, note: 'Mild' } }));

    expect(
      screen.getByText('No significant weather impact expected.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Weather Impact')).not.toBeInTheDocument();
  });
});

/* ── handleSendToCar ──────────────────────────────────────── */

describe('TripPlannerPage — send-to-car command', () => {
  it('reveals the "Send to Car" button after a plan and dispatches a navigation_request', () => {
    renderPage();
    planWith(makePlan());

    const sendBtn = screen.getByRole('button', { name: /Send to Car/i });
    expect(sendBtn).toBeInTheDocument();

    fireEvent.click(sendBtn);
    expect(commandMutate).toHaveBeenCalledTimes(1);
    expect(commandMutate).toHaveBeenCalledWith({
      vehicleId: 1,
      command: 'navigation_request',
      params: { lat: 41, lon: -71 },
    });
  });
});

/* ── mutation lifecycle: loading + error ──────────────────── */

describe('TripPlannerPage — plan mutation lifecycle', () => {
  it('shows a pending label and disables the button while planning', () => {
    mockUsePlanTrip.mockReturnValue({
      mutate: planMutate,
      isPending: true,
      isError: false,
    } as never);
    renderPage();

    const btn = screen.getByRole('button', { name: /Planning\.\.\./i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it('renders an error banner when the plan mutation fails', () => {
    mockUsePlanTrip.mockReturnValue({
      mutate: planMutate,
      isPending: false,
      isError: true,
    } as never);
    renderPage();

    expect(
      screen.getByText('Failed to compute trip plan. Please try again.'),
    ).toBeInTheDocument();
  });
});

/* ── AI agent prop wiring ─────────────────────────────────── */

describe('TripPlannerPage — AI agent input wiring', () => {
  it('passes the selected vehicle and default form values to the AI agent', () => {
    renderPage();
    const agent = screen.getByTestId('ai-agent');
    expect(agent).toHaveAttribute('data-vehicle', '1');
    expect(agent).toHaveAttribute('data-origin', 'none');
    expect(agent).toHaveAttribute('data-dest', 'none');
    expect(agent).toHaveAttribute('data-soc', '80');
    expect(agent).toHaveAttribute('data-minarrival', '20');
    expect(agent).toHaveAttribute('data-chargelimit', '90');
    expect(agent).toHaveAttribute('data-speed', '1');
  });

  it('updates the AI agent inputs as the form changes', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Current SOC'), { target: { value: '55' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Driving Speed' }), {
      target: { value: '0.8' },
    });
    selectOriginAndDestination();

    const agent = screen.getByTestId('ai-agent');
    expect(agent).toHaveAttribute('data-soc', '55');
    expect(agent).toHaveAttribute('data-speed', '0.8');
    expect(agent).toHaveAttribute('data-origin', 'From Location');
    expect(agent).toHaveAttribute('data-dest', 'To Location');
  });
});
