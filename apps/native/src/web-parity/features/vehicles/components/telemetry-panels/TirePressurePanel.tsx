import {Glyph} from '../../../../../components/icons/Glyph';
// Native parity port of
// web/src/features/vehicles/components/telemetry-panels/TirePressurePanel.tsx.
//
// `TirePressurePanel` is the vehicle-telemetry "Tire Pressure" card: a GlassPanel
// (p-6 h-full) with a Gauge-iconed section heading followed by either a 2x2 grid
// of per-corner tire tiles plus an overall-status chip, or a single "No tire
// pressure data available" placeholder paragraph. Every prop name (`tireData`),
// field read (`front_left`, `front_right`, `rear_left`, `rear_right`), the FL/FR/
// RL/RR corner labels, the SI-Pa threshold table (`TIRE_PRESSURE_PA`), the
// `paToKpa` Pa->kPa helper, the colour/border severity branches (null->muted,
// critical->red, warning->amber, else->green), the `allGood`/`anyBad` aggregate
// predicates, the status-chip ternary ("✓ All Normal" / "✗ Attention Needed" /
// "⚠ Check Pressure"), and the lone i18n key (`common.tirePressure`) + English
// fallback are preserved verbatim. The two hardcoded English strings the source
// never wraps in t() (the status-chip labels and the empty paragraph) stay
// literal, matching the source's i18n intent exactly.
//
// Web modules -> native-safe mappings (contract rules 4-7):
//   - react-i18next `useTranslation` (L1) -> the standard local key-preserving
//     fallback shim returning the inline English copy (no react-i18next in the
//     native deps; same approach as every sibling telemetry panel port).
//   - lucide-react `Gauge` (L2, SVG) has no native analog -> a small decorative
//     emoji glyph "🎛️" rendered in `AppText` (the ChargerSpecsPanel Gauge->🎛️
//     precedent). The glyph is decorative (accessibilityElementsHidden) because
//     the adjacent heading text carries the meaning; it keeps its cyan tint via
//     colors.accent (web text-cyan-300).
//   - `cn` from `@/lib/cn` (L3) -> dropped; the `cn(base, …severity)` className
//     joins become pre-resolved colour values (`tireTextColor`/`tireBorderColor`)
//     and the status-chip `cn()` ternary becomes a StyleSheet variant selected by
//     `resolveStatusChip`, preserving the exact branch order.
//   - `GlassPanel` from `@/components/ui` (L4) -> the native shared
//     `components/ui/GlassPanel` primitive (View-based glass card).
//   - `useUnits` from `@/hooks/useUnits` (L5) + the `formatPressure` it exposes ->
//     a local shim reading the native `useSettings` web-parity hook and exposing
//     `formatPressure(kpa)`. `convertPressureFromSI`/`derivePressure`/
//     `derivePrecision`/`deriveLocale`/`resolvePrecision`/`formatNumber` are
//     inlined verbatim from `@/lib/unitConversion` + `@/hooks/useUnits` (same
//     KPA_PER_PSI/KPA_PER_BAR constants, same kPa|psi|bar switch, same
//     DEFAULT_PRECISION.pressure=1 fallback). The metric/imperial pref derives
//     from `unit_of_pressure`; locale derives from `settings.locale` (en-US
//     fallback, with a try/catch so Hermes locale gaps degrade gracefully).
//   - `TirePressureSnapshot` type from `@/api/types` (L6) -> the already-ported
//     native `web-parity/api/types` interface (field-for-field match).
//   - `TIRE_PRESSURE_PA` + `paToKpa` from `../vehicle-detail/helpers` (L7) ->
//     inlined native-safe equivalents (the vehicle-detail helpers are not yet
//     ported; the same constants/logic are reproduced byte-for-byte).
//
// DOM -> native element mapping: every web `<div>` becomes a `View`; the heading
// `<h3>`, the tile `<p>`s, the empty `<p>`, and the status `<span>` become
// `AppText`. Tailwind maps to StyleSheet/token styles (1 spacing unit = 4px:
// p-6 -> 24, p-4 -> 16, mb-5 -> 20, mb-1 -> 4, gap-3 -> 12, gap-2 -> 8,
// gap-1.5 -> 6, px-3 -> 12, py-1 -> 4, py-6 -> 24); `grid grid-cols-2` -> a
// flexWrap row of two equal flex-grow columns; `--text-muted` -> the AppText
// muted tone / colors.textMuted; `font-mono` -> the iOS Menlo / monospace family.
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

