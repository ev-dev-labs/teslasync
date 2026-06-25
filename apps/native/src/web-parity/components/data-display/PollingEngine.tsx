// Native parity port of web/src/components/data-display/PollingEngine.tsx.
//
// Renders the "Adaptive Polling Engine" panel: a cost-savings summary card plus
// a per-vehicle activity list driven by the `/polling/status` and
// `/polling/savings` TanStack Query endpoints (refetched at the same 15s / 30s
// cadences as the web source).
//
// The web source pulls several modules with no native parity surface, replaced
// here with React Native primitives while preserving behavior and visual intent:
//   - `lucide-react` icons (Gauge/Zap/BatteryCharging/Moon/TrendingDown/Activity/
//     Clock/ChevronDown) -> short glyph strings rendered via AppText, drawn from
//     the shared SemanticIcon glyph vocabulary (SP/ZP/BC/MO/DN/AC/CK plus the
//     `v` chevron).
//   - `framer-motion` `motion.div` pulse (scale [1,1.2,1] @1.5s on `active`) and
//     the AnimatedNumber RAF tween -> local `Animated` loops/timings that honour
//     `AccessibilityInfo` reduced-motion.
//   - `GlassPanel`/`Button` -> the native GlassPanel primitive and a `Pressable`
//     expand/collapse header (the web ghost Button wraps arbitrary children, so a
//     Pressable preserves the row layout that `AppButton` cannot).
//   - `AnimatedNumber` (from `./AnimatedNumber`, not yet ported) -> inlined here
//     as a native `Animated`-driven counter with the same value/duration/decimals/
//     prefix/suffix API and ease-out-quad 0->value tween.
//   - `fmtNumber` (from `@/lib/numberFormat`) -> inlined verbatim (safeNumber +
//     locale-fallback toLocaleString, default precision 2, default locale en-US).
//   - `activityColor` (from `@/lib/colors`) -> inlined verbatim with the resolved
//     COLOR hex values (active/critical #10b981, moderate #3b82f6, low #f59e0b,
//     idle #6b7280, sleeping #4b5563, default #6b7280).
//   - `react-i18next` `useTranslation` -> a local key+fallback shim matching the
//     established web-parity convention; the source only passes (key, fallback).
//   - `clsx` -> the chevron `rotate-180` toggle is reproduced with an Animated
//     rotation interpolation instead of a class name.
//
// The web file is stored as double-encoded mojibake: `┬╖`, `ΓåÆ`, and `≡ƒôè`
// decode (UTF-8-read-as-CP437) to the intended `·` (middle dot), `→` (arrow), and
// `📊` (bar-chart emoji). The clean intended glyphs are written here so the
// device renders the visual intent rather than the corrupted bytes.

import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../theme/tokens';
import {
  getPollingSavings,
  getPollingStatus,
  type CostSnapshot,
  type PollEngineStatus,
  type VehiclePollingStatus,
} from '../../api/polling';

// ─── Number formatting (inlined from @/lib/numberFormat) ──────

const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

// ─── Segment / status palette ─────────────────────────────────

// Tailwind bg-{blue,amber,purple,gray}-500 used for the savings breakdown bar
// and its legend.
const SEGMENT_COLORS = {
  fleetTelemetry: '#3b82f6',
  idleDetection: '#f59e0b',
  prediction: '#a855f7',
  sleep: '#6b7280',
} as const;

/** Color for vehicle activity level (inlined verbatim from @/lib/colors). */
function activityColor(activity: string): string {
  switch (activity) {
    case 'active':
    case 'critical':
      return '#10b981';
    case 'moderate':
      return '#3b82f6';
    case 'low':
      return '#f59e0b';
    case 'idle':
      return '#6b7280';
    case 'sleeping':
      return '#4b5563';
    default:
      return '#6b7280';
  }
}

/** Glyph for the activity icon (lucide-react icon -> SemanticIcon glyph). */
function activityGlyph(activity: string): string {
  switch (activity) {
    case 'active':
    case 'critical':
      return 'ZP';
    case 'moderate':
      return 'BC';
    case 'low':
      return 'AC';
    case 'idle':
      return 'MO';
    case 'sleeping':
      return 'MO';
    default:
      return 'SP';
  }
}

function profileLabel(profile: string): string {
  switch (profile) {
    case 'driving':
      return 'Driving';
    case 'charging':
      return 'Charging';
    case 'idle':
      return 'Idle';
    case 'sleeping':
      return 'Sleeping';
    default:
      return profile;
  }
}

