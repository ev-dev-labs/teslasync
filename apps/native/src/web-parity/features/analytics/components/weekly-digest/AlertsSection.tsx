// Native parity port of
// web/src/features/analytics/components/weekly-digest/AlertsSection.tsx.
//
// AlertsSection renders the weekly-digest "Alerts" panel: a header (amber
// AlertTriangle + "Alerts" title + a warning Badge with the total when > 0),
// then either an empty state ("No alerts this week …") when alertTotal === 0,
// or a two-part body — an "Alerts by Severity" breakdown (one GlassPanel row per
// severity with a severity-coloured icon, capitalised label and a variant Badge
// count) and an "Alert Distribution" donut.
//
// The web stack has no native equivalents wired into this parity tree, so
// (conversion-contract rules 4-7):
//   - framer-motion FadeIn (delay 0.25) -> the local FadeIn (Animated.View)
//     reproducing the web initial {opacity:0, y:12} -> animate {opacity:1, y:0}
//     easeOut entrance with a 250ms delay / 400ms duration (the
//     useMotionPreference(400) default), collapsing to the final state under
//     reduced motion (AccessibilityInfo, the native prefers-reduced-motion).
//   - react-i18next useTranslation -> a native-safe (key, fallback) shim; every
//     i18n key + English fallback is copied verbatim.
//   - lucide-react AlertTriangle / AlertCircle / Info -> SemanticIcon
//     warning/alertCircle/info glyphs rendered inline in their explicit web
//     colours (neon-amber / STATUS_COLORS.critical / STATUS_COLORS.warning /
//     CHART_COLORS[0]).
//   - GlassPanel/Badge/EmptyState web UI -> the native GlassPanel, a local
//     web-faithful Badge (dark-mode variant palette + sm/md/lg sizing) and an
//     inline icon+message empty state (the native shared EmptyState has no icon
//     slot, so the AlertTriangle is preserved inline).
//   - the Recharts donut (PieChart/Pie/Cell/Tooltip/Legend/ResponsiveContainer,
//     innerRadius 55/outerRadius 90/paddingAngle 3, height 260) -> a native-safe
//     distribution list (per-slice colour swatch + name + value + share-of-total
//     %), because React Native has no SVG Recharts backend and no hover tooltip.
//   - fmtInt (@/lib/numberFormat) + STATUS_COLORS (@/lib/colors) are ported
//     inline; safe + CHART_COLORS come from the native chartUtils parity.
//   - DigestMetrics / AlertPieEntry / Drive (./types) are ported inline so the
//     prop contract is identical without importing an unconverted sibling.
// See the .parity.json sidecar for the line-by-line source map.

import React, {
  useCallback,
  useEffect,
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
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {CHART_COLORS, safe} from '../../../../components/charts/chartUtils';

// ---- Ported types (web ./types.ts) ------------------------------------------
// Reproduced verbatim so the `metrics`/`alertPieData` prop contract is identical
// to the web component. The `_min`/`_wh_km` suffixes mirror the existing web
// type and are not new fields.

interface Drive {
  id: number;
  start_date: string;
  distance: number;
  duration_min: number;
  efficiency_wh_km: number;
  energy_used: number;
}

interface DigestMetrics {
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

interface AlertPieEntry {
  name: string;
  value: number;
  color: string;
}

interface AlertsSectionProps {
  metrics: DigestMetrics;
  alertPieData: AlertPieEntry[];
}

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

// ---- Ported number formatting (web @/lib/numberFormat fmtInt) ----------------
// en-US locale + the chartUtils `safe` guard, matching the web no-settings
// defaults.

const DEFAULT_LOCALE = 'en-US';

function fmtNumber(value: unknown, decimals = 2): string {
  try {
    return safe(value).toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safe(value).toFixed(decimals);
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

// ---- Ported colours (web @/lib/colors STATUS_COLORS + neon-amber) -----------

const STATUS_COLORS = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
} as const;

// web header AlertTriangle `text-neon-amber`.
const NEON_AMBER = '#f59e0b';

// ---- Icon glyphs (web lucide AlertTriangle / AlertCircle / Info) ------------

const ALERT_TRIANGLE_GLYPH = getSemanticIconDefinition('warning').glyph;
const ALERT_CIRCLE_GLYPH = getSemanticIconDefinition('alertCircle').glyph;
const INFO_GLYPH = getSemanticIconDefinition('info').glyph;

function GlyphIcon({
  glyph,
  color,
  size,
}: {
  glyph: string;
  color: string;
  size: number;
}): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.glyph,
        {color, fontSize: Math.round(size * 0.6), width: size, lineHeight: size},
      ]}>
      {glyph}
    </AppText>
  );
}

