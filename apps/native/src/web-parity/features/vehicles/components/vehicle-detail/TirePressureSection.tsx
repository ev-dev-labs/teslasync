// Native parity port of
// web/src/features/vehicles/components/vehicle-detail/TirePressureSection.tsx.
//
// `TirePressureSection` is the vehicle-detail "Tire Pressure" card: a GlassPanel
// (p-6) with a CircleDot-iconed section heading followed by either a 2-up grid of
// per-corner tiles (each a nested GlassPanel showing the FL/FR/RL/RR label, the
// formatted pressure, and a severity Badge) or a single icon+message EmptyState.
// Every prop name (`tireData`), field read (`front_left`, `front_right`,
// `rear_left`, `rear_right`), the four corner i18n labels
// (`vehicles.detail.tireFl/Fr/Rl/Rr`), the heading key
// (`vehicles.detail.tirePressure`), the empty key (`vehicles.detail.noTireData`),
// the Badge status ternary keys (`common.normal/low/critical/noData`), the SI-Pa
// threshold table (`TIRE_PRESSURE_PA`), the `paToKpa` Pa->kPa helper, the
// `tirePressureVariant` severity mapper, and the `formatPressure(paToKpa(value))`
// display chain are preserved verbatim.
//
// Web modules -> native-safe mappings (contract rules 4-7):
//   - react-i18next `useTranslation` (L1) -> a local key-preserving fallback shim
//     returning the inline English copy (no react-i18next in the native deps; the
//     established sibling-port approach). Every i18n key + intent survives.
//   - lucide-react `CircleDot` (L2, SVG) has no native analog -> a decorative
//     "◉" (fisheye: ring + centre dot) glyph rendered in `AppText` (the barrel's
//     CircleDot->◉ precedent). Used for both the cyan heading icon and the muted
//     empty-state icon. Decorative, so hidden from the a11y tree (the adjacent
//     heading/message text carries the meaning).
//   - `GlassPanel` + `Badge` from `@/components/ui` (L4) -> the shared native
//     `components/ui/GlassPanel` (View glass card) and the ported web-parity
//     `web-parity/components/ui/Badge` (variant/size API; tirePressureVariant's
//     success|warning|danger|neutral are all valid Badge variants).
//   - `EmptyState` from `@/components/feedback` (L5) -> a local icon+message shim:
//     the shared native EmptyState requires a `title` the source never supplies
//     and renders no icon, so the web icon+message intent is reproduced locally
//     (the EnergyChargingPanel / barrel precedent). The web no-action JSDoc note
//     is carried in the sidecar.
//   - `useUnits` from `@/hooks/useUnits` (L6) + the `formatPressure` it exposes ->
//     a local shim reading the native `useSettings` web-parity hook. The lib
//     pressure converter/formatter is inlined verbatim (`convertPressureFromSI`
//     kPa->kPa|psi|bar with KPA_PER_PSI=6.894757 / KPA_PER_BAR=100;
//     `derivePressure` psi else bar; `deriveLocale` en-US fallback;
//     `derivePrecision` flooring the user's `decimal_precision`; the
//     DEFAULT_PRECISION.pressure=1 fallback; `formatNumber` locale-aware with an
//     en-US try/catch for Hermes ICU gaps). Non-finite -> '—' (web resolveEmpty).
//   - `TirePressureSnapshot` type from `@/api/types` (L7) -> the ported native
//     `web-parity/api/types` interface (field-for-field match).
//   - `TIRE_PRESSURE_PA` / `paToKpa` / `tirePressureVariant` from `./helpers`
//     (L8) -> inlined native-safe equivalents (the vehicle-detail helpers are not
//     ported as a standalone module; the same constants/logic are reproduced
//     byte-for-byte, identical to the barrel + TirePressurePanel inlines).
//
// DOM -> native element mapping: every web `<div>` becomes a `View`; the heading
// `<span>`, the tile label/value `<p>`s, and the empty message become `AppText`.
// Tailwind maps to StyleSheet/token styles (1 spacing unit = 4px: p-6 -> 24,
// p-4 -> 16, mb-4 -> 16, mb-1 -> 4, mt-2 -> 8, gap-2 -> 8, gap-4 -> 16,
// py-16 -> 64; text-xs -> 12, text-lg -> 18, text-2xl -> 24; h-4/w-4 -> 14,
// h-8/w-8 -> 32). `grid grid-cols-2 ... sm:grid-cols-4` -> a flexWrap row of two
// flex-grow columns (native is mobile-first; the sm: 4-col breakpoint has no RN
// analog and stays at 2-up). `--neon-cyan` -> colors.accent, `--text-primary` ->
// colors.textPrimary, `--text-muted` -> colors.textMuted. No DOM-only modules,
// browser HTML elements, Recharts, Leaflet, or old web UI components are imported.

