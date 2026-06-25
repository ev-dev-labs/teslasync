// Native parity port of web/src/components/forms/FilterBar.tsx.
//
// The web component is a horizontal flex container (`flex flex-wrap
// items-center gap-2`) that lays out list-page filter controls -- a
// `SearchInput` plus any number of `Select`, `Toggle`, chip, or button
// widgets -- wrapping to multiple rows on narrow viewports. It is reproduced
// here with a React Native `View` using `flexDirection: 'row'`,
// `flexWrap: 'wrap'`, `alignItems: 'center'`, and `gap: spacing.sm` (the
// 8px `gap-2` equivalent). The web `className` Tailwind override is retained
// on the props for source compatibility but is ignored on native; callers can
// pass a native `style` instead.

import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import type {ReactNode} from 'react';

import {spacing} from '../../../theme/tokens';

export interface FilterBarProps {
  children: ReactNode;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Horizontal layout container for list-page filter controls.
 *
 * Wraps a `SearchInput` plus any number of `Select`, `Toggle`, button chips,
 * or other filter widgets. Items wrap to multiple rows on narrow viewports.
 */
export function FilterBar({
  children,
  className: _className,
  style,
  testID,
}: FilterBarProps) {
  return (
    <View style={[styles.root, style]} testID={testID ?? 'filter-bar'}>
      {children}
    </View>
  );
}

FilterBar.displayName = 'FilterBar';

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
