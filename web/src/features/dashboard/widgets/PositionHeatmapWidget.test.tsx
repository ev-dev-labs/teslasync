/**
 * PositionHeatmapWidget — behaviour, branch, pure-helper + hardening coverage.
 *
 * The widget is the dashboard's position-density heatmap tile. Its surface
 * under test:
 *
 *   1. The pure exports it owns:
 *        - clusterPositions(): grid buckets nearby fixes, counts visits,
 *          normalises intensity to the densest bucket, and drops null-island
 *          (0,0) fixes.
 *        - centroid(): mean of the cluster centres, with a San-Francisco
 *          fallback for an empty set.
 *        - intensityColor(): SI-style 0–1 intensity → RGBA, now clamped so a
 *          malformed intensity can never emit an out-of-gamut channel.
 *   2. Responsive layout keyed off `size.cols`:
 *        - compact (≤1) → title-less, non-interactive, coarser 200-grid map,
 *        - standard (2)  → titled shell, 500-grid, interactive map,
 *        - wide (≥3)     → standard + a raw-count "N positions" badge.
 *   3. Density encoding: circle radius + fill colour scale with intensity.
 *   4. Loading / empty / error states (never a blank panel). The error branch
 *      is the key regression guard — the widget now forwards `error`, so a
 *      fetch failure surfaces the shared QueryError panel instead of
 *      masquerading as the "No position data" empty state.
 *   5. Freshness-control refresh → refetch.
 *   6. Vehicle scoping: an explicit `vehicleId` wins, else the first vehicle
 *      from `useVehicles`; with no vehicle the query id falls back to 0.
 *
 * Strategy (mirrors MediaHistoryWidget.test.tsx + AnalyticsSummaryWidget.test.tsx):
 *   - The data hooks are mocked with hoisted vi.fn()s so the network is never
 *     touched and every render is deterministic.
 *   - `@/components/maps` is mocked to an inert barrel that captures the props
 *     of MapContainer + every CircleMarker, so we assert clustering/centroid/
 *     intensity through real component behaviour without touching leaflet.
 *   - react-i18next resolves the developer fallback string (interpolating
 *     `{{vars}}`), so assertions read the English defaults.
 *   - matchMedia is shimmed so framer-motion (via the freshness chip) settles.
 *   - Renders are wrapped in <MemoryRouter> because the error branch mounts
 *     <QueryError>, which calls useNavigate.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * dashboard tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (useReducedMotion, read by the
// freshness chip) reads it at module load. Report reduced motion so the
// freshness dot settles deterministically.
vi.hoisted(() => {
  if (typeof window !== 'undefined') {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
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

interface CapturedMap {
  center: [number, number];
  zoom: number;
  scrollWheelZoom: boolean;
}
interface CapturedMarker {
  center: [number, number];
  radius: number;
  fillColor: string | undefined;
  fillOpacity: number | undefined;
}

const { positionsMock, vehiclesMock, captured } = vi.hoisted(() => ({
  positionsMock: vi.fn(),
  vehiclesMock: vi.fn(),
  captured: {
    map: null as CapturedMap | null,
    markers: [] as CapturedMarker[],
  },
}));

// i18n → return the developer fallback string, interpolating `{{vars}}`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Inert leaflet barrel — capture props, never touch canvas/leaflet. The real
// WidgetMapView (from ./shared) renders through these mocks.
vi.mock('@/components/maps', () => ({
  MapContainer: ({
    children,
    center,
    zoom,
    scrollWheelZoom,
  }: {
    children?: ReactNode;
    center: [number, number];
    zoom: number;
    scrollWheelZoom?: boolean;
  }) => {
    captured.map = { center, zoom, scrollWheelZoom: !!scrollWheelZoom };
    return <div data-testid="map">{children}</div>;
  },
  MapTileLayer: () => null,
  CircleMarker: ({
    center,
    radius,
    pathOptions,
  }: {
    center: [number, number];
    radius: number;
    pathOptions?: { fillColor?: string; fillOpacity?: number };
  }) => {
    captured.markers.push({
      center,
      radius,
      fillColor: pathOptions?.fillColor,
      fillOpacity: pathOptions?.fillOpacity,
    });
    return <div data-testid="marker" />;
  },
}));

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>(
    '@/api/hooks/useVehicles',
  );
  return {
    ...actual,
    useVehicles: () => vehiclesMock(),
    useVehiclePositions: (...args: unknown[]) => positionsMock(...args),
  };
});

import PositionHeatmapWidget, {
  clusterPositions,
  centroid,
  intensityColor,
  type ClusterPoint,
} from './PositionHeatmapWidget';
import type { WidgetSize } from './types';

/* ── Fixtures ─────────────────────────────────────────────────────── */

