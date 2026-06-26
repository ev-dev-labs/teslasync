// Native parity port of web/src/features/driving/components/TripPlannerMap.tsx.
//
// TripPlannerMap renders the planned route on a map: a blue polyline stitched
// from the trip legs, a green origin marker, a red destination marker and blue
// charge-stop markers, each with a Leaflet Popup. When neither endpoint is set
// it shows an EmptyState hint instead.
//
// Web -> native mapping (contract rules 4, 5 & 7); every browser-only dependency
// is replaced with a React Native-safe equivalent and documented in the sidecar:
//   - react-leaflet `MapContainer`/`Polyline`/`Popup`/`CircleMarker` +
//     `MapTileLayer` and the `LatLngExpression` type (web L4-8, L64-126) ->
//     Leaflet renders to the DOM and has no native analogue, so the interactive
//     tile map is reimplemented as a static native "route canvas": all geo
//     points are fit-to-bounds projected with the shared apps/native
//     MapRouteSummary route helpers (getRouteBounds/projectRoutePoints/
//     getRouteSegments — the same primitive used by DriveRouteReplaySection),
//     the polyline becomes rotated segment Views (#3b82f6, weight 3, opacity 0.8
//     — web pathOptions preserved verbatim), and each CircleMarker becomes a
//     positioned dot in the web marker palette (origin #22c55e r8, destination
//     #ef4444 r8, charge stops #3b82f6 r7, fillOpacity 0.9 -> opacity 0.9). The
//     dark MapTileLayer (style="dark") maps to the dark canvas backdrop + faint
//     map grid; leaflet's `scrollWheelZoom` pan/zoom interactivity has no static
//     analogue and is intentionally dropped (documented). `LatLngExpression` is
//     mirrored locally as the `LatLng` [lat, lng] tuple type.
//   - Leaflet `Popup` hover/click bubbles are a DOM-only affordance with no
//     native equivalent, so their contents are surfaced as an always-visible
//     waypoint legend beneath the canvas — preserving every popup string
//     (origin/destination name, charge-stop name + SOC transition + duration)
//     that would otherwise be unreachable on native.
//   - `@/components/ui` GlassPanel (web L2, L61) -> native GlassPanel (overflow
//     hidden so the canvas corners clip, mirroring web p-0 overflow-hidden
//     rounded-xl).
//   - `@/components/feedback` EmptyState (web L3, L130) -> native EmptyState
//     (title + message); the web message is preserved verbatim as the message,
//     with a concise native-additive title (MapRouteSummary precedent).
//   - react-i18next `useTranslation` (web L9, L20) -> inline
//     useNativeTranslationFallback(): a stable (key, fallback) => fallback shim
//     (AddressInput precedent) so every t('key', 'English') keeps its English
//     default + translation-key intent. Keys preserved: tripPlanner.map.origin,
//     tripPlanner.map.destination, tripPlanner.map.empty.
//   - `@/types/driving` TripLocation/TripLeg/TripChargeStop (web L10) -> the
//     ported web-parity api/hooks/useDriving, which re-exports the same types.
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, or web UI components are
// imported — only react, react-native primitives, the shared native theme, the
// native GlassPanel/EmptyState/AppText, and the MapRouteSummary route helpers.

import React, {useCallback, useMemo, useState} from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type LayoutChangeEvent,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {
  getRouteBounds,
  getRouteSegments,
  projectRoutePoints,
  type RouteBounds,
  type RoutePoint,
} from '../../../../components/maps/MapRouteSummary';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import type {
  TripChargeStop,
  TripLeg,
  TripLocation,
} from '../../../api/hooks/useDriving';

// Native mirror of leaflet's `LatLngExpression` tuple form used by the web file.
type LatLng = [number, number];

interface TripPlannerMapProps {
  origin: TripLocation | null;
  destination: TripLocation | null;
  legs: TripLeg[];
  chargeStops: TripChargeStop[];
}

// web h-[400px]
const MAP_HEIGHT = 400;
// web fallback: geographic center of the contiguous US.
const US_CENTER: LatLng = [39.8283, -98.5795];
// Faint map-grid guide lines (percent positions), evoking MapTileLayer style="dark".
const GRID_LINES = [20, 40, 60, 80];

// web marker/route palette — preserved verbatim for visual parity. These are
// semantic marker colours (origin/destination/stop), not theme-token surfaces.
const ROUTE_COLOR = '#3b82f6';
const ORIGIN_COLOR = '#22c55e';
const DEST_COLOR = '#ef4444';
const STOP_COLOR = '#3b82f6';

const ORIGIN_RADIUS = 8; // web CircleMarker radius
const DEST_RADIUS = 8;
const STOP_RADIUS = 7;

