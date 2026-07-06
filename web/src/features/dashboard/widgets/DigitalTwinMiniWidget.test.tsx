/**
 * DigitalTwinMiniWidget — behaviour + hardening coverage.
 *
 * The widget resolves the active vehicle (explicit `vehicleId` prop, else the
 * first vehicle), wires four live data hooks (`useVehicles`, `useSecurityLatest`,
 * `useVehicleState`, `useChargingTelemetryLatest`) at the 5s refresh cadence,
 * merges security + state + charging into a twin view-model via the real
 * `buildTwinState`, and renders a `<VehicleTwin>` SVG plus lock / sentry status
 * badges inside a `<WidgetShell>`. The single public export (the default
 * component) drives every branch, so the suite exercises it end-to-end.
 *
 * It doubles as the regression guard for two real bugs this elevation fixes:
 *   - Loading gap: `isLoading` ignored the vehicle-list fetch, so the widget
 *     flashed the "No vehicle data" empty state during the initial list load
 *     instead of a skeleton. The fix folds `useVehicles().isLoading` into the
 *     shell's loading state.
 *   - False-security badge: an unknown lock state (`locked === null`) rendered a
 *     green `success` chip with a lock icon — a misleading "secured" signal. The
 *     fix drops the chip to the neutral variant while keeping the em-dash label.
 *
 * The real `buildTwinState` runs here (only the network hooks are mocked and
 * driven per-test), so the security → badge derivation is verified for real.
 * Network is never touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { SecurityEvent } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';
import type { WidgetProps } from './types';

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

// ── The data hooks — all four are driven per test ──
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
  useSecurityLatest: vi.fn(),
  useVehicleState: vi.fn(),
  useChargingTelemetryLatest: vi.fn(),
}));

import {
  useVehicles,
  useSecurityLatest,
  useVehicleState,
  useChargingTelemetryLatest,
} from '@/api/hooks/useVehicles';
import DigitalTwinMiniWidget from './DigitalTwinMiniWidget';

const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockSecurity = useSecurityLatest as unknown as ReturnType<typeof vi.fn>;
const mockState = useVehicleState as unknown as ReturnType<typeof vi.fn>;
const mockCharging = useChargingTelemetryLatest as unknown as ReturnType<typeof vi.fn>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: null,
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

function makeVehicle(over: Partial<Vehicle> = {}): Vehicle {
  return { id: 1, vehicle_id: 1, exterior_color: 'PearlWhite', ...over } as Vehicle;
}

function makeSecurity(over: Partial<SecurityEvent> = {}): SecurityEvent {
  return { locked: true, sentry_mode: false, ...over } as SecurityEvent;
}

function renderWidget(props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <DigitalTwinMiniWidget size={{ cols: 2, rows: 2 }} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockVehicles.mockReset();
  mockSecurity.mockReset();
  mockState.mockReset();
  mockCharging.mockReset();

  mockVehicles.mockReturnValue({ data: [makeVehicle({ id: 1 })], isLoading: false });
  mockSecurity.mockReturnValue(makeQuery({ data: makeSecurity() }));
  mockState.mockReturnValue(makeQuery({ data: { state: { state: 'online' } } }));
  mockCharging.mockReturnValue(makeQuery({ data: null }));
});

describe('DigitalTwinMiniWidget — vehicle resolution', () => {
  it('resolves the vehicleId prop to the matching vehicle for every data hook', () => {
    mockVehicles.mockReturnValue({ data: [makeVehicle({ id: 3 }), makeVehicle({ id: 5 })] });
    renderWidget({ vehicleId: 5 });

    expect(mockSecurity).toHaveBeenCalledWith(5, 5000);
    expect(mockState).toHaveBeenCalledWith(5, { refetchInterval: 5000 });
    expect(mockCharging).toHaveBeenCalledWith(5, 5000);
  });

  it('falls back to the first vehicle when the vehicleId prop matches nothing', () => {
    mockVehicles.mockReturnValue({ data: [makeVehicle({ id: 3 })] });
    renderWidget({ vehicleId: 99 });

    expect(mockState).toHaveBeenCalledWith(3, { refetchInterval: 5000 });
  });

  it('uses the first vehicle when no vehicleId prop is supplied', () => {
    mockVehicles.mockReturnValue({ data: [makeVehicle({ id: 7 })] });
    renderWidget();

    expect(mockState).toHaveBeenCalledWith(7, { refetchInterval: 5000 });
    expect(mockSecurity).toHaveBeenCalledWith(7, 5000);
  });

  it('passes id 0 (disabling every query) when no vehicles exist', () => {
    mockVehicles.mockReturnValue({ data: [] });
    renderWidget();

    expect(mockSecurity).toHaveBeenCalledWith(0, 5000);
    expect(mockState).toHaveBeenCalledWith(0, { refetchInterval: 5000 });
  });
});

describe('DigitalTwinMiniWidget — empty state', () => {
  it('shows the no-vehicle empty state (role=status) when the vehicle list is empty', () => {
    mockVehicles.mockReturnValue({ data: [] });
    renderWidget();

    expect(screen.getByText('No vehicle data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('does not render the digital twin or status badges when there is no vehicle', () => {
    mockVehicles.mockReturnValue({ data: [] });
    renderWidget();

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
  });
});

describe('DigitalTwinMiniWidget — loading states', () => {
  it('renders a skeleton (no twin, no empty state) while security is loading', () => {
    mockSecurity.mockReturnValue(makeQuery({ data: null, isLoading: true }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No vehicle data')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders a skeleton while the vehicle state is loading', () => {
    mockState.mockReturnValue(makeQuery({ data: null, isLoading: true }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders a skeleton (not the empty state) while the vehicle list itself is loading', () => {
    // Regression guard: the initial vehicle-list load must not flash the
    // "No vehicle data" empty state — it should show the shell skeleton.
    mockVehicles.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No vehicle data')).not.toBeInTheDocument();
  });
});

describe('DigitalTwinMiniWidget — twin + header chrome', () => {
  it('renders the vehicle digital twin with an accessible image role + label', () => {
    renderWidget();

    const twin = screen.getByRole('img', { name: /digital twin/i });
    expect(twin).toBeInTheDocument();
    expect(twin.querySelector('svg')).not.toBeNull();
  });

  it('surfaces the widget title and an Open link to the full digital-twin route', () => {
    renderWidget();

    expect(screen.getByRole('heading', { name: 'Digital Twin' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /open/i });
    expect(link).toHaveAttribute('href', '/digital-twin');
  });
});

describe('DigitalTwinMiniWidget — lock status badge', () => {
  it('renders an "Unlocked" danger badge when the vehicle is unlocked', () => {
    mockSecurity.mockReturnValue(makeQuery({ data: makeSecurity({ locked: false }) }));
    renderWidget();

    const badge = screen.getByText('Unlocked');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-red-100');
  });

  it('renders a "Locked" success badge when the vehicle is locked', () => {
    mockSecurity.mockReturnValue(makeQuery({ data: makeSecurity({ locked: true }) }));
    renderWidget();

    const badge = screen.getByText('Locked');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-green-100');
  });

  it('renders a neutral em-dash badge (never a green success chip) when lock state is unknown', () => {
    // buildTwinState returns locked=null when neither security nor vehicle
    // state reports a lock value. The old code painted this green.
    mockSecurity.mockReturnValue(makeQuery({ data: makeSecurity({ locked: null, sentry_mode: null }) }));
    mockState.mockReturnValue(makeQuery({ data: { state: {} } }));
    renderWidget();

    const badge = screen.getByText('—');
    expect(badge.className).toContain('bg-gray-100');
    expect(badge.className).not.toContain('bg-green-100');
    expect(badge.className).not.toContain('bg-red-100');
  });
});

describe('DigitalTwinMiniWidget — sentry status badge', () => {
  it('renders a "Sentry" info badge when sentry mode is on', () => {
    mockSecurity.mockReturnValue(makeQuery({ data: makeSecurity({ locked: true, sentry_mode: true }) }));
    renderWidget();

    const badge = screen.getByText('Sentry');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-blue-100');
  });

  it('renders an "Off" neutral badge when sentry mode is explicitly off', () => {
    mockSecurity.mockReturnValue(makeQuery({ data: makeSecurity({ locked: true, sentry_mode: false }) }));
    renderWidget();

    const badge = screen.getByText('Off');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-gray-100');
  });

  it('omits the sentry badge entirely when sentry mode is unknown', () => {
    mockSecurity.mockReturnValue(makeQuery({ data: makeSecurity({ locked: true, sentry_mode: null }) }));
    mockState.mockReturnValue(makeQuery({ data: { state: {} } }));
    renderWidget();

    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.queryByText('Sentry')).not.toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
  });
});

describe('DigitalTwinMiniWidget — responsive badge visibility', () => {
  it('hides the status badges when the widget is very cramped (≤2 cols, 1 row)', () => {
    mockSecurity.mockReturnValue(makeQuery({ data: makeSecurity({ locked: true }) }));
    renderWidget({ size: { cols: 1, rows: 1 } });

    // Twin still renders, but the badges are suppressed to save space.
    expect(screen.getByRole('img', { name: /digital twin/i })).toBeInTheDocument();
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
  });

  it('shows the status badges at a comfortable 2×2 size', () => {
    mockSecurity.mockReturnValue(makeQuery({ data: makeSecurity({ locked: true }) }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  it('shows the status badges for a wide single-row widget (3×1)', () => {
    mockSecurity.mockReturnValue(makeQuery({ data: makeSecurity({ locked: true }) }));
    renderWidget({ size: { cols: 3, rows: 1 } });

    expect(screen.getByText('Locked')).toBeInTheDocument();
  });
});

describe('DigitalTwinMiniWidget — refresh + error resilience', () => {
  it('refetches the vehicle state when the refresh control is activated', () => {
    const refetch = vi.fn();
    mockState.mockReturnValue(
      makeQuery({ data: { state: { state: 'online' } }, refetch, isFetching: false }),
    );
    renderWidget();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the digital twin and badges visible when the vehicle-state query errors', () => {
    mockState.mockReturnValue(
      makeQuery({ data: { state: {} }, isError: true, dataUpdatedAt: 0 }),
    );
    mockSecurity.mockReturnValue(makeQuery({ data: makeSecurity({ locked: true }) }));
    renderWidget();

    // The twin is driven by the vehicle list, so a state error never blanks it.
    expect(screen.getByRole('img', { name: /digital twin/i })).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });
});
