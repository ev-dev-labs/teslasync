// Native parity port of
// web/src/features/dashboard/widgets/PositionHeatmapWidget.tsx.
//
// The web widget is a dashboard "Position Heatmap" tile. It resolves the target
// vehicle (vehicleId prop -> first useVehicles() row -> 0), polls that vehicle's
// recent positions (useVehiclePositions(id) -> /vehicles/{id}/positions), runs a
// grid-based density clustering over them, and renders — inside a <WidgetShell>,
// via the shared <WidgetMapView> Leaflet map — one translucent <CircleMarker> per
// cluster whose radius AND fill colour both encode the cluster's normalised 0-1
// density (cool teal -> hot rose). Grid precision is coarser for a 1-col compact
// tile (200) than for standard/wide (500); marker radius scales with intensity and
// the layout size; the map auto-centres on the cluster centroid (fallback SF).
// Compact (size.cols <= 1) renders a chrome-less, title-less map; standard/wide
// renders a titled shell (Map icon) and, when wide (cols >= 3) with positions, a
// neutral "{{count}} positions" Badge action. Empty (no clusters) shows the map's
// own "No position data" empty body. Query freshness (loading / fetching / stale /
// error / dataUpdatedAt) and a manual refetch feed the shell header.
//
// This native port preserves that contract 1:1 — the same useVehicles() +
// useVehiclePositions(id) calls + /vehicles + /vehicles/{id}/positions paths, the
// same id / safePositions / isCompact / isWide / precision / clusters / center /
// totalPositions / isEmpty / shellProps derivations, the byte-for-byte
// clusterPositions (bucket-by-rounded-lat/lon running-mean + max-count normalise),
// centroid (avg lat/lon, SF fallback) and intensityColor (the exact 20+i*225 /
// 184-i*120 / 166+i*60 RGB ramp + 0.35+i*0.55 alpha) helpers, the same per-cluster
// radius (compact 4+i*6; standard 6+i*(wide?14:10)) and fillOpacity (compact
// 0.4+i*0.5; standard 0.35+i*0.55), the same two render branches, and the same
// i18n keys + English defaults (incl. the {{count}} interpolation) — using React
// Native primitives, the existing native AppText + design tokens.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime -> inline useNativeTranslation() returns t(key, fallback?, params?) =
//     (fallback ?? key) with i18next-style {{name}} interpolation applied to the
//     default value, preserving every key + English default (the count branch
//     interpolates {{count}}).
//   - lucide-react Map (web L3): DOM SVG icon -> emoji/glyph stand-in (🗺), tinted
//     with the same text-neon-cyan intent (colors.accent).
//   - @/components/maps CircleMarker + (via WidgetMapView) MapContainer /
//     MapTileLayer (web L4, ./shared): react-leaflet + Leaflet are DOM/CSS-only
//     (the maps barrel even imports 'leaflet/dist/leaflet.css') and there is no
//     native map library in apps/native, so the tile map is reproduced as a
//     native-safe <WidgetMapView> density canvas: a fixed dark backdrop (#1a1a2e,
//     the web's inline map background) that projects each marker through the SAME
//     Web Mercator / EPSG:3857 math Leaflet uses, centred on `center` at `zoom`,
//     into an absolutely-positioned circular View (left/top = x-r / y-r, size 2r,
//     borderRadius r, backgroundColor = fillColor, opacity = fillOpacity — so the
//     effective alpha is the rgba alpha × fillOpacity, exactly as SVG fill +
//     fill-opacity compose). The ONLY genuinely-unavailable pieces are the raster
//     tile basemap imagery and pan/zoom/scroll interaction (compact disables them
//     on web anyway); both are reduced to the static dark canvas + documented here.
//   - @/components/ui Badge (web L5): reproduced as a native-safe neutral <Badge>
//     chip (surfaceRaised bg / border / textSecondary, rounded-full, sm padding).
//   - @/api/hooks/useVehicles useVehiclePositions / useVehicles (web L6): the
//     already-ported web-parity useVehicles hooks (same signatures + /vehicles and
//     /vehicles/{id}/positions paths + Position type).
//   - ./WidgetShell (web L7): reproduced as a native-safe <WidgetShell> — the
//     loading skeleton, error body, the 1500ms pulse-on-update glow, the inline
//     DataFreshness chip (its web Skeleton / QueryError / DataFreshness internals
//     reduced to native equivalents; dot-only compact when title-less), plus the
//     noPadding + actions slots this widget relies on.
//   - ./shared WidgetMapView (web L8): reproduced inline (see CircleMarker note).
//   - @/components/feedback EmptyState (web, via WidgetMapView): reproduced as a
//     native-safe centered muted message (web py-4 spacing).
//   - ./types WidgetProps (web L9): the dashboard widget types module is not yet
//     ported, so the consumed subset (WidgetSize { cols, rows } + WidgetProps) is
//     mirrored as local interfaces.

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {useVehiclePositions, useVehicles} from '../../../api/hooks/useVehicles';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  constants (web inline map background + WidgetShell pulse glow)      */
/* ------------------------------------------------------------------ */

