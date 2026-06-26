// Native parity port of
// web/src/features/driving/components/drive-detail/RouteMapSection.tsx.
//
// The web module renders a Leaflet route map for a single drive: a
// <MapContainer> with <MapTileLayer>, a <MapLayerSwitcher>, speed-coloured
// <Polyline> segments, <CircleMarker>/<Popup> start/end/anchor markers, and an
// auto-fitting <FitBounds> sub-component, plus a stationary-GPS <AlertBanner>
// overlay, a start/end-time + speed-legend footer, and a "no route" empty state.
//
// react-leaflet (MapContainer/Polyline/CircleMarker/Popup/useMap), the leaflet
// runtime (latLngBounds/LatLngExpression), and the DOM <div>/<h3>/<span>/<br>,
// lucide-react icons and framer-motion are all browser/DOM-only, and there is no
// react-native-maps / leaflet in this native dependency set (rules 4/5/7). So
// the interactive raster map + polylines + popups cannot be reproduced. This
// port therefore:
//   • preserves the exported RouteMapSection + RouteMapSectionProps shape, the
//     `mapStyle`/`setMapStyle` state (MapStyle from the native MapTileLayer), and
//     the positionLatLngs/hasRoute/anchorIdx/anchorPoint useMemos VERBATIM,
//     inlining the @/lib/geo helpers (haversineDistance/isValidLatLng/
//     hasMeaningfulRoute/firstValidIndex + MIN_MEANINGFUL_ROUTE_METERS);
//   • preserves the FitBounds bounds/spread/fallback decision (both cluster
//     degeneracy special-cases) as a pure computeFitView() helper whose resolved
//     center+zoom is surfaced on the native preview instead of mutating a leaflet
//     map (which has no native analog);
//   • reuses the already-ported native <MapTileLayer style={mapStyle} /> for the
//     tile-preview surface, keeps an inline native MapLayerSwitcher (same 4
//     dark/satellite/streets/terrain layers + icons, driving the same state), and
//     renders the speed-segment polyline as a colour strip + the start/end/anchor
//     CircleMarkers (same #10b981/#ef4444/#22d3ee colours + Popup text) as a
//     marker list, so no segment/marker data is hidden;
//   • keeps the stationary-GPS AlertBanner (variant="info", Navigation2 icon ->
//     navigationAlt glyph, same title/body keys) as an overlay, the footer
//     start/end times + the four-step speed legend (SI thresholds converted via
//     the inlined convertSpeedFromSI to the user's speed unit), and the "no route
//     data" empty state, all VERBATIM;
//   • inlines react-i18next useTranslation (English-fallback t), @/hooks/useUnits
//     (speed pref from settings.unit_of_length), @/lib/unitConversion
//     convertSpeedFromSI, @/lib/numberFormat fmtNumber, and @/lib/dateFormat
//     formatTime/formatDateTime off the native useSettings query, matching the
//     self-contained native-parity convention used across this layer.
//
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-leaflet,
// react-dom, framer-motion, or web UI-kit modules are imported into the native
// output.