import React from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';
import type {TirePressureSnapshot} from '../../../../api/types';

// ─── Shared constants ─────────────────────────────────────────
const EMPTY_DISPLAY = '—';
const DEFAULT_LOCALE = 'en-US';
// web DEFAULT_PRECISION.pressure fallback when the user's precision is unset.
const DEFAULT_PRESSURE_PRECISION = 1;
// lib unitConversion: 1 psi = 6.894757 kPa (NIST SP 811); 1 bar = 100 kPa (BIPM).
const KPA_PER_PSI = 6.894757;
const KPA_PER_BAR = 100;
// helpers.ts paToKpa: 1 kPa = 1000 Pa.
const PA_PER_KPA = 1000;

// Tailwind severity colours (matching the web 400 text / 500 border+bg tints).
const RED_400 = '#f87171'; // text-red-400
const AMBER_400 = '#fbbf24'; // text-amber-400
const GREEN_400 = '#4ade80'; // text-green-400
const GRAY_600_30 = 'rgba(75, 85, 99, 0.3)'; // border-gray-600/30
const RED_500_30 = 'rgba(239, 68, 68, 0.3)'; // border-red-500/30
const AMBER_500_30 = 'rgba(245, 158, 11, 0.3)'; // border-amber-500/30
const GREEN_500_30 = 'rgba(34, 197, 94, 0.3)'; // border-green-500/30
const RED_500_10 = 'rgba(239, 68, 68, 0.1)'; // bg-red-500/10
const AMBER_500_10 = 'rgba(245, 158, 11, 0.1)'; // bg-amber-500/10
const GREEN_500_10 = 'rgba(34, 197, 94, 0.1)'; // bg-green-500/10

type PressureUnitPref = 'kPa' | 'psi' | 'bar';

// Inlined `../vehicle-detail/helpers` TIRE_PRESSURE_PA (SI Pa thresholds).
const TIRE_PRESSURE_PA = Object.freeze({
  LOW_CRITICAL: 206_800, // ≈ 30.0 psi / 2.068 bar
  LOW_WARNING: 241_300, // ≈ 35.0 psi / 2.413 bar
  HIGH_WARNING: 310_300, // ≈ 45.0 psi / 3.103 bar
  HIGH_CRITICAL: 344_700, // ≈ 50.0 psi / 3.447 bar
} as const);

// Inlined `../vehicle-detail/helpers` paToKpa. formatPressure expects kPa input.
function paToKpa(pa: number | null | undefined): number | null {
  if (pa == null || !Number.isFinite(pa)) {
    return null;
  }
  return pa / PA_PER_KPA;
}

