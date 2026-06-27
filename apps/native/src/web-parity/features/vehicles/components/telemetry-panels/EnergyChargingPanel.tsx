import {Glyph} from '../../../../../components/icons/Glyph';
// Native parity port of
// web/src/features/vehicles/components/telemetry-panels/EnergyChargingPanel.tsx.
//
// `EnergyChargingPanel` is the vehicle-telemetry "Energy & Charging" card: a
// GlassPanel (p-6 h-full) with a BatteryCharging-iconed section heading followed
// by either a stack of charging metrics or a single "no data" EmptyState. The
// metric stack is: a 2-up grid of `MetricCard`s (Charger Voltage "V" / Charger
// Current "A"), then four label/value rows (Charger Power "kW", Energy Added
// "kWh", Charging State chip, Battery Level "%"), and a Zap-labelled Charge Rate
// row. Every prop name (`chargingTelemetry`), field read (`charger_voltage`,
// `charger_actual_current`, `charger_power_w`, `charge_energy_added_wh`,
// `charging_state`, `battery_level`, `range_added_meters_per_hour`), the null
// guards (`!= null ? … : '—'`), the unit strings ("V"/"A"/"kW"/"kWh"/"%"), the
// `range_added_meters_per_hour / 3600` m/s conversion, the charging-state colour
// branches (Charging→cyan, Complete→green, else→muted), and the i18n keys +
// English fallbacks are preserved verbatim.
//
// Web modules -> native-safe mappings (contract rules 4-7):
//   - react-i18next `useTranslation` (L1) -> the standard local key-preserving
//     fallback shim returning the inline English copy (no react-i18next in the
//     native deps; same approach as every sibling telemetry/charging port).
//   - lucide-react `BatteryCharging`/`Zap` (L2, SVG) have no native analog ->
//     small decorative emoji glyphs ("🔋"/"⚡") rendered in `AppText` (the
//     ChargerSpecsPanel `<Glyph .../>` precedent). Each glyph is decorative
//     (accessibilityElementsHidden) because the adjacent heading/label text
//     carries the meaning. The heading glyph keeps its cyan tint via colors.accent
//     (web text-cyan-300); the Zap glyph inherits the muted label tone.
//   - `cn` from `@/lib/cn` (L3) -> dropped; the charging-state `cn(base, …ternary)`
//     becomes pre-resolved StyleSheet variants selected by `resolveChargingChip`.
//   - `GlassPanel` from `@/components/ui` (L4) -> the native shared
//     `components/ui/GlassPanel` primitive (View-based glass card).
//   - `MetricCard` from `@/components/data-display` (L5) -> a faithful local
//     View-based shim reproducing the web compact card (p-3 rounded-xl
//     bg-white/[0.02] border-white/[0.04]; metric-label 10px uppercase muted;
//     text-xl bold primary value; 10px muted subtitle). The shared native
//     ui/MetricCard has a different API/visual (indicator dot + display value), so
//     the web look is reproduced locally (the DetailCards Card/KVList precedent).
//   - `EmptyState` from `@/components/feedback` (L6) -> a message-only local shim
//     mirroring the web single-`message` API; the shared native EmptyState
//     requires a `title` the source never supplies (the ChargerSpecsPanel
//     precedent). The web no-action JSDoc intent is carried in the sidecar.
//   - `fmtNumber`/`fmtWithUnit` from `@/lib/numberFormat` (L7) -> inlined
//     native-safe equivalents (`formatNumber` + `safeNumber`): nullish/non-finite
//     -> 0, en-US locale fallback, the user's `decimal_precision` honoured as the
//     default precision (web `_globalPrecision`, set by useSettings) else 2.
//   - `useUnits` from `@/hooks/useUnits` (L8) -> a local shim reading the native
//     `useSettings` web-parity hook and exposing `formatSpeed` (+ the
//     decimal_precision-bound `fmtNumber`/`fmtWithUnit`), mirroring the web
//     `useUnits -> useSettings` chain. `convertSpeedFromSI`/`deriveSpeed` are
//     inlined verbatim from `@/lib/unitConversion` (same constants, same km/h+mph
//     switch); the speed precision floor is the lib `DEFAULT_PRECISION.speed` (0).
//     The metric/imperial pref derives from `unit_of_length`; locale is en-US.
//   - `ChargingTelemetry` type from `@/api/types` (L9) -> the already-ported
//     native `web-parity/api/types` interface (field-for-field match).
//
// DOM -> native element mapping: every web `<div>` becomes a `View`; the heading
// `<h3>`/`<span>`/`<p>` become `AppText`. Tailwind maps to StyleSheet/token styles
// (1 spacing unit = 4px: p-6 -> 24, mb-5 -> 20, gap-4 -> 16, gap-3 -> 12,
// gap-2 -> 8, gap-1.5 -> 6, gap-1 -> 4); `--text-muted` -> the AppText muted tone;
// `--text-primary` -> the default primary tone; `font-mono` -> the iOS Menlo /
// monospace family. No DOM-only modules, browser HTML elements, Recharts, Leaflet,
// or old web UI components are imported.