import React, {useCallback, useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {useSettings} from '../../../../api/hooks/useSettings';
import type {DriveDetail} from '../../../../api/hooks/useDriving';
import {AlertBanner} from '../../../../components/feedback/AlertBanner';
import {MapTileLayer, type MapStyle} from '../../../../components/maps/MapTileLayer';
import {FadeIn} from '../../../../components/motion/FadeIn';
import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {
  SPEED_SEGMENT_HIGH_MPS,
  SPEED_SEGMENT_LOW_MPS,
  SPEED_SEGMENT_MED_MPS,
} from './constants';

const EM_DASH = '\u2014';
const EN_DASH = '\u2013';
const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

// leaflet CircleMarker fill colours preserved verbatim.
const START_COLOR = '#10b981';
const END_COLOR = '#ef4444';
const ANCHOR_COLOR = '#22d3ee';
// footer speed-legend swatch colours preserved verbatim (the same ramp the web
// getSpeedColor feeds into seg.color): emerald-500 / cyan-400 / amber-500 / red-500.
const LEGEND_LOW = '#10b981';
const LEGEND_MED = '#22d3ee';
const LEGEND_HIGH = '#f59e0b';
const LEGEND_TOP = '#ef4444';
// MapContainer zoom={trail.length > 1 ? 13 : 3} — surfaced in the info row.
const ZOOM_MULTI = 13;
const ZOOM_SINGLE = 3;
// FitBounds fixed-view fallback zoom + bbox spread floor (1e-5). The leaflet
// fitBounds padding ([30, 30]) has no native analog and is dropped.
const FALLBACK_ZOOM = 15;
const SPREAD_FLOOR = 1e-5;
// Cap the colour strip so a long polyline doesn't render thousands of bars.
const MAX_SEGMENT_BARS = 48;
// web @/lib/geo MIN_MEANINGFUL_ROUTE_METERS.
const MIN_MEANINGFUL_ROUTE_METERS = 10;
// web @/lib/unitConversion speed constants.
const SECONDS_PER_HOUR = 3600;
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;

/* ─── leaflet LatLngExpression + sibling ./types SpeedSegment (native-safe) ── */

// leaflet LatLngExpression resolves to a [lat, lng] tuple or {lat, lng} literal;
// the source only ever feeds/handles the tuple form (Array.isArray branch).
type LatLngTuple = [number, number];
interface LatLngLiteral {
  lat: number;
  lng: number;
}
export type LatLngExpression = LatLngTuple | LatLngLiteral;

// Inlined sibling ./types SpeedSegment (module not yet ported), mirrored verbatim
// from web/src/features/driving/components/drive-detail/types.ts.
interface SpeedSegment {
  positions: LatLngExpression[];
  color: string;
}

export interface RouteMapSectionProps {
  drive: DriveDetail;
  trail: LatLngExpression[];
  startPos: [number, number] | undefined;
  endPos: [number, number] | undefined;
  centerPos: [number, number];
  speedSegments: SpeedSegment[];
}

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while keeping
// every key at the call site. Every call here uses the t(key, fallback) shape.
type TFunc = (key: string, fallback?: string) => string;

function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/hooks/useUnits speed pref + @/lib/numberFormat fmtNumber ──── */

type SpeedUnit = 'mph' | 'km/h';

// web useUnits deriveSpeed: 'mi' selects mph, everything else km/h.
function deriveSpeed(unitOfLength: string | undefined): SpeedUnit {
  return unitOfLength === 'mi' ? 'mph' : 'km/h';
}

// web numberFormat global locale: settings.locale when non-empty, else en-US.
function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

// web numberFormat global precision (set by useSettings, default 2).
function derivePrecision(decimalPrecision: unknown): number {
  if (
    typeof decimalPrecision !== 'number' ||
    !Number.isFinite(decimalPrecision) ||
    decimalPrecision < 0
  ) {
    return DEFAULT_PRECISION;
  }
  return Math.floor(decimalPrecision);
}

// web @/lib/numberFormat safeNumber: nullish/NaN -> 0.
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web @/lib/numberFormat fmtNumber: locale-aware separators with a fixed
// fraction-digit count (min === max), falling back to en-US for bad locales.
function fmtNumber(value: unknown, decimals: number, locale: string): string {
  const digits = Math.max(0, Math.min(20, Math.floor(decimals)));
  try {
    return safeNumber(value).toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }
}

// web @/lib/unitConversion convertSpeedFromSI(mps, pref).
function convertSpeedFromSI(mps: number, to: SpeedUnit): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

/* ─── inlined @/lib/dateFormat formatTime / formatDateTime ──────────────── */

// web formatTime: "02:30 PM"; em-dash for null/invalid input.
function formatTime(
  iso: string | null | undefined,
  locale: string,
): string {
  if (!iso) return EM_DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return d.toLocaleTimeString(locale, {hour: '2-digit', minute: '2-digit'});
}

// web formatDateTime: "Apr 4, 2026, 02:30 PM"; em-dash for null/invalid input.
function formatDateTime(
  iso: string | null | undefined,
  locale: string,
): string {
  if (!iso) return EM_DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ─── inlined @/lib/geo route helpers ──────────────────────────────────── */

interface LatLngLike {
  latitude: number;
  longitude: number;
}

// web @/lib/geo haversineDistance — great-circle distance in meters.
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// web @/lib/geo isValidLatLng — finite, non-(0,0), within global bounds.
function isValidLatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

// web @/lib/geo hasMeaningfulRoute — ≥2 valid coords ≥ MIN_MEANINGFUL_ROUTE_METERS apart.
function hasMeaningfulRoute(positions: readonly LatLngLike[]): boolean {
  let anchorIdx = -1;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (isValidLatLng(p.latitude, p.longitude)) {
      anchorIdx = i;
      break;
    }
  }
  if (anchorIdx < 0) return false;
  const anchor = positions[anchorIdx];
  for (let i = anchorIdx + 1; i < positions.length; i++) {
    const p = positions[i];
    if (!isValidLatLng(p.latitude, p.longitude)) continue;
    const d = haversineDistance(
      anchor.latitude,
      anchor.longitude,
      p.latitude,
      p.longitude,
    );
    if (d >= MIN_MEANINGFUL_ROUTE_METERS) return true;
  }
  return false;
}

// web @/lib/geo firstValidIndex — index of first valid coord, or -1.
function firstValidIndex(positions: readonly LatLngLike[]): number {
  for (let i = 0; i < positions.length; i++) {
    if (isValidLatLng(positions[i].latitude, positions[i].longitude)) return i;
  }
  return -1;
}

/* ─── FitBounds decision logic (leaflet-free, as a pure computeFitView) ──── */

// leaflet's trail.map((p) => Array.isArray(p) ? [p[0], p[1]] : [0, 0]).
function toBoundsTuple(p: LatLngExpression): LatLngTuple {
  return Array.isArray(p) ? [p[0] as number, p[1] as number] : [0, 0];
}

type FitView =
  | {kind: 'fit'; center: LatLngTuple}
  | {kind: 'view'; center: LatLngTuple; zoom: number}
  | {kind: 'none'};

/* Auto-fit resolution mirroring the web FitBounds. Special-cases the two cluster
 * degeneracies leaflet otherwise zooms past maxZoom for: (1) N identical coords
 * (zero-extent bbox still "valid") and (2) a cluster smaller than the spread
 * floor — both fall back to a fixed view at the anchor coord at zoom 15. */
function computeFitView(
  trail: LatLngExpression[],
  fallbackCenter?: LatLngTuple,
): FitView {
  if (trail.length > 1) {
    const pts = trail.map(toBoundsTuple);
    let minLat = Infinity;
    let minLng = Infinity;
    let maxLat = -Infinity;
    let maxLng = -Infinity;
    for (const [lat, lng] of pts) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    const valid =
      Number.isFinite(minLat) &&
      Number.isFinite(minLng) &&
      Number.isFinite(maxLat) &&
      Number.isFinite(maxLng);
    const spread = valid
      ? Math.abs(maxLat - minLat) + Math.abs(maxLng - minLng)
      : 0;
    if (valid && spread > SPREAD_FLOOR) {
      return {kind: 'fit', center: [(minLat + maxLat) / 2, (minLng + maxLng) / 2]};
    }
    if (fallbackCenter) {
      return {kind: 'view', center: fallbackCenter, zoom: FALLBACK_ZOOM};
    }
    return {kind: 'none'};
  }
  if (trail.length === 1) {
    return {kind: 'view', center: toBoundsTuple(trail[0]), zoom: FALLBACK_ZOOM};
  }
  if (fallbackCenter) {
    return {kind: 'view', center: fallbackCenter, zoom: FALLBACK_ZOOM};
  }
  return {kind: 'none'};
}

function formatCoord(value: number): string {
  return value.toFixed(4);
}

/* ─── inline native MapLayerSwitcher (web @/components/maps MapLayerSwitcher) ── */

const MAP_LAYERS: {id: MapStyle; icon: string; label: string}[] = [
  {id: 'dark', icon: '\u{1F311}', label: 'Dark'},
  {id: 'satellite', icon: '\u{1F6F0}\uFE0F', label: 'Satellite'},
  {id: 'streets', icon: '\u{1F5FA}\uFE0F', label: 'Streets'},
  {id: 'terrain', icon: '\u26F0\uFE0F', label: 'Terrain'},
];

interface MapLayerSwitcherProps {
  current: MapStyle;
  onChange: (style: MapStyle) => void;
}

function MapLayerSwitcher({current, onChange}: MapLayerSwitcherProps) {
  return (
    <View style={styles.switcher} testID="map-layer-switcher">
      {MAP_LAYERS.map(layer => {
        const active = current === layer.id;
        return (
          <Pressable
            accessibilityLabel={layer.label}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            key={layer.id}
            onPress={() => onChange(layer.id)}
            style={({pressed}) => [
              styles.switcherButton,
              active && styles.switcherButtonActive,
              pressed && styles.switcherButtonPressed,
            ]}>
            <AppText style={styles.switcherIcon}>{layer.icon}</AppText>
            <AppText
              style={[styles.switcherLabel, active && styles.switcherLabelActive]}
              variant="caption"
              weight="semibold">
              {layer.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

MapLayerSwitcher.displayName = 'MapLayerSwitcher';

/* ─── canonical glyphs (web lucide-react icons) ────────────────────────── */

const MAP_PIN_GLYPH = getSemanticIconDefinition('mapPinned').glyph; // MapPin
const FLAG_GLYPH = getSemanticIconDefinition('flag').glyph; // Flag
const NAV_GLYPH = getSemanticIconDefinition('navigationAlt').glyph; // Navigation2

interface RouteMarker {
  key: string;
  color: string;
  title: string;
  detail?: string;
  coord: [number, number];
}

/**
 * RouteMapSection — drive-detail route map. The interactive Leaflet tile map +
 * speed-coloured polylines + popups have no native analog (no react-native-maps
 * / leaflet), so the route is surfaced as a tile preview + derived data: the
 * resolved fit view, a speed-segment colour strip, and a start/end/anchor marker
 * list. The stationary-GPS banner, footer times, speed legend, and empty state
 * are preserved.
 */
export function RouteMapSection({
  drive,
  trail,
  startPos,
  endPos,
  centerPos,
  speedSegments,
}: RouteMapSectionProps) {
  const {t} = useTranslation();
  const {data: settings} = useSettings();

  const speedUnit = deriveSpeed(settings?.unit_of_length);
  const locale = deriveLocale(settings?.locale);
  const precision = derivePrecision(settings?.decimal_precision);
  const toSpeedDisplay = (value: number) => convertSpeedFromSI(value, speedUnit);

  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');

  /* Stationary-GPS detection: positions exist but every recorded coord is
   * within ~10 m of the first. Render a single anchor marker + an overlay
   * banner instead of a polyline that collapses to a single dot at maxZoom. */
  const positionLatLngs = useMemo(
    () =>
      (drive.positions ?? []).map(p => ({
        latitude:
          typeof p.latitude === 'number' ? p.latitude : Number(p.latitude),
        longitude:
          typeof p.longitude === 'number' ? p.longitude : Number(p.longitude),
      })),
    [drive.positions],
  );
  const hasRoute = useMemo(
    () => hasMeaningfulRoute(positionLatLngs),
    [positionLatLngs],
  );
  const anchorIdx = useMemo(
    () => firstValidIndex(positionLatLngs),
    [positionLatLngs],
  );
  const anchorPoint: [number, number] | undefined = useMemo(() => {
    if (anchorIdx < 0) return undefined;
    const p = positionLatLngs[anchorIdx];
    return [p.latitude, p.longitude];
  }, [positionLatLngs, anchorIdx]);

  // Mirrors <FitBounds trail={hasRoute ? trail : []} fallbackCenter={anchorPoint} />.
  const fitView = useMemo(
    () => computeFitView(hasRoute ? trail : [], anchorPoint),
    [hasRoute, trail, anchorPoint],
  );

  // CircleMarker/Popup start/end/anchor markers (same gating + colours + copy).
  const markers = useMemo<RouteMarker[]>(() => {
    const list: RouteMarker[] = [];
    if (hasRoute && startPos) {
      list.push({
        key: 'start',
        color: START_COLOR,
        title: t('driveDetail.start', 'Start'),
        detail: formatDateTime(drive.startTs, locale),
        coord: startPos,
      });
    }
    if (hasRoute && endPos) {
      list.push({
        key: 'end',
        color: END_COLOR,
        title: t('driveDetail.end', 'End'),
        detail: drive.endTs
          ? formatDateTime(drive.endTs, locale)
          : t('driveDetail.inProgress', 'In progress'),
        coord: endPos,
      });
    }
    if (!hasRoute && anchorPoint) {
      list.push({
        key: 'anchor',
        color: ANCHOR_COLOR,
        title: t('driveDetail.lastKnown', 'Last known location'),
        coord: anchorPoint,
      });
    }
    return list;
  }, [hasRoute, startPos, endPos, anchorPoint, drive.startTs, drive.endTs, t, locale]);

  const initialZoom = trail.length > 1 ? ZOOM_MULTI : ZOOM_SINGLE;
  const segmentBars = hasRoute ? speedSegments.slice(0, MAX_SEGMENT_BARS) : [];
  const hiddenSegments = hasRoute
    ? Math.max(0, speedSegments.length - segmentBars.length)
    : 0;

  const fitLabel =
    fitView.kind === 'fit'
      ? t('driveDetail.routeFitAuto', 'Auto-fit to route') +
        ` \u00B7 ${formatCoord(fitView.center[0])}, ${formatCoord(
          fitView.center[1],
        )}`
      : fitView.kind === 'view'
      ? `${formatCoord(fitView.center[0])}, ${formatCoord(
          fitView.center[1],
        )} \u00B7 ${t('driveDetail.routeZoom', 'zoom')} ${fitView.zoom}`
      : t('driveDetail.routeNoFocus', 'No focus point');

  return (
    <FadeIn>
      <GlassPanel style={styles.panel} testID="route-map-section">
        <View style={styles.headerWrap}>
          <View style={styles.header}>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={styles.headerIcon}
              weight="bold">
              {MAP_PIN_GLYPH}
            </AppText>
            <AppText style={styles.headerTitle} weight="semibold">
              {t('driveDetail.route', 'Route')}
            </AppText>
          </View>
        </View>

        {trail.length > 0 ? (
          <>
            <View style={styles.mapArea}>
              <MapTileLayer containerStyle={styles.tile} style={mapStyle} />

              {/* Derived map view info (MapContainer center/zoom + FitBounds). */}
              <View style={styles.mapInfo}>
                <AppText tone="secondary" variant="caption">
                  {t(
                    'driveDetail.routeNativeUnavailable',
                    'Interactive route map is unavailable in this native parity component.',
                  )}
                </AppText>
                <AppText tone="muted" variant="caption">
                  {`${t('driveDetail.routeCenter', 'Center')} ${formatCoord(
                    centerPos[0],
                  )}, ${formatCoord(centerPos[1])} \u00B7 ${t(
                    'driveDetail.routeZoom',
                    'zoom',
                  )} ${initialZoom}`}
                </AppText>
                <AppText tone="muted" variant="caption">
                  {`${t('driveDetail.routeFit', 'Fit')}: ${fitLabel} \u00B7 ${t(
                    'driveDetail.routePoints',
                    'points',
                  )} ${trail.length}`}
                </AppText>
              </View>

              {/* Speed-coloured polyline -> colour strip (one bar per segment). */}
              {hasRoute && segmentBars.length > 0 ? (
                <View
                  accessibilityLabel={t(
                    'driveDetail.routeSegments',
                    'Route speed segments',
                  )}
                  accessible
                  style={styles.segmentStrip}>
                  {segmentBars.map((seg, i) => (
                    <View
                      key={i}
                      style={[styles.segmentBar, {backgroundColor: seg.color}]}
                    />
                  ))}
                  {hiddenSegments > 0 ? (
                    <AppText style={styles.segmentMore} tone="muted" variant="caption">
                      {`+${hiddenSegments}`}
                    </AppText>
                  ) : null}
                </View>
              ) : null}

              {/* CircleMarker/Popup markers (start/end/anchor). */}
              {markers.length > 0 ? (
                <ScrollView
                  contentContainerStyle={styles.markerListContent}
                  nestedScrollEnabled
                  style={styles.markerList}>
                  {markers.map(marker => (
                    <View
                      accessible
                      accessibilityLabel={marker.title}
                      key={marker.key}
                      style={styles.markerRow}>
                      <View
                        style={[styles.markerDot, {backgroundColor: marker.color}]}
                      />
                      <View style={styles.markerBody}>
                        <AppText weight="bold">{marker.title}</AppText>
                        {marker.detail ? (
                          <AppText tone="secondary" variant="caption">
                            {marker.detail}
                          </AppText>
                        ) : null}
                        <AppText tone="muted" variant="caption">
                          {`${formatCoord(marker.coord[0])}, ${formatCoord(
                            marker.coord[1],
                          )}`}
                        </AppText>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              ) : null}

              {/* Floating layer switcher (web MapLayerSwitcher, bottom-left). */}
              <View pointerEvents="box-none" style={styles.switcherOverlay}>
                <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
              </View>

              {/* Stationary-GPS overlay banner. */}
              {!hasRoute ? (
                <View pointerEvents="box-none" style={styles.bannerOverlay}>
                  <AlertBanner
                    icon={
                      <AppText style={styles.bannerIcon} weight="bold">
                        {NAV_GLYPH}
                      </AppText>
                    }
                    title={t(
                      'driveDetail.stationaryRouteTitle',
                      "Route can't be plotted",
                    )}
                    variant="info">
                    {t(
                      'driveDetail.stationaryRouteBody',
                      "Only one GPS coordinate was recorded for this drive, so the route can't be drawn. The drive's distance, duration, and other stats below are unaffected.",
                    )}
                  </AlertBanner>
                </View>
              ) : null}
            </View>

            <View style={styles.footer}>
              <View style={styles.footerItem}>
                <AppText style={styles.flagStart} weight="bold">
                  {FLAG_GLYPH}
                </AppText>
                <AppText style={styles.footerStart} variant="caption">
                  {`${t('driveDetail.start', 'Start')}: ${formatTime(
                    drive.startTs,
                    locale,
                  )}`}
                </AppText>
              </View>

              {hasRoute && trail.length > 1 ? (
                <View style={styles.legend}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendBar, {backgroundColor: LEGEND_LOW}]} />
                    <AppText style={styles.legendText} variant="caption">
                      {`<${fmtNumber(toSpeedDisplay(SPEED_SEGMENT_LOW_MPS), precision, locale)}`}
                    </AppText>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendBar, {backgroundColor: LEGEND_MED}]} />
                    <AppText style={styles.legendText} variant="caption">
                      {`${fmtNumber(toSpeedDisplay(SPEED_SEGMENT_LOW_MPS), precision, locale)}${EN_DASH}${fmtNumber(toSpeedDisplay(SPEED_SEGMENT_MED_MPS), precision, locale)}`}
                    </AppText>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendBar, {backgroundColor: LEGEND_HIGH}]} />
                    <AppText style={styles.legendText} variant="caption">
                      {`${fmtNumber(toSpeedDisplay(SPEED_SEGMENT_MED_MPS), precision, locale)}${EN_DASH}${fmtNumber(toSpeedDisplay(SPEED_SEGMENT_HIGH_MPS), precision, locale)}`}
                    </AppText>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendBar, {backgroundColor: LEGEND_TOP}]} />
                    <AppText style={styles.legendText} variant="caption">
                      {`>${fmtNumber(toSpeedDisplay(SPEED_SEGMENT_HIGH_MPS), precision, locale)}`}
                    </AppText>
                  </View>
                  <AppText style={styles.legendText} variant="caption">
                    {speedUnit}
                  </AppText>
                </View>
              ) : null}

              {drive.endTs ? (
                <View style={styles.footerItem}>
                  <AppText style={styles.flagEnd} weight="bold">
                    {FLAG_GLYPH}
                  </AppText>
                  <AppText style={styles.footerEnd} variant="caption">
                    {`${t('driveDetail.end', 'End')}: ${formatTime(
                      drive.endTs,
                      locale,
                    )}`}
                  </AppText>
                </View>
              ) : null}
            </View>
          </>
        ) : (
          <View style={styles.emptyState}>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={styles.emptyIcon}
              weight="bold">
              {MAP_PIN_GLYPH}
            </AppText>
            <AppText style={styles.emptyText} tone="muted" variant="caption">
              {t('driveDetail.noRouteData', 'No route data available for this drive')}
            </AppText>
          </View>
        )}
      </GlassPanel>
    </FadeIn>
  );
}

RouteMapSection.displayName = 'RouteMapSection';

const styles = StyleSheet.create({
  panel: {
    overflow: 'hidden',
  },
  headerWrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerIcon: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 18,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  mapArea: {
    gap: spacing.sm,
    minHeight: 256,
    padding: spacing.sm,
    position: 'relative',
  },
  tile: {
    minHeight: 160,
  },
  mapInfo: {
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  segmentStrip: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    minHeight: 8,
  },
  segmentBar: {
    borderRadius: 999,
    flex: 1,
    height: 4,
    minWidth: 2,
  },
  segmentMore: {
    marginLeft: spacing.xs,
  },
  markerList: {
    flexGrow: 0,
    maxHeight: 160,
  },
  markerListContent: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  markerRow: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  markerDot: {
    borderRadius: 6,
    height: 12,
    marginTop: spacing.xs,
    width: 12,
  },
  markerBody: {
    flex: 1,
    gap: 2,
  },
  switcherOverlay: {
    bottom: spacing.lg,
    left: spacing.sm,
    position: 'absolute',
  },
  switcher: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
  },
  switcherButton: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  switcherButtonActive: {
    backgroundColor: colors.surfaceSelected,
  },
  switcherButtonPressed: {
    opacity: 0.6,
  },
  switcherIcon: {
    fontSize: 12,
    lineHeight: 16,
  },
  switcherLabel: {
    color: colors.textSecondary,
  },
  switcherLabelActive: {
    color: colors.textPrimary,
  },
  bannerOverlay: {
    left: spacing.md,
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
  },
  bannerIcon: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 16,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: spacing.md,
  },
  footerItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  flagStart: {
    color: colors.success,
    fontSize: 12,
    lineHeight: 16,
  },
  flagEnd: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 16,
  },
  footerStart: {
    color: colors.success,
  },
  footerEnd: {
    color: colors.danger,
  },
  legend: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendBar: {
    borderRadius: 999,
    height: 4,
    width: 12,
  },
  legendText: {
    color: colors.textMuted,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    justifyContent: 'center',
    minHeight: 256,
    padding: spacing.lg,
  },
  emptyIcon: {
    color: colors.textMuted,
    fontSize: 32,
    lineHeight: 36,
    opacity: 0.3,
  },
  emptyText: {
    textAlign: 'center',
  },
});
