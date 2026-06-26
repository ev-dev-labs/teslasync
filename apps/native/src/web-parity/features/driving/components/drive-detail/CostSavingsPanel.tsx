// Native parity port of
// web/src/features/driving/components/drive-detail/CostSavingsPanel.tsx.
//
// `CostSavingsPanel` is the "Cost & Savings" panel of the single-drive deep dive
// (DriveDetailPage). It renders a responsive metric grid inside a GlassPanel:
//   - "Trip Cost" — the energy cost of the drive (formatEnergyCost(energyWh/1000))
//     in the green tint, with an "at {symbol}{rate}/kWh" sub-caption.
//   - "Cost / {unit}" — cost per the user's distance unit (only when distanceM>0),
//     cyan tint, formatCurrency(costPerDistanceUnit(...) ?? 0, 3).
//   - When the estimated gas cost exceeds the EV cost (savings > 0), three more
//     cells: "Gas Cost (equiv)" (red, formatCurrency(gasCost) + "at {mpg} MPG"),
//     "vs Gas Savings" (green, formatCurrency(savings)) and "Savings %" (green,
//     fmtNumber(savings/gasCost*100, 0) + "%").
// Every prop name (`drive`, `stats`), the derived values (`gasCost`, `evCost`,
// `savings`), the `energyWh / 1000` kWh conversion, the `costPerKwh` multiply,
// the `drive.distanceM > 0` and `savings != null && savings > 0` guards, every
// i18n key + English fallback (incl. the `{{currencySymbol}}{{costPerKwh}}`,
// `{{unit}}`, `{{mpg}}` interpolations), the formatter precisions (currency 3 on
// cost-per-unit, fmtNumber 0 on the percentage) and the colour tints are
// preserved verbatim. This is the standalone extraction of the already-vetted
// inlined CostSavingsPanel in the DriveDetailPage native port, so the two stay
// pixel-identical (the page is expected to later slim to import this sibling).
//
// Web module -> native-safe mappings (contract rules 4-7):
//   - react-i18next `useTranslation` (L1) -> a local key-preserving shim
//     supporting both source call shapes — `t(key,'English')` and
//     `t(key,{defaultValue,...params})` with `{{token}}` interpolation — so the
//     three interpolated captions (atRate/costPerUnit/atMpg) resolve without
//     react-i18next (absent from the native deps); i18next's "return the key when
//     no default" behaviour is preserved.
//   - lucide-react `DollarSign` (L2, SVG, no native analog) -> a decorative "💲"
//     glyph rendered in `AppText` and hidden from assistive tech (the adjacent
//     "Cost & Savings" heading text carries the meaning). The web `text-green-400`
//     icon tint maps to the literal hex #10b981 used by the DriveDetailPage port.
//   - `@/components/ui` GlassPanel (L3) -> the shared native components/ui
//     GlassPanel; the web `p-5` padding moves to the forwarded `style`.
//   - `@/components/motion` FadeIn (L4) -> the ported web-parity components/motion
//     FadeIn (no delay, matching the source).
//   - `@/hooks/useSettings` (L5) -> the reused web-parity api/hooks/useSettings
//     query (returns `{ data: settings }`); only `gas_efficiency_mpg` is read
//     directly here (for the "at {{mpg}} MPG" caption).
//   - `@/hooks/useFormatting` (L6) -> a local shim reproducing the cost/currency
//     surface this panel reads (costPerKwh, currencySymbol, formatEnergyCost,
//     formatCurrency, costPerDistanceUnit, estimateGasCost) over the same
//     settings query, faithful to the web hook (base_cost_per_kwh default 0.12,
//     currency_symbol default '$', decimal_precision default 2, the SI-meter
//     costPerDistanceUnit, and the mpg + gas_price_per_unit estimateGasCost with
//     the gallon->liter bridge). The web calls useFormatting() twice (L20 + L23);
//     the memoised result is identical, so this consolidates to one destructure.
//   - `@/hooks/useUnits` (L7) -> a local shim deriving `unitPrefs.distance`
//     ('mi'/'km') from `unit_of_length`, mirroring the web derivation (only the
//     distance pref is read here).
//   - `@/lib/numberFormat` fmtNumber (L8) -> an inlined native-safe equivalent
//     (+ its safeNumber dep): nullish/non-finite -> 0, en-US locale, default
//     precision 2, per-call precision honoured.
//   - `@/types/driving` DriveDetail (L9) -> imported from the native
//     api/hooks/useDriving port (matches the web shape field-for-field; only
//     `distanceM` is read).
//   - `./types` DriveStats (L10) -> inlined verbatim (the drive-detail types.ts
//     is not a standalone native port yet; only `energyWh` is read). Mirrors the
//     DriveDetailPage local DriveStats.
//   - `@/lib/unitConversion` convertDistanceFromSI + GALLONS_TO_LITERS -> inlined
//     native-safe SI converters (meters/1000 for km, meters/1609.344 for mi) used
//     by the useFormatting shim. Narrowed to the 'km'/'mi' prefs this file emits.
//
// DOM -> native element mapping: the `<h3>` heading -> a PanelHeading row (Glyph +
// AppText); every `<div>` -> a `View`; every `<p>` -> an `AppText`. Tailwind maps
// to StyleSheet/token styles (p-5 -> spacing.lg, mb-4 -> the panel gap, gap-4 ->
// spacing.md, text-[10px] -> 10, text-[9px] -> 11, text-lg -> 17);
// `var(--text-primary)`/`var(--text-muted)` -> AppText primary/muted tones; the
// green/cyan/red value tints -> literal hexes (#10b981/#22d3ee/#ef4444) matching
// the DriveDetailPage port. The responsive `grid-cols-2 sm:grid-cols-3
// lg:grid-cols-5` becomes a flex-wrap metric grid (30% basis, min 120) since
// native has no CSS grid breakpoints. No DOM-only modules, browser HTML elements,
// Recharts, Leaflet, or old web UI components are imported.