import React from 'react';
import {Platform, StyleSheet, View, type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';
import type {ChargingTelemetry} from '../../../../api/types';

// ─── Shared constants ─────────────────────────────────────────
const EMPTY_DISPLAY = '—';
const DEFAULT_LOCALE = 'en-US';
// web `_globalPrecision` initial (useSettings promotes it to decimal_precision).
const DEFAULT_GLOBAL_PRECISION = 2;
// web `DEFAULT_PRECISION.speed` fallback when pref.precision is unset.
const DEFAULT_SPEED_PRECISION = 0;
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const SECONDS_PER_HOUR = 3600;

type SpeedUnitPref = 'km/h' | 'mph';

// ─── i18n fallback shim ───────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, so intent survives.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// ─── Inlined `@/lib/numberFormat` (safeNumber / formatNumber) ──
// Locale-aware formatting matching the web helpers: nullish/non-finite input
// coerces to 0 and a bad locale falls back to en-US.
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatNumber(
  value: unknown,
  decimals: number,
  locale: string = DEFAULT_LOCALE,
): string {
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

// ─── Inlined `@/lib/unitConversion` (convertSpeedFromSI) ───────
// Verbatim port: SI meters-per-second -> the user's display unit.
function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

// ─── `useUnits` derivations (web @/hooks/useUnits) ─────────────
// Mirrors the web `deriveSpeed` (imperial length ⇒ mph, else km/h) and
// `derivePrecision` (floor a valid non-negative int, else undefined).
function deriveSpeed(unitOfLength: string | undefined): SpeedUnitPref {
  return unitOfLength === 'mi' ? 'mph' : 'km/h';
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

// ─── `useUnits` + numberFormat bridge (single settings read) ──
// Mirrors the web `useUnits -> useSettings` chain. `formatSpeed` reads SI m/s,
// converts at the display boundary, and floors precision at the lib speed default
// (0). `fmtNumber`/`fmtWithUnit` honour the user's `decimal_precision` (web
// `_globalPrecision`) else 2, keeping the JSX call sites byte-identical.
function useUnits(): {
  formatSpeed: (mps: number | null | undefined) => string;
  fmtNumber: (value: unknown, decimals?: number) => string;
  fmtWithUnit: (value: unknown, unit: string, decimals?: number) => string;
} {
  const {data: settings} = useSettings();
  const speed = deriveSpeed(settings?.unit_of_length);
  const settingsPrecision = derivePrecision(settings?.decimal_precision);
  const numberPrecision = settingsPrecision ?? DEFAULT_GLOBAL_PRECISION;
  const speedPrecision = settingsPrecision ?? DEFAULT_SPEED_PRECISION;

  const fmtNumber = (value: unknown, decimals: number = numberPrecision): string =>
    formatNumber(value, decimals);

  const fmtWithUnit = (
    value: unknown,
    unit: string,
    decimals?: number,
  ): string => `${formatNumber(value, decimals ?? numberPrecision)} ${unit}`;

  const formatSpeed = (mps: number | null | undefined): string => {
    if (!isFiniteNumber(mps)) {
      return EMPTY_DISPLAY;
    }
    return `${formatNumber(
      convertSpeedFromSI(mps, speed),
      speedPrecision,
    )} ${speed}`;
  };

  return {formatSpeed, fmtNumber, fmtWithUnit};
}

// ─── Decorative glyph (lucide icon → native-safe text glyph) ──
// The adjacent heading/label text carries the meaning, so each glyph is hidden
// from the accessibility tree.
function GlyphLegacyUnused({
  glyph,
  style,
}: {
  glyph: string;
  style?: StyleProp<TextStyle>;
}): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, style]}>
      {glyph}
    </AppText>
  );
}

