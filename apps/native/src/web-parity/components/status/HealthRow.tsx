// Native parity port of web/src/components/status/HealthRow.tsx.
//
// `HealthRow` is a single-line health summary row: a status-coloured dot, an
// optional leading icon, a label, a right-aligned summary (e.g. "12 / 12
// healthy"), and — when interactive — a trailing chevron. Status drives the dot
// and summary colour. Stacks of these form a high-density at-a-glance health
// grid inside a panel. Three render shapes are preserved exactly:
//   - `to` present  -> pressable link (Linking.openURL), with `external`
//     branching kept so the prop is honoured (on native the OS decides how a
//     URL opens, so both branches resolve through Linking — documented below).
//   - `onClick` only -> pressable button.
//   - neither        -> static, non-interactive row.
//
// The web source pulls four browser/web-only modules with no native parity
// surface (rule 4/7), so a native-safe implementation is built:
//   - react-router-dom `<Link to>` and the `<a href target rel>` element have no
//     native analog; both map to a Pressable whose onPress calls
//     Linking.openURL(to) — the same seam the sibling InlineCallout port uses.
//     Internal SPA route strings only resolve when a deep-link handler is
//     registered; the navigate-on-press affordance is preserved regardless.
//   - lucide-react `ChevronRight` (SVG) becomes a decorative "\u203a" AppText
//     glyph (h-4 w-4 -> fontSize 16), flagged decorative to mirror aria-hidden.
//   - the `cn` Tailwind class merger has no native analog; React Native has no
//     className, so styling moves to StyleSheet and a `style` override is added
//     for native consumers (same approach as the sibling feedback ports).
//   - `HeroStatus` is imported from ./StatusHero on web; that sibling has no
//     native port yet, so the union is defined and re-exported here so this
//     file stays self-contained and type-safe (documented in the sidecar).
//
// Visual intent: the StatusHero green/amber/red/zinc/blue-400 dot + summary
// tints are kept as their exact Tailwind hex literals; --text-primary ->
// colors.textPrimary (label), --text-secondary -> colors.textSecondary (icon),
// --text-muted -> colors.textMuted (chevron). The hover:bg-white/[0.04] + focus
// ring collapse into a Pressable pressed style; the min-h-[44px] tap target is
// preserved. The web aria-label `${label} — ${summary}` maps to
// accessibilityLabel; the static <div> maps to an accessible View.

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

// Mirrors the union exported by web/src/components/status/StatusHero.tsx, which
// the web HealthRow imports as a type. The native StatusHero is not ported yet,
// so the union is owned here and re-exported for downstream native consumers.
export type HeroStatus =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'unknown'
  | 'maintenance';

// Exact Tailwind *-400 hex for the status dot (web bg-*-400).
const DOT_FOR_STATUS: Record<HeroStatus, string> = {
  healthy: '#4ade80', // bg-green-400
  degraded: '#fbbf24', // bg-amber-400
  unhealthy: '#f87171', // bg-red-400
  unknown: '#a1a1aa', // bg-zinc-400
  maintenance: '#60a5fa', // bg-blue-400
};

// Exact Tailwind *-400 hex for the summary text (web text-*-400).
const TEXT_FOR_STATUS: Record<HeroStatus, string> = {
  healthy: '#4ade80', // text-green-400
  degraded: '#fbbf24', // text-amber-400
  unhealthy: '#f87171', // text-red-400
  unknown: '#a1a1aa', // text-zinc-400
  maintenance: '#60a5fa', // text-blue-400
};

export interface HealthRowProps {
  status: HeroStatus;
  icon?: ReactNode;
  label: string;
  /** Right-aligned summary (e.g. "12 / 12 healthy" or "0 vehicles · idle"). */
  summary: string;
  /** Optional "View" link target. */
  to?: string;
  /** External target — opens via the OS. Ignored if `to` is omitted. */
  external?: boolean;
  /** Press handler when no link is provided. */
  onClick?: () => void;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testID?: string;
}

// Wrap raw string/number icon copy in the styled AppText the web icon <span>
// supplied; caller-supplied native nodes (e.g. a vector icon) pass through
// unchanged so they are not coerced or recoloured.
function renderIcon(node: ReactNode, textStyle: StyleProp<TextStyle>): ReactNode {
  if (node == null || node === false) {
    return null;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return <AppText style={textStyle}>{node}</AppText>;
  }
  return node;
}

/**
 * `HealthRow` — single-line health summary row. Renders a status-coloured dot,
 * an optional icon, a label, a summary, and a trailing chevron when
 * interactive. Use stacks of these inside a panel as a high-density
 * at-a-glance health grid.
 */
export function HealthRow({
  status,
  icon,
  label,
  summary,
  to,
  external = false,
  onClick,
  style,
  testID,
}: HealthRowProps) {
  const dotColor = DOT_FOR_STATUS[status];
  const summaryColor = TEXT_FOR_STATUS[status];
  const interactive = Boolean(to || onClick);

  const handleLinkPress = useCallback(() => {
    if (to) {
      // Linking rejects on unhandled schemes / unregistered deep links; swallow
      // so a missing route handler never surfaces an unhandled rejection. The
      // navigate-on-press affordance is preserved regardless.
      Linking.openURL(to).catch(() => undefined);
    }
  }, [to]);

  const inner = (
    <>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.dot, {backgroundColor: dotColor}]}
      />
      {icon ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.iconWrap}>
          {renderIcon(icon, styles.iconGlyph)}
        </View>
      ) : null}
      <AppText numberOfLines={1} style={styles.label}>
        {label}
      </AppText>
      <AppText style={[styles.summary, {color: summaryColor}]}>
        {summary}
      </AppText>
      {interactive ? (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.chevron}>
          {'\u203a'}
        </AppText>
      ) : null}
    </>
  );

  const baseStyle: StyleProp<ViewStyle> = [styles.base, style];
  const accessibilityLabel = `${label} \u2014 ${summary}`;

  if (to) {
    if (external) {
      return (
        <Pressable
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="link"
          onPress={handleLinkPress}
          style={({pressed}) => [
            ...(baseStyle as ViewStyle[]),
            pressed ? styles.pressed : null,
          ]}
          testID={testID}>
          {inner}
        </Pressable>
      );
    }
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="link"
        onPress={handleLinkPress}
        style={({pressed}) => [
          ...(baseStyle as ViewStyle[]),
          pressed ? styles.pressed : null,
        ]}
        testID={testID}>
        {inner}
      </Pressable>
    );
  }

  if (onClick) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onClick}
        style={({pressed}) => [
          ...(baseStyle as ViewStyle[]),
          pressed ? styles.pressed : null,
        ]}
        testID={testID}>
        {inner}
      </Pressable>
    );
  }

  return (
    <View accessibilityRole="text" style={baseStyle} testID={testID}>
      {inner}
    </View>
  );
}

HealthRow.displayName = 'HealthRow';

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    width: '100%',
  },
  chevron: {
    color: colors.textMuted,
    flexShrink: 0,
    fontSize: 16,
    lineHeight: 16,
  },
  dot: {
    borderRadius: 5,
    flexShrink: 0,
    height: 10,
    width: 10,
  },
  iconGlyph: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 16,
  },
  iconWrap: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
  },
  label: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    minWidth: 0,
    textAlign: 'left',
  },
  pressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  summary: {
    flexShrink: 0,
    fontSize: 12,
    lineHeight: 16,
  },
});

export default HealthRow;
