// Native parity port of web/src/components/charts/ChartGradient.tsx.
// React Native has no built-in SVG <linearGradient>, so expose the source
// gradient stops as metadata and render an inert marker for JSX compatibility.

import React, {memo} from 'react';
import {StyleSheet, View} from 'react-native';

export interface ChartGradientProps {
  id: string;
  color: string;
  opacity?: number;
}

export interface NativeChartGradientStop {
  readonly offset: '0%' | '95%';
  readonly stopColor: string;
  readonly stopOpacity: number;
}

export interface NativeChartGradientDescriptor {
  readonly id: string;
  readonly color: string;
  readonly opacity: number;
  readonly stops: readonly [NativeChartGradientStop, NativeChartGradientStop];
  readonly nativeUnavailable: true;
  readonly unavailableReason: typeof CHART_GRADIENT_NATIVE_UNAVAILABLE_REASON;
}

export const CHART_GRADIENT_NATIVE_UNAVAILABLE_REASON =
  'SVG <linearGradient> chart defs are unavailable in React Native without an SVG chart backend.' as const;

export function createChartGradientDescriptor({
  id,
  color,
  opacity = 0.3,
}: ChartGradientProps): NativeChartGradientDescriptor {
  return {
    color,
    id,
    nativeUnavailable: true,
    opacity,
    stops: [
      {offset: '0%', stopColor: color, stopOpacity: opacity},
      {offset: '95%', stopColor: color, stopOpacity: 0.02},
    ],
    unavailableReason: CHART_GRADIENT_NATIVE_UNAVAILABLE_REASON,
  };
}

export function ChartGradientBase({
  id,
  color,
  opacity = 0.3,
}: ChartGradientProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      nativeID={id}
      pointerEvents="none"
      style={[
        styles.nativeUnavailableGradient,
        {backgroundColor: color, opacity: clampNativeOpacity(opacity)},
      ]}
      testID={`chart-gradient-unavailable-${id}`}
    />
  );
}

ChartGradientBase.displayName = 'ChartGradientBase';

export const ChartGradient = memo(ChartGradientBase);

ChartGradient.displayName = 'ChartGradient';

function clampNativeOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) {
    return 0.3;
  }
  return Math.min(Math.max(opacity, 0), 1);
}

const styles = StyleSheet.create({
  nativeUnavailableGradient: {
    height: 0,
    overflow: 'hidden',
    width: 0,
  },
});
