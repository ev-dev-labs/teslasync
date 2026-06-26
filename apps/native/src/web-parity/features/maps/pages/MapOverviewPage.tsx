// Native parity port of web/src/features/maps/pages/MapOverviewPage.tsx.
//
// `MapOverviewPage` shows a vehicle's live GPS location and recent position
// history. It resolves the active vehicle, reads the user's speed/distance unit
// prefs, persists the chosen map tile style in URL state, then fans out into
// three queries: the latest position (`/vehicles/{id}/positions?limit=1`, polled
// every 15s), the last 50 positions (`/vehicles/{id}/positions?limit=50`), and
// the latest location snapshot (`/location-snapshots/latest?vehicle_id={id}`).
// From those it derives `hasValidLocation`, a `trailPositions` polyline, a
// time-ordered `playbackPoints` list, and a `historyColumns` table spec, then
// renders: a live map panel (or GPS-missing empty state), an optional route
// playback widget, four vehicle-status metric cards, a location-details grid
// (home / work / HomeLink / odometer), a quick-links row, and a recent-history
// DataTable. Every state name (`unitPrefs`, `speedUnit`, `distanceUnit`,
// `vehicleId`, `mapStyle`/`setMapStyle`, `vehiclesQuery`, `vehicles`,
// `vehiclesLoading`, `vehiclesError`, `selectedId`, `latest`/`latestLoading`/
// `latestError`, `history`/`historyLoading`/`historyError`, `locationDetails`,
// `anyError`, `isLoading`, `hasValidLocation`, `trailPositions`,
// `playbackPoints`, `vehicle`, `historyColumns`), the API paths + query
// gating/`refetchInterval`, the SI unit handling (display-boundary conversion
// only — speed via `convertSpeedFromSI`, odometer shown raw with the distance
// label exactly as the source), and every i18n key + English fallback are
// preserved verbatim.
//
// Web-only dependencies with no native-parity surface are mapped per the
// conversion contract (rules 4-7), each documented in the parity sidecar:
//   - react-i18next `useTranslation` (L2) -> a native i18n shim. i18next returns
//     the KEY when no translation/fallback exists, so the shim resolves
//     `t(key)` -> key and `t(key, 'English', params?)` -> the English fallback
//     with `{{token}}` interpolation. Used identically by the sibling page ports.
//   - `@tanstack/react-query` `useQuery` (L3) -> reused 1:1 (the native app
//     ships TanStack Query); the three queries keep their keys, queryFns, paths,
//     `enabled` gating, and the 15s `refetchInterval` verbatim. The latest-
//     position query is typed `<PositionRecord | null>` (not the source's
//     `<PositionRecord>`) because TanStack v5's strict `queryFn` must return the
//     declared type and the source resolves `arr?.[0] ?? null`; the runtime
//     value + every `latest`/`latest!` use is byte-identical.
//   - lucide-react icons (L4-7: MapPin/Compass/Gauge/Clock/Home/Briefcase/Link2/
//     Navigation/Route/Fence/LocateFixed/AlertCircle) are SVG with no native
//     analog -> decorative emoji glyphs via the local `Glyph`
//     (accessibilityElementsHidden); the adjacent label always carries meaning.
//   - `PageContainer` from @/components/layout (L9) -> the web-parity layout
//     PageContainer (reused; `title`/`subtitle`/`loading`/`error`/`actions`
//     match). The long body is wrapped in a ScrollView so every section stays
//     reachable (SleepEfficiencyPage/BatteryCellsPage precedent).
//   - `VehicleSelect` from @/components/forms (L10) -> a local read-only chip
//     (the header VehiclePicker is the web source of truth; interactive vehicle
//     switching is UNAVAILABLE on native, documented).
//   - `GlassPanel`/`Badge`/`Button`/`DataTable`/`Column` from @/components/ui
//     (L11) -> the shared native GlassPanel + the web-parity Badge + DataTable/
//     Column ports; `Button` -> a local Pressable mirroring the web Button API
//     (variant/size/icon/onClick). The quick-link buttons navigate via
//     `window.location.hash` on web — DOM hash routing is UNAVAILABLE on native,
//     so pressing one surfaces an explicit "navigation unavailable" note
//     (documented; the PageContainer CopyLinkButton precedent).
//   - `MetricCard`/`LiveIndicator`/`DataFreshnessAuto`/`TimeStamp` from
//     @/components/data-display (L12): DataFreshnessAuto + TimeStamp -> reused
//     web-parity ports; MetricCard -> a local card mirroring the web API
//     (label/value/icon/color/subtitle); LiveIndicator -> a local chip rendering
//     the web `unknown` quiet default (live wire-health monitoring needs
//     `useLiveConnection`/SSE which is UNAVAILABLE on native — the StatusBar port
//     precedent renders the same quiet default).
//   - `Skeleton`/`EmptyState`/`AlertBanner`/`LiveStaleDataBanner` from
//     @/components/feedback (L13) -> local native-safe shims: Skeleton = muted
//     rounded placeholder bars (`height`/`lines`); EmptyState = centred glyph +
//     muted message; AlertBanner = bordered tinted banner (info/warning/danger/
//     success) with icon + title + body + optional close; LiveStaleDataBanner
//     renders null (a >2min sustained-disconnect can't be detected without
//     `useLiveConnection`, so the banner stays hidden — the web common case).
//   - `FadeIn` from @/components/motion (L14) -> the web-parity motion barrel
//     (reused).
//   - the entire @/components/maps barrel (L15-22): MapContainer/Marker/Popup/
//     Polyline/MapTileLayer/MapInvalidator/MapLayerSwitcher/RoutePlayback/
//     vehicleIcon + the `MapStyle`/`PlaybackPoint` types. There is no Leaflet,
//     no DOM, and no `react-leaflet` in the native runtime, so the interactive
//     map cannot be drawn. Native-safe shims preserve every public prop and the
//     `MapStyle`/`PlaybackPoint` types, render an explicit "interactive map
//     unavailable on native" placeholder, and still surface the marker label +
//     coordinates + trail/playback summary as accessible text. `vehicleIcon`
//     returns a colour descriptor instead of an `L.DivIcon`. The
//     `MapLayerSwitcher` stays an interactive chip row that drives `mapStyle`
//     state (tile rendering has no visible effect since tiles are unavailable —
//     documented).
//   - `useVehicles` from @/api/hooks/useVehicles (L24) -> the reused web-parity
//     hook (GET `/vehicles`; `id`/`display_name` shape matches).
//   - `usePageTitle` (L25) -> a documented native-safe no-op (no DOM
//     document.title; the translated title still flows into PageContainer).
//   - `useSelectedVehicle` (L26) -> a local first-vehicle native shim (the web
//     resolves URL/path/store > first vehicle; native has no DOM URL or
//     cross-page selected-vehicle store, so it falls back to the first vehicle).
//   - `useUnits` (L27) -> a local speed+distance shim (the only surfaces this
//     page reads): `unitPrefs.speed`/`unitPrefs.distance` derived from
//     `unit_of_length` (`'mi' -> 'mph'/'mi'`, else `'km/h'/'km'`).
//   - `useUrlEnum` from @/hooks/useUrlState (L28) -> a native-safe `useState`
//     shim seeded with the same default ('dark') and the same allowed set; URL
//     persistence/sharing is UNAVAILABLE on native (documented). `setMapStyle`
//     still updates state for source compatibility.
//   - `NoVehicleSelected` from @/features/onboarding/components (L29) -> a local
//     native-safe guard card mirroring the web empty-onboarding intent
//     (`pageTitle` preserved).
//   - `formatDateTime` (@/lib/dateFormat, L30), `fmtNumber` (@/lib/numberFormat,
//     L31), `getErrorMessage` (@/lib/errorMessage, L33), `convertSpeedFromSI`
//     (@/lib/unitConversion, L34) -> inlined verbatim so rendered strings are
//     byte-identical (the native lib/format.ts diverges).
//   - `cn` from @/lib/cn (L32) is a className combiner with no native surface
//     (StyleSheet replaces Tailwind) -> dropped; conditional colours are computed
//     and applied via inline style.
//   - `request` from @/api/client (L35) -> the reused native api client request
//     (auto-prefixes /api/v1; same paths).
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported. Tailwind maps to StyleSheet: the `h-[400px]` map panel
// -> a fixed-height canvas; `grid grid-cols-2 lg:grid-cols-4` metric/detail grids
// -> flex-wrap rows of min-width cells; `flex items-center gap-3` detail rows ->
// flex rows; the `--text-primary/secondary/muted` tokens -> colors.text*. The
// long page body is wrapped in a ScrollView so every section stays reachable.

