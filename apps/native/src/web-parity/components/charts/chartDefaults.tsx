// Native parity port of web/src/components/charts/chartDefaults.tsx.
// Recharts SVG gradients are represented by an inert native marker plus
// descriptor metadata because React Native does not include an SVG chart backend.

import React from 'react';
import {StyleSheet, View} from 'react-native';

/**
 * Shared chart props for smoothed Area/Line charts.
 * Native chart shims can reuse these values when emulating web chart behavior.
 */
export const AREA_DEFAULTS = {
  type: 'monotone' as const,
  dot: false,
  connectNulls: true,
  strokeWidth: 2,
  animationDuration: 300,
} as const;

export const AREA_GRADIENT_NATIVE_UNAVAILABLE_REASON =
  'Recharts SVG <defs>/<linearGradient> area fills are unavailable in React Native without an SVG chart backend.' as const;

export interface NativeAreaGradientStop {
  readonly offset: '0%' | '95%';
  readonly stopColor: string;
  readonly stopOpacity: number;
}

export interface NativeAreaGradientDescriptor {
  readonly id: string;
  readonly color: string;
  readonly opacity: number;
  readonly stops: readonly [NativeAreaGradientStop, NativeAreaGradientStop];
  readonly nativeUnavailable: true;
  readonly unavailableReason: typeof AREA_GRADIENT_NATIVE_UNAVAILABLE_REASON;
}

/**
 * Returns a native-safe placeholder for Recharts area fill gradients.
 * Use createAreaGradientDescriptor when a native chart needs the stop metadata.
 *
 * @param id Unique gradient ID retained for parity with web chart references.
 * @param color Hex color string used by the source web gradient.
 * @param opacity Top opacity for the source gradient.
 */
export function areaGradient(id: string, color: string, opacity = 0.3) {
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
      testID={`area-gradient-unavailable-${id}`}
    />
  );
}

export function createAreaGradientDescriptor(
  id: string,
  color: string,
  opacity = 0.3,
): NativeAreaGradientDescriptor {
  return {
    color,
    id,
    nativeUnavailable: true,
    opacity,
    stops: [
      {offset: '0%', stopColor: color, stopOpacity: opacity},
      {offset: '95%', stopColor: color, stopOpacity: 0.02},
    ],
    unavailableReason: AREA_GRADIENT_NATIVE_UNAVAILABLE_REASON,
  };
}

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
