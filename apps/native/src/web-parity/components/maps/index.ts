// Native parity port of web/src/components/maps/index.ts.
//
// The web maps module is built entirely on Leaflet + react-leaflet, which
// depend on the browser DOM/SVG and an HTML map container. None of that is
// available in React Native, so this barrel preserves the web public API while
// replacing every Leaflet/react-leaflet symbol and DOM-bound sibling component
// (MapLayerSwitcher, MapTileLayer, MapInvalidator, AnimatedMarker,
// MarkerCluster, GeofenceDrawer, RoutePlayback) with a React Native-safe
// primitive that renders an explicit "map unavailable" state. Pure, DOM-free
// logic — describeFence, latLngBounds math, vehicleIcon descriptors, and all
// geometry/data types — is ported faithfully so non-visual callers keep
// working unchanged. The web `import 'leaflet/dist/leaflet.css'` side-effect
// has no native equivalent and is intentionally omitted (see
// nativeMapsBarrelCapabilities.leafletCss).

import React, {type ReactNode} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  Geometry types (ported faithfully — pure data, no DOM)            */
/* ------------------------------------------------------------------ */

/** `[lat, lng]` tuple — native-safe equivalent of Leaflet's LatLngTuple. */
export type LatLngTuple = [number, number];

/** `{ lat, lng }` literal — native-safe equivalent of Leaflet's LatLngLiteral. */
export interface LatLngLiteral {
  lat: number;
  lng: number;
}

/**
 * Native-safe replacement for Leaflet's `LatLngExpression`. Mirrors the three
 * accepted shapes: a `{ lat, lng }` literal, a `[lat, lng]` tuple, or a
 * `[lat, lng, alt]` tuple.
 */
export type LatLngExpression =
  | LatLngLiteral
  | LatLngTuple
  | [number, number, number];

/** Tile style options offered by the web MapTileLayer. */
export type MapStyle = 'dark' | 'satellite' | 'streets' | 'terrain';

/**
 * Native-safe descriptor replacing Leaflet's `DivIcon`. The web icons render
 * pulsing HTML/CSS markers; native callers receive a plain descriptor that a
 * future native map renderer (or a list/legend) can interpret.
 */
export interface NativeMapIcon {
  /** Marker fill / glow color (CSS color string). */
  color: string;
  /** Discriminates the kind of marker the descriptor represents. */
  kind: 'vehicle' | 'cluster' | 'marker';
  /** Optional heading in degrees for directional markers. */
  heading?: number;
  /** Optional plain-text label content for the marker bubble. */
  label?: string;
  /** Optional pixel size of the marker. */
  size?: number;
}

/* ------------------------------------------------------------------ */
/*  MarkerCluster types                                                */
/* ------------------------------------------------------------------ */

export interface ClusterPoint {
  /** Stable identifier (used for React-side reconciliation only). */
  id: string | number;
  lat: number;
  lng: number;
  /** Optional HTML string rendered into the marker's bound popup. */
  popupHtml?: string;
  /** Override the default marker color (CSS color, e.g. '#22d3ee'). */
  color?: string;
  /** Optional plain-text label used for accessibility / aria-label. */
  ariaLabel?: string;
}

export interface MarkerClusterProps {
  /** Time-ordered or arbitrary points. Cluster grouping is automatic. */
  points: ClusterPoint[];
  /** Cluster pixel radius (default 50). */
  maxClusterRadius?: number;
  /** Disable clustering above this zoom level (default 18). */
  disableClusteringAtZoom?: number;
  /**
   * Custom cluster icon renderer. Receives the child count plus the resolved
   * `ClusterPoint` children that fell into this cluster. Returns a native icon
   * descriptor (the web variant returned a Leaflet `DivIcon`).
   */
  iconCreateFunction?: (count: number, children: ClusterPoint[]) => NativeMapIcon;
  /** Default marker color when point.color is unset. Default '#22d3ee'. */
  defaultColor?: string;
  /** Marker click handler — receives the original point. */
  onMarkerClick?: (point: ClusterPoint) => void;
  /**
   * Optional override for the default cluster bubble's colour. Receives the
   * children that fell into this cluster and returns a CSS colour.
   */
  getClusterColor?: (children: ClusterPoint[]) => string;
}

/* ------------------------------------------------------------------ */
/*  Geofence types + describeFence (pure logic, ported faithfully)    */
/* ------------------------------------------------------------------ */

