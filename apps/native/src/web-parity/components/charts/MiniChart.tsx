// Native parity port of web/src/components/charts/MiniChart.tsx.
// React Native has no built-in SVG polyline, so this renders the same
// projected points as rounded absolute-positioned line segments.

import React, {forwardRef, useMemo} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

interface MiniChartProps extends Omit<ViewProps, 'style'> {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  'data-testid'?: string;
}

interface MiniChartPoint {
  x: number;
  y: number;
}

interface MiniChartSegment {
  angle: string;
  key: string;
  left: number;
  top: number;
  width: number;
}

const DEFAULT_COLOR = '#3b82f6';
const DEFAULT_HEIGHT = 32;
const DEFAULT_WIDTH = 100;
const PADDING = 2;
const STROKE_WIDTH = 1.5;

export const MiniChart = forwardRef<View, MiniChartProps>(
  function MiniChart(
    {
      data,
      color = DEFAULT_COLOR,
      height = DEFAULT_HEIGHT,
      width = DEFAULT_WIDTH,
      className: _className,
      style,
      testID,
      'data-testid': dataTestID,
      ...rest
    },
    ref,
  ) {
    const points = useMemo(
      () => buildMiniChartPoints(data, height, width),
      [data, height, width],
    );
    const segments = useMemo(() => buildMiniChartSegments(points), [points]);

    if (data.length < 2) {
      return null;
    }

    return (
      <View
        {...rest}
        ref={ref}
        accessible
        accessibilityLabel={`Mini chart with ${data.length} points`}
        accessibilityRole="image"
        style={[styles.root, {height, width}, style]}
        testID={testID ?? dataTestID}>
        {segments.map(segment => (
          <View
            key={segment.key}
            pointerEvents="none"
            style={[
              styles.segment,
              {
                backgroundColor: color,
                left: segment.left,
                top: segment.top,
                transform: [{rotateZ: segment.angle}],
                width: segment.width,
              },
            ]}
          />
        ))}
      </View>
    );
  },
);

MiniChart.displayName = 'MiniChart';

function buildMiniChartPoints(
  data: number[],
  height: number,
  width: number,
): MiniChartPoint[] {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  return data.map((value, index) => {
    const x = (index / (data.length - 1)) * (width - PADDING * 2) + PADDING;
    const y =
      height -
      PADDING -
      ((value - min) / range) * (height - PADDING * 2);

    return {x, y};
  });
}

function buildMiniChartSegments(
  points: MiniChartPoint[],
): MiniChartSegment[] {
  return points.slice(1).map((point, index) => {
    const previousPoint = points[index];
    const deltaX = point.x - previousPoint.x;
    const deltaY = point.y - previousPoint.y;
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
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

const styles = StyleSheet.create({
  root: {
    alignSelf: 'flex-start',
    overflow: 'visible',
    position: 'relative',
  },
  segment: {
    borderRadius: STROKE_WIDTH / 2,
    height: STROKE_WIDTH,
    position: 'absolute',
  },
});
