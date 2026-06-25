// Native parity port of web/src/components/branding/HelixMark.tsx.
//
// React Native has no built-in SVG path primitive in this app, so the Helix
// brand mark is drawn with scalable View strokes that preserve the double-helix
// silhouette, two crossing strands, and two horizontal rungs.

import React, {forwardRef, type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import {colors} from '../../../theme/tokens';

const HELIX_VIEWBOX = '0 0 24 24';
const HELIX_VIEWBOX_SIZE = 24;
const DEFAULT_SIZE = 24;
const DEFAULT_STROKE_WIDTH = 1.75;

type NumberLike = number | string;
type WebAriaHidden = boolean | 'true' | 'false';

type WebSvgCompatibilityProps = {
  className?: string;
  'data-testid'?: string;
  'aria-hidden'?: WebAriaHidden;
  absoluteStrokeWidth?: boolean;
  color?: string;
  fill?: string;
  height?: NumberLike;
  size?: NumberLike;
  stroke?: string;
  strokeLinecap?: 'round' | 'butt' | 'square' | string;
  strokeLinejoin?: 'round' | 'bevel' | 'miter' | string;
  strokeWidth?: NumberLike;
  viewBox?: string;
  width?: NumberLike;
  xmlns?: string;
};

export type HelixMarkProps = Omit<
  ViewProps,
  | keyof WebSvgCompatibilityProps
  | 'accessibilityElementsHidden'
  | 'children'
  | 'importantForAccessibility'
  | 'style'
  | 'testID'
> &
  WebSvgCompatibilityProps & {
    children?: ReactNode;
    accessibilityElementsHidden?: ViewProps['accessibilityElementsHidden'];
    importantForAccessibility?: ViewProps['importantForAccessibility'];
    style?: StyleProp<ViewStyle>;
    testID?: string;
  };

function toPositiveNumber(value: NumberLike | undefined, fallback: number): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  return fallback;
}

function resolveColor(color: string | undefined): string {
  if (!color || color === 'currentColor') {
    return colors.accent;
  }

  return color;
}

function isAriaHidden(value: WebAriaHidden | undefined): boolean {
  return value === true || value === 'true';
}

function createStrokeStyle(
  width: number,
  color: string,
  opacity = 1,
): ViewStyle {
  return {
    backgroundColor: color,
    borderRadius: 999,
    opacity,
    width,
  };
}

export const HelixMark = forwardRef<View, HelixMarkProps>(function HelixMark(
  {
    size = DEFAULT_SIZE,
    color = 'currentColor',
    strokeWidth = DEFAULT_STROKE_WIDTH,
    absoluteStrokeWidth,
    className: _className,
    children,
    style,
    testID,
    accessibilityElementsHidden,
    importantForAccessibility,
    'aria-hidden': ariaHidden,
    'data-testid': dataTestID,
    fill: _fill = 'none',
    height,
    stroke,
    strokeLinecap: _strokeLinecap = 'round',
    strokeLinejoin: _strokeLinejoin = 'round',
    viewBox: _viewBox = HELIX_VIEWBOX,
    width,
    xmlns: _xmlns,
    ...rest
  },
  ref,
) {
  const resolvedSize = toPositiveNumber(size, DEFAULT_SIZE);
  const resolvedWidth = toPositiveNumber(width, resolvedSize);
  const resolvedHeight = toPositiveNumber(height, resolvedSize);
  const scale = Math.min(resolvedWidth, resolvedHeight) / HELIX_VIEWBOX_SIZE;
  const strokeNumber = toPositiveNumber(strokeWidth, DEFAULT_STROKE_WIDTH);
  const effectiveStroke = absoluteStrokeWidth
    ? (strokeNumber * HELIX_VIEWBOX_SIZE) / resolvedSize
    : strokeNumber;
  const scaledStroke = Math.max(1, effectiveStroke * scale);
  const displayColor = resolveColor(stroke ?? color);
  const hidden = isAriaHidden(ariaHidden);

  return (
    <View
      {...rest}
      ref={ref}
      accessibilityElementsHidden={accessibilityElementsHidden ?? hidden}
      importantForAccessibility={
        importantForAccessibility ?? (hidden ? 'no-hide-descendants' : 'auto')
      }
      pointerEvents={hidden ? 'none' : rest.pointerEvents}
      style={[
        styles.root,
        {
          height: resolvedHeight,
          width: resolvedWidth,
        },
        style,
      ]}
      testID={testID ?? dataTestID}>
      <View
        pointerEvents="none"
        style={[
          styles.strand,
          createStrokeStyle(scaledStroke, displayColor),
          {
            height: 20 * scale,
            left: 11 * scale,
            top: 2 * scale,
            transform: [{rotate: '-31deg'}],
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.strand,
          createStrokeStyle(scaledStroke, displayColor),
          {
            height: 20 * scale,
            left: 11 * scale,
            top: 2 * scale,
            transform: [{rotate: '31deg'}],
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.rung,
          createStrokeStyle(scaledStroke, displayColor, 0.86),
          {
            height: scaledStroke,
            left: 10 * scale,
            top: 7 * scale - scaledStroke / 2,
            width: 4 * scale,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.rung,
          createStrokeStyle(scaledStroke, displayColor, 0.86),
          {
            height: scaledStroke,
            left: 10 * scale,
            top: 17 * scale - scaledStroke / 2,
            width: 4 * scale,
          },
        ]}
      />
      {children}
    </View>
  );
});

HelixMark.displayName = 'HelixMark';

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
    position: 'relative',
  },
  rung: {
    position: 'absolute',
  },
  strand: {
    position: 'absolute',
  },
});
