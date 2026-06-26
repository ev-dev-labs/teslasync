/**
 * Native parity port of
 * web/src/features/analytics/components/weekly-digest/SummaryHeroCards.tsx.
 *
 * The web component is the Weekly Digest "Week Summary" hero panel: a titled
 * GlassPanel containing a responsive grid (1/2/3 columns) of HighlightCards —
 * Total Distance, Total Drives, Energy Used, Charging Cost, CO₂ Saved, and an
 * optional Fun Fact tile. This native port preserves that contract 1:1 using
 * React Native primitives + the existing native AppText / GlassPanel / tokens.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the .parity.json sidecar:
 *   - react-i18next `useTranslation` (web L1): native-safe `t(key, fallback,
 *     vars?)` shim returning the English fallback (else the key) with `{{var}}`
 *     interpolation so the Fun Fact subtitle (≈ {{times}}× {{from}} → {{to}})
 *     keeps its i18n intent — every i18n key + default preserved.
 *   - `useFormatting` (web L2): the web hook derives the currency symbol +
 *     decimal precision from `useSettings()`; only `formatCurrency` is consumed
 *     here, so a scoped native `formatCurrency` is reproduced reading the same
 *     web-parity `useSettings()` query (currency_symbol / decimal_precision),
 *     defaulting to "$" / precision 2 exactly like the web hook.
 *   - lucide-react `Car`/`Activity`/`Zap`/`Fuel`/`Leaf`/`MapPin` (web L3): DOM
 *     SVG icons → semantic emoji glyph stand-ins (the established native
 *     inline-icon approach), rendered secondary-coloured like the web markup.
 *   - `@/components/ui` GlassPanel (web L4): GlassPanel → native GlassPanel.
 *   - `@/components/motion` FadeIn (web L5, framer-motion): local Animated
 *     opacity 0→1 + translateY 12→0 wrapper honouring `delay={0.05}` (50 ms) and
 *     the OS reduce-motion setting — the same contract as the web FadeIn.
 *   - `fmtNumber` / `fmtInt` (web L6): ported from web/src/lib/numberFormat.ts
 *     (safeNumber → 0, en-US locale, min=max fraction digits).
 *   - `./HighlightCard` (web L7): not yet parity-ported → reproduced locally as a
 *     native GlassPanel card (icon+label row, value, trend change row, subtitle)
 *     matching the web markup; the web `glow`/`color` glowMap (cyan/green/purple,
 *     amber+red→none) is rendered as a subtle static border tint of the same hue
 *     (mobile has no hover, where the web glow is otherwise inert).
 *   - `./helpers` `trendFor` + `pctChange` (web L8): ported verbatim.
 *   - `./types` `DigestMetrics` / `FunFact` (web L9): reproduced locally
 *     (verbatim interface ports, incl. the referenced `Drive`) so the prop
 *     contract is byte-for-byte identical.
 */
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';

import {useSettings} from '../../../../api/hooks/useSettings';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

// ── ported types (web ./types Drive / DigestMetrics / FunFact) ───────────────
export interface Drive {
  id: number;
  start_date: string;
  distance: number;
  duration_min: number;
  efficiency_wh_km: number;
  energy_used: number;
}

export interface DigestMetrics {
  totalDistance: number;
  prevDistance: number;
  totalDrives: number;
  prevDriveCount: number;
  energyUsed: number;
  prevEnergy: number;
  chargingCost: number;
  prevChargingCost: number;
  co2Saved: number;
  prevCo2: number;
  avgEfficiency: number;
  prevAvgEfficiency: number;
  totalDuration: number;
  topDrive: Drive | undefined;
  chargeEnergyAdded: number;
  prevChargeEnergy: number;
  avgChargeRate: number;
  chargingSessionCount: number;
  batteryStart: number;
  batteryEnd: number;
  alertsByType: Record<string, number>;
  alertTotal: number;
}

export interface FunFact {
  from: string;
  to: string;
  times: string;
}

interface SummaryHeroCardsProps {
  metrics: DigestMetrics;
  funFact: FunFact | undefined;
}

// ── native-safe useTranslation (react-i18next has no native runtime) ─────────
type NativeTFunction = (
  key: string,
  fallback?: string,
  vars?: Record<string, string | number>,
) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallback, vars) => {
      let out = fallback ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          out = out.split(`{{${name}}}`).join(String(value));
        }
      }
      return out;
    },
    [],
  );
}

