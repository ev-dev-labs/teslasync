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
  /** Custom cluster icon renderer. */
  iconCreateFunction?: (count: number) => L.DivIcon;
  /** Default marker color when point.color is unset. Default '#22d3ee'. */
  defaultColor?: string;
  /** Marker click handler — receives the original point. */
  onMarkerClick?: (point: ClusterPoint) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Default cluster icon — glass-style bubble whose color reflects density.
 * Severity thresholds mirror the project's neon palette.
 */
function defaultIconCreate(count: number): L.DivIcon {
  let bg = 'rgba(34, 211, 238, 0.85)'; // cyan
  let glow = '#22d3ee';
  if (count >= 100) {
    bg = 'rgba(244, 63, 94, 0.85)'; // rose
    glow = '#f43f5e';
  } else if (count >= 25) {
    bg = 'rgba(251, 191, 36, 0.85)'; // amber
    glow = '#fbbf24';
  } else if (count >= 10) {
    bg = 'rgba(168, 85, 247, 0.85)'; // purple
    glow = '#a855f7';
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
  iconCreateFunction = defaultIconCreate,
  defaultColor = '#22d3ee',
  onMarkerClick,
}: MarkerClusterProps) {
  const map = useMap();
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);

  // Cap rendered markers at 5000 to avoid leaflet performance cliff.
  const safePoints = useMemo(() => points.slice(0, 5000), [points]);

  // Stable handler ref so the marker click closure doesn't churn on every render.
  const onMarkerClickRef = useRef<MarkerClusterProps['onMarkerClick']>(onMarkerClick);
  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick;
  }, [onMarkerClick]);

  useEffect(() => {
    const group = L.markerClusterGroup({
      maxClusterRadius,
      disableClusteringAtZoom,
      iconCreateFunction: (cluster) => iconCreateFunction(cluster.getChildCount()),
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
    // We intentionally don't depend on iconCreateFunction here — re-creating
    // the entire group on every render of a parent that passes an inline
    // function would be a perf cliff. The closure above captures the latest
    // values via `iconCreateFunction` reference at mount time. Consumers that
    // need a dynamic icon function should memoize it.
  }, [map, maxClusterRadius, disableClusteringAtZoom]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
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
      markers.push(marker);
    }
    group.addLayers(markers);
    return () => {
      group.clearLayers();
    };
  }, [safePoints, defaultColor]);

  return null;
}
