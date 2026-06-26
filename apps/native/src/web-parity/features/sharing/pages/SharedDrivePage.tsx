// Native parity port of web/src/features/sharing/pages/SharedDrivePage.tsx.
//
// The web module is the chrome-less public "Shared Drive Report" route: it reads
// the share `:token` from the URL, fetches the shared drive via the public
// useSharedDrive endpoint, normalizes a legacy v1 payload to the SI v2 shape, and
// renders a branded report — a header (Logo + label), an optional hero Leaflet
// map (Polyline + start/end CircleMarkers), a title/description/date/route block,
// a responsive StatCard grid (distance/duration/efficiency/battery/max+avg
// speed/elevation gain), an optional vehicle badge, an elevation-profile area
// chart, a speed-profile line chart, a "no route data" fallback, and a footer
// with a learn-more link. Backend distances/speeds/elevations/efficiency arrive
// as SI and are converted at the display boundary to the user's unit prefs.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-router-dom useParams<{token}>() -> an optional `token` page prop; the
//     two <a href> links (home '/' + external github URL) -> an optional
//     `onNavigate(to)` callback that carries each href verbatim (RN has no router
//     or anchor; the host decides routing vs Linking.openURL).
//   • react-i18next useTranslation() -> an inlined native useTranslation() whose
//     t(key, fallback?, vars?) returns the English fallback (or key) with {{var}}
//     interpolation, preserving every translation key verbatim at the call site.
//   • @/hooks/useUnits (unitPrefs / formatDistance / formatSpeed) -> an inlined
//     useUnits() that derives a UnitPref bag from the ported useSettings() exactly
//     like the web hook (deriveDistance/deriveSpeed/deriveLocale/derivePrecision)
//     and feeds the inlined SI-floor @/lib/unitConversion formatters.
//   • @/lib/dateFormat formatDurationSecondsAsMinutes + @/lib/unitConversion
//     convertDistanceFromSI/convertSpeedFromSI -> inlined verbatim ports.
//   • @/components/ui/Logo (theme-gradient rounded square + white lightning bolt
//     SVG, default size 32, no wordmark) -> an inlined native BrandLogo: a rounded
//     accent tile with a bolt glyph (no react-dom SVG primitive in this app).
//   • @/components/data-display StatCard / @/components/layout Grid /
//     @/components/feedback Spinner -> inlined native equivalents (a glass StatCard
//     with label/icon header + bold value; a flex-wrap 2-up grid; an
//     ActivityIndicator) covering exactly the props these call sites use.
//   • @/components/maps MapContainer/Polyline/CircleMarker/MapTileLayer +
//     LatLngExpression -> react-leaflet + leaflet are DOM-only and no
//     react-native-maps/leaflet is installed, so the interactive raster map cannot
//     be reproduced; the already-ported native <MapTileLayer /> is reused for the
//     tile preview and the derived center/zoom/start/end/point-count + polyline
//     colour are surfaced on an explicit "interactive route map unavailable on
//     native" panel so no route data is hidden. mapPoints is typed [number,number][].
//   • Recharts AreaChart/LineChart (CartesianGrid/XAxis/YAxis/Tooltip/
//     ResponsiveContainer + ChartGradient/chartGrid/axisTick/AREA_DEFAULTS) -> the
//     already-ported native <ChartContainer> + <AreaChartWrapper>; the per-axis
//     tickFormatter unit suffixes collapse onto the wrapper's xFormatter/yFormatter
//     and the hover <Tooltip> (no native analog) onto the wrapper's latest-value
//     summary, so the share.elevTooltipLabel / share.speedTooltipLabel keys are
//     preserved as the series labels.
//   • lucide-react glyphs (MapPin/Clock/Zap/Battery/Mountain/Gauge/TrendingUp) ->
//     native SemanticIcon registry glyphs (mapPinned/clock/bolt/battery/map/
//     speedCircle/trendUp), matching the ProjectedRangePage precedent.
// Field access stays snake_case; every API path / query key / state name is
// preserved. No DOM elements, react-i18next, react-router-dom, lucide-react,
// framer-motion, Recharts, Leaflet, react-leaflet, react-dom, or web UI-kit
// modules are imported into the native output.

