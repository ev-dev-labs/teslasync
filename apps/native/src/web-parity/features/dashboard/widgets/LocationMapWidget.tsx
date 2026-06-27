import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of web/src/features/dashboard/widgets/LocationMapWidget.tsx.
//
// The web widget is the dashboard "Vehicle Location Map" live tile. It resolves a
// vehicle id (`vehicleId` prop, else the first vehicle from `useVehicles()`),
// polls `useVehicleState(id)` (GET /api/v1/vehicles/{id}/state — preserved
// verbatim by the already-ported native hook) and renders, inside a
// `WidgetShell`, a `WidgetMapView` (a Leaflet map centered on the vehicle) that
// contains an `AnimatedMarker` at the vehicle position, plus a bottom-left status
// overlay with up to three chips: a "Last known position" chip (when the state is
// not live), a "Heading: N°" chip and a "lat, lng" coordinate chip (both only
// when the widget is expanded).
//
// Every state name (`vehicles`, `id`, `stateData`, `isLoading`, `isFetching`,
// `isStale`, `isError`, `dataUpdatedAt`, `refetch`, `state`, `isLive`,
// `hasCoords`, `heading`, `isCompact`, `isExpanded`, `lat`, `lng`), the
// `vehicleId ?? vehicles?.[0]?.id ?? 0` resolution, the
// `state != null && latitude !== 0 && longitude !== 0` coordinate guard, the
// `size.cols <= 1` compact gate, the `size.cols >= 3 || size.rows >= 3` expanded
// gate, the `isCompact ? 13 : 14` zoom, the `Math.round(heading)` /
// `lat.toFixed(4)` / `lng.toFixed(4)` formatting, and every `widget.locationMap.*`
// i18n key with its English fallback are preserved. Browser-only pieces are
// mapped to native-safe equivalents (documented in the parity sidecar):
//
//   - react-i18next `useTranslation('dashboard')` is not a native-parity
//     dependency; a local `useNativeTranslationFallback()` t() shim returns the
//     English fallback verbatim (same precedent as the ClimateStatusWidget /
//     ChargeStatusLiveWidget ports), so every key + copy is preserved.
//   - lucide-react `MapPin, Navigation` have no native icon dependency; per the
//     ClimateStatusWidget glyph precedent each becomes a decorative Unicode glyph
//     in an `AppText` with `importantForAccessibility="no"` (MapPin
//     '\u{1F4CD}', Navigation '\u{1F9ED}'). h-3.5 (14px) -> title icon fontSize
//     14; h-2.5 (10px) chip glyphs share the chip text size. `text-neon-cyan`
//     maps to the accent token (ClimateStatusWidget precedent).
//   - `AnimatedMarker` (@/components/maps, a Leaflet DivIcon: a pulsing color
//     circle with an inner white-bordered core + heading rotation) -> an inlined
//     native `AnimatedMarker` View — outer Animated pulse ring (opacity 0.3->0,
//     scale 0.8->1.8 over a 1.5s loop, the same `replay-pulse` cadence the web
//     CSS used) + inner white-bordered glowing core with the same optional
//     `rotate(${heading}deg)`. Identical to the RoutePlayback marker port. The
//     pulse honours reduced motion (AccessibilityInfo).
//   - `WidgetMapView` (./shared, a Leaflet `MapContainer` + dark `MapTileLayer`)
//     -> an inlined native `WidgetMapView`: an interactive tile map has no native
//     analogue, so it renders a dark map canvas (the web `#1a1a2e` backdrop) with
//     a faint grid and the marker centered (the web map centers on `center`, so
//     the marker sits at the canvas center); `isEmpty` -> an inlined
//     `WidgetEmptyState`. `zoom`/`scrollWheelZoom`/`dragging`/`zoomControl` have
//     no native tile analogue (`zoom` retained as `_zoom` for parity); `compact`
//     keeps meaning by shrinking the canvas; `center` drives the a11y label.
//   - `WidgetShell` (./WidgetShell) -> an inlined native WidgetShell on a
//     GlassPanel (loading -> centered Spinner, error -> centered danger text,
//     else an optional uppercase title row + a compact freshness dot/refresh
//     control; `noPadding` keeps the map edge-to-edge) — identical to the
//     ClimateStatusWidget port; web Skeleton/QueryError/DataFreshness mapped
//     accordingly. `WidgetProps` (./types) -> a local interface mirroring it
//     (WidgetSize {cols, rows}).

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useVehicles, useVehicleState} from '../../../api/hooks/useVehicles';
import {Spinner} from '../../../components/feedback/Spinner';

/* ─── local widget types (mirror ./types — not yet ported) ─────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── i18n fallback shim (web react-i18next is unavailable in native) ───────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/* ─── reduced-motion (web framer-motion prefers-reduced-motion) ─────────────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

/* ─── decorative glyphs (lucide-react stand-ins) ───────────────────────────── */

