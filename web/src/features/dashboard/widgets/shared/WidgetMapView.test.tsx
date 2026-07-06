/**
 * WidgetMapView — behaviour + hardening tests.
 *
 * WidgetMapView is the shared leaflet frame every dashboard map widget
 * (LocationMap / Geofence / PositionHeatmap) renders into. It owns three
 * responsibilities worth pinning down:
 *   1. wiring the leaflet options (center / zoom / interaction flags / dark
 *      tiles) and projecting its children (markers, circles) into the map;
 *   2. degrading to a shared <EmptyState> — never a blank panel — when the
 *      caller flags the source empty OR the coordinates are unusable;
 *   3. exposing the map as an accessible, labelled region.
 *
 * leaflet is not jsdom-friendly, so the `@/components/maps` barrel is mocked:
 * `MapContainer` becomes a passthrough that reflects its leaflet options onto
 * `data-*` attributes (so the wiring is inspectable) and renders its children,
 * while `MapTileLayer` records the requested tile style. The REAL <EmptyState>
 * is used so the empty-panel contract (role="status" + message) is exercised
 * for real. `react-i18next` is echo-mocked so the translated defaults resolve
 * to their English fallbacks and stay deterministic.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { type ReactNode } from 'react';

// i18n echo mock — returns the English fallback so the default empty message
// and the region's aria-label are deterministic strings to assert against.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// leaflet can't mount under jsdom, so the maps barrel is stubbed. MapContainer
// echoes its leaflet options onto data-* attributes and renders its children;
// MapTileLayer records the requested tile style.
vi.mock('@/components/maps', () => ({
  MapContainer: ({
    children,
    center,
    zoom,
    scrollWheelZoom,
    zoomControl,
    dragging,
    className,
  }: {
    children?: ReactNode;
    center?: [number, number];
    zoom?: number;
    scrollWheelZoom?: boolean;
    zoomControl?: boolean;
    dragging?: boolean;
    className?: string;
  }) => (
    <div
      data-testid="map-container"
      data-center={JSON.stringify(center)}
      data-zoom={String(zoom)}
      data-scrollwheel={String(scrollWheelZoom)}
      data-zoomcontrol={String(zoomControl)}
      data-dragging={String(dragging)}
      className={className}
    >
      {children}
    </div>
  ),
  MapTileLayer: ({ style }: { style?: string }) => (
    <div data-testid="map-tile-layer" data-style={style} />
  ),
}));

import { WidgetMapView } from './WidgetMapView';

afterEach(() => cleanup());

const CENTER: [number, number] = [37.7749, -122.4194];

describe('WidgetMapView — map rendering', () => {
  it('renders the leaflet map with the supplied center, zoom, dark tiles, and children', () => {
    render(
      <WidgetMapView center={CENTER} zoom={15}>
        <div data-testid="marker">pin</div>
      </WidgetMapView>,
    );

    const map = screen.getByTestId('map-container');
    expect(map).toBeInTheDocument();
    expect(map).toHaveAttribute('data-center', JSON.stringify(CENTER));
    expect(map).toHaveAttribute('data-zoom', '15');
    // Tiles are always the dark theme layer.
    expect(screen.getByTestId('map-tile-layer')).toHaveAttribute('data-style', 'dark');
    // Children are projected into the map, not dropped on the floor.
    expect(screen.getByTestId('marker')).toHaveTextContent('pin');
  });

  it('defaults the zoom to 13 when the prop is omitted', () => {
    render(<WidgetMapView center={CENTER} />);
    expect(screen.getByTestId('map-container')).toHaveAttribute('data-zoom', '13');
  });

  it('renders the map for the valid null-island origin [0, 0]', () => {
    // [0,0] is a finite, legal coordinate — only non-finite values are rejected,
    // so the origin must still paint a map rather than an empty state.
    render(<WidgetMapView center={[0, 0]} />);
    expect(screen.getByTestId('map-container')).toHaveAttribute('data-center', '[0,0]');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('WidgetMapView — accessibility & styling', () => {
  it('exposes the map as an accessible region and forwards className to the wrapper', () => {
    render(<WidgetMapView center={CENTER} className="custom-frame" />);

    const region = screen.getByRole('region', { name: 'Map' });
    expect(region).toBeInTheDocument();
    // The caller className merges with the base frame classes (via cn()).
    expect(region).toHaveClass('custom-frame');
    expect(region).toHaveClass('rounded-lg');
    // The region wraps the leaflet container.
    expect(region).toContainElement(screen.getByTestId('map-container'));
  });

  it('honours a custom ariaLabel on the region', () => {
    render(<WidgetMapView center={CENTER} ariaLabel="Vehicle location" />);
    expect(screen.getByRole('region', { name: 'Vehicle location' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Map' })).not.toBeInTheDocument();
  });
});

describe('WidgetMapView — interaction affordances', () => {
  it('enables scroll / zoom-control / drag by default (non-compact)', () => {
    render(<WidgetMapView center={CENTER} />);

    const map = screen.getByTestId('map-container');
    expect(map).toHaveAttribute('data-scrollwheel', 'true');
    expect(map).toHaveAttribute('data-zoomcontrol', 'true');
    expect(map).toHaveAttribute('data-dragging', 'true');
  });

  it('disables scroll / zoom-control / drag when compact', () => {
    render(<WidgetMapView center={CENTER} compact />);

    const map = screen.getByTestId('map-container');
    expect(map).toHaveAttribute('data-scrollwheel', 'false');
    expect(map).toHaveAttribute('data-zoomcontrol', 'false');
    expect(map).toHaveAttribute('data-dragging', 'false');
  });
});

describe('WidgetMapView — empty & invalid states', () => {
  it('renders the empty state (and no map) when isEmpty is set', () => {
    render(<WidgetMapView center={CENTER} isEmpty emptyMessage="Nothing here" />);

    expect(screen.getByRole('status')).toHaveTextContent('Nothing here');
    expect(screen.queryByTestId('map-container')).not.toBeInTheDocument();
    // The map region is not rendered in the empty branch.
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('falls back to the translated default message when isEmpty and no message is provided', () => {
    render(<WidgetMapView center={CENTER} isEmpty />);
    expect(screen.getByRole('status')).toHaveTextContent('No location data available');
  });

  it('shows the empty state instead of crashing when the center is non-finite (NaN)', () => {
    render(<WidgetMapView center={[Number.NaN, Number.NaN]} emptyMessage="Bad coords" />);

    expect(screen.queryByTestId('map-container')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Bad coords');
  });

  it('treats an Infinity coordinate as invalid and renders the empty state', () => {
    render(<WidgetMapView center={[Number.POSITIVE_INFINITY, 0]} />);

    expect(screen.queryByTestId('map-container')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('rejects a malformed center that is not a 2-tuple', () => {
    // Callers occasionally hand this component untyped data; a single-element
    // (or otherwise malformed) tuple must degrade gracefully, not crash leaflet.
    render(<WidgetMapView center={[1] as unknown as [number, number]} />);

    expect(screen.queryByTestId('map-container')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