import React, {useCallback, useMemo} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {useSettings} from '../../../api/hooks/useSettings';
import {
  useSharedDrive,
  type SharedDriveData,
  type SharedDriveDataV1,
} from '../../../api/hooks/useSharing';
import {AreaChartWrapper, ChartContainer} from '../../../components/charts';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {MapTileLayer} from '../../../components/maps/MapTileLayer';
import {FadeIn} from '../../../components/motion/FadeIn';
import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ──────────────────── */

type TVars = Record<string, string | number>;
type TFunc = (key: string, fallback?: string, vars?: TVars) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site, with {{var}} interpolation for the native route-map
// summary line.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback, vars) => {
    let out = fallback ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        out = out.replace(
          new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'g'),
          String(value),
        );
      }
    }
    return out;
  }, []);
  return {t};
}

/* ------------------------------------------------------------------ */
/*  Boundary constants                                                */
/* ------------------------------------------------------------------ */

// Kilometres-per-mile factor, used inline to convert Wh/km → Wh/mi for
// users on imperial preference (no SI helper exists for energy-per-distance
// efficiency yet).
const KM_PER_MILE = 1.609344;

// Metres-per-foot factor, used inline to convert SI-meter elevations to feet for
// imperial users. Elevation has no dedicated formatter in lib/unitConversion, so a
// one-shot inline conversion keeps the public report honest about units.
const METERS_PER_FOOT = 0.3048;

const METERS_PER_KM = 1000;
const KMH_PER_MPS = 3.6;

// Leaflet props from the source preserved as documented native constants: the
// MapContainer zoom={7} and the Polyline / start / end marker colours. The
// interactive map is unavailable on native, so these drive the route-summary panel
// below instead of a live raster overlay.
const MAP_ZOOM = 7;
const ROUTE_LINE_COLOR = colors.accent; // web Polyline color 'var(--theme-primary)'
const START_MARKER_COLOR = '#22c55e'; // web start CircleMarker
const END_MARKER_COLOR = '#ef4444'; // web end CircleMarker

// web Speed-profile <Line stroke="#00f0ff"> preserved verbatim.
const SPEED_LINE_COLOR = '#00f0ff';

/* ─── inlined @/lib/unitConversion (SI-floor converters + formatters) ───── */

const DEFAULT_LOCALE = 'en-US';
const METERS_PER_MILE = 1609.344;
const SECONDS_PER_HOUR = 3600;
const DEFAULT_EMPTY_DISPLAY = '—';
const DIST_DEFAULT_PRECISION = 1;
const SPEED_DEFAULT_PRECISION = 0;

type DistanceUnitPref = 'km' | 'mi';
type SpeedUnitPref = 'km/h' | 'mph';

interface UnitPref {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
  locale?: string;
  precision?: number;
}

interface FormatOptions {
  precision?: number;
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// web convertDistanceFromSI: SI metres -> km / mi.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

// web convertSpeedFromSI: SI m/s -> km/h / mph.
function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  return to === 'mph'
    ? (mps * SECONDS_PER_HOUR) / METERS_PER_MILE
    : (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
}

// web numberFormat formatNumber: locale-aware fixed-decimal formatting with a bad
// locale tag falling back to en-US so a string is always produced.
function formatFixed(value: number, locale: string, digits: number): string {
  const d = Math.max(0, Math.min(20, Math.floor(digits)));
  try {
    return value.toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return value.toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

function resolvePrecision(
  pref: UnitPref,
  override: number | undefined,
  fallback: number,
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return Math.floor(override);
  }
  if (
    typeof pref.precision === 'number' &&
    Number.isFinite(pref.precision) &&
    pref.precision >= 0
  ) {
    return Math.floor(pref.precision);
  }
  return fallback;
}

// SI metres -> display distance with a trailing unit (web formatDistance).
function unitFormatDistance(
  meters: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(meters)) {
    return DEFAULT_EMPTY_DISPLAY;
  }
  const d = resolvePrecision(pref, options?.precision, DIST_DEFAULT_PRECISION);
  return `${formatFixed(
    convertDistanceFromSI(meters, pref.distance),
    pref.locale ?? DEFAULT_LOCALE,
    d,
  )} ${pref.distance}`;
}

// SI m/s -> display speed with a trailing unit (web formatSpeed).
function unitFormatSpeed(
  mps: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(mps)) {
    return DEFAULT_EMPTY_DISPLAY;
  }
  const d = resolvePrecision(pref, options?.precision, SPEED_DEFAULT_PRECISION);
  return `${formatFixed(
    convertSpeedFromSI(mps, pref.speed),
    pref.locale ?? DEFAULT_LOCALE,
    d,
  )} ${pref.speed}`;
}

