// Native parity port of web/src/components/data-display/DriveScore.tsx.
// Replaces framer-motion/SVG/Tailwind with React Native primitives while
// preserving the SI scoring heuristic, threshold colors, labels, and layout.

import React, {useCallback, useMemo} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {colors, shadows, spacing, typography} from '../../../theme/tokens';

type DriveLike = {
  distance_m?: number | null;
  distanceM?: number | null;
  duration_s?: number | null;
  durationS?: number | null;
  max_speed_mps?: number | null;
  maxSpeedMps?: number | null;
  start_battery_pct?: number | null;
  startBatteryPct?: number | null;
  end_battery_pct?: number | null;
  endBatteryPct?: number | null;
  [key: string]: unknown;
};

type ScoreBreakdownKey =
  | 'efficiency'
  | 'speed'
  | 'range'
  | 'trip';

type NativeTFunction = (key: string, fallback: string) => string;

export interface DriveScoreProps {
  drive: DriveLike;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

interface GaugeSegment {
  angle: string;
  key: string;
  left: number;
  top: number;
  width: number;
}

interface ScoreBreakdownItem {
  key: ScoreBreakdownKey;
  label: string;
  value: number;
  max: number;
  color: string;
}

const SCORE_COLORS = {
  GOOD: '#10b981',
  WARN: '#f59e0b',
  BAD: '#ef4444',
  CYAN: '#00f0ff',
  PURPLE: '#a855f7',
} as const;

const GAUGE_SIZE = 130;
const GAUGE_STROKE_WIDTH = 10;
const GAUGE_RADIUS = 52;
const GAUGE_CENTER = GAUGE_SIZE / 2;
const GAUGE_SEGMENT_COUNT = 72;
const GAUGE_START_ANGLE_DEGREES = -90;
const FULL_TURN_DEGREES = 360;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function computeDriveScore(drive: DriveLike): {
  total: number;
  efficiency: number;
  speed: number;
  range: number;
  trip: number;
} {
  // Drive fields are SI canonical: meters, seconds, and m/s.
  const distanceM = drive.distance_m ?? drive.distanceM ?? 0;
  const distanceKm = distanceM / 1000;
  const durationS = drive.duration_s ?? drive.durationS ?? 0;
  const durationHours = durationS / 3600;
  const avgSpeedMps = durationS > 0 ? distanceM / durationS : 0;
  const maxSpeedMps = drive.max_speed_mps ?? drive.maxSpeedMps ?? avgSpeedMps;
  const startBattery = drive.start_battery_pct ?? drive.startBatteryPct ?? 100;
  const endBattery = drive.end_battery_pct ?? drive.endBatteryPct ?? startBattery;

  // Efficiency component (40 pts): closer to optimal 150 Wh/km is better
  const batteryUsed = Math.max(startBattery - endBattery, 0);
  // Estimate Wh/km: assume ~75 kWh usable battery, each % = 750 Wh
  const whPerKm = distanceKm > 0 ? (batteryUsed * 750) / distanceKm : 250;
  const optimalWhKm = 150;
  const effDeviation = Math.abs(whPerKm - optimalWhKm) / optimalWhKm;
  const efficiency = clamp(40 * (1 - effDeviation), 0, 40);

  // Speed discipline (20 pts): avg/max ratio - smooth driving scores higher
  const speedRatio = maxSpeedMps > 0 ? avgSpeedMps / maxSpeedMps : 0.5;
  const speed = clamp(20 * speedRatio, 0, 20);

  // Range preservation (20 pts): less battery used per km
  const batteryPerKm = distanceKm > 0 ? batteryUsed / distanceKm : 1;
  // Best case: 0.1%/km, worst case: 1%/km
  const rangeScore = clamp(20 * (1 - (batteryPerKm - 0.1) / 0.9), 0, 20);

  // Trip length (20 pts): longer trips score higher (plateau at 50km)
  const tripScore = clamp(20 * Math.min(distanceKm / 50, 1), 0, 20);

  // Reference durationHours so it's part of the contract; reserved for
  // future heuristics (e.g. dwell penalty for slow city driving).
  void durationHours;

  const total = Math.round(
    clamp(efficiency + speed + rangeScore + tripScore, 0, 100),
  );

  return {
    total,
    efficiency: Math.round(efficiency),
    speed: Math.round(speed),
    range: Math.round(rangeScore),
    trip: Math.round(tripScore),
  };
}

export function getScoreColor(score: number): string {
  if (score < 40) {
    return SCORE_COLORS.BAD;
  }
  if (score < 70) {
    return SCORE_COLORS.WARN;
  }
  return SCORE_COLORS.GOOD;
}

export function DriveScore({
  drive,
  style,
  testID,
  'data-testid': dataTestID,
}: DriveScoreProps) {
  const t = useNativeTranslationFallback();
  const score = useMemo(() => computeDriveScore(drive), [drive]);
  const color = getScoreColor(score.total);
  const circumference = 2 * Math.PI * GAUGE_RADIUS;
  const dashOffset = circumference - (score.total / 100) * circumference;
  const progress = circumference > 0 ? 1 - dashOffset / circumference : 0;
  const gaugeSegments = useMemo(() => buildGaugeSegments(), []);
  const activeSegmentCount = Math.round(
    clamp(progress, 0, 1) * GAUGE_SEGMENT_COUNT,
  );

  const breakdown: ScoreBreakdownItem[] = [
    {
      key: 'efficiency',
      label: t('driveScore.efficiency', 'Efficiency'),
      value: score.efficiency,
      max: 40,
      color: SCORE_COLORS.CYAN,
    },
    {
      key: 'speed',
      label: t('driveScore.speedDiscipline', 'Speed Discipline'),
      value: score.speed,
      max: 20,
      color: SCORE_COLORS.PURPLE,
    },
    {
      key: 'range',
      label: t('driveScore.rangePreservation', 'Range Preservation'),
      value: score.range,
      max: 20,
      color: SCORE_COLORS.GOOD,
    },
    {
      key: 'trip',
      label: t('driveScore.tripLength', 'Trip Length'),
      value: score.trip,
      max: 20,
      color: SCORE_COLORS.WARN,
    },
  ];

  return (
    <GlassPanel
      accessible
      accessibilityLabel={`${t(
        'driveScore.title',
        'Drive Score',
      )}: ${score.total}. ${breakdown
        .map(item => `${item.label} ${item.value}/${item.max}`)
        .join(', ')}`}
      accessibilityRole="summary"
      style={[styles.panel, style]}
      testID={testID ?? dataTestID ?? 'drive-score'}>
      <View style={styles.contentRow}>
        <View
          pointerEvents="none"
          style={[styles.gauge, {height: GAUGE_SIZE, width: GAUGE_SIZE}]}>
          {gaugeSegments.map((segment, index) => (
            <View
              key={segment.key}
              style={[
                styles.gaugeSegment,
                {
                  backgroundColor:
                    index < activeSegmentCount ? color : colors.border,
                  left: segment.left,
                  shadowColor: color,
                  top: segment.top,
                  transform: [{rotateZ: segment.angle}],
                  width: segment.width,
                },
              ]}
            />
          ))}

          <View
            style={[
              styles.scoreOverlay,
              {height: GAUGE_SIZE, width: GAUGE_SIZE},
            ]}>
            <AppText
              style={[styles.scoreValue, {color}]}
              variant="display"
              weight="bold">
              {score.total}
            </AppText>
            <AppText
              style={styles.scoreLabel}
              tone="muted"
              variant="caption"
              weight="semibold">
              {t('driveScore.score', 'Score')}
            </AppText>
          </View>
        </View>

        <View style={styles.breakdown}>
          <AppText
            style={styles.title}
            variant="body"
            weight="semibold">
            {t('driveScore.title', 'Drive Score')}
          </AppText>
          {breakdown.map(item => (
            <ScoreBreakdownBar key={item.key} item={item} />
          ))}
        </View>
      </View>
    </GlassPanel>
  );
}

DriveScore.displayName = 'DriveScore';

function ScoreBreakdownBar({item}: {item: ScoreBreakdownItem}) {
  const percent = clamp((item.value / item.max) * 100, 0, 100);

  return (
    <View
      accessible
      accessibilityLabel={`${item.label}: ${item.value}/${item.max}`}
      accessibilityRole="progressbar"
      accessibilityValue={{min: 0, max: item.max, now: item.value}}
      style={styles.breakdownItem}
      testID={`drive-score-${item.key}`}>
      <View style={styles.breakdownHeader}>
        <AppText
          numberOfLines={1}
          style={styles.breakdownLabel}
          tone="secondary"
          variant="caption">
          {item.label}
        </AppText>
        <AppText
          numberOfLines={1}
          style={[styles.breakdownValue, {color: item.color}]}
          variant="caption"
          weight="semibold">
          {item.value}/{item.max}
        </AppText>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              backgroundColor: item.color,
              shadowColor: item.color,
              width: `${percent}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

function buildGaugeSegments(): GaugeSegment[] {
  const circumference = 2 * Math.PI * GAUGE_RADIUS;
  const segmentWidth = Math.max(
    2,
    (circumference / GAUGE_SEGMENT_COUNT) * 0.62,
  );

  return Array.from({length: GAUGE_SEGMENT_COUNT}, (_, index) => {
    const angle =
      GAUGE_START_ANGLE_DEGREES +
      (index / GAUGE_SEGMENT_COUNT) * FULL_TURN_DEGREES;
    const radians = (angle * Math.PI) / 180;
    const left =
      GAUGE_CENTER + GAUGE_RADIUS * Math.cos(radians) - segmentWidth / 2;
    const top =
      GAUGE_CENTER +
      GAUGE_RADIUS * Math.sin(radians) -
      GAUGE_STROKE_WIDTH / 2;

    return {
      angle: `${angle + 90}deg`,
      key: `drive-score-${index}-${left}-${top}`,
      left,
      top,
      width: segmentWidth,
    };
  });
}

const styles = StyleSheet.create({
  breakdown: {
    flex: 1,
    gap: spacing.sm,
    minWidth: 180,
  },
  breakdownHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  breakdownItem: {
    gap: 2,
  },
  breakdownLabel: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    marginRight: spacing.sm,
  },
  breakdownValue: {
    fontSize: 11,
    lineHeight: 16,
  },
  contentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  fill: {
    borderRadius: 999,
    height: '100%',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: {width: 0, height: 0},
  },
  gauge: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
    position: 'relative',
  },
  gaugeSegment: {
    borderRadius: GAUGE_STROKE_WIDTH / 2,
    height: GAUGE_STROKE_WIDTH,
    position: 'absolute',
    shadowOpacity: 0.36,
    shadowRadius: 6,
    shadowOffset: {width: 0, height: 0},
  },
  panel: {
    padding: spacing.lg,
    ...shadows.panel,
  },
  scoreLabel: {
    fontSize: 10,
    letterSpacing: 1,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  scoreOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  scoreValue: {
    fontSize: 32,
    lineHeight: 38,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.body,
    lineHeight: 20,
    marginBottom: spacing.xs,
  },
  track: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 6,
    overflow: 'hidden',
  },
});
