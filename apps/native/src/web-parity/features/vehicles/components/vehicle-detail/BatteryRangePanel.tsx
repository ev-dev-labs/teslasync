// Native parity port of
// web/src/features/vehicles/components/vehicle-detail/BatteryRangePanel.tsx.
//
// The web source renders a "Battery & Range" GlassPanel (p-6): a left
// RadialGauge of the SoC (battery_level / 100, %, tinted by batteryColor) beside
// a responsive grid of three MetricCards — Rated Range, Ideal Range, and a
// Charging card whose value flips between the SI range-added rate ("<dist>/h")
// and "Not Charging", with a "Full in <h>h" subtitle while charging. The whole
// thing stacks (flex-col) on mobile and lays out side-by-side (sm:flex-row) on
// wider viewports.
//
// Platform dependency swaps (no DOM, lucide, Recharts, Leaflet, or web UI per the
// conversion contract; each documented in the parity sidecar):
//   * react-i18next `useTranslation()` -> `useNativeTranslationFallback()` which
//     returns the English fallback while preserving every i18n key intent.
//   * `@/hooks/useUnits` `useUnits().formatDistance` + `@/lib/numberFormat`
//     `fmtNumber` -> `useNativeUnits()` over the ported `useSettings()`. It
//     mirrors lib `formatDistance(meters, pref, options)` exactly (SI meters ->
//     km/mi via the NIST factors, `resolvePrecision` override>pref>fallback(1),
//     `toLocaleString`, '—' for non-finite) and numberFormat `fmtNumber`
//     (settings locale + global precision clamp(0..20) default 2; `safeNumber`
//     coerces non-finite to 0).
//   * `batteryColor` (./helpers) -> an inline value-identical function with the
//     same >60 / >25 thresholds and the exact #10b981 / #f59e0b / #ef4444 hex.
//   * lucide `Navigation`/`MapPin`/`BatteryCharging` -> the repo SemanticIcon
//     glyphs ('navigation'/'mapPinned'/'batteryCharging') rendered as tinted
//     AppText inside a neon-tinted chip; the native app ships no lucide/SVG
//     renderer.
//   * `@/components/charts` `RadialGauge` -> the native parity RadialGauge barrel
//     (View-segment arc; same value/max/label/unit/color/size contract).
//   * `@/components/data-display` `MetricCard` (no native parity port exists) ->
//     an inline value-identical MetricCard: a rounded card with a truncating
//     label, a wrapping text-xl value, an optional truncating subtitle, and a
//     neon (cyan/green) icon chip — matching the web neonColorMap surfaces
//     (cyan-300/emerald-300 glyph over bg-neon-{x}/10 + ring-neon-{x}/20).
//   * `@/components/ui` `GlassPanel` -> native GlassPanel (style, not className).
//   * DOM div/grid + Tailwind/CSS-vars -> RN View/AppText/tokens; the web
//     `flex-col ... sm:flex-row` + `grid-cols-2 sm:grid-cols-3` responsive layout
//     collapses to a mobile-first column whose metric cards live in a wrapping
//     row (RN has no CSS media queries).

import React, {useCallback, useMemo} from 'react';
import {
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {RadialGauge} from '../../../../components/charts';
import {useSettings} from '../../../../api/hooks/useSettings';
import type {VehicleState} from '../../../../api/types';

// NIST factors mirrored from web @/lib/unitConversion (SI meters -> display unit).
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;

// lib DEFAULT_PRECISION.distance — fallback digits when no override/pref applies.
const DEFAULT_DISTANCE_PRECISION = 1;
// numberFormat module default global precision (clamped to 0..20 by useSettings).
const DEFAULT_GLOBAL_PRECISION = 2;
// numberFormat / unitConversion locale fallback.
const DEFAULT_LOCALE = 'en-US';
// lib DEFAULT_EMPTY_DISPLAY — non-finite distance render.
const DEFAULT_EMPTY_DISPLAY = '—';

// lucide -> repo SemanticIcon glyphs (resolved once; no SVG renderer on native).
const NAVIGATION_GLYPH = getSemanticIconDefinition('navigation').glyph;
const MAP_PIN_GLYPH = getSemanticIconDefinition('mapPinned').glyph;
const BATTERY_CHARGING_GLYPH = getSemanticIconDefinition('batteryCharging').glyph;

// neonColorMap (web @/lib/tokens) cyan/green surfaces used by MetricCard's icon
// chip: bg-neon-{x}/10 + ring-neon-{x}/20 with a toned-down 300-level glyph.
const CYAN_BG = 'rgba(0, 240, 255, 0.1)';
const CYAN_RING = 'rgba(0, 240, 255, 0.2)';
const CYAN_TEXT = '#67e8f9';
const GREEN_BG = 'rgba(16, 185, 129, 0.1)';
const GREEN_RING = 'rgba(16, 185, 129, 0.2)';
const GREEN_TEXT = '#6ee7b7';

type NeonColor = 'cyan' | 'green';

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next swap: no i18n runtime is wired on native, so this returns the
// English fallback while preserving the i18n key intent.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Value-identical inline of web ./helpers `batteryColor(level)`.
function batteryColor(level: number): string {
  if (level > 60) {
    return '#10b981';
  }
  if (level > 25) {
    return '#f59e0b';
  }
  return '#ef4444';
}

// Mirror of web @/lib/numberFormat `safeNumber`.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function formatWithDigits(
  value: number,
  locale: string,
  digits: number,
): string {
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

// Native mirror of the web's `useUnits().formatDistance` + numberFormat
// `fmtNumber`, both derived from the ported `useSettings()`.
function useNativeUnits(): {
  formatDistance: (
    value: number | null | undefined,
    options?: FormatOptions,
  ) => string;
  fmtNumber: (value: unknown, decimals?: number) => string;
} {
  const {data: settings} = useSettings();
  return useMemo(() => {
    const distanceUnit: 'km' | 'mi' =
      settings?.unit_of_length === 'mi' ? 'mi' : 'km';
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

    const fmtNumber = (value: unknown, decimals?: number): string =>
      formatWithDigits(safeNumber(value), locale, decimals ?? globalPrecision);

    return {formatDistance, fmtNumber};
  }, [settings]);
}

// Inlined @/components/data-display <MetricCard>: a rounded card with a
// truncating eyebrow label, a wrapping text-xl value, an optional truncating
// subtitle, and a neon-tinted icon chip. Only the props this page uses (label,
// value, icon, color, subtitle) are reproduced.
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
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricRow}>
        <View style={styles.metricTextCol}>
          <AppText
            numberOfLines={1}
            style={styles.metricLabel}
            tone="muted">
            {label}
          </AppText>
          <AppText style={styles.metricValue} weight="bold">
            {value}
          </AppText>
          {subtitle ? (
            <AppText
              numberOfLines={1}
              style={styles.metricSubtitle}
              tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        <View style={[styles.iconChip, iconChipSurface[color]]}>
          <AppText style={[styles.iconGlyph, iconGlyphLabel[color]]} weight="bold">
            {iconGlyph}
          </AppText>
        </View>
      </View>
    </View>
  );
}

