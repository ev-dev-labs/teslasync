// Native parity port of
// web/src/features/vehicles/components/telemetry-panels/PowertrainPanel.tsx.
//
// The web component is the vehicle-telemetry "Powertrain" panel: a GlassPanel
// (p-6 h-full) with a section-title heading (Cog icon + "Powertrain") and, when
// `motorData` is present, a vertical (space-y-4) stack of —
//   1. Shift-state row    — a "Shift State" label + a coloured pill (CircleDot
//                           icon + the shift_state letter) whose border/bg/text
//                           varies by gear: D green, R red, N amber, else grey.
//   2. Power row          — a "Power"/"N kW" header over a bipolar bar (centre
//                           tick at 50%; a green fill growing right for power_kw
//                           >= 0, a red fill growing left for power_kw < 0,
//                           width = min(|kW|/300 * 50, 50)%) with a -300 / 0 /
//                           +300 scale beneath.
//   3. Motor RPM grid     — two MetricCards (Front / Rear RPM, fmtInt, "RPM").
//   4. Torque-split grid  — two MetricCards (Front / Rear Torque, fmtNumber, "Nm").
//   5. Motor Temp (peak)  — label + formatTemperature(max(front, rear)); the
//                           value turns red when the peak exceeds 80 °C.
//   6. Inverter Temp      — label + formatTemperature(inverter_temp_c).
//   7. Regen              — label + "N kW" (green) when regen_kw is present.
// When `motorData` is null/undefined the panel shows an EmptyState message.
//
// This native port preserves that contract 1:1 — the same `motorData` prop, the
// same `maxMotorTemp` derivation, the same null-safety (`?? -Infinity`,
// `!= null`, `Number.isFinite`), the same power-bar maths + colours, the same
// MetricCard slots, every i18n key + English default, the SI-Celsius
// formatTemperature (convert-at-display) and the fmtNumber/fmtInt formatting —
// using React Native primitives, the existing native web-parity MetricCard, the
// native GlassPanel + AppText + design tokens.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation (web L1): no native i18next runtime → inline
//     useNativeTranslation() returns t(key, fallback) = fallback, preserving
//     every key + English default verbatim.
//   - lucide-react Cog / CircleDot (web L2): DOM SVG icons → colour-inheriting
//     text glyph stand-ins (⚙ '\u2699\uFE0E' with the text-presentation
//     selector, and ◉ '\u25C9' for the ring-with-dot CircleDot).
//   - @/lib/cn cn (web L3): Tailwind class concatenation → conditional native
//     style arrays, so no class-string helper is needed.
//   - @/components/ui GlassPanel (web L4): → native GlassPanel.
//   - @/components/data-display MetricCard (web L5): → the already-ported native
//     web-parity MetricCard (identical label / value / subtitle slots).
//   - @/components/feedback EmptyState (web L6): → a local native-safe
//     message-only EmptyState (the LiveMotorStatus convention); the web
//     `<EmptyState message=… />` renders only the message.
//   - @/hooks/useUnits useUnits (web L7): not yet ported → reproduced as a scoped
//     native useUnits() exposing formatTemperature, derived from the web-parity
//     useSettings() (unit_of_temp → '°C'/'°F', locale, decimal_precision) and
//     mirroring web/src/lib/unitConversion.ts formatTemperature exactly
//     (SI-Celsius input → user unit, no space before the degree sign,
//     null/NaN → '—', default precision 1).
//   - @/lib/numberFormat fmtNumber / fmtInt (web L8): inlined ports — locale
//     'en-US', global-default precision 2; fmtInt = fmtNumber(v, 0) — matching
//     the web defaults and the LiveMotorStatus convention.
//   - @/api/types MotorSnapshot (web L9): imported from the already-ported native
//     web-parity api/types so the prop contract is identical.
//   - GlassPanel h-full (web L25) has no native equivalent outside a sized grid
//     row and is omitted (siblings drop non-translating layout hints); the p-6
//     padding is preserved.
//
// No DOM module, browser HTML element, Recharts, Leaflet, lucide DOM SVG,
// framer-motion, or old web @/components import appears in the native output.

