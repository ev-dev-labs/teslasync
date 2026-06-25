// Native parity port of web/src/components/maps/MarkerCluster.tsx.
//
// The web component is a `leaflet.markercluster` side-effect layer: it grabs
// the Leaflet map instance via react-leaflet `useMap()` and imperatively adds a
// `MarkerClusterGroup` of `L.DivIcon` dot markers, returning `null`. React
// Native has no Leaflet map, no DOM, no `useMap()` context, and no
// `L.DivIcon`/HTML rendering in this dependency set, so the interactive
// clustered map cannot be drawn. This native-safe port preserves:
//   - the public types (`ClusterPoint`, `MarkerClusterProps`);
//   - the cluster-density colour thresholds (>=100 rose, >=25 amber, >=10
//     purple, else cyan) and the `getClusterColor` / custom `iconCreateFunction`
//     precedence, ported into `defaultIconCreate`;
//   - the dot-marker styling intent, ported into `makeDotIcon`;
//   - the 5000-marker safety cap and the invalid-coordinate filtering
//     (non-number / NaN lat-lng are skipped);
//   - the marker click-forwarding wiring (`onMarkerClick` reads the latest
//     handler through a stable ref, so a future native map host can dispatch
//     presses without rebuilding the marker list);
//   - the `maxClusterRadius` / `disableClusteringAtZoom` configuration.
// The leaflet `L.DivIcon` return type is replaced by native-safe descriptor
// types (`ClusterIconDescriptor`, `DotIconDescriptor`) so callers' icon logic
// still runs and is exercised. Because the web layer is invisible (renders
// `null`), the native render is a visually-hidden accessible status node that
// states the explicit "interactive clustering unavailable on native" condition
// instead of drawing a panel, keeping the no-visible-output visual intent.

import React, {useEffect, useMemo, useRef} from 'react';
import {StyleSheet, View, type AccessibilityRole} from 'react-native';

import {AppText} from '../../../components/ui/AppText';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
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

/**
 * Native-safe replacement for the leaflet `L.DivIcon` returned by the web
 * cluster bubble. Captures the same visual intent (size, fill, glow, border,
 * count label, anchor) so a native map host can render an equivalent bubble.
 */
export interface ClusterIconDescriptor {
  /** Pixel width/height of the cluster bubble (web used 36x36). */
  size: number;
  /** Bubble background fill (CSS color). */
  background: string;
  /** Glow / box-shadow color (CSS color). */
  glow: string;
  /** Bubble border color. */
  borderColor: string;
  /** Color of the count label. */
  textColor: string;
  /** Count label rendered inside the bubble. */
  label: string;
  /** Icon anchor [x, y], preserved from the leaflet `iconAnchor`. */
  anchor: [number, number];
  /** className parity tag from the web `L.divIcon`. */
  className: string;
}

/**
 * Native-safe replacement for the leaflet `L.DivIcon` dot marker.
 */
export interface DotIconDescriptor {
  /** Pixel width/height of the dot (web used 16x16). */
  size: number;
  /** Dot fill (CSS color). */
  color: string;
  /** Dot border color. */
  borderColor: string;
  /** Glow / box-shadow color (CSS color, mirrors the dot fill). */
  glow: string;
  /** Icon anchor [x, y], preserved from the leaflet `iconAnchor`. */
  anchor: [number, number];
  /** Popup anchor [x, y], preserved from the leaflet `popupAnchor`. */
  popupAnchor: [number, number];
  /** className parity tag from the web `L.divIcon`. */
  className: string;
}