import React, {useMemo, useState, type ReactNode} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {PageContainer} from '../../../components/layout/PageContainer';
import {DataFreshnessAuto} from '../../../components/data-display/DataFreshness';
import {TimeStamp} from '../../../components/data-display/TimeStamp';
import {FadeIn} from '../../../components/motion';
import {Badge} from '../../../components/ui/Badge';
import {DataTable, type Column} from '../../../components/ui/DataTable';

/* ── i18n shim ─────────────────────────────────────────────────── */
// react-i18next has no native parity module. i18next resolves a missing
// translation to the KEY, so: `t(key)` -> key; `t(key, 'English')` -> 'English';
// `t(key, 'English', { params })` interpolates `{{token}}` from the params bag.
// The source also uses the i18next options form `t(key, { defaultValue, ...p })`
// (e.g. the speed/distance unit values), so the second arg accepts either a
// string fallback or an options object whose `defaultValue` is the template.
type TParams = Record<string, string | number | undefined>;
interface TOptions {
  defaultValue?: string;
  [param: string]: string | number | undefined;
}
type TFunc = (
  key: string,
  fallbackOrOptions?: string | TOptions,
  params?: TParams,
) => string;

function interpolate(template: string, params?: TParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) => {
    const value = params[token];
    return value == null ? match : String(value);
  });
}

const translate: TFunc = (key, fallbackOrOptions, params) => {
  if (fallbackOrOptions != null && typeof fallbackOrOptions === 'object') {
    const {defaultValue, ...rest} = fallbackOrOptions;
    const template = typeof defaultValue === 'string' ? defaultValue : key;
    return interpolate(template, rest);
  }
  const template =
    typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
  return interpolate(template, params);
};

function useTranslation(_ns?: string): {t: TFunc} {
  return {t: translate};
}

/* ── usePageTitle shim ─────────────────────────────────────────── */
// The web hook writes `document.title`; native has no DOM document, so this is a
// documented native-safe no-op. The translated title is still computed at the
// call site and rendered by PageContainer as the on-screen header.
function usePageTitle(title: string): void {
  React.useEffect(() => {
    return undefined;
  }, [title]);
}

/* ── numberFormat (inlined from web @/lib/numberFormat) ────────── */
// `safeNumber` collapses non-finite/non-number values to 0; `fmtNumber` is the
// locale-aware fixed-precision formatter (default precision 2, en-US fallback).
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

/* ── dateFormat (inlined from web @/lib/dateFormat) ────────────── */
// Full date + time: "Apr 4, 2026, 2:30 AM". Returns the "—" placeholder for
// null/undefined/unparseable input, matching the source verbatim.
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ── errorMessage (inlined from web @/lib/errorMessage) ────────── */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

/* ── unitConversion (inlined from web @/lib/unitConversion) ────── */
type SpeedUnitPref = 'km/h' | 'mph';
type DistanceUnitPref = 'km' | 'mi';

const SECONDS_PER_HOUR = 3600;
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;

function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

function deriveSpeed(unitOfLength: string | undefined): SpeedUnitPref {
  return unitOfLength === 'mi' ? 'mph' : 'km/h';
}

/* ── useUnits shim (speed + distance — the surfaces this page uses) ── */
// Mirrors the web `useUnits` speed/distance bridge: derive `unitPrefs.speed` and
// `unitPrefs.distance` from the user's `unit_of_length` setting. The page only
// reads those two prefs, so the other formatters are intentionally omitted.
function useUnits(): {
  unitPrefs: {speed: SpeedUnitPref; distance: DistanceUnitPref};
} {
  const {data: settings} = useSettings();
  const speed = deriveSpeed(settings?.unit_of_length);
  const distance = deriveDistance(settings?.unit_of_length);
  return useMemo(() => ({unitPrefs: {speed, distance}}), [speed, distance]);
}

/* ── useSelectedVehicle shim (native-safe; first vehicle in the fleet) ── */
// The web hook resolves URL path/query > persisted store > first vehicle. Native
// has no DOM URL and no cross-page selected-vehicle store, so selection falls
// back to the first vehicle in the fleet. The header VehiclePicker (the web
// source of truth) + the VehicleSelect chip are non-interactive on native.
function useSelectedVehicle(): {vehicleId: number | null} {
  const {data: vehicles} = useVehicles();
  const vehicleId = vehicles && vehicles.length > 0 ? vehicles[0].id : null;
  return {vehicleId};
}

