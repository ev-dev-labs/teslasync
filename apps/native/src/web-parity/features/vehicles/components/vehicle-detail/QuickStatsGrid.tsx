// Native parity port of
// web/src/features/vehicles/components/vehicle-detail/QuickStatsGrid.tsx.
//
// The web source renders a responsive grid (`grid grid-cols-2 gap-3
// sm:grid-cols-3 lg:grid-cols-4`) of eight shared web MetricCards summarising a
// vehicle's live state: Battery (`<battery_level>%`, green/cyan by SoC), Range
// (rated_range), Odometer, Speed (with a Driving/Parked subtitle), Inside Temp,
// Outside Temp, Power (`<power> kW`) and State (the derived status). Each card
// pairs a value with a lucide glyph in a neon-tinted chip.
//
// Platform dependency swaps (no DOM, lucide, Recharts, Leaflet, or web UI per the
// conversion contract; each documented in the parity sidecar):
//   * react-i18next `useTranslation()` -> `useNativeTranslationFallback()` which
//     returns the English fallback while preserving every i18n key intent.
//   * `@/hooks/useUnits` `useUnits().{formatDistance,formatSpeed,
//     formatTemperature}` + `@/lib/numberFormat` `fmtNumber` -> `useNativeUnits()`
//     over the ported `useSettings()`. It mirrors lib `formatDistance` (SI meters
//     -> km/mi), `formatSpeed` (SI m/s -> km/h | mph), `formatTemperature` (SI °C
//     -> °C | °F, no space before the °unit) and numberFormat `fmtNumber` exactly
//     — NIST factors, `resolvePrecision` override>pref>per-quantity-fallback,
//     `toLocaleString`, '—' for non-finite, clamped(0..20) global precision.
//   * lucide `Battery`/`Navigation`/`Car`/`Gauge`/`Thermometer`/`Zap`/`Activity`
//     -> the repo SemanticIcon glyphs (battery/navigation/vehicle/speedCircle/
//     climate/bolt/activity, the established Car->vehicle, Gauge->speedCircle,
//     Zap->bolt mappings) rendered as tinted AppText inside a neon chip; the
//     native app ships no lucide/SVG renderer.
//   * `@/components/data-display` `MetricCard` (no native parity port exists) ->
//     an inline value-identical MetricCard: a rounded card with a truncating
//     metric-label, a wrapping text-xl value, an optional truncating subtitle, and
//     a neon (cyan/green/purple) icon chip — matching the web neonColorMap
//     surfaces (cyan-300/emerald-300/purple-300 glyph over bg-neon-{x}/10 +
//     ring-neon-{x}/20).
//   * DOM div + Tailwind `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3`
//     -> a flex-wrap RN grid whose column count tracks the live viewport against
//     the Tailwind sm (640px) / lg (1024px) breakpoints via `useWindowDimensions`,
//     using the negative-margin gutter trick for the gap-3 (12px) spacing.

import React, {useCallback, useMemo} from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {useSettings} from '../../../../api/hooks/useSettings';
import type {VehicleState, VehicleStatus} from '../../../../api/types';

// NIST factors mirrored from web @/lib/unitConversion (SI -> display unit).
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const SECONDS_PER_HOUR = 3600;

// lib DEFAULT_PRECISION per quantity — fallback digits when no override/pref.
const DEFAULT_DISTANCE_PRECISION = 1;
const DEFAULT_SPEED_PRECISION = 0;
const DEFAULT_TEMPERATURE_PRECISION = 1;
// numberFormat module default global precision (clamped to 0..20 by useSettings).
const DEFAULT_GLOBAL_PRECISION = 2;
// numberFormat / unitConversion locale fallback.
const DEFAULT_LOCALE = 'en-US';
// lib DEFAULT_EMPTY_DISPLAY — non-finite render.
const DEFAULT_EMPTY_DISPLAY = '—';

// Tailwind responsive grid breakpoints: grid-cols-2 (base) -> sm:grid-cols-3
// (640px) -> lg:grid-cols-4 (1024px).
const SM_BREAKPOINT = 640;
const LG_BREAKPOINT = 1024;
// gap-3 == 0.75rem == 12px, reproduced with the negative-margin gutter trick.
const GRID_GAP = 12;
const HALF_GAP = GRID_GAP / 2;

