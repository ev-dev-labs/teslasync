/**
 * CommandsPage contract + hardening tests.
 *
 * CommandsPage is an orchestration shell: it owns two TanStack queries
 * (`/vehicles` roster + a fanned-out `/vehicles/{id}/state` poll), derives the
 * online/asleep KPI split, and renders one `VehicleCommandCenter` per vehicle.
 * The command-center child is a heavy, query-and-dialog-laden component, so it
 * is mocked with a prop-capturing stub — that isolates the page's own
 * behaviour (KPI band, header badge/actions, per-section loading/empty/error
 * states, state threading, navigation) without mounting the whole command
 * subtree.
 *
 * Facets covered:
 *   1. Loading   — roster pending → skeletons, no KPI labels, heading present.
 *   2. Empty     — zero vehicles → onboarding empty state + Vehicles KPI = 0.
 *   3. Loaded    — KPI values, "online/total" header badge, a VCC per vehicle,
 *                  and live state threaded down to the reachable car.
 *   4. Counting  — online = state ∉ {asleep, offline}; asleep = remainder.
 *   5. Roster err— rejected `/vehicles` → danger banner, no command centers.
 *   6. States err— EVERY `/state` fails → the (previously dead) warning banner
 *                  becomes reachable, and the board still renders degraded.
 *   7. Partial   — one `/state` fails, one succeeds → NO warning, state still
 *                  threads to the reachable car (per-vehicle degradation).
 *   8. a11y      — the two labelled regions + the History action are named.
 *   9. Navigate  — clicking "View History" routes to /command-history.
 *
 * Network is driven through the mocked `@/api/client` `request` seam (the same
 * seam DiagnosticPage / AnalyticsPage use) so nothing touches the real network.
 * `@testing-library/user-event` is intentionally not used — it is not a
 * dependency of this repo (see EditableText.test.tsx) — interactions go through
 * `fireEvent`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

// i18n stub: return the fallback string, interpolating {{var}} tokens from the
// options object so assertions can target the rendered English copy (the page
// uses `t(key, '{{online}}/{{total}} online', { online, total })`).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallbackOrOpts.replace(/{{(\w+)}}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          );
        }
        return fallbackOrOpts;
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// The command center is a heavy, dialog/query-laden child. Stub it with a
// prop-capturing marker so the page's roster wiring + state threading can be
// asserted deterministically without mounting the whole command subtree.
vi.mock('../components/VehicleCommandCenter', () => ({
  VehicleCommandCenter: ({
    vehicle,
    state,
  }: {
    vehicle: { id: number; display_name: string };
    state: unknown;
  }) => (
    <div data-testid={`vcc-${vehicle.id}`} data-has-state={state ? 'yes' : 'no'}>
      {vehicle.display_name}
    </div>
  ),
}));

// jsdom lacks matchMedia; framer-motion (via <FadeIn>/<Stagger*>) reads it.
// Guarded polyfill keeps the render deterministic.
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

import { request } from '@/api/client';
import { COMMANDS, CATEGORY_ORDER, type Vehicle } from '../commands';
import CommandsPage from './CommandsPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function makeVehicle(id: number, overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id,
    vin: `5YJ3E1EA0PF00000${id}`,
    display_name: `Car ${id}`,
    model: 'Model 3',
    state: 'online',
    battery_level: 82,
    battery_range: 300,
    updated_at: '2025-01-15T12:00:00Z',
    ...overrides,
  };
}

/**
 * Route the mocked `request` by URL.
 *  - `/vehicles`            → resolves the roster (or rejects / hangs).
 *  - `/vehicles/{id}/state` → resolves `{ state }` from the per-id map, or
 *                             rejects when the entry is the string 'reject'.
 * Unspecified ids resolve to `{ state: null }` so tests never trip the
 * total-outage warning by accident.
 */