// ─── MetricCard (web @/components/data-display MetricCard, compact) ──
// Faithful reproduction of the web card's label-only surface this panel uses.
function MetricCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
}): React.ReactElement {
  return (
    <View style={styles.metricCard}>
      <AppText style={styles.metricLabel} tone="muted">
        {label}
      </AppText>
      <AppText style={styles.metricValue}>{value}</AppText>
      {subtitle ? (
        <AppText style={styles.metricSubtitle} tone="muted">
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

// ─── StatRow (web `flex items-center justify-between` rows) ────
// Muted text-xs label (with an optional leading glyph) + mono text-sm primary
// value. Covers Charger Power / Energy Added / Battery Level / Charge Rate.
function StatRow({
  label,
  value,
  glyph,
}: {
  label: string;
  value: string;
  glyph?: string;
}): React.ReactElement {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelWrap}>
        {glyph ? <Glyph glyph={glyph} style={styles.rowGlyph} /> : null}
        <AppText style={styles.rowLabel} tone="muted">
          {label}
        </AppText>
      </View>
      <AppText style={styles.rowValue}>{value}</AppText>
    </View>
  );
}

// ─── EmptyState (web @/components/feedback EmptyState, message-only) ──
// Faithful message-only shim: the shared native EmptyState requires a title the
// source never supplies. Web no-action note: transient empty state — surfaces
// when source data is missing; no specific recovery action available.
function EmptyState({message}: {message: string}): React.ReactElement {
  return (
    <View accessibilityRole="text" style={styles.emptyState}>
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// Charging-state chip variants — mirrors the web `cn()` ternary (Charging→cyan,
// Complete→green, else→muted). Border/background use the 500/30+500/10 tints; the
// text uses the brighter 400 shade (muted token for the neutral fallback).
function resolveChargingChip(state: string | null | undefined): {
  container: StyleProp<TextStyle>;
  text: StyleProp<TextStyle>;
} {
  if (state === 'Charging') {
    return {container: styles.chipCharging, text: styles.chipTextCharging};
  }
  if (state === 'Complete') {
    return {container: styles.chipComplete, text: styles.chipTextComplete};
  }
  return {container: styles.chipNeutral, text: styles.chipTextNeutral};
}

interface EnergyChargingPanelProps {
  chargingTelemetry: ChargingTelemetry | null | undefined;
}

export function EnergyChargingPanel({
  chargingTelemetry,
}: EnergyChargingPanelProps) {
  const {t} = useTranslation();
  const {formatSpeed, fmtNumber, fmtWithUnit} = useUnits();
  const chip = resolveChargingChip(chargingTelemetry?.charging_state ?? null);

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.heading}>
        <Glyph glyph="🔋" style={styles.headingGlyph} />
        <AppText style={styles.headingText}>
          {t('telemetry.energyCharging', 'Energy & Charging')}
        </AppText>
      </View>
      {chargingTelemetry ? (
        <View style={styles.content}>
          <View style={styles.metricGrid}>
            <MetricCard
              label={t('telemetry.chargerVoltage', 'Charger Voltage')}
              value={
                chargingTelemetry.charger_voltage != null
                  ? fmtNumber(chargingTelemetry.charger_voltage)
                  : '—'
              }
              subtitle="V"
            />
            <MetricCard
              label={t('telemetry.chargerCurrent', 'Charger Current')}
              value={
                chargingTelemetry.charger_actual_current != null
                  ? fmtNumber(chargingTelemetry.charger_actual_current)
                  : '—'
              }
              subtitle="A"
            />
          </View>

          <StatRow
            label={t('telemetry.chargerPower', 'Charger Power')}
            value={
              chargingTelemetry.charger_power_w != null
                ? `${fmtWithUnit(chargingTelemetry.charger_power_w, 'kW')}`
                : '—'
            }
          />

          <StatRow
            label={t('telemetry.energyAdded', 'Energy Added')}
            value={
              chargingTelemetry.charge_energy_added_wh != null
                ? `${fmtWithUnit(chargingTelemetry.charge_energy_added_wh, 'kWh')}`
                : '—'
            }
          />

          {/* Charging State */}
          <View style={styles.row}>
            <AppText style={styles.rowLabel} tone="muted">
              {t('telemetry.chargingState', 'Charging State')}
            </AppText>
            <View style={[styles.chip, chip.container]}>
              <AppText style={[styles.chipText, chip.text]}>
                {chargingTelemetry.charging_state ?? t('common.unknown', 'Unknown')}
              </AppText>
            </View>
          </View>

          {/* Battery level */}
          <StatRow
            label={t('telemetry.batteryLevel', 'Battery Level')}
            value={
              chargingTelemetry.battery_level != null
                ? `${fmtNumber(chargingTelemetry.battery_level)}%`
                : '—'
            }
          />

          {/* Charge rate */}
          <StatRow
            glyph="⚡"
            label={t('telemetry.chargeRate', 'Charge Rate')}
            value={
              chargingTelemetry.range_added_meters_per_hour != null
                ? formatSpeed(
                    chargingTelemetry.range_added_meters_per_hour / 3600,
                  )
                : '—'
            }
          />
        </View>
      ) : (
        <EmptyState
          message={t(
            'telemetry.noChargingTelemetry',
            'No charging telemetry available',
          )}
        />
      )}
    </GlassPanel>
  );
}

EnergyChargingPanel.displayName = 'EnergyChargingPanel';

export default EnergyChargingPanel;

const styles = StyleSheet.create({
  panel: {
    flex: 1, // h-full
    padding: 24, // p-6
  },
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
    marginBottom: 20, // mb-5
  },
  headingGlyph: {
    color: colors.accent, // text-cyan-300
    fontSize: 14, // h-4 w-4
  },
  headingText: {
    fontSize: 18, // section-title text-lg
    fontWeight: '600', // font-semibold
    letterSpacing: -0.45, // tracking-tight (-0.025em * 18)
    lineHeight: 28,
  },
  content: {
    gap: 16, // space-y-4
  },
  metricGrid: {
    flexDirection: 'row',
    gap: 12, // gap-3 (grid-cols-2)
  },
  metricCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)', // bg-white/[0.02]
    borderColor: 'rgba(255, 255, 255, 0.04)', // border-white/[0.04]
    borderRadius: 12, // rounded-xl
    borderWidth: 1,
    flex: 1, // grid-cols-2 equal columns
    padding: 12, // p-3
  },
  metricLabel: {
    fontSize: 10, // text-[10px]
    fontWeight: '500', // metric-label font-medium
    letterSpacing: 0.5, // tracking-wider
    marginBottom: 4, // mb-1
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 20, // text-xl
    fontWeight: '700', // font-bold
    letterSpacing: -0.5, // tracking-tight
    lineHeight: 26,
  },
  metricSubtitle: {
    fontSize: 10, // text-[10px]
    marginTop: 2, // mt-0.5
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowLabelWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 4, // gap-1
  },
  rowLabel: {
    fontSize: 12, // text-xs
  },
  rowGlyph: {
    color: colors.textMuted, // inherits --text-muted from the label
    fontSize: 12, // h-3 w-3
  },
  rowValue: {
    flexShrink: 1,
    fontFamily: Platform.select({ios: 'Menlo', default: 'monospace'}), // font-mono
    fontSize: 14, // text-sm
    marginLeft: 8,
    textAlign: 'right',
  },
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999, // rounded-full
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6, // gap-1.5
    paddingHorizontal: 12, // px-3
    paddingVertical: 4, // py-1
  },
  chipText: {
    fontSize: 11, // text-[11px]
    fontWeight: '600', // font-semibold
  },
  chipCharging: {
    backgroundColor: 'rgba(6, 182, 212, 0.1)', // bg-cyan-500/10
    borderColor: 'rgba(6, 182, 212, 0.3)', // border-cyan-500/30
  },
  chipComplete: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)', // bg-green-500/10
    borderColor: 'rgba(34, 197, 94, 0.3)', // border-green-500/30
  },
  chipNeutral: {
    backgroundColor: 'rgba(107, 114, 128, 0.1)', // bg-gray-500/10
    borderColor: 'rgba(107, 114, 128, 0.3)', // border-gray-500/30
  },
  chipTextCharging: {
    color: '#22d3ee', // text-cyan-400
  },
  chipTextComplete: {
    color: '#4ade80', // text-green-400
  },
  chipTextNeutral: {
    color: colors.textMuted, // text-[var(--text-muted)]
  },
  glyph: {
    fontSize: 12,
    lineHeight: 16,
  },
  emptyState: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
  },
  emptyMessage: {
    textAlign: 'center',
  },
});