function formatDuration(ms: number): string {
  if (ms <= 0) {
    return 'now';
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTimeUntil(dateStr: string): string {
  const target = new Date(dateStr).getTime();
  const now = Date.now();
  const diff = target - now;
  if (diff <= 0) {
    return 'now';
  }
  return formatDuration(diff);
}

// ─── i18n + reduced-motion shims ──────────────────────────────

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key: string, fallback: string) => fallback;
}

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

/**
 * Mirrors the framer-motion `animate={{ scale: [1, 1.2, 1] }}` pulse on the
 * `active` activity icon: a looping 1 -> 1.2 -> 1 scale over 1.5s. Idle when the
 * activity is not `active` or the user prefers reduced motion.
 */
function usePulseScale(active: boolean, reduce: boolean): Animated.Value {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active || reduce) {
      scale.stopAnimation();
      scale.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.2,
          duration: 750,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 750,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();

    return () => {
      animation.stop();
    };
  }, [active, reduce, scale]);

  return scale;
}

// ─── AnimatedNumber (inlined native parity of ./AnimatedNumber) ─

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
}

/**
 * Counts up from 0 to `value` over `duration` seconds with an ease-out-quad
 * tween, formatting each frame through `fmtNumber`. Honours reduced motion by
 * jumping straight to the final value.
 */
function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  prefix,
  suffix,
  style,
}: AnimatedNumberProps) {
  const reduce = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (reduce) {
      progress.stopAnimation();
      progress.setValue(value);
      setDisplay(value);
      return;
    }

    progress.setValue(0);
    const listenerId = progress.addListener(({value: current}) => {
      setDisplay(current);
    });
    const animation = Animated.timing(progress, {
      toValue: value,
      duration: duration * 1000,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    });
    animation.start();

    return () => {
      animation.stop();
      progress.removeListener(listenerId);
    };
  }, [duration, progress, reduce, value]);

  return (
    <AppText style={style}>
      {`${prefix ?? ''}${fmtNumber(display, decimals)}${suffix ?? ''}`}
    </AppText>
  );
}

// ─── Per-vehicle activity row ─────────────────────────────────

