/**
 * VehicleCommandCenter tests (Project Apex elevation).
 *
 * VehicleCommandCenter is the single-vehicle command surface. Its one export
 * orchestrates a lot of behaviour that these tests exercise end-to-end:
 *   - a header that prefers `display_name`, falls back to the VIN, shows a
 *     state Badge + FreshnessIndicator, and renders live battery / rated-range /
 *     cabin-temperature read from `state` at the operator's units (SI → display
 *     at the render boundary via `useUnits()`);
 *   - null-safety on the live metrics (a null `battery_level` must read `0%`,
 *     never a bare `%`; a null `rated_range` must read `0 <unit>`);
 *   - an "asleep / offline" callout and a separate "stale data" banner, gated so
 *     the stale banner never shows while the vehicle is asleep;
 *   - a favourites bar seeded from `localStorage` (or the `defaultFavorite`
 *     commands) plus a search box that flattens results and shows an empty
 *     state for no matches;
 *   - command execution: a plain action POSTs `/vehicles/{id}/command/{cmd}`,
 *     `wake_up` routes through the dedicated wake mutation, failures surface an
 *     error banner, and the latest-status query annotates each tile
 *     (`✓ 2m ago` / `✗ …`), degrading a malformed timestamp to an em dash
 *     rather than `NaN`;
 *   - the three centralised dialogs — confirm (dangerous), select, and input —
 *     open from the right tile and, for select/input, feed the chosen params
 *     back through the same POST.
 *
 * The shared `request` client is stubbed so the real TanStack Query hooks run
 * without a network. `useSettings` is left to the global test-setup stub
 * (metric / SI units, decimal_precision=2) so SI values format as km / °C.
 * i18n is stubbed to echo the English `defaultValue` with `{{var}}`
 * interpolation (and to echo the key when no default is given) so visible copy
 * is deterministic. user-event is not installed in this repo (see
 * DriveRepairForm.test.tsx); interactions go through `fireEvent`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Stub the resilient fetch client while preserving the rest of the module so
// transitive consumers keep working.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// Deterministic i18n: return the English defaultValue (interpolating {{vars}}),
// fall back to a nested `defaultValue`, and otherwise echo the key so the
// component's key-only `t('Vehicle is')` calls render stable copy.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, vars?: Record<string, unknown>): string =>
    vars
      ? tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) =>
          k in vars ? String(vars[k]) : `{{${k}}}`,
        )
      : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, dflt?: unknown, opts?: unknown) => {
        if (typeof dflt === 'string') {
          const vars = opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : undefined;
          return interpolate(dflt, vars);
        }
        if (dflt && typeof dflt === 'object') {
          const o = dflt as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return interpolate(o.defaultValue, o);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import { VehicleCommandCenter } from './VehicleCommandCenter';
import type { Vehicle, VehicleState, CommandLogEntry } from '../commands';

const mockRequest = request as unknown as ReturnType<typeof vi.fn>;

type RequestArgs = [string, RequestInit?];

const VEHICLE_ID = 42;
const FAV_KEY = `teslasync-cmd-favorites-${VEHICLE_ID}`;

// Per-test-configurable responses, read lazily by the request router below.
let latestEntries: CommandLogEntry[] = [];
let commandResponse: () => Promise<unknown> = () =>
  Promise.resolve({ success: true, message: 'OK' });

function buildVehicle(overrides?: Partial<Vehicle>): Vehicle {
  return {
    id: VEHICLE_ID,
    vin: '5YJ3E1EA7KF000000',
    display_name: 'My Tesla',
    model: 'Model 3',
    state: 'online',
    battery_level: 85,
    battery_range: 400000,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildState(overrides?: Partial<VehicleState>): VehicleState {
  return {
    battery_level: 85,
    rated_range: 400000, // 400 km
    is_locked: false,
    is_charging: false,
    is_climate_on: false,
    sentry_mode: false,
    inside_temp: 21, // 21 °C
    speed: 0,
    ...overrides,
  };
}

function renderCenter(
  vehicle: Vehicle = buildVehicle(),
  state: VehicleState | null = buildState(),
) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <VehicleCommandCenter vehicle={vehicle} state={state} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

/** First stubbed request issued with the given HTTP method. */
function findCall(method: string): RequestArgs | undefined {
  return (mockRequest.mock.calls as RequestArgs[]).find((c) => c[1]?.method === method);
}

