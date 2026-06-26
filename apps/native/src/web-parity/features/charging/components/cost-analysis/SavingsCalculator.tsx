// Native parity port of
// web/src/features/charging/components/cost-analysis/SavingsCalculator.tsx.
//
// The web SavingsCalculator renders a green-glow GlassPanel headed by a
// Calculator icon + "Gas vs Electric Savings Calculator" title, then a
// responsive grid (grid-cols-1 lg:grid-cols-3) split into two columns:
//   1. a "Your Assumptions" inputs column — three numeric <Input>s (gas price
//      $/gal, gas-car MPG, electricity rate $/kWh, each with a unit suffix) plus
//      a full-width "Reset Defaults" <Button> that restores the three DEFAULT_*
//      constants.
//   2. a "Comparison" column (lg:col-span-2) that, when `gasComparison` is
//      non-null, shows a 2x2 grid of GlassPanel stat cards — Gas Cost (red),
//      EV Cost (cyan), Total Savings (green glow) and Monthly Savings (green) —
//      else a centered "Not enough data" message (h-32).
//
// Native-safe substitutions (documented in the parity sidecar):
//   - web `@/components/ui` GlassPanel + glow="green" -> native GlassPanel card
//     shell with a green-tinted border (GREEN_BORDER) echoing the green glow.
//   - web `@/components/ui` Input (DOM <input type="number">) -> native labelled
//     TextInput (keyboardType="numeric") inside a bordered inputRow with the
//     unit suffix rendered as a trailing AppText; the web
//     onChange(e.target.value) becomes onChangeText(text) with the identical
//     Number(text) || fallback (0 / 1 / 0).
//   - web `@/components/ui` Button -> native AppButton (label + onPress); the
//     w-full intent is satisfied by the stretch column, and mt-2 is subsumed by
//     the space-y-3 column gap (Tailwind space-y wins over mt-2).
//   - web `lucide-react` Calculator (DOM/SVG icon, text-green-400) -> leading 🧮
//     glyph (matching the EnvironmentalImpact/QuickMetrics emoji precedent); the
//     green tint is preserved by the surrounding green theme.
//   - web `@/lib/numberFormat` fmtNumber -> inlined native-safe fmtNumber
//     (safeNumber guard, en-US locale, DEFAULT_GLOBAL_PRECISION 2) mirroring the
//     web out-of-box defaults (the native parity layer has no settings store).
//   - web `react-i18next` useTranslation -> useNativeTranslationFallback() shim
//     (each web t(key, fallback) key + English default preserved verbatim).
//   - web `./constants` DEFAULT_GAS_PRICE/DEFAULT_MPG/DEFAULT_ELECTRICITY_RATE
//     -> inlined local consts (3.5 / 30 / 0.13); the native ./constants sibling
//     is a separate conversion target.
//   - web `import type { GasComparison } from './types'` -> inlined local
//     GasComparison interface (identical to the web ./types shape).
//   - web Tailwind text colours preserved as literals: green-400 (#4ade80),
//     green-300 (#86efac), red-400 (#f87171), cyan-400 (#22d3ee); text-white ->
//     AppText primary tone, text-[var(--text-muted)] -> tone="muted",
//     text-[var(--text-secondary)] -> tone="secondary".

import React from 'react';
import {StyleSheet, TextInput, View} from 'react-native';

import {AppButton} from '../../../../../components/ui/AppButton';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

/* ─── inlined `./constants` defaults ───────────────────────────────────────── */

const DEFAULT_GAS_PRICE = 3.5;
const DEFAULT_MPG = 30;
const DEFAULT_ELECTRICITY_RATE = 0.13;

/* ─── inlined `./types` GasComparison ──────────────────────────────────────── */

interface GasComparison {
  gasCost: number;
  evCost: number;
  actualCost: number;
  savings: number;
  monthlySavings: number;
  yearlySavings: number;
  costPerMileGas: number;
  costPerMileEV: number;
}

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ─────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key: string, fallback: string) => fallback;
}

/* ─── native-safe number formatting (web `@/lib/numberFormat`) ──────────────── */

