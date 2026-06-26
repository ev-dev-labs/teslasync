// GeofenceWidget — native parity port of
// web/src/features/dashboard/widgets/GeofenceWidget.tsx.
//
// The dashboard "Geofence Status" widget. It resolves a vehicle from the
// explicit `vehicleId` prop, falling back to the first vehicle (`useVehicles`),
// reads that vehicle's live state (`GET /vehicles/{id}/state` via
// useVehicleState) for the current lat/lon, and loads every configured geofence
// (`GET /geofences` via useGeofences). For each fence it computes the haversine
// distance (metres) from the vehicle and an inside/outside flag, then renders
// one of two layouts, preserved verbatim from the web source:
//   1. Compact (size.cols <= 1) -> a centred Crosshair glyph over a single Badge
//      showing the current zone name (success) or "No zone" (neutral). The shell
//      header here uses the STATE-only freshness flags (web L122-127 spreads the
//      combined shellProps then overrides updatedAt/isFetching/isStale/isError/
//      onRefresh with the state query), preserved exactly.
//   2. Standard -> a titled shell. When the fence list is empty it shows an
//      EmptyState; otherwise an optional map section (only when hasCoords AND
//      size.rows >= 3) followed by a scrollable fence list. Each row shows the
//      fence name + "Radius: {display-distance}" and a trailing Badge: "Disabled"
//      (neutral) when !enabled, "Inside" (success, dotted) when inside, else
//      "Outside" (neutral).
// Every state name (vehicles, id, stateData/stateLoading/..., geofences/
// fenceLoading/..., isLoading/isFetching/isStale/isError/updatedAt/onRefresh,
// state, vLat, vLon, hasCoords, fences, currentZone, isCompact, isEmpty,
// showMap), API path, the haversine maths, the SI->display radius conversion,
// the number-format precision (1 fraction digit), the i18n key + English
// fallback for each label, and each render branch is preserved; all 232 source
// lines are mapped in the .parity.json sidecar.
//
// SI-floor (web unit-conversion contract): geofence radius and the vehicle
// latitude/longitude arrive in SI (metres / decimal degrees). haversineMeters
// works in metres; convertDistanceFromSI handles the metres->user-unit
// conversion only at the display boundary (radius label), exactly like web.
//
// Native adaptations vs. the web source (behaviour / state / keys preserved):
//   - react-i18next useTranslation('dashboard') (web L2/L44) -> the native
//     t(key, fallback) shim used across the parity tree (no i18n runtime in RN;
//     the namespace is accepted-and-ignored).
//   - lucide-react Crosshair (web L3) -> the native SemanticIcon 'target' glyph
//     (Crosshair is a reticle/target; lucide is browser-only). Rendered static.
//   - @/components/ui Badge (web L4) -> an inline native Badge supporting the two
//     variants this widget uses (success / neutral) plus the `dot` marker, per
//     the DoorWindowStatusWidget inline-Badge precedent.
//   - @/components/feedback EmptyState (web L5) -> an inline native EmptyState
//     (centred icon chip + muted message), per the ChargeStatusWidget precedent.
//   - @/components/maps Circle/Marker (web L6) + ./shared WidgetMapView (web L13)
//     -> Leaflet/react-leaflet has NO native equivalent and there is no map host
//     in the parity tree (conversion contract rule 7), so the live map is
//     surfaced as an explicit native-unavailable state: WidgetMapView renders a
//     dark map-tile-coloured placeholder centred on the vehicle's coordinates
//     with a glyph + "Live map unavailable" note, and Circle/Marker are
//     native-safe no-ops (the fence overlays the web map drew are conveyed by
//     the inside/outside Badges in the list below). The same showMap gating
//     (hasCoords && size.rows >= 3) and the full fences.map(...) -> Circle data
//     path are preserved for structural fidelity.
//   - @/api/hooks useGeofences / useVehicles / useVehicleState (web L7-8) ->
//     imported from their canonical converted native hooks — same query keys,
//     same /geofences + /vehicles + /vehicles/{id}/state paths, same fields.
//   - @/hooks/useUnits useUnits (web L9) -> an inline native useUnits that reads
//     the native useSettings (unit_of_length 'mi' -> 'mi', else 'km'); only
//     unitPrefs.distance is consumed, exactly like the web source.
//   - @/lib/numberFormat fmtNumber (web L10) -> ported inline (en-US
//     toLocaleString with the requested fraction digits).
//   - @/lib/unitConversion convertDistanceFromSI (web L11) -> ported inline
//     verbatim (metres / 1000 km, metres / 1609.344 mi, metres / 0.3048 ft).
//   - ./WidgetShell (web L12) -> reproduced self-contained (its own later
//     manifest entry): the browser-only DataFreshness/PinButton/HelpTooltip/
//     Skeleton/QueryError chrome becomes a native-safe freshness pill (relative
//     "updated" time + a refresh Pressable wired to onRefresh, with stale/error/
//     fetching markers), a dimmed skeleton box, and a `noPadding` body mode that
//     lets the map section sit flush, matching the web `noPadding` prop.
//   - ./types WidgetProps/WidgetSize (web L14) -> ported inline (the widget reads
//     vehicleId + size; config is accepted for source parity, like the web).
//
// No DOM / lucide / react-i18next / Recharts / Leaflet / old web-UI imports
// reach the native output — only react, react-native primitives, the canonical
// AppText + GlassPanel + SemanticIcon, the parity hooks, and theme tokens.