/* ─── inlined @/lib/dateFormat formatDurationSecondsAsMinutes ───────────── */

const DURATION_FALLBACK = '—';

// web formatRoundedInt: en-US integer with no fraction digits.
function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// web formatDurationSecondsAsMinutes: "5m" or "2h 05m" / "2h"; '—' for invalid.
function formatDurationSecondsAsMinutes(
  seconds: number | null | undefined,
): string {
  if (!isFiniteNumber(seconds) || seconds < 0) {
    return DURATION_FALLBACK;
  }
  const h = Math.floor(seconds / 3600);
  const m = (seconds % 3600) / 60;
  if (h === 0) {
    return `${formatRoundedInt(m)}m`;
  }
  return m >= 0.5 ? `${h}h ${formatRoundedInt(m)}m` : `${h}h`;
}

/* ─── inlined @/hooks/useUnits (settings-derived UnitPref + formatters) ──── */

function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

function deriveSpeed(unitOfLength: string | undefined): SpeedUnitPref {
  return unitOfLength === 'mi' ? 'mph' : 'km/h';
}

function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

function deriveUnitPrecision(decimalPrecision: unknown): number | undefined {
  if (
    typeof decimalPrecision === 'number' &&
    Number.isFinite(decimalPrecision) &&
    decimalPrecision >= 0
  ) {
    return Math.floor(decimalPrecision);
  }
  return undefined;
}

interface UseUnitsResult {
  unitPrefs: UnitPref;
  formatDistance: (v: number | null | undefined, o?: FormatOptions) => string;
  formatSpeed: (v: number | null | undefined, o?: FormatOptions) => string;
}

function useUnits(): UseUnitsResult {
  const {data: settings} = useSettings();
  const locale = deriveLocale(settings?.locale);

  const unitPrefs = useMemo<UnitPref>(
    () => ({
      distance: deriveDistance(settings?.unit_of_length),
      speed: deriveSpeed(settings?.unit_of_length),
      locale,
      precision: deriveUnitPrecision(settings?.decimal_precision),
    }),
    [settings?.unit_of_length, locale, settings?.decimal_precision],
  );

  const formatDistance = useCallback(
    (v: number | null | undefined, o?: FormatOptions) =>
      unitFormatDistance(v, unitPrefs, o),
    [unitPrefs],
  );
  const formatSpeed = useCallback(
    (v: number | null | undefined, o?: FormatOptions) =>
      unitFormatSpeed(v, unitPrefs, o),
    [unitPrefs],
  );

  return {unitPrefs, formatDistance, formatSpeed};
}

/* ------------------------------------------------------------------ */
/*  Unit-aware helpers                                                */
/* ------------------------------------------------------------------ */

function elevationLabel(distancePref: DistanceUnitPref): string {
  return distancePref === 'mi' ? 'ft' : 'm';
}

function convertElevation(
  meters: number,
  distancePref: DistanceUnitPref,
): number {
  return distancePref === 'mi' ? meters / METERS_PER_FOOT : meters;
}

function efficiencyUnit(distancePref: DistanceUnitPref): string {
  return distancePref === 'mi' ? 'Wh/mi' : 'Wh/km';
}

function toEfficiencyDisplay(
  whPerKm: number,
  distancePref: DistanceUnitPref,
): number {
  return distancePref === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;
}