// ─── i18n fallback shim ───────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, so intent survives.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// ─── Inlined `@/lib/unitConversion` helpers ───────────────────
function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// Locale-aware number formatting: a bad/unsupported locale falls back to en-US.
function formatNumber(
  value: number,
  locale: string,
  fractionDigits: number,
): string {
  try {
    return value.toLocaleString(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  } catch {
    return value.toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  }
}

// Verbatim port: SI kilopascals -> the user's display unit.
function convertPressureFromSI(kpa: number, to: PressureUnitPref): number {
  switch (to) {
    case 'kPa':
      return kpa;
    case 'psi':
      return kpa / KPA_PER_PSI;
    case 'bar':
      return kpa / KPA_PER_BAR;
  }
}

// ─── `useUnits` derivations (web @/hooks/useUnits) ────────────
function derivePressure(unitOfPressure: string | undefined): PressureUnitPref {
  return unitOfPressure === 'psi' ? 'psi' : 'bar';
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

// ─── `useUnits` bridge (single settings read) ─────────────────
// Mirrors the web `useUnits -> useSettings` chain. `formatPressure` reads SI kPa,
// converts at the display boundary, floors precision at the user's
// `decimal_precision` (web _globalPrecision) else the lib pressure default (1),
// and suffixes the unit — byte-identical to libFormatPressure(value, pref).
function useUnits(): {
  formatPressure: (kpa: number | null | undefined) => string;
} {
  const {data: settings} = useSettings();
  const pressure = derivePressure(settings?.unit_of_pressure);
  const locale = deriveLocale(settings?.locale);
  const digits =
    derivePrecision(settings?.decimal_precision) ?? DEFAULT_PRESSURE_PRECISION;

  const formatPressure = (kpa: number | null | undefined): string => {
    if (!isFiniteNumber(kpa)) {
      return EMPTY_DISPLAY;
    }
    return `${formatNumber(
      convertPressureFromSI(kpa, pressure),
      locale,
      digits,
    )} ${pressure}`;
  };

  return {formatPressure};
}

// ─── Decorative glyph (lucide icon → native-safe text glyph) ──
// The adjacent heading text carries the meaning, so the glyph is hidden from the
// accessibility tree.
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

// ─── Severity resolvers (web getColor / getBorder) ────────────
// null -> muted; outside critical band -> red; outside warning band -> amber;
// else -> green. Branch order preserved verbatim.
function tireTextColor(pa: number | null): string {
  if (pa == null) {
    return colors.textMuted;
  }
  if (pa < TIRE_PRESSURE_PA.LOW_CRITICAL || pa > TIRE_PRESSURE_PA.HIGH_CRITICAL) {
    return RED_400;
  }
  if (pa < TIRE_PRESSURE_PA.LOW_WARNING || pa > TIRE_PRESSURE_PA.HIGH_WARNING) {
    return AMBER_400;
  }
  return GREEN_400;
}

function tireBorderColor(pa: number | null): string {
  if (pa == null) {
    return GRAY_600_30;
  }
  if (pa < TIRE_PRESSURE_PA.LOW_CRITICAL || pa > TIRE_PRESSURE_PA.HIGH_CRITICAL) {
    return RED_500_30;
  }
  if (pa < TIRE_PRESSURE_PA.LOW_WARNING || pa > TIRE_PRESSURE_PA.HIGH_WARNING) {
    return AMBER_500_30;
  }
  return GREEN_500_30;
}

// Status chip variants — mirrors the web `cn()` ternary (allGood->green,
// anyBad->red, else->amber). Border/background use the 500/30 + 500/10 tints; the
// text uses the brighter 400 shade.
function resolveStatusChip(
  allGood: boolean,
  anyBad: boolean,
): {container: ViewStyle; text: TextStyle} {
  if (allGood) {
    return {container: styles.chipGood, text: styles.chipTextGood};
  }
  if (anyBad) {
    return {container: styles.chipBad, text: styles.chipTextBad};
  }
  return {container: styles.chipWarn, text: styles.chipTextWarn};
}

interface TirePressurePanelProps {
  tireData: TirePressureSnapshot | null | undefined;
}

export function TirePressurePanel({tireData}: TirePressurePanelProps) {
  const {t} = useTranslation();
  const {formatPressure} = useUnits();

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.heading}>
        <Glyph glyph="🎛️" style={styles.headingGlyph} />
        <AppText style={styles.headingText}>
          {t('common.tirePressure', 'Tire Pressure')}
        </AppText>
      </View>
      {tireData ? (
        <TirePressureContent
          tireData={tireData}
          formatPressure={formatPressure}
        />
      ) : (
        <AppText style={styles.emptyText} tone="muted">
          No tire pressure data available
        </AppText>
      )}
    </GlassPanel>
  );
}