import React, { useCallback, useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';

import { AppText } from '../../../../../components/ui/AppText';
import { GlassPanel } from '../../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../../theme/tokens';
import { FadeIn } from '../../../../components/motion';
import { useSettings } from '../../../../api/hooks/useSettings';
import type { DriveDetail } from '../../../../api/hooks/useDriving';

// ─── i18n shim (react-i18next) ────────────────────────────────
// i18next returns the KEY when no translation exists; this resolves the inline
// English fallback while keeping the key at every call site. Supports the two
// source call shapes: t(key,'English') and t(key,{defaultValue,...params}) with
// {{token}} interpolation (the atRate/costPerUnit/atMpg captions rely on it).
type TPrimitive = string | number;
type TParams = Record<string, TPrimitive | undefined>;
interface TOptions {
  defaultValue?: string;
  [key: string]: TPrimitive | undefined;
}

function interpolate(template: string, params?: TParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) => {
    const value = params[token];
    return value == null ? match : String(value);
  });
}

function translate(key: string, fallback?: string | TOptions, params?: TParams): string {
  if (fallback == null) {
    return key;
  }
  if (typeof fallback === 'string') {
    return params ? interpolate(fallback, params) : fallback;
  }
  const { defaultValue, ...rest } = fallback;
  return interpolate(defaultValue ?? key, rest);
}

function useTranslation(): { t: typeof translate } {
  return { t: translate };
}

// ─── numberFormat (inlined from @/lib/numberFormat) ───────────
// safeNumber collapses nullish/non-finite to 0; fmtNumber is the locale-aware
// fixed-precision formatter (default precision 2, en-US).
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number): string {
  const d = decimals ?? DEFAULT_PRECISION;
  try {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toFixed(d);
  }
}

// ─── unitConversion SI converters (inlined from @/lib/unitConversion) ──
// Only the distance converter + the gallon->liter constant are read here. The
// pref union is narrowed to the 'km'/'mi' values the useUnits shim emits (and the
// literal 'mi' estimateGasCost passes), so the 'ft' branch is omitted.
type DistanceUnitPref = 'km' | 'mi';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const GALLONS_TO_LITERS = 3.78541;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

// ─── useUnits shim (@/hooks/useUnits) ─────────────────────────
// Derives the distance pref from `unit_of_length`, mirroring the web hook. Only
// `unitPrefs.distance` is read by this panel.
function useUnits(): { unitPrefs: { distance: DistanceUnitPref } } {
  const { data: settings } = useSettings();
  const distance: DistanceUnitPref = settings?.unit_of_length === 'mi' ? 'mi' : 'km';
  return useMemo(() => ({ unitPrefs: { distance } }), [distance]);
}