// lucide -> repo SemanticIcon glyphs (resolved once; no SVG renderer on native).
const BATTERY_GLYPH = getSemanticIconDefinition('battery').glyph;
const NAVIGATION_GLYPH = getSemanticIconDefinition('navigation').glyph;
const CAR_GLYPH = getSemanticIconDefinition('vehicle').glyph; // Car
const GAUGE_GLYPH = getSemanticIconDefinition('speedCircle').glyph; // Gauge
const THERMOMETER_GLYPH = getSemanticIconDefinition('climate').glyph; // Thermometer
const ZAP_GLYPH = getSemanticIconDefinition('bolt').glyph; // Zap
const ACTIVITY_GLYPH = getSemanticIconDefinition('activity').glyph;

type NeonColor = 'cyan' | 'green' | 'purple';

// Web `neonColorMap` (web/src/lib/tokens.ts) cyan/green/purple translated to RN
// colour literals: `text` is the toned-down `-300` glyph colour the web
// MetricCard applies via `c.text`; `bg`/`ring` are the neon hue at /10 and /20
// alpha for the icon chip.
const METRIC_COLORS: Record<NeonColor, {bg: string; ring: string; text: string}> =
  {
    cyan: {
      text: '#67e8f9',
      bg: 'rgba(0, 240, 255, 0.1)',
      ring: 'rgba(0, 240, 255, 0.2)',
    },
    green: {
      text: '#6ee7b7',
      bg: 'rgba(16, 185, 129, 0.1)',
      ring: 'rgba(16, 185, 129, 0.2)',
    },
    purple: {
      text: '#d8b4fe',
      bg: 'rgba(168, 85, 247, 0.1)',
      ring: 'rgba(168, 85, 247, 0.2)',
    },
  };

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next swap: no i18n runtime is wired on native, so this returns the
// English fallback while preserving the i18n key intent.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Web QuickStatsGrid battery chip colour:
//   battery_level > 50 ? 'green' : battery_level > 20 ? 'cyan' : 'cyan'
// (both lower branches resolve to cyan). Reproduced as an if-chain that keeps the
// exact >50 / >20 thresholds while staying lint-clean (no nested ternary).
function batteryColor(level: number): NeonColor {
  if (level > 50) {
    return 'green';
  }
  if (level > 20) {
    return 'cyan';
  }
  return 'cyan';
}

// Mirror of web @/lib/numberFormat `safeNumber`.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function formatWithDigits(value: number, locale: string, digits: number): string {
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  };
  try {
    return value.toLocaleString(locale, opts);
  } catch {
    return value.toLocaleString(DEFAULT_LOCALE, opts);
  }
}

function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

// Mirror of web useUnits `derivePrecision`: a floored, non-negative integer or
// undefined (which makes the formatter fall back to the per-quantity default).
function derivePrecision(
  decimalPrecision: number | undefined,
): number | undefined {
  if (
    typeof decimalPrecision !== 'number' ||
    !Number.isFinite(decimalPrecision) ||
    decimalPrecision < 0
  ) {
    return undefined;
  }
  return Math.floor(decimalPrecision);
}

// Mirror of numberFormat global precision: useSettings does
// `decimals = decimal_precision ?? 2` then `setGlobalPrecision` clamps 0..20.
function deriveGlobalPrecision(decimalPrecision: number | undefined): number {
  const decimals =
    typeof decimalPrecision === 'number' && Number.isFinite(decimalPrecision)
      ? decimalPrecision
      : DEFAULT_GLOBAL_PRECISION;
  return Math.max(0, Math.min(20, decimals));
}

// Mirror of lib `resolvePrecision`: per-call override wins, then the user pref,
// then the per-quantity fallback; each floored when a valid non-negative number.
function resolvePrecision(
  prefPrecision: number | undefined,
  override: number | undefined,
  fallback: number,
): number {
  if (
    typeof override === 'number' &&
    Number.isFinite(override) &&
    override >= 0
  ) {
    return Math.floor(override);
  }
  if (
    typeof prefPrecision === 'number' &&
    Number.isFinite(prefPrecision) &&
    prefPrecision >= 0
  ) {
    return Math.floor(prefPrecision);
  }
  return fallback;
}

interface FormatOptions {
  precision?: number;
}