import React from 'react';
import {StyleSheet, View, type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {Badge} from '../../../../components/ui/Badge';
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

type PressureUnitPref = 'kPa' | 'psi' | 'bar';

// ─── Inlined `./helpers` (SI Pa thresholds + Pa->kPa + variant) ──
// Backend tire-pressure SI baseline is Pascals; thresholds live in Pa so one
// canonical source of truth is shared. Display converts Pa -> kPa -> user pref.
const TIRE_PRESSURE_PA = Object.freeze({
  LOW_CRITICAL: 206_800, // ≈ 30.0 psi / 2.068 bar
  LOW_WARNING: 241_300, // ≈ 35.0 psi / 2.413 bar
  HIGH_WARNING: 310_300, // ≈ 45.0 psi / 3.103 bar
  HIGH_CRITICAL: 344_700, // ≈ 50.0 psi / 3.447 bar
} as const);

// formatPressure expects kPa input; 1 kPa = 1000 Pa.
function paToKpa(pa: number | null | undefined): number | null {
  if (pa == null || !Number.isFinite(pa)) {
    return null;
  }
  return pa / PA_PER_KPA;
}

type TireVariant = 'success' | 'warning' | 'danger' | 'neutral';

// null/non-finite -> neutral; outside critical band -> danger; outside warning
// band -> warning; else -> success. Branch order preserved verbatim.
function tirePressureVariant(pa: number | null | undefined): TireVariant {
  if (pa == null || !Number.isFinite(pa)) {
    return 'neutral';
  }
  if (pa < TIRE_PRESSURE_PA.LOW_CRITICAL || pa > TIRE_PRESSURE_PA.HIGH_CRITICAL) {
    return 'danger';
  }
  if (pa < TIRE_PRESSURE_PA.LOW_WARNING || pa > TIRE_PRESSURE_PA.HIGH_WARNING) {
    return 'warning';
  }
  return 'success';
}

// ─── i18n fallback shim ───────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, so intent survives.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// ─── Inlined `@/lib/unitConversion` pressure helpers ──────────
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
  if (!Number.isFinite(decimalPrecision) || decimalPrecision < 0) {
    return undefined;
  }
  return Math.floor(decimalPrecision);
}

// ─── `useUnits` bridge (formatPressure only) ──────────────────
// Mirrors the web `useUnits -> useSettings` chain for the lone formatter this
// section uses. `formatPressure` reads SI kPa, converts at the display boundary,
// floors precision at the user's `decimal_precision` else the lib pressure
// default (1), and suffixes the unit — byte-identical to libFormatPressure.
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

