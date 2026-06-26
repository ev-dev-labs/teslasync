// Native parity port of web/src/components/ui/Card.tsx.
//
// The web module exports a glass-surface container (`Card`) plus two layout
// helpers (`CardHeader`, `CardFooter`). The web implementation leans on
// DOM-only primitives that have no React Native analog:
//   - `forwardRef<HTMLDivElement>` + `HTMLAttributes<HTMLDivElement>` spread ->
//     ported to `forwardRef<View>` + `ViewProps` passthrough.
//   - the `cn` Tailwind/clsx class merge helper (`@/lib/cn`) -> dropped; the
//     class intent (rounded-lg border, --surface-1 background,
//     --text-primary text, shadow-sm; hover -> shadow-md) is reproduced with
//     StyleSheet + theme tokens.
//   - `padding: 'auto'` maps to the density-aware Tailwind utilities
//     (`px-d-pad-x py-d-pad-y`) driven by `useDensitySync`/`index.css`, which
//     do not exist on native; it falls back to the `md` (16px) scale.
//   - the `forced-colors:` Windows High Contrast border/background overrides
//     have no React Native equivalent (RN has no forced-colors media feature),
//     so they are intentionally omitted.
//   - the `hover` affordance (`cursor-pointer transition-shadow hover:shadow-md`)
//     describes a pointer-hover transition; touch platforms have no hover, so
//     `hover` is preserved as a static elevated resting shadow that signals the
//     card is interactive. See the .parity.json sidecar for the line-by-line map.

import React, {forwardRef, type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg' | 'auto';

export interface CardProps extends Omit<ViewProps, 'style'> {
  /**
   * Padding scale. Defaults to `'md'`. The web `'auto'` value follows the
   * user's `ui_density` setting via density-aware Tailwind utilities; native
   * has no density sync, so `'auto'` falls back to the `'md'` (16px) scale.
   */
  padding?: CardPadding;
  /**
   * Web hover affordance. Native has no pointer hover, so this renders a static
   * elevated shadow signalling the card is interactive rather than a transition.
   */
  hover?: boolean;
  /** Web Tailwind className. Retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
  'data-testid'?: string;
}

/** Tailwind padding scale translated to px (1 Tailwind unit = 4px). */
const PADDINGS: Record<CardPadding, number> = {
  none: 0,
  sm: 12, // p-3
  md: 16, // p-4
  lg: 24, // p-6
  auto: 16, // density-aware px-d-pad-x/py-d-pad-y -> md fallback on native
};

/**
 * `<Card>` — glass-surface container mirroring the web rounded-lg bordered card
 * (--surface-1 background, --text-primary text, shadow-sm). When `hover` is set
 * the resting shadow is elevated (web `hover:shadow-md` intent).
 */
export const Card = forwardRef<View, CardProps>(function Card(
  {
    padding = 'md',
    hover,
    className: _className,
    style,
    children,
    testID,
    'data-testid': dataTestID,
    ...props
  },
  ref,
) {
  return (
    <View
      ref={ref}
      style={[
        styles.root,
        hover ? styles.hover : styles.resting,
        {padding: PADDINGS[padding]},
        style,
      ]}
      testID={testID ?? dataTestID}
      {...props}>
      {children}
    </View>
  );
});

Card.displayName = 'Card';

export interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * `<CardHeader>` — title/subtitle stack with an optional trailing action,
 * mirroring the web `mb-4 flex items-center justify-between` header.
 */
export function CardHeader({
  title,
  subtitle,
  action,
  style,
  testID,
}: CardHeaderProps) {
  return (
    <View style={[styles.header, style]} testID={testID}>
      <View style={styles.headerText}>
        <AppText accessibilityRole="header" style={styles.title} weight="semibold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.subtitle} tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

CardHeader.displayName = 'CardHeader';

export interface CardFooterProps {
  children: ReactNode;
  /** Web Tailwind className. Retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * `<CardFooter>` — right-aligned action row separated by a top divider,
 * mirroring the web `mt-4 flex items-center justify-end gap-2 border-t pt-4`.
 */
export function CardFooter({
  children,
  className: _className,
  style,
  testID,
}: CardFooterProps) {
  return (
    <View style={[styles.footer, style]} testID={testID}>
      {children}
    </View>
  );
}

CardFooter.displayName = 'CardFooter';

const styles = StyleSheet.create({
  footer: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8, // gap-2
    justifyContent: 'flex-end',
    marginTop: 16, // mt-4
    paddingTop: 16, // pt-4
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16, // mb-4
  },
  headerText: {
    flexShrink: 1,
  },
  hover: {
    // web hover:shadow-md intent rendered as the resting state on native
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  resting: {
    // web shadow-sm
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  root: {
    backgroundColor: colors.surface, // --surface-1
    borderColor: colors.border, // --glass-border
    borderRadius: 8, // rounded-lg
    borderWidth: 1,
  },
  subtitle: {
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
  title: {
    fontSize: 16, // text-base
    lineHeight: 24,
  },
});
