/**
 * LocationMapWidget — comprehensive unit + integration coverage.
 *
 * Exercises every export of LocationMapWidget.tsx:
 *   - `hasValidCoords` — the pure "is this a usable GPS fix?" guard, including
 *     the real bug it was hardened against (a single 0 axis such as Greenwich's
 *     longitude 0 must NOT be treated as "no fix") plus the non-finite /
 *     out-of-range guards that keep bad coordinates away from Leaflet;
 *   - `normalizeHeading` — the raw-bearing → `[0, 360)` normalizer, its wrap
 *     behaviour, and the non-finite → `undefined` guard that stops the marker
 *     rotating by `NaNdeg` / the overlay reading "NaN°"; and
 *   - the default widget component across every render branch: the full map
 *     view, the compact 1×1 variant (title + overlay suppressed), the medium
 *     last-known overlay, the expanded heading + coordinate chips, the empty
 *     state (null-island and no-data-yet), the loading skeleton, the
 *     keep-last-data-on-error resilience path, the vehicle-selection fallback,
 *     and the manual-refresh interaction. Also asserts the a11y group and that
 *     the memoised center + normalized heading actually reach the marker.
 *
 * Strategy (mirrors the repo convention, e.g. ChargeStatusLiveWidget.test.tsx
 * and RoutePlayback.test.tsx):
 *   - The two data hooks (`useVehicles`, `useVehicleState`) are replaced with
 *     hoisted `vi.fn()` doubles so the network is never touched and every
 *     render is deterministic.
 *   - `@/components/maps` is mocked so Leaflet never mounts under jsdom:
 *     <MapContainer> becomes a passthrough that surfaces its `center`/`zoom`,
 *     <MapTileLayer> is inert, and <AnimatedMarker> surfaces the `position`
 *     tuple + `heading` it receives — letting us prove the widget's wiring
 *     without a real map. The REAL <WidgetMapView> still runs, so its
 *     isEmpty → <EmptyState> branch is genuinely exercised.
 *   - `react-i18next` is stubbed to resolve the developer fallback string so
 *     assertions read the real English copy.
 *   - The global test-setup already mocks `useSettings` (km / °C) and
 *     `useTimezone` (UTC), which the transitive <DataFreshness> header depends
 *     on. `matchMedia` is stubbed before any import runs because
 *     <DataFreshness>'s `useMotionPreference` touches it on first paint and
 *     jsdom does not provide it.
 *
 * `@testing-library/user-event` is intentionally NOT a dependency of this
 * codebase — interactions use `fireEvent`, consistent with the other slice
 * tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

// jsdom lacks matchMedia; <DataFreshness>'s useMotionPreference reads it on
// first paint. Install a stub (reduced-motion = true) BEFORE any import runs.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// react-i18next passthrough — resolve the fallback (2nd arg) so assertions read
// production copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}));

// Hoisted hook doubles — the network boundary. Never hit real endpoints.
const { vehiclesMock, vehicleStateMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  vehicleStateMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vehiclesMock,
  useVehicleState: vehicleStateMock,
}));

// Mock the Leaflet barrel so no real map mounts under jsdom. <MapContainer>
// surfaces the center/zoom <WidgetMapView> forwards; <AnimatedMarker> surfaces
// the position tuple + heading the widget hands it.
vi.mock('@/components/maps', () => ({
  MapContainer: ({
    children,
    center,
    zoom,
  }: {
    children?: ReactNode;
    center?: [number, number];
    zoom?: number;
  }) => (
    <div
      data-testid="map"
      data-lat={String(center?.[0])}
      data-lng={String(center?.[1])}
      data-zoom={String(zoom)}
    >
      {children}
    </div>
  ),
  MapTileLayer: () => null,
  AnimatedMarker: ({
    position,
    heading,
  }: {
    position?: [number, number];
    heading?: number;
  }) => (
    <div
      data-testid="marker"
      data-lat={String(position?.[0])}
      data-lng={String(position?.[1])}
      data-heading={heading == null ? '' : String(heading)}
    />
  ),
  MapLayerSwitcher: () => null,
  useMap: () => ({ panTo: vi.fn(), getBounds: () => ({ contains: () => true }) }),
}));

import LocationMapWidget, {
  hasValidCoords,
  normalizeHeading,
} from './LocationMapWidget';
import type { WidgetSize } from './types';

// ── Fixtures ───────────────────────────────────────────────────────────────
const SIZE_COMPACT: WidgetSize = { cols: 1, rows: 1 };
const SIZE_MEDIUM: WidgetSize = { cols: 2, rows: 2 };
const SIZE_EXPANDED: WidgetSize = { cols: 3, rows: 3 };

interface MapState {
  latitude: number;
  longitude: number;
  heading?: number | null;
}

function makeState(overrides: Partial<MapState> = {}): MapState {
  return {
    latitude: 37.7749,
    longitude: -122.4194,
    heading: 90,
    ...overrides,
  };
}

interface StateQueryOverrides {
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function makeStateQuery(
  state: MapState | undefined,
  live = true,
  over: StateQueryOverrides = {},
) {
  return {
    data: state ? { state, live } : undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: state ? Date.now() : 0,
    refetch: vi.fn(),
    ...over,
  };
}

function renderWidget(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  vehiclesMock.mockReset();
  vehicleStateMock.mockReset();
  // Sensible defaults: one vehicle (id 7), a live SF position heading east.
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
  vehicleStateMock.mockReturnValue(makeStateQuery(makeState()));
});

// ── hasValidCoords (pure) ────────────────────────────────────────────────────
describe('hasValidCoords', () => {
  it('accepts real fixes — including a single zero axis (equator / prime meridian)', () => {
    expect(hasValidCoords(37.7749, -122.4194)).toBe(true);
    // The regression this replaced: `lat !== 0 && lng !== 0` wrongly hid these.
    expect(hasValidCoords(51.4779, 0)).toBe(true); // Greenwich, longitude 0
    expect(hasValidCoords(0, 12.4964)).toBe(true); // equator, latitude 0
    // Inclusive range boundaries.
    expect(hasValidCoords(-90, -180)).toBe(true);
    expect(hasValidCoords(90, 180)).toBe(true);
  });

  it('rejects the null-island sentinel, out-of-range, and non-finite coords', () => {
    expect(hasValidCoords(0, 0)).toBe(false); // "no fix" sentinel
    expect(hasValidCoords(90.1, 10)).toBe(false); // latitude out of range
    expect(hasValidCoords(10, 180.1)).toBe(false); // longitude out of range
    expect(hasValidCoords(Number.NaN, 10)).toBe(false);
    expect(hasValidCoords(10, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

// ── normalizeHeading (pure) ──────────────────────────────────────────────────
describe('normalizeHeading', () => {
  it('passes finite bearings through and wraps into [0, 360)', () => {
    expect(normalizeHeading(0)).toBe(0);
    expect(normalizeHeading(90)).toBe(90);
    expect(normalizeHeading(359)).toBe(359);
    expect(normalizeHeading(360)).toBe(0);
    expect(normalizeHeading(450)).toBe(90); // 360 + 90
    expect(normalizeHeading(-90)).toBe(270); // wrap negative
  });

  it('returns undefined for missing or non-finite input', () => {
    expect(normalizeHeading(undefined)).toBeUndefined();
    expect(normalizeHeading(null)).toBeUndefined();
    expect(normalizeHeading(Number.NaN)).toBeUndefined();
    expect(normalizeHeading(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

// ── Widget render states ─────────────────────────────────────────────────────
describe('LocationMapWidget', () => {
  it('renders the map + marker at the vehicle position (medium, live)', () => {
    renderWidget(<LocationMapWidget size={SIZE_MEDIUM} />);

    // Title chrome shows above compact.
    expect(screen.getByText('Vehicle Location Map')).toBeInTheDocument();

    // The map receives the memoised center and the non-compact zoom.
    const map = screen.getByTestId('map');
    expect(map).toHaveAttribute('data-lat', '37.7749');
    expect(map).toHaveAttribute('data-lng', '-122.4194');
    expect(map).toHaveAttribute('data-zoom', '14');

    // The marker receives the same center tuple and the heading.
    const marker = screen.getByTestId('marker');
    expect(marker).toHaveAttribute('data-lat', '37.7749');
    expect(marker).toHaveAttribute('data-heading', '90');

    // Live fix ⇒ no "last known" chip, and not the empty state.
    expect(screen.queryByText('Last known position')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No location data available'),
    ).not.toBeInTheDocument();
  });

  it('selects the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget(<LocationMapWidget size={SIZE_MEDIUM} />);
    expect(vehicleStateMock).toHaveBeenCalledWith(7);
  });

  it('uses the explicit vehicleId prop when provided', () => {
    renderWidget(<LocationMapWidget vehicleId={42} size={SIZE_MEDIUM} />);
    expect(vehicleStateMock).toHaveBeenCalledWith(42);
  });

  it('suppresses title + overlay and uses the tighter zoom in the compact 1×1 tile', () => {
    // Not live so the overlay WOULD show at a larger size — proving the
    // suppression is the compact layout, not the live flag.
    vehicleStateMock.mockReturnValue(makeStateQuery(makeState(), false));

    renderWidget(<LocationMapWidget size={SIZE_COMPACT} />);

    expect(screen.queryByText('Vehicle Location Map')).not.toBeInTheDocument();
    expect(screen.queryByText('Last known position')).not.toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    // ...but the map + marker still render, at the compact zoom.
    expect(screen.getByTestId('marker')).toBeInTheDocument();
    expect(screen.getByTestId('map')).toHaveAttribute('data-zoom', '13');
  });

  it('shows the last-known chip (only) when the fix is not live at medium size', () => {
    vehicleStateMock.mockReturnValue(makeStateQuery(makeState(), false));

    renderWidget(<LocationMapWidget size={SIZE_MEDIUM} />);

    expect(screen.getByText('Last known position')).toBeInTheDocument();
    // Heading + coordinate chips are expanded-only — absent at medium.
    expect(screen.queryByText(/Heading:/)).not.toBeInTheDocument();
    expect(screen.queryByText('37.7749, -122.4194')).not.toBeInTheDocument();
  });

  it('adds the heading + coordinate chips at expanded size', () => {
    renderWidget(<LocationMapWidget size={SIZE_EXPANDED} />);

    expect(screen.getByText(/Heading:\s*90°/)).toBeInTheDocument();
    expect(screen.getByText('37.7749, -122.4194')).toBeInTheDocument();
    // Live fix ⇒ still no last-known chip even when expanded.
    expect(screen.queryByText('Last known position')).not.toBeInTheDocument();
  });

  it('normalizes an out-of-range heading before it reaches the marker and overlay', () => {
    vehicleStateMock.mockReturnValue(makeStateQuery(makeState({ heading: 450 })));

    renderWidget(<LocationMapWidget size={SIZE_EXPANDED} />);

    // 450° wraps to 90° for both the marker rotation and the readout.
    expect(screen.getByTestId('marker')).toHaveAttribute('data-heading', '90');
    expect(screen.getByText(/Heading:\s*90°/)).toBeInTheDocument();
  });

  it('omits the heading chip (but keeps coordinates) when heading is unavailable', () => {
    vehicleStateMock.mockReturnValue(makeStateQuery(makeState({ heading: null })));

    renderWidget(<LocationMapWidget size={SIZE_EXPANDED} />);

    expect(screen.queryByText(/Heading:/)).not.toBeInTheDocument();
    expect(screen.getByText('37.7749, -122.4194')).toBeInTheDocument();
    expect(screen.getByTestId('marker')).toHaveAttribute('data-heading', '');
  });

  it('exposes a labelled a11y group and hides decorative icons in the overlay', () => {
    // Not live + expanded ⇒ all three chips render (pin, heading, coords).
    vehicleStateMock.mockReturnValue(makeStateQuery(makeState(), false));

    const { container } = renderWidget(
      <LocationMapWidget size={SIZE_EXPANDED} />,
    );

    expect(
      screen.getByRole('group', { name: /vehicle location status/i }),
    ).toBeInTheDocument();
    // The chip icons are decorative (text conveys meaning) ⇒ aria-hidden.
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it('renders the empty state (role=status) for the (0,0) null-island fix', () => {
    vehicleStateMock.mockReturnValue(
      makeStateQuery(makeState({ latitude: 0, longitude: 0 })),
    );

    renderWidget(<LocationMapWidget size={SIZE_MEDIUM} />);

    expect(screen.getByText('No location data available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // No map/marker mounts when there is no usable fix.
    expect(screen.queryByTestId('marker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
  });

  it('renders the empty state when no state has arrived yet', () => {
    vehicleStateMock.mockReturnValue(makeStateQuery(undefined));

    renderWidget(<LocationMapWidget size={SIZE_MEDIUM} />);

    expect(screen.getByText('No location data available')).toBeInTheDocument();
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
  });

  it('renders a loading skeleton with no map or empty state while first fetching', () => {
    vehicleStateMock.mockReturnValue(
      makeStateQuery(undefined, true, { isLoading: true }),
    );

    const { container } = renderWidget(<LocationMapWidget size={SIZE_MEDIUM} />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No location data available'),
    ).not.toBeInTheDocument();
  });

  it('keeps the last-known map on a mid-poll error (never a blank panel)', () => {
    // A live-polling widget must not blow away a good fix on a transient error.
    vehicleStateMock.mockReturnValue(
      makeStateQuery(makeState(), true, { isError: true }),
    );

    renderWidget(<LocationMapWidget size={SIZE_MEDIUM} />);

    expect(screen.getByTestId('map')).toHaveAttribute('data-lat', '37.7749');
    expect(screen.getByTestId('marker')).toBeInTheDocument();
    expect(
      screen.queryByText('No location data available'),
    ).not.toBeInTheDocument();
  });

  it('invokes refetch when the freshness/refresh control is activated', () => {
    const refetch = vi.fn();
    vehicleStateMock.mockReturnValue(
      makeStateQuery(makeState(), true, {
        refetch,
        isFetching: false,
        dataUpdatedAt: Date.now(),
      }),
    );

    renderWidget(<LocationMapWidget size={SIZE_MEDIUM} />);

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
