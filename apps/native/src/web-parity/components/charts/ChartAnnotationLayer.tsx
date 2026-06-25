// Native parity port of web/src/components/charts/ChartAnnotationLayer.tsx.
// Replaces Recharts ReferenceLine children with absolute React Native markers
// that can be spread into native chart containers.

import React from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import type {
  AnnotationCategory,
  DataAnnotation,
} from '../../api/hooks/useAnnotations';

type AnnotationXValue = number | string;

const ANNOTATION_COLORS: Record<AnnotationCategory, string> = {
  milestone: '#3b82f6',
  maintenance: '#f59e0b',
  trip: '#22c55e',
  issue: '#ef4444',
  upgrade: '#a855f7',
  custom: '#94a3b8',
};

/**
 * Returns an array of native annotation marker elements for chart annotations.
 * Must be spread directly as children of a native chart plot layer so the
 * absolute markers overlay the chart instead of wrapping it.
 */
export function renderAnnotationLines(
  annotations: DataAnnotation[],
  toXValue: (timestamp: string) => number | string,
): React.ReactElement[] {
  const safeAnnotations = Array.isArray(annotations) ? annotations : [];

  return safeAnnotations.map((ann, index) => {
    const xValue = toXValue(ann.timestamp);

    return (
      <NativeAnnotationLine
        key={ann.id}
        annotation={ann}
        color={ANNOTATION_COLORS[ann.category]}
        left={resolveAnnotationLeft(xValue, index, safeAnnotations.length)}
        xValue={xValue}
      />
    );
  });
}

interface NativeAnnotationLineProps {
  annotation: DataAnnotation;
  color: string;
  left: DimensionValue;
  xValue: AnnotationXValue;
}

function NativeAnnotationLine({
  annotation,
  color,
  left,
  xValue,
}: NativeAnnotationLineProps) {
  return (
    <View
      accessibilityHint={`Native chart x value ${String(xValue)}`}
      accessibilityLabel={`${annotation.label} annotation at ${annotation.timestamp}`}
      accessibilityRole="text"
      accessible
      pointerEvents="none"
      style={[styles.annotation, {left}]}
      testID={`annotation-line-${annotation.id}`}>
      <AppText
        numberOfLines={1}
        style={[styles.label, {color}]}
        variant="caption"
        weight="semibold">
        {annotation.label}
      </AppText>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.line, {borderLeftColor: color}]}
      />
    </View>
  );
}

function resolveAnnotationLeft(
  value: AnnotationXValue,
  index: number,
  count: number,
): DimensionValue {
  const numericValue =
    typeof value === 'number'
      ? value
      : value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (Number.isFinite(numericValue)) {
    const percentage = numericValue >= 0 && numericValue <= 1
      ? numericValue * 100
      : numericValue;

    if (percentage >= 0 && percentage <= 100) {
      return `${percentage}%` as DimensionValue;
    }
  }

  if (count <= 1) {
    return '50%';
  }

  return `${(index / (count - 1)) * 100}%` as DimensionValue;
}

const styles = StyleSheet.create({
  annotation: {
    alignItems: 'center',
    bottom: 0,
    marginLeft: -40,
    position: 'absolute',
    top: 0,
    width: 80,
  },
  label: {
    fontSize: 10,
    lineHeight: 14,
    maxWidth: 78,
    textAlign: 'center',
  },
  line: {
    borderLeftWidth: 1.5,
    borderStyle: 'dashed',
    flex: 1,
    marginTop: 2,
    opacity: 0.7,
  },
});
