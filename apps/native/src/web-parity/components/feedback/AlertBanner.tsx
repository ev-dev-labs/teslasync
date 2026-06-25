// Native parity port of web/src/components/feedback/AlertBanner.tsx.
//
// Replaces the DOM <div>/<p>/<button>, the lucide-react <X /> close icon, the
// `cn()` Tailwind class composer, and the neon-token class map with React
// Native primitives (View/Pressable/AppText), native theme tokens, and a
// text-glyph close affordance. The native app ships no lucide-react / SVG icon
// set, so the canonical "✕" glyph stands in for the Lucide X icon. The
// variant -> color mapping preserves the web intent: info=cyan/accent,
// success=green, warning=amber, danger=red, with the title/icon at full color
// and the body text + close glyph at the softer (~80% opacity) tone.
//
// DOM-only spread props from `HTMLAttributes<HTMLDivElement>` (e.g. className,
// id, data-*) have no native analog; the native API instead exposes `style`
// and `testID` for composition, documented in the parity sidecar.

import React, {type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

export type AlertBannerVariant = 'info' | 'success' | 'warning' | 'danger';

export interface AlertBannerProps {
  variant: AlertBannerVariant;
  title?: string;
  children: ReactNode;
  onClose?: () => void;
  icon?: ReactNode;
  /** Native composition hook replacing the web `className` / DOM spread props. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * AlertBanner — persistent, page-level inline notification (info / success /
 * warning / danger).
 *
 * Use AlertBanner for messages that should remain on screen until either the
 * underlying condition resolves or the user dismisses them — e.g. "Tesla
 * connection expired — reconnect", "Vehicle is offline", "Beta feature".
 *
 * For transient feedback after a user-initiated mutation (saved settings,
 * deleted rule, sent test alert, …), use the toast system instead. Toasts
 * auto-dismiss and stack; AlertBanners stay rendered in-flow.
 *
 * For "the live data pipe has been down for >2 minutes", do not roll your own
 * AlertBanner — drop in the LiveStaleDataBanner parity component, which wraps
 * AlertBanner with the right copy, threshold, and live-connection wiring.
 */
export function AlertBanner({
  variant,
  title,
  children,
  onClose,
  icon,
  style,
  testID,
}: AlertBannerProps) {
  const fg = textColorStyles[variant];
  const isTextChild =
    typeof children === 'string' || typeof children === 'number';

  return (
    <View
      style={[styles.container, variantStyles[variant], style]}
      testID={testID ?? 'alert-banner'}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <View style={styles.body}>
        {title ? (
          <AppText style={[styles.title, fg]} weight="semibold">
            {title}
          </AppText>
        ) : null}
        {isTextChild ? (
          <AppText style={[styles.bodyText, fg, title ? styles.bodySpaced : null]}>
            {children}
          </AppText>
        ) : (
          <View style={title ? styles.bodySpaced : undefined}>{children}</View>
        )}
      </View>
      {onClose ? (
        <Pressable
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
          onPress={onClose}
          style={({pressed}) => [styles.closeButton, pressed && styles.pressed]}
          testID="alert-banner-close">
          <AppText style={[styles.closeGlyph, fg]} weight="bold">
            {'\u2715'}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

AlertBanner.displayName = 'AlertBanner';

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  bodySpaced: {
    marginTop: 2,
  },
  bodyText: {
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.8,
  },
  closeButton: {
    borderRadius: 8,
    marginTop: -2,
    padding: 6,
  },
  closeGlyph: {
    fontSize: 14,
    lineHeight: 14,
    opacity: 0.8,
  },
  container: {
    alignItems: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: 16,
  },
  icon: {
    marginTop: 2,
  },
  pressed: {
    opacity: 0.6,
  },
  title: {
    fontSize: 14,
    lineHeight: 18,
  },
});

const variantStyles = StyleSheet.create<Record<AlertBannerVariant, ViewStyle>>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const textColorStyles = StyleSheet.create<Record<AlertBannerVariant, TextStyle>>(
  {
    danger: {
      color: colors.danger,
    },
    info: {
      color: colors.accent,
    },
    success: {
      color: colors.success,
    },
    warning: {
      color: colors.warning,
    },
  },
);
