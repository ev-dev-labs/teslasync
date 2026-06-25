// Native parity port of web/src/components/charts/RadialGauge.tsx.
// React Native has no built-in SVG circle stroke-dash rendering, so the
// gauge arc is approximated with positioned native View segments.

import React, {forwardRef, useMemo} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

interface RadialGaugeProps extends Omit<ViewProps, 'style'> {
  value: number;
  max: number;
  label: string;
  unit?: string;
  color?: string;
  size?: number;
  decimals?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  'data-testid'?: string;
}

interface GaugeSegment {
  angle: string;
  key: string;
  left: number;
  top: number;
  width: number;
}

const STROKE_WIDTH = 8;
const DEFAULT_COLOR = '#3b82f6';
const DEFAULT_SIZE = 120;
const DEFAULT_GLOBAL_PRECISION = 2;
const SEGMENT_COUNT = 72;
const START_ANGLE_DEGREES = -90;
const FULL_TURN_DEGREES = 360;

export const RadialGauge = forwardRef<View, RadialGaugeProps>(
  function RadialGauge(
    {
      value,
      max,
      label,
      unit,
      color = DEFAULT_COLOR,
      size = DEFAULT_SIZE,
      decimals,
      className: _className,
      style,
      testID,
      'data-testid': dataTestID,
      ...rest
    },
    ref,
  ) {
    const radius = (size - STROKE_WIDTH) / 2;
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;
    const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
    const clamped = Math.max(0, Math.min(safeNumber(value), safeMax));
    const offset =
      safeMax > 0
        ? circumference - (clamped / safeMax) * circumference
        : circumference;
    const progress =
      circumference > 0 ? 1 - offset / circumference : 0;
    const d = decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision());
    const segments = useMemo(
      () => buildGaugeSegments(size, radius, center, circumference),
      [center, circumference, radius, size],
    );
    const activeSegmentCount = Math.round(
      clamp(progress, 0, 1) * SEGMENT_COUNT,
    );
    const formattedValue = fmtNumber(clamped, d);

    return (
      <View
        {...rest}
        ref={ref}
        accessible
        accessibilityLabel={`${label}: ${formattedValue}${unit ?? ''}`}
        accessibilityRole="summary"
        style={[styles.root, style]}
        testID={testID ?? dataTestID}>
        <View
          pointerEvents="none"
          style={[styles.gauge, {height: size, width: size}]}>
          {segments.map((segment, index) => (
            <View
              key={segment.key}
              style={[
                styles.segment,
                {
                  backgroundColor:
                    index < activeSegmentCount ? color : colors.border,
                  left: segment.left,
                  top: segment.top,
                  transform: [{rotateZ: segment.angle}],
                  width: segment.width,
                },
              ]}
            />
          ))}

          <View
            style={[styles.valueOverlay, {height: size, width: size}]}>
            <AppText
              style={styles.valueText}
              variant="title"
              weight="bold">
              {formattedValue}
              {unit ? (
                <AppText
                  style={styles.unitText}
                  tone="muted"
                  variant="caption">
                  {unit}
                </AppText>
              ) : null}
            </AppText>
          </View>
        </View>

        <AppText
          numberOfLines={2}
          style={styles.label}
          tone="muted"
          variant="caption"
          weight="semibold">
          {label}
        </AppText>
      </View>
    );
  },
);

RadialGauge.displayName = 'RadialGauge';

function buildGaugeSegments(
  size: number,
  radius: number,
  center: number,
  circumference: number,
): GaugeSegment[] {
  const segmentWidth = Math.max(
    2,
    (circumference / SEGMENT_COUNT) * 0.62,
  );

  return Array.from({length: SEGMENT_COUNT}, (_, index) => {
    const angle =
      START_ANGLE_DEGREES + (index / SEGMENT_COUNT) * FULL_TURN_DEGREES;
    const radians = (angle * Math.PI) / 180;
    const left = center + radius * Math.cos(radians) - segmentWidth / 2;
    const top = center + radius * Math.sin(radians) - STROKE_WIDTH / 2;

    return {
      angle: `${angle + 90}deg`,
      key: `${size}-${index}-${left}-${top}`,
      left,
      top,
      width: segmentWidth,
    };
  });
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

function getGlobalPrecision(): number {
  return DEFAULT_GLOBAL_PRECISION;
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  gauge: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  label: {
    maxWidth: 160,
    textAlign: 'center',
  },
  root: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  segment: {
    borderRadius: STROKE_WIDTH / 2,
    height: STROKE_WIDTH,
    opacity: 1,
    position: 'absolute',
  },
  unitText: {
    fontWeight: '400',
  },
  valueOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  valueText: {
    color: colors.textPrimary,
    textAlign: 'center',
  },
});