/* ── useUrlEnum shim (native-safe; in-state enum, no URL persistence) ── */
// The web hook syncs the value to a URL query param so e.g. a satellite view can
// be shared. Native has no DOM URL, so URL persistence/sharing is UNAVAILABLE;
// the shim holds the value in component state seeded with the same default and
// validates writes against the same allowed set. `setValue` still updates state.
function useUrlEnum<E extends string>(
  _key: string,
  allowed: readonly E[],
  defaultValue: E,
): [E, (next: E) => void] {
  const [value, setValue] = useState<E>(defaultValue);
  const setChecked = React.useCallback(
    (next: E) => {
      if (allowed.includes(next)) {
        setValue(next);
      }
    },
    [allowed],
  );
  return [value, setChecked];
}

/* ── Decorative glyph (lucide icon substitute) ─────────────────── */
function Glyph({
  children,
  style,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={style}>
      {children}
    </AppText>
  );
}

/* ── Local EmptyState (web @/components/feedback EmptyState) ────── */
// Mirrors the web API (`{ message, icon? }`): a centred muted message with an
// optional decorative glyph. The shared native EmptyState requires a `title` the
// source never supplies, so this message-only shim stays faithful. The source's
// `no-action` empty-state intent is preserved (no recovery action available).
function EmptyState({message, icon}: {message: string; icon?: string}) {
  return (
    <View accessibilityRole="text" style={styles.emptyState}>
      {icon ? <Glyph style={styles.emptyIcon}>{icon}</Glyph> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ── Local Skeleton (web @/components/feedback Skeleton) ────────── */
// The web Skeleton is an animated shimmer placeholder. Native renders a static
// muted rounded bar; `lines` renders that many stacked bars, otherwise a single
// bar of `height`. `className` is accepted for source compatibility and ignored.
function Skeleton({
  height = 16,
  lines,
}: {
  height?: number;
  lines?: number;
  className?: string;
}) {
  if (lines && lines > 1) {
    return (
      <View
        accessibilityLabel="Loading"
        accessibilityRole="progressbar"
        style={styles.skeletonStack}>
        {Array.from({length: lines}).map((_, i) => (
          <View key={i} style={[styles.skeletonBar, {height}]} />
        ))}
      </View>
    );
  }
  return (
    <View
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      style={[styles.skeletonBar, {height}]}
    />
  );
}

/* ── Local AlertBanner (web @/components/feedback AlertBanner) ──── */
// Mirrors the web API (`{ variant, title?, children, onClose?, icon? }`): a
// bordered, tinted, in-flow banner. The web neon variant tints map to the
// toned-down native palette. `className` is accepted for source compatibility.
type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

const ALERT_TINT: Record<
  AlertVariant,
  {border: string; bg: string; text: string; title: string}
> = {
  info: {
    border: 'rgba(34, 211, 238, 0.2)',
    bg: 'rgba(34, 211, 238, 0.05)',
    text: 'rgba(165, 243, 252, 0.85)',
    title: '#67e8f9',
  },
  success: {
    border: 'rgba(52, 211, 153, 0.2)',
    bg: 'rgba(52, 211, 153, 0.05)',
    text: 'rgba(167, 243, 208, 0.85)',
    title: '#6ee7b7',
  },
  warning: {
    border: 'rgba(251, 191, 36, 0.2)',
    bg: 'rgba(251, 191, 36, 0.05)',
    text: 'rgba(253, 230, 138, 0.85)',
    title: '#fcd34d',
  },
  danger: {
    border: 'rgba(251, 113, 133, 0.2)',
    bg: 'rgba(251, 113, 133, 0.05)',
    text: 'rgba(254, 202, 202, 0.85)',
    title: '#fda4af',
  },
};

function AlertBanner({
  variant,
  title,
  children,
  onClose,
  icon,
}: {
  variant: AlertVariant;
  title?: string;
  children: ReactNode;
  onClose?: () => void;
  icon?: ReactNode;
  className?: string;
}) {
  const v = ALERT_TINT[variant];
  return (
    <View
      accessibilityRole="alert"
      style={[styles.alert, {borderColor: v.border, backgroundColor: v.bg}]}>
      {icon ? <View style={styles.alertIcon}>{icon}</View> : null}
      <View style={styles.alertBody}>
        {title ? (
          <AppText style={[styles.alertTitle, {color: v.title}]} weight="semibold">
            {title}
          </AppText>
        ) : null}
        {typeof children === 'string' ? (
          <AppText style={[styles.alertText, {color: v.text}, title ? styles.alertTextSpaced : null]}>
            {children}
          </AppText>
        ) : (
          <View style={title ? styles.alertTextSpaced : null}>{children}</View>
        )}
      </View>
      {onClose ? (
        <Pressable
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onClose}
          style={styles.alertClose}>
          <Glyph style={[styles.alertCloseGlyph, {color: v.text}]}>✕</Glyph>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ── Local LiveStaleDataBanner (web @/components/feedback) ──────── */
// The web banner shows once the live pipe has been `disconnected` for >2min,
// driven by `useLiveConnection`. Native has no SSE live-connection wiring (the
// StatusBar port renders the same quiet default), so a sustained outage can't be
// detected and the banner stays hidden — matching the web common case where the
// pipe is healthy. Renders null. `className` accepted for source compatibility.
function LiveStaleDataBanner(_props: {className?: string}): React.ReactElement | null {
  return null;
}

/* ── Local LiveIndicator (web @/components/data-display LiveIndicator) ── */
// The web indicator reflects the HEALTH OF THE WIRE via `useLiveConnection`
// (connected/reconnecting/disconnected/unknown). Native has no live-connection
// hook, so it renders the web `unknown` quiet default — a muted chip labelled
// "Unknown" (the same fallback the StatusBar port renders). `variant` is
// accepted; the compact/pill/dot shapes resolve to the same muted chip here.
function LiveIndicator({
  variant = 'pill',
}: {
  variant?: 'pill' | 'dot' | 'compact';
  className?: string;
}) {
  const {t} = useTranslation();
  const label = t('live.unknown', 'Unknown');
  if (variant === 'dot') {
    return (
      <View
        accessibilityLabel={label}
        accessibilityRole="image"
        style={styles.liveDot}
      />
    );
  }
  return (
    <View accessibilityLabel={label} accessibilityRole="text" style={styles.liveChip}>
      <Glyph style={styles.liveGlyph}>📶</Glyph>
      <AppText style={styles.liveLabel} variant="caption">
        {label}
      </AppText>
    </View>
  );
}

/* ── Local MetricCard (web @/components/data-display MetricCard) ── */
// Mirrors the web MetricCard public surface this page uses (label/value/icon/
// color/subtitle). The web NeonColor maps to the SI palette; only the icon chip
// is tinted (the value stays text-primary, as on the web).
type MetricColor = 'cyan' | 'green' | 'amber' | 'purple' | 'red';

const METRIC_TINT: Record<MetricColor, string> = {
  cyan: colors.accent,
  green: colors.success,
  amber: colors.warning,
  purple: colors.violet,
  red: colors.danger,
};

function MetricCard({
  label,
  value,
  icon,
  color = 'cyan',
  subtitle,
}: {
  label: string;
  value: string | number;
  icon?: string;
  color?: MetricColor;
  subtitle?: string;
}) {
  const tint = METRIC_TINT[color];
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricRow}>
        <View style={styles.metricTextBlock}>
          <AppText
            numberOfLines={1}
            style={styles.metricLabel}
            tone="muted"
            variant="caption">
            {label}
          </AppText>
          <AppText style={styles.metricValue} weight="bold">
            {value}
          </AppText>
          {subtitle ? (
            <AppText
              numberOfLines={1}
              style={styles.metricSubtitle}
              tone="muted"
              variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {icon ? (
          <View
            style={[
              styles.metricIcon,
              {borderColor: `${tint}55`, backgroundColor: `${tint}1f`},
            ]}>
            <Glyph style={[styles.metricIconGlyph, {color: tint}]}>{icon}</Glyph>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ── Local Button (web @/components/ui Button) ─────────────────── */
// Mirrors the web Button surface this page uses (variant/size/icon/onClick →
// onPress + children). Rendered as a Pressable; the leading lucide icon becomes a
// decorative glyph. `size` is accepted for source compatibility (the `sm` chips
// resolve to the same compact button here).
function Button({
  variant = 'primary',
  icon,
  onPress,
  children,
}: {
  variant?: 'primary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'outline' ? styles.buttonOutline : styles.buttonPrimary,
        pressed ? styles.buttonPressed : null,
      ]}>
      {icon ? <Glyph style={styles.buttonGlyph}>{icon}</Glyph> : null}
      <AppText
        style={variant === 'outline' ? styles.buttonOutlineText : styles.buttonPrimaryText}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </Pressable>
  );
}

/* ── Local VehicleSelect (web @/components/forms VehicleSelect) ── */
// Read-only on native: shows the resolved vehicle name. The header VehiclePicker
// is the web source of truth; interactive vehicle switching is UNAVAILABLE on
// native (documented).
function VehicleSelect() {
  const {data: vehicles} = useVehicles();
  const {vehicleId} = useSelectedVehicle();
  const name =
    vehicles?.find(v => v.id === vehicleId)?.display_name ??
    translate('All Vehicles');
  return (
    <View accessibilityRole="text" style={styles.vehicleChip}>
      <Glyph style={styles.vehicleChipGlyph}>🚗</Glyph>
      <AppText
        numberOfLines={1}
        style={styles.vehicleChipText}
        variant="caption"
        weight="semibold">
        {name}
      </AppText>
    </View>
  );
}

/* ── Local NoVehicleSelected (web @/features/onboarding/components) ── */
// Native-safe parity of the web onboarding empty-state shown when no vehicle is
// resolved. Mirrors the `pageTitle` prop + the "select a vehicle" guidance.
function NoVehicleSelected({pageTitle}: {pageTitle: string}) {
  const {t} = useTranslation();
  return (
    <PageContainer title={pageTitle}>
      <GlassPanel style={styles.guardPanel}>
        <Glyph style={styles.guardGlyph}>🚗</Glyph>
        <AppText style={styles.guardTitle} weight="semibold">
          {t('onboarding.noVehicle.title', 'No vehicle selected')}
        </AppText>
        <AppText style={styles.guardMessage} tone="muted">
          {t(
            'onboarding.noVehicle.message',
            'Select a vehicle to view its data.',
          )}
        </AppText>
      </GlassPanel>
    </PageContainer>
  );
}

/* ── Maps barrel shims (web @/components/maps) ─────────────────── */
// There is no Leaflet, no DOM, and no react-leaflet in the native runtime, so
// the interactive map cannot be drawn. These native-safe shims preserve every
// public prop + the `MapStyle`/`PlaybackPoint` types and render explicit
// "unavailable" placeholders that still surface the location/trail/playback data
// as accessible text. See `nativeMapCapabilities` for the unavailable surfaces.
export type MapStyle = 'dark' | 'satellite' | 'streets' | 'terrain';

export interface PlaybackPoint {
  lat: number;
  lng: number;
  /** ISO-8601 timestamp. */
  timestamp: string;
  speed?: number;
  soc?: number;
  power?: number;
}

export const nativeMapCapabilities = {
  leafletMapAvailable: false,
  tileLayersAvailable: false,
  interactiveMarkersAvailable: false,
  routePlaybackAvailable: false,
  urlStatePersistenceAvailable: false,
} as const;

/** Native-safe replacement for the leaflet `L.DivIcon` vehicle marker icon. */
interface VehicleIconDescriptor {
  color: string;
  size: number;
}

function vehicleIcon(color = '#00f0ff'): VehicleIconDescriptor {
  return {color, size: 28};
}

const MAP_LAYERS: {id: MapStyle; icon: string; label: string}[] = [
  {id: 'dark', icon: '🌑', label: 'Dark'},
  {id: 'satellite', icon: '🛰️', label: 'Satellite'},
  {id: 'streets', icon: '🗺️', label: 'Streets'},
  {id: 'terrain', icon: '⛰️', label: 'Terrain'},
];

function MapLayerSwitcher({
  current,
  onChange,
}: {
  current: MapStyle;
  onChange: (style: MapStyle) => void;
}) {
  return (
    <View style={styles.layerSwitcher}>
      {MAP_LAYERS.map(l => {
        const active = current === l.id;
        return (
          <Pressable
            accessibilityLabel={l.label}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            key={l.id}
            onPress={() => onChange(l.id)}
            style={({pressed}) => [
              styles.layerChip,
              active ? styles.layerChipActive : null,
              pressed ? styles.buttonPressed : null,
            ]}>
            <Glyph style={styles.layerChipGlyph}>{l.icon}</Glyph>
            <AppText
              style={active ? styles.layerChipTextActive : styles.layerChipText}
              variant="caption"
              weight="semibold">
              {l.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Tile layer — UNAVAILABLE on native (no raster tiles); renders nothing. */
function MapTileLayer(_props: {style?: MapStyle}): null {
  return null;
}

/** Leaflet tile-grid invalidator — no map to invalidate on native; null. */
function MapInvalidator(): null {
  return null;
}

/**
 * Native-safe Marker. The web component drops an `L.DivIcon` on the leaflet map;
 * native renders a small coloured dot (from the icon descriptor) plus the bound
 * Popup label so the vehicle's identity + position is still conveyed.
 */
function Marker({
  position,
  icon,
  children,
}: {
  position: [number, number];
  icon?: VehicleIconDescriptor;
  children?: ReactNode;
}) {
  const dotColor = icon?.color ?? '#00f0ff';
  return (
    <View accessibilityRole="text" style={styles.markerRow}>
      <View style={[styles.markerDot, {backgroundColor: dotColor}]} />
      <View style={styles.markerBody}>
        {children}
        <AppText style={styles.markerCoords} tone="muted" variant="caption">
          {`${fmtNumber(position[0], 5)}, ${fmtNumber(position[1], 5)}`}
        </AppText>
      </View>
    </View>
  );
}

/** Native-safe Popup — renders its label content inline (no floating bubble). */
function Popup({children}: {children?: ReactNode}) {
  return (
    <AppText style={styles.popupText} weight="semibold">
      {children}
    </AppText>
  );
}

/**
 * Native-safe Polyline. The web component draws a coloured trail on the leaflet
 * map; native summarises the trail (point count + colour swatch) as accessible
 * text since there is no map canvas to draw on.
 */
function Polyline({
  positions,
  color = '#00f0ff',
}: {
  positions: [number, number][];
  color?: string;
  weight?: number;
  opacity?: number;
}) {
  const {t} = useTranslation();
  return (
    <View accessibilityRole="text" style={styles.trailRow}>
      <View style={[styles.trailSwatch, {backgroundColor: color}]} />
      <AppText style={styles.trailText} tone="muted" variant="caption">
        {t('mapOverview.trailSummary', '{{count}} recent points', {
          count: positions.length,
        })}
      </AppText>
    </View>
  );
}

/**
 * Native-safe MapContainer. There is no leaflet map, so this renders a fixed
 * "interactive map unavailable on native" canvas and then the child markers /
 * trails (which surface the location data as accessible text). Every public prop
 * (`center`/`zoom`/`scrollWheelZoom`/`className`) is accepted for source
 * compatibility; only `children` + `style` affect the native render.
 */
function MapContainer({
  children,
  style,
}: {
  center?: [number, number];
  zoom?: number;
  scrollWheelZoom?: boolean;
  className?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const {t} = useTranslation();
  return (
    <View
      accessibilityRole="summary"
      style={[styles.mapCanvas, style]}
      testID="map-canvas">
      <View style={styles.mapUnavailable}>
        <Glyph style={styles.mapUnavailableGlyph}>🗺️</Glyph>
        <AppText style={styles.mapUnavailableText} tone="muted" variant="caption">
          {t(
            'mapOverview.mapUnavailable',
            'Interactive map is unavailable on this device',
          )}
        </AppText>
      </View>
      <View style={styles.mapOverlayInfo}>{children}</View>
    </View>
  );
}

/**
 * Native-safe RoutePlayback. The web widget animates a marker along a leaflet
 * trail with scrubbable controls; native has no map, so it summarises the
 * playback set (point count + time span) as accessible text. Every public prop
 * is accepted; `points`/`ariaLabel` drive the native summary.
 */
function RoutePlayback({
  points,
  ariaLabel,
  height = 400,
}: {
  points: PlaybackPoint[];
  ariaLabel?: string;
  height?: number | string;
  emptyMessage?: string;
}) {
  const {t} = useTranslation();
  const first = points[0];
  const last = points[points.length - 1];
  const heightStyle: ViewStyle =
    typeof height === 'number' ? {minHeight: Math.min(height, 200)} : {};
  return (
    <View
      accessibilityLabel={ariaLabel}
      accessibilityRole="summary"
      style={[styles.playbackBox, heightStyle]}>
      <Glyph style={styles.playbackGlyph}>🎞️</Glyph>
      <AppText style={styles.playbackText} tone="muted" variant="caption">
        {t(
          'mapOverview.playbackUnavailable',
          'Route playback is unavailable on this device',
        )}
      </AppText>
      <AppText style={styles.playbackSummary} tone="secondary" variant="caption">
        {t('mapOverview.trailSummary', '{{count}} recent points', {
          count: points.length,
        })}
      </AppText>
      {first && last ? (
        <AppText style={styles.playbackSpan} tone="muted" variant="caption">
          {`${formatDateTime(first.timestamp)} → ${formatDateTime(last.timestamp)}`}
        </AppText>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LocationSnapshot {
  id: number;
  vehicle_id: number;
  located_at_home: boolean;
  located_at_work: boolean;
  locatedAtHome?: boolean;
  locatedAtWork?: boolean;
  homelink_nearby: boolean;
  active_route: boolean;
  destination_name: string;
  created_at: string;
}

interface PositionRecord {
  id: number;
  vehicle_id: number;
  latitude: number;
  longitude: number;
  speed: number | null;
  power: number | null;
  heading: number | null;
  elevation: number | null;
  odometer: number;
  battery_level: number;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MapOverviewPage() {
  const {t} = useTranslation('maps');
  usePageTitle(t('mapOverview.pageTitle', 'Map Overview'));

  /* ---- unit prefs ---- */
  const {unitPrefs} = useUnits();
  const speedUnit = unitPrefs.speed;
  const distanceUnit = unitPrefs.distance;

  /* ---- vehicle selector: header VehiclePicker is the source of truth ---- */
  const {vehicleId} = useSelectedVehicle();
  // Map style lives in the URL so a satellite view can be shared.
  const [mapStyle, setMapStyle] = useUrlEnum<MapStyle>(
    'layer',
    ['dark', 'satellite', 'streets', 'terrain'] as const,
    'dark',
  );

  /* ---- queries ---- */
  const vehiclesQuery = useVehicles();
  const {
    data: vehicles,
    isLoading: vehiclesLoading,
    error: vehiclesError,
  } = vehiclesQuery;

  const selectedId = vehicleId != null ? String(vehicleId) : '';

  const {
    data: latest,
    isLoading: latestLoading,
    error: latestError,
  } = useQuery<PositionRecord | null>({
    queryKey: ['position-latest', selectedId],
    queryFn: () =>
      request<PositionRecord[]>(
        `/vehicles/${selectedId}/positions?limit=1`,
      ).then((arr) => arr?.[0] ?? null),
    enabled: selectedId !== '',
    refetchInterval: 15_000,
  });

  const {
    data: history,
    isLoading: historyLoading,
    error: historyError,
  } = useQuery<PositionRecord[]>({
    queryKey: ['position-history', selectedId],
    queryFn: () =>
      request<PositionRecord[]>(
        `/vehicles/${selectedId}/positions?limit=50`,
      ),
    enabled: selectedId !== '',
  });

  const {
    data: locationDetails,
  } = useQuery<LocationSnapshot>({
    queryKey: ['location-latest', selectedId],
    queryFn: () =>
      request<LocationSnapshot>(
        `/location-snapshots/latest?vehicle_id=${selectedId}`,
      ),
    enabled: selectedId !== '',
  });

  /* ---- derived ---- */
  const anyError = [vehiclesError, latestError, historyError].find(Boolean);
  const isLoading = vehiclesLoading || latestLoading;
  const hasValidLocation = latest != null
    && typeof latest.latitude === 'number'
    && typeof latest.longitude === 'number'
    && (latest.latitude !== 0 || latest.longitude !== 0);

  const trailPositions = useMemo(
    () => (history ?? [])
      .filter((s) => typeof s.latitude === 'number' && typeof s.longitude === 'number' && (s.latitude !== 0 || s.longitude !== 0))
      .map((s) => [s.latitude, s.longitude] as [number, number]),
    [history],
  );

  /* Time-ordered points for the optional `<RoutePlayback>` widget. The
     /positions endpoint returns most-recent-first, so we reverse here. */
  const playbackPoints = useMemo<PlaybackPoint[]>(() => {
    const list = (history ?? [])
      .filter(
        (s) =>
          typeof s.latitude === 'number' &&
          typeof s.longitude === 'number' &&
          (s.latitude !== 0 || s.longitude !== 0) &&
          !!s.created_at,
      )
      .map((s) => ({
        lat: s.latitude,
        lng: s.longitude,
        timestamp: s.created_at,
        speed: s.speed ?? undefined,
        soc: s.battery_level ?? undefined,
        power: s.power ?? undefined,
      }));
    /* Sort ascending by timestamp so playback runs forward in time. */
    list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return list;
  }, [history]);

  const vehicle = vehicles?.find((v) => String(v.id) === selectedId);

  // The web quick-link buttons set `window.location.hash`; DOM hash routing is
  // UNAVAILABLE on native, so pressing one records the attempt and the page
  // surfaces an explicit "navigation unavailable" note (CopyLinkButton precedent).
  const [navAttempted, setNavAttempted] = useState(false);
  const goToHash = React.useCallback((_hash: string) => {
    setNavAttempted(true);
  }, []);

  /* ---- history table columns ---- */
  const historyColumns: Column<PositionRecord>[] = useMemo(
    () => [
      {
        key: 'time',
        header: t('mapOverview.colTime', 'Time'),
        render: (r) => (
          <TimeStamp value={r.created_at} style={styles.cellMono} />
        ),
      },
      {
        key: 'latitude',
        header: t('mapOverview.colLat', 'Lat'),
        render: (r) => (
          <AppText style={styles.cellMono} variant="caption">
            {r.latitude !== 0 || r.longitude !== 0 ? fmtNumber(r.latitude, 5) : '—'}
          </AppText>
        ),
      },
      {
        key: 'longitude',
        header: t('mapOverview.colLon', 'Lon'),
        render: (r) => (
          <AppText style={styles.cellMono} variant="caption">
            {r.latitude !== 0 || r.longitude !== 0 ? fmtNumber(r.longitude, 5) : '—'}
          </AppText>
        ),
      },
      {
        key: 'speed',
        header: t('mapOverview.colSpeed', 'Speed'),
        render: (r) => (
          <AppText style={styles.cellText} variant="caption">
            {fmtNumber(convertSpeedFromSI(r.speed ?? 0, speedUnit), 1)}{' '}
            {t('mapOverview.speedUnitValue', {defaultValue: '{{unit}}', unit: speedUnit})}
          </AppText>
        ),
      },
      {
        key: 'heading',
        header: t('mapOverview.colHeading', 'Heading'),
        render: (r) => (
          <AppText style={styles.cellText} variant="caption">
            {r.heading != null ? `${fmtNumber(r.heading, 0)}°` : '—'}
          </AppText>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, speedUnit],
  );

  // Defensive guard: no vehicle selected.
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('mapOverview.title', 'Map Overview')} />;
  }

  /* ---- render ---- */
  return (
    <PageContainer
      title={t('mapOverview.title', 'Map Overview')}
      subtitle={t(
        'mapOverview.subtitle',
        'Live vehicle location and recent history',
      )}
      loading={vehiclesLoading}
      error={vehiclesError as Error | null}
      actions={
        <View style={styles.actions}>
          <VehicleSelect />
          <DataFreshnessAuto query={vehiclesQuery} />
          <LiveIndicator variant="compact" />
        </View>
      }>
      <ScrollView contentContainerStyle={styles.body}>
        <LiveStaleDataBanner />
        {anyError ? (
          <AlertBanner variant="danger" icon={<Glyph style={styles.alertGlyph}>⚠️</Glyph>}>
            {`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(anyError)}`}
          </AlertBanner>
        ) : null}

        {/* ---- GPS data warning ---- */}
        {!hasValidLocation && latest ? (
          <AlertBanner variant="info">
            {t('mapOverview.noGps', 'GPS coordinates not available. Location data requires Fleet Telemetry HTTP streaming.')}
          </AlertBanner>
        ) : null}

        {/* ---- Map ---- */}
        <FadeIn>
          <GlassPanel style={styles.mapPanel}>
            {hasValidLocation ? (
              <View style={styles.mapWrap}>
                <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
                <MapContainer
                  center={[latest!.latitude, latest!.longitude]}
                  zoom={15}
                  scrollWheelZoom
                  style={styles.mapCanvasFull}>
                  <MapTileLayer style={mapStyle} />
                  <MapInvalidator />
                  <Marker position={[latest!.latitude, latest!.longitude]} icon={vehicleIcon()}>
                    <Popup>{vehicle?.display_name ?? t('mapOverview.vehicle', 'Vehicle')}</Popup>
                  </Marker>
                  {trailPositions.length > 1 ? (
                    <Polyline positions={trailPositions} color="#00f0ff" weight={3} opacity={0.7} />
                  ) : null}
                </MapContainer>
              </View>
            ) : (
              <EmptyState
                icon="📍"
                message={t(
                  'mapOverview.noLocation',
                  'No GPS data available. Location data requires Fleet Telemetry streaming.',
                )}
              />
            )}
          </GlassPanel>
        </FadeIn>

        {/* ---- Recent route playback ---- */}
        {playbackPoints.length > 1 ? (
          <FadeIn delay={0.04}>
            <GlassPanel style={styles.panelPad}>
              <AppText style={styles.sectionHeading} weight="semibold">
                {t('mapOverview.recentPlayback', 'Recent Route Playback')}
              </AppText>
              <RoutePlayback
                points={playbackPoints}
                height={360}
                ariaLabel={t('mapOverview.playbackLabel', 'Recent route playback map')}
              />
            </GlassPanel>
          </FadeIn>
        ) : null}

        {/* ---- Vehicle status metric cards ---- */}
        {isLoading ? (
          <View style={styles.metricGrid}>
            {Array.from({length: 4}).map((_, i) => (
              <View key={i} style={styles.metricSkeletonCell}>
                <Skeleton height={88} />
              </View>
            ))}
          </View>
        ) : latest ? (
          <FadeIn delay={0.05}>
            <View style={styles.metricGrid}>
              <View style={styles.metricCell}>
                <MetricCard
                  label={t('mapOverview.currentSpeed', 'Current Speed')}
                  value={`${fmtNumber(convertSpeedFromSI(latest.speed ?? 0, speedUnit), 1)} ${t('mapOverview.speedUnitValue', {defaultValue: '{{unit}}', unit: speedUnit})}`}
                  icon="🎛️"
                  color="cyan"
                />
              </View>
              <View style={styles.metricCell}>
                <MetricCard
                  label={t('mapOverview.heading', 'Heading')}
                  value={latest.heading != null ? `${fmtNumber(latest.heading, 0)}°` : '—'}
                  icon="🧭"
                  color="purple"
                />
              </View>
              <View style={styles.metricCell}>
                <MetricCard
                  label={t('mapOverview.latLon', 'Lat / Lon')}
                  value={hasValidLocation ? `${fmtNumber(latest!.latitude, 4)}, ${fmtNumber(latest!.longitude, 4)}` : '—'}
                  icon="📍"
                  color="green"
                />
              </View>
              <View style={styles.metricCell}>
                <MetricCard
                  label={t('mapOverview.lastUpdated', 'Last Updated')}
                  value={formatDateTime(latest.created_at)}
                  icon="🕐"
                  subtitle={t('mapOverview.autoRefresh', 'Auto-refreshes every 15 s')}
                />
              </View>
            </View>
          </FadeIn>
        ) : null}

        {/* ---- Location details ---- */}
        <FadeIn delay={0.1}>
          <GlassPanel style={styles.panelPadLg}>
            <AppText style={styles.sectionHeadingLg} weight="semibold">
              {t('mapOverview.locationDetails', 'Location Details')}
            </AppText>
            {latest || locationDetails ? (
              <View style={styles.detailGrid}>
                {/* Home */}
                <View style={styles.detailRow}>
                  <Glyph
                    style={[
                      styles.detailGlyph,
                      {
                        color: (locationDetails?.located_at_home ?? locationDetails?.locatedAtHome)
                          ? '#34d399'
                          : colors.textMuted,
                      },
                    ]}>
                    🏠
                  </Glyph>
                  <AppText style={styles.detailLabel} tone="secondary">
                    {t('mapOverview.atHome', 'At Home')}
                  </AppText>
                  <Badge
                    variant={(locationDetails?.located_at_home ?? locationDetails?.locatedAtHome) === true ? 'success' : 'neutral'}
                    size="sm"
                    dot>
                    {(locationDetails?.located_at_home ?? locationDetails?.locatedAtHome) === true
                      ? t('mapOverview.yes', 'Yes')
                      : (locationDetails?.located_at_home ?? locationDetails?.locatedAtHome) === false
                        ? t('mapOverview.no', 'No')
                        : t('mapOverview.unknown', 'Unknown')}
                  </Badge>
                </View>

                {/* Work */}
                <View style={styles.detailRow}>
                  <Glyph
                    style={[
                      styles.detailGlyph,
                      {
                        color: (locationDetails?.located_at_work ?? locationDetails?.locatedAtWork)
                          ? '#34d399'
                          : colors.textMuted,
                      },
                    ]}>
                    💼
                  </Glyph>
                  <AppText style={styles.detailLabel} tone="secondary">
                    {t('mapOverview.atWork', 'At Work')}
                  </AppText>
                  <Badge
                    variant={(locationDetails?.located_at_work ?? locationDetails?.locatedAtWork) === true ? 'success' : 'neutral'}
                    size="sm"
                    dot>
                    {(locationDetails?.located_at_work ?? locationDetails?.locatedAtWork) === true
                      ? t('mapOverview.yes', 'Yes')
                      : (locationDetails?.located_at_work ?? locationDetails?.locatedAtWork) === false
                        ? t('mapOverview.no', 'No')
                        : t('mapOverview.unknown', 'Unknown')}
                  </Badge>
                </View>

                {/* HomeLink nearby */}
                <View style={styles.detailRow}>
                  <Glyph
                    style={[
                      styles.detailGlyph,
                      {color: locationDetails?.homelink_nearby ? colors.accent : colors.textMuted},
                    ]}>
                    🔗
                  </Glyph>
                  <AppText style={styles.detailLabel} tone="secondary">
                    {t('mapOverview.homelinkNearby', 'HomeLink Nearby')}
                  </AppText>
                  <Badge
                    variant={locationDetails?.homelink_nearby ? 'info' : 'neutral'}
                    size="sm"
                    dot>
                    {locationDetails?.homelink_nearby
                      ? t('mapOverview.yes', 'Yes')
                      : t('mapOverview.no', 'No')}
                  </Badge>
                </View>

                {/* Odometer */}
                <View style={styles.detailRow}>
                  <Glyph style={[styles.detailGlyph, {color: colors.violet}]}>🧭</Glyph>
                  <AppText style={styles.detailLabel} tone="secondary">
                    {t('mapOverview.odometer', 'Odometer')}
                  </AppText>
                  <AppText style={styles.detailValue} weight="semibold">
                    {latest && typeof latest.odometer === 'number'
                      ? `${fmtNumber(latest.odometer, 1)} ${t('mapOverview.distanceUnitValue', {defaultValue: '{{unit}}', unit: distanceUnit})}`
                      : '—'}
                  </AppText>
                </View>
              </View>
            ) : (
              <EmptyState message={t('mapOverview.noLocation', 'No location data available yet')} />
            )}
          </GlassPanel>
        </FadeIn>

        {/* ---- Quick links ---- */}
        <FadeIn delay={0.15}>
          <GlassPanel style={styles.quickLinksPanel}>
            <AppText style={styles.quickLinksLabel} tone="muted" variant="caption" weight="semibold">
              {t('mapOverview.quickLinks', 'Quick Links')}
            </AppText>
            <View style={styles.quickLinksRow}>
              <Button
                variant="outline"
                size="sm"
                icon="🛣️"
                onPress={() => goToHash('#/maps/navigation-route')}>
                {t('mapOverview.navRoute', 'Navigation Route')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon="📐"
                onPress={() => goToHash('#/maps/geofences')}>
                {t('mapOverview.geofences', 'Geofences')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon="🎯"
                onPress={() => goToHash('#/maps/locations')}>
                {t('mapOverview.locations', 'Locations')}
              </Button>
            </View>
            {navAttempted ? (
              <AppText
                accessibilityLiveRegion="polite"
                style={styles.navUnavailable}
                tone="muted"
                variant="caption">
                {t(
                  'mapOverview.navUnavailable',
                  'In-app navigation to other map views is unavailable on this device.',
                )}
              </AppText>
            ) : null}
          </GlassPanel>
        </FadeIn>

        {/* ---- Recent location history table ---- */}
        <FadeIn delay={0.2}>
          <GlassPanel style={styles.panelPadLg}>
            <AppText style={styles.sectionHeadingLg} weight="semibold">
              {t('mapOverview.recentHistory', 'Recent Location History')}
            </AppText>

            {historyLoading ? (
              <Skeleton lines={6} height={16} />
            ) : history && history.length > 0 ? (
              <DataTable<PositionRecord>
                tableId="maps:overview-history"
                columns={historyColumns}
                data={history}
                keyExtractor={(r) => r.id}
                emptyMessage={t(
                  'mapOverview.noHistory',
                  'No location history found.',
                )}
                compact
                pagination
              />
            ) : (
              <EmptyState
                icon="🕐"
                message={t(
                  'mapOverview.noHistory',
                  'No location history found.',
                )}
              />
            )}
          </GlassPanel>
        </FadeIn>
      </ScrollView>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  alert: {
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  alertBody: {
    flex: 1,
    minWidth: 0,
  },
  alertClose: {
    borderRadius: 8,
    padding: spacing.xs,
  },
  alertCloseGlyph: {
    fontSize: 13,
  },
  alertGlyph: {
    fontSize: 18,
  },
  alertIcon: {
    marginTop: 1,
  },
  alertText: {
    fontSize: 12,
    lineHeight: 17,
  },
  alertTextSpaced: {
    marginTop: 2,
  },
  alertTitle: {
    fontSize: 13,
  },
  body: {
    gap: 24,
    paddingBottom: spacing.xl,
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 34,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  buttonGlyph: {
    fontSize: 13,
  },
  buttonOutline: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonOutlineText: {
    color: colors.textPrimary,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonPrimaryText: {
    color: colors.background,
  },
  cellMono: {
    fontSize: 12,
  },
  cellText: {
    fontSize: 12,
  },
  detailGlyph: {
    fontSize: 18,
    width: 22,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  detailLabel: {
    flex: 1,
    fontSize: 13,
  },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minWidth: 220,
  },
  detailValue: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  emptyIcon: {
    fontSize: 28,
    marginBottom: spacing.sm,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  guardGlyph: {
    fontSize: 34,
    marginBottom: spacing.sm,
  },
  guardMessage: {
    textAlign: 'center',
  },
  guardPanel: {
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.xl,
  },
  guardTitle: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  layerChip: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  layerChipActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  layerChipGlyph: {
    fontSize: 12,
  },
  layerChipText: {
    color: colors.textSecondary,
  },
  layerChipTextActive: {
    color: colors.textPrimary,
  },
  layerSwitcher: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  liveChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  liveDot: {
    backgroundColor: colors.textMuted,
    borderRadius: 9999,
    height: 8,
    width: 8,
  },
  liveGlyph: {
    fontSize: 11,
  },
  liveLabel: {
    color: colors.textMuted,
  },
  mapCanvas: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  mapCanvasFull: {
    width: '100%',
  },
  mapOverlayInfo: {
    gap: spacing.sm,
    width: '100%',
  },
  mapPanel: {
    height: 400,
    overflow: 'hidden',
  },
  mapUnavailable: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  mapUnavailableGlyph: {
    fontSize: 30,
  },
  mapUnavailableText: {
    textAlign: 'center',
  },
  mapWrap: {
    flex: 1,
  },
  markerBody: {
    flex: 1,
    gap: 2,
  },
  markerCoords: {
    fontSize: 11,
  },
  markerDot: {
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 9999,
    borderWidth: 2,
    height: 14,
    marginTop: 2,
    width: 14,
  },
  markerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    padding: spacing.md,
  },
  metricCell: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 150,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricIcon: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  metricIconGlyph: {
    fontSize: 15,
  },
  metricLabel: {
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  metricRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  metricSkeletonCell: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 150,
  },
  metricSubtitle: {
    marginTop: 2,
  },
  metricTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 20,
    marginTop: 2,
  },
  navUnavailable: {
    marginTop: spacing.sm,
    width: '100%',
  },
  panelPad: {
    padding: spacing.md,
  },
  panelPadLg: {
    padding: spacing.lg,
  },
  playbackBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  playbackGlyph: {
    fontSize: 26,
  },
  playbackSpan: {
    textAlign: 'center',
  },
  playbackSummary: {
    textAlign: 'center',
  },
  playbackText: {
    textAlign: 'center',
  },
  popupText: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  quickLinksLabel: {
    width: '100%',
  },
  quickLinksPanel: {
    gap: spacing.md,
    padding: spacing.md,
  },
  quickLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sectionHeading: {
    color: colors.textPrimary,
    fontSize: 13,
    marginBottom: spacing.md,
  },
  sectionHeadingLg: {
    color: colors.textPrimary,
    fontSize: 13,
    marginBottom: spacing.lg,
  },
  skeletonBar: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
  },
  skeletonStack: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  trailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  trailSwatch: {
    borderRadius: 2,
    height: 4,
    width: 24,
  },
  trailText: {
    flex: 1,
  },
  vehicleChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: 180,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  vehicleChipGlyph: {
    fontSize: 12,
  },
  vehicleChipText: {
    color: colors.textPrimary,
  },
});