/** Modes the drawer offers in its toolbar. */
export type GeofenceMode = 'circle' | 'polygon' | 'rectangle';

/** A drawn or persisted geofence — currently only circles are persisted. */
export interface DrawableGeofence {
  id: string | number;
  /** For circles. */
  lat?: number;
  lng?: number;
  /** Radius in meters (circles). */
  radius?: number;
  /** For polygons / rectangles. Ring of [lat, lng] tuples. */
  polygon?: Array<[number, number]>;
  name?: string;
}

/** New geometry produced by the drawer (no id yet). */
export interface NewGeofence {
  shape: 'circle' | 'polygon' | 'rectangle';
  lat?: number;
  lng?: number;
  radius?: number;
  polygon?: Array<[number, number]>;
}

export interface GeofenceDrawerProps {
  /** Existing geofences to render as editable shapes. */
  fences: DrawableGeofence[];
  /** Called when user finishes drawing a new shape. */
  onCreate: (g: NewGeofence) => void;
  /** Called when user edits an existing shape. */
  onEdit?: (id: string | number, g: NewGeofence) => void;
  /** Called when user deletes a shape via the on-map trash icon. */
  onDelete?: (id: string | number) => void;
  /** Restrict which shapes the user can draw. Default: ['circle']. */
  modes?: GeofenceMode[];
  /** Stroke / fill color for drawn shapes. Default '#22d3ee'. */
  color?: string;
}

/**
 * Human-readable summary of a geofence. Pure string formatting — ported
 * verbatim from the web GeofenceDrawer so callers render identical text.
 */
export function describeFence(f: DrawableGeofence): string {
  if (
    typeof f.lat === 'number' &&
    typeof f.lng === 'number' &&
    typeof f.radius === 'number'
  ) {
    const name = f.name ?? 'Geofence';
    return `${name} — ${f.radius.toFixed(0)}m circle around ${f.lat.toFixed(
      4,
    )}, ${f.lng.toFixed(4)}`;
  }
  if (Array.isArray(f.polygon) && f.polygon.length >= 3) {
    const name = f.name ?? 'Geofence';
    return `${name} — ${f.polygon.length}-vertex polygon`;
  }
  return f.name ?? 'Geofence';
}

/* ------------------------------------------------------------------ */
/*  RoutePlayback types                                                */
/* ------------------------------------------------------------------ */

export interface PlaybackPoint {
  lat: number;
  lng: number;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Optional metric values surfaced via onPositionChange. */
  speed?: number;
  soc?: number;
  power?: number;
}

export interface RoutePlaybackProps {
  /** Time-ordered GPS positions with timestamps and optional metrics. */
  points: PlaybackPoint[];
  /** Auto-play on mount. Default false. */
  autoPlay?: boolean;
  /** Callback fired when scrub position changes. */
  onPositionChange?: (point: PlaybackPoint, index: number) => void;
  /** Visible map height in CSS units. Default 400. */
  height?: number | string;
  /** Initial map style. Default 'dark'. */
  initialMapStyle?: MapStyle;
  /** Show the floating tile-layer switcher. Default true. */
  showLayerSwitcher?: boolean;
  /** Render the inline playback controls below the map. Default true. */
  showControls?: boolean;
  /** Trail polyline color. Default '#22d3ee'. */
  trailColor?: string;
  /** Animated marker color. Default '#00b4d8'. */
  markerColor?: string;
  /** aria-label for the map application landmark. */
  ariaLabel?: string;
  /** Optional className applied to the outer container. */
  className?: string;
  /** Empty-state message override when `points` is empty. */
  emptyMessage?: string;
}

/* ------------------------------------------------------------------ */
/*  Sibling component prop contracts (preserved for callers)          */
/* ------------------------------------------------------------------ */

export interface MapLayerSwitcherProps {
  current: MapStyle;
  onChange: (style: MapStyle) => void;
}

export interface MapTileLayerProps {
  style?: MapStyle;
}

export interface AnimatedMarkerProps {
  position: LatLngTuple;
  heading?: number;
  color?: string;
}

/* ------------------------------------------------------------------ */
/*  latLngBounds — native-safe pure geometry (no Leaflet)             */
/* ------------------------------------------------------------------ */

function toLatLng(expr: LatLngExpression): LatLngLiteral {
  if (Array.isArray(expr)) {
    return {lat: expr[0], lng: expr[1]};
  }
  return {lat: expr.lat, lng: expr.lng};
}

