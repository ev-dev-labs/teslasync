// Native parity port of web/src/features/dashboard/widgets/WeatherAtCarWidget.tsx.
//
// `WeatherAtCarWidget` surfaces the active vehicle's outside temperature (and,
// in the full layout, its coordinates) with a weather-condition icon picked
// from that temperature. It has two layouts driven by `size`:
//   - compact (cols === 1 && rows === 1): a title-less shell whose body is a
//     centred WeatherIcon + a big "{temp}{unit}" value, or an empty state.
//   - full: a titled shell ("Weather at Car") whose body is a row of a large
//     WeatherIcon + a column (temp value, "Outside Temperature" label, and the
//     optional "lat°, long°" coordinates), or an empty state.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3): the
// module-level `WeatherIcon` threshold logic (source L11-16: tempC <= 0 ->
// CloudSnow, tempC >= 25 -> Sun, else CloudSun); the
// `id = vehicleId ?? vehicles?.[0]?.id ?? 0` resolution (L21) feeding
// `useVehicleState(id, { refetchInterval: 30_000 })` (L22); the destructured
// query result (data:stateData/isLoading/isFetching/isStale/isError/
// dataUpdatedAt/refetch); the
// `toTemperatureDisplay = (v) => convertTempFromSI(v, unitPrefs.temperature)`
// closure (L24) + `tempUnit = unitPrefs.temperature` (L26); `state =
// stateData?.state` (L28), `outsideTemp = state?.outside_temp` (L29),
// `hasData = outsideTemp != null` (L30) and
// `isCompact = size.cols === 1 && size.rows === 1` (L31); the shell prop bag
// (L34-42: title compact->undefined, icon CloudSun text-cyan-300 / undefined,
// loading, updatedAt, isFetching, isStale, isError, onRefresh) and the
// `state?.latitude != null && state?.longitude != null` coordinate guard
// (L62-66). Every i18n key + English default (widget.weatherAtCar/outsideTemp/
// noWeather) and the `outside_temp`/`latitude`/`longitude` field names are read
// identically. The `useVehicleState` `/vehicles/{id}/state` API path is reached
// through the already-ported web-parity hook.
//
// Web/DOM-only dependencies with no native parity surface are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - react-i18next `useTranslation('dashboard')` (L1) -> a local fallback
//     resolver returning the inline English string (same shim shape as the
//     MotorPerformance / VehicleHeroCard widget ports); the namespace arg is
//     accepted + ignored. No `{{var}}` interpolation is needed by this widget.
//   - lucide-react `CloudSun` / `Sun` / `CloudSnow` / `Thermometer` (L2) ->
//     there is no `react-native-svg` dependency, so each renders a decorative
//     glyph stand-in via `<GlyphIcon>` (the MotorPerformance glyph precedent):
//     CloudSun -> "⛅", Sun -> "☀️", CloudSnow -> "🌨️", Thermometer -> "🌡️".
//     The WeatherIcon keeps its web `text-neon-cyan` accent; the full-mode
//     header CloudSun keeps `text-cyan-300` (#67e8f9); the empty-state
//     Thermometer inherits the muted token (web EmptyState icon styling).
//   - `@/components/feedback` `EmptyState` (L3) -> not yet ported, reproduced as
//     `<LocalEmptyState>` (centred glyph + muted message); the web `py-4`
//     padding is the default (non-dense). The "no-action transient empty state"
//     intent is preserved.
//   - `@/api/hooks/useVehicles` `useVehicles` / `useVehicleState` (L4) -> the
//     already-ported web-parity hooks (real TanStack Query; the /vehicles +
//     /vehicles/{id}/state paths reached through them).
//   - `@/hooks/useUnits` `useUnits` (L5) -> a local shim exposing
//     `unitPrefs.temperature`. There is no native settings/locale port yet, so it
//     returns '°C' (SI floor); the display-boundary conversion contract (read
//     SI, convert at render) is preserved.
//   - `@/lib/numberFormat` `fmtInt` (L6) -> inlined native-safe equivalent (+ its
//     `safeNumber`/`fmtNumber` deps): nullish/non-finite -> 0, en-US locale,
//     0 decimal places.
//   - `./WidgetShell` `WidgetShell` (L7) -> reproduced locally as a native
//     `<WidgetShell>` (sibling not yet ported, same self-contained approach as
//     the MotorPerformance port): loading -> skeleton block, error -> centred
//     danger text (surfaced, never hidden), the optional title+icon header, the
//     freshness chip via the converted web-parity `DataFreshness` port
//     (compact/dot-only overlay when title-less), and the px-4 pb-3 body. The
//     web pulse-on-data-change box-shadow glow has no native analog and is
//     intentionally omitted (documented in the sidecar); the help-tooltip /
//     pin-button / actions / noPadding / query header slots are unused by this
//     widget and are not modeled.
//   - `./types` `WidgetProps` (L8) -> the `WidgetProps` / `WidgetSize` /
//     `WidgetConfig` subset is reproduced + exported locally so this widget and
//     any future native consumer agree on the shape.
//   - `@/lib/unitConversion` `convertTempFromSI` (L9) -> inlined verbatim
//     (°C identity, °F = c*9/5+32) with a local TemperatureUnitPref type.
//
// Tailwind spacing -> px (1 unit = 4px); var(--text-*) -> the theme tokens so the
// light/dark cascade is preserved at the token boundary.