const ICON_MAP_PIN = '\u{1F4CD}'; // lucide MapPin
const ICON_NAVIGATION = '\u{1F9ED}'; // lucide Navigation
const GLYPH_REFRESH = '\u21BB';
const DEGREE = '\u00B0';

function GlyphLegacyUnused({glyph, style}: {glyph: string; style?: StyleProp<TextStyle>}) {
  return (
    <AppText allowFontScaling={false} importantForAccessibility="no" style={style}>
      {glyph}
    </AppText>
  );
}

/* ─── inlined AnimatedMarker (web @/components/maps AnimatedMarker) ─────────── */

interface AnimatedMarkerProps {
  heading?: number;
  color?: string;
  reduceMotion: boolean;
}

// Mirrors the web Leaflet DivIcon: a pulsing translucent ring + a white-bordered
// glowing core with the same optional heading rotation. The marker sits at the
// canvas center because the web map is centered on the marker position.
function AnimatedMarker({
  heading,
  color = '#00b4d8',
  reduceMotion,
}: AnimatedMarkerProps) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0);
      return;
    }
    pulse.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 750,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 750,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotion]);

  const pulseStyle = {
    opacity: pulse.interpolate({inputRange: [0, 1], outputRange: [0.3, 0]}),
    transform: [
      {scale: pulse.interpolate({inputRange: [0, 1], outputRange: [0.8, 1.8]})},
    ],
  };

  return (
    <View pointerEvents="none" style={styles.marker}>
      <Animated.View
        style={[styles.markerPulse, {backgroundColor: color}, pulseStyle]}
      />
      <View
        style={[
          styles.markerCore,
          {
            backgroundColor: color,
            shadowColor: color,
            transform: heading != null ? [{rotate: `${heading}deg`}] : undefined,
          },
        ]}
      />
    </View>
  );
}

/* ─── inlined EmptyState (web @/components/feedback EmptyState) ─────────────── */