type Pos = { latitude: number; longitude: number };

// Three tightly-grouped San-Francisco fixes (one 500-grid bucket, count 3)
// plus one far-away New-York fix (count 1). maxCount 3 ⇒ intensities 1 and ⅓,
// so the two clusters are visually distinguishable in every assertion below.
const POSITIONS: Pos[] = [
  { latitude: 37.7749, longitude: -122.4194 },
  { latitude: 37.77492, longitude: -122.41942 },
  { latitude: 37.77495, longitude: -122.41945 },
  { latitude: 40.0, longitude: -74.0 },
];

interface FakeQuery {
  data?: unknown;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<FakeQuery> = {}): FakeQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <PositionHeatmapWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

const radii = () => captured.markers.map((m) => m.radius);

beforeEach(() => {
  positionsMock.mockReset();
  vehiclesMock.mockReset();
  captured.map = null;
  captured.markers.length = 0;
  positionsMock.mockReturnValue(makeQuery({ data: POSITIONS }));
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
});

/* ── Pure helpers ─────────────────────────────────────────────────── */

describe('clusterPositions', () => {
  it('returns an empty array for no input', () => {
    expect(clusterPositions([], 500)).toEqual([]);
  });

  it('buckets nearby fixes, counts visits and normalises intensity to the densest bucket', () => {
    const clusters = clusterPositions(POSITIONS, 500);
    expect(clusters).toHaveLength(2);

    expect(clusters.map((c) => c.count).sort((a, b) => a - b)).toEqual([1, 3]);

    const dense = clusters.find((c) => c.count === 3);
    const sparse = clusters.find((c) => c.count === 1);
    expect(dense?.intensity).toBe(1);
    expect(sparse?.intensity).toBeCloseTo(1 / 3, 6);

    // The dense bucket centre is the running mean of its three SF members.
    expect(dense?.lat).toBeCloseTo(37.77492, 4);
    expect(dense?.lon).toBeCloseTo(-122.41942, 4);
  });

  it('drops null-island (0,0) fixes so bad GPS never anchors the heatmap', () => {
    const withNullIsland: Pos[] = [
      ...POSITIONS,
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0 },
    ];
    const clusters = clusterPositions(withNullIsland, 500);
    expect(clusters).toHaveLength(2);
    expect(clusters.some((c) => c.lat === 0 && c.lon === 0)).toBe(false);
  });

  it('uses a coarser grid at lower precision', () => {
    // Two fixes 0.006° apart share a 100-grid cell (Δ<0.01) but split on the
    // finer 500-grid (Δ>0.002).
    const pair: Pos[] = [
      { latitude: 10.0, longitude: 20.0 },
      { latitude: 10.006, longitude: 20.0 },
    ];
    expect(clusterPositions(pair, 100)).toHaveLength(1);
    expect(clusterPositions(pair, 500)).toHaveLength(2);
  });
});

