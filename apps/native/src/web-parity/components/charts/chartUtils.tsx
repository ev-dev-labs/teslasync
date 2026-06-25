// Native parity port of web/src/components/charts/chartUtils.tsx.
// Recharts CartesianGrid is represented by an inert native marker plus
// descriptor metadata because React Native has no built-in SVG chart backend.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {colors} from '../../../theme/tokens';

const nativeChartTokens = {
  axisStroke: colors.textMuted,
  gridStroke: colors.border,
} as const;

const CHART_COLORS_NEON = [
  '#00f0ff',
  '#10b981',
  '#a855f7',
  '#f59e0b',
  '#4f46e5',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
] as const;

export const CHART_COLORS = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#F0E442',
  '#56B4E9',
  '#D55E00',
  '#CC79A7',
  '#4B4B4B',
] as const;

export const NEON_COLORS = CHART_COLORS_NEON;

export const axisTick = {fill: nativeChartTokens.axisStroke, fontSize: 11};
export const axisTickSm = {fill: nativeChartTokens.axisStroke, fontSize: 10};

export const CHART_GRID_NATIVE_UNAVAILABLE_REASON =
  'Recharts CartesianGrid is unavailable in React Native without an SVG chart backend.' as const;

export interface NativeChartGridDescriptor {
  readonly nativeUnavailable: true;
  readonly stroke: string;
  readonly strokeDasharray: '3 3';
  readonly strokeOpacity: 0.4;
  readonly unavailableReason: typeof CHART_GRID_NATIVE_UNAVAILABLE_REASON;
}

export const chartGridDescriptor: NativeChartGridDescriptor = {
  nativeUnavailable: true,
  stroke: nativeChartTokens.gridStroke,
  strokeDasharray: '3 3',
  strokeOpacity: 0.4,
  unavailableReason: CHART_GRID_NATIVE_UNAVAILABLE_REASON,
};

const styles = StyleSheet.create({
  nativeUnavailableGrid: {
    borderStyle: 'dashed',
    borderWidth: 0,
    height: 0,
    overflow: 'hidden',
    width: 0,
  },
});

export const chartGrid = (
  <View
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    pointerEvents="none"
    style={[
      styles.nativeUnavailableGrid,
      {
        borderColor: chartGridDescriptor.stroke,
        opacity: chartGridDescriptor.strokeOpacity,
      },
    ]}
    testID="chart-grid-unavailable"
  />
);

export const safe = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

export const fmt = (v: unknown, decimals = 1): string =>
  fmtNumber(v, decimals);

export const chartAnimation = {
  animationDuration: 800,
  animationEasing: 'ease-out' as const,
};

export const chartMargin = {top: 10, right: 10, left: 0, bottom: 0};
export const chartMarginLabeled = {top: 10, right: 20, left: 10, bottom: 5};

function fmtNumber(v: unknown, decimals = 2, locale = 'en-US'): string {
  try {
    return safe(v).toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safe(v).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}