function isPointArray(
  value: LatLngExpression | LatLngExpression[],
): value is LatLngExpression[] {
  return Array.isArray(value) && (value.length === 0 || typeof value[0] !== 'number');
}

/**
 * Native-safe re-implementation of Leaflet's `LatLngBounds`. Holds the same
 * south-west / north-east corner semantics and exposes the read/query helpers
 * commonly used by map consumers, computed purely so non-visual callers
 * (bounds math, fit calculations) behave identically without the DOM.
 */
export class LatLngBounds {
  private southWest?: LatLngLiteral;
  private northEast?: LatLngLiteral;

  constructor(
    cornerOrPoints?: LatLngExpression | LatLngExpression[],
    corner2?: LatLngExpression,
  ) {
    if (cornerOrPoints == null) {
      return;
    }
    if (isPointArray(cornerOrPoints)) {
      for (const point of cornerOrPoints) {
        this.extend(point);
      }
      return;
    }
    this.extend(cornerOrPoints);
    if (corner2 != null) {
      this.extend(corner2);
    }
  }

  /** Grow the bounds to include `expr`. Mutates and returns `this`. */
  extend(expr: LatLngExpression): this {
    const {lat, lng} = toLatLng(expr);
    if (this.southWest == null || this.northEast == null) {
      this.southWest = {lat, lng};
      this.northEast = {lat, lng};
      return this;
    }
    this.southWest = {
      lat: Math.min(this.southWest.lat, lat),
      lng: Math.min(this.southWest.lng, lng),
    };
    this.northEast = {
      lat: Math.max(this.northEast.lat, lat),
      lng: Math.max(this.northEast.lng, lng),
    };
    return this;
  }

  /** Whether both corners have been set. */
  isValid(): boolean {
    return this.southWest != null && this.northEast != null;
  }

  getSouthWest(): LatLngLiteral {
    return this.southWest ?? {lat: 0, lng: 0};
  }

  getNorthEast(): LatLngLiteral {
    return this.northEast ?? {lat: 0, lng: 0};
  }

  getSouth(): number {
    return this.getSouthWest().lat;
  }

  getWest(): number {
    return this.getSouthWest().lng;
  }

  getNorth(): number {
    return this.getNorthEast().lat;
  }

  getEast(): number {
    return this.getNorthEast().lng;
  }

  getCenter(): LatLngLiteral {
    const sw = this.getSouthWest();
    const ne = this.getNorthEast();
    return {lat: (sw.lat + ne.lat) / 2, lng: (sw.lng + ne.lng) / 2};
  }

  /** Whether `expr` falls within the current bounds (inclusive). */
  contains(expr: LatLngExpression): boolean {
    if (!this.isValid()) {
      return false;
    }
    const {lat, lng} = toLatLng(expr);
    const sw = this.getSouthWest();
    const ne = this.getNorthEast();
    return lat >= sw.lat && lat <= ne.lat && lng >= sw.lng && lng <= ne.lng;
  }

  /** Returns a new bounds padded outward by `bufferRatio` on each axis. */
  pad(bufferRatio: number): LatLngBounds {
    if (!this.isValid()) {
      return new LatLngBounds();
    }
    const sw = this.getSouthWest();
    const ne = this.getNorthEast();
    const heightBuffer = Math.abs(sw.lat - ne.lat) * bufferRatio;
    const widthBuffer = Math.abs(sw.lng - ne.lng) * bufferRatio;
    return new LatLngBounds(
      [sw.lat - heightBuffer, sw.lng - widthBuffer],
      [ne.lat + heightBuffer, ne.lng + widthBuffer],
    );
  }

  /** `"west,south,east,north"` — mirrors Leaflet's toBBoxString. */
  toBBoxString(): string {
    return `${this.getWest()},${this.getSouth()},${this.getEast()},${this.getNorth()}`;
  }
}

/**
 * Factory mirroring Leaflet's `latLngBounds(...)`. Accepts either two corners
 * or an array of points and returns a native-safe {@link LatLngBounds}.
 */
export function latLngBounds(
  cornerOrPoints: LatLngExpression | LatLngExpression[],
  corner2?: LatLngExpression,
): LatLngBounds {
  return new LatLngBounds(cornerOrPoints, corner2);
}

/* ------------------------------------------------------------------ */
/*  vehicleIcon — native-safe descriptor (replaces Leaflet DivIcon)   */
/* ------------------------------------------------------------------ */