import React, {useMemo, type ReactNode} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {useGeofences} from '../../../api/hooks/useLocations';
import {useVehicles, useVehicleState} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';

// ── Ported widget types (web ./types WidgetProps / WidgetSize) ────────────────

/** Grid footprint in cols/rows (web `./types` WidgetSize). */
interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

/** Widget render props (web `./types` WidgetProps). `config` is accepted for
 *  source parity but, like the web source, this widget reads only `vehicleId`
 *  and `size`. */
interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

// ── Haversine distance in meters (web L16-30, ported verbatim) ────────────────

/** Haversine distance in meters between two lat/lon points */
function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Per-fence derived status (web L32-41 FenceStatus, ported verbatim) ────────

interface FenceStatus {
  id: string;
  name: string;
  radius: number;
  latitude: number;
  longitude: number;
  enabled: boolean;
  inside: boolean;
  distanceM: number;
}

// ── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return React.useCallback((_key, fallback) => fallback, []);
}

// ── Ported unit conversion (web @/lib/unitConversion convertDistanceFromSI) ───

type DistanceUnitPref = 'km' | 'mi' | 'ft';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

// ── Ported number format (web @/lib/numberFormat fmtNumber) ───────────────────

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

// ── Inline native useUnits (web @/hooks/useUnits) — reads native useSettings ──

interface UnitPrefsLite {
  distance: DistanceUnitPref;
}

function useUnits(): {unitPrefs: UnitPrefsLite} {
  const {data} = useSettings();
  const distance: DistanceUnitPref = data?.unit_of_length === 'mi' ? 'mi' : 'km';
  const unitPrefs = React.useMemo<UnitPrefsLite>(() => ({distance}), [distance]);
  return {unitPrefs};
}

// ── SemanticIcon glyph node (web lucide icon nodes) ──────────────────────────

/**
 * Renders a decorative glyph in the given color, replacing a web lucide
 * `<Icon className="…" />` node.
 */
function glyphNode(
  name: SemanticIconName,
  color: string,
  glyphStyle: StyleProp<TextStyle>,
): ReactNode {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[glyphStyle, {color}]}
      weight="bold">
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

// ── Inline native Badge (web @/components/ui Badge) ───────────────────────────

type BadgeVariant = 'success' | 'neutral';

/** Native Badge mirroring the web `<Badge variant size="sm" dot>` chip. Only the
 *  two variants this widget uses (success / neutral) are reproduced; `dot`
 *  renders a small current-colour dot before the label like the web source. */