/**
 * Inlined react-i18next fallback: returns the web English fallback verbatim so
 * each t('key', 'English') keeps its key + default copy (AddressInput precedent).
 */
function useNativeTranslationFallback(): (key: string, fallback: string) => string {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

export function TripPlannerMap({
  origin,
  destination,
  legs,
  chargeStops,
}: TripPlannerMapProps) {
  const t = useNativeTranslationFallback();

  const stops = useMemo<TripChargeStop[]>(() => chargeStops ?? [], [chargeStops]);

  // Build polyline from legs — ported verbatim from web.
  const polylinePoints = useMemo<LatLng[]>(() => {
    if ((legs ?? []).length === 0 && origin && destination) {
      return [
        [origin.lat, origin.lng],
        [destination.lat, destination.lng],
      ];
    }
    const points: LatLng[] = [];
    for (const leg of legs ?? []) {
      if (points.length === 0) {
        points.push([leg.from.lat, leg.from.lng]);
      }
      points.push([leg.to.lat, leg.to.lng]);
    }
    return points;
  }, [legs, origin, destination]);

  // Map center — ported verbatim from web.
  const center = useMemo<LatLng>(() => {
    if (origin && destination) {
      return [
        (origin.lat + destination.lat) / 2,
        (origin.lng + destination.lng) / 2,
      ];
    }
    if (origin) {
      return [origin.lat, origin.lng];
    }
    return US_CENTER; // center of US
  }, [origin, destination]);

  // Map zoom — ported verbatim from web.
  const zoom = useMemo(() => {
    if (!origin || !destination) {
      return 5;
    }
    const latDiff = Math.abs(origin.lat - destination.lat);
    const lngDiff = Math.abs(origin.lng - destination.lng);
    const maxDiff = Math.max(latDiff, lngDiff);
    if (maxDiff > 20) {
      return 4;
    }
    if (maxDiff > 10) {
      return 5;
    }
    if (maxDiff > 5) {
      return 6;
    }
    if (maxDiff > 2) {
      return 7;
    }
    return 9;
  }, [origin, destination]);

  const hasData = origin != null || destination != null;

  // Fit-to-bounds over every plotted point — the native analogue of leaflet's
  // center+zoom viewport framing.
  const bounds = useMemo<RouteBounds | null>(() => {
    const pts: RoutePoint[] = [];
    if (origin) {
      pts.push({latitude: origin.lat, longitude: origin.lng});
    }
    if (destination) {
      pts.push({latitude: destination.lat, longitude: destination.lng});
    }
    for (const stop of stops) {
      pts.push({latitude: stop.location.lat, longitude: stop.location.lng});
    }
    for (const [lat, lng] of polylinePoints) {
      pts.push({latitude: lat, longitude: lng});
    }
    return getRouteBounds(pts);
  }, [origin, destination, stops, polylinePoints]);

  const projectedRoute = useMemo(
    () =>
      bounds
        ? projectRoutePoints(
            polylinePoints.map(([lat, lng]) => ({latitude: lat, longitude: lng})),
            bounds,
          )
        : [],
    [bounds, polylinePoints],
  );

  const [plotSize, setPlotSize] = useState({width: 0, height: 0});
  const handlePlotLayout = useCallback((event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    setPlotSize(prev =>
      prev.width === width && prev.height === height ? prev : {width, height},
    );
  }, []);

  // web renders the polyline only when polylinePoints.length >= 2;
  // getRouteSegments already returns [] for fewer than two points.
  const routeSegments = useMemo(
    () => getRouteSegments(projectedRoute, plotSize.width, plotSize.height),
    [projectedRoute, plotSize.width, plotSize.height],
  );

  const projectMarker = useCallback(
    (loc: TripLocation): {x: number; y: number} | null => {
      if (!bounds) {
        return null;
      }
      const [point] = projectRoutePoints(
        [{latitude: loc.lat, longitude: loc.lng}],
        bounds,
      );
      return point ? {x: point.x, y: point.y} : null;
    },
    [bounds],
  );

  const originPos = origin ? projectMarker(origin) : null;
  const destPos = destination ? projectMarker(destination) : null;

  return (
    <GlassPanel style={styles.panel}>
      {hasData ? (
        <View>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${t(
              'tripPlanner.map.aria',
              'Trip route map',
            )} centered near ${center[0].toFixed(2)}, ${center[1].toFixed(
              2,
            )} at zoom ${zoom}`}
            style={styles.canvas}>
            <View pointerEvents="none" style={styles.gridLayer}>
              {GRID_LINES.map(line => (
                <React.Fragment key={line}>
                  <View
                    style={[
                      styles.gridLineVertical,
                      {left: `${line}%` as DimensionValue},
                    ]}
                  />
                  <View
                    style={[
                      styles.gridLineHorizontal,
                      {top: `${line}%` as DimensionValue},
                    ]}
                  />
                </React.Fragment>
              ))}
            </View>

            <View
              pointerEvents="none"
              style={styles.plot}
              onLayout={handlePlotLayout}>
              {/* Route polyline */}
              {routeSegments.map(segment => (
                <View
                  key={segment.id}
                  style={[
                    styles.routeSegment,
                    {
                      left: segment.left,
                      top: segment.top,
                      width: segment.width,
                      transform: [{rotate: `${segment.angleRad}rad`}],
                    },
                  ]}
                />
              ))}

              {/* Origin marker */}
              {originPos ? (
                <Marker color={ORIGIN_COLOR} pos={originPos} radius={ORIGIN_RADIUS} />
              ) : null}

              {/* Destination marker */}
              {destPos ? (
                <Marker color={DEST_COLOR} pos={destPos} radius={DEST_RADIUS} />
              ) : null}

              {/* Charge stop markers */}
              {/* no-cluster: trip-specific charge stops have low cardinality (typically <10); each is a unique semantic waypoint, so clustering would obscure the route narrative. */}
              {stops.map((stop, idx) => {
                const pos = projectMarker(stop.location);
                return pos ? (
                  <Marker
                    key={`stop-${idx}`}
                    color={STOP_COLOR}
                    pos={pos}
                    radius={STOP_RADIUS}
                  />
                ) : null;
              })}
            </View>
          </View>

          {/* Waypoint legend — native has no click Popups, so each marker's popup
              contents render as always-visible rows (origin -> stops -> destination). */}
          <View style={styles.legend}>
            {origin ? (
              <WaypointRow
                color={ORIGIN_COLOR}
                title={origin.name || t('tripPlanner.map.origin', 'Origin')}
              />
            ) : null}
            {stops.map((stop, idx) => (
              <WaypointRow
                key={`stop-${idx}`}
                color={STOP_COLOR}
                title={stop.name}
                detail={`${Math.round(stop.charge_from_soc)}% \u2192 ${Math.round(
                  stop.charge_to_soc,
                )}% (${Math.round(stop.charge_duration_s / 60)} min)`}
              />
            ))}
            {destination ? (
              <WaypointRow
                color={DEST_COLOR}
                title={
                  destination.name ||
                  t('tripPlanner.map.destination', 'Destination')
                }
              />
            ) : null}
          </View>
        </View>
      ) : (
        <View style={styles.emptyWrap}>
          {/* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available. */}
          <EmptyState
            title={t('tripPlanner.map.emptyTitle', 'No route yet')}
            message={t(
              'tripPlanner.map.empty',
              'Enter origin and destination to see the route',
            )}
          />
        </View>
      )}
    </GlassPanel>
  );
}

interface MarkerProps {
  pos: {x: number; y: number};
  color: string;
  radius: number;
}

function Marker({pos, color, radius}: MarkerProps) {
  const size = radius * 2;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.marker,
        {
          left: `${pos.x * 100}%` as DimensionValue,
          top: `${pos.y * 100}%` as DimensionValue,
          width: size,
          height: size,
          borderRadius: radius,
          marginLeft: -radius,
          marginTop: -radius,
          backgroundColor: color,
          borderColor: color,
        },
      ]}
    />
  );
}

interface WaypointRowProps {
  color: string;
  title: string;
  detail?: string;
}

function WaypointRow({color, title, detail}: WaypointRowProps) {
  return (
    <View style={styles.waypointRow}>
      <View style={[styles.waypointDot, {backgroundColor: color}]} />
      <View style={styles.waypointText}>
        <AppText variant="caption" weight="semibold">
          {title}
        </AppText>
        {detail ? (
          <AppText tone="muted" variant="caption">
            {detail}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    overflow: 'hidden',
  },
  canvas: {
    height: MAP_HEIGHT,
    position: 'relative',
    backgroundColor: '#0a1120',
    overflow: 'hidden',
  },
  gridLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  gridLineHorizontal: {
    position: 'absolute',
    right: 0,
    left: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  plot: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    left: spacing.lg,
  },
  routeSegment: {
    position: 'absolute',
    height: 3,
    borderRadius: 999,
    backgroundColor: ROUTE_COLOR,
    opacity: 0.8,
  },
  marker: {
    position: 'absolute',
    borderWidth: 2,
    opacity: 0.9,
  },
  legend: {
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    padding: spacing.md,
  },
  waypointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  waypointDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  waypointText: {
    flex: 1,
    minWidth: 0,
  },
  emptyWrap: {
    height: MAP_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