function installNetwork(config: {
  vehicles?: Vehicle[];
  vehiclesError?: Error;
  vehiclesPending?: boolean;
  states?: Record<number, Record<string, unknown> | 'reject'>;
}) {
  mockedRequest.mockImplementation((path: string) => {
    if (path === '/vehicles') {
      if (config.vehiclesPending) return new Promise<Vehicle[]>(() => {});
      if (config.vehiclesError) return Promise.reject(config.vehiclesError);
      return Promise.resolve(config.vehicles ?? []);
    }
    const m = /^\/vehicles\/(\d+)\/state$/.exec(path);
    if (m) {
      const id = Number(m[1]);
      const entry = config.states?.[id];
      if (entry === 'reject') return Promise.reject(new Error('state endpoint down'));
      return Promise.resolve({ state: entry ?? null });
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

/** Renders the current pathname so navigation side-effects can be asserted. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/commands']}>
        <CommandsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The MetricCard root (`.rounded-xl`) that owns the given KPI label. */
function metricCard(label: string): HTMLElement {
  const span = screen.getByText(label);
  const root = span.closest('div.rounded-xl');
  if (!root) throw new Error(`no MetricCard root for "${label}"`);
  return root as HTMLElement;
}

beforeEach(() => {
  mockedRequest.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CommandsPage', () => {
  it('shows skeletons (and no KPI labels) while the roster is loading', () => {
    installNetwork({ vehiclesPending: true });

    const { container } = renderPage();

    // Header chrome renders immediately even while data is pending.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Vehicle Commands' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Remote control center for your Tesla fleet'),
    ).toBeInTheDocument();

    // KPI band is skeletonised — the resolved MetricCard labels are absent.
    expect(screen.queryByText('Vehicles')).not.toBeInTheDocument();
    expect(screen.queryByText('Online')).not.toBeInTheDocument();

    // 6 KPI skeletons + 2 command-center skeletons = 8 pulse placeholders.
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(6);
  });

  it('renders the onboarding empty state when the fleet is empty', async () => {
    installNetwork({ vehicles: [] });

    renderPage();

    expect(await screen.findByText('No vehicles found')).toBeInTheDocument();
    expect(
      screen.getByText(/Connect your Tesla account and sync your fleet/i),
    ).toBeInTheDocument();

    // The KPI band still renders (never gated) with a zero vehicle count.
    expect(metricCard('Vehicles')).toHaveTextContent('0');
    // No command centers, and the online badge is hidden with no fleet.
    expect(screen.queryByTestId('vcc-1')).not.toBeInTheDocument();
    expect(screen.queryByText(/online/)).not.toBeInTheDocument();
  });

  it('renders the KPI band, header badge, and a command center per vehicle', async () => {
    installNetwork({
      vehicles: [
        makeVehicle(1, { state: 'online', display_name: 'Roadster' }),
        makeVehicle(2, { state: 'asleep', display_name: 'Cybertruck' }),
      ],
      states: { 1: { battery_level: 74, rated_range: 250 } },
    });

    renderPage();

    // A command center per vehicle, echoing the display name.
    expect(await screen.findByTestId('vcc-1')).toHaveTextContent('Roadster');
    expect(screen.getByTestId('vcc-2')).toHaveTextContent('Cybertruck');

    // KPI values: 2 vehicles, 1 online, 1 asleep, plus the config-driven ones.
    expect(metricCard('Vehicles')).toHaveTextContent('2');
    expect(metricCard('Online')).toHaveTextContent('1');
    expect(metricCard('Asleep')).toHaveTextContent('1');
    expect(metricCard('Commands')).toHaveTextContent(String(COMMANDS.length));
    expect(metricCard('Categories')).toHaveTextContent(String(CATEGORY_ORDER.length));
    expect(metricCard('Auto-refresh')).toHaveTextContent('15s');

    // Header online badge reflects the online/total split.
    expect(screen.getByText('1/2 online')).toBeInTheDocument();

    // Live state fans out and threads to the reachable car; the asleep car
    // never had a state resolved, so it stays null (degraded, not blanked).
    await waitFor(() =>
      expect(screen.getByTestId('vcc-1')).toHaveAttribute('data-has-state', 'yes'),
    );
    expect(screen.getByTestId('vcc-2')).toHaveAttribute('data-has-state', 'no');
    expect(mockedRequest).toHaveBeenCalledWith('/vehicles/1/state');
  });

  it('counts online as state ∉ {asleep, offline} and asleep as the remainder', async () => {
    installNetwork({
      vehicles: [
        makeVehicle(1, { state: 'online' }),
        makeVehicle(2, { state: 'driving' }),
        makeVehicle(3, { state: 'asleep' }),
        makeVehicle(4, { state: 'offline' }),
      ],
      states: { 1: { battery_level: 50 }, 2: { battery_level: 50 } },
    });

    renderPage();

    // online + driving = 2 online; asleep + offline = 2 asleep.
    expect(await screen.findByTestId('vcc-1')).toBeInTheDocument();
    expect(metricCard('Vehicles')).toHaveTextContent('4');
    expect(metricCard('Online')).toHaveTextContent('2');
    expect(metricCard('Asleep')).toHaveTextContent('2');
    expect(screen.getByText('2/4 online')).toBeInTheDocument();
  });

  it('surfaces a danger banner and no command centers when the roster fails', async () => {
    installNetwork({ vehiclesError: new Error('fleet 500 Internal') });

    renderPage();

    expect(
      await screen.findByText(/Failed to load your fleet: fleet 500 Internal/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('vcc-1')).not.toBeInTheDocument();
  });

  it('surfaces the states warning when EVERY vehicle state fetch fails', async () => {
    installNetwork({
      vehicles: [makeVehicle(1), makeVehicle(2)],
      states: { 1: 'reject', 2: 'reject' },
    });

    renderPage();

    // The previously-dead warning branch is now reachable: a total fan-out
    // outage flips the states query into an error state.
    expect(
      await screen.findByText(/Failed to load vehicle states/i),
    ).toBeInTheDocument();

    // The board still renders — every car degrades to a stateless center.
    expect(screen.getByTestId('vcc-1')).toHaveAttribute('data-has-state', 'no');
    expect(screen.getByTestId('vcc-2')).toHaveAttribute('data-has-state', 'no');
  });

  it('does NOT warn on a partial states failure and still threads the ok car', async () => {
    installNetwork({
      vehicles: [makeVehicle(1), makeVehicle(2)],
      states: { 1: { battery_level: 60, rated_range: 200 }, 2: 'reject' },
    });

    renderPage();

    // Wait for both state fetches to have been attempted.
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/vehicles/2/state'),
    );
    // The reachable car receives its state; the failed one degrades to null.
    await waitFor(() =>
      expect(screen.getByTestId('vcc-1')).toHaveAttribute('data-has-state', 'yes'),
    );
    expect(screen.getByTestId('vcc-2')).toHaveAttribute('data-has-state', 'no');

    // A partial failure must stay silent — no warning banner.
    expect(screen.queryByText(/Failed to load vehicle states/i)).not.toBeInTheDocument();
  });

  it('exposes accessible names for the KPI region, centers region, and History action', async () => {
    installNetwork({ vehicles: [makeVehicle(1)], states: { 1: { battery_level: 90 } } });

    renderPage();

    await screen.findByTestId('vcc-1');
    const kpiRegion = screen.getByRole('region', { name: 'Fleet status' });
    expect(within(kpiRegion).getByText('Vehicles')).toBeInTheDocument();

    expect(
      screen.getByRole('region', { name: 'Vehicle command centers' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'View History' }),
    ).toBeInTheDocument();
  });

  it('navigates to /command-history when the History action is clicked', async () => {
    installNetwork({ vehicles: [makeVehicle(1)], states: { 1: { battery_level: 40 } } });

    renderPage();

    await screen.findByTestId('vcc-1');
    expect(screen.getByTestId('location')).toHaveTextContent('/commands');

    fireEvent.click(screen.getByRole('button', { name: 'View History' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/command-history');
  });
});
