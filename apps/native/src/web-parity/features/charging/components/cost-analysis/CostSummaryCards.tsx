import {Glyph} from '../../../../../components/icons/Glyph';
// Native parity port of
// web/src/features/charging/components/cost-analysis/CostSummaryCards.tsx.
//
// `CostSummaryCards` is the charging Cost-Analysis hero strip: a StaggerContainer
// wrapping a responsive grid (grid-cols-2 lg:grid-cols-3 xl:grid-cols-6) of six
// animated `StatBox` cards — Total Cost (+ "<n> sessions" sub), Avg $/kWh (+
// "blended rate"), Cost Per Mile/km (+ "per <distanceUnit>"), Total Energy (kWh,
// + "<n> gal equiv"), Gas Savings $ (+ "vs <gasPrice>/<gal|L>") and Savings %
// (+ "vs gasoline"). The six cards, their icons/tints, the `glow` accents
// (cyan / green), every i18n key + English fallback (including the
// `{{unit}}` Mile/km interpolation on the Cost-Per card), the formatter
// precisions (currency 2/3/2, fmtWithUnit 1 dp, savingsPercent 1 dp), the
// nullish `?? 0` coalescing on every coreStats field, the literal "per "/"vs "
// prefixes (untranslated in the source — kept verbatim) and the
// `settings.gas_unit === 'liter' ? 'L' : 'gal'` label are all preserved.
//
// Web modules -> native-safe mappings (contract rules 4-7):
//   - react-i18next `useTranslation` (L1) -> a local key-preserving fallback shim
//     returning the inline English copy. It supports BOTH source call forms:
//     `t(key, fallback)` and `t(key, {defaultValue, ...interp})` — the latter
//     reproduces react-i18next's `{{unit}}` interpolation the Cost-Per-Distance
//     label depends on, so the i18n intent survives without react-i18next.
//   - lucide-react `DollarSign`/`Zap`/`TrendingDown`/`Car`/`Fuel` (L2-4, SVG, no
//     native analog) -> decorative emoji glyphs rendered in `AppText` and hidden
//     from assistive tech (the adjacent StatBox label carries the meaning), the
//     WeekOverWeekSummary / OptimizerSection `<Glyph/>` precedent. The raw
//     Tailwind-400 icon tints have no SI token, so they are preserved as literal
//     Tailwind hexes (the SleepEfficiencyPage "rose-300/emerald-300 -> Tailwind
//     hex" precedent): cyan-400 #22d3ee, yellow-400 #facc15, blue-400 #60a5fa,
//     green-400 #4ade80, red-400 #f87171, emerald-400 #34d399.
//   - `StaggerContainer`/`StaggerItem` from @/components/motion (L5) -> the ported
//     `web-parity/components/motion` StaggerContainer/StaggerItem. The web relies
//     on framer `staggerChildren: 0.06s` propagating through the intervening grid
//     <div> to every StaggerItem; native StaggerContainer only injects `delay`
//     into its DIRECT child (here the grid wrapper), so each StaggerItem instead
//     receives an EXPLICIT `index * 0.06s` delay (the same STAGGER_SECONDS the
//     native StaggerContainer uses) to reproduce the staggered opacity/translateY
//     entrance verbatim. StaggerContainer is kept for structural parity.
//   - `useFormatting` `formatCurrency` from @/hooks/useFormatting (L6) -> inlined
//     native-safe equivalent. The web hook resolves currency symbol + precision
//     from useSettings; with no ported native settings provider this uses the web
//     default symbol "$" and honours the call site's explicit precision.
//   - `useSettings` from @/hooks/useSettings (L7) -> a local shim returning the
//     web default `gas_unit: 'gallon'` (so gasUnitLabel resolves to "gal", the
//     same default the web settings store ships). Documented in the sidecar.
//   - `fmtNumber`/`fmtInt`/`fmtWithUnit` from @/lib/numberFormat (L8) -> inlined
//     native-safe equivalents (+ their `safeNumber` dep): nullish/non-finite ->
//     0, en-US locale, default precision 2, fmtInt = precision 0, fmtWithUnit =
//     "<n> <unit>".
//   - `StatBox` from ./StatBox (L9) -> reproduced as a local native `StatBox`
//     mirroring the web markup (GlassPanel: an icon box + a label/value/optional
//     sub stack). The web `glow` accent (a coloured glow shadow) maps to a
//     coloured GlassPanel border tint (cyan -> borderAccent, green ->
//     successBorder, purple -> violetBorder); the web `hover` flourish has no
//     native analog and is dropped. The sibling cost-analysis StatBox.tsx is not
//     yet ported as a standalone native module, so it is inlined here.
//   - `CoreStats` type from ./types (L10) -> inlined verbatim (the cost-analysis
//     types.ts is not yet ported as a standalone native module).
//
// DOM -> native element mapping: `<StaggerContainer>` -> native StaggerContainer;
// the `<div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">` ->
// a flex-wrap row (styles.grid, gap 16 = gap-4) holding two-up `Cell`s
// (flexBasis 47% / flexGrow 1) since native has no CSS grid breakpoints — the
// grid-cols-2 mobile base is the faithful representation; each `<StaggerItem>` ->
// the native StaggerItem (inside its Cell); StatBox's `<div className="flex
// items-start gap-3">` -> a row View (align flex-start, gap 12); the icon
// `<div className="rounded-lg bg-[var(--surface-2)] p-2">` -> styles.iconBox
// (radius 8, colors.surfaceRaised, padding 8); `<p className="truncate text-xs">`
// -> AppText muted numberOfLines 1; `<p className="mt-0.5 text-lg font-semibold
// text-white">` -> AppText (marginTop 2, 18/'600', primary tone); `<p
// className="mt-0.5 text-xs text-[var(--text-muted)]">` -> AppText muted
// (marginTop 2, text-xs). No DOM-only modules, browser HTML elements, Recharts,
// Leaflet, or old web UI components are imported.