export interface MarkerClusterProps {
  /** Time-ordered or arbitrary points. Cluster grouping is automatic. */
  points: ClusterPoint[];
  /** Cluster pixel radius (default 50). */
  maxClusterRadius?: number;
  /** Disable clustering above this zoom level (default 18). */
  disableClusteringAtZoom?: number;
  /**
   * Custom cluster icon renderer. Receives the child count plus the
   * resolved `ClusterPoint` children that fell into this cluster, so
   * callers can build colour breakdowns, dominant-category logic, or
   * legend-aligned bubbles without re-deriving the points externally.
   * Native-safe: returns a `ClusterIconDescriptor` instead of an `L.DivIcon`.
   */
  iconCreateFunction?: (
    count: number,
    children: ClusterPoint[],
  ) => ClusterIconDescriptor;
  /** Default marker color when point.color is unset. Default '#22d3ee'. */
  defaultColor?: string;
  /** Marker click handler — receives the original point. */
  onMarkerClick?: (point: ClusterPoint) => void;
  /**
   * Optional override for the default cluster bubble's colour. Receives
   * the children that fell into this cluster and returns a CSS colour
   * (e.g. the dominant category's colour). When omitted, the default
   * count-based palette is used. Ignored if a custom
   * `iconCreateFunction` is provided.
   */
  getClusterColor?: (children: ClusterPoint[]) => string;
}

/** Validated marker built from a `ClusterPoint`, ready for a native map host. */
export interface NativeMarkerDescriptor {
  point: ClusterPoint;
  icon: DotIconDescriptor;
  popupHtml?: string;
  ariaLabel?: string;
  /** Forwards to the latest `onMarkerClick` with the original point. */
  onPress: () => void;
}

/** Summary of what the web layer would have added to the Leaflet map. */
export interface NativeMarkerClusterPlan {
  /** Renderable markers after coordinate filtering + the 5000 cap. */
  markerCount: number;
  /** Original point count before the 5000 cap. */
  cappedFrom: number;
  maxClusterRadius: number;
  disableClusteringAtZoom: number;
  /** Whole-set preview bubble, resolved with the same icon precedence. */
  clusterIcon: ClusterIconDescriptor;
}

/**
 * Documents which browser-only capabilities the web component relied on that
 * are unavailable in the native runtime.
 */
export const nativeMarkerClusterCapabilities = {
  leafletMapAvailable: false,
  markerClusterPluginAvailable: false,
  divIconHtmlAvailable: false,
  interactiveClusteringAvailable: false,
} as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

// Cap rendered markers at 5000 to avoid the leaflet performance cliff.
const MAX_RENDERED_MARKERS = 5000;
const DEFAULT_MARKER_COLOR = '#22d3ee';
const CLUSTER_BORDER_COLOR = 'rgba(255, 255, 255, 0.85)';
const CLUSTER_TEXT_COLOR = '#0b1020';
const DOT_BORDER_COLOR = 'rgba(255, 255, 255, 0.9)';

/**
 * Default cluster icon — glass-style bubble whose color reflects density.
 * Severity thresholds mirror the project's neon palette. When a caller
 * provides `getClusterColor` we use that colour instead of the count-based
 * palette so cluster bubbles can match the dominant child's category.
 */
export function defaultIconCreate(
  count: number,
  overrideColor?: string,
): ClusterIconDescriptor {
  let background: string;
  let glow: string;
  if (overrideColor) {
    background = overrideColor;
    glow = overrideColor;
  } else if (count >= 100) {
    background = 'rgba(244, 63, 94, 0.85)'; // rose
    glow = '#f43f5e';
  } else if (count >= 25) {
    background = 'rgba(251, 191, 36, 0.85)'; // amber
    glow = '#fbbf24';
  } else if (count >= 10) {
    background = 'rgba(168, 85, 247, 0.85)'; // purple
    glow = '#a855f7';
  } else {
    background = 'rgba(34, 211, 238, 0.85)'; // cyan
    glow = '#22d3ee';
  }
  return {
    anchor: [18, 18],
    background,
    borderColor: CLUSTER_BORDER_COLOR,
    className: 'teslasync-cluster',
    glow,
    label: String(count),
    size: 36,
    textColor: CLUSTER_TEXT_COLOR,
  };
}

export function makeDotIcon(color: string): DotIconDescriptor {
  return {
    anchor: [8, 8],
    borderColor: DOT_BORDER_COLOR,
    className: '',
    color,
    glow: color,
    popupAnchor: [0, -8],
    size: 16,
  };
}

function isRenderablePoint(point: ClusterPoint): boolean {
  if (typeof point.lat !== 'number' || typeof point.lng !== 'number') {
    return false;
  }
  if (Number.isNaN(point.lat) || Number.isNaN(point.lng)) {
    return false;
  }
  return true;
}

