// Native parity port of
// web/src/features/driving/components/drivetrain-health/ThermalLoadPanel.tsx.
//
// The web component renders the drivetrain "Thermal Load Indicators" card: a
// GlassPanel (p-6) whose uppercase muted heading pairs a lucide `Activity` glyph
// with the title, above a vertical stack (space-y-4) of `MetricBar`s — one per
// motor temperature sensor, each coloured by severity and showing the
// temperature converted to the user's unit — and a responsive 2/4-column grid
// (grid-cols-2 sm:grid-cols-4) of four `InlineMetric` icon+value pairs (Peak
// Power, Avg Power, Drives, Regen Ratio). It composes react-i18next, lucide
// icons, the shared GlassPanel, MetricBar + InlineMetric, the FadeIn motion
// wrapper, `useUnits().formatTemperature`, `fmtNumber`/`fmtInt`, the `TempSensor`
// type (from ./constants), the ./helpers `tempSeverityColor`/`displayTemp`, and
// the `DrivingStats` type (from @/types/driving).
//
// Native substitutions (no DOM, lucide-react, framer-motion, Recharts, Leaflet,
// or web UI components are imported):
//   * `GlassPanel` (web @/components/ui) -> the native `components/ui/GlassPanel`
//     (takes `style` instead of `className`; p-6 -> padding 24).
//   * `MetricBar` -> the already-ported native parity `MetricBar`
//     (web-parity/components/data-display/MetricBar) — same value/max/color/
//     label/sublabel contract and fill animation.
//   * `tempSeverityColor` / `displayTemp` -> the already-ported native sibling
//     `./helpers` (imported verbatim).
//   * `InlineMetric` (web @/components/data-display) has no native port yet, so a
//     self-contained native `InlineMetric` is inlined here mirroring the web prop
//     shape (icon: ReactNode, value, optional label): an inline row (gap-1) of a
//     coloured glyph + muted value text.
//   * The lucide `Activity`/`Zap`/`TrendingUp`/`Shield` glyphs map to the repo
//     SemanticIcon `activity`/`bolt`/`trendUp`/`security` glyphs, rendered as
//     bare coloured AppText (the web per-icon Tailwind `-400` hues are preserved).
//   * `FadeIn` (web @/components/motion) has no native port; mirroring the sibling
//     native ports it collapses to a static final-state wrapper (the web
//     reduced-motion branch). The `delay` prop is accepted for source parity and
//     intentionally ignored (entrance timing carries no behavioural contract).
//   * `useUnits().formatTemperature` -> a self-contained native formatter that
//     reads the ported `useSettings()` query and reproduces the web
//     `lib/unitConversion.formatTemperature` exactly: SI Celsius -> the user's
//     `unit_of_temp` (°C / °F via (c*9/5)+32), `decimal_precision`-driven digits
//     (fallback 1), `locale`-grouped `Intl.NumberFormat`, no space before the
//     °unit, and the '—' empty fallback for non-finite input.
//   * `fmtNumber`/`fmtInt` (web @/lib/numberFormat) -> value-identical inlines
//     (safeNumber coerces non-finite -> 0; locale grouping from the same settings
//     locale the web global formatters use; fmtInt == fmtNumber at 0 digits).
//   * `TempSensor` (web ./constants) and `DrivingStats` (web @/types/driving)
//     have no native port, so both are inlined field-for-field to keep this
//     presentational component self-contained and type-checked. It performs no
//     unit math on the stats — every value is rendered from the already-computed
//     SI/derived input verbatim.
//   * react-i18next `t` -> a self-contained fallback that preserves every i18n
//     key and English fallback string.

import React, {useCallback, type ReactNode} from 'react';
import {StyleSheet, View, useWindowDimensions} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';
import {MetricBar} from '../../../../components/data-display/MetricBar';
import {displayTemp, tempSeverityColor} from './helpers';

type NativeTFunction = (key: string, fallback: string) => string;

// The web component read `t` from react-i18next. Native parity has no i18n
// runtime wired yet, so this returns the English fallback string, preserving the
// i18n key/fallback intent for the heading, the four inline-metric labels, and
// every per-sensor label resolved through `t(sensor.labelKey, sensor.defaultLabel)`.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Local mirror of the web `./constants` `TempSensor` export. The native
// `./constants` port does not exist yet in this file-by-file loop, so the shape
// is reproduced field-for-field. `color`/`icon` are part of the web shape but are
// not consumed by this panel (it derives the bar colour from `tempSeverityColor`).
interface TempSensor {
  key: string;
  labelKey: string;
  defaultLabel: string;
  value: number | null;
  maxTemp: number;
  color: string;
  icon: ReactNode;
}

