import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import './leafletGlobal';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

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
   */
  iconCreateFunction?: (count: number, children: ClusterPoint[]) => L.DivIcon;
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Default cluster icon — glass-style bubble whose color reflects density.
 * Severity thresholds mirror the project's neon palette. When a caller
 * provides `getClusterColor` we use that colour instead of the count-based
 * palette so cluster bubbles can match the dominant child's category.
 */
function defaultIconCreate(count: number, overrideColor?: string): L.DivIcon {
  let bg: string;
  let glow: string;
  if (overrideColor) {
    bg = overrideColor;
    glow = overrideColor;
  } else if (count >= 100) {
    bg = 'rgba(244, 63, 94, 0.85)'; // rose
    glow = '#f43f5e';
  } else if (count >= 25) {
    bg = 'rgba(251, 191, 36, 0.85)'; // amber
    glow = '#fbbf24';
  } else if (count >= 10) {
    bg = 'rgba(168, 85, 247, 0.85)'; // purple
    glow = '#a855f7';
  } else {
    bg = 'rgba(34, 211, 238, 0.85)'; // cyan
    glow = '#22d3ee';
  }
  const html = `
    <div style="
      width:36px;height:36px;border-radius:9999px;
      display:flex;align-items:center;justify-content:center;
      background:${bg};
      border:2px solid rgba(255,255,255,0.85);
      color:#0b1020;font-weight:700;font-size:12px;
      box-shadow:0 0 12px ${glow};
      backdrop-filter:blur(4px);
    ">${count}</div>
  `;
  return L.divIcon({
    className: 'teslasync-cluster',
    html,
    iconSize: L.point(36, 36),
    iconAnchor: [18, 18],
  });
}

function makeDotIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
    html: `
      <div style="width:16px;height:16px;border-radius:50%;
        background:${color};border:2px solid rgba(255,255,255,0.9);
        box-shadow:0 0 6px ${color};"></div>
    `,
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Clusters a set of points using `leaflet.markercluster`.
 *
 * Must be rendered as a child of `<MapContainer>` (uses the leaflet map via
 * `useMap()`). Markers are added/removed declaratively when `points` change.
 */
export function MarkerCluster({
  points,
  maxClusterRadius = 50,
  disableClusteringAtZoom = 18,
  iconCreateFunction,
  defaultColor = '#22d3ee',
  onMarkerClick,
  getClusterColor,
}: MarkerClusterProps) {
  const map = useMap();
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);

  // Cap rendered markers at 5000 to avoid leaflet performance cliff.
  const safePoints = useMemo(() => points.slice(0, 5000), [points]);

  // Stable handler refs so closures captured at mount time always read the
  // latest props without forcing a costly cluster-group remount.
  const onMarkerClickRef = useRef<MarkerClusterProps['onMarkerClick']>(onMarkerClick);
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

  // Recover the original ClusterPoint that produced a given leaflet
  // Marker. Stored in a WeakMap so markers GC normally — leaflet plugins
  // sometimes attach random data to `marker.options`, so we keep our
  // metadata out-of-band rather than risk a key collision.
  const markerToPointRef = useRef<WeakMap<L.Marker, ClusterPoint>>(
    new WeakMap(),
  );

  useEffect(() => {
    const markerToPoint = markerToPointRef.current;
    const group = L.markerClusterGroup({
      maxClusterRadius,
      disableClusteringAtZoom,
      iconCreateFunction: (cluster) => {
        const childMarkers = cluster.getAllChildMarkers() as L.Marker[];
        const children: ClusterPoint[] = [];
        for (const m of childMarkers) {
          const p = markerToPoint.get(m);
          if (p) children.push(p);
        }
        const count = cluster.getChildCount();
        if (iconCreateFunctionRef.current) {
          return iconCreateFunctionRef.current(count, children);
        }
        const overrideColor = getClusterColorRef.current?.(children);
        return defaultIconCreate(count, overrideColor);
      },
      chunkedLoading: true,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      removeOutsideVisibleBounds: true,
    });
    groupRef.current = group;
    map.addLayer(group);
    return () => {
      map.removeLayer(group);
      groupRef.current = null;
    };
    // We intentionally don't depend on iconCreateFunction / getClusterColor
    // here — re-creating the entire group on every parent render would be
    // a perf cliff. The closure above reads through refs that are kept
    // current by the effects above, so the latest functions take effect on
    // the next cluster icon refresh without forcing a full group rebuild.
  }, [map, maxClusterRadius, disableClusteringAtZoom]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const markerToPoint = markerToPointRef.current;
    group.clearLayers();
    const markers: L.Marker[] = [];
    for (const p of safePoints) {
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
      if (Number.isNaN(p.lat) || Number.isNaN(p.lng)) continue;
      const marker = L.marker([p.lat, p.lng], {
        icon: makeDotIcon(p.color ?? defaultColor),
        ...(p.ariaLabel ? { alt: p.ariaLabel, title: p.ariaLabel } : {}),
        keyboard: true,
      });
      if (p.popupHtml) {
        marker.bindPopup(p.popupHtml);
      }
      marker.on('click', () => {
        onMarkerClickRef.current?.(p);
      });
      markerToPoint.set(marker, p);
      markers.push(marker);
    }
    group.addLayers(markers);
    return () => {
      group.clearLayers();
    };
  }, [safePoints, defaultColor]);

  return null;
}
