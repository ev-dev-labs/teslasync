/**
 * Native parity port of
 * web/src/features/analytics/components/weekly-digest/ChargingSection.tsx.
 *
 * The web component is the Weekly Digest "Charging" panel: a titled GlassPanel
 * containing (1) a Recharts daily-energy-added BarChart, (2) a 1/2/4-column grid
 * of four MiniStat tiles (sessions, total energy added, avg charge rate, total
 * cost), and (3) a week-over-week energy Badge. This native port preserves that
 * contract 1:1 using React Native primitives + the existing native AppText /
 * GlassPanel / ChartDataTable / design tokens.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the .parity.json sidecar:
 *   - react-i18next `useTranslation` (web L1): native-safe `t(key, fallback)`
 *     shim returning the English fallback (else the key) — every i18n key kept.
 *   - `useFormatting` (web L2): the web hook derives the currency symbol +
 *     decimal precision from `useSettings()`; only `formatCurrency` is consumed
 *     here, so a scoped native `formatCurrency` is reproduced reading the same
 *     web-parity `useSettings()` query (currency_symbol / decimal_precision),
 *     defaulting to "$" / precision 2 exactly like the web hook.
 *   - lucide-react `Zap` / `Activity` / `Fuel` (web L3): DOM SVG icons → semantic
 *     emoji glyph stand-ins (the established native inline-icon approach).
 *   - `@/components/ui` GlassPanel + Badge (web L4): GlassPanel → native
 *     GlassPanel; Badge → a local native-safe Badge (success/warning variants,
 *     size sm — the only ones used) translating the Tailwind dark-theme chip.
 *   - `@/components/motion` FadeIn (web L5, framer-motion): local Animated
 *     opacity 0→1 + translateY 12→0 wrapper honouring `delay={0.15}` (150 ms) and
 *     the OS reduce-motion setting — the same contract as the web FadeIn.
 *   - Recharts BarChart/Bar/XAxis/YAxis/Tooltip/ResponsiveContainer + chart
 *     helpers (web L6-10): Recharts needs browser DOM/SVG (no react-native-svg
 *     dependency), so the vertical bar chart becomes a native-safe horizontal
 *     proportional bar list (the established MiniBarChart analog), coloured by
 *     the identical `CHART_COLORS[1]`, each bar's value formatted to 1 decimal
 *     (the web YAxis tickFormatter intent), plus an accessible ChartDataTable
 *     carrying the exact per-day values.
 *   - `fmtNumber` / `fmtInt` (web L11): ported from web/src/lib/numberFormat.ts
 *     (safeNumber → 0, en-US locale, min=max fraction digits).
 *   - `./MiniStat` (web L12): not yet parity-ported → reproduced locally as a
 *     native GlassPanel row (icon + label + value) matching the web markup.
 *   - `./helpers` `pctChange` (web L13): ported verbatim.
 *   - `./types` `DigestMetrics` / `DailyEnergyEntry` (web L14): reproduced locally
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
import {CHART_COLORS} from '../../../../components/charts';
import {ChartDataTable} from '../../../../../components/charts/ChartDataTable';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

// ── ported types (web ./types Drive / DigestMetrics / DailyEnergyEntry) ──────
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

export interface DailyEnergyEntry {
  day: string;
  energy: number;
}

interface ChargingSectionProps {
  metrics: DigestMetrics;
  dailyEnergyData: DailyEnergyEntry[];
}

// ── native-safe useTranslation (react-i18next has no native runtime) ─────────
type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
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

// ── pctChange (ported verbatim from web ./helpers) ───────────────────────────
function pctChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
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

// ── Badge (native-safe port of web @/components/ui Badge: success / warning) ─
type BadgeVariant = 'success' | 'warning';

const BADGE_STYLES: Record<BadgeVariant, {bg: string; text: string}> = {
  // Tailwind dark-theme: success → bg-green-900 / text-green-200.
  success: {bg: '#14532d', text: '#bbf7d0'},
  // warning → bg-yellow-900 / text-yellow-200.
  warning: {bg: '#713f12', text: '#fef08a'},
};

function Badge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: ReactNode;
}) {
  const v = BADGE_STYLES[variant];
  return (
    <View style={[styles.badge, {backgroundColor: v.bg}]}>
      <AppText style={[styles.badgeText, {color: v.text}]}>{children}</AppText>
    </View>
  );
}

// ── MiniStat (native-safe port of web ./MiniStat) ────────────────────────────
function MiniStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <GlassPanel style={styles.miniStat}>
      {icon ? <View style={styles.miniStatIcon}>{icon}</View> : null}
      <View style={styles.miniStatBody}>
        <AppText tone="secondary" variant="caption">
          {label}
        </AppText>
        <AppText style={styles.miniStatValue} weight="semibold">
          {value}
        </AppText>
      </View>
    </GlassPanel>
  );
}

// Energy bars share the web `fill={CHART_COLORS[1]}` hue (#E69F00 orange).
const ENERGY_BAR_COLOR = CHART_COLORS[1];
// Web `text-neon-green` zap glyph in the section title.
const NEON_GREEN = '#10b981';
// lucide-react glyph stand-ins (web L3): Zap, Activity, Fuel.
const GLYPH_ZAP = '⚡';
const GLYPH_ACTIVITY = '📈';
const GLYPH_FUEL = '⛽';

export function ChargingSection({
  metrics,
  dailyEnergyData,
}: ChargingSectionProps) {
  const t = useNativeTranslation();
  const formatCurrency = useFormatCurrency();

  // Sanitise once so the bars, value labels, and a11y table all agree.
  const energyData = (dailyEnergyData ?? []).map(d => ({
    day: d.day,
    energy: Number.isFinite(d.energy) ? d.energy : 0,
  }));
  const maxEnergy = Math.max(...energyData.map(d => d.energy), 1);
  const energyTableRows = energyData.map(d => ({
    id: d.day,
    label: d.day,
    value: fmtNumber(d.energy, 1),
  }));

  const dailyEnergyTitle = t(
    'analytics.weeklyDigest.dailyEnergyAdded',
    'Daily Energy Added (kWh)',
  );

  return (
    <FadeIn delay={0.15}>
      <GlassPanel style={styles.section}>
        <View style={styles.titleRow}>
          <AppText style={styles.titleGlyph}>{GLYPH_ZAP}</AppText>
          <AppText style={styles.sectionTitle} weight="bold">
            {t('analytics.weeklyDigest.chargingSection', 'Charging')}
          </AppText>
        </View>

        {/* Daily Energy Added bar chart */}
        <GlassPanel style={styles.chartPanel}>
          <AppText style={styles.chartTitle} tone="secondary">
            {dailyEnergyTitle}
          </AppText>
          {energyData.length === 0 ? (
            <AppText tone="muted">
              {t('analytics.weeklyDigest.noEnergyData', 'No charging data')}
            </AppText>
          ) : (
            <>
              <View
                accessible
                accessibilityRole="summary"
                accessibilityLabel={`${dailyEnergyTitle}: ${energyData
                  .map(d => `${d.day} ${fmtNumber(d.energy, 1)}`)
                  .join(', ')}`}
                style={styles.bars}>
                {energyData.map(item => (
                  <View key={item.day} style={styles.barRow}>
                    <AppText style={styles.barLabel} variant="caption">
                      {item.day}
                    </AppText>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            backgroundColor: ENERGY_BAR_COLOR,
                            width: `${Math.max(
                              maxEnergy > 0 ? (item.energy / maxEnergy) * 100 : 0,
                              item.energy > 0 ? 4 : 0,
                            )}%`,
                          },
                        ]}
                      />
                    </View>
                    <AppText style={styles.barValue} variant="caption">
                      {fmtNumber(item.energy, 1)}
                    </AppText>
                  </View>
                ))}
              </View>
              <ChartDataTable label={dailyEnergyTitle} rows={energyTableRows} />
            </>
          )}
        </GlassPanel>

        {/* Charging stats */}
        <View style={styles.statsCol}>
          <MiniStat
            icon={<AppText style={styles.miniStatGlyph}>{GLYPH_ZAP}</AppText>}
            label={t('analytics.weeklyDigest.sessions', 'Sessions')}
            value={fmtInt(metrics.chargingSessionCount)}
          />
          <MiniStat
            icon={<AppText style={styles.miniStatGlyph}>{GLYPH_ZAP}</AppText>}
            label={t(
              'analytics.weeklyDigest.totalEnergyAdded',
              'Total Energy Added',
            )}
            value={`${fmtNumber(metrics.chargeEnergyAdded, 1)} kWh`}
          />
          <MiniStat
            icon={
              <AppText style={styles.miniStatGlyph}>{GLYPH_ACTIVITY}</AppText>
            }
            label={t('analytics.weeklyDigest.avgChargeRate', 'Avg Charge Rate')}
            value={`${fmtNumber(metrics.avgChargeRate, 1)} kW`}
          />
          <MiniStat
            icon={<AppText style={styles.miniStatGlyph}>{GLYPH_FUEL}</AppText>}
            label={t('analytics.weeklyDigest.totalCost', 'Total Cost')}
            value={formatCurrency(metrics.chargingCost, 2)}
          />
        </View>

        {/* Charge energy week-over-week */}
        <GlassPanel style={styles.wowPanel}>
          <AppText style={styles.wowLabel} tone="secondary" variant="caption">
            {t('analytics.weeklyDigest.energyVsLastWeek', 'Energy vs. Last Week')}
          </AppText>
          <Badge
            variant={
              metrics.chargeEnergyAdded >= metrics.prevChargeEnergy
                ? 'success'
                : 'warning'
            }>
            {metrics.prevChargeEnergy > 0
              ? `${fmtNumber(
                  pctChange(metrics.chargeEnergyAdded, metrics.prevChargeEnergy),
                  1,
                )}%`
              : '—'}
          </Badge>
        </GlassPanel>
      </GlassPanel>
    </FadeIn>
  );
}