function normalizeSharedDriveData(
  data: SharedDriveData | SharedDriveDataV1 | undefined,
): SharedDriveData | undefined {
  if (!data) {
    return undefined;
  }
  if ('payload_version' in data && data.payload_version === 'v2') {
    return data;
  }
  const v1 = data as SharedDriveDataV1;
  return {
    payload_version: 'v1',
    title: v1.title,
    description: v1.description,
    drive: {
      date: v1.drive.date,
      distance_m: v1.drive.distance_km * METERS_PER_KM,
      duration_s: Math.round(v1.drive.duration_min * 60),
      start_address: v1.drive.start_address,
      end_address: v1.drive.end_address,
      start_battery: v1.drive.start_battery,
      end_battery: v1.drive.end_battery,
      elevation_gain: v1.drive.elevation_gain,
      elevation_loss: v1.drive.elevation_loss,
      max_speed_mps:
        v1.drive.max_speed_kmh == null
          ? null
          : v1.drive.max_speed_kmh / KMH_PER_MPS,
      avg_speed_mps:
        v1.drive.avg_speed_kmh == null
          ? null
          : v1.drive.avg_speed_kmh / KMH_PER_MPS,
      efficiency_wh_per_m:
        v1.drive.efficiency_wh_km == null
          ? null
          : v1.drive.efficiency_wh_km / METERS_PER_KM,
    },
    vehicle: v1.vehicle,
    map_points: v1.map_points,
    elevation_profile: (v1.elevation_profile ?? []).map(p => ({
      distance_m: p.distance_km * METERS_PER_KM,
      elevation_m: p.elevation_m,
    })),
    speed_profile: (v1.speed_profile ?? []).map(p => ({
      distance_m: p.distance_km * METERS_PER_KM,
      speed_mps: p.speed_kmh / KMH_PER_MPS,
    })),
    telemetry: (v1.telemetry ?? []).map(p => ({
      distance_m: p.distance_km * METERS_PER_KM,
      battery_level: p.battery_level,
      power: p.power,
      elevation: p.elevation,
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Inlined web UI substitutes                                        */
/* ------------------------------------------------------------------ */

// Native substitute for web @/components/ui/Logo (default size 32, no wordmark):
// the theme-gradient rounded square + white lightning-bolt SVG becomes a rounded
// accent tile with a bolt glyph (no react-dom SVG primitive in this app).
function BrandLogo() {
  return (
    <View
      accessibilityLabel="TeslaSync"
      accessibilityRole="image"
      style={styles.logo}>
      <AppText style={styles.logoGlyph} weight="bold">
        {'\u26A1'}
      </AppText>
    </View>
  );
}

// Native substitute for web @/components/data-display StatCard (the only props
// these call sites use are label / value / icon): a glass card with a muted
// label + tinted glyph header and a bold value.
function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: SemanticIconName;
}) {
  return (
    <GlassPanel style={styles.statCard}>
      <View style={styles.statHeader}>
        <AppText
          numberOfLines={1}
          style={styles.statLabel}
          tone="muted"
          variant="caption">
          {label}
        </AppText>
        <SemanticIcon decorative name={icon} size="sm" />
      </View>
      <AppText numberOfLines={1} variant="title" weight="bold">
        {value}
      </AppText>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Expired / Error view                                              */
/* ------------------------------------------------------------------ */

function ExpiredShareView({onNavigate}: {onNavigate?: (to: string) => void}) {
  const {t} = useTranslation();
  return (
    <View style={styles.screenCenter}>
      <View style={styles.expiredCard}>
        <View style={styles.expiredIcon}>
          <SemanticIcon decorative name="mapPinned" size="lg" />
        </View>
        <AppText style={styles.centeredText} variant="title" weight="bold">
          {t('share.expired.title', 'Share Link Unavailable')}
        </AppText>
        <AppText style={styles.centeredText} tone="secondary" variant="caption">
          {t(
            'share.expired.description',
            'This shared drive link has expired or been revoked.',
          )}
        </AppText>
        <Pressable
          accessibilityRole="link"
          onPress={() => onNavigate?.('/')}>
          <AppText tone="accent" variant="caption" weight="semibold">
            {t('share.expired.home', 'Go to TeslaSync')}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  SharedDrivePage                                                   */
/* ------------------------------------------------------------------ */

export interface SharedDrivePageProps {
  // react-router-dom useParams<{token}>() stand-in.
  token?: string;
  // <a href> navigation intent (home '/' + external learn-more URL), carried
  // verbatim; the host decides routing vs Linking.openURL.
  onNavigate?: (to: string) => void;
}

// EXCEPTION: public share route is chrome-less so unauthenticated recipients see only the branded report.
export default function SharedDrivePage({
  token,
  onNavigate,
}: SharedDrivePageProps = {}) {
  const {t} = useTranslation();
  const {data: rawData, isLoading, error} = useSharedDrive(token ?? '');
  const data = useMemo(() => normalizeSharedDriveData(rawData), [rawData]);
  const {unitPrefs, formatDistance, formatSpeed} = useUnits();
  const distancePref = unitPrefs.distance;
  const speedPref = unitPrefs.speed;
  const elevPref = elevationLabel(distancePref);
  const effPref = efficiencyUnit(distancePref);

  /* ---- Map data ---- */
  const mapPoints = useMemo<[number, number][]>(() => {
    const pts = data?.map_points ?? [];
    return pts.map(p => [p.lat, p.lng] as [number, number]);
  }, [data?.map_points]);

  const center = useMemo<[number, number]>(() => {
    if (mapPoints.length > 0) {
      const mid = mapPoints[Math.floor(mapPoints.length / 2)];
      return Array.isArray(mid)
        ? ([mid[0], mid[1]] as [number, number])
        : [47.6, -122.3];
    }
    return [47.6, -122.3];
  }, [mapPoints]);

  const startPos = mapPoints.length > 0 ? mapPoints[0] : undefined;
  const endPos =
    mapPoints.length > 1 ? mapPoints[mapPoints.length - 1] : undefined;

  /* ---- Elevation chart data ---- */
  // Pre-convert at memo time so chart consumers receive already-display-unit
  // values; the x/y formatters only render the unit suffix.
  const elevationData = useMemo(
    () =>
      (data?.elevation_profile ?? []).map(p => ({
        distance: convertDistanceFromSI(p.distance_m, distancePref),
        elevation: convertElevation(p.elevation_m, distancePref),
      })),
    [data?.elevation_profile, distancePref],
  );

  /* ---- Speed chart data ---- */
  const speedData = useMemo(
    () =>
      (data?.speed_profile ?? []).map(p => ({
        distance: convertDistanceFromSI(p.distance_m, distancePref),
        speed: convertSpeedFromSI(p.speed_mps, speedPref),
      })),
    [data?.speed_profile, distancePref, speedPref],
  );

  /* ---- Loading state ---- */
  if (isLoading) {
    return (
      <View style={styles.screenCenter}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  /* ---- Error / expired ---- */
  if (error || !data) {
    return <ExpiredShareView onNavigate={onNavigate} />;
  }

  const drive = data.drive;

  // Stat tiles mirror the source's conditional StatCard list (same i18n keys,
  // same values, same order).
  const stats: {label: string; value: string; icon: SemanticIconName}[] = [
    {
      label: t('share.distance', 'Distance'),
      value: formatDistance(drive.distance_m, {precision: 1}),
      icon: 'mapPinned', // MapPin
    },
    {
      label: t('share.duration', 'Duration'),
      value: formatDurationSecondsAsMinutes(drive.duration_s),
      icon: 'clock', // Clock
    },
  ];
  if (drive.efficiency_wh_per_m != null) {
    stats.push({
      label: t('share.efficiency', 'Efficiency'),
      value: `${Math.round(
        toEfficiencyDisplay(
          drive.efficiency_wh_per_m * METERS_PER_KM,
          distancePref,
        ),
      )} ${effPref}`,
      icon: 'bolt', // Zap
    });
  }
  if (drive.start_battery != null && drive.end_battery != null) {
    stats.push({
      label: t('share.battery', 'Battery'),
      value: `${drive.start_battery}% → ${drive.end_battery}%`,
      icon: 'battery', // Battery
    });
  }
  if (drive.max_speed_mps != null) {
    stats.push({
      label: t('share.maxSpeed', 'Max Speed'),
      value: formatSpeed(drive.max_speed_mps, {precision: 0}),
      icon: 'speedCircle', // Gauge
    });
  }
  if (drive.avg_speed_mps != null) {
    stats.push({
      label: t('share.avgSpeed', 'Avg Speed'),
      value: formatSpeed(drive.avg_speed_mps, {precision: 0}),
      icon: 'trendUp', // TrendingUp
    });
  }
  if (drive.elevation_gain != null) {
    stats.push({
      label: t('share.elevGain', 'Elevation Gain'),
      value: `${Math.round(
        convertElevation(drive.elevation_gain, distancePref),
      )} ${elevPref}`,
      icon: 'map', // Mountain
    });
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <BrandLogo />
          <AppText tone="muted" variant="caption">
            {t('share.header', 'Shared Drive Report')}
          </AppText>
        </View>

        {/* Hero map — interactive Leaflet map is unavailable on native, so the
            derived route summary is surfaced instead. */}
        {mapPoints.length > 1 ? (
          <FadeIn>
            <View style={styles.heroMap}>
              <MapTileLayer containerStyle={styles.heroTile} style="dark" />
              <GlassPanel style={styles.mapInfo}>
                <AppText variant="caption" weight="semibold">
                  {t('share.map.nativeTitle', 'Route map')}
                </AppText>
                <AppText tone="secondary" variant="caption">
                  {t(
                    'share.map.nativeUnavailable',
                    'The interactive route map is unavailable in this native parity component; the route summary is shown below.',
                  )}
                </AppText>
                <View style={styles.mapRow}>
                  <View
                    style={[styles.mapDot, {backgroundColor: START_MARKER_COLOR}]}
                  />
                  <AppText tone="secondary" variant="caption">
                    {`${t('share.map.start', 'Start')}: ${
                      startPos
                        ? `${startPos[0].toFixed(4)}, ${startPos[1].toFixed(4)}`
                        : DEFAULT_EMPTY_DISPLAY
                    }`}
                  </AppText>
                </View>
                <View style={styles.mapRow}>
                  <View
                    style={[styles.mapDot, {backgroundColor: END_MARKER_COLOR}]}
                  />
                  <AppText tone="secondary" variant="caption">
                    {`${t('share.map.end', 'End')}: ${
                      endPos
                        ? `${endPos[0].toFixed(4)}, ${endPos[1].toFixed(4)}`
                        : DEFAULT_EMPTY_DISPLAY
                    }`}
                  </AppText>
                </View>
                <View style={styles.mapRow}>
                  <View
                    style={[styles.mapDot, {backgroundColor: ROUTE_LINE_COLOR}]}
                  />
                  <AppText tone="muted" variant="caption">
                    {t(
                      'share.map.summary',
                      '{{count}} route points · center {{lat}}, {{lng}} · zoom {{zoom}}',
                      {
                        count: mapPoints.length,
                        lat: center[0].toFixed(4),
                        lng: center[1].toFixed(4),
                        zoom: MAP_ZOOM,
                      },
                    )}
                  </AppText>
                </View>
              </GlassPanel>
            </View>
          </FadeIn>
        ) : null}

        {/* Content */}
        <View style={styles.content}>
          {/* Title */}
          <FadeIn>
            <View style={styles.titleBlock}>
              <AppText variant="title" weight="bold">
                {data.title}
              </AppText>
              {data.description ? (
                <AppText tone="secondary" variant="body">
                  {data.description}
                </AppText>
              ) : null}
              <View style={styles.titleMeta}>
                <AppText tone="muted" variant="caption">
                  {drive.date}
                </AppText>
                {drive.start_address && drive.end_address ? (
                  <AppText tone="muted" variant="caption">
                    {`${drive.start_address} → ${drive.end_address}`}
                  </AppText>
                ) : null}
              </View>
            </View>
          </FadeIn>

          {/* Stats grid */}
          <FadeIn delay={0.05}>
            <View style={styles.statsGrid}>
              {stats.map(stat => (
                <StatCard
                  icon={stat.icon}
                  key={stat.label}
                  label={stat.label}
                  value={stat.value}
                />
              ))}
            </View>
          </FadeIn>

          {/* Vehicle badge */}
          {data.vehicle ? (
            <FadeIn delay={0.1}>
              <GlassPanel style={styles.vehicleBadge}>
                <View style={styles.vehicleIcon}>
                  <SemanticIcon decorative name="bolt" size="sm" />
                </View>
                <View style={styles.vehicleText}>
                  <AppText variant="body" weight="semibold">
                    {`Tesla ${data.vehicle.model}`}
                  </AppText>
                  <AppText tone="muted" variant="caption">
                    {data.vehicle.color}
                  </AppText>
                </View>
              </GlassPanel>
            </FadeIn>
          ) : null}

          {/* Elevation profile */}
          {elevationData.length > 0 ? (
            <FadeIn delay={0.15}>
              {/* chart-a11y:no-table dense per-sample shared-drive trace */}
              <ChartContainer
                ariaLabel={t(
                  'share.elevation.aria',
                  'Shared drive elevation profile area chart by distance',
                )}
                height={200}
                title={t('share.elevation', 'Elevation Profile')}>
                <AreaChartWrapper
                  data={elevationData}
                  height={200}
                  series={[
                    {
                      key: 'elevation',
                      label: t('share.elevTooltipLabel', 'Elevation'),
                      color: ROUTE_LINE_COLOR,
                    },
                  ]}
                  xFormatter={(v: string) =>
                    `${Math.round(Number(v))} ${distancePref}`
                  }
                  xKey="distance"
                  yFormatter={(v: number) => `${Math.round(v)} ${elevPref}`}
                />
              </ChartContainer>
            </FadeIn>
          ) : null}

          {/* Speed profile */}
          {speedData.length > 0 ? (
            <FadeIn delay={0.2}>
              {/* chart-a11y:no-table dense per-sample shared-drive trace */}
              <ChartContainer
                ariaLabel={t(
                  'share.speed.aria',
                  'Shared drive speed profile line chart by distance',
                )}
                height={200}
                title={t('share.speed', 'Speed Profile')}>
                <AreaChartWrapper
                  data={speedData}
                  height={200}
                  series={[
                    {
                      key: 'speed',
                      label: t('share.speedTooltipLabel', 'Speed'),
                      color: SPEED_LINE_COLOR,
                    },
                  ]}
                  xFormatter={(v: string) =>
                    `${Math.round(Number(v))} ${distancePref}`
                  }
                  xKey="distance"
                  yFormatter={(v: number) => `${Math.round(v)} ${speedPref}`}
                />
              </ChartContainer>
            </FadeIn>
          ) : null}

          {/* No map data fallback */}
          {mapPoints.length === 0 &&
          elevationData.length === 0 &&
          speedData.length === 0 ? (
            <GlassPanel style={styles.fallbackPanel}>
              <EmptyState
                /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<SemanticIcon decorative name="mapPinned" size="lg" />}
                message={t(
                  'share.noMapData',
                  'Route data is not available for this shared drive.',
                )}
              />
            </GlassPanel>
          ) : null}

          {/* Footer */}
          <FadeIn delay={0.25}>
            <View style={styles.footer}>
              <AppText style={styles.centeredText} tone="muted" variant="caption">
                {t(
                  'share.footer',
                  'Shared via TeslaSync — Self-hosted Tesla Fleet Intelligence',
                )}
              </AppText>
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  onNavigate?.('https://github.com/ev-dev-labs/teslasync')
                }>
                <AppText tone="accent" variant="caption">
                  {t('share.learnMore', 'Learn more →')}
                </AppText>
              </Pressable>
            </View>
          </FadeIn>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  centeredText: {
    textAlign: 'center',
  },
  content: {
    gap: spacing.lg,
    maxWidth: 720,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    width: '100%',
  },
  expiredCard: {
    alignItems: 'center',
    gap: spacing.md,
    maxWidth: 360,
    paddingHorizontal: spacing.lg,
  },
  expiredIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  fallbackPanel: {
    padding: spacing.xl,
  },
  footer: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  heroMap: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  heroTile: {
    minHeight: 200,
  },
  logo: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 9,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  logoGlyph: {
    color: colors.background,
  },
  mapDot: {
    borderRadius: 5,
    height: 10,
    marginTop: 3,
    width: 10,
  },
  mapInfo: {
    gap: spacing.xs,
    padding: spacing.md,
  },
  mapRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: spacing.xxl,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenCenter: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  statCard: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 140,
    padding: spacing.md,
  },
  statHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  statLabel: {
    flexShrink: 1,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  titleBlock: {
    gap: spacing.xs,
  },
  titleMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  vehicleBadge: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  vehicleIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  vehicleText: {
    flexShrink: 1,
  },
});
