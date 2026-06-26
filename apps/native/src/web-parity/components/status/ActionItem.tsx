// Native parity port of web/src/components/status/ActionItem.tsx.
//
// A single operator-task row used inside ActionItemsPanel: a severity-coloured
// icon, a title + optional sub-line, and an optional right-aligned CTA. The web
// component carries no i18n and no data fetching — every string (title,
// description, cta.label) is supplied by the caller — so the port is a pure
// presentational mapping. Three web dependencies are NOT in the native parity
// manifest and are replaced with native-safe equivalents documented here:
//
//   - lucide-react icons (web L11): Info / AlertTriangle / AlertCircle drive the
//     per-severity leading icon, and ChevronRight is the CTA affordance. None
//     exist in the native tree, so — mirroring the established SeverityBadge
//     port — each becomes a small severity-tinted inline glyph rendered through
//     AppText (info -> 'ℹ', warn -> '⚠', error -> '⛔', chevron -> '›'). The
//     web `aria-hidden` decorative icon maps to RN accessibility-hidden flags.
//
//   - react-router-dom `Link` + raw `<a target="_blank">` (web L10, L70, L77):
//     the native web-parity tree has no in-app router and no DOM anchor, so both
//     the internal route (`<Link to>`) and the external link
//     (`<a href target=_blank rel=noopener>`) collapse onto the same best-effort
//     platform URL handler via `Linking.openURL` (the same `useNativeHrefNavigation`
//     pattern QueryError uses). On native there is no separate browser-tab vs
//     in-app-route transport, so `cta.external` carries no behavioural
//     distinction; it is preserved on the prop type for caller/source parity and
//     surfaced only via the `link` accessibility role. Unresolvable route
//     strings are swallowed so a failed navigation never crashes the row.
//
//   - `@/lib/cn` (web L12) class-merge helper: there are no className strings on
//     native, so `cn` is dropped in favour of StyleSheet + style arrays. Every
//     Tailwind class is reproduced as a token-driven style (severity surface /
//     border / foreground from theme tokens; ring-1 -> 1px border; rounded-lg /
//     rounded-md radii; p-3 / gap-3 / px-3 / py-1.5 / min-h-[36px] spacing;
//     text-sm / text-xs / font-medium typography). The web `var(--text-primary)`
//     / `var(--text-secondary)` CSS vars become the textPrimary / textSecondary
//     tokens, and the hover:bg-[var(--surface-2)] / focus-visible ring states
//     become a Pressable pressed-surface treatment.
//
// The `description` prop is a ReactNode in both worlds: string/number content is
// wrapped in the secondary-text AppText so the small muted styling still
// applies, while a supplied React element renders as-is in a styled container.
// The web `{description && ...}` short-circuit becomes an explicit truthiness
// guard so a falsy node never renders a bare value outside a Text node.

import React, {useCallback, type ReactNode} from 'react';
import {Linking, Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

export type ActionSeverity = 'info' | 'warn' | 'error';

interface SeverityVisual {
  /** Inline glyph standing in for the web lucide severity icon. */
  glyph: string;
  /** Foreground tint applied to the icon + CTA label. */
  fg: string;
  /** Severity surface fill behind the whole row. */
  bg: string;
  /** Severity ring/border colour (web `ring-1`). */
  border: string;
}

const SEVERITY_CFG: Record<ActionSeverity, SeverityVisual> = {
  info: {
    glyph: 'ℹ',
    fg: colors.accent,
    bg: colors.surfaceSelected,
    border: colors.borderAccent,
  },
  warn: {
    glyph: '⚠',
    fg: colors.warning,
    bg: colors.warningSurface,
    border: colors.warningBorder,
  },
  error: {
    glyph: '⛔',
    fg: colors.danger,
    bg: colors.dangerSurface,
    border: colors.dangerBorder,
  },
};

export interface ActionItemProps {
  severity: ActionSeverity;
  title: string;
  /** Sub-line beneath the title (e.g. "v1.2.0 → v1.3.0"). */
  description?: ReactNode;
  /** CTA: either a route via `to` or a press handler. Renders right-aligned. */
  cta?: {label: string; to?: string; external?: boolean; onClick?: () => void};
  testID?: string;
}

// ---------------------------------------------------------------------------
// useNativeHrefNavigation — native-safe replacement for react-router-dom Link /
// raw <a href>. The native web-parity tree has no in-app router, so web route
// strings are handed to the platform URL handler on a best-effort basis.
// Unresolvable routes are swallowed so a failed navigation never crashes the row.
// ---------------------------------------------------------------------------

function useNativeHrefNavigation(): (href: string) => void {
  return useCallback((href: string) => {
    Promise.resolve()
      .then(() => Linking.openURL(href))
      .catch(() => undefined);
  }, []);
}

export function ActionItem({
  severity,
  title,
  description,
  cta,
  testID,
}: ActionItemProps): React.ReactElement {
  const cfg = SEVERITY_CFG[severity];

  return (
    <View
      style={[styles.row, {backgroundColor: cfg.bg, borderColor: cfg.border}]}
      testID={testID}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.icon, {color: cfg.fg}]}>
        {cfg.glyph}
      </AppText>

      <View style={styles.body}>
        <AppText style={styles.title}>{title}</AppText>
        {description
          ? typeof description === 'string' || typeof description === 'number'
            ? (
              <AppText style={styles.description}>{description}</AppText>
            )
            : (
              <View style={styles.descriptionNode}>{description}</View>
            )
          : null}
      </View>

      {cta ? <ActionCTA cta={cta} severityColor={cfg.fg} /> : null}
    </View>
  );
}

function ActionCTA({
  cta,
  severityColor,
}: {
  cta: NonNullable<ActionItemProps['cta']>;
  severityColor: string;
}): React.ReactElement | null {
  const navigate = useNativeHrefNavigation();

  const handlePress = useCallback(() => {
    if (cta.to) {
      navigate(cta.to);
      return;
    }
    cta.onClick?.();
  }, [cta, navigate]);

  // Web renders nothing when there is neither a route nor a click handler.
  if (!cta.to && !cta.onClick) {
    return null;
  }

  return (
    <Pressable
      accessibilityLabel={cta.label}
      accessibilityRole={cta.to ? 'link' : 'button'}
      onPress={handlePress}
      style={({pressed}) => [styles.cta, pressed && styles.ctaPressed]}
      testID="action-item-cta">
      <AppText style={[styles.ctaLabel, {color: severityColor}]}>
        {cta.label}
      </AppText>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.ctaChevron, {color: severityColor}]}>
        ›
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: 2,
  },
  cta: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 6,
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  ctaChevron: {
    fontSize: 13,
    lineHeight: 16,
  },
  ctaLabel: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  ctaPressed: {
    backgroundColor: colors.surfaceHover,
  },
  description: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  descriptionNode: {
    marginTop: 2,
  },
  icon: {
    fontSize: 16,
    lineHeight: 20,
    marginTop: 2,
  },
  row: {
    alignItems: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
});

export default ActionItem;