// Native mirror of the web's `useUnits().{formatDistance,formatSpeed,
// formatTemperature}` + numberFormat `fmtNumber`, all derived from the ported
// `useSettings()`.
function useNativeUnits(): {
  formatDistance: (
    value: number | null | undefined,
    options?: FormatOptions,
  ) => string;
  formatSpeed: (
    value: number | null | undefined,
    options?: FormatOptions,
  ) => string;
  formatTemperature: (
    value: number | null | undefined,
    options?: FormatOptions,
  ) => string;
  fmtNumber: (value: unknown, decimals?: number) => string;
} {
  const {data: settings} = useSettings();
  return useMemo(() => {
    const distanceUnit: 'km' | 'mi' =
      settings?.unit_of_length === 'mi' ? 'mi' : 'km';
    const speedUnit: 'km/h' | 'mph' =
      settings?.unit_of_length === 'mi' ? 'mph' : 'km/h';
    const temperatureUnit: '°C' | '°F' =
      settings?.unit_of_temp === 'F' ? '°F' : '°C';
    const locale = deriveLocale(settings?.locale);
    const prefPrecision = derivePrecision(settings?.decimal_precision);
    const globalPrecision = deriveGlobalPrecision(settings?.decimal_precision);

    const formatDistance = (
      value: number | null | undefined,
      options?: FormatOptions,
    ): string => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_EMPTY_DISPLAY;
      }
      const digits = resolvePrecision(
        prefPrecision,
        options?.precision,
        DEFAULT_DISTANCE_PRECISION,
      );
      const converted =
        distanceUnit === 'mi' ? value / METERS_PER_MILE : value / METERS_PER_KM;
      return `${formatWithDigits(converted, locale, digits)} ${distanceUnit}`;
    };

    const formatSpeed = (
      value: number | null | undefined,
      options?: FormatOptions,
    ): string => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_EMPTY_DISPLAY;
      }
      const digits = resolvePrecision(
        prefPrecision,
        options?.precision,
        DEFAULT_SPEED_PRECISION,
      );
      const converted =
        speedUnit === 'mph'
          ? (value * SECONDS_PER_HOUR) / METERS_PER_MILE
          : (value * SECONDS_PER_HOUR) / METERS_PER_KM;
      return `${formatWithDigits(converted, locale, digits)} ${speedUnit}`;
    };

    const formatTemperature = (
      value: number | null | undefined,
      options?: FormatOptions,
    ): string => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_EMPTY_DISPLAY;
      }
      const digits = resolvePrecision(
        prefPrecision,
        options?.precision,
        DEFAULT_TEMPERATURE_PRECISION,
      );
      const converted =
        temperatureUnit === '°F' ? (value * 9) / 5 + 32 : value;
      // No space between number and °unit (web typographic convention).
      return `${formatWithDigits(converted, locale, digits)}${temperatureUnit}`;
    };

    const fmtNumber = (value: unknown, decimals?: number): string =>
      formatWithDigits(safeNumber(value), locale, decimals ?? globalPrecision);

    return {formatDistance, formatSpeed, formatTemperature, fmtNumber};
  }, [settings]);
}