import React, {useCallback, useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {useSettings} from '../../../../api/hooks/useSettings';
import type {MotorSnapshot} from '../../../../api/types';
import {MetricCard} from '../../../../components/data-display/MetricCard';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

/* ── i18n: react-i18next useTranslation -> native-safe fallback shim ───────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (_key, fallback) => fallback, []);
}

/* ── native-safe useUnits.formatTemperature (web @/hooks/useUnits) ─────────── */
// Mirrors web/src/lib/unitConversion.ts formatTemperature + the useUnits
// settings derivation so the SI-Celsius → display contract matches exactly.

type TemperatureUnitPref = '\u00b0C' | '\u00b0F'; // already includes the degree sign
type FormatOptions = {precision?: number};
type UnitFormatter = (value: number | null | undefined, options?: FormatOptions) => string;

const DEFAULT_TEMPERATURE_PRECISION = 1;
const DEFAULT_EMPTY_DISPLAY = '\u2014'; // '—'
const DEFAULT_LOCALE = 'en-US';

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  return to === '\u00b0F' ? (celsius * 9) / 5 + 32 : celsius;
}

function deriveTemperature(unitOfTemp: string | undefined): TemperatureUnitPref {
  return unitOfTemp === 'F' ? '\u00b0F' : '\u00b0C';
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

function resolvePrecision(
  pref: number | undefined,
  override: number | undefined,
  fallback: number,
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return Math.floor(override);
  }
  if (typeof pref === 'number' && Number.isFinite(pref) && pref >= 0) {
    return Math.floor(pref);
  }
  return fallback;
}