interface BatteryRangePanelProps {
  state: VehicleState;
}

export function BatteryRangePanel({state}: BatteryRangePanelProps) {
  const t = useNativeTranslationFallback();
  const {formatDistance, fmtNumber} = useNativeUnits();

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.layout}>
        <View style={styles.gaugeWrap}>
          <RadialGauge
            value={state.battery_level}
            max={100}
            label={t('common.battery', 'Battery')}
            unit="%"
            color={batteryColor(state.battery_level)}
            size={140}
          />
        </View>
        <View style={styles.metrics}>
          <MetricCard
            label={t('vehicles.detail.ratedRange', 'Rated Range')}
            value={formatDistance(state.rated_range, {precision: 0})}
            iconGlyph={NAVIGATION_GLYPH}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.idealRange', 'Ideal Range')}
            value={formatDistance(state.ideal_range, {precision: 0})}
            iconGlyph={MAP_PIN_GLYPH}
            color="green"
          />
          <MetricCard
            label={t('common.charging', 'Charging')}
            value={
              state.is_charging
                ? `${formatDistance(state.charge_rate)}/h`
                : t('common.notCharging', 'Not Charging')
            }
            iconGlyph={BATTERY_CHARGING_GLYPH}
            color={state.is_charging ? 'green' : 'cyan'}
            subtitle={
              state.is_charging && state.time_to_full_charge > 0
                ? `${t('vehicles.detail.fullIn', 'Full in')} ${fmtNumber(
                    state.time_to_full_charge,
                    1,
                  )}h`
                : undefined
            }
          />
        </View>
      </View>
    </GlassPanel>
  );
}

BatteryRangePanel.displayName = 'BatteryRangePanel';

const styles = StyleSheet.create({
  // GlassPanel p-6.
  panel: {
    padding: 24,
  },
  // flex flex-col items-center gap-6 sm:flex-row sm:items-start -> mobile-first
  // column (gauge above the metric grid).
  layout: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 24,
  },
  // The web `relative` gauge wrapper.
  gaugeWrap: {
    position: 'relative',
  },
  // flex-1 grid grid-cols-2 gap-4 sm:grid-cols-3 -> a stretched wrapping row of
  // metric cards (RN has no CSS grid / media queries).
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignSelf: 'stretch',
    gap: 16,
  },
  // p-3 rounded-xl bg-white/[0.02] border border-white/[0.04].
  metricCard: {
    flexGrow: 1,
    flexBasis: '28%',
    minWidth: 80,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  // flex items-start justify-between gap-2.
  metricRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  // flex-1 min-w-0 (lets the label/subtitle truncate beside the icon chip).
  metricTextCol: {
    flex: 1,
    minWidth: 0,
  },
  // metric-label (text-2xs font-medium uppercase tracking-wider) mb-1 + truncate.
  metricLabel: {
    marginBottom: 4,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  // text-xl font-bold tracking-tight text-[var(--text-primary)] (wraps).
  metricValue: {
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
  },
  // mt-0.5 text-[10px] text-[var(--text-muted)] truncate.
  metricSubtitle: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 14,
  },
  // flex items-center justify-center rounded-lg p-1.5 ring-1 shrink-0.
  iconChip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    padding: 6,
    borderWidth: 1,
  },
  // Navigation/MapPin/BatteryCharging h-4 w-4 glyph.
  iconGlyph: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
  },
});

const iconChipSurface = StyleSheet.create<Record<NeonColor, ViewStyle>>({
  cyan: {
    backgroundColor: CYAN_BG,
    borderColor: CYAN_RING,
  },
  green: {
    backgroundColor: GREEN_BG,
    borderColor: GREEN_RING,
  },
});

const iconGlyphLabel = StyleSheet.create<Record<NeonColor, TextStyle>>({
  cyan: {
    color: CYAN_TEXT,
  },
  green: {
    color: GREEN_TEXT,
  },
});