import React, { type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';
import { DataFreshness } from '../../../components/data-display/DataFreshness';
import {
  useVehicles,
  useVehicleState,
  type VehicleState,
} from '../../../api/hooks/useVehicles';

// ── i18n shim ───────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. The hook shape mirrors the web
// `const { t } = useTranslation('dashboard')` so the component body is unchanged.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(_namespace?: string): { t: TFunc } {
  return { t: (_key, fallback) => fallback };
}

// ── Inlined `@/lib/numberFormat` (safeNumber / fmtNumber / fmtInt) ────────────
// Locale-aware formatting matching the web helper: nullish/non-finite input
// coerces to 0, en-US locale, 0 decimal places for fmtInt.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// ── Inlined `@/lib/unitConversion` `convertTempFromSI` ────────────────────────
type TemperatureUnitPref = '°C' | '°F';

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

// ── useUnits shim (web @/hooks/useUnits) ─────────────────────────────────────
// No native settings/locale port yet; the SI floor is °C. The display-boundary
// conversion contract (read SI, convert at render) is preserved.
interface UnitPrefsShim {
  temperature: TemperatureUnitPref;
}

function useUnits(): { unitPrefs: UnitPrefsShim } {
  return { unitPrefs: { temperature: '°C' } };
}

// ── Type reproductions (web ./types) ─────────────────────────────────────────
export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

// ── lucide glyph stand-in ────────────────────────────────────────────────────
// No react-native-svg in the native app, so lucide icons render as decorative
// glyphs (accessibility-hidden; the surrounding shell carries the label).
const CYAN_300 = '#67e8f9'; // text-cyan-300 (full-mode header icon)

function GlyphIcon({
  glyph,
  color,
  size,
}: {
  glyph: string;
  color: string;
  size: number;
}) {
  const glyphStyle: StyleProp<TextStyle> = {
    color,
    fontSize: size,
    lineHeight: size,
  };
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={glyphStyle}
    >
      {glyph}
    </AppText>
  );
}

// ── WeatherIcon (web L11-16): pick a glyph from outside temperature (°C) ──────
function WeatherIcon({
  tempC,
  color,
  size,
}: {
  tempC: number;
  color: string;
  size: number;
}) {
  const glyph = tempC <= 0 ? '🌨️' : tempC >= 25 ? '☀️' : '⛅';
  return <GlyphIcon glyph={glyph} color={color} size={size} />;
}

// ── Local `EmptyState` (web @/components/feedback, icon+message) ──────────────
function LocalEmptyState({
  icon,
  message,
}: {
  icon?: ReactNode;
  message: string;
}) {
  // no-action: transient empty state — surfaces when source data is missing;
  // no specific recovery action available.
  return (
    <View style={styles.emptyState}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText tone="muted" style={styles.emptyMessage}>
        {message}
      </AppText>
    </View>
  );
}