function formatLocaleNumber(value: number, locale: string, digits: number): string {
  try {
    return value.toLocaleString(locale, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
  } catch {
    return value.toFixed(digits);
  }
}

function useUnits(): {formatTemperature: UnitFormatter} {
  const {data: settings} = useSettings();
  const temperature = deriveTemperature(settings?.unit_of_temp);
  const locale = deriveLocale(settings?.locale);
  const precision = derivePrecision(settings?.decimal_precision);

  const formatTemperature = useCallback<UnitFormatter>(
    (value, options) => {
      if (!(typeof value === 'number' && Number.isFinite(value))) {
        return DEFAULT_EMPTY_DISPLAY;
      }
      const digits = resolvePrecision(precision, options?.precision, DEFAULT_TEMPERATURE_PRECISION);
      const converted = convertTempFromSI(value, temperature);
      // No space between number and °unit (typographic convention, web L354).
      return `${formatLocaleNumber(converted, locale, digits)}${temperature}`;
    },
    [temperature, locale, precision],
  );

  return useMemo(() => ({formatTemperature}), [formatTemperature]);
}

/* ── numberFormat: fmtNumber / fmtInt (web @/lib/numberFormat) ─────────────── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** fmtNumber — locale-aware, web global default precision 2. */
function fmtNumber(v: unknown, decimals = 2): string {
  try {
    return safeNumber(v).toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toFixed(decimals);
  }
}

/** fmtInt — fmtNumber at precision 0 (web/src/lib/numberFormat.ts). */
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ── lucide-react glyph stand-ins (web L2) ─────────────────────────────────── */

const GLYPH_COG = '\u2699\uFE0E'; // ⚙ Cog (text-presentation so it inherits colour)
const GLYPH_CIRCLE_DOT = '\u25C9'; // ◉ CircleDot (ring with centre dot)

/* ── colour constants (tailwind hues consumed by the web classes) ──────────── */

const CYAN_300 = '#67e8f9'; // text-cyan-300 (heading icon)
const GREEN_400 = '#4ade80'; // text-green-400 (D badge text, regen value)
const RED_400 = '#f87171'; // text-red-400 (R badge text, hot motor temp)
const AMBER_400 = '#fbbf24'; // text-amber-400 (N badge text)
const SURFACE_2 = '#151621'; // --surface-2 (power-bar centre tick)
const TRACK_BG = 'rgba(255, 255, 255, 0.04)'; // bg-white/[0.04] (power-bar track)
const POWER_GREEN = 'rgba(34, 197, 94, 0.6)'; // bg-green-500/60 (drive fill)
const POWER_RED = 'rgba(239, 68, 68, 0.6)'; // bg-red-500/60 (regen fill)

/* ── ShiftBadge (native-safe port of the web shift-state pill, web L36-50) ─── */

interface ShiftVariant {
  bg: string;
  border: string;
  text: string;
}

// Mirrors the web border-{c}-500/30 bg-{c}-500/10 text-{c}-400 classes.
const SHIFT_VARIANTS: Record<'D' | 'R' | 'N' | 'default', ShiftVariant> = {
  D: {bg: 'rgba(34, 197, 94, 0.1)', border: 'rgba(34, 197, 94, 0.3)', text: GREEN_400},
  R: {bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.3)', text: RED_400},
  N: {bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.3)', text: AMBER_400},
  default: {bg: 'rgba(107, 114, 128, 0.1)', border: 'rgba(107, 114, 128, 0.3)', text: colors.textMuted},
};

function ShiftBadge({shiftState, label}: {shiftState: string | null; label: string}) {
  const key =
    shiftState === 'D' ? 'D' : shiftState === 'R' ? 'R' : shiftState === 'N' ? 'N' : 'default';
  const variant = SHIFT_VARIANTS[key];

  return (
    <View style={[styles.badge, {backgroundColor: variant.bg, borderColor: variant.border}]}>
      <AppText style={[styles.badgeIcon, {color: variant.text}]}>{GLYPH_CIRCLE_DOT}</AppText>
      <AppText style={[styles.badgeLabel, {color: variant.text}]} weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/* ── EmptyState (native-safe port of @/components/feedback EmptyState) ─────── */

function EmptyState({message}: {message: string}) {
  return (
    <View style={styles.emptyState}>
      <AppText style={styles.emptyText} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ── ported: PowertrainPanel (web L11-160) ─────────────────────────────────── */

interface PowertrainPanelProps {
  motorData: MotorSnapshot | null | undefined;
}

export function PowertrainPanel({motorData}: PowertrainPanelProps) {
  const t = useNativeTranslation();
  const {formatTemperature} = useUnits();

  const maxMotorTemp = motorData
    ? Math.max(
        motorData.motor_temp_c_front ?? -Infinity,
        motorData.motor_temp_c_rear ?? -Infinity,
      )
    : null;

  const powerKw = motorData?.power_kw;
  // width = min(|kW| / 300 * 50, 50)% — the half-bar fill from centre (web L73/77).
  const powerPct = powerKw != null ? Math.min((Math.abs(powerKw) / 300) * 50, 50) : 0;

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <AppText style={styles.titleIcon}>{GLYPH_COG}</AppText>
        <AppText style={styles.title} weight="semibold">
          {t('common.powertrain', 'Powertrain')}
        </AppText>
      </View>

      {motorData ? (
        <View style={styles.body}>
          {/* Shift state badge */}
          <View style={styles.row}>
            <AppText style={styles.rowLabel}>{t('telemetry.shiftState', 'Shift State')}</AppText>
            <ShiftBadge
              shiftState={motorData.shift_state}
              label={motorData.shift_state ?? t('common.unknown', 'Unknown')}
            />
          </View>

          {/* Power */}
          <View>
            <View style={styles.powerHeader}>
              <AppText style={styles.rowLabel}>{t('telemetry.power', 'Power')}</AppText>
              <AppText style={[styles.rowValue, styles.mono, styles.primaryText]}>
                {`${motorData.power_kw != null ? fmtNumber(motorData.power_kw) : DEFAULT_EMPTY_DISPLAY} kW`}
              </AppText>
            </View>
            <View style={styles.powerTrack}>
              <View style={styles.powerCenterLine} />
              {powerKw != null ? (
                <View
                  style={[
                    styles.powerFill,
                    powerKw >= 0 ? styles.powerFillPositive : styles.powerFillNegative,
                    powerKw >= 0
                      ? {left: '50%', width: `${powerPct}%`}
                      : {right: '50%', width: `${powerPct}%`},
                  ]}
                />
              ) : null}
            </View>
            <View style={styles.powerScale}>
              <AppText style={styles.scaleLabel}>-300</AppText>
              <AppText style={styles.scaleLabel}>0</AppText>
              <AppText style={styles.scaleLabel}>+300</AppText>
            </View>
          </View>

          {/* Motor RPM */}
          <View style={styles.metricRow}>
            <MetricCard
              style={styles.metricCell}
              label={t('telemetry.rpmFront', 'Front RPM')}
              value={
                motorData.motor_rpm_front != null
                  ? fmtInt(motorData.motor_rpm_front)
                  : DEFAULT_EMPTY_DISPLAY
              }
              subtitle="RPM"
            />
            <MetricCard
              style={styles.metricCell}
              label={t('telemetry.rpmRear', 'Rear RPM')}
              value={
                motorData.motor_rpm_rear != null
                  ? fmtInt(motorData.motor_rpm_rear)
                  : DEFAULT_EMPTY_DISPLAY
              }
              subtitle="RPM"
            />
          </View>

          {/* Torque split */}
          <View style={styles.metricRow}>
            <MetricCard
              style={styles.metricCell}
              label={t('telemetry.torqueFront', 'Front Torque')}
              value={
                motorData.torque_nm_front != null
                  ? fmtNumber(motorData.torque_nm_front)
                  : DEFAULT_EMPTY_DISPLAY
              }
              subtitle="Nm"
            />
            <MetricCard
              style={styles.metricCell}
              label={t('telemetry.torqueRear', 'Rear Torque')}
              value={
                motorData.torque_nm_rear != null
                  ? fmtNumber(motorData.torque_nm_rear)
                  : DEFAULT_EMPTY_DISPLAY
              }
              subtitle="Nm"
            />
          </View>

          {/* Temperatures */}
          <View style={styles.row}>
            <AppText style={styles.rowLabel}>{t('telemetry.motorTemp', 'Motor Temp (peak)')}</AppText>
            <AppText
              style={[
                styles.rowValue,
                styles.mono,
                maxMotorTemp != null && Number.isFinite(maxMotorTemp) && maxMotorTemp > 80
                  ? styles.dangerText
                  : styles.primaryText,
              ]}>
              {maxMotorTemp != null && Number.isFinite(maxMotorTemp)
                ? formatTemperature(maxMotorTemp)
                : DEFAULT_EMPTY_DISPLAY}
            </AppText>
          </View>
          <View style={styles.row}>
            <AppText style={styles.rowLabel}>{t('telemetry.inverterTemp', 'Inverter Temp')}</AppText>
            <AppText style={[styles.rowValue, styles.mono, styles.primaryText]}>
              {formatTemperature(motorData.inverter_temp_c)}
            </AppText>
          </View>

          {/* Regen */}
          <View style={styles.row}>
            <AppText style={styles.rowLabel}>{t('telemetry.regen', 'Regen')}</AppText>
            <AppText style={[styles.rowValue, styles.mono, styles.regenText]}>
              {motorData.regen_kw != null
                ? `${fmtNumber(motorData.regen_kw)} kW`
                : DEFAULT_EMPTY_DISPLAY}
            </AppText>
          </View>
        </View>
      ) : (
        <EmptyState
          // no-action: transient empty state — surfaces when source data is
          // missing; no specific recovery action available (web L156).
          message={t('telemetry.noMotorData', 'No motor data available')}
        />
      )}
    </GlassPanel>
  );
}

PowertrainPanel.displayName = 'PowertrainPanel';

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: 999, // rounded-full
    borderWidth: 1,
    columnGap: 6, // gap-1.5
    flexDirection: 'row',
    paddingHorizontal: spacing.md, // px-3 (12px)
    paddingVertical: spacing.xs, // py-1 (4px)
  },
  badgeIcon: {
    fontSize: 12, // h-3 w-3
  },
  badgeLabel: {
    fontSize: 11, // text-[11px]
  },
  body: {
    rowGap: 16, // space-y-4
  },
  dangerText: {
    color: RED_400, // text-red-400
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  emptyText: {
    textAlign: 'center',
  },
  metricCell: {
    flex: 1,
  },
  metricRow: {
    columnGap: spacing.md, // gap-3 (12px)
    flexDirection: 'row',
  },
  mono: {
    fontVariant: ['tabular-nums'], // font-mono (aligned numerics)
  },
  panel: {
    padding: spacing.lg + 4, // p-6 (24px)
  },
  powerCenterLine: {
    backgroundColor: SURFACE_2,
    bottom: 0,
    left: '50%',
    position: 'absolute',
    top: 0,
    width: 1, // w-px
  },
  powerFill: {
    borderRadius: 999, // rounded-full
    bottom: 0,
    position: 'absolute',
    top: 0, // inset-y-0
  },
  powerFillNegative: {
    backgroundColor: POWER_RED,
  },
  powerFillPositive: {
    backgroundColor: POWER_GREEN,
  },
  powerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs, // mb-1
  },
  powerScale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2, // mt-0.5
  },
  powerTrack: {
    backgroundColor: TRACK_BG,
    borderRadius: 999,
    height: 12, // h-3
    overflow: 'hidden',
    position: 'relative',
  },
  primaryText: {
    color: colors.textPrimary, // --text-primary
  },
  regenText: {
    color: GREEN_400, // text-green-400
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowLabel: {
    color: colors.textMuted, // --text-muted
    fontSize: 12, // text-xs
  },
  rowValue: {
    fontSize: 14, // text-sm
  },
  scaleLabel: {
    color: colors.textMuted, // --text-muted
    fontSize: 10, // text-[10px]
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18, // section-title == text-lg
    letterSpacing: -0.3, // tracking-tight
  },
  titleIcon: {
    color: CYAN_300, // text-cyan-300
    fontSize: 16, // h-4 w-4
  },
  titleRow: {
    alignItems: 'center',
    columnGap: spacing.sm, // gap-2
    flexDirection: 'row',
    marginBottom: spacing.lg, // mb-5 (20px)
  },
});