const DEFAULT_GLOBAL_PRECISION = 2;

// Mirrors web `safeNumber`: finite number or 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

/* ─── web Tailwind colours preserved as literals ───────────────────────────── */

const GREEN_400 = '#4ade80'; // text-green-400
const GREEN_300 = '#86efac'; // text-green-300
const RED_400 = '#f87171'; // text-red-400
const CYAN_400 = '#22d3ee'; // text-cyan-400
const GREEN_BORDER = 'rgba(34, 197, 94, 0.32)'; // glow="green" echo

/* ─── SavingsCalculator ────────────────────────────────────────────────────── */

interface SavingsCalculatorProps {
  gasComparison: GasComparison | null;
  gasPrice: number;
  mpg: number;
  electricityRate: number;
  onGasPriceChange: (v: number) => void;
  onMpgChange: (v: number) => void;
  onElectricityRateChange: (v: number) => void;
  distanceUnit: string;
}

export function SavingsCalculator({
  gasComparison,
  gasPrice,
  mpg,
  electricityRate,
  onGasPriceChange,
  onMpgChange,
  onElectricityRateChange,
  distanceUnit,
}: SavingsCalculatorProps) {
  const t = useNativeTranslationFallback();

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.header}>
        <AppText style={styles.iconGlyph}>🧮</AppText>
        <AppText style={styles.title} weight="semibold">
          {t(
            'costAnalysis.calculator.title',
            'Gas vs Electric Savings Calculator',
          )}
        </AppText>
      </View>
      <View style={styles.mainGrid}>
        {/* Inputs */}
        <View style={styles.inputsCol}>
          <AppText style={styles.sectionLabel} tone="muted">
            {t('costAnalysis.calculator.inputs', 'Your Assumptions')}
          </AppText>
          <View style={styles.field}>
            <AppText style={styles.fieldLabel} tone="secondary">
              {t('costAnalysis.calculator.gasPrice', 'Gas Price ($/gal)')}
            </AppText>
            <View style={styles.inputRow}>
              <TextInput
                keyboardType="numeric"
                onChangeText={text => onGasPriceChange(Number(text) || 0)}
                style={styles.input}
                value={String(gasPrice)}
              />
              <AppText style={styles.suffix} tone="muted">
                $/gal
              </AppText>
            </View>
          </View>
          <View style={styles.field}>
            <AppText style={styles.fieldLabel} tone="secondary">
              {t('costAnalysis.calculator.mpg', 'Gas Car MPG')}
            </AppText>
            <View style={styles.inputRow}>
              <TextInput
                keyboardType="numeric"
                onChangeText={text => onMpgChange(Number(text) || 1)}
                style={styles.input}
                value={String(mpg)}
              />
              <AppText style={styles.suffix} tone="muted">
                mpg
              </AppText>
            </View>
          </View>
          <View style={styles.field}>
            <AppText style={styles.fieldLabel} tone="secondary">
              {t('costAnalysis.calculator.elecRate', 'Electricity Rate ($/kWh)')}
            </AppText>
            <View style={styles.inputRow}>
              <TextInput
                keyboardType="numeric"
                onChangeText={text => onElectricityRateChange(Number(text) || 0)}
                style={styles.input}
                value={String(electricityRate)}
              />
              <AppText style={styles.suffix} tone="muted">
                $/kWh
              </AppText>
            </View>
          </View>
          <AppButton
            label={t('costAnalysis.calculator.reset', 'Reset Defaults')}
            onPress={() => {
              onGasPriceChange(DEFAULT_GAS_PRICE);
              onMpgChange(DEFAULT_MPG);
              onElectricityRateChange(DEFAULT_ELECTRICITY_RATE);
            }}
          />
        </View>

        {/* Side-by-side comparison */}
        <View style={styles.comparisonCol}>
          <AppText style={styles.sectionLabel} tone="muted">
            {t('costAnalysis.calculator.comparison', 'Comparison')}
          </AppText>
          {gasComparison ? (
            <View style={styles.compareGrid}>
              <GlassPanel style={styles.compareCard}>
                <AppText style={styles.cardLabel} tone="muted">
                  {t('costAnalysis.calculator.gasCost', 'Gas Cost (equivalent)')}
                </AppText>
                <AppText
                  style={[styles.cardValue, styles.redColor]}
                  weight="bold">
                  {`$${fmtNumber(gasComparison.gasCost, 2)}`}
                </AppText>
                <AppText style={styles.cardSubLabel} tone="muted">
                  {`$${fmtNumber(
                    gasComparison.costPerMileGas,
                    3,
                  )}/${distanceUnit}`}
                </AppText>
              </GlassPanel>
              <GlassPanel style={styles.compareCard}>
                <AppText style={styles.cardLabel} tone="muted">
                  {t('costAnalysis.calculator.evCost', 'EV Cost (actual)')}
                </AppText>
                <AppText
                  style={[styles.cardValue, styles.cyanColor]}
                  weight="bold">
                  {`$${fmtNumber(gasComparison.actualCost, 2)}`}
                </AppText>
                <AppText style={styles.cardSubLabel} tone="muted">
                  {`$${fmtNumber(
                    gasComparison.costPerMileEV,
                    3,
                  )}/${distanceUnit}`}
                </AppText>
              </GlassPanel>
              <GlassPanel style={[styles.compareCard, styles.compareCardGreen]}>
                <AppText style={styles.cardLabel} tone="muted">
                  {t('costAnalysis.calculator.totalSavings', 'Total Savings')}
                </AppText>
                <AppText
                  style={[styles.cardValue, styles.greenColor]}
                  weight="bold">
                  {`$${fmtNumber(gasComparison.savings, 2)}`}
                </AppText>
                <AppText style={styles.cardSubLabel} tone="muted">
                  {t('costAnalysis.calculator.overPeriod', 'over selected period')}
                </AppText>
              </GlassPanel>
              <GlassPanel style={styles.compareCard}>
                <AppText style={styles.cardLabel} tone="muted">
                  {t('costAnalysis.calculator.monthlySavings', 'Monthly Savings')}
                </AppText>
                <AppText
                  style={[styles.cardValue, styles.green300Color]}
                  weight="bold">
                  {`$${fmtNumber(gasComparison.monthlySavings, 2)}`}
                </AppText>
                <AppText style={styles.cardSubLabel} tone="muted">
                  {`~$${fmtNumber(gasComparison.yearlySavings, 0)}`}{' '}
                  {t('costAnalysis.calculator.perYear', '/ year')}
                </AppText>
              </GlassPanel>
            </View>
          ) : (
            <View style={styles.empty}>
              <AppText style={styles.emptyText} tone="muted">
                {t(
                  'costAnalysis.calculator.noData',
                  'Not enough data for comparison',
                )}
              </AppText>
            </View>
          )}
        </View>
      </View>
    </GlassPanel>
  );
}

SavingsCalculator.displayName = 'SavingsCalculator';

const styles = StyleSheet.create({
  cardLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  cardSubLabel: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  cardValue: {
    fontSize: 20,
    lineHeight: 28,
    marginTop: spacing.xs,
  },
  compareCard: {
    padding: spacing.md,
    width: '48%',
  },
  compareCardGreen: {
    borderColor: GREEN_BORDER,
  },
  compareGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  comparisonCol: {
    gap: spacing.md,
  },
  cyanColor: {
    color: CYAN_400,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 128,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  green300Color: {
    color: GREEN_300,
  },
  greenColor: {
    color: GREEN_400,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  iconGlyph: {
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    padding: 0,
  },
  inputRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputsCol: {
    gap: spacing.md,
  },
  mainGrid: {
    gap: spacing.xl,
  },
  panel: {
    borderColor: GREEN_BORDER,
    padding: spacing.lg,
  },
  redColor: {
    color: RED_400,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.6,
    lineHeight: 16,
    textTransform: 'uppercase',
  },
  suffix: {
    fontSize: 14,
    lineHeight: 20,
    marginLeft: spacing.sm,
  },
  title: {
    fontSize: 14,
    lineHeight: 20,
  },
});