ChargingSection.displayName = 'ChargingSection';

const styles = StyleSheet.create({
  section: {
    gap: spacing.lg + 4, // space-y-6 (24px)
    padding: spacing.lg + 4, // p-6 (24px)
  },
  titleRow: {
    alignItems: 'center',
    columnGap: spacing.sm, // gap-2
    flexDirection: 'row',
  },
  titleGlyph: {
    color: NEON_GREEN,
    fontSize: 18,
  },
  sectionTitle: {
    fontSize: 18, // text-lg
  },
  chartPanel: {
    gap: spacing.md,
    padding: spacing.md, // p-4-ish
  },
  chartTitle: {
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
  },
  bars: {
    gap: spacing.sm,
  },
  barRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  barLabel: {
    width: 56,
  },
  barTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flex: 1,
    height: 10,
    overflow: 'hidden',
  },
  barFill: {
    borderRadius: 999,
    height: '100%',
  },
  barValue: {
    textAlign: 'right',
    width: 48,
  },
  statsCol: {
    gap: spacing.md, // gap-3
  },
  miniStat: {
    alignItems: 'center',
    columnGap: spacing.md, // gap-3
    flexDirection: 'row',
    paddingHorizontal: 16, // px-4
    paddingVertical: spacing.md, // py-3
  },
  miniStatIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniStatGlyph: {
    color: colors.textMuted,
    fontSize: 16,
  },
  miniStatBody: {
    flexShrink: 1,
  },
  miniStatValue: {
    fontSize: 14, // text-sm
  },
  wowPanel: {
    alignItems: 'center',
    columnGap: 16, // gap-4
    flexDirection: 'row',
    paddingHorizontal: 16, // px-4
    paddingVertical: spacing.md, // py-3
  },
  wowLabel: {
    flexShrink: 1,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 6, // px-1.5
    paddingVertical: 2, // py-0.5
  },
  badgeText: {
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
  },
});
