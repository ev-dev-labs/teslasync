/**
 * GeofenceWidget — behaviour, branch, null-safety and a11y coverage for the
 * dashboard's geofence-status widget.
 *
 * What this file pins:
 *   - the exported pure helper `haversineMeters` — identity (same point → 0),
 *     a known equatorial degree of longitude (~111.2 km), meridian symmetry,
 *     input symmetry, and a real city pair that is unambiguously outside a
 *     500 m fence;
 *   - the widget's data-source resolution: an explicit `vehicleId` prop wins,
 *     otherwise the first fleet vehicle, otherwise id 0 (the state query stays
 *     disabled), tolerating an undefined vehicles list;
 *   - every render state fanned out by `WidgetShell` — the loading skeleton
 *     (driven by the vehicle-state OR the geofence query) and the empty state
 *     (never a blank panel) when no geofences are configured;
 *   - the fence-status branches in the standard body — Inside (success),
 *     Outside (neutral), and Disabled (wins even when geometrically inside),
 *     plus the SI→preferred radius formatting through `useUnits`;
 *   - null-safety — a geofence missing its name / radius renders an em dash and
 *     "0.0 km" with no `undefined`/`NaN` leak, and a vehicle parked on the
 *     null island (0,0) is treated as position-unknown (every fence "Outside");
 *   - the compact (1×1) variant — the current-zone success badge, the "No zone"
 *     fallback, and that the widget title is suppressed;
 *   - the REGRESSION FIX at the heart of this elevation: the compact layout used
 *     to refetch ONLY the vehicle state and mirror ONLY its freshness, silently
 *     ignoring a failed geofence fetch even though the zone badge is derived
 *     from it. Refresh now refetches BOTH sources and a geofence error surfaces
 *     the error dot;
 *   - the map section (rows ≥ 3 + known coords) — a circle per fence coloured by
 *     inside/outside, the vehicle marker at the resolved position, and that the
 *     map is hidden at short heights or when the position is unknown;
 *   - a11y — the decorative crosshair icons are hidden from the a11y tree, the
 *     freshness Refresh control exposes an accessible name, and the empty state
 *     is announced as a status region.
 *
 * Strategy: the three data hooks (`useVehicles`, `useVehicleState`,
 * `useGeofences`) are mocked so no network is touched and every query state is
 * controllable per-test. The leaflet subtree (`@/components/maps`) and the
 * shared `WidgetMapView` are stubbed to lightweight testable elements so the
 * map branch is asserted without a real map. i18n is a passthrough that honours
 * the English default so the visible copy is deterministic and real. `useUnits`
 * is left un-mocked and reads the global `useSettings` stub (km), so the radius
 * formatter runs for real. Renders are wrapped in a MemoryRouter because the
 * shared feedback/shell subtree may reach for router context.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { Geofence } from '@/types/location';
import type { WidgetSize } from './types';

// ── Mocks ────────────────────────────────────────────────────────────────────

// i18n passthrough: returns the English default so the widget's copy
// ("Geofence Status", "No geofences configured", "Inside"/"Outside"/"Disabled",
// "No zone", "Radius", "Refresh") is asserted verbatim.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Stub the leaflet primitives the widget imports directly so no real map is
// instantiated in jsdom. Each renders a testable element carrying the props the
// widget wires (fence circle colour, marker position).
vi.mock('@/components/maps', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    Circle: ({ pathOptions }: { pathOptions?: { color?: string } }) =>
      React.createElement('div', {
        'data-testid': 'fence-circle',
        'data-color': pathOptions?.color,
      }),
    Marker: ({ position }: { position: [number, number] }) =>
      React.createElement('div', {
        'data-testid': 'vehicle-marker',
        'data-pos': JSON.stringify(position),
      }),
    MapContainer: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'map-container' }, children),
    MapTileLayer: () => React.createElement('div', { 'data-testid': 'map-tile' }),
  };
});

// Stub the shared map view to a passthrough that renders its children (the
// fence circles + marker) so we can assert them without pulling the heavy
// shared-widget barrel or leaflet.
vi.mock('./shared', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    WidgetMapView: ({
      children,
      center,
      zoom,
    }: {
      children?: ReactNode;
      center: [number, number];
      zoom?: number;
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'widget-map', 'data-center': JSON.stringify(center), 'data-zoom': zoom },
        children,
      ),
  };
});

const { useVehiclesMock, useVehicleStateMock, useGeofencesMock } = vi.hoisted(() => ({
  useVehiclesMock: vi.fn(),
  useVehicleStateMock: vi.fn(),
  useGeofencesMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
  useVehicleState: (vehicleId: number) => useVehicleStateMock(vehicleId),
}));

vi.mock('@/api/hooks/useLocations', () => ({
  useGeofences: () => useGeofencesMock(),
}));

import GeofenceWidget, { haversineMeters } from './GeofenceWidget';

// ── Fixtures ─────────────────────────────────────────────────────────────────

// San Francisco — the reference vehicle position (non-zero so `hasCoords`).
const SF_LAT = 37.7749;
const SF_LON = -122.4194;
// San Jose — ~67.6 km away, unambiguously outside any small fence.
const SJ_LAT = 37.3382;
const SJ_LON = -121.8863;

interface StateResult {
  data: { state?: { latitude: number; longitude: number } } | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

interface FenceResult {
  data: Geofence[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeState(
  coords: { lat: number; lon: number } | null = { lat: SF_LAT, lon: SF_LON },
  over: Partial<StateResult> = {},
): StateResult {
  return {
    data: coords ? { state: { latitude: coords.lat, longitude: coords.lon } } : { state: undefined },
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeFenceResult(fences: Geofence[] | undefined, over: Partial<FenceResult> = {}): FenceResult {
  return {
    data: fences,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeFence(over: Partial<Geofence> = {}): Geofence {
  return {
    id: 'g1',
    name: 'Home',
    latitude: SF_LAT,
    longitude: SF_LON,
    radius: 500,
    alertOnEntry: false,
    alertOnExit: false,
    enabled: true,
    origin: 'manual',
    needsReview: false,
    createdAt: '2024-01-01T00:00:00Z',
    ...over,
  };
}

// A fence co-located with the SF vehicle → inside its 500 m radius.
const homeFence = makeFence({ id: 'home', name: 'Home', radius: 500 });
// A fence in San Jose → far outside.
const workFence = makeFence({
  id: 'work',
  name: 'Work',
  latitude: SJ_LAT,
  longitude: SJ_LON,
  radius: 2000,
});

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <GeofenceWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useVehiclesMock.mockReset();
  useVehicleStateMock.mockReset();
  useGeofencesMock.mockReset();

  useVehiclesMock.mockReturnValue({ data: [{ id: 5 }] });
  useVehicleStateMock.mockReturnValue(makeState());
  useGeofencesMock.mockReturnValue(makeFenceResult([homeFence, workFence]));
});

// ── Pure helper: haversineMeters ─────────────────────────────────────────────

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(0, 0, 0, 0)).toBe(0);
    expect(haversineMeters(SF_LAT, SF_LON, SF_LAT, SF_LON)).toBe(0);
  });

  it('measures one degree of longitude at the equator as ~111.2 km', () => {
    const d = haversineMeters(0, 0, 0, 1);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it('matches a degree of latitude to a degree of equatorial longitude (great-circle symmetry)', () => {
    expect(haversineMeters(0, 0, 1, 0)).toBeCloseTo(haversineMeters(0, 0, 0, 1), 3);
  });

  it('is symmetric in its endpoints', () => {
    expect(haversineMeters(SF_LAT, SF_LON, SJ_LAT, SJ_LON)).toBeCloseTo(
      haversineMeters(SJ_LAT, SJ_LON, SF_LAT, SF_LON),
      6,
    );
  });

  it('places two ~67 km-apart cities well outside a 500 m fence', () => {
    const d = haversineMeters(SF_LAT, SF_LON, SJ_LAT, SJ_LON);
    expect(d).toBeGreaterThan(60_000);
    expect(d).toBeLessThan(75_000);
    expect(d).toBeGreaterThan(500);
  });
});

// ── Data-source resolution ───────────────────────────────────────────────────

describe('GeofenceWidget — vehicle resolution', () => {
  it('queries the vehicle state for the explicit vehicleId prop', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 9 }] });
    renderWidget({ cols: 2, rows: 2 }, 77);
    expect(useVehicleStateMock).toHaveBeenCalledWith(77);
  });

  it('falls back to the first fleet vehicle when no vehicleId prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 5 }, { id: 6 }] });
    renderWidget();
    expect(useVehicleStateMock).toHaveBeenCalledWith(5);
  });

  it('resolves to id 0 (state query disabled) when the fleet is empty', () => {
    useVehiclesMock.mockReturnValue({ data: [] });
    renderWidget();
    expect(useVehicleStateMock).toHaveBeenCalledWith(0);
  });

  it('tolerates an undefined vehicles list without throwing', () => {
    useVehiclesMock.mockReturnValue({ data: undefined });
    expect(() => renderWidget()).not.toThrow();
    expect(useVehicleStateMock).toHaveBeenCalledWith(0);
  });
});

// ── Render states ────────────────────────────────────────────────────────────

describe('GeofenceWidget — states', () => {
  it('renders a loading skeleton while the vehicle-state query is pending', () => {
    useVehicleStateMock.mockReturnValue(makeState(null, { isLoading: true, data: undefined }));
    const { container } = renderWidget();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Home')).toBeNull();
    expect(screen.queryByText('Geofence Status')).toBeNull();
  });

  it('also shows the skeleton while the geofence query is pending', () => {
    useGeofencesMock.mockReturnValue(makeFenceResult(undefined, { isLoading: true }));
    const { container } = renderWidget();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows the empty state (never a blank panel) when no geofences are configured', () => {
    useGeofencesMock.mockReturnValue(makeFenceResult([]));
    renderWidget();
    expect(screen.getByText('No geofences configured')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Home')).toBeNull();
  });
});

// ── Populated body + fence-status branches (standard, cols=2 rows=2) ──────────

describe('GeofenceWidget — fence status branches', () => {
  it('renders each configured fence with its name and preferred-unit radius', () => {
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
    // useUnits (real) reads the global km setting: 500 m → "0.5 km", 2000 m → "2.0 km".
    expect(screen.getByText(/Radius:\s*0\.5\s*km/)).toBeInTheDocument();
    expect(screen.getByText(/Radius:\s*2\.0\s*km/)).toBeInTheDocument();
  });

  it('marks a fence the vehicle is within as Inside and a distant one as Outside', () => {
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByText('Inside')).toBeInTheDocument();
    expect(screen.getByText('Outside')).toBeInTheDocument();
  });

  it('shows Disabled (never Inside) for a disabled fence even when geometrically inside', () => {
    useGeofencesMock.mockReturnValue(
      makeFenceResult([makeFence({ id: 'off', name: 'Old Zone', enabled: false, radius: 500 })]),
    );
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.queryByText('Inside')).toBeNull();
    expect(screen.queryByText('Outside')).toBeNull();
  });

  it('treats every fence as Outside when the vehicle position is unknown (0,0)', () => {
    useVehicleStateMock.mockReturnValue(makeState({ lat: 0, lon: 0 }));
    renderWidget({ cols: 2, rows: 4 });
    // Both fences enabled but position unknown → distance Infinity → Outside.
    expect(screen.getAllByText('Outside')).toHaveLength(2);
    expect(screen.queryByText('Inside')).toBeNull();
    // Position unknown also suppresses the map even at a tall height.
    expect(screen.queryByTestId('widget-map')).toBeNull();
  });

  it('falls back to an em dash + "0.0 km" for a fence missing its name and radius', () => {
    const partial = makeFence({ id: 'x' });
    delete (partial as Partial<Geofence>).name;
    delete (partial as Partial<Geofence>).radius;
    useGeofencesMock.mockReturnValue(makeFenceResult([partial]));
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/Radius:\s*0\.0\s*km/)).toBeInTheDocument();
    expect(screen.queryByText(/undefined|NaN/)).toBeNull();
  });
});

// ── Compact (1×1) variant ────────────────────────────────────────────────────

describe('GeofenceWidget — compact', () => {
  it('renders the current-zone badge and suppresses the widget title', () => {
    renderWidget({ cols: 1, rows: 1 });
    // Vehicle is inside "Home"; the compact badge shows the active zone name.
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('Geofence Status')).toBeNull();
    expect(screen.queryByText('No zone')).toBeNull();
  });

  it('shows the "No zone" fallback when the vehicle is inside no enabled fence', () => {
    useGeofencesMock.mockReturnValue(makeFenceResult([workFence]));
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('No zone')).toBeInTheDocument();
    expect(screen.queryByText('Work')).toBeNull();
  });
});

// ── Refresh + freshness merge (the elevation regression fix) ──────────────────

describe('GeofenceWidget — refresh + freshness', () => {
  it('refetches BOTH the vehicle state and the geofences from the standard header', () => {
    const stateRefetch = vi.fn();
    const fenceRefetch = vi.fn();
    useVehicleStateMock.mockReturnValue(makeState(undefined, { refetch: stateRefetch }));
    useGeofencesMock.mockReturnValue(makeFenceResult([homeFence], { refetch: fenceRefetch }));

    renderWidget({ cols: 2, rows: 2 });
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(stateRefetch).toHaveBeenCalledTimes(1);
    expect(fenceRefetch).toHaveBeenCalledTimes(1);
  });

  it('also refetches BOTH sources from the compact layout (regression: state-only before)', () => {
    const stateRefetch = vi.fn();
    const fenceRefetch = vi.fn();
    useVehicleStateMock.mockReturnValue(makeState(undefined, { refetch: stateRefetch }));
    useGeofencesMock.mockReturnValue(makeFenceResult([homeFence], { refetch: fenceRefetch }));

    renderWidget({ cols: 1, rows: 1 });
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(stateRefetch).toHaveBeenCalledTimes(1);
    expect(fenceRefetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces the error freshness dot when only the geofence query fails (regression: was ignored)', () => {
    useVehicleStateMock.mockReturnValue(makeState()); // healthy live source
    useGeofencesMock.mockReturnValue(makeFenceResult(undefined, { isError: true, dataUpdatedAt: 0 }));
    const { container } = renderWidget({ cols: 1, rows: 1 });
    // Merged health follows the geofence error → red dot, not a bogus fresh one.
    expect(container.querySelector('.bg-red-400')).not.toBeNull();
    expect(container.querySelector('.bg-emerald-400')).toBeNull();
  });
});

// ── Map section (rows ≥ 3 + known coords) ────────────────────────────────────

describe('GeofenceWidget — map', () => {
  it('renders the map centred on the vehicle with a colour-coded circle per fence + a marker', () => {
    renderWidget({ cols: 2, rows: 4 });

    const map = screen.getByTestId('widget-map');
    expect(map).toHaveAttribute('data-center', JSON.stringify([SF_LAT, SF_LON]));

    const circles = screen.getAllByTestId('fence-circle');
    expect(circles).toHaveLength(2);
    const colors = circles.map((c) => c.getAttribute('data-color'));
    expect(colors).toContain('#22c55e'); // inside → green
    expect(colors).toContain('#6b7280'); // outside → grey

    expect(screen.getByTestId('vehicle-marker')).toHaveAttribute(
      'data-pos',
      JSON.stringify([SF_LAT, SF_LON]),
    );
  });

  it('hides the map at short heights but still lists the fences', () => {
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.queryByTestId('widget-map')).toBeNull();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

describe('GeofenceWidget — a11y', () => {
  it('hides the decorative crosshair icon from the accessibility tree', () => {
    const { container } = renderWidget({ cols: 2, rows: 2 });
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('exposes the freshness Refresh control with an accessible name', () => {
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('announces the empty state as a status region with a decorative icon', () => {
    useGeofencesMock.mockReturnValue(makeFenceResult([]));
    const { container } = renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});
