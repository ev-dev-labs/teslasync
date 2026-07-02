import { useEffect, useId, useMemo, useRef } from 'react';
import { Layer, Source, type LayerProps } from 'react-map-gl/maplibre';
import maplibregl, {
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import type { Feature, FeatureCollection, Point } from 'geojson';
import { useMap } from './MapTileLayer';

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
   * Legacy Leaflet DivIcon-shaped renderer retained for external API
   * compatibility. The MapLibre implementation uses a count-based layer
   * palette instead of per-cluster HTML icons.
   */
  iconCreateFunction?: (count: number, children: ClusterPoint[]) => unknown;
  /** Default marker color when point.color is unset. Default '#22d3ee'. */
  defaultColor?: string;
  /** Marker click handler — receives the original point. */
  onMarkerClick?: (point: ClusterPoint) => void;
  /**
   * Legacy Leaflet colour hook retained for external API compatibility.
   * MapLibre cluster circles use the count-based palette below.
   */
  getClusterColor?: (children: ClusterPoint[]) => string;
}

type MarkerFeatureProperties = {
  id: string | number;
  color: string;
  ariaLabel: string;
  popupHtml: string;
  idx: number;
};

type MarkerFeature = Feature<Point, MarkerFeatureProperties>;

const MAX_POINTS = 5000;

function isValidCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '-');
}

function makeFeature(point: ClusterPoint, idx: number, defaultColor: string): MarkerFeature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [point.lng, point.lat],
    },
    properties: {
      id: point.id,
      color: point.color ?? defaultColor,
      ariaLabel: point.ariaLabel ?? '',
      popupHtml: point.popupHtml ?? '',
      idx,
    },
  };
}

function getFirstFeature(event: MapLayerMouseEvent): MapGeoJSONFeature | undefined {
  return event.features?.[0];
}

function getFeatureIndex(feature: MapGeoJSONFeature | undefined): number | null {
  const properties = feature?.properties as Partial<MarkerFeatureProperties> | null | undefined;
  const idx = properties?.idx;
  return typeof idx === 'number' && Number.isInteger(idx) ? idx : null;
}

function getClusterId(feature: MapGeoJSONFeature | undefined): number | null {
  const properties = feature?.properties as Record<string, unknown> | null | undefined;
  const clusterId = properties?.cluster_id;
  return typeof clusterId === 'number' ? clusterId : null;
}

function getPointCoordinates(feature: MapGeoJSONFeature | undefined): [number, number] | null {
  if (feature?.geometry.type !== 'Point') return null;
  const [lng, lat] = feature.geometry.coordinates;
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  return [lng, lat];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Clusters points with MapLibre-native GeoJSON clustering.
 *
 * Must be rendered as a child of the MapLibre `<MapContainer>`.
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
  const rawId = useId();
  const map = useMap();
  const mapRef = map.getMaplibreMap();
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const onMarkerClickRef = useRef<MarkerClusterProps['onMarkerClick']>(onMarkerClick);
  const legacyIconPropsRef = useRef({ iconCreateFunction, getClusterColor });

  const sourceId = useMemo(() => `marker-cluster-${sanitizeId(rawId)}`, [rawId]);
  const clusterLayerId = `${sourceId}-clusters`;
  const clusterCountLayerId = `${sourceId}-cluster-count`;
  const pointLayerId = `${sourceId}-points`;

  const safePoints = useMemo(
    () => (points ?? []).slice(0, MAX_POINTS).filter((point) => isValidCoordinate(point.lat, point.lng)),
    [points],
  );

  const featureCollection = useMemo<FeatureCollection<Point, MarkerFeatureProperties>>(
    () => ({
      type: 'FeatureCollection',
      features: safePoints.map((point, idx) => makeFeature(point, idx, defaultColor)),
    }),
    [defaultColor, safePoints],
  );

  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick;
  }, [onMarkerClick]);

  useEffect(() => {
    legacyIconPropsRef.current = { iconCreateFunction, getClusterColor };
  }, [iconCreateFunction, getClusterColor]);

  useEffect(() => {
    const rawMap = mapRef?.getMap();
    if (!rawMap) return undefined;

    const handleClusterClick = (event: MapLayerMouseEvent) => {
      const feature = getFirstFeature(event);
      const clusterId = getClusterId(feature);
      const coordinates = getPointCoordinates(feature);
      if (clusterId == null || coordinates == null) return;

      const source = rawMap.getSource(sourceId) as GeoJSONSource | undefined;
      source?.getClusterExpansionZoom(clusterId).then((zoom) => {
        rawMap.easeTo({ center: coordinates, zoom });
      });
    };

    const handlePointClick = (event: MapLayerMouseEvent) => {
      const feature = getFirstFeature(event);
      const idx = getFeatureIndex(feature);
      const point = idx == null ? undefined : safePoints[idx];
      if (!point) return;

      onMarkerClickRef.current?.(point);
      popupRef.current?.remove();
      popupRef.current = null;

      if (point.popupHtml) {
        const coordinates = getPointCoordinates(feature) ?? [point.lng, point.lat];
        popupRef.current = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
        })
          .setLngLat(coordinates)
          .setHTML(point.popupHtml)
          .addTo(rawMap);
      }
    };

    const setPointerCursor = () => {
      rawMap.getCanvas().style.cursor = 'pointer';
    };
    const resetCursor = () => {
      rawMap.getCanvas().style.cursor = '';
    };

    rawMap.on('click', clusterLayerId, handleClusterClick);
    rawMap.on('click', pointLayerId, handlePointClick);
    rawMap.on('mouseenter', clusterLayerId, setPointerCursor);
    rawMap.on('mouseenter', pointLayerId, setPointerCursor);
    rawMap.on('mouseleave', clusterLayerId, resetCursor);
    rawMap.on('mouseleave', pointLayerId, resetCursor);

    return () => {
      rawMap.off('click', clusterLayerId, handleClusterClick);
      rawMap.off('click', pointLayerId, handlePointClick);
      rawMap.off('mouseenter', clusterLayerId, setPointerCursor);
      rawMap.off('mouseenter', pointLayerId, setPointerCursor);
      rawMap.off('mouseleave', clusterLayerId, resetCursor);
      rawMap.off('mouseleave', pointLayerId, resetCursor);
      popupRef.current?.remove();
      popupRef.current = null;
    };
  }, [clusterLayerId, mapRef, pointLayerId, safePoints, sourceId]);

  const clusterLayer: LayerProps = {
    id: clusterLayerId,
    type: 'circle',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'step',
        ['get', 'point_count'],
        '#22d3ee',
        10,
        '#a855f7',
        25,
        '#fbbf24',
        100,
        '#f43f5e',
      ],
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 100, 28],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-stroke-opacity': 0.9,
    },
  };

  const clusterCountLayer: LayerProps = {
    id: clusterCountLayerId,
    type: 'symbol',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 12,
    },
    paint: {
      'text-color': '#0b1020',
    },
  };

  const pointLayer: LayerProps = {
    id: pointLayerId,
    type: 'circle',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['coalesce', ['get', 'color'], defaultColor],
      'circle-radius': 6,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-stroke-opacity': 0.9,
    },
  };

  return (
    <Source
      id={sourceId}
      type="geojson"
      cluster
      clusterRadius={maxClusterRadius}
      clusterMaxZoom={disableClusteringAtZoom}
      data={featureCollection}
    >
      <Layer {...clusterLayer} />
      <Layer {...clusterCountLayer} />
      <Layer {...pointLayer} />
    </Source>
  );
}