// ─── useFormatting shim (@/hooks/useFormatting) ───────────────
// Reproduces the cost/currency surface this panel reads: costPerKwh
// (base_cost_per_kwh, default 0.12), currencySymbol (default '$'),
// formatEnergyCost, formatCurrency, costPerDistanceUnit (SI meters), and
// estimateGasCost (mpg + gas_price_per_unit, with the gallon->liter bridge).
interface UseFormattingResult {
  costPerKwh: number;
  currencySymbol: string;
  formatEnergyCost: (kwh: number) => string;
  formatCurrency: (amount: number, decimals?: number) => string;
  costPerDistanceUnit: (kwh: number, distanceM: number) => number | null;
  estimateGasCost: (distanceM: number) => number | null;
}

function useFormatting(): UseFormattingResult {
  const { data: settings } = useSettings();
  const { unitPrefs } = useUnits();

  const costPerKwh = settings?.base_cost_per_kwh ?? 0.12;
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;
  const distancePref = unitPrefs.distance;
  const gasMpg = settings?.gas_efficiency_mpg ?? 0;
  const gasPrice = settings?.gas_price_per_unit ?? 0;
  const gasUnit = settings?.gas_unit ?? 'gallon';

  const formatEnergyCost = useCallback(
    (kwh: number): string => `${currencySymbol}${fmtNumber(kwh * costPerKwh, userPrecision)}`,
    [costPerKwh, currencySymbol, userPrecision],
  );

  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    [currencySymbol, userPrecision],
  );

  const costPerDistanceUnit = useCallback(
    (kwh: number, distanceM: number): number | null => {
      if (distanceM <= 0) {
        return null;
      }
      const cost = kwh * costPerKwh;
      const distance = convertDistanceFromSI(distanceM, distancePref);
      return distance > 0 ? cost / distance : null;
    },
    [costPerKwh, distancePref],
  );

  const estimateGasCost = useCallback(
    (distanceM: number): number | null => {
      if (gasMpg <= 0 || gasPrice <= 0 || distanceM <= 0) {
        return null;
      }
      const distanceMi = convertDistanceFromSI(distanceM, 'mi');
      const gallonsUsed = distanceMi / gasMpg;
      if (gasUnit === 'liter') {
        return gallonsUsed * GALLONS_TO_LITERS * gasPrice;
      }
      return gallonsUsed * gasPrice;
    },
    [gasMpg, gasPrice, gasUnit],
  );

  return useMemo(
    () => ({
      costPerKwh,
      currencySymbol,
      formatEnergyCost,
      formatCurrency,
      costPerDistanceUnit,
      estimateGasCost,
    }),
    [
      costPerKwh,
      currencySymbol,
      formatEnergyCost,
      formatCurrency,
      costPerDistanceUnit,
      estimateGasCost,
    ],
  );
}

// ─── DriveStats (inlined from ./types) ────────────────────────
// The drive-detail types.ts is not a standalone native port yet; the consumed
// shape is inlined verbatim (only `energyWh` is read by this panel). Mirrors the
// DriveDetailPage local DriveStats.
interface DriveStats {
  maxSpd: number;
  avgSpd: number;
  minSpd: number;
  powerMax: number;
  powerMin: number;
  avgPower: number;
  energyWh: number;
  regenWh: number;
  consumptionWhKm: number;
  elevGain: number;
  elevLoss: number;
  avgOutsideTemp: number | null;
  avgInsideTemp: number | null;
  hasAnyTemp: boolean;
  insideTemps: number[];
  outsideTemps: number[];
  driverTemps: number[];
  passengerTemps: number[];
  climateStatus: string | null;
  avgFanSpeed: number | null;
  maxFanSpeed: number | null;
  startRange: number | null;
  endRange: number | null;
  odometerStart: number;
  odometerEnd: number;
  hasTirePressure: boolean;
  efficiencyPctPer100: number | null;
}