const ICON_MAP = '\uD83D\uDDFA'; // 🗺 (lucide Map, web L3)
const MAP_BACKDROP = '#1a1a2e'; // web WidgetMapView inline background
const PULSE_GLOW = '#22c55e'; // web green-500 pulse-on-update shadow

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type TParams = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback?: string,
  params?: TParams,
) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallback, params) => {
      let result = fallback ?? key;
      if (params) {
        for (const name of Object.keys(params)) {
          result = result.replace(
            new RegExp(`{{\\s*${name}\\s*}}`, 'g'),
            String(params[name]),
          );
        }
      }
      return result;
    },
    [],
  );
}

/* ------------------------------------------------------------------ */
/*  ported: ./types WidgetProps (consumed subset of the web types)     */
/* ------------------------------------------------------------------ */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  ported clustering helpers (web L11-77 — pure, no DOM)              */
/* ------------------------------------------------------------------ */

interface ClusterPoint {
  lat: number;
  lon: number;
  count: number;
  /** Normalised density 0–1 */
  intensity: number;
}

/**
 * Grid-based density clustering: bucket positions by rounded lat/lon,
 * count visits per bucket, then normalise to 0–1 intensity.
 */
function clusterPositions(
  positions: {latitude: number; longitude: number}[],
  precision: number,
): ClusterPoint[] {
  const buckets = new Map<
    string,
    {lat: number; lon: number; count: number}
  >();

  for (const p of positions) {
    if (p.latitude === 0 && p.longitude === 0) {
      continue;
    }
    const key = `${(p.latitude * precision) | 0}:${(p.longitude * precision) | 0}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.lat =
        (existing.lat * existing.count + p.latitude) / (existing.count + 1);
      existing.lon =
        (existing.lon * existing.count + p.longitude) / (existing.count + 1);
      existing.count += 1;
    } else {
      buckets.set(key, {lat: p.latitude, lon: p.longitude, count: 1});
    }
  }

  let maxCount = 1;
  for (const b of buckets.values()) {
    if (b.count > maxCount) {
      maxCount = b.count;
    }
  }

  const result: ClusterPoint[] = [];
  for (const b of buckets.values()) {
    result.push({
      lat: b.lat,
      lon: b.lon,
      count: b.count,
      intensity: b.count / maxCount,
    });
  }
  return result;
}

function centroid(points: ClusterPoint[]): [number, number] {
  if (points.length === 0) {
    return [37.7749, -122.4194]; // fallback SF
  }
  let latSum = 0;
  let lonSum = 0;
  for (const p of points) {
    latSum += p.lat;
    lonSum += p.lon;
  }
  return [latSum / points.length, lonSum / points.length];
}

/** Map intensity (0–1) to an RGBA colour string (cool cyan → hot magenta) */
function intensityColor(intensity: number): string {
  // Low: teal-500 → Mid: amber-500 → High: rose-500
  const r = Math.round(20 + intensity * 225);
  const g = Math.round(184 - intensity * 120);
  const b = Math.round(166 + intensity * 60);
  return `rgba(${r},${g},${b},${0.35 + intensity * 0.55})`;
}

/* ------------------------------------------------------------------ */
/*  native-safe map projection (web @/components/maps Leaflet, web L4) */
/*  Same Web Mercator / EPSG:3857 math react-leaflet uses, so markers  */
/*  land relative to `center`/`zoom` exactly as on the web map.        */
/* ------------------------------------------------------------------ */

const TILE_SIZE = 256;

function projectMercator(
  lat: number,
  lon: number,
  zoom: number,
): {x: number; y: number} {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const clamped = Math.min(Math.max(sinLat, -0.9999), 0.9999);
  const y =
    (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * scale;
  return {x, y};
}

interface ProjectedPoint {
  x: number;
  y: number;
}

interface MapProjection {
  ready: boolean;
  project: (lat: number, lon: number) => ProjectedPoint | null;
}

const MapProjectionContext = createContext<MapProjection>({
  ready: false,
  project: () => null,
});

/* ------------------------------------------------------------------ */
/*  native CircleMarker (web @/components/maps CircleMarker)            */
/* ------------------------------------------------------------------ */

interface CircleMarkerProps {
  center: [number, number];
  radius: number;
  pathOptions: {color: string; fillColor: string; fillOpacity: number};
}

function CircleMarker({center, radius, pathOptions}: CircleMarkerProps) {
  const {project} = useContext(MapProjectionContext);
  const point = project(center[0], center[1]);
  if (!point) {
    return null;
  }
  return (
    <View
      pointerEvents="none"
      style={[
        styles.marker,
        {
          backgroundColor: pathOptions.fillColor,
          borderRadius: radius,
          height: radius * 2,
          left: point.x - radius,
          opacity: pathOptions.fillOpacity,
          top: point.y - radius,
          width: radius * 2,
        },
      ]}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetMapView (web ./shared/WidgetMapView)                  */
/* ------------------------------------------------------------------ */

interface WidgetMapViewProps {
  center: [number, number];
  zoom?: number;
  compact?: boolean;
  children?: ReactNode;
  emptyMessage?: string;
  isEmpty?: boolean;
}

function WidgetMapView({
  center,
  zoom = 13,
  compact = false,
  children,
  emptyMessage = 'No location data available',
  isEmpty = false,
}: WidgetMapViewProps) {
  const [box, setBox] = useState({width: 0, height: 0});

  const projection = useMemo<MapProjection>(() => {
    if (box.width <= 0 || box.height <= 0) {
      return {ready: false, project: () => null};
    }
    const centerPx = projectMercator(center[0], center[1], zoom);
    return {
      ready: true,
      project: (lat: number, lon: number) => {
        const p = projectMercator(lat, lon, zoom);
        return {
          x: box.width / 2 + (p.x - centerPx.x),
          y: box.height / 2 + (p.y - centerPx.y),
        };
      },
    };
  }, [center, zoom, box.width, box.height]);

  if (isEmpty) {
    return <EmptyState message={emptyMessage} />;
  }

  const onLayout = (e: LayoutChangeEvent) => {
    const {width, height} = e.nativeEvent.layout;
    setBox(prev =>
      prev.width === width && prev.height === height ? prev : {width, height},
    );
  };

  return (
    <View
      onLayout={onLayout}
      style={[styles.mapCanvas, compact ? styles.mapCanvasCompact : null]}>
      <MapProjectionContext.Provider value={projection}>
        {children}
      </MapProjectionContext.Provider>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native DataFreshness (web @/components/data-display, WidgetShell)   */
/* ------------------------------------------------------------------ */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_COLOR: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  fetching: colors.accent,
  stale: colors.warning,
  error: colors.danger,
};

const FRESHNESS_GLYPH: Record<FreshnessStatus, string> = {
  fresh: '\u25CF', // ● Wifi
  fetching: '\u21BB', // ↻ RefreshCw
  stale: '\u25CF', // ● Wifi
  error: '\u2715', // ✕ WifiOff
};

function relativeFreshness(ms: number, t: NativeTFunction): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  if (seconds < 604_800) {
    return `${Math.floor(seconds / 86_400)}d ago`;
  }
  return `${Math.floor(seconds / 604_800)}w ago`;
}

interface DataFreshnessProps {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: DataFreshnessProps) {
  const t = useNativeTranslation();
  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';
  const color = FRESHNESS_COLOR[status];
  const relativeTime =
    updatedAt && !isFetching
      ? relativeFreshness(updatedAt, t)
      : isFetching
        ? t('freshness.updating', 'updating…')
        : isError
          ? t('freshness.error', 'error')
          : '';

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => {
        if (!isFetching) {
          onRefresh?.();
        }
      }}
      style={styles.freshness}
      testID="data-freshness">
      <AppText
        importantForAccessibility="no-hide-descendants"
        style={[styles.freshnessGlyph, {color}]}>
        {FRESHNESS_GLYPH[status]}
      </AppText>
      {!compact && relativeTime ? (
        <AppText style={[styles.freshnessText, {color}]}>{relativeTime}</AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native Badge (web @/components/ui Badge — neutral, sm)             */
/* ------------------------------------------------------------------ */

function Badge({children}: {children: ReactNode}) {
  return (
    <View style={styles.badge}>
      <AppText numberOfLines={1} style={styles.badgeText}>
        {children}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)            */
/* ------------------------------------------------------------------ */

function EmptyState({message}: {message: string}) {
  return (
    <View style={styles.emptyState}>
      <AppText style={styles.emptyStateMessage}>{message}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetShell (web ./WidgetShell)                             */
/* ------------------------------------------------------------------ */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  noPadding?: boolean;
  actions?: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  noPadding,
  actions,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  // Pulse on data change (web L59-80).
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return <View style={styles.skeleton} testID="widget-skeleton" />;
  }
  if (error) {
    return (
      <View style={styles.errorWrap}>
        <AppText style={styles.errorText} tone="danger">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (web L91).
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated ? styles.shellPulse : null]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          <View style={styles.headerActions}>
            {freshnessEl}
            {actions}
          </View>
        </View>
      ) : (
        <>
          {freshnessEl ? (
            <View style={styles.freshnessOverlay}>{freshnessEl}</View>
          ) : null}
          {actions ? (
            <View style={styles.actionsRow}>{actions}</View>
          ) : null}
        </>
      )}
      <View
        style={
          noPadding
            ? styles.bodyFlush
            : [styles.body, !title ? styles.bodyTopPad : null]
        }>
        {children}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  PositionHeatmapWidget (web L79-194)                                */
/* ------------------------------------------------------------------ */

export default function PositionHeatmapWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data: positions,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehiclePositions(id);

  // web L94 derives safePositions = positions ?? [] inline per render; native
  // react-hooks/exhaustive-deps (error-level) flags that logical-expression as a
  // dep of the clusters useMemo, so it is wrapped in useMemo here (identical
  // contents — the only deviation from the verbatim web expression).
  const safePositions = useMemo(() => positions ?? [], [positions]);

  // Higher precision = finer grid; use coarser grid for compact
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const precision = isCompact ? 200 : 500;

  const clusters = useMemo(
    () => clusterPositions(safePositions, precision),
    [safePositions, precision],
  );

  const center = useMemo(() => centroid(clusters), [clusters]);

  const totalPositions = safePositions.length;
  const isEmpty = clusters.length === 0;

  const shellProps = {
    loading: isLoading,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  // ─── Compact layout (1-col) ───
  if (isCompact) {
    return (
      <WidgetShell {...shellProps} noPadding>
        <WidgetMapView
          center={center}
          compact
          emptyMessage={t('widget.positionHeatmap.noData', 'No position data')}
          isEmpty={isEmpty}
          zoom={11}>
          {/* marker-cluster:no heatmap — density visualization where intensity is encoded by circle radius and fill colour; clustering would collapse the spatial-density signal that is the entire purpose of this widget. */}
          {clusters.map((c, i) => (
            <CircleMarker
              center={[c.lat, c.lon]}
              key={i}
              pathOptions={{
                color: 'transparent',
                fillColor: intensityColor(c.intensity),
                fillOpacity: 0.4 + c.intensity * 0.5,
              }}
              radius={4 + c.intensity * 6}
            />
          ))}
        </WidgetMapView>
      </WidgetShell>
    );
  }

  // ─── Standard / Wide layout ───
  return (
    <WidgetShell
      {...shellProps}
      actions={
        isWide && totalPositions > 0 ? (
          <Badge>
            {t('widget.positionHeatmap.count', '{{count}} positions', {
              count: totalPositions,
            })}
          </Badge>
        ) : undefined
      }
      icon={<AppText style={styles.headerIcon}>{ICON_MAP}</AppText>}
      noPadding
      title={t('widget.positionHeatmap.title', 'Position Heatmap')}>
      <WidgetMapView
        center={center}
        emptyMessage={t('widget.positionHeatmap.noData', 'No position data')}
        isEmpty={isEmpty}
        zoom={isWide ? 12 : 11}>
        {/* marker-cluster:no heatmap — density visualization where intensity is encoded by circle radius and fill colour; clustering would collapse the spatial-density signal that is the entire purpose of this widget. */}
        {clusters.map((c, i) => (
          <CircleMarker
            center={[c.lat, c.lon]}
            key={i}
            pathOptions={{
              color: 'transparent',
              fillColor: intensityColor(c.intensity),
              fillOpacity: 0.35 + c.intensity * 0.55,
            }}
            radius={6 + c.intensity * (isWide ? 14 : 10)}
          />
        ))}
      </WidgetMapView>
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.md,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  body: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  bodyFlush: {
    overflow: 'hidden',
  },
  bodyTopPad: {
    paddingTop: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyStateMessage: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
  },
  errorWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    padding: spacing.md + 4,
  },
  freshness: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  freshnessGlyph: {
    fontSize: 10,
    lineHeight: 14,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.xs + 2,
    top: spacing.xs + 2,
    zIndex: 5,
  },
  freshnessText: {
    fontSize: 10,
    lineHeight: 14,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.md,
  },
  headerActions: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  headerIcon: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 16,
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    columnGap: spacing.xs + 2,
    flexDirection: 'row',
  },
  mapCanvas: {
    backgroundColor: MAP_BACKDROP,
    borderRadius: 8,
    minHeight: 200,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  mapCanvasCompact: {
    minHeight: 120,
  },
  marker: {
    position: 'absolute',
  },
  shell: {
    position: 'relative',
  },
  shellPulse: {
    elevation: 4,
    shadowColor: PULSE_GLOW,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    minHeight: 120,
  },
});