// ─── Decorative glyph (lucide CircleDot → native-safe glyph) ──
// The adjacent heading/message text carries the meaning, so the glyph is hidden
// from the accessibility tree.
function Glyph({
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

// ─── EmptyState (web @/components/feedback EmptyState, icon + message) ──
// The shared native EmptyState requires a `title` the source never supplies and
// renders no icon, so the web icon+message layout is reproduced locally. Web
// no-action note: transient empty state — surfaces when source data is missing;
// no specific recovery action available.
function EmptyState({
  glyph,
  message,
}: {
  glyph: string;
  message: string;
}): React.ReactElement {
  return (
    <View accessibilityRole="text" style={styles.emptyState}>
      <Glyph glyph={glyph} style={styles.emptyGlyph} />
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

interface TirePressureSectionProps {
  tireData: TirePressureSnapshot | null | undefined;
}

export function TirePressureSection({tireData}: TirePressureSectionProps) {
  const {t} = useTranslation();
  const {formatPressure} = useUnits();

  const tirePressures = tireData
    ? [
        {label: t('vehicles.detail.tireFl', 'Front Left'), value: tireData.front_left},
        {label: t('vehicles.detail.tireFr', 'Front Right'), value: tireData.front_right},
        {label: t('vehicles.detail.tireRl', 'Rear Left'), value: tireData.rear_left},
        {label: t('vehicles.detail.tireRr', 'Rear Right'), value: tireData.rear_right},
      ]
    : [];

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.heading}>
        <Glyph glyph="◉" style={styles.headingGlyph} />
        <AppText style={styles.headingText}>
          {t('vehicles.detail.tirePressure', 'Tire Pressure')}
        </AppText>
      </View>
      {tireData ? (
        <View style={styles.grid}>
          {tirePressures.map(tp => (
            <GlassPanel key={tp.label} style={styles.tile}>
              <AppText style={styles.tileLabel} tone="muted">
                {tp.label}
              </AppText>
              <AppText style={styles.tileValue}>
                {formatPressure(paToKpa(tp.value))}
              </AppText>
              <View style={styles.tileBadge}>
                <Badge variant={tirePressureVariant(tp.value)} size="sm">
                  {tp.value != null
                    ? tp.value >= TIRE_PRESSURE_PA.LOW_WARNING &&
                      tp.value <= TIRE_PRESSURE_PA.HIGH_WARNING
                      ? t('common.normal', 'Normal')
                      : tp.value >= TIRE_PRESSURE_PA.LOW_CRITICAL &&
                          tp.value <= TIRE_PRESSURE_PA.HIGH_CRITICAL
                        ? t('common.low', 'Low')
                        : t('common.critical', 'Critical')
                    : t('common.noData', 'No Data')}
                </Badge>
              </View>
            </GlassPanel>
          ))}
        </View>
      ) : (
        <EmptyState
          glyph="◉"
          message={t('vehicles.detail.noTireData', 'No tire pressure data available')}
        />
      )}
    </GlassPanel>
  );
}

TirePressureSection.displayName = 'TirePressureSection';

export default TirePressureSection;

const styles = StyleSheet.create({
  panel: {
    padding: 24, // p-6
  },
  heading: {
    alignItems: 'center', // items-center
    flexDirection: 'row', // flex
    gap: 8, // gap-2
    marginBottom: 16, // mb-4
  },
  headingGlyph: {
    color: colors.accent, // text-[var(--neon-cyan)]
    fontSize: 14, // h-4 w-4
  },
  headingText: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 18, // text-lg
    fontWeight: '700', // font-bold
  },
  glyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  grid: {
    flexDirection: 'row', // grid
    flexWrap: 'wrap', // grid-cols-2 (wrap two per row)
    gap: 16, // gap-4
  },
  tile: {
    alignItems: 'center', // text-center
    flexBasis: '47%', // grid-cols-2
    flexGrow: 1, // grow equally to fill the row
    minWidth: 140,
    padding: 16, // p-4
  },
  tileLabel: {
    fontSize: 12, // text-xs
    marginBottom: 4, // mb-1
    textAlign: 'center',
  },
  tileValue: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 24, // text-2xl
    fontWeight: '700', // font-bold
    textAlign: 'center',
  },
  tileBadge: {
    marginTop: 8, // mt-2
  },
  emptyState: {
    alignItems: 'center', // items-center
    gap: 16, // icon mb-4
    paddingVertical: 64, // py-16
  },
  emptyGlyph: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 32, // h-8 w-8
    lineHeight: 36,
  },
  emptyMessage: {
    textAlign: 'center', // text-center
  },
});