function VehicleActivity({
  vin,
  status,
}: {
  vin: string;
  status: VehiclePollingStatus;
}) {
  const [expanded, setExpanded] = useState(false);
  const reduce = useReduceMotion();
  const color = activityColor(status.activity);
  const pulse = usePulseScale(status.activity === 'active', reduce);
  const chevron = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) {
      chevron.setValue(expanded ? 1 : 0);
      return;
    }

    const animation = Animated.timing(chevron, {
      toValue: expanded ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();

    return () => {
      animation.stop();
    };
  }, [chevron, expanded, reduce]);

  const rotate = chevron.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const decision = status.last_decision;
  const prediction = decision?.prediction;

  return (
    <View style={styles.vehicleCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{expanded}}
        onPress={() => setExpanded(prev => !prev)}
        style={styles.vehicleHeader}>
        <View style={styles.vehicleHeaderLeft}>
          <Animated.View style={{transform: [{scale: pulse}]}}>
            <AppText style={[styles.activityGlyph, {color}]} weight="bold">
              {activityGlyph(status.activity)}
            </AppText>
          </Animated.View>
          <AppText style={styles.vin}>{vin.slice(-8)}</AppText>
          <View style={[styles.chip, {backgroundColor: `${color}20`}]}>
            <AppText style={[styles.chipText, {color}]} variant="caption">
              {`${status.activity} · ${profileLabel(status.profile)}`}
            </AppText>
          </View>
        </View>
        <View style={styles.vehicleHeaderRight}>
          <View style={styles.nextWrap}>
            <AppText
              style={styles.clockGlyph}
              tone="secondary"
              variant="caption"
              weight="bold">
              CK
            </AppText>
            <AppText style={styles.nextText} tone="secondary" variant="caption">
              {`Next: ${formatTimeUntil(status.next_poll_after)}`}
            </AppText>
          </View>
          <Animated.View style={{transform: [{rotate}]}}>
            <AppText style={styles.chevron} tone="secondary" variant="caption">
              v
            </AppText>
          </Animated.View>
        </View>
      </Pressable>

      {expanded && decision ? (
        <View style={styles.detail}>
          <AppText style={styles.detailText} tone="secondary" variant="caption">
            {`Interval: ${formatDuration(decision.next_interval_ms)}`}
          </AppText>
          <AppText style={styles.detailText} tone="secondary" variant="caption">
            {`Consecutive idle: ${status.consec_idle}`}
          </AppText>
          <AppText style={styles.detailText} tone="secondary" variant="caption">
            {`Battery: ${status.battery_level}%`}
          </AppText>
          {decision.reasons.map((r, i) => (
            <View key={i} style={styles.reasonRow}>
              <AppText style={styles.reasonArrow} variant="caption">
                →
              </AppText>
              <AppText
                style={styles.detailText}
                tone="secondary"
                variant="caption">
                {r}
              </AppText>
            </View>
          ))}
          {prediction ? (
            <View style={styles.prediction}>
              <AppText style={styles.predictionText} variant="caption">
                {`📊 Prediction: ${prediction.next_state} in ${formatDuration(
                  prediction.estimated_in / 1e6,
                )} (${Math.round(prediction.confidence * 100)}% conf)`}
              </AppText>
              <AppText style={styles.predictionText} variant="caption">
                {`Based on: ${prediction.based_on}`}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ─── Savings summary card ─────────────────────────────────────

function LegendItem({color, label}: {color: string; label: string}) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, {backgroundColor: color}]} />
      <AppText style={styles.legendLabel} tone="muted" variant="caption">
        {label}
      </AppText>
    </View>
  );
}

function SavingsCard({savings}: {savings: CostSnapshot}) {
  const t = useNativeTranslationFallback();
  const breakdown = savings.savings_breakdown || {};
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);

  const fleetTelemetry = breakdown.fleet_telemetry || 0;
  const idleDetection = breakdown.idle_detection || 0;
  const prediction = breakdown.prediction || 0;
  const sleep = breakdown.sleep_detection || 0;

  return (
    <View style={styles.savingsGrid}>
      <View style={styles.statCell}>
        <AnimatedNumber
          decimals={1}
          style={styles.statValueEmerald}
          suffix="%"
          value={savings.savings_percent}
        />
        <AppText style={styles.statLabel} tone="secondary" variant="caption">
          {t('polling.pollsSaved', 'Polls Saved')}
        </AppText>
      </View>
      <View style={styles.statCell}>
        <AnimatedNumber
          decimals={2}
          prefix="$"
          style={styles.statValueEmerald}
          value={savings.estimated_savings}
        />
        <AppText style={styles.statLabel} tone="secondary" variant="caption">
          {t('polling.savedAmount', '$ Saved')}
        </AppText>
      </View>
      <View style={styles.statCell}>
        <AnimatedNumber
          decimals={0}
          style={styles.statValuePrimary}
          value={savings.polls_made}
        />
        <AppText style={styles.statLabel} tone="secondary" variant="caption">
          {t('polling.pollsMade', 'Polls Made')}
        </AppText>
      </View>
      <View style={styles.statCell}>
        <AnimatedNumber
          decimals={2}
          prefix="$"
          style={styles.statValuePrimary}
          value={savings.remaining_credit}
        />
        <AppText style={styles.statLabel} tone="secondary" variant="caption">
          {t('polling.creditLeft', 'Credit Left')}
        </AppText>
      </View>

      {total > 0 ? (
        <View style={styles.barTrack}>
          {fleetTelemetry > 0 ? (
            <View
              style={[
                styles.barSegment,
                {
                  backgroundColor: SEGMENT_COLORS.fleetTelemetry,
                  width: `${(fleetTelemetry / total) * 100}%`,
                },
              ]}
            />
          ) : null}
          {idleDetection > 0 ? (
            <View
              style={[
                styles.barSegment,
                {
                  backgroundColor: SEGMENT_COLORS.idleDetection,
                  width: `${(idleDetection / total) * 100}%`,
                },
              ]}
            />
          ) : null}
          {prediction > 0 ? (
            <View
              style={[
                styles.barSegment,
                {
                  backgroundColor: SEGMENT_COLORS.prediction,
                  width: `${(prediction / total) * 100}%`,
                },
              ]}
            />
          ) : null}
          {sleep > 0 ? (
            <View
              style={[
                styles.barSegment,
                {
                  backgroundColor: SEGMENT_COLORS.sleep,
                  width: `${(sleep / total) * 100}%`,
                },
              ]}
            />
          ) : null}
        </View>
      ) : null}

      {total > 0 ? (
        <View style={styles.legend}>
          <LegendItem
            color={SEGMENT_COLORS.fleetTelemetry}
            label={t('polling.fleetTelemetry', 'Fleet Telemetry')}
          />
          <LegendItem
            color={SEGMENT_COLORS.idleDetection}
            label={t('polling.idleDetection', 'Idle Detection')}
          />
          <LegendItem
            color={SEGMENT_COLORS.prediction}
            label={t('polling.prediction', 'Prediction')}
          />
          <LegendItem
            color={SEGMENT_COLORS.sleep}
            label={t('polling.sleep', 'Sleep')}
          />
        </View>
      ) : null}
    </View>
  );
}