/**
 * Native-safe replacement for the web `vehicleIcon`. The web build returns a
 * pulsing HTML/CSS Leaflet `DivIcon`; native callers receive a plain
 * descriptor capturing the same color and footprint intent.
 */
export function vehicleIcon(color = '#00f0ff'): NativeMapIcon {
  return {color, kind: 'vehicle', size: 28};
}

/* ------------------------------------------------------------------ */
/*  useMap — native-safe stub map instance                            */
/* ------------------------------------------------------------------ */

/**
 * Native-safe subset of Leaflet's map instance API. Every method is a no-op
 * (chainable methods return the stub) so components written against `useMap()`
 * neither crash nor mutate a non-existent DOM map.
 */
export interface NativeLeafletMap {
  invalidateSize(): NativeLeafletMap;
  panTo(latlng: LatLngExpression, options?: unknown): NativeLeafletMap;
  setView(center: LatLngExpression, zoom?: number, options?: unknown): NativeLeafletMap;
  fitBounds(bounds: LatLngBounds, options?: unknown): NativeLeafletMap;
  getBounds(): LatLngBounds;
  getCenter(): LatLngLiteral;
  getZoom(): number;
  getContainer(): null;
  addLayer(layer: unknown): NativeLeafletMap;
  removeLayer(layer: unknown): NativeLeafletMap;
  on(): NativeLeafletMap;
  off(): NativeLeafletMap;
  remove(): void;
}

const NATIVE_MAP_STUB: NativeLeafletMap = {
  invalidateSize() {
    return NATIVE_MAP_STUB;
  },
  panTo() {
    return NATIVE_MAP_STUB;
  },
  setView() {
    return NATIVE_MAP_STUB;
  },
  fitBounds() {
    return NATIVE_MAP_STUB;
  },
  getBounds() {
    return new LatLngBounds();
  },
  getCenter() {
    return {lat: 0, lng: 0};
  },
  getZoom() {
    return 0;
  },
  getContainer() {
    return null;
  },
  addLayer() {
    return NATIVE_MAP_STUB;
  },
  removeLayer() {
    return NATIVE_MAP_STUB;
  },
  on() {
    return NATIVE_MAP_STUB;
  },
  off() {
    return NATIVE_MAP_STUB;
  },
  remove() {
    /* no-op: there is no native Leaflet map to tear down. */
  },
};

/** Native-safe replacement for react-leaflet's `useMap()` hook. */
export function useMap(): NativeLeafletMap {
  return NATIVE_MAP_STUB;
}

/* ------------------------------------------------------------------ */
/*  Capability flags + native-safe component primitives               */
/* ------------------------------------------------------------------ */

export const NATIVE_LEAFLET_UNAVAILABLE_REASON =
  'Leaflet and react-leaflet depend on the browser DOM/SVG and an HTML map container, which are unavailable in React Native parity components.' as const;

const NATIVE_MAP_PLACEHOLDER_MESSAGE =
  'Interactive map unavailable in the native build; route, marker, and geofence data is surfaced through native list/summary views instead.';

export const nativeMapsBarrelCapabilities = {
  leaflet: {available: false, reason: NATIVE_LEAFLET_UNAVAILABLE_REASON},
  reactLeaflet: {available: false, reason: NATIVE_LEAFLET_UNAVAILABLE_REASON},
  leafletCss: {
    available: false,
    reason:
      "leaflet/dist/leaflet.css is a browser stylesheet side-effect import with no React Native equivalent; native primitives provide their own styling.",
  },
  geometry: {
    available: true,
    reason:
      'describeFence, latLngBounds/LatLngBounds, vehicleIcon descriptors, and all geometry/data types are pure and ported faithfully.',
  },
} as const;

type NativeMapComponentKind = 'surface' | 'overlay' | 'leaf';

interface NativeMapComponentProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  height?: number | string;
  testID?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

/** Permissive prop bag for react-leaflet layer primitives. */
export interface NativeMapLeafProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  [key: string]: unknown;
}

/** Prop contract for the native-safe MapContainer surface. */
export interface MapContainerProps {
  children?: ReactNode;
  center?: LatLngExpression;
  zoom?: number;
  height?: number | string;
  style?: StyleProp<ViewStyle>;
  className?: string;
  testID?: string;
  'aria-label'?: string;
  [key: string]: unknown;
}

function resolveHeightStyle(
  height: number | string | undefined,
): StyleProp<ViewStyle> {
  if (typeof height === 'number') {
    return {minHeight: height};
  }
  return undefined;
}