function Badge({
  variant,
  dot,
  children,
}: {
  variant: BadgeVariant;
  dot?: boolean;
  children: string;
}) {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]}>
      {dot ? <View style={[styles.badgeDot, badgeDotStyles[variant]]} /> : null}
      <AppText style={[styles.badgeText, badgeTextStyles[variant]]}>
        {children}
      </AppText>
    </View>
  );
}

// ── Inline native EmptyState (web @/components/feedback EmptyState) ───────────

function EmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessible accessibilityLabel={message} style={styles.empty}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// ── Native-safe map (web @/components/maps Circle/Marker + ./shared
//    WidgetMapView). Leaflet/react-leaflet and the map host are browser-only and
//    unavailable here; the live map becomes an explicit unavailable state. ─────

interface CirclePathOptions {
  color?: string;
  fillColor?: string;
  fillOpacity?: number;
  weight?: number;
}

interface CircleProps {
  center: [number, number];
  radius: number;
  pathOptions?: CirclePathOptions;
}

/** Native-safe stand-in for the web Leaflet `<Circle>` fence overlay. There is
 *  no map host to draw on, so it renders nothing; the inside/outside status is
 *  conveyed by the per-fence Badges in the list below. */
function Circle(_props: CircleProps): null {
  return null;
}

interface MarkerProps {
  position: [number, number];
}

/** Native-safe stand-in for the web Leaflet `<Marker>` vehicle pin (no map host
 *  to position it on; the placeholder shows the vehicle coordinates instead). */
function Marker(_props: MarkerProps): null {
  return null;
}

interface WidgetMapViewProps {
  center: [number, number];
  zoom?: number;
  compact?: boolean;
  children?: ReactNode;
}

/** Native parity stand-in for the web ./shared WidgetMapView. With no Leaflet /
 *  map host (conversion contract rule 7) it renders a dark map-tile-coloured
 *  placeholder centred on the vehicle's coordinates — the explicit native
 *  unavailable state. `children` (the Circle/Marker overlays) are accepted for
 *  structural fidelity and render as native-safe no-ops. */
function WidgetMapView({center, children}: WidgetMapViewProps) {
  const [lat, lng] = center;
  return (
    <View
      accessibilityLabel={`Map centered on ${lat}, ${lng} — live map unavailable on native`}
      accessibilityRole="image"
      accessible
      style={styles.mapPlaceholder}>
      {glyphNode('map', colors.accent, styles.mapGlyph)}
      <AppText style={styles.mapCoords}>
        {`${lat.toFixed(4)}, ${lng.toFixed(4)}`}
      </AppText>
      <AppText style={styles.mapNote} tone="muted">
        Live map unavailable
      </AppText>
      {children}
    </View>
  );
}

// ── Inline native WidgetShell (web ./WidgetShell) ─────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Relative "updated" time: <1m "Just now", <60m "Xm ago", <24h "Xh ago",
 *  else the absolute date-time. */
function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return formatDateTime(isoStr);
}

/** Native-safe freshness pill: relative "updated" time + refresh affordance,
 *  reflecting the query's fetching/stale/error flags. Replaces the web
 *  DataFreshness chrome (which depends on browser-only timers/icons). */
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt: number;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
}) {
  let label: string;
  if (isError) label = 'Error';
  else if (isFetching) label = 'Updating…';
  else if (updatedAt > 0)
    label = formatRelativeTime(new Date(updatedAt).toISOString());
  else label = 'Never';

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={6}
      onPress={onRefresh}
      style={styles.freshness}>
      <AppText
        style={[
          styles.freshnessText,
          isError
            ? styles.freshnessError
            : isStale
              ? styles.freshnessStale
              : null,
        ]}>
        {label}
      </AppText>
      <AppText style={styles.refreshGlyph} weight="bold">
        {getSemanticIconDefinition('refresh').glyph}
      </AppText>
    </Pressable>
  );
}