import React, {type ReactNode} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {StaggerContainer, StaggerItem} from '../../../../components/motion';

// ─── i18n fallback shim ───────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, so intent survives.
// It supports both source call forms: t(key, fallback) and
// t(key, {defaultValue, ...interp}) — the latter reproduces react-i18next's
// `{{unit}}` interpolation used by the Cost-Per-Distance label.
type TPrimitive = string | number;
type TOptions = {defaultValue?: string} & Record<string, TPrimitive>;
type TFunc = (key: string, fallbackOrOptions: string | TOptions, options?: TOptions) => string;

function useTranslation(): {t: TFunc} {
  return {
    t: (_key, fallbackOrOptions, options) => {
      const template =
        typeof fallbackOrOptions === 'string'
          ? fallbackOrOptions
          : (fallbackOrOptions.defaultValue ?? '');
      const interp = typeof fallbackOrOptions === 'string' ? options : fallbackOrOptions;
      if (interp) {
        return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
          const value = (interp as Record<string, TPrimitive>)[name];
          return value != null ? String(value) : '';
        });
      }
      return template;
    },
  };
}

// ─── Inlined `@/lib/numberFormat` (safeNumber / fmtNumber / fmtInt / fmtWithUnit) ──
// Locale-aware formatting matching the web helpers: nullish/non-finite input
// coerces to 0, default precision is 2, fmtInt is precision 0, fmtWithUnit is
// "<n> <unit>", and a bad locale falls back to en-US.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toFixed(decimals);
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