const summaryRole: AccessibilityRole = 'summary';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Native-safe parity of the web `MarkerCluster`.
 *
 * The web component clusters points on a Leaflet map via
 * `leaflet.markercluster`. There is no Leaflet map in the native runtime, so
 * this port validates + caps the points, resolves the dot/cluster icon
 * descriptors with the same precedence, wires marker presses to the latest
 * handler, and renders a visually-hidden accessible status node describing the
 * explicit unavailable state instead of drawing markers.
 */
export function MarkerCluster({
  points,
  maxClusterRadius = 50,
  disableClusteringAtZoom = 18,
  iconCreateFunction,
  defaultColor = DEFAULT_MARKER_COLOR,
  onMarkerClick,
  getClusterColor,
}: MarkerClusterProps) {
  // Stable handler refs so closures captured when markers are built always read
  // the latest props without rebuilding the marker list — mirrors the web
  // effect that keeps refs current so the newest functions take effect on the
  // next refresh rather than forcing a full cluster-group remount.
  const onMarkerClickRef =
    useRef<MarkerClusterProps['onMarkerClick']>(onMarkerClick);
  const iconCreateFunctionRef =
    useRef<MarkerClusterProps['iconCreateFunction']>(iconCreateFunction);
  const getClusterColorRef =
    useRef<MarkerClusterProps['getClusterColor']>(getClusterColor);
  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick;
  }, [onMarkerClick]);
  useEffect(() => {
    iconCreateFunctionRef.current = iconCreateFunction;
  }, [iconCreateFunction]);
  useEffect(() => {
    getClusterColorRef.current = getClusterColor;
  }, [getClusterColor]);

  const safePoints = useMemo(
    () =>
      Array.isArray(points) ? points.slice(0, MAX_RENDERED_MARKERS) : [],
    [points],
  );

  const markers = useMemo<NativeMarkerDescriptor[]>(() => {
    const built: NativeMarkerDescriptor[] = [];
    for (const point of safePoints) {
      if (!isRenderablePoint(point)) {
        continue;
      }
      built.push({
        ariaLabel: point.ariaLabel,
        icon: makeDotIcon(point.color ?? defaultColor),
        onPress: () => {
          onMarkerClickRef.current?.(point);
        },
        point,
        popupHtml: point.popupHtml,
      });
    }
    return built;
  }, [safePoints, defaultColor]);

  // Resolve a whole-set preview bubble using the same precedence the web
  // leaflet `iconCreateFunction` closure used: custom renderer first, then
  // `getClusterColor`, then the default count-based palette. Reads through the
  // refs above so the latest functions apply on the next data refresh.
  const plan = useMemo<NativeMarkerClusterPlan>(() => {
    const children = markers.map(marker => marker.point);
    const count = children.length;
    const custom = iconCreateFunctionRef.current;
    const clusterIcon = custom
      ? custom(count, children)
      : defaultIconCreate(count, getClusterColorRef.current?.(children));
    return {
      cappedFrom: Array.isArray(points) ? points.length : 0,
      clusterIcon,
      disableClusteringAtZoom,
      markerCount: count,
      maxClusterRadius,
    };
  }, [markers, points, maxClusterRadius, disableClusteringAtZoom]);

  const summary =
    plan.markerCount === 0
      ? 'No map markers to cluster'
      : `${plan.markerCount} map marker${
          plan.markerCount === 1 ? '' : 's'
        } ready to cluster; interactive map clustering is unavailable on native`;

  return (
    <View
      accessibilityLabel={summary}
      accessibilityRole={summaryRole}
      accessible
      importantForAccessibility="yes"
      style={styles.hidden}
      testID="marker-cluster">
      <AppText maxFontSizeMultiplier={1} numberOfLines={1}>
        {summary}
      </AppText>
    </View>
  );
}

MarkerCluster.displayName = 'MarkerCluster';

const styles = StyleSheet.create({
  hidden: {
    height: 1,
    left: 0,
    opacity: 0,
    overflow: 'hidden',
    position: 'absolute',
    top: 0,
    width: 1,
  },
});

export default MarkerCluster;