// ---- Native Badge (web @/components/ui/Badge) -------------------------------
// The web chip uses Tailwind light/dark pairs; the native app is dark-themed so
// the dark-mode palette (bg-*-900 / text-*-200, bg-gray-700 / text-gray-200) is
// reproduced. `font-medium` -> fontWeight 500; `rounded-full` -> radius 999.

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
type BadgeSize = 'sm' | 'md' | 'lg';

function Badge({
  variant = 'neutral',
  size = 'md',
  children,
}: {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children: ReactNode;
}): React.ReactElement {
  return (
    <View
      style={[styles.badge, badgeSizeStyles[size], badgeVariantStyles[variant]]}>
      <AppText
        style={[
          styles.badgeText,
          badgeTextSizeStyles[size],
          badgeTextColorStyles[variant],
        ]}>
        {children}
      </AppText>
    </View>
  );
}

// ---- Reduced-motion-aware FadeIn (web framer-motion FadeIn) ------------------

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

// web FadeIn delay prop (0.25s) + useMotionPreference(400) duration + initial
// {opacity:0, y:12}. Reduced motion collapses to the final state (the web no-op).
const FADE_IN_DELAY_MS = 250;
const FADE_IN_DURATION_MS = 400;
const FADE_IN_TRANSLATE_Y = 12;

function FadeIn({
  children,
  reduceMotion,
}: {
  children: ReactNode;
  reduceMotion: boolean;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      delay: FADE_IN_DELAY_MS,
      duration: FADE_IN_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [FADE_IN_TRANSLATE_Y, 0],
            }),
          },
        ],
      }}>
      {children}
    </Animated.View>
  );
}

// ---- Component --------------------------------------------------------------

function severityBadgeVariant(severity: string): BadgeVariant {
  if (severity === 'critical') {
    return 'danger';
  }
  if (severity === 'warning') {
    return 'warning';
  }
  return 'info';
}