// Local mirror of the web `@/types/driving` `DrivingStats` export (no native
// `types/driving` port exists yet). Only `totalDrives` and `regenRatio` are read
// here; the full field set is kept for fidelity and structural compatibility with
// the native `useDrivingStats()` result the parent passes in.
interface DrivingStats {
  totalDrives: number;
  totalDistanceKm: number;
  totalDurationS: number;
  avgEfficiencyWhKm: number;
  avgSpeedKmh: number;
  topSpeedKmh: number;
  regenRatio: number;
  regenEnergyWh: number;
  co2SavedKg: number;
}

// --- Inlined `@/lib/numberFormat` parity ----------------------------------
// `safeNumber` coerces non-finite/NaN/null/undefined -> 0; `fmtNumber` groups via
// the settings locale (the web global locale set by useSettings) at the given
// digit count; `fmtInt` is `fmtNumber(v, 0)`. The web default locale is 'en-US'.
const DEFAULT_LOCALE = 'en-US';

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals: number, locale: string): string {
  try {
    return safeNumber(value).toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

function fmtInt(value: unknown, locale: string): string {
  return fmtNumber(value, 0, locale);
}

// --- Inlined `useUnits().formatTemperature` parity ------------------------
// Reproduces web/src/lib/unitConversion.formatTemperature + the useUnits derive*
// helpers exactly (SI Celsius in, user-unit string out).
type TemperatureUnitPref = '°C' | '°F';
const DEFAULT_EMPTY_DISPLAY = '—';
const DEFAULT_TEMP_PRECISION = 1;

function deriveTemperature(unitOfTemp: string | undefined): TemperatureUnitPref {
  return unitOfTemp === 'F' ? '°F' : '°C';
}

function deriveLocale(locale: string | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) {
    return locale;
  }
  return DEFAULT_LOCALE;
}

function derivePrecision(decimalPrecision: unknown): number | undefined {
  if (typeof decimalPrecision !== 'number') {
    return undefined;
  }
  if (!Number.isFinite(decimalPrecision)) {
    return undefined;
  }
  if (decimalPrecision < 0) {
    return undefined;
  }
  return Math.floor(decimalPrecision);
}

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  return to === '°F' ? (celsius * 9) / 5 + 32 : celsius;
}

