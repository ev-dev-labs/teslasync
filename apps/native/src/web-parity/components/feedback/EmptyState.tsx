// Native parity port of web/src/components/feedback/EmptyState.tsx.
//
// Replaces the DOM <div role="status">, the `cn()` Tailwind class composer, the
// shared <Heading level="panel">/<Text variant="bodySm"> typography, the
// secondary/sm CTA <Button>, and the react-router-dom <Link> with React Native
// primitives (View/Pressable/AppText), native theme tokens, and a navigation
// callback. The web `linkButtonClasses` (secondary/sm CTA mirror) and the
// canonical Button secondary/sm variant collapse to a single native
// `secondaryButton` style so both `action` and `actionTo` stay visually
// lock-step, exactly as the source intends.
//
// Visual intent preserved: centered column with generous vertical padding
// (py-16), muted icon slot (mb-4), panel-title heading (base/semibold/primary,
// mb-1), small secondary body copy capped at max-w-md (mb-4), then the CTA.
//
// react-router-dom has no native analog; the web <Link to> navigation intent is
// preserved via an optional `onNavigate(to)` callback that fires with
// `actionTo.to`. The `actionTo` path string is carried through verbatim. The
// DOM-only `className` prop is replaced by native-friendly `style` / `testID`.

import React, {type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

export interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  message: string;
  /** Imperative action — runs on press (mutates state, opens modal, etc.). */
  action?: {label: string; onPress: () => void};
  /** Navigation action — preferred when the CTA just goes somewhere. Takes priority over `action`. */
  actionTo?: {label: string; to: string};
  /**
   * Native navigation hook replacing react-router-dom's <Link>. Receives
   * `actionTo.to` when the navigation CTA is pressed. No-op if unwired.
   */
  onNavigate?: (to: string) => void;
  /** Native composition hook replacing the web `className`. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * EmptyState — centered "no data / nothing here yet" placeholder with an
 * optional icon, title, required message, and an optional CTA. The CTA is
 * either a navigation action (`actionTo`, preferred) or an imperative action
 * (`action`); `actionTo` wins when both are supplied, matching the source.
 */
export function EmptyState({
  icon,
  title,
  message,
  action,
  actionTo,
  onNavigate,
  style,
  testID,
}: EmptyStateProps) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.container, style]}
      testID={testID ?? 'empty-state'}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      {title ? (
        <AppText style={styles.title} weight="semibold">
          {title}
        </AppText>
      ) : null}
      <AppText style={styles.message} tone="secondary" variant="caption">
        {message}
      </AppText>
      {actionTo ? (
        <Pressable
          accessibilityLabel={actionTo.label}
          accessibilityRole="link"
          onPress={() => onNavigate?.(actionTo.to)}
          style={({pressed}) => [
            styles.secondaryButton,
            pressed && styles.secondaryButtonPressed,
          ]}
          testID="empty-state-action">
          <AppText style={styles.secondaryButtonText} weight="semibold">
            {actionTo.label}
          </AppText>
        </Pressable>
      ) : action ? (
        <Pressable
          accessibilityLabel={action.label}
          accessibilityRole="button"
          onPress={action.onPress}
          style={({pressed}) => [
            styles.secondaryButton,
            pressed && styles.secondaryButtonPressed,
          ]}
          testID="empty-state-action">
          <AppText style={styles.secondaryButtonText} weight="semibold">
            {action.label}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

EmptyState.displayName = 'EmptyState';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'column',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  icon: {
    marginBottom: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  message: {
    marginBottom: spacing.md,
    maxWidth: 448,
    textAlign: 'center',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secondaryButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
  },
});