// ─── Glyph (lucide DollarSign substitute) ─────────────────────
// Decorative; the "Cost & Savings" heading text carries the meaning, so the
// glyph is hidden from assistive tech.
function Glyph({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  return (
    <AppText
      accessibilityElementsHidden
      allowFontScaling={false}
      importantForAccessibility="no"
      style={style}
    >
      {children}
    </AppText>
  );
}

// ─── PanelHeading (web <h3> flex heading) ─────────────────────
function PanelHeading({ icon, color, text }: { icon: string; color: string; text: string }) {
  return (
    <View style={styles.panelHeadingRow}>
      <Glyph style={[styles.panelHeadingIcon, { color }]}>{icon}</Glyph>
      <AppText style={styles.panelHeading} weight="semibold">
        {text}
      </AppText>
    </View>
  );
}

// ─── Metric (label + value cell) ──────────────────────────────
function Metric({
  label,
  color,
  children,
}: {
  label: string;
  color?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.metricCell}>
      <AppText numberOfLines={2} style={styles.metricLabel} tone="muted" variant="caption">
        {label}
      </AppText>
      <AppText style={[styles.metricValue, color ? { color } : null]} weight="bold">
        {children}
      </AppText>
    </View>
  );
}

interface CostSavingsPanelProps {
  drive: DriveDetail;
  stats: DriveStats;
}

export function CostSavingsPanel({ drive, stats }: CostSavingsPanelProps) {
  const { t } = useTranslation();
  const { data: settings } = useSettings();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const {
    costPerKwh,
    currencySymbol,
    formatEnergyCost,
    formatCurrency,
    costPerDistanceUnit,
    estimateGasCost,
  } = useFormatting();

  const gasCost = estimateGasCost(drive.distanceM);
  const evCost = (stats.energyWh / 1000) * costPerKwh;
  const savings = gasCost != null ? gasCost - evCost : null;

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <PanelHeading icon="💲" color="#10b981" text={t('driveDetail.costSavings', 'Cost & Savings')} />
        <View style={styles.metricGrid}>
          <View style={styles.metricCell}>
            <AppText numberOfLines={2} style={styles.metricLabel} tone="muted" variant="caption">
              {t('driveDetail.tripCost', 'Trip Cost')}
            </AppText>
            <AppText style={[styles.metricValue, { color: '#10b981' }]} weight="bold">
              {formatEnergyCost(stats.energyWh / 1000)}
            </AppText>
            <AppText style={styles.metricSub} tone="muted" variant="caption">
              {t('driveDetail.atRate', {
                currencySymbol,
                costPerKwh,
                defaultValue: 'at {{currencySymbol}}{{costPerKwh}}/kWh',
              })}
            </AppText>
          </View>
          {drive.distanceM > 0 ? (
            <Metric
              label={t('driveDetail.costPerUnit', {
                unit: distanceUnit,
                defaultValue: 'Cost / {{unit}}',
              })}
              color="#22d3ee"
            >
              {formatCurrency(costPerDistanceUnit(stats.energyWh / 1000, drive.distanceM) ?? 0, 3)}
            </Metric>
          ) : null}
          {savings != null && savings > 0 ? (
            <>
              <View style={styles.metricCell}>
                <AppText numberOfLines={2} style={styles.metricLabel} tone="muted" variant="caption">
                  {t('driveDetail.gasCostEquiv', 'Gas Cost (equiv)')}
                </AppText>
                <AppText style={[styles.metricValue, { color: '#ef4444' }]} weight="bold">
                  {formatCurrency(gasCost!)}
                </AppText>
                <AppText style={styles.metricSub} tone="muted" variant="caption">
                  {t('driveDetail.atMpg', {
                    mpg: settings?.gas_efficiency_mpg,
                    defaultValue: 'at {{mpg}} MPG',
                  })}
                </AppText>
              </View>
              <Metric label={t('driveDetail.gasSavings', 'vs Gas Savings')} color="#10b981">
                {formatCurrency(savings)}
              </Metric>
              <Metric label={t('driveDetail.savingsPct', 'Savings %')} color="#10b981">
                {`${fmtNumber((savings / gasCost!) * 100, 0)}%`}
              </Metric>
            </>
          ) : null}
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  metricCell: {
    alignItems: 'center',
    flexBasis: '30%',
    flexGrow: 1,
    gap: 2,
    minWidth: 120,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricLabel: {
    fontSize: 10,
    textAlign: 'center',
  },
  metricSub: {
    fontSize: 11,
    textAlign: 'center',
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 17,
    textAlign: 'center',
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  panelHeading: {
    color: colors.textPrimary,
    fontSize: 15,
  },
  panelHeadingIcon: {
    fontSize: 14,
  },
  panelHeadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
});
