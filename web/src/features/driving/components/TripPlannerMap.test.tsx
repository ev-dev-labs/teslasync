/**
 * TripPlannerMap — behaviour + hardening coverage.
 *
 * `<TripPlannerMap>` is the route-visualisation panel of the Trip Planner. It is
 * a pure presentational component (no data source of its own) that turns the
 * origin, destination, per-leg geometry and charge stops into a leaflet map:
 * a route polyline, coloured origin/destination markers, and a marker + popup
 * per charge stop. When there is nothing plottable it must show an accessible
 * empty state instead of a blank/broken map.
 *
 * The file exports two symbols, both covered here:
 *   1. `isValidCoord` — the WGS84 coordinate guard that keeps NaN / Infinity /
 *      out-of-range values (which crash leaflet's projection math) out of the
 *      centre, polyline and every marker.
 *   2. `TripPlannerMap` — the component.
 *
 * This suite exercises the branches that would silently regress rather than a
 * smoke render:
 *   • empty & null-safety (the hardening) — no geometry, and invalid origin
 *     coordinates, both surface the accessible empty state instead of a broken
 *     map or a crash;
 *   • centre / zoom heuristics — midpoint for a pair, single-point centring
 *     (incl. destination-only), and the far/near zoom thresholds;
 *   • the route polyline — direct line for a bare origin→destination, the
 *     contiguous leg chain, legs-only rendering, and invalid-leg filtering;
 *   • markers — origin/destination labels + their i18n fallbacks;
 *   • charge stops — the i18n name + SOC/duration summary, null-safe zeros
 *     instead of NaN, and invalid-location filtering;
 *   • accessibility — the labelled map region.
 *
 * Per the repo convention (see ElevationChart.test.tsx /
 * TeslaChargingSessionsMap.integration.test.tsx): react-i18next is stubbed to
 * echo the English fallback (and interpolate `{{vars}}`) so asserted copy is
 * decoupled from the locale bundle; the `@/components/maps` barrel is doubled
 * (real leaflet needs a DOM canvas jsdom lacks) with lightweight passthroughs
 * that expose the props/children the component wires up. The shared UI
 * primitives (GlassPanel / Text / EmptyState) are the REAL modules so the
 * accessible empty state + marker labels are asserted against production output.
 * Network is never touched — this component has no data source of its own.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { TripLocation, TripLeg, TripChargeStop } from '@/types/driving';

// ── i18n: resolve the string fallback (2nd arg) and interpolate {{vars}}
//    (3rd arg) so assertions read on the rendered English copy. ──
vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown, vars?: Record<string, unknown>): string => {
    let out = typeof fallback === 'string' ? fallback : key;
    if (vars && typeof vars === 'object') {
      for (const [k, v] of Object.entries(vars)) {
        out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
      }
    }
    return out;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
  };
});

// ── maps barrel double: real leaflet requires a canvas jsdom lacks, so the
//    map/markers render nothing observable. These passthroughs surface the
//    props (centre, zoom, positions, path styles) and children (popups) the
//    component wires up as inspectable DOM. ──
vi.mock('@/components/maps', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    MapContainer: ({
      center,
      zoom,
      children,
    }: {
      center?: unknown;
      zoom?: number;
      children?: ReactNode;
    }) => (
      <div
        data-testid="map-container"
        data-center={JSON.stringify(center ?? null)}
        data-zoom={String(zoom ?? '')}
      >
        {children}
      </div>
    ),
    MapTileLayer: ({ style }: { style?: string }) => (
      <div data-testid="tile-layer" data-style={String(style ?? '')} />
    ),
    Polyline: ({ positions, pathOptions }: { positions?: unknown; pathOptions?: unknown }) => (
      <div
        data-testid="polyline"
        data-positions={JSON.stringify(positions ?? [])}
        data-path={JSON.stringify(pathOptions ?? {})}
      />
    ),
    CircleMarker: ({
      center,
      radius,
      pathOptions,
      children,
    }: {
      center?: unknown;
      radius?: number;
      pathOptions?: unknown;
      children?: ReactNode;
    }) => (
      <div
        data-testid="circle-marker"
        data-center={JSON.stringify(center ?? null)}
        data-radius={String(radius ?? '')}
        data-path={JSON.stringify(pathOptions ?? {})}
      >
        {children}
      </div>
    ),
    Popup: Passthrough,
  };
});

import { TripPlannerMap, isValidCoord } from './TripPlannerMap';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function loc(lat: number, lng: number, name = ''): TripLocation {
  return { lat, lng, name };
}

function leg(from: TripLocation, to: TripLocation): TripLeg {
  return {
    from,
    to,
    distance_m: 1000,
    duration_s: 60,
    energy_wh: 100,
    start_soc: 80,
    arrival_soc: 75,
  };
}

function stop(over: Partial<TripChargeStop> = {}): TripChargeStop {
  return {
    name: 'Supercharger',
    location: loc(38, -121, 'SC'),
    charge_from_soc: 20,
    charge_to_soc: 80,
    charge_duration_s: 1500,
    energy_wh: 30_000,
    cost: 12,
    is_recommended: true,
    ...over,
  };
}

type MapProps = {
  origin?: TripLocation | null;
  destination?: TripLocation | null;
  legs?: TripLeg[];
  chargeStops?: TripChargeStop[];
};

function renderMap(props: MapProps = {}) {
  return render(
    <TripPlannerMap
      origin={props.origin ?? null}
      destination={props.destination ?? null}
      legs={props.legs ?? []}
      chargeStops={props.chargeStops ?? []}
    />,
  );
}

function readCenter(el: HTMLElement): unknown {
  return JSON.parse(el.getAttribute('data-center') || 'null');
}

function readPositions(): unknown {
  return JSON.parse(screen.getByTestId('polyline').getAttribute('data-positions') || '[]');
}

// ── 1. isValidCoord (exported utility) ───────────────────────────────────────

describe('isValidCoord', () => {
  it('accepts finite, in-range coordinates including the WGS84 boundaries', () => {
    expect(isValidCoord(37.7749, -122.4194)).toBe(true);
    expect(isValidCoord(0, 0)).toBe(true);
    expect(isValidCoord(90, 180)).toBe(true);
    expect(isValidCoord(-90, -180)).toBe(true);
  });

  it('rejects out-of-range, non-finite and missing coordinates', () => {
    expect(isValidCoord(90.001, 0)).toBe(false);
    expect(isValidCoord(-91, 0)).toBe(false);
    expect(isValidCoord(0, 181)).toBe(false);
    expect(isValidCoord(0, -180.5)).toBe(false);
    expect(isValidCoord(Number.NaN, 0)).toBe(false);
    expect(isValidCoord(0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidCoord(null, 0)).toBe(false);
    expect(isValidCoord(10, undefined)).toBe(false);
  });
});

// ── 2. Empty & null-safety (the hardening) ───────────────────────────────────

describe('TripPlannerMap — empty & null-safety', () => {
  it('shows the accessible empty state (not a broken map) when there is no geometry', () => {
    renderMap();

    expect(screen.getByRole('status')).toHaveTextContent(
      'Enter origin and destination to see the route',
    );
    expect(screen.queryByTestId('map-container')).not.toBeInTheDocument();
  });

  it('treats invalid origin coordinates as "no data" instead of rendering a broken map', () => {
    expect(() => renderMap({ origin: loc(Number.NaN, Number.NaN, 'Bad') })).not.toThrow();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('map-container')).not.toBeInTheDocument();
  });
});

// ── 3. Origin + destination ──────────────────────────────────────────────────

describe('TripPlannerMap — origin + destination', () => {
  const origin = loc(37, -122, 'Home');
  const destination = loc(38, -121, 'Work');

  it('renders the dark-tiled map centred on the midpoint and hides the empty state', () => {
    renderMap({ origin, destination });

    const map = screen.getByTestId('map-container');
    expect(map).toBeInTheDocument();
    expect(readCenter(map)).toEqual([37.5, -121.5]);
    expect(screen.getByTestId('tile-layer')).toHaveAttribute('data-style', 'dark');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('draws a direct route polyline between the two points when no legs are supplied', () => {
    renderMap({ origin, destination });

    expect(readPositions()).toEqual([
      [37, -122],
      [38, -121],
    ]);
  });

  it('labels the origin and destination markers from their names', () => {
    renderMap({ origin, destination });

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('falls back to translated marker labels when the location names are blank', () => {
    renderMap({ origin: loc(37, -122), destination: loc(38, -121) });

    expect(screen.getByText('Origin')).toBeInTheDocument();
    expect(screen.getByText('Destination')).toBeInTheDocument();
  });
});

// ── 4. Centre / zoom heuristics ──────────────────────────────────────────────

describe('TripPlannerMap — centre / zoom heuristics', () => {
  it('zooms out for far-apart endpoints', () => {
    renderMap({ origin: loc(10, -120), destination: loc(50, -70) });

    expect(screen.getByTestId('map-container')).toHaveAttribute('data-zoom', '4');
  });

  it('zooms in tight for nearby endpoints', () => {
    renderMap({ origin: loc(37.0, -122.0), destination: loc(37.05, -122.05) });

    expect(screen.getByTestId('map-container')).toHaveAttribute('data-zoom', '9');
  });

  it('centres on the single endpoint at the fallback zoom when only the destination is set', () => {
    renderMap({ destination: loc(40, -74, 'NYC') });

    const map = screen.getByTestId('map-container');
    expect(map).toHaveAttribute('data-zoom', '5');
    expect(readCenter(map)).toEqual([40, -74]);
  });
});

// ── 5. Leg-based route ───────────────────────────────────────────────────────

describe('TripPlannerMap — leg-based route', () => {
  it('threads the polyline through the contiguous leg chain', () => {
    const a = loc(37, -122);
    const b = loc(37.5, -121.5);
    const c = loc(38, -121);
    renderMap({ origin: a, destination: c, legs: [leg(a, b), leg(b, c)] });

    expect(readPositions()).toEqual([
      [37, -122],
      [37.5, -121.5],
      [38, -121],
    ]);
  });

  it('still renders the route from legs when origin/destination are absent', () => {
    const a = loc(37, -122);
    const b = loc(38, -121);
    renderMap({ legs: [leg(a, b)] });

    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(readPositions()).toEqual([
      [37, -122],
      [38, -121],
    ]);
    // No origin/destination were supplied, so no named markers.
    expect(screen.queryByText('Origin')).not.toBeInTheDocument();
  });

  it('drops legs with invalid coordinates before drawing the polyline', () => {
    const a = loc(37, -122);
    const c = loc(38, -121);
    const bad = loc(Number.NaN, 5);
    renderMap({ origin: a, destination: c, legs: [leg(a, c), leg(c, bad)] });

    // Only the valid first leg contributes → 2 points, not 3.
    expect(readPositions()).toEqual([
      [37, -122],
      [38, -121],
    ]);
  });
});

// ── 6. Charge stops ──────────────────────────────────────────────────────────

describe('TripPlannerMap — charge stops', () => {
  const origin = loc(37, -122, 'Home');
  const destination = loc(40, -74, 'NYC');

  it('renders a labelled marker + SOC/duration summary per valid charge stop', () => {
    renderMap({
      origin,
      destination,
      chargeStops: [
        stop({
          name: 'Harris Ranch',
          location: loc(36.2, -120.2, 'HR'),
          charge_from_soc: 18,
          charge_to_soc: 82,
          charge_duration_s: 1500,
        }),
      ],
    });

    expect(screen.getByText('Harris Ranch')).toBeInTheDocument();
    // 1500s / 60 = 25 min; SOC endpoints rounded.
    expect(screen.getByText(/18% .* 82% \(25 min\)/)).toBeInTheDocument();
  });

  it('is null-safe: missing SOC/duration render as zeros, never NaN', () => {
    renderMap({
      origin,
      destination,
      chargeStops: [
        stop({
          name: '',
          charge_from_soc: null as unknown as number,
          charge_to_soc: undefined as unknown as number,
          charge_duration_s: null as unknown as number,
        }),
      ],
    });

    // Blank name → i18n fallback.
    expect(screen.getByText('Charge stop')).toBeInTheDocument();
    // Zeros, not "NaN% → NaN% (NaN min)".
    expect(screen.getByText(/0% .* 0% \(0 min\)/)).toBeInTheDocument();
  });

  it('filters out charge stops whose location coordinates are invalid', () => {
    renderMap({
      origin,
      destination,
      chargeStops: [
        stop({ name: 'Good', location: loc(37.5, -100) }),
        stop({ name: 'Bad', location: loc(Number.NaN, Number.NaN) }),
      ],
    });

    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(screen.queryByText('Bad')).not.toBeInTheDocument();
  });
});

// ── 7. Accessibility ─────────────────────────────────────────────────────────

describe('TripPlannerMap — accessibility', () => {
  it('wraps the map in a labelled region for assistive technology', () => {
    renderMap({ origin: loc(37, -122, 'Home'), destination: loc(38, -121, 'Work') });

    expect(screen.getByRole('region', { name: 'Trip route map' })).toBeInTheDocument();
  });
});