export function AlertsSection({
  metrics,
  alertPieData,
}: AlertsSectionProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const reduceMotion = useReduceMotion();

  const distributionTotal = alertPieData.reduce(
    (sum, entry) => sum + safe(entry.value),
    0,
  );

  return (
    <FadeIn reduceMotion={reduceMotion}>
      <GlassPanel style={styles.panel}>
        <View style={styles.header}>
          <GlyphIcon glyph={ALERT_TRIANGLE_GLYPH} color={NEON_AMBER} size={20} />
          <AppText weight="bold" style={styles.headerTitle}>
            {t('analytics.weeklyDigest.alertsSection', 'Alerts')}
          </AppText>
          {metrics.alertTotal > 0 ? (
            <Badge variant="warning" size="sm">
              {fmtInt(metrics.alertTotal)}
            </Badge>
          ) : null}
        </View>

        {metrics.alertTotal === 0 ? (
          // no-action: transient empty state — surfaces when source data is
          // missing; no specific recovery action available.
          <View style={styles.emptyState}>
            <GlyphIcon
              glyph={ALERT_TRIANGLE_GLYPH}
              color={colors.textMuted}
              size={32}
            />
            <AppText tone="muted" style={styles.emptyMessage}>
              {t(
                'analytics.weeklyDigest.noAlerts',
                'No alerts this week — everything looks great!',
              )}
            </AppText>
          </View>
        ) : (
          <View style={styles.body}>
            {/* Alert count by severity */}
            <View style={styles.section}>
              <AppText tone="secondary" style={styles.sectionLabel}>
                {t(
                  'analytics.weeklyDigest.alertsBySeverity',
                  'Alerts by Severity',
                )}
              </AppText>
              <View style={styles.severityList}>
                {Object.entries(metrics.alertsByType).map(
                  ([severity, count]) => (
                    <GlassPanel key={severity} style={styles.severityRow}>
                      <View style={styles.severityLeft}>
                        {severity === 'critical' ? (
                          <GlyphIcon
                            glyph={ALERT_CIRCLE_GLYPH}
                            color={STATUS_COLORS.critical}
                            size={16}
                          />
                        ) : null}
                        {severity === 'warning' ? (
                          <GlyphIcon
                            glyph={ALERT_TRIANGLE_GLYPH}
                            color={STATUS_COLORS.warning}
                            size={16}
                          />
                        ) : null}
                        {severity === 'info' ? (
                          <GlyphIcon
                            glyph={INFO_GLYPH}
                            color={CHART_COLORS[0]}
                            size={16}
                          />
                        ) : null}
                        <AppText style={styles.severityLabel}>
                          {severity}
                        </AppText>
                      </View>
                      <Badge variant={severityBadgeVariant(severity)} size="sm">
                        {fmtInt(count)}
                      </Badge>
                    </GlassPanel>
                  ),
                )}
              </View>
            </View>

            {/* Alert distribution (Recharts donut -> native distribution list) */}
            <View style={styles.section}>
              <AppText tone="secondary" style={styles.sectionLabel}>
                {t(
                  'analytics.weeklyDigest.alertDistribution',
                  'Alert Distribution',
                )}
              </AppText>
              <View style={styles.distribution}>
                {alertPieData.map(entry => {
                  const pct =
                    distributionTotal > 0
                      ? (safe(entry.value) / distributionTotal) * 100
                      : 0;
                  return (
                    <View key={entry.name} style={styles.distRow}>
                      <View
                        style={[styles.swatch, {backgroundColor: entry.color}]}
                      />
                      <AppText numberOfLines={1} style={styles.distName}>
                        {entry.name}
                      </AppText>
                      <AppText style={styles.distValue}>
                        {fmtInt(entry.value)} ({fmtInt(pct)}%)
                      </AppText>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        )}
      </GlassPanel>
    </FadeIn>
  );
}

AlertsSection.displayName = 'AlertsSection';

const styles = StyleSheet.create({
  // web GlassPanel `space-y-6 p-6`.
  panel: {
    padding: 24,
    gap: 24,
  },
  // web header `flex items-center gap-2 text-lg font-bold text-white`.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  // web lucide glyphs rendered as centred bold text.
  glyph: {
    textAlign: 'center',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // web EmptyState `py-8` with an h-8 w-8 icon + message.
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 32,
  },
  emptyMessage: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  // web body `grid grid-cols-1 gap-6 lg:grid-cols-2` -> single-column stack.
  body: {
    gap: 24,
  },
  // web column `space-y-3`.
  section: {
    gap: 12,
  },
  // web label `text-sm font-medium text-[var(--text-secondary)]`.
  sectionLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  // web severity grid `grid gap-3`.
  severityList: {
    gap: 12,
  },
  // web row `flex items-center justify-between px-4 py-3`.
  severityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  // web inner `flex items-center gap-2`.
  severityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // web `text-sm capitalize text-[var(--text-primary)]`.
  severityLabel: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  // native-safe replacement for the donut: a legend-style distribution list.
  distribution: {
    gap: 8,
  },
  distRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // web Recharts Legend iconType `circle`.
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  distName: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  distValue: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  // web Badge `inline-flex items-center gap-1 rounded-full font-medium`.
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
  },
  badgeText: {
    fontWeight: '500',
  },
});

// web Badge dark-mode backgrounds (bg-*-900 / bg-gray-700).
const badgeVariantStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  info: {backgroundColor: '#1e3a8a'},
  success: {backgroundColor: '#14532d'},
  warning: {backgroundColor: '#713f12'},
  danger: {backgroundColor: '#7f1d1d'},
  neutral: {backgroundColor: '#374151'},
});

// web Badge dark-mode text (text-*-200 / text-gray-200).
const badgeTextColorStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  info: {color: '#bfdbfe'},
  success: {color: '#bbf7d0'},
  warning: {color: '#fef08a'},
  danger: {color: '#fecaca'},
  neutral: {color: '#e5e7eb'},
});

// web Badge sizes (sm: px-1.5 py-0.5 text-xs, md: px-2 py-0.5 text-xs,
// lg: px-2.5 py-1 text-sm).
const badgeSizeStyles = StyleSheet.create<Record<BadgeSize, ViewStyle>>({
  sm: {paddingHorizontal: 6, paddingVertical: 2},
  md: {paddingHorizontal: 8, paddingVertical: 2},
  lg: {paddingHorizontal: 10, paddingVertical: 4},
});

const badgeTextSizeStyles = StyleSheet.create<Record<BadgeSize, TextStyle>>({
  sm: {fontSize: 12, lineHeight: 16},
  md: {fontSize: 12, lineHeight: 16},
  lg: {fontSize: 14, lineHeight: 18},
});