// Inlined @/components/data-display <MetricCard>: a rounded card with a
// truncating metric-label eyebrow, a wrapping text-xl value, an optional
// truncating subtitle, and a neon-tinted icon chip. Only the props this page uses
// (label, value, icon, color, subtitle) are reproduced.
function MetricCard({
  label,
  value,
  iconGlyph,
  color,
  subtitle,
}: {
  label: string;
  value: string;
  iconGlyph: string;
  color: NeonColor;
  subtitle?: string;
}) {
  const palette = METRIC_COLORS[color];

  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.cardTextCol}>
          <AppText numberOfLines={1} style={styles.cardLabel} tone="muted">
            {label}
          </AppText>
          <AppText style={styles.cardValue} weight="bold">
            {value}
          </AppText>
          {subtitle ? (
            <AppText numberOfLines={1} style={styles.cardSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        <View
          style={[
            styles.iconChip,
            {backgroundColor: palette.bg, borderColor: palette.ring},
          ]}>
          <AppText style={[styles.iconGlyph, {color: palette.text}]} weight="bold">
            {iconGlyph}
          </AppText>
        </View>
      </View>
    </View>
  );
}

// Reproduces grid-cols-2 / sm:grid-cols-3 / lg:grid-cols-4 against the live
// viewport width.
function useGridColumns(): number {
  const {width} = useWindowDimensions();
  if (width >= LG_BREAKPOINT) {
    return 4;
  }
  if (width >= SM_BREAKPOINT) {
    return 3;
  }
  return 2;
}

interface QuickStatCard {
  id: string;
  label: string;
  value: string;
  iconGlyph: string;
  color: NeonColor;
  subtitle?: string;
}

interface QuickStatsGridProps {
  state: VehicleState;
  status: VehicleStatus;
}

export function QuickStatsGrid({state, status}: QuickStatsGridProps) {
  const t = useNativeTranslationFallback();
  const {formatDistance, formatSpeed, formatTemperature, fmtNumber} =
    useNativeUnits();
  const columns = useGridColumns();

  const cards: QuickStatCard[] = [
    {
      id: 'battery',
      label: t('common.battery', 'Battery'),
      value: `${state.battery_level}%`,
      iconGlyph: BATTERY_GLYPH,
      color: batteryColor(state.battery_level),
    },
    {
      id: 'range',
      label: t('common.range', 'Range'),
      value: formatDistance(state.rated_range, {precision: 0}),
      iconGlyph: NAVIGATION_GLYPH,
      color: 'cyan',
    },
    {
      id: 'odometer',
      label: t('common.odometer', 'Odometer'),
      value: formatDistance(state.odometer, {precision: 0}),
      iconGlyph: CAR_GLYPH,
      color: 'purple',
    },
    {
      id: 'speed',
      label: t('common.speed', 'Speed'),
      value: formatSpeed(state.speed, {precision: 0}),
      iconGlyph: GAUGE_GLYPH,
      color: 'cyan',
      subtitle:
        state.speed > 0
          ? t('common.driving', 'Driving')
          : t('common.parked', 'Parked'),
    },
    {
      id: 'insideTemp',
      label: t('common.insideTemp', 'Inside Temp'),
      value: formatTemperature(state.inside_temp),
      iconGlyph: THERMOMETER_GLYPH,
      color: 'green',
    },
    {
      id: 'outsideTemp',
      label: t('common.outsideTemp', 'Outside Temp'),
      value: formatTemperature(state.outside_temp),
      iconGlyph: THERMOMETER_GLYPH,
      color: 'cyan',
    },
    {
      id: 'power',
      label: t('common.power', 'Power'),
      value: `${fmtNumber(state.power)} kW`,
      iconGlyph: ZAP_GLYPH,
      color: 'purple',
    },
    {
      id: 'state',
      label: t('common.state', 'State'),
      value: status,
      iconGlyph: ACTIVITY_GLYPH,
      color: 'cyan',
    },
  ];

  return (
    <View style={styles.grid}>
      {cards.map(card => (
        <View
          key={card.id}
          style={[styles.gridCell, {width: `${100 / columns}%`}]}>
          <MetricCard
            label={card.label}
            value={card.value}
            iconGlyph={card.iconGlyph}
            color={card.color}
            subtitle={card.subtitle}
          />
        </View>
      ))}
    </View>
  );
}

QuickStatsGrid.displayName = 'QuickStatsGrid';

const styles = StyleSheet.create({
  // grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4, via the negative-margin
  // gutter trick for the gap-3 (12px) spacing.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -HALF_GAP,
  },
  gridCell: {
    padding: HALF_GAP,
  },
  // p-3 rounded-xl bg-white/[0.02] border border-white/[0.04].
  card: {
    width: '100%',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  // flex items-start justify-between gap-2.
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  // flex-1 min-w-0 (lets the label/subtitle truncate beside the icon chip).
  cardTextCol: {
    flex: 1,
    minWidth: 0,
  },
  // metric-label (text-2xs font-medium uppercase tracking-wider) mb-1 + truncate.
  cardLabel: {
    marginBottom: 4,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  // text-xl font-bold tracking-tight text-[var(--text-primary)] (wraps).
  cardValue: {
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
  },
  // mt-0.5 text-[10px] text-[var(--text-muted)] truncate.
  cardSubtitle: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 14,
  },
  // flex items-center justify-center rounded-lg p-1.5 ring-1 shrink-0.
  iconChip: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    padding: 6,
    borderWidth: 1,
  },
  // Battery/Navigation/Car/Gauge/Thermometer/Zap/Activity h-4 w-4 glyph.
  iconGlyph: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
  },
});