function fmtWithUnit(v: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(v, decimals)} ${unit}`;
}

// ─── Inlined `@/hooks/useFormatting` (formatCurrency) ─────────
// The web hook resolves the currency symbol + default precision from useSettings;
// with no ported native settings provider, this uses the web default symbol "$"
// and honours the call site's explicit precision.
const CURRENCY_SYMBOL = '$';

function useFormatting(): {formatCurrency: (amount: number, decimals?: number) => string} {
  return {
    formatCurrency: (amount: number, decimals = 2): string =>
      `${CURRENCY_SYMBOL}${fmtNumber(amount, decimals)}`,
  };
}

// ─── Inlined `@/hooks/useSettings` (gas_unit) ─────────────────
// No ported native settings provider; this returns the web default
// `gas_unit: 'gallon'` so the gasUnitLabel resolves to "gal" exactly as the
// shipped web settings store does.
type GasUnit = 'gallon' | 'liter';

function useSettings(): {settings: {gas_unit: GasUnit}} {
  return {settings: {gas_unit: 'gallon'}};
}

// ─── Inlined `./types` (CoreStats) ────────────────────────────
// The cost-analysis types.ts is not yet ported as a standalone native module, so
// the consumed type is inlined verbatim.
export interface CoreStats {
  totalCost: number;
  totalEnergy: number;
  avgCostPerKwh: number;
  totalDuration: number;
  totalDistanceM: number;
  costPerDist: number;
  gasCost: number;
  savings: number;
  savingsPercent: number;
  co2SavedKg: number;
  treeEquiv: number;
  gallonsEquiv: number;
  count: number;
}

// ─── Stagger timing ───────────────────────────────────────────
// Matches the native StaggerContainer's own STAGGER_SECONDS (and the web framer
// `staggerChildren: 0.06`). Supplied explicitly per item because the native
// StaggerContainer cannot propagate the cascade through the grid/cell wrappers.
const STAGGER_SECONDS = 0.06;

// ─── Decorative glyph (lucide icon → native-safe text glyph) ──
// The adjacent StatBox label carries the meaning, so each glyph is hidden from
// the accessibility tree. The h-5 w-5 (20px) lucide icons map to an 18px emoji.
interface GlyphProps {
  char: string;
  color: string;
}

function GlyphLegacyUnused({char, color}: GlyphProps): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, {color}]}>
      {char}
    </AppText>
  );
}

// ─── StatBox (local port of ./StatBox) ────────────────────────
// GlassPanel card: an icon box beside a label / value / optional sub stack. The
// web `glow` accent maps to a coloured border tint; the web `hover` flourish has
// no native analog and is dropped.
interface StatBoxProps {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  glow?: 'cyan' | 'green' | 'purple';
}

function StatBox({icon, label, value, sub, glow}: StatBoxProps): React.ReactElement {
  const glowStyle: StyleProp<ViewStyle> = glow ? glowBorders[glow] : null;
  return (
    <GlassPanel style={[styles.statBox, glowStyle]}>
      <View style={styles.statRow}>
        <View style={styles.iconBox}>{icon}</View>
        <View style={styles.statBody}>
          <AppText numberOfLines={1} style={styles.statLabel} tone="muted">
            {label}
          </AppText>
          <AppText style={styles.statValue}>{value}</AppText>
          {sub ? (
            <AppText style={styles.statSub} tone="muted">
              {sub}
            </AppText>
          ) : null}
        </View>
      </View>
    </GlassPanel>
  );
}

// ─── Cell (native grid/stagger wrapper) ───────────────────────
// Carries the two-up flex sizing the un-styleable StaggerItem cannot, and feeds
// the explicit stagger delay into the StaggerItem entrance.
function Cell({delay, children}: {delay: number; children: ReactNode}): React.ReactElement {
  return (
    <View style={styles.cell}>
      <StaggerItem delay={delay}>{children}</StaggerItem>
    </View>
  );
}

interface CostSummaryCardsProps {
  coreStats: CoreStats | null;
  gasPrice: number;
  distanceUnit: string;
  isMiles: boolean;
}

export function CostSummaryCards({
  coreStats,
  gasPrice,
  distanceUnit,
  isMiles,
}: CostSummaryCardsProps) {
  const {t} = useTranslation();
  const {formatCurrency} = useFormatting();
  const {settings} = useSettings();
  const gasUnitLabel = settings.gas_unit === 'liter' ? 'L' : 'gal';

  return (
    <StaggerContainer>
      <View style={styles.grid}>
        <Cell delay={0 * STAGGER_SECONDS}>
          <StatBox
            icon={<Glyph char="💲" color="#22d3ee" />}
            label={t('costAnalysis.stats.totalCost', 'Total Cost')}
            value={formatCurrency(coreStats?.totalCost ?? 0, 2)}
            sub={`${fmtInt(coreStats?.count ?? 0)} ${t('costAnalysis.stats.sessions', 'sessions')}`}
            glow="cyan"
          />
        </Cell>
        <Cell delay={1 * STAGGER_SECONDS}>
          <StatBox
            icon={<Glyph char="⚡" color="#facc15" />}
            label={t('costAnalysis.stats.avgPerKwh', 'Avg $/kWh')}
            value={formatCurrency(coreStats?.avgCostPerKwh ?? 0, 3)}
            sub={t('costAnalysis.stats.blendedRate', 'blended rate')}
          />
        </Cell>
        <Cell delay={2 * STAGGER_SECONDS}>
          <StatBox
            icon={<Glyph char="🚗" color="#60a5fa" />}
            label={t('costAnalysis.stats.costPerDist', {
              unit: isMiles ? 'Mile' : 'km',
              defaultValue: 'Cost Per {{unit}}',
            })}
            value={formatCurrency(coreStats?.costPerDist ?? 0, 3)}
            sub={`per ${distanceUnit}`}
          />
        </Cell>
        <Cell delay={3 * STAGGER_SECONDS}>
          <StatBox
            icon={<Glyph char="⚡" color="#4ade80" />}
            label={t('costAnalysis.stats.totalEnergy', 'Total Energy')}
            value={fmtWithUnit(coreStats?.totalEnergy ?? 0, 'kWh', 1)}
            sub={fmtWithUnit(coreStats?.gallonsEquiv ?? 0, 'gal equiv', 1)}
            glow="green"
          />
        </Cell>
        <Cell delay={4 * STAGGER_SECONDS}>
          <StatBox
            icon={<Glyph char="⛽" color="#f87171" />}
            label={t('costAnalysis.stats.gasSavings', 'Gas Savings $')}
            value={formatCurrency(coreStats?.savings ?? 0, 2)}
            sub={`vs ${formatCurrency(gasPrice, 2)}/${gasUnitLabel}`}
            glow="green"
          />
        </Cell>
        <Cell delay={5 * STAGGER_SECONDS}>
          <StatBox
            icon={<Glyph char="📉" color="#34d399" />}
            label={t('costAnalysis.stats.savingsPercent', 'Savings %')}
            value={`${fmtNumber(coreStats?.savingsPercent ?? 0, 1)}%`}
            sub={t('costAnalysis.stats.vsGasoline', 'vs gasoline')}
            glow="green"
          />
        </Cell>
      </View>
    </StaggerContainer>
  );
}

CostSummaryCards.displayName = 'CostSummaryCards';

export default CostSummaryCards;

const glowBorders = StyleSheet.create<Record<'cyan' | 'green' | 'purple', ViewStyle>>({
  cyan: {
    borderColor: colors.borderAccent, // glow="cyan"
  },
  green: {
    borderColor: colors.successBorder, // glow="green"
  },
  purple: {
    borderColor: colors.violetBorder, // glow="purple"
  },
});

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16, // gap-4 (grid-cols-2 mobile base — two-up flex-wrap)
  },
  cell: {
    flexBasis: '47%', // grid-cols-2 two-up
    flexGrow: 1,
  },
  statBox: {
    padding: 16, // p-4
  },
  statRow: {
    alignItems: 'flex-start', // items-start
    flexDirection: 'row', // flex
    gap: 12, // gap-3
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised, // bg-[var(--surface-2)]
    borderRadius: 8, // rounded-lg
    justifyContent: 'center',
    padding: 8, // p-2
  },
  glyph: {
    fontSize: 18, // h-5 w-5 (20px) lucide icon -> 18px emoji
    lineHeight: 22,
  },
  statBody: {
    flex: 1, // flex-1
    flexShrink: 1,
    minWidth: 0, // min-w-0 (lets the label truncate instead of overflowing)
  },
  statLabel: {
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  statValue: {
    fontSize: 18, // text-lg
    fontWeight: '600', // font-semibold
    lineHeight: 28,
    marginTop: 2, // mt-0.5
  },
  statSub: {
    fontSize: 12, // text-xs
    lineHeight: 16,
    marginTop: 2, // mt-0.5
  },
});