// ── number formatters (ported from web/src/lib/numberFormat.ts) ──────────────
function fmtNumber(value: unknown, decimals = 2): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

// ── pctChange + trendFor (ported verbatim from web ./helpers) ────────────────
function pctChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

interface Trend {
  direction: 'up' | 'down' | 'flat';
  value: string;
  positive: boolean;
}

function trendFor(
  current: number,
  previous: number,
  invertPositive = false,
): Trend {
  const diff = current - previous;
  const pct = pctChange(current, previous);
  if (Math.abs(diff) < 0.01) {
    return {direction: 'flat', value: '0%', positive: true};
  }
  const isUp = diff > 0;
  return {
    direction: isUp ? 'up' : 'down',
    value: `${isUp ? '+' : ''}${fmtNumber(pct, 1)}%`,
    positive: invertPositive ? !isUp : isUp,
  };
}

// ── scoped native formatCurrency (web useFormatting → useSettings derivation) ─
function useFormatCurrency(): (amount: number, decimals?: number) => string {
  const {data: settings} = useSettings();
  const symbolRaw = settings?.currency_symbol;
  const currencySymbol = symbolRaw && symbolRaw.trim() ? symbolRaw : '$';
  const precisionRaw = settings?.decimal_precision;
  const userPrecision =
    typeof precisionRaw === 'number' &&
    Number.isFinite(precisionRaw) &&
    precisionRaw >= 0
      ? Math.floor(precisionRaw)
      : 2;

  return useMemo(
    () =>
      (amount: number, decimals?: number): string =>
        `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    [currencySymbol, userPrecision],
  );
}

// ── reduce-motion preference (drives the FadeIn entry animation) ─────────────
function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

// ── FadeIn (native-safe port of the framer-motion entry animation) ───────────
function FadeIn({children, delay = 0}: {children: ReactNode; delay?: number}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 400,
      delay: delay * 1000,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion, delay]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View style={{opacity: progress, transform: [{translateY}]}}>
      {children}
    </Animated.View>
  );
}

// ── HighlightCard (native-safe port of web ./HighlightCard) ──────────────────
type HighlightColor = 'cyan' | 'green' | 'purple' | 'amber' | 'red';

// Web glowMap: cyan/green/purple keep their hue, amber/red collapse to none.
const glowMap: Record<HighlightColor, 'cyan' | 'green' | 'purple' | 'none'> = {
  cyan: 'cyan',
  green: 'green',
  purple: 'purple',
  amber: 'none',
  red: 'none',
};

// Subtle static border tint standing in for the web hover-only glow hue.
const GLOW_BORDER: Record<
  'cyan' | 'green' | 'purple' | 'none',
  string | undefined
> = {
  cyan: colors.borderAccent,
  green: colors.successBorder,
  purple: colors.violetBorder,
  none: undefined,
};

// Trend colours: web text-emerald-400 (#34d399) / text-red-400 (#f87171).
const TREND_UP_COLOR = '#34d399';
const TREND_DOWN_COLOR = '#f87171';
const GLYPH_TREND_UP = '▲';
const GLYPH_TREND_DOWN = '▼';

interface HighlightCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  change?: {value: string; positive: boolean};
  subtitle?: string;
  color?: HighlightColor;
}

function HighlightCard({
  icon,
  label,
  value,
  change,
  subtitle,
  color = 'cyan',
}: HighlightCardProps) {
  const borderColor = GLOW_BORDER[glowMap[color] ?? 'none'];
  const trendColor = change?.positive ? TREND_UP_COLOR : TREND_DOWN_COLOR;
  return (
    <GlassPanel style={[styles.card, borderColor ? {borderColor} : null]}>
      <View style={styles.cardLabelRow}>
        {icon}
        <AppText style={styles.cardLabel} tone="secondary">
          {label}
        </AppText>
      </View>
      <AppText style={styles.cardValue} weight="bold">
        {value}
      </AppText>
      {change ? (
        <View style={styles.changeRow}>
          <AppText style={[styles.changeGlyph, {color: trendColor}]}>
            {change.positive ? GLYPH_TREND_UP : GLYPH_TREND_DOWN}
          </AppText>
          <AppText style={[styles.changeText, {color: trendColor}]}>
            {change.value}
          </AppText>
        </View>
      ) : null}
      {subtitle ? (
        <AppText style={styles.subtitle} tone="muted">
          {subtitle}
        </AppText>
      ) : null}
    </GlassPanel>
  );
}

// lucide-react glyph stand-ins (web L3): Car, Activity, Zap, Fuel, Leaf, MapPin.
const GLYPH_CAR = '🚗';
const GLYPH_ACTIVITY = '📈';
const GLYPH_ZAP = '⚡';
const GLYPH_FUEL = '⛽';
const GLYPH_LEAF = '🍃';
const GLYPH_MAP_PIN = '📍';

export function SummaryHeroCards({metrics, funFact}: SummaryHeroCardsProps) {
  const t = useNativeTranslation();
  const formatCurrency = useFormatCurrency();

  return (
    <FadeIn delay={0.05}>
      <GlassPanel style={styles.panel}>
        <AppText style={styles.heading} weight="bold">
          {t('analytics.weeklyDigest.weekSummary', 'Week Summary')}
        </AppText>
        <View style={styles.grid}>
          <HighlightCard
            icon={<AppText style={styles.cardIcon}>{GLYPH_CAR}</AppText>}
            label={t('analytics.weeklyDigest.totalDistance', 'Total Distance')}
            value={`${fmtNumber(metrics.totalDistance, 1)} km`}
            change={trendFor(metrics.totalDistance, metrics.prevDistance)}
            color="cyan"
          />
          <HighlightCard
            icon={<AppText style={styles.cardIcon}>{GLYPH_ACTIVITY}</AppText>}
            label={t('analytics.weeklyDigest.totalDrives', 'Total Drives')}
            value={fmtInt(metrics.totalDrives)}
            change={trendFor(metrics.totalDrives, metrics.prevDriveCount)}
            color="green"
          />
          <HighlightCard
            icon={<AppText style={styles.cardIcon}>{GLYPH_ZAP}</AppText>}
            label={t('analytics.weeklyDigest.energyUsed', 'Energy Used')}
            value={`${fmtNumber(metrics.energyUsed, 1)} kWh`}
            change={trendFor(metrics.energyUsed, metrics.prevEnergy, true)}
            color="purple"
          />
          <HighlightCard
            icon={<AppText style={styles.cardIcon}>{GLYPH_FUEL}</AppText>}
            label={t('analytics.weeklyDigest.chargingCost', 'Charging Cost')}
            value={formatCurrency(metrics.chargingCost, 2)}
            change={trendFor(
              metrics.chargingCost,
              metrics.prevChargingCost,
              true,
            )}
            color="amber"
          />
          <HighlightCard
            icon={<AppText style={styles.cardIcon}>{GLYPH_LEAF}</AppText>}
            label={t('analytics.weeklyDigest.co2Saved', 'CO₂ Saved')}
            value={`${fmtNumber(metrics.co2Saved, 1)} kg`}
            change={trendFor(metrics.co2Saved, metrics.prevCo2)}
            color="green"
          />
          {funFact && (
            <HighlightCard
              icon={<AppText style={styles.cardIcon}>{GLYPH_MAP_PIN}</AppText>}
              label={t('analytics.weeklyDigest.funFact', 'Fun Fact')}
              value={`${funFact.times}×`}
              subtitle={t(
                'analytics.weeklyDigest.funFactDesc',
                '≈ {{times}}× {{from}} → {{to}}',
                {times: funFact.times, from: funFact.from, to: funFact.to},
              )}
              color="cyan"
            />
          )}
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

SummaryHeroCards.displayName = 'SummaryHeroCards';

const styles = StyleSheet.create({
  panel: {
    gap: spacing.md + 4, // space-y-4 (16px)
    padding: spacing.lg + 4, // p-6 (24px)
  },
  heading: {
    fontSize: 18, // text-lg
  },
  grid: {
    gap: 16, // gap-4 (grid-cols-1 base breakpoint → single-column stack)
  },
  card: {
    gap: spacing.sm, // gap-2 (8px)
    padding: spacing.lg, // p-5 (20px)
  },
  cardLabelRow: {
    alignItems: 'center',
    columnGap: spacing.sm, // gap-2
    flexDirection: 'row',
  },
  cardIcon: {
    color: colors.textSecondary, // web icons inherit text-secondary
    fontSize: 16, // h-5 w-5
  },
  cardLabel: {
    fontSize: 14, // text-sm
  },
  cardValue: {
    fontSize: 24, // text-2xl
  },
  changeRow: {
    alignItems: 'center',
    columnGap: spacing.xs, // gap-1
    flexDirection: 'row',
  },
  changeGlyph: {
    fontSize: 12,
  },
  changeText: {
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
  },
  subtitle: {
    fontSize: 12, // text-xs
  },
});