function bodyOf(call: RequestArgs | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.[1]?.body ?? '{}')) as Record<string, unknown>;
}

const typeSearch = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText('Search commands...'), { target: { value } });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  latestEntries = [];
  commandResponse = () => Promise.resolve({ success: true, message: 'OK' });
  mockRequest.mockReset();
  mockRequest.mockImplementation((url: string) => {
    if (url.endsWith('/commands/latest')) return Promise.resolve(latestEntries);
    if (url.includes('/command/')) return commandResponse();
    return Promise.resolve({});
  });
});

describe('VehicleCommandCenter — header + live state', () => {
  it('renders the vehicle name, model · VIN caption, and state badge', () => {
    renderCenter();
    expect(screen.getByText('My Tesla')).toBeInTheDocument();
    expect(screen.getByText(/Model 3/)).toBeInTheDocument();
    expect(screen.getByText(/5YJ3E1EA7KF000000/)).toBeInTheDocument();
    expect(screen.getByText('online')).toBeInTheDocument();
  });

  it('falls back to the VIN as the display name when display_name is blank', () => {
    renderCenter(buildVehicle({ display_name: '' }));
    // The VIN now appears twice: as the header name AND inside the caption.
    expect(screen.getAllByText(/5YJ3E1EA7KF000000/).length).toBeGreaterThanOrEqual(2);
  });

  it('renders battery, rated range, and cabin temperature at the operator SI units', () => {
    renderCenter();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('400 km')).toBeInTheDocument();
    expect(screen.getByText('21°C')).toBeInTheDocument();
    // Decorative metric icons must be hidden from assistive tech.
    expect(document.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
  });

  it('is null-safe: a null battery_level reads 0% (never a bare %) and null range reads 0 km', () => {
    renderCenter(
      buildVehicle(),
      buildState({
        battery_level: null as unknown as number,
        rated_range: null as unknown as number,
        inside_temp: null as unknown as number,
      }),
    );
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('0 km')).toBeInTheDocument();
    // The pre-hardening bug rendered a stranded "%" for a null battery_level.
    expect(screen.queryByText('%')).toBeNull();
    // A null cabin temperature suppresses the whole temperature chip.
    expect(screen.queryByText(/°C/)).toBeNull();
  });

  it('omits the entire live-metric row when no state is available', () => {
    renderCenter(buildVehicle(), null);
    expect(screen.queryByText('85%')).toBeNull();
    expect(screen.queryByText(/km/)).toBeNull();
    // Commands still render — the surface is not gated behind state.
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
  });
});

describe('VehicleCommandCenter — asleep + stale banners', () => {
  it('shows the wake-up callout when asleep and suppresses the stale banner', () => {
    // Asleep AND stale: only the asleep callout should show.
    renderCenter(
      buildVehicle({ state: 'asleep', updated_at: new Date(Date.now() - 20 * 60_000).toISOString() }),
      null,
    );
    expect(screen.getByText(/Wake it up first to send commands/i)).toBeInTheDocument();
    expect(screen.queryByText(/Vehicle data is/i)).toBeNull();
  });

  it('shows the stale-data banner for an online vehicle with an old timestamp', () => {
    renderCenter(
      buildVehicle({ state: 'online', updated_at: new Date(Date.now() - 20 * 60_000).toISOString() }),
      buildState(),
    );
    expect(screen.getByText(/Vehicle data is .* old/i)).toBeInTheDocument();
    expect(screen.queryByText(/Wake it up first/i)).toBeNull();
  });
});

