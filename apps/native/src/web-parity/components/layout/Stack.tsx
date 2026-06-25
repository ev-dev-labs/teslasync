// Native parity port of web/src/components/layout/Stack.tsx.
//
// The web `Stack` is a tiny polymorphic flexbox primitive: it renders an element
// (`as`, default <div>) with Tailwind flex utilities driven by `direction`
// ('col'|'row'), `gap` (1|2|3|4|6|8 -> Tailwind gap-N), `align` (items-*) and
// `justify` (justify-*), merging any caller `className` last via `cn()`. It is
// reproduced here with React Native primitives:
//
//   - The DOM polymorphism (`as` defaulting to a <div>) becomes `as` defaulting
//     to React Native's `View`. The generic `<T extends ElementType>` +
//     `ComponentPropsWithoutRef<T>` signature is preserved verbatim — both come
//     from `react`, not the DOM — so callers can still render the stack as any
//     component (e.g. `as={Pressable}`) with that component's props inferred.
//   - Tailwind `gap-N` classes have no native analog; RN 0.71+ supports the
//     `gap` style directly, so the Tailwind scale (gap-1=4px ... gap-8=32px) is
//     reproduced as exact pixel values in GAP_MAP.
//   - `flex flex-col`/`flex-row` -> StyleSheet flexDirection; `items-*` ->
//     alignItems; `justify-*` -> justifyContent (start/end -> flex-start/flex-
//     end, between -> space-between). Browser and RN share the same flex defaults
//     (align-items: stretch, justify-content: flex-start), so unset align/justify
//     are intentionally left off — matching the web `align && ...`/`justify && ...`.
//   - The web `className` (the only DOM-specific styling channel) is replaced by
//     the native `style` prop, merged LAST so caller styles win — the same
//     precedence cn() gives the trailing className argument.
//   - No DOM elements, clsx/tailwind-merge `cn`, or Tailwind classes are
//     imported; only RN `View` + StyleSheet are used.

import {type ComponentPropsWithoutRef, type ElementType} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

/** Tailwind gap steps the web Stack accepts (`gap-N` => N * 4px). */
export type StackGap = 1 | 2 | 3 | 4 | 6 | 8;
export type StackDirection = 'row' | 'col';
export type StackAlign = 'start' | 'center' | 'end' | 'stretch';
export type StackJustify = 'start' | 'center' | 'end' | 'between';

type StackOwnProps<T extends ElementType = typeof View> = {
  /** Component to render as. Defaults to `View` (the native base container). */
  as?: T;
  direction?: StackDirection;
  gap?: StackGap;
  align?: StackAlign;
  justify?: StackJustify;
  /** Native replacement for the web `className`; merged last so callers win. */
  style?: StyleProp<ViewStyle>;
};

export type StackProps<T extends ElementType = typeof View> = StackOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof StackOwnProps>;

/** Tailwind `gap-N` -> pixels (RN supports the `gap` style natively). */
const GAP_MAP: Record<StackGap, number> = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
};

const ALIGN_MAP: Record<StackAlign, ViewStyle['alignItems']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};

const JUSTIFY_MAP: Record<StackJustify, ViewStyle['justifyContent']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
};

export function Stack<T extends ElementType = typeof View>({
  as,
  direction = 'col',
  gap = 4,
  align,
  justify,
  style,
  ...props
}: StackProps<T>) {
  const Component = (as ?? View) as ElementType;
  const composedStyle: StyleProp<ViewStyle> = [
    direction === 'col' ? styles.col : styles.row,
    {gap: GAP_MAP[gap]},
    align ? {alignItems: ALIGN_MAP[align]} : null,
    justify ? {justifyContent: JUSTIFY_MAP[justify]} : null,
    style,
  ];

  return <Component style={composedStyle} {...props} />;
}

Stack.displayName = 'Stack';

const styles = StyleSheet.create({
  col: {
    flexDirection: 'column',
  },
  row: {
    flexDirection: 'row',
  },
});