function WidgetShell({
  title,
  icon,
  loading,
  noPadding,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  noPadding?: boolean;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  if (loading) {
    return <View accessibilityLabel="Loading" style={styles.skeleton} />;
  }

  return (
    <GlassPanel style={styles.shell}>
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleGroup}>
          {icon}
          {title ? <AppText style={styles.shellTitle}>{title}</AppText> : null}
        </View>
        <DataFreshness
          isError={isError ?? false}
          isFetching={isFetching ?? false}
          isStale={isStale ?? false}
          onRefresh={onRefresh}
          updatedAt={updatedAt ?? 0}
        />
      </View>
      <View style={[styles.shellBody, noPadding ? styles.shellBodyFlush : null]}>
        {children}
      </View>
    </GlassPanel>
  );
}

// ── Main widget (web L43-232) ────────────────────────────────────────────────

export default function GeofenceWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {unitPrefs} = useUnits();

  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data: stateData,
    isLoading: stateLoading,
    isFetching: stateFetching,
    isStale: stateStale,
    isError: stateIsError,
    dataUpdatedAt: stateUpdatedAt,
    refetch: stateRefetch,
  } = useVehicleState(id);

  const {
    data: geofences,
    isLoading: fenceLoading,
    isFetching: fenceFetching,
    isStale: fenceStale,
    isError: fenceIsError,
    dataUpdatedAt: fenceUpdatedAt,
    refetch: fenceRefetch,
  } = useGeofences();

  const isLoading = stateLoading || fenceLoading;
  const isFetching = stateFetching || fenceFetching;
  const isStale = stateStale || fenceStale;
  const isError = stateIsError || fenceIsError;
  const updatedAt = Math.max(stateUpdatedAt ?? 0, fenceUpdatedAt ?? 0);
  const onRefresh = () => {
    stateRefetch();
    fenceRefetch();
  };

  const stateValue = stateData?.state;
  const state =
    stateValue != null && typeof stateValue === 'object' ? stateValue : undefined;
  const vLat = state?.latitude ?? 0;
  const vLon = state?.longitude ?? 0;
  const hasCoords = vLat !== 0 || vLon !== 0;

  const fences: FenceStatus[] = useMemo(() => {
    const raw = geofences ?? [];
    return raw.map(g => {
      const dist = hasCoords
        ? haversineMeters(vLat, vLon, g.latitude, g.longitude)
        : Infinity;
      return {
        id: g.id,
        name: g.name ?? '—',
        radius: g.radius ?? 0,
        latitude: g.latitude,
        longitude: g.longitude,
        enabled: g.enabled ?? true,
        inside: dist <= (g.radius ?? 0),
        distanceM: dist,
      };
    });
  }, [geofences, vLat, vLon, hasCoords]);

  const currentZone = fences.find(f => f.inside && f.enabled);
  const isCompact = size.cols <= 1;
  const isEmpty = fences.length === 0;

  /** Convert radius (meters) to user-preferred distance and format */
  const fmtRadius = (meters: number): string =>
    `${fmtNumber(convertDistanceFromSI(meters, unitPrefs.distance), 1)} ${unitPrefs.distance}`;

  const shellProps = {
    loading: isLoading,
    updatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh,
  };

  // ─── Compact layout (1×2) ───
  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
        updatedAt={stateUpdatedAt}
        isFetching={stateFetching}
        isStale={stateStale}
        isError={stateIsError}
        onRefresh={() => stateRefetch()}>
        <View style={styles.compactBody}>
          {glyphNode('target', colors.accent, styles.compactGlyph)}
          {currentZone ? (
            <Badge variant="success">{currentZone.name}</Badge>
          ) : (
            <Badge variant="neutral">
              {t('widget.geofence.noZone', 'No zone')}
            </Badge>
          )}
        </View>
      </WidgetShell>
    );
  }

  // ─── Standard layout (2×4) ───
  const showMap = hasCoords && size.rows >= 3;

  return (
    <WidgetShell
      title={t('widget.geofence.title', 'Geofence Status')}
      icon={glyphNode('target', colors.accent, styles.titleGlyph)}
      noPadding={showMap}
      {...shellProps}>
      {isEmpty ? (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <EmptyState
          icon={glyphNode('target', colors.textMuted, styles.iconGlyph)}
          message={t('widget.geofence.noFences', 'No geofences configured')}
        />
      ) : (
        <View style={styles.standardBody}>
          {/* Map section */}
          {showMap && (
            <View style={styles.mapSection}>
              <WidgetMapView center={[vLat, vLon]} zoom={12} compact={false}>
                {fences.map(f => (
                  <Circle
                    key={f.id}
                    center={[f.latitude, f.longitude]}
                    radius={f.radius}
                    pathOptions={{
                      color: f.inside ? '#22c55e' : '#6b7280',
                      fillColor: f.inside ? '#22c55e' : '#6b7280',
                      fillOpacity: 0.15,
                      weight: 2,
                    }}
                  />
                ))}
                <Marker position={[vLat, vLon]} />
              </WidgetMapView>
            </View>
          )}

          {/* Fence list */}
          <ScrollView style={styles.listSection} contentContainerStyle={styles.list}>
            {fences.map(f => (
              <View
                key={f.id}
                style={[
                  styles.fenceRow,
                  f.inside && f.enabled
                    ? styles.fenceRowActive
                    : styles.fenceRowDefault,
                ]}>
                <View style={styles.fenceInfo}>
                  <AppText numberOfLines={1} style={styles.fenceName}>
                    {f.name}
                  </AppText>
                  <AppText style={styles.fenceRadius}>
                    {`${t('widget.geofence.radius', 'Radius')}: ${fmtRadius(f.radius)}`}
                  </AppText>
                </View>
                <View style={styles.fenceBadge}>
                  {!f.enabled ? (
                    <Badge variant="neutral">
                      {t('widget.geofence.disabled', 'Disabled')}
                    </Badge>
                  ) : f.inside ? (
                    <Badge dot variant="success">
                      {t('widget.geofence.inside', 'Inside')}
                    </Badge>
                  ) : (
                    <Badge variant="neutral">
                      {t('widget.geofence.outside', 'Outside')}
                    </Badge>
                  )}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  compactBody: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
    justifyContent: 'center',
    minHeight: 44,
  },
  compactGlyph: {
    fontSize: 18,
    letterSpacing: 0.2,
    lineHeight: 22,
    textAlign: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  fenceBadge: {
    flexShrink: 0,
  },
  fenceInfo: {
    flex: 1,
    minWidth: 0,
  },
  fenceName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  fenceRadius: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 1,
  },
  fenceRow: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  fenceRowActive: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderWidth: 1,
  },
  fenceRowDefault: {
    backgroundColor: colors.surfaceRaised,
  },
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessError: {
    color: colors.danger,
  },
  freshnessStale: {
    color: colors.warning,
  },
  freshnessText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  iconGlyph: {
    fontSize: 18,
    letterSpacing: 0.2,
    lineHeight: 22,
    textAlign: 'center',
  },
  list: {
    gap: 6,
  },
  listSection: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  mapCoords: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  mapGlyph: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
  },
  mapNote: {
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  mapPlaceholder: {
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    flex: 1,
    justifyContent: 'center',
    minHeight: 120,
  },
  mapSection: {
    flexShrink: 0,
    height: 160,
    minHeight: 120,
  },
  refreshGlyph: {
    color: colors.accent,
    fontSize: 10,
  },
  shell: {
    flex: 1,
    paddingVertical: 12,
  },
  shellBody: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 0,
    paddingHorizontal: 16,
  },
  shellBodyFlush: {
    justifyContent: 'flex-start',
    paddingHorizontal: 0,
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  shellTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  shellTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 24,
    flex: 1,
    minHeight: 120,
  },
  standardBody: {
    flex: 1,
    minHeight: 0,
  },
  titleGlyph: {
    fontSize: 13,
    lineHeight: 16,
    textAlign: 'center',
  },
});

const badgeVariantStyles = StyleSheet.create({
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
});

const badgeTextStyles = StyleSheet.create({
  neutral: {
    color: colors.textSecondary,
  },
  success: {
    color: colors.success,
  },
});

const badgeDotStyles = StyleSheet.create({
  neutral: {
    backgroundColor: colors.textSecondary,
  },
  success: {
    backgroundColor: colors.success,
  },
});
