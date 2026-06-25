// Native parity port of web/src/components/data-display/ProgressRing.tsx.
// React Native has no SVG circle stroke-dash rendering, so the progress ring is
// approximated with positioned native View segments (the same technique as the
// RadialGauge parity port): a full track of inactive segments with the leading
// arc tinted in the progress color. The centered value/sub-label and the
// optional caption below the ring are preserved with AppText.

import React, {forwardRef, useMemo, type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

export interface ProgressRingProps extends Omit<ViewProps, 'style'> {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  /** Text rendered below the ring (legacy). Prefer `centerLabel` for the
   *  primary value -- it sits inside the ring and reads like a real gauge. */
  label?: string;
  /** Short text rendered inside the ring, perfectly centered. Sized
   *  proportionally to the ring so callers don't need to tune it. */
  centerLabel?: ReactNode;
  /** Optional secondary text rendered just below `centerLabel`, also inside the
   *  ring (e.g. "kWh", "of 100"). Kept smaller than the main label and respects
   *  the muted ring color. */
  centerSubLabel?: ReactNode;
  /** Web Tailwind override; retained for source compatibility, ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  'data-testid'?: string;
}

interface RingSegment {
  angle: string;
  key: string;
  left: number;
  top: number;
  width: number;
}

const DEFAULT_MAX = 100;
const DEFAULT_SIZE = 48;
const DEFAULT_STROKE_WIDTH = 4;
const DEFAULT_COLOR = '#3b82f6';
const SEGMENT_COUNT = 72;
const START_ANGLE_DEGREES = -90;
const FULL_TURN_DEGREES = 360;

export const ProgressRing = forwardRef<View, ProgressRingProps>(
  function ProgressRing(
    {
      value,
      max = DEFAULT_MAX,
      size = DEFAULT_SIZE,
      strokeWidth = DEFAULT_STROKE_WIDTH,
      color = DEFAULT_COLOR,
      label,
      centerLabel,
      centerSubLabel,
      className: _className,
      style,
      testID,
      'data-testid': dataTestID,
      ...rest
    },
    ref,
  ) {
    const radius = (size - strokeWidth) / 2;
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;
    const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
    const clamped = Math.max(0, Math.min(safeNumber(value), max));
    const offset =
      safeMax > 0
        ? circumference - (clamped / safeMax) * circumference
        : circumference;
    const progress = circumference > 0 ? 1 - offset / circumference : 0;
    const hasCenter = centerLabel != null || centerSubLabel != null;
    const mainSize = Math.max(10, Math.round(size * 0.32));
    const subSize = Math.max(8, Math.round(size * 0.18));

    const segments = useMemo(
      () => buildRingSegments(radius, center, circumference, strokeWidth),
      [center, circumference, radius, strokeWidth],
    );
    const activeSegmentCount = Math.round(clamp(progress, 0, 1) * SEGMENT_COUNT);

    return (
      <View {...rest} ref={ref} style={[styles.root, style]} testID={testID ?? dataTestID}>
        <View
          pointerEvents="none"
          style={[styles.ringBox, {height: size, width: size}]}>
          {segments.map((segment, index) => (
            <View
              key={segment.key}
              style={[
                styles.segment,
                {
                  backgroundColor:
                    index < activeSegmentCount ? color : colors.border,
                  borderRadius: strokeWidth / 2,
                  height: strokeWidth,
                  left: segment.left,
                  top: segment.top,
                  transform: [{rotateZ: segment.angle}],
                  width: segment.width,
                },
              ]}
            />
          ))}

          {hasCenter ? (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              style={[styles.center, {height: size, width: size}]}>
              {renderCenter(
                centerLabel,
                [styles.centerLabel, {fontSize: mainSize, lineHeight: mainSize}],
                'primary',
                'semibold',
              )}
              {renderCenter(
                centerSubLabel,
                [styles.centerSubLabel, {fontSize: subSize, lineHeight: subSize}],
                'muted',
                'regular',
              )}
            </View>
          ) : null}
        </View>

        {label ? (
          <AppText
            numberOfLines={1}
            style={styles.label}
            tone="muted"
            variant="caption">
            {label}
          </AppText>
        ) : null}
      </View>
    );
  },
);

ProgressRing.displayName = 'ProgressRing';

function buildRingSegments(
  radius: number,
  center: number,
  circumference: number,
  strokeWidth: number,
): RingSegment[] {
  const segmentWidth = Math.max(2, (circumference / SEGMENT_COUNT) * 0.62);

  return Array.from({length: SEGMENT_COUNT}, (_, index) => {
    const angle =
      START_ANGLE_DEGREES + (index / SEGMENT_COUNT) * FULL_TURN_DEGREES;
    const radians = (angle * Math.PI) / 180;
    const left = center + radius * Math.cos(radians) - segmentWidth / 2;
    const top = center + radius * Math.sin(radians) - strokeWidth / 2;

    return {
      angle: `${angle + 90}deg`,
      key: `${index}-${left.toFixed(3)}-${top.toFixed(3)}`,
      left,
      top,
      width: segmentWidth,
    };
  });
}

function renderCenter(
  node: ReactNode,
  textStyle: StyleProp<TextStyle>,
  tone: 'primary' | 'muted',
  weight: 'regular' | 'semibold',
): ReactNode {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return null;
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return (
      <AppText style={textStyle} tone={tone} weight={weight}>
        {node}
      </AppText>
    );
  }

  return node;
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  centerLabel: {
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  centerSubLabel: {
    letterSpacing: 0.5,
    marginTop: 2,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  label: {
    fontWeight: '500',
    textAlign: 'center',
  },
  ringBox: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  root: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  segment: {
    position: 'absolute',
  },
});
