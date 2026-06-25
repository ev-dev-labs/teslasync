// Native parity port of web/src/components/feedback/_ErrorState.tsx.
//
// Internal layout primitive shared by QueryError and ErrorDisplay. Renders the
// standard "icon + title + message + action" rose-tinted card used for every
// failure mode (404 / 401 / 5xx / network). The web source composed Tailwind
// utility classes on a <div> and rendered a lucide-react icon component; this
// port reproduces the same chrome with React Native View/AppText primitives,
// the rose alpha ramp, and a native icon-component contract -- no DOM, no
// lucide-react, no Tailwind.

import React, {type ComponentType, type ReactNode} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

/**
 * Props passed to the native icon component supplied via {@link ErrorStateProps.Icon}.
 *
 * The web source typed `Icon` as lucide-react's `LucideIcon`. React Native has
 * no lucide-react (it is a DOM/SVG-web package), so parity call sites pass a
 * native icon component that accepts the conventional `{color, size}` contract
 * shared by lucide-react-native, react-native-vector-icons, and the app's own
 * glyph components. The web rendered `<Icon className="text-rose-300 ..." />`;
 * the native equivalent receives the rose tone + pixel size explicitly.
 */
export interface ErrorStateIconProps {
  color?: string;
  size?: number;
}

export interface ErrorStateProps {
  /** Native icon component (replaces the web lucide-react `LucideIcon`). */
  Icon: ComponentType<ErrorStateIconProps>;
  title: string;
  message: string;
  action?: ReactNode;
  /** ARIA role; "status" for non-blocking offline/info states, "alert" otherwise. */
  role?: 'alert' | 'status';
  /** Matches `role`: "polite" for status, "assertive" for alert. */
  ariaLive?: 'polite' | 'assertive';
  /** Compact variant -- tighter padding for inline mutation errors. */
  compact?: boolean;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testID?: string;
  /** Test hook alias accepted by some parity callers. */
  testId?: string;
  /** DOM data-testid alias accepted by some parity callers. */
  'data-testid'?: string;
}

/**
 * Internal layout primitive shared by {@link QueryError} and {@link ErrorDisplay}.
 *
 * Renders the standard "icon + title + message + action" rose-tinted card used
 * for every failure mode (404 / 401 / 5xx / network). Centralising the chrome
 * here keeps the four branches in QueryError focused on copy + CTA while
 * ErrorDisplay can reuse the same look without duplicating styles.
 *
 * Not exported from the feedback barrel -- call sites should import the
 * pre-branched QueryError or ErrorDisplay components.
 */
export function ErrorState({
  Icon,
  title,
  message,
  action,
  role = 'alert',
  ariaLive = 'assertive',
  compact = false,
  className: _className,
  style,
  testID,
  testId,
  'data-testid': dataTestID,
}: ErrorStateProps) {
  const resolvedTestID = testID ?? testId ?? dataTestID;
  const iconSize = compact ? 14 : 16;

  return (
    <View
      accessibilityLiveRegion={ariaLive}
      accessibilityRole={role === 'alert' ? 'alert' : undefined}
      style={[
        styles.root,
        compact ? styles.rootCompact : styles.rootRegular,
        style,
      ]}
      testID={resolvedTestID}>
      <View
        style={[styles.row, compact ? styles.rowCompact : styles.rowRegular]}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[
            styles.iconBadge,
            compact ? styles.iconBadgeCompact : styles.iconBadgeRegular,
          ]}>
          <Icon color={colors.danger} size={iconSize} />
        </View>
        <View style={styles.body}>
          <AppText
            style={[
              styles.title,
              compact ? styles.titleCompact : styles.titleRegular,
            ]}>
            {title}
          </AppText>
          <AppText
            style={[
              styles.message,
              compact ? styles.messageCompact : styles.messageRegular,
            ]}>
            {message}
          </AppText>
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );
}

ErrorState.displayName = 'ErrorState';

// Card/badge translucency stops mirror the web Tailwind rose-500 ramp
// (bg-rose-500/5 card, bg-rose-500/10 badge, border-rose-500/20). The shared
// danger token (colors.danger) is the canonical rose hue used for the icon and
// title text, but the token set does not expose these exact 0.05/0.10/0.20
// alpha stops, so they are recreated from the rose-500 channels here. The
// message tone mirrors the web text-rose-300/70 (danger hue at 70%).
const ROSE_500_RGB = '244, 63, 94';
const CARD_BG = `rgba(${ROSE_500_RGB}, 0.05)`;
const CARD_BORDER = `rgba(${ROSE_500_RGB}, 0.2)`;
const BADGE_BG = `rgba(${ROSE_500_RGB}, 0.1)`;
const MESSAGE_COLOR = 'rgba(251, 113, 133, 0.7)';

const styles = StyleSheet.create({
  action: {
    flexShrink: 0,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  iconBadge: {
    backgroundColor: BADGE_BG,
    borderRadius: 8,
    flexShrink: 0,
    marginTop: 2,
  },
  iconBadgeCompact: {
    padding: 6,
  },
  iconBadgeRegular: {
    padding: spacing.sm,
  },
  message: {
    color: MESSAGE_COLOR,
    marginTop: 2,
  },
  messageCompact: {
    fontSize: 11,
    lineHeight: 15,
  },
  messageRegular: {
    fontSize: 12,
    lineHeight: 16,
  },
  root: {
    backgroundColor: CARD_BG,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    borderWidth: 1,
  },
  rootCompact: {
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  rootRegular: {
    marginBottom: 24,
    padding: 16,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  rowCompact: {
    gap: spacing.sm,
  },
  rowRegular: {
    gap: spacing.md,
  },
  title: {
    color: colors.danger,
    fontWeight: '500',
  },
  titleCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  titleRegular: {
    fontSize: 14,
    lineHeight: 20,
  },
});