function TirePressureContent({
  tireData,
  formatPressure,
}: {
  tireData: TirePressureSnapshot;
  formatPressure: (kpa: number | null | undefined) => string;
}) {
  const tires = [
    {label: 'FL', pa: tireData.front_left},
    {label: 'FR', pa: tireData.front_right},
    {label: 'RL', pa: tireData.rear_left},
    {label: 'RR', pa: tireData.rear_right},
  ];

  const allGood = tires.every(
    tire =>
      tire.pa != null &&
      tire.pa >= TIRE_PRESSURE_PA.LOW_WARNING &&
      tire.pa <= TIRE_PRESSURE_PA.HIGH_WARNING,
  );
  const anyBad = tires.some(
    tire =>
      tire.pa != null &&
      (tire.pa < TIRE_PRESSURE_PA.LOW_CRITICAL ||
        tire.pa > TIRE_PRESSURE_PA.HIGH_CRITICAL),
  );

  const chip = resolveStatusChip(allGood, anyBad);

  return (
    <View style={styles.content}>
      <View style={styles.grid}>
        {tires.map(tire => (
          <View
            key={tire.label}
            style={[styles.tile, {borderColor: tireBorderColor(tire.pa)}]}>
            <AppText style={styles.tileLabel} tone="muted">
              {tire.label}
            </AppText>
            <AppText style={[styles.tileValue, {color: tireTextColor(tire.pa)}]}>
              {formatPressure(paToKpa(tire.pa))}
            </AppText>
          </View>
        ))}
      </View>
      <View style={styles.statusRow}>
        <View style={[styles.chip, chip.container]}>
          <AppText style={[styles.chipText, chip.text]}>
            {allGood
              ? '✓ All Normal'
              : anyBad
                ? '✗ Attention Needed'
                : '⚠ Check Pressure'}
          </AppText>
        </View>
      </View>
    </View>
  );
}

TirePressurePanel.displayName = 'TirePressurePanel';

export default TirePressurePanel;

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
  emptyText: {
    fontSize: 12, // text-xs
    paddingVertical: 24, // py-6
    textAlign: 'center',
  },
  content: {
    gap: 16, // space-y-4
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap', // grid-cols-2 (2x2)
    gap: 12, // gap-3
  },
  tile: {
    alignItems: 'center', // text-center
    backgroundColor: 'rgba(255, 255, 255, 0.02)', // bg-white/[0.02]
    borderRadius: 12, // rounded-xl
    borderWidth: 1, // border
    flexBasis: '45%', // grid-cols-2: wrap two per row
    flexGrow: 1, // grow equally to fill the row
    padding: 16, // p-4
  },
  tileLabel: {
    fontSize: 10, // text-[10px]
    marginBottom: 4, // mb-1
    textAlign: 'center',
  },
  tileValue: {
    fontFamily: Platform.select({ios: 'Menlo', default: 'monospace'}), // font-mono
    fontSize: 20, // text-xl
    fontWeight: '700', // font-bold
    textAlign: 'center',
  },
  statusRow: {
    alignItems: 'center', // text-center
  },
  chip: {
    alignItems: 'center',
    borderRadius: 999, // rounded-full
    borderWidth: 1, // border
    flexDirection: 'row',
    gap: 6, // gap-1.5
    paddingHorizontal: 12, // px-3
    paddingVertical: 4, // py-1
  },
  chipText: {
    fontSize: 11, // text-[11px]
    fontWeight: '600', // font-semibold
  },
  chipGood: {
    backgroundColor: GREEN_500_10, // bg-green-500/10
    borderColor: GREEN_500_30, // border-green-500/30
  },
  chipBad: {
    backgroundColor: RED_500_10, // bg-red-500/10
    borderColor: RED_500_30, // border-red-500/30
  },
  chipWarn: {
    backgroundColor: AMBER_500_10, // bg-amber-500/10
    borderColor: AMBER_500_30, // border-amber-500/30
  },
  chipTextGood: {
    color: GREEN_400, // text-green-400
  },
  chipTextBad: {
    color: RED_400, // text-red-400
  },
  chipTextWarn: {
    color: AMBER_400, // text-amber-400
  },
  glyph: {
    fontSize: 12,
    lineHeight: 16,
  },
});