function WidgetEmptyState({message}: {message: string}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── inlined WidgetMapView (web ./shared WidgetMapView) ────────────────────── */

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
  // No native tile analogue for Leaflet zoom; retained for source parity.
  zoom: _zoom,
  compact = false,
  children,
  emptyMessage = 'No location data available',
  isEmpty = false,
}: WidgetMapViewProps) {
  if (isEmpty) {
    return <WidgetEmptyState message={emptyMessage} />;
  }

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Vehicle location map centered at ${center[0].toFixed(
        4,
      )}, ${center[1].toFixed(4)}`}
      accessible
      style={[styles.mapCanvas, compact && styles.mapCanvasCompact]}>
      <View pointerEvents="none" style={styles.mapGridLayer}>
        {MAP_GRID_LINES.map(line => (
          <React.Fragment key={line}>
            <View
              style={[
                styles.mapGridLineVertical,
                {left: `${line}%` as DimensionValue},
              ]}
            />
            <View
              style={[
                styles.mapGridLineHorizontal,
                {top: `${line}%` as DimensionValue},
              ]}
            />
          </React.Fragment>
        ))}
      </View>
      {children}
    </View>
  );
}

const MAP_GRID_LINES = [25, 50, 75];

/* ─── inlined WidgetShell freshness control (web DataFreshness) ─────────────── */

interface WidgetFreshnessProps {
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetFreshness({
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetFreshnessProps) {
  let dotColor: string = colors.success;
  if (isError) {
    dotColor = colors.danger;
  } else if (isStale) {
    dotColor = colors.warning;
  } else if (isFetching) {
    dotColor = colors.accent;
  }

  const dot = <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />;

  if (!onRefresh) {
    return <View style={styles.freshnessRow}>{dot}</View>;
  }

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshnessRow}>
      {dot}
      <AppText importantForAccessibility="no" style={styles.freshnessGlyph}>
        {GLYPH_REFRESH}
      </AppText>
    </Pressable>
  );
}

/* ─── inlined WidgetShell (web WidgetShell.tsx) ─────────────────────────────── */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  noPadding?: boolean;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  noPadding,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
}: WidgetShellProps) {
  if (loading) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <Spinner size="sm" />
        </View>
      </GlassPanel>
    );
  }

  if (error) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <AppText style={styles.errorText} tone="danger">
            {error}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshness = showFreshness ? (
    <WidgetFreshness
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
    />
  ) : null;

  return (
    <GlassPanel style={styles.shell}>
      {title ? (
        <View style={styles.headerRow}>
          <View style={styles.headerTitleGroup}>
            {icon}
            <AppText style={styles.titleText} tone="muted">
              {title}
            </AppText>
          </View>
          {freshness}
        </View>
      ) : freshness ? (
        <View style={styles.freshnessOverlay}>{freshness}</View>
      ) : null}
      <View style={noPadding ? styles.bodyNoPadding : styles.body}>
        {children}
      </View>
    </GlassPanel>
  );
}

/* ─── the widget ───────────────────────────────────────────────────────────── */

export default function LocationMapWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const reduceMotion = useReduceMotion();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: stateData,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehicleState(id);
  // The native useVehicleState types `state` as `VehicleState | string`; the web
  // hook typed it loosely. A raw string state is narrowed to null here (a string
  // has no .latitude/.longitude/.heading, so hasCoords is false — there are no
  // coordinates to plot, which is the intended behaviour).
  const stateValue = stateData?.state;
  const state =
    stateValue != null && typeof stateValue === 'object' ? stateValue : null;
  const isLive = stateData?.live ?? false;

  const hasCoords =
    state != null && state.latitude !== 0 && state.longitude !== 0;
  const heading = state?.heading ?? undefined;
  const isCompact = size.cols <= 1;
  const isExpanded = size.cols >= 3 || size.rows >= 3;

  const lat = state?.latitude ?? 0;
  const lng = state?.longitude ?? 0;

  return (
    <WidgetShell
      title={
        isCompact ? undefined : t('widget.locationMap.title', 'Vehicle Location Map')
      }
      icon={isCompact ? undefined : <Glyph glyph={ICON_MAP_PIN} style={styles.titleIcon} />}
      loading={isLoading}
      noPadding
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      <View style={styles.mapWrapper}>
        <WidgetMapView
          center={[lat, lng]}
          zoom={isCompact ? 13 : 14}
          compact={isCompact}
          isEmpty={!hasCoords}
          emptyMessage={t('widget.locationMap.noData', 'No location data available')}>
          <AnimatedMarker heading={heading} reduceMotion={reduceMotion} />
        </WidgetMapView>

        {hasCoords && !isCompact && (
          <View pointerEvents="none" style={styles.statusOverlay}>
            {!isLive && (
              <View style={styles.statusChip}>
                <Glyph glyph={ICON_MAP_PIN} style={styles.lastKnownText} />
                <AppText style={styles.lastKnownText}>
                  {t('widget.locationMap.lastKnown', 'Last known position')}
                </AppText>
              </View>
            )}
            {isExpanded && heading != null && (
              <View style={styles.statusChip}>
                <Glyph glyph={ICON_NAVIGATION} style={styles.statusChipText} />
                <AppText style={styles.statusChipText}>
                  {`${t('widget.locationMap.heading', 'Heading')}: ${Math.round(
                    heading,
                  )}${DEGREE}`}
                </AppText>
              </View>
            )}
            {isExpanded && (
              <View style={styles.statusChip}>
                <AppText style={styles.statusChipText}>
                  {`${lat.toFixed(4)}, ${lng.toFixed(4)}`}
                </AppText>
              </View>
            )}
          </View>
        )}
      </View>
    </WidgetShell>
  );
}

LocationMapWidget.displayName = 'LocationMapWidget';

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  bodyNoPadding: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    padding: spacing.md,
  },
  emptyMessage: {
    fontSize: 14,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessGlyph: {
    color: colors.textMuted,
    fontSize: 13,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    zIndex: 5,
  },
  freshnessRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  headerTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  lastKnownText: {
    color: colors.warning,
    fontSize: 10,
    lineHeight: 14,
  },
  mapCanvas: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    flex: 1,
    minHeight: 180,
    overflow: 'hidden',
    position: 'relative',
  },
  mapCanvasCompact: {
    minHeight: 120,
  },
  mapGridLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  mapGridLineHorizontal: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    height: 1,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  mapGridLineVertical: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: 1,
  },
  mapWrapper: {
    flex: 1,
    position: 'relative',
  },
  marker: {
    height: 24,
    left: '50%',
    marginLeft: -12,
    marginTop: -12,
    position: 'absolute',
    top: '50%',
    width: 24,
  },
  markerCore: {
    borderColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 2,
    bottom: 4,
    elevation: 4,
    left: 4,
    position: 'absolute',
    right: 4,
    shadowOffset: {height: 0, width: 0},
    shadowOpacity: 0.9,
    shadowRadius: 8,
    top: 4,
  },
  markerPulse: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
  },
  shell: {
    borderRadius: 16,
    gap: spacing.xs,
    overflow: 'hidden',
    paddingVertical: spacing.sm,
  },
  statusChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  statusChipText: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
  },
  statusOverlay: {
    bottom: spacing.sm,
    flexDirection: 'column',
    gap: spacing.xs,
    left: spacing.sm,
    position: 'absolute',
    zIndex: 10,
  },
  titleIcon: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 16,
  },
  titleText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
