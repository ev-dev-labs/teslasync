// Native parity port of web/src/components/layout/Grid.tsx.
//
// The web component is a thin wrapper over a CSS grid: it renders a single
// `<div className="grid …">` whose column count comes from Tailwind
// `grid-cols-{n}` classes (responsive via `sm:` / `md:` / `lg:` prefixes) and
// whose gutter comes from `gap-{n}`. Children flow into the implicit grid
// tracks.
//
// React Native has no CSS grid, Tailwind classes, or `prefers`-style viewport
// media queries, and the web-only `cn()` helper (web L2) plus the
// number->class `colsMap` lookup (web L11-14) have no native analog. This port
// reproduces the same *visual intent* with the flexbox engine:
//   - The `grid` container (web L20) becomes a `flexDirection: 'row'` +
//     `flexWrap: 'wrap'` View.
//   - The responsive `grid-cols-*` cascade (web L21-24: default -> sm -> md ->
//     lg) is resolved against the live window width using the same Tailwind
//     breakpoints (sm 640 / md 768 / lg 1024px) via `useWindowDimensions`,
//     which matches the web's viewport-based media queries. `cols.xl` is part
//     of the props for API parity but — exactly like the web component, which
//     never emits an `xl:` class — it is accepted and intentionally not
//     applied. See the sidecar.
//   - The numeric `gap` (web L25, Tailwind `gap-{n}`) is converted to pixels
//     using Tailwind's 0.25rem (4px) spacing unit and applied with the RN
//     flexbox `gap` property (supported since RN 0.71; this app is on 0.81).
//   - Each child is placed in an equal-width cell. The exact cell width is
//     computed from the measured container width minus the inter-column gaps,
//     so N columns line up precisely; a single column (or the pre-measurement
//     first frame) falls back to full-width rows.
//   - The web `className` escape hatch (web L8, L26) becomes the conventional
//     native `style` prop, composed via a style array.
//
// No DOM elements, Tailwind classes, Recharts, Leaflet, or old web UI
// components are imported — only React Native primitives.

import React, {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// Tailwind responsive breakpoints (min-width in px) backing the web Grid's
// `sm:` / `md:` / `lg:` column classes.
const BREAKPOINTS = {sm: 640, md: 768, lg: 1024} as const;

// Tailwind spacing unit = 0.25rem = 4px, so `gap-{n}` resolves to n * 4 px.
const TAILWIND_UNIT_PX = 4;

/** Responsive column counts, mirroring the web Grid's `cols` prop. */
export interface GridColumns {
  default?: number;
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
}

export interface GridProps {
  cols?: GridColumns;
  gap?: number;
  children: ReactNode;
  /** Native analog of the web `className` escape hatch. */
  style?: StyleProp<ViewStyle>;
}

// Mirror the web cascade: start from `cols.default`, then let sm/md/lg override
// as the viewport widens. The web template only emits sm:/md:/lg: classes, so
// `cols.xl` is deliberately ignored here to preserve behavior.
function resolveColumnCount(cols: GridColumns, windowWidth: number): number {
  let active = cols.default ?? 1;
  if (cols.sm != null && windowWidth >= BREAKPOINTS.sm) {
    active = cols.sm;
  }
  if (cols.md != null && windowWidth >= BREAKPOINTS.md) {
    active = cols.md;
  }
  if (cols.lg != null && windowWidth >= BREAKPOINTS.lg) {
    active = cols.lg;
  }
  return Math.max(1, active);
}

export function Grid({cols = {default: 1}, gap = 4, children, style}: GridProps) {
  const {width: windowWidth} = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);

  const gapPx = gap * TAILWIND_UNIT_PX;
  const columnCount = resolveColumnCount(cols, windowWidth);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  }, []);

  const cellStyle = useMemo<ViewStyle>(() => {
    if (columnCount <= 1) {
      return {width: '100%'};
    }
    if (containerWidth > 0) {
      const available = containerWidth - gapPx * (columnCount - 1);
      return {width: Math.max(0, available / columnCount)};
    }
    // Pre-measurement first frame: approximate with a percentage basis so the
    // grid is never blank; it snaps to the exact width on the first layout.
    return {width: `${100 / columnCount}%`};
  }, [columnCount, containerWidth, gapPx]);

  const items = React.Children.toArray(children);

  return (
    <View
      onLayout={handleLayout}
      style={[styles.root, {gap: gapPx}, style]}>
      {items.map((child, index) => (
        <View key={index} style={cellStyle}>
          {child}
        </View>
      ))}
    </View>
  );
}

Grid.displayName = 'Grid';

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});

export default Grid;