function createUnavailableMapComponent<P extends object>(
  name: string,
  kind: NativeMapComponentKind,
): React.FC<P> {
  const NativeMapComponent: React.FC<P> = props => {
    const {
      children,
      style,
      height,
      testID,
      'aria-label': ariaLabel,
      'data-testid': dataTestID,
    } = props as NativeMapComponentProps;

    const accessibilityLabel =
      ariaLabel ?? `${name} unavailable. ${NATIVE_LEAFLET_UNAVAILABLE_REASON}`;
    const resolvedTestID = testID ?? dataTestID;

    if (kind === 'leaf') {
      return React.createElement(View, {
        accessibilityElementsHidden: true,
        accessibilityLabel,
        importantForAccessibility: 'no-hide-descendants',
        pointerEvents: 'none',
        style: styles.leaf,
        testID: resolvedTestID,
      });
    }

    if (kind === 'overlay') {
      return React.createElement(
        View,
        {
          accessibilityLabel,
          accessibilityRole: 'summary',
          style: [styles.overlay, style],
          testID: resolvedTestID,
        },
        React.createElement(
          AppText,
          {style: styles.title, variant: 'caption', weight: 'semibold'},
          name,
        ),
        React.createElement(
          AppText,
          {tone: 'muted', variant: 'caption'},
          NATIVE_MAP_PLACEHOLDER_MESSAGE,
        ),
      );
    }

    return React.createElement(
      View,
      {
        accessibilityLabel,
        accessibilityRole: 'summary',
        style: [styles.surface, resolveHeightStyle(height), style],
        testID: resolvedTestID,
      },
      React.createElement(
        AppText,
        {style: styles.title, variant: 'caption', weight: 'semibold'},
        name,
      ),
      React.createElement(
        AppText,
        {tone: 'muted', variant: 'caption'},
        NATIVE_MAP_PLACEHOLDER_MESSAGE,
      ),
      children,
    );
  };

  NativeMapComponent.displayName = name;
  return NativeMapComponent;
}

/* ── react-leaflet primitives (re-exported through the maps module). ─ */
export const MapContainer =
  createUnavailableMapComponent<MapContainerProps>('MapContainer', 'surface');
export const FeatureGroup =
  createUnavailableMapComponent<NativeMapLeafProps>('FeatureGroup', 'leaf');
export const Polyline =
  createUnavailableMapComponent<NativeMapLeafProps>('Polyline', 'leaf');
export const Marker =
  createUnavailableMapComponent<NativeMapLeafProps>('Marker', 'leaf');
export const Popup =
  createUnavailableMapComponent<NativeMapLeafProps>('Popup', 'leaf');
export const CircleMarker =
  createUnavailableMapComponent<NativeMapLeafProps>('CircleMarker', 'leaf');
export const Circle =
  createUnavailableMapComponent<NativeMapLeafProps>('Circle', 'leaf');
export const Rectangle =
  createUnavailableMapComponent<NativeMapLeafProps>('Rectangle', 'leaf');

/* ── Sibling map components (Leaflet/DOM-bound in web). ───────────── */
export const MapTileLayer =
  createUnavailableMapComponent<MapTileLayerProps>('MapTileLayer', 'leaf');
export const MapInvalidator =
  createUnavailableMapComponent<NativeMapLeafProps>('MapInvalidator', 'leaf');
export const AnimatedMarker =
  createUnavailableMapComponent<AnimatedMarkerProps>('AnimatedMarker', 'leaf');
export const GeofenceDrawer =
  createUnavailableMapComponent<GeofenceDrawerProps>('GeofenceDrawer', 'leaf');
export const MarkerCluster =
  createUnavailableMapComponent<MarkerClusterProps>('MarkerCluster', 'overlay');
export const MapLayerSwitcher = createUnavailableMapComponent<MapLayerSwitcherProps>(
  'MapLayerSwitcher',
  'overlay',
);
export const RoutePlayback =
  createUnavailableMapComponent<RoutePlaybackProps>('RoutePlayback', 'overlay');

const styles = StyleSheet.create({
  leaf: {
    height: 0,
    overflow: 'hidden',
    width: 0,
  },
  overlay: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.warningBorder,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 72,
    padding: spacing.md,
    width: '100%',
  },
  surface: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    minHeight: 160,
    overflow: 'hidden',
    padding: spacing.md,
    width: '100%',
  },
  title: {
    color: colors.warning,
  },
});
