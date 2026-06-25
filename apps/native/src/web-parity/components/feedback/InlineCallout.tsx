// Native parity port of web/src/components/feedback/InlineCallout.tsx.
//
// `InlineCallout` is a single-line, low-chrome callout for surfacing one
// actionable insight inside a larger card (e.g. "1 anomaly in this range —
// Apr 24 →"). It has four severity variants (info/success/warning/danger), an
// optional leading icon, body children, and an optional action. When an action
// is supplied the whole callout becomes pressable and renders a trailing
// chevron; `href` navigates, `onClick` runs an in-app callback, and passing
// both prefers `href` — all preserved here.
//
// The web source pulls three browser/web-only modules with no native parity
// surface (rule 4/7), so a native-safe implementation is built:
//   - lucide-react `ChevronRight` SVG becomes a decorative "›" AppText glyph
//     (h-3 w-3 -> fontSize 12), flagged decorative to mirror the web
//     `aria-hidden`.
//   - the `cn` Tailwind class merger has no native analog; `className` is kept
//     on props for source compatibility but ignored (destructured as
//     `_className`) and a `style` override is added for native consumers (same
//     approach as the sibling EmptyStateThreshold / DataFreshness ports).
//   - the `<a href>` branch maps to a Pressable whose onPress calls
//     Linking.openURL (the same seam api/devtools.ts uses for window.open).
//     Internal route hrefs only resolve when a deep-link handler is registered;
//     the navigate-on-press affordance and href-over-onClick precedence are
//     preserved regardless.
//
// The Tailwind tints / CSS theme vars map to the shared native tokens:
// cyan -> colors.accent, emerald -> colors.success, amber -> colors.warning,
// rose -> colors.danger; the /5 background and /20-/25 ring opacities are kept
// as explicit rgba so the subtle tint intent survives; --text-secondary ->
// colors.textSecondary and the amber-200/85 / rose-200/85 body tints keep their
// exact values. The icon's -300 shade collapses to the matching -400 token
// (documented in the sidecar). The web `role="status"` maps to
// accessibilityLiveRegion="polite"; `testId` maps to `testID`.

import React, {type ReactNode, useCallback} from 'react';
import {
  Linking,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

export type CalloutVariant = 'info' | 'success' | 'warning' | 'danger';

const VARIANT_STYLES: Record<
  CalloutVariant,
  {bg: string; ring: string; text: string; accent: string}
> = {
  info: {
    bg: 'rgba(6, 182, 212, 0.05)',
    ring: 'rgba(34, 211, 238, 0.2)',
    text: colors.textSecondary,
    accent: colors.accent,
  },
  success: {
    bg: 'rgba(16, 185, 129, 0.05)',
    ring: 'rgba(52, 211, 153, 0.2)',
    text: colors.textSecondary,
    accent: colors.success,
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.05)',
    ring: 'rgba(251, 191, 36, 0.25)',
    text: 'rgba(253, 230, 138, 0.85)',
    accent: colors.warning,
  },
  danger: {
    bg: 'rgba(244, 63, 94, 0.05)',
    ring: 'rgba(251, 113, 133, 0.25)',
    text: 'rgba(254, 205, 211, 0.85)',
    accent: colors.danger,
  },
};

export interface InlineCalloutProps {
  /** Severity tier — drives colour. */
  variant: CalloutVariant;
  /** Leading icon (e.g. `<AlertTriangle />`). */
  icon?: ReactNode;
  /** Body text or rich children. */
  children: ReactNode;
  /**
   * Optional action — when provided, the whole callout becomes pressable
   * and renders a trailing chevron. Use `href` for navigation, `onClick`
   * for in-app actions; passing both prefers `href`.
   */
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testId?: string;
}

// Wrap raw string/number copy in the styled AppText the web `<span>` supplied;
// caller-supplied native nodes render unchanged so non-string nodes are not
// coerced or recoloured.
function renderNode(node: ReactNode, textStyle: StyleProp<TextStyle>): ReactNode {
  if (node == null || node === false) {
    return null;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return <AppText style={textStyle}>{node}</AppText>;
  }
  return node;
}

/**
 * `InlineCallout` — single-line, low-chrome callout for surfacing one
 * actionable insight inside a larger card (e.g. "1 anomaly in this
 * range — Apr 24 →"). Differs from `<AlertBanner>` which is a full
 * page-level banner with title/body/dismiss.
 *
 * Designed to live inside a section card footer: no rounded outer
 * shell, just a tinted background with subtle ring.
 */
export function InlineCallout({
  variant,
  icon,
  children,
  action,
  className: _className,
  style,
  testId,
}: InlineCalloutProps) {
  const v = VARIANT_STYLES[variant];

  const handleHrefPress = useCallback(() => {
    if (action?.href) {
      // Linking rejects on unhandled schemes / unregistered deep links; swallow
      // so a missing route handler never surfaces an unhandled rejection. The
      // navigate-on-press affordance is preserved regardless.
      Linking.openURL(action.href).catch(() => undefined);
    }
  }, [action?.href]);

  const content = (
    <>
      {icon ? (
        <View style={styles.iconWrap}>
          {renderNode(icon, [styles.iconGlyph, {color: v.accent}])}
        </View>
      ) : null}
      <View style={styles.body}>
        {renderNode(children, [styles.bodyText, {color: v.text}])}
      </View>
      {action ? (
        <View style={styles.action}>
          <AppText style={[styles.actionLabel, {color: v.accent}]}>
            {action.label}
          </AppText>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.chevron, {color: v.accent}]}>
            ›
          </AppText>
        </View>
      ) : null}
    </>
  );

  const baseStyle: StyleProp<ViewStyle> = [
    styles.base,
    {backgroundColor: v.bg, borderColor: v.ring},
    style,
  ];

  if (action?.href) {
    return (
      <Pressable
        accessibilityHint={action.label}
        accessibilityRole="link"
        onPress={handleHrefPress}
        style={({pressed}) => [...baseStyle, pressed ? styles.pressed : null]}
        testID={testId}>
        {content}
      </Pressable>
    );
  }

  if (action?.onClick) {
    return (
      <Pressable
        accessibilityHint={action.label}
        accessibilityRole="button"
        onPress={action.onClick}
        style={({pressed}) => [...baseStyle, pressed ? styles.pressed : null]}
        testID={testId}>
        {content}
      </Pressable>
    );
  }

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      style={baseStyle}
      testID={testId}>
      {content}
    </View>
  );
}

InlineCallout.displayName = 'InlineCallout';

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: 2,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  base: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: '100%',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  bodyText: {
    fontSize: 12,
    lineHeight: 16,
  },
  chevron: {
    fontSize: 12,
    lineHeight: 16,
  },
  iconGlyph: {
    fontSize: 16,
    lineHeight: 16,
  },
  iconWrap: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
});

export default InlineCallout;
