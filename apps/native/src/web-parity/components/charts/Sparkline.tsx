// Native parity port of web/src/components/charts/Sparkline.tsx.
// React Native has no built-in SVG polyline/gradient, so this renders the
// same projected points as native line segments with translucent area strips.

import React, {useMemo} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

export interface SparklineProps extends Omit<ViewProps, 'style'> {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  'data-testid'?: string;
}

interface SparklinePoint {
  key: string;
  value: number;
  x: number;
  y: number;
}

interface SparklineSegment {
  angle: string;
  key: string;
  left: number;
  top: number;
  width: number;
}

interface SparklineAreaStrip {
  height: number;
  key: string;
  left: number;
  top: number;
  width: number;
}

interface SparklineGeometry {
  areaStrips: SparklineAreaStrip[];
  points: SparklinePoint[];
  segments: SparklineSegment[];
}

const DEFAULT_COLOR = '#00f0ff';
const DEFAULT_HEIGHT = 30;
const DEFAULT_WIDTH = 100;
const DOT_SIZE = 4;
const STROKE_WIDTH = 1.5;

/** Tiny inline native line chart for showing trends in a compact space. */
export function Sparkline({
  accessibilityLabel,
  data,
  color = DEFAULT_COLOR,
  height = DEFAULT_HEIGHT,
  width = DEFAULT_WIDTH,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  ...rest
}: SparklineProps) {
  const safeHeight = normalizeDimension(height, DEFAULT_HEIGHT);
  const safeWidth = normalizeDimension(width, DEFAULT_WIDTH);
  const geometry = useMemo(
    () => buildSparklineGeometry(data, safeHeight, safeWidth),
    [data, safeHeight, safeWidth],
  );

  if (!data.length || geometry.points.length === 0) {
    return null;
  }

  return (
    <View
      {...rest}
      accessible
      accessibilityLabel={
        accessibilityLabel ??
        `Sparkline trend with ${geometry.points.length} points`
      }
      accessibilityRole="image"
      style={[styles.root, {height: safeHeight, width: safeWidth}, style]}
      testID={testID ?? dataTestID}>
      {geometry.areaStrips.map(strip => (
        <View
          key={strip.key}
          pointerEvents="none"
          style={[
            styles.areaStrip,
            {
              backgroundColor: color,
              height: strip.height,
              left: strip.left,
              opacity: 0.18,
              top: strip.top,
              width: strip.width,
            },
          ]}
        />
      ))}
      {geometry.segments.map(segment => (
        <View
          key={segment.key}
          pointerEvents="none"
          style={[
            styles.segment,
            {
              backgroundColor: color,
              left: segment.left,
              shadowColor: color,
              top: segment.top,
              transform: [{rotateZ: segment.angle}],
              width: segment.width,
            },
          ]}
        />
      ))}
      {geometry.points.length === 1 ? (
        <View
          pointerEvents="none"
          style={[
            styles.singlePoint,
            {
              backgroundColor: color,
              left: geometry.points[0].x - DOT_SIZE / 2,
              shadowColor: color,
              top: geometry.points[0].y - DOT_SIZE / 2,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

function buildSparklineGeometry(
  data: number[],
  height: number,
  width: number,
): SparklineGeometry {
  const values = data.filter(value => Number.isFinite(value));

  if (values.length === 0) {
    return {areaStrips: [], points: [], segments: []};
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x =
      values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * height;

    return {
      key: `${index}-${value}`,
      value,
      x,
      y,
    };
  });

  return {
    areaStrips: buildAreaStrips(points, height, width),
    points,
    segments: buildSegments(points),
  };
}

function buildSegments(points: SparklinePoint[]): SparklineSegment[] {
  return points.slice(1).flatMap((point, index) => {
    const previousPoint = points[index];
    const deltaX = point.x - previousPoint.x;
    const deltaY = point.y - previousPoint.y;
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    if (length <= 0) {
      return [];
    }

    const midpointX = previousPoint.x + deltaX / 2;
    const midpointY = previousPoint.y + deltaY / 2;
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);

    return {
      angle: `${angle}deg`,
      key: `${index}-${previousPoint.x}-${previousPoint.y}-${point.x}-${point.y}`,
      left: midpointX - length / 2,
      top: midpointY - STROKE_WIDTH / 2,
      width: length,
    };
  });
}

function buildAreaStrips(
  points: SparklinePoint[],
  height: number,
  width: number,
): SparklineAreaStrip[] {
  const stripWidth =
    points.length === 1 ? Math.max(width, 1) : Math.max(width / points.length, 1);

  return points.map(point => ({
    height: Math.max(height - point.y, 0),
    key: `area-${point.key}`,
    left: clamp(point.x - stripWidth / 2, 0, Math.max(width - stripWidth, 0)),
    top: point.y,
    width: stripWidth,
  }));
}

function normalizeDimension(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  areaStrip: {
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
    position: 'absolute',
  },
  root: {
    alignSelf: 'flex-start',
    overflow: 'visible',
    position: 'relative',
  },
  segment: {
    borderRadius: STROKE_WIDTH / 2,
    elevation: 2,
    height: STROKE_WIDTH,
    position: 'absolute',
    shadowOffset: {height: 0, width: 0},
    shadowOpacity: 0.72,
    shadowRadius: 3,
  },
  singlePoint: {
    borderRadius: DOT_SIZE / 2,
    elevation: 2,
    height: DOT_SIZE,
    position: 'absolute',
    shadowOffset: {height: 0, width: 0},
    shadowOpacity: 0.72,
    shadowRadius: 3,
    width: DOT_SIZE,
  },
});