// ─── Panel ────────────────────────────────────────────────────

export default function PollingEnginePanel() {
  const {data: status} = useQuery<PollEngineStatus>({
    queryKey: ['polling-status'],
    queryFn: getPollingStatus,
    refetchInterval: 15000,
  });

  const {data: savings} = useQuery<CostSnapshot>({
    queryKey: ['polling-savings'],
    queryFn: getPollingSavings,
    refetchInterval: 30000,
  });

  if (!status?.enabled) {
    return null;
  }

  const vehicles = Object.entries(status.vehicles || {});

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.headerRow}>
        <View style={styles.headerTitleWrap}>
          <AppText style={styles.headerGlyph} weight="bold">
            DN
          </AppText>
          <AppText style={styles.headerTitle} weight="semibold">
            Adaptive Polling Engine
          </AppText>
        </View>
        <View style={styles.activeChip}>
          <AppText style={styles.activeChipText} variant="caption">
            Active
          </AppText>
        </View>
      </View>

      {savings ? <SavingsCard savings={savings} /> : null}

      {vehicles.length > 0 ? (
        <View style={styles.vehiclesSection}>
          <View style={styles.subHeaderRow}>
            <AppText
              style={styles.subHeaderGlyph}
              tone="secondary"
              weight="bold">
              SP
            </AppText>
            <AppText
              style={styles.subHeaderTitle}
              tone="secondary"
              weight="semibold">
              Vehicle Activity
            </AppText>
          </View>
          {vehicles.map(([vin, vs]) => (
            <VehicleActivity key={vin} status={vs} vin={vin} />
          ))}
        </View>
      ) : null}

      {vehicles.length === 0 ? (
        <View style={styles.emptyWrap}>
          <AppText style={styles.emptyText} tone="muted" variant="caption">
            No vehicles tracked yet. Polling engine will activate on first poll.
          </AppText>
        </View>
      ) : null}
    </GlassPanel>
  );
}

PollingEnginePanel.displayName = 'PollingEnginePanel';

const styles = StyleSheet.create({
  activeChip: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  activeChipText: {
    color: '#34d399',
  },
  activityGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  barSegment: {
    borderRadius: 999,
    height: '100%',
  },
  barTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    height: 8,
    overflow: 'hidden',
    width: '100%',
  },
  chevron: {
    fontSize: 12,
    lineHeight: 14,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipText: {
    fontSize: 11,
    lineHeight: 14,
  },
  clockGlyph: {
    fontSize: 10,
    lineHeight: 14,
  },
  detail: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 4,
    marginLeft: spacing.lg,
    paddingTop: spacing.sm,
  },
  detailText: {
    flexShrink: 1,
  },
  emptyText: {
    textAlign: 'center',
  },
  emptyWrap: {
    paddingVertical: spacing.md,
  },
  headerGlyph: {
    color: '#34d399',
    fontSize: 16,
    lineHeight: 20,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 18,
    lineHeight: 24,
  },
  headerTitleWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
    width: '100%',
  },
  legendDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
  nextText: {
    fontSize: 11,
    lineHeight: 14,
  },
  nextWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  panel: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  prediction: {
    gap: 2,
    marginTop: spacing.xs,
  },
  predictionText: {
    color: '#60a5fa',
  },
  reasonArrow: {
    color: colors.textMuted,
  },
  reasonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  savingsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statCell: {
    alignItems: 'center',
    flexBasis: '47%',
    flexGrow: 1,
    gap: 2,
  },
  statLabel: {
    textAlign: 'center',
  },
  statValueEmerald: {
    color: '#34d399',
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  statValuePrimary: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  subHeaderGlyph: {
    fontSize: 12,
    lineHeight: 16,
  },
  subHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  subHeaderTitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  vehicleCard: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  vehicleHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  vehicleHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
  },
  vehicleHeaderRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  vin: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 13,
    lineHeight: 18,
  },
  vehiclesSection: {
    gap: spacing.sm,
  },
});