// ── Local `WidgetShell` (web ./WidgetShell) ──────────────────────────────────
interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  /** Freshness: ms timestamp from dataUpdatedAt (0 = never). */
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
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  if (loading) {
    return <View accessibilityRole="progressbar" style={styles.skeleton} />;
  }
  if (error) {
    return (
      <View style={styles.errorBox}>
        <AppText tone="danger">{error}</AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (typically 1×1 widgets).
  const freshnessCompact = !title;

  const freshnessEl: ReactNode = showFreshness ? (
    <DataFreshness
      updatedAt={updatedAt > 0 ? updatedAt : null}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      isError={isError ?? false}
      onRefresh={onRefresh}
      compact={freshnessCompact}
    />
  ) : null;

  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.freshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

export default function WeatherAtCarWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: stateData,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehicleState(id, { refetchInterval: 30_000 });
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;

  // The native `useVehicleState` result's `state` is `VehicleState | string |
  // null`; narrow once to `VehicleState | null` (the web call site is `any`) so a
  // bare offline status string reads object fields as the web's nullish fallbacks.
  const rawState = stateData?.state;
  const state: VehicleState | null =
    rawState != null && typeof rawState === 'object' ? rawState : null;
  const outsideTemp = state?.outside_temp ?? null; // SI floor: °C
  const hasData = outsideTemp != null;
  const isCompact = size.cols === 1 && size.rows === 1;

  // outsideTemp is non-null whenever hasData is true; the `?? 0` is an
  // unreachable narrowing fallback so the icon/value reads stay strictly typed.
  const tempC = outsideTemp ?? 0;
  const tempDisplay = `${fmtInt(toTemperatureDisplay(tempC))}${tempUnit}`;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.weatherAtCar', 'Weather at Car')}
      icon={
        !isCompact ? (
          <GlyphIcon glyph="⛅" color={CYAN_300} size={14} />
        ) : undefined
      }
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {hasData ? (
        isCompact ? (
          <View style={styles.compactBody}>
            <WeatherIcon tempC={tempC} color={colors.accent} size={24} />
            <AppText style={styles.compactTemp}>{tempDisplay}</AppText>
          </View>
        ) : (
          <View style={styles.fullBody}>
            <WeatherIcon tempC={tempC} color={colors.accent} size={40} />
            <View style={styles.fullTextCol}>
              <AppText style={styles.fullTemp}>{tempDisplay}</AppText>
              <AppText style={styles.fullLabel}>
                {t('widget.outsideTemp', 'Outside Temperature')}
              </AppText>
              {state?.latitude != null && state?.longitude != null ? (
                <AppText style={styles.coords}>
                  {`${state.latitude.toFixed(2)}°, ${state.longitude.toFixed(2)}°`}
                </AppText>
              ) : null}
            </View>
          </View>
        )
      ) : (
        <LocalEmptyState
          icon={<GlyphIcon glyph="🌡️" color={colors.textMuted} size={20} />}
          message={t('widget.noWeather', 'No weather data')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingBottom: 12, // pb-3
    paddingHorizontal: 16, // px-4
  },
  compactBody: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'column',
    gap: 4, // gap-1
    justifyContent: 'center',
  },
  compactTemp: {
    color: colors.textPrimary,
    fontSize: 24, // text-2xl
    fontWeight: '700', // font-bold
    lineHeight: 32,
  },
  coords: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    fontVariant: ['tabular-nums'], // tabular-nums
    lineHeight: 14,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.md, // py-4
  },
  errorBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16, // p-4
  },
  freshnessOverlay: {
    position: 'absolute',
    right: 6, // right-1.5
    top: 6, // top-1.5
    zIndex: 5,
  },
  fullBody: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 16, // gap-4
    paddingVertical: 8, // py-2
  },
  fullLabel: {
    color: colors.textMuted,
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  fullTemp: {
    color: colors.textPrimary,
    fontSize: 30, // text-3xl
    fontWeight: '700', // font-bold
    lineHeight: 36,
  },
  fullTextCol: {
    flexDirection: 'column',
    flexShrink: 1, // let the text column shrink instead of overflowing the icon
    gap: 2, // gap-0.5
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4, // pb-1
    paddingHorizontal: 16, // px-4
    paddingTop: 12, // pt-3
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11, // text-[11px]
    fontWeight: '500', // font-medium
    letterSpacing: 0.6, // tracking-wider
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6, // gap-1.5
  },
  shell: {
    flex: 1,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12, // rounded-xl
    flex: 1,
  },
});