describe('centroid', () => {
  it('falls back to San Francisco for an empty cluster set', () => {
    expect(centroid([])).toEqual([37.7749, -122.4194]);
  });

  it('averages the cluster centres', () => {
    const pts: ClusterPoint[] = [
      { lat: 10, lon: 20, count: 1, intensity: 1 },
      { lat: 30, lon: 40, count: 1, intensity: 1 },
    ];
    expect(centroid(pts)).toEqual([20, 30]);
  });
});

describe('intensityColor', () => {
  it('maps the cool (0) and hot (1) extremes to distinct RGBA strings', () => {
    expect(intensityColor(0)).toBe('rgba(20,184,166,0.35)');
    expect(intensityColor(1)).toMatch(/^rgba\(245,64,226,/);
    expect(intensityColor(0)).not.toBe(intensityColor(1));
  });

  it('increases opacity monotonically with intensity', () => {
    const alpha = (s: string) => Number(s.slice(s.lastIndexOf(',') + 1, -1));
    expect(alpha(intensityColor(0))).toBeLessThan(alpha(intensityColor(0.5)));
    expect(alpha(intensityColor(0.5))).toBeLessThan(alpha(intensityColor(1)));
  });

  it('clamps out-of-range intensities into gamut (0..1)', () => {
    expect(intensityColor(-5)).toBe(intensityColor(0));
    expect(intensityColor(9)).toBe(intensityColor(1));
  });
});

/* ── Component — standard layout ──────────────────────────────────── */

describe('PositionHeatmapWidget — standard layout', () => {
  it('renders the titled shell, one marker per cluster, and centres on the centroid', () => {
    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Position Heatmap')).toBeInTheDocument();

    const clusters = clusterPositions(POSITIONS, 500);
    expect(screen.getAllByTestId('marker')).toHaveLength(clusters.length);

    expect(captured.map).not.toBeNull();
    expect(captured.map?.center).toEqual(centroid(clusters));
    expect(captured.map?.zoom).toBe(11);
    expect(captured.map?.scrollWheelZoom).toBe(true);

    // No 'wide' positions badge at 2 cols.
    expect(screen.queryByText(/\bpositions\b/)).not.toBeInTheDocument();
  });

  it('encodes density: the hot bucket is larger and a different colour than the sparse one', () => {
    renderWidget({ cols: 2, rows: 2 });

    // dense intensity 1 → 6 + 1*10 = 16; sparse intensity ⅓ → ~9.33.
    expect(Math.max(...radii())).toBeCloseTo(16, 5);
    expect(Math.min(...radii())).toBeLessThan(Math.max(...radii()));

    const colors = new Set(captured.markers.map((m) => m.fillColor));
    expect(colors.size).toBe(2);
    expect(captured.markers.some((m) => m.fillColor === intensityColor(1))).toBe(true);
  });
});

/* ── Component — wide layout ──────────────────────────────────────── */

describe('PositionHeatmapWidget — wide layout', () => {
  it('shows the raw-count badge and uses the wider radius + zoom', () => {
    renderWidget({ cols: 3, rows: 2 });

    // Badge reflects the RAW fix count (4), not the cluster count (2).
    expect(screen.getByText('4 positions')).toBeInTheDocument();
    expect(captured.map?.zoom).toBe(12);
    // dense intensity 1 → 6 + 1*14 = 20 (wider than the standard 16).
    expect(Math.max(...radii())).toBeCloseTo(20, 5);
  });

  it('hides the badge and shows the empty state when there are no positions', () => {
    positionsMock.mockReturnValue(makeQuery({ data: [] }));
    renderWidget({ cols: 3, rows: 2 });

    expect(screen.queryByText(/\bpositions\b/)).not.toBeInTheDocument();
    expect(screen.getByText('No position data')).toBeInTheDocument();
    expect(screen.queryByTestId('marker')).not.toBeInTheDocument();
  });
});

/* ── Component — compact layout ───────────────────────────────────── */

describe('PositionHeatmapWidget — compact layout', () => {
  it('drops the title + badge and renders a static, coarser-grid map', () => {
    renderWidget({ cols: 1, rows: 2 });

    expect(screen.queryByText('Position Heatmap')).not.toBeInTheDocument();
    expect(screen.queryByText(/\bpositions\b/)).not.toBeInTheDocument();

    expect(screen.getAllByTestId('marker')).toHaveLength(2);
    expect(captured.map?.zoom).toBe(11);
    // Compact map is non-interactive.
    expect(captured.map?.scrollWheelZoom).toBe(false);
    // Compact radius scale: dense intensity 1 → 4 + 1*6 = 10.
    expect(Math.max(...radii())).toBeCloseTo(10, 5);
  });
});

/* ── Component — data states ──────────────────────────────────────── */

describe('PositionHeatmapWidget — data states', () => {
  it('renders a skeleton while loading and never mounts the map', () => {
    positionsMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('Position Heatmap')).not.toBeInTheDocument();
    expect(screen.queryByTestId('marker')).not.toBeInTheDocument();
    expect(captured.map).toBeNull();
  });

  it('shows the empty state (never a blank panel) when there are no positions', () => {
    positionsMock.mockReturnValue(makeQuery({ data: [] }));
    renderWidget();

    expect(screen.getByText('No position data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('marker')).not.toBeInTheDocument();
    expect(captured.map).toBeNull();
  });

  it('shows the empty state when every fix is null-island (0,0)', () => {
    positionsMock.mockReturnValue(
      makeQuery({
        data: [
          { latitude: 0, longitude: 0 },
          { latitude: 0, longitude: 0 },
        ],
      }),
    );
    renderWidget();

    expect(screen.getByText('No position data')).toBeInTheDocument();
    expect(screen.queryByTestId('marker')).not.toBeInTheDocument();
  });

  it('surfaces the error panel — not the empty state — when the fetch fails', () => {
    // Regression guard for the error-masquerade bug: the widget now forwards
    // `error`, so a failure renders <QueryError> instead of "No position data".
    positionsMock.mockReturnValue(
      makeQuery({ isError: true, error: new Error('boom'), data: undefined, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The misleading empty state / titled shell must NOT appear on error.
    expect(screen.queryByText('No position data')).not.toBeInTheDocument();
    expect(screen.queryByText('Position Heatmap')).not.toBeInTheDocument();
    expect(screen.queryByTestId('marker')).not.toBeInTheDocument();
  });

  it('is null-safe: a fix at (0,0) is skipped while its valid siblings still cluster', () => {
    positionsMock.mockReturnValue(
      makeQuery({
        data: [
          { latitude: 0, longitude: 0 },
          { latitude: 40.0, longitude: -74.0 },
        ],
      }),
    );

    expect(() => renderWidget()).not.toThrow();
    // Only the valid New-York fix survives → exactly one marker.
    expect(screen.getAllByTestId('marker')).toHaveLength(1);
  });
});

/* ── Component — freshness + vehicle scoping ──────────────────────── */

describe('PositionHeatmapWidget — freshness + vehicle scoping', () => {
  it('refetches when the freshness refresh control is activated', () => {
    const q = makeQuery({ data: POSITIONS });
    positionsMock.mockReturnValue(q);
    renderWidget({ cols: 2, rows: 2 });

    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    expect(q.refetch).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('scopes the query to the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget();
    expect(positionsMock).toHaveBeenCalledWith(7);
  });

  it('prefers an explicit vehicleId prop over the vehicle list', () => {
    renderWidget({ cols: 2, rows: 2 }, 42);
    expect(positionsMock).toHaveBeenCalledWith(42);
  });

  it('falls back to id 0 (a disabled query) when there are no vehicles', () => {
    vehiclesMock.mockReturnValue({ data: [] });
    renderWidget();
    expect(positionsMock).toHaveBeenCalledWith(0);
  });
});