function resolvePrecision(
  prefPrecision: number | undefined,
  override: number | undefined,
  fallback: number,
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
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

function formatNumber(
  value: number,
  locale: string | undefined,
  fractionDigits: number,
): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

// framer-motion `<FadeIn>` -> static final-state wrapper (the web reduced-motion
// branch). `delay` is accepted for source parity and intentionally ignored.
function FadeIn({children}: {children: ReactNode; delay?: number}) {
  return <View>{children}</View>;
}

// Native parity for the web `InlineMetric` (compact icon+value pair used in stat
// rows): the icon node, the value, and an optional trailing label, all inline.
function InlineMetric({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: string | number;
  label?: string;
}) {
  return (
    <View style={styles.inlineMetric}>
      {icon}
      <AppText style={styles.inlineMetricText} tone="muted">
        {value}
      </AppText>
      {label ? (
        <AppText style={styles.inlineMetricText} tone="muted">
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

// Tailwind `grid-cols-2 sm:grid-cols-4`: 2 columns below the sm breakpoint
// (640px), 4 at/above it.
const SM_BREAKPOINT = 640;
const GRID_GAP = 16; // gap-4 == 1rem.
const HALF_GAP = GRID_GAP / 2;

function useInlineColumns(): number {
  const {width} = useWindowDimensions();
  return width >= SM_BREAKPOINT ? 4 : 2;
}

// Per-icon Tailwind `-400` hues from the web InlineMetric icons.
const PURPLE_400 = '#c084fc'; // text-purple-400 (Zap)
const CYAN_400 = '#22d3ee'; // text-cyan-400 (TrendingUp)
const GREEN_400 = '#4ade80'; // text-green-400 (Activity)
const AMBER_400 = '#fbbf24'; // text-amber-400 (Shield)

export interface ThermalLoadPanelProps {
  sensors: TempSensor[];
  peakPower: number;
  avgPowerMax: number;
  stats: DrivingStats | undefined;
}

export function ThermalLoadPanel({
  sensors,
  peakPower,
  avgPowerMax,
  stats,
}: ThermalLoadPanelProps) {
  const t = useNativeTranslationFallback();

  const {data: settings} = useSettings();
  const locale = deriveLocale(settings?.locale);
  const temperatureUnit = deriveTemperature(settings?.unit_of_temp);
  const precision = derivePrecision(settings?.decimal_precision);

  // Mirror of `const { formatTemperature } = useUnits()`.
  const formatTemperatureUnit = useCallback(
    (value: number | null | undefined, options?: {precision?: number}): string => {
      if (!(typeof value === 'number' && Number.isFinite(value))) {
        return DEFAULT_EMPTY_DISPLAY;
      }
      const digits = resolvePrecision(
        precision,
        options?.precision,
        DEFAULT_TEMP_PRECISION,
      );
      return `${formatNumber(
        convertTempFromSI(value, temperatureUnit),
        locale,
        digits,
      )}${temperatureUnit}`;
    },
    [precision, temperatureUnit, locale],
  );
  // Mirror of `const formatTemperature = (value, precision?) =>
  // formatTemperatureUnit(value, { precision })`.
  const formatTemperature = useCallback(
    (value: number | null | undefined, precisionOverride?: number) =>
      formatTemperatureUnit(value, {precision: precisionOverride}),
    [formatTemperatureUnit],
  );

  const columns = useInlineColumns();

  const activityGlyph = getSemanticIconDefinition('activity').glyph;
  const boltGlyph = getSemanticIconDefinition('bolt').glyph;
  const trendUpGlyph = getSemanticIconDefinition('trendUp').glyph;
  const securityGlyph = getSemanticIconDefinition('security').glyph;

  return (
    <FadeIn delay={0.2}>
      <GlassPanel style={styles.panel}>
        <View style={styles.heading}>
          <AppText style={styles.headingIcon} tone="muted" weight="bold">
            {activityGlyph}
          </AppText>
          <AppText style={styles.headingText} weight="semibold">
            {t('drivetrain.thermalMetrics', 'Thermal Load Indicators')}
          </AppText>
        </View>

        <View style={styles.sensors}>
          {sensors.map(sensor => (
            <MetricBar
              key={sensor.key}
              label={t(sensor.labelKey, sensor.defaultLabel)}
              value={sensor.value ?? 0}
              max={sensor.maxTemp}
              color={tempSeverityColor(sensor.value, sensor.maxTemp)}
              sublabel={displayTemp(sensor.value, formatTemperature)}
            />
          ))}
        </View>

        <View style={styles.grid}>
          <View style={[styles.gridCell, {width: `${100 / columns}%`}]}>
            <InlineMetric
              icon={
                <AppText style={[styles.inlineMetricIcon, {color: PURPLE_400}]} weight="bold">
                  {boltGlyph}
                </AppText>
              }
              label={t('drivetrain.peakPower', 'Peak Power')}
              value={peakPower > 0 ? `${fmtInt(peakPower, locale)} kW` : '—'}
            />
          </View>
          <View style={[styles.gridCell, {width: `${100 / columns}%`}]}>
            <InlineMetric
              icon={
                <AppText style={[styles.inlineMetricIcon, {color: CYAN_400}]} weight="bold">
                  {trendUpGlyph}
                </AppText>
              }
              label={t('drivetrain.avgPower', 'Avg Power')}
              value={avgPowerMax > 0 ? `${fmtNumber(avgPowerMax, 1, locale)} kW` : '—'}
            />
          </View>
          <View style={[styles.gridCell, {width: `${100 / columns}%`}]}>
            <InlineMetric
              icon={
                <AppText style={[styles.inlineMetricIcon, {color: GREEN_400}]} weight="bold">
                  {activityGlyph}
                </AppText>
              }
              label={t('drivetrain.drivesLabel', 'Drives')}
              value={stats ? fmtInt(stats.totalDrives, locale) : '—'}
            />
          </View>
          <View style={[styles.gridCell, {width: `${100 / columns}%`}]}>
            <InlineMetric
              icon={
                <AppText style={[styles.inlineMetricIcon, {color: AMBER_400}]} weight="bold">
                  {securityGlyph}
                </AppText>
              }
              label={t('drivetrain.regenRatio', 'Regen Ratio')}
              value={stats ? `${fmtNumber(stats.regenRatio * 100, 1, locale)}%` : '—'}
            />
          </View>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

ThermalLoadPanel.displayName = 'ThermalLoadPanel';

const styles = StyleSheet.create({
  // GlassPanel p-6.
  panel: {
    padding: 24,
  },
  // h3 ... mb-4 + the inline Activity icon.
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  // Activity glyph (mr-2 inline-block h-4 w-4), muted to match the heading.
  headingIcon: {
    marginRight: 8,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.4,
  },
  // text-sm font-medium uppercase tracking-wider text-[var(--text-muted)].
  headingText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // space-y-4.
  sensors: {
    gap: 16,
  },
  // mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4 (negative-margin gutter trick).
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 24,
    marginHorizontal: -HALF_GAP,
  },
  gridCell: {
    padding: HALF_GAP,
  },
  // inline-flex items-center gap-1 text-xs.
  inlineMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  // The h-3 w-3 inline icon.
  inlineMetricIcon: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.3,
  },
  // text-xs (value + optional label), text-muted via the AppText tone.
  inlineMetricText: {
    fontSize: 12,
    lineHeight: 16,
  },
});