describe('VehicleCommandCenter — favourites + search', () => {
  it('seeds the Quick Actions bar from the defaultFavorite commands', () => {
    renderCenter();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText('Wake Up')).toBeInTheDocument();
    expect(screen.getByText('Lock')).toBeInTheDocument();
  });

  it('hydrates favourites from localStorage when present', () => {
    localStorage.setItem(FAV_KEY, JSON.stringify(['lock']));
    renderCenter();
    // Only the persisted favourite is shown; other defaults are not favourites.
    expect(screen.getByText('Lock')).toBeInTheDocument();
    expect(screen.queryByText('Wake Up')).toBeNull();
  });

  it('persists a favourite toggle to localStorage', () => {
    renderCenter();
    typeSearch('flash_lights'); // isolate a single, non-favourite tile
    fireEvent.click(screen.getByRole('button', { name: 'Toggle favorite' }));
    const stored = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as string[];
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toContain('flash_lights');
  });

  it('flattens search results and shows an empty state for no matches', () => {
    renderCenter();
    typeSearch('flash_lights');
    expect(screen.getByText('Flash Lights')).toBeInTheDocument();
    // The favourites bar collapses while searching.
    expect(screen.queryByText('Quick Actions')).toBeNull();

    typeSearch('zzzznope');
    expect(screen.getByText('No commands match your search')).toBeInTheDocument();
    expect(screen.queryByText('Flash Lights')).toBeNull();
  });
});

describe('VehicleCommandCenter — command execution', () => {
  it('POSTs a plain action to the command route and surfaces the success banner', async () => {
    renderCenter();
    typeSearch('flash_lights');
    fireEvent.click(screen.getByText('Flash Lights'));

    await screen.findByText('OK'); // lastResult banner
    const post = findCall('POST');
    expect(post?.[0]).toBe('/vehicles/42/command/flash_lights');
    expect(bodyOf(post)).toEqual({}); // no params for a bare action
  });

  it('routes wake_up through the dedicated wake mutation', async () => {
    renderCenter();
    fireEvent.click(screen.getByText('Wake Up'));

    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        '/vehicles/42/command/wake_up',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    // wake_up is a stamp-only POST with no JSON body.
    expect(bodyOf(findCall('POST'))).toEqual({});
  });

  it('surfaces an error banner when a command fails', async () => {
    commandResponse = () => Promise.reject(new Error('boom'));
    renderCenter();
    typeSearch('flash_lights');
    fireEvent.click(screen.getByText('Flash Lights'));

    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('annotates a tile with the latest command status (✓ + relative age)', async () => {
    latestEntries = [
      {
        id: 1,
        vehicle_id: VEHICLE_ID,
        command: 'flash_lights',
        params: '',
        status: 'success',
        error: '',
        created_at: new Date(Date.now() - 125_000).toISOString(), // ~2 minutes
      },
    ];
    renderCenter();
    typeSearch('flash_lights');

    expect(await screen.findByText('✓ 2m ago')).toBeInTheDocument();
  });

  it('degrades a malformed command timestamp to an em dash instead of NaN', async () => {
    latestEntries = [
      {
        id: 2,
        vehicle_id: VEHICLE_ID,
        command: 'flash_lights',
        params: '',
        status: 'success',
        error: '',
        created_at: 'not-a-real-date',
      },
    ];
    renderCenter();
    typeSearch('flash_lights');

    expect(await screen.findByText('✓ —')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});

describe('VehicleCommandCenter — centralised dialogs', () => {
  it('opens the confirm dialog for a dangerous command and cancels without executing', () => {
    renderCenter();
    typeSearch('remote_start_drive');
    fireEvent.click(screen.getByText('Remote Start'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/keyless driving for 2 minutes/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockRequest).not.toHaveBeenCalledWith(
      '/vehicles/42/command/remote_start_drive',
      expect.anything(),
    );
  });

  it('opens the select dialog and POSTs the chosen option as a param', async () => {
    renderCenter();
    typeSearch('set_cop_temp');
    fireEvent.click(screen.getByText('COP Temp'));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Low/ }));

    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        '/vehicles/42/command/set_cop_temp',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(bodyOf(findCall('POST'))).toEqual({ cop_temp: '0' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the input dialog and POSTs the edited value as a param', async () => {
    renderCenter();
    typeSearch('set_charge_limit');
    fireEvent.click(screen.getByText('Set Limit'));

    const dialog = screen.getByRole('dialog');
    const field = within(dialog).getByDisplayValue('80'); // seeded default
    fireEvent.change(field, { target: { value: '90' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /send/i }));

    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        '/vehicles/42/command/set_charge_limit',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(bodyOf(findCall('POST'))).toEqual({ percent: '90' });
  });
});
