import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layer, Source } from 'react-map-gl/maplibre';
import type { Feature, Polygon } from 'geojson';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { Circle, Marker, useMap } from './MapTileLayer';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
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
  /** Existing geofences to render as read-only shapes (circles + polygons). */
  fences: DrawableGeofence[];
  /** Called when the user finishes drawing a new shape. */
  onCreate: (g: NewGeofence) => void;
  /** Restrict which shapes the user can draw. Default: ['circle']. */
  modes?: GeofenceMode[];
  /** Stroke / fill color for drawn shapes. Default '#22d3ee'. */
  color?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface LatLngPoint {
  lat: number;
  lng: number;
}

interface MapPointerEvent {
  lngLat: {
    lng: number;
    lat: number;
  };
}

interface DrawableCircleFence extends DrawableGeofence {
  lat: number;
  lng: number;
  radius: number;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isDrawableCircle = (fence: DrawableGeofence | null | undefined): fence is DrawableCircleFence =>
  isFiniteNumber(fence?.lat) &&
  isFiniteNumber(fence?.lng) &&
  isFiniteNumber(fence?.radius) &&
  fence.radius > 0;

const toPoint = (event: MapPointerEvent): LatLngPoint => ({
  lat: event.lngLat.lat,
  lng: event.lngLat.lng,
});

const haversineMetres = (a: LatLngPoint, b: LatLngPoint): number => {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

const centroid = (ring: Array<[number, number]>): [number, number] => {
  let lat = 0;
  let lng = 0;
  for (const [la, ln] of ring) {
    lat += la;
    lng += ln;
  }
  const n = ring.length || 1;
  return [lat / n, lng / n];
};

const sanitizeId = (id: string | number): string => String(id).replace(/[^A-Za-z0-9_-]/g, '-');

/** Read-only persisted polygon fence rendered as a MapLibre fill + outline. */
function PolygonFence({
  id,
  ring,
  color,
}: {
  id: string | number;
  ring: Array<[number, number]>;
  color: string;
}) {
  const coords: [number, number][] = ring.map(([la, ln]) => [ln, la]);
  const first = coords[0];
  if (first) coords.push([first[0], first[1]]);
  const uid = sanitizeId(id);
  const data: Feature<Polygon> = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
  return (
    <Source id={`ts-fence-poly-${uid}`} type="geojson" data={data}>
      <Layer id={`ts-fence-poly-fill-${uid}`} type="fill" paint={{ 'fill-color': color, 'fill-opacity': 0.15 }} />
      <Layer id={`ts-fence-poly-line-${uid}`} type="line" paint={{ 'line-color': color, 'line-width': 2 }} />
    </Source>
  );
}

/** Small on-map name chip for a fence (replaces the previous Leaflet tooltip). */
function FenceLabel({ position, name }: { position: [number, number]; name: string }) {
  return (
    <Marker
      position={position}
      icon={
        <span className="whitespace-nowrap rounded bg-[var(--surface-2)]/80 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm ring-1 ring-white/10">
          {name}
        </span>
      }
    />
  );
}

/**
 * Renders persisted geofence circles and provides a MapLibre click-to-draw
 * circle interaction when mounted inside the shared maps `<MapContainer>`.
 */
export function GeofenceDrawer({
  fences,
  onCreate,
  modes = ['circle'],
  color = '#22d3ee',
}: GeofenceDrawerProps) {
  const { t } = useTranslation();
  const map = useMap();
  const [isDrawing, setIsDrawing] = useState(false);
  const [center, setCenter] = useState<LatLngPoint | null>(null);
  const [pointer, setPointer] = useState<LatLngPoint | null>(null);
  const canDrawCircle = modes.includes('circle');

  const previewRadius = useMemo(() => {
    if (!center || !pointer) return 0;
    return haversineMetres(center, pointer);
  }, [center, pointer]);

  const stopDrawing = () => {
    setIsDrawing(false);
    setCenter(null);
    setPointer(null);
  };

  useEffect(() => {
    if (!isDrawing) return;
    const rawMap = map.getMaplibreMap()?.getMap();
    if (!rawMap) return;

    const canvas = rawMap.getCanvas();
    const previousCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';

    const handleClick = (event: MapPointerEvent) => {
      const point = toPoint(event);
      if (!center) {
        setCenter(point);
        setPointer(point);
        return;
      }
      const radius = haversineMetres(center, point);
      if (radius > 0) {
        onCreate({ shape: 'circle', lat: center.lat, lng: center.lng, radius });
      }
      stopDrawing();
    };

    const handleMouseMove = (event: MapPointerEvent) => {
      if (!center) return;
      setPointer(toPoint(event));
    };

    rawMap.on('click', handleClick);
    rawMap.on('mousemove', handleMouseMove);

    return () => {
      rawMap.off('click', handleClick);
      rawMap.off('mousemove', handleMouseMove);
      canvas.style.cursor = previousCursor;
    };
  }, [center, isDrawing, map, onCreate]);

  useEffect(() => {
    if (!isDrawing) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stopDrawing();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawing]);

  const handleToggleDrawing = () => {
    if (!canDrawCircle || isDrawing) {
      stopDrawing();
      return;
    }
    setIsDrawing(true);
    setCenter(null);
    setPointer(null);
  };

  return (
    <>
      {(fences ?? []).map((fence) => {
        if (isDrawableCircle(fence)) {
          return (
            <Fragment key={fence.id}>
              <Circle
                center={[fence.lat, fence.lng]}
                radius={fence.radius}
                color={color}
                weight={2}
                fillColor={color}
                fillOpacity={0.15}
              />
              {fence.name ? <FenceLabel position={[fence.lat, fence.lng]} name={fence.name} /> : null}
            </Fragment>
          );
        }
        if (Array.isArray(fence.polygon) && fence.polygon.length >= 3) {
          return (
            <Fragment key={fence.id}>
              <PolygonFence id={fence.id} ring={fence.polygon} color={color} />
              {fence.name ? <FenceLabel position={centroid(fence.polygon)} name={fence.name} /> : null}
            </Fragment>
          );
        }
        return null;
      })}
      {center && previewRadius > 0 ? (
        <Circle
          center={[center.lat, center.lng]}
          radius={previewRadius}
          color={color}
          weight={2}
          fillColor={color}
          fillOpacity={0.15}
        />
      ) : null}
      <div className="absolute right-3 top-3 z-[1000] pointer-events-auto">
        <Button
          type="button"
          variant={isDrawing ? 'secondary' : 'primary'}
          size="lg"
          aria-pressed={isDrawing}
          disabled={!canDrawCircle}
          onClick={handleToggleDrawing}
          className={cn(
            'min-h-[44px] shadow-lg focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
            isDrawing && 'bg-cyan-100 text-cyan-950 hover:bg-cyan-200 dark:bg-cyan-900 dark:text-cyan-50 dark:hover:bg-cyan-800',
          )}
        >
          {isDrawing
            ? t('maps.geofences.cancelDraw', 'Cancel drawing')
            : t('maps.geofences.drawGeofence', 'Draw geofence')}
        </Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Build a human-readable accessible description for a fence.
 * Used by callers that surface fences in non-visual UI (lists, screen readers).
 */
export function describeFence(f: DrawableGeofence): string {
  if (
    typeof f.lat === 'number' &&
    typeof f.lng === 'number' &&
    typeof f.radius === 'number'
  ) {
    const name = f.name ?? 'Geofence';
    return `${name} — ${f.radius.toFixed(0)}m circle around ${f.lat.toFixed(4)}, ${f.lng.toFixed(4)}`;
  }
  if (Array.isArray(f.polygon) && f.polygon.length >= 3) {
    const name = f.name ?? 'Geofence';
    return `${name} — ${f.polygon.length}-vertex polygon`;
  }
  return f.name ?? 'Geofence';
}
