// Native parity port of web/src/components/feedback/EmptyStateThreshold.tsx.
//
// `EmptyStateThreshold` is the non-error empty state for sections that only
// become useful at scale (e.g. a cost heatmap needs >= 30 charging sessions).
// Per the /charging redesign spec it never silently hides a gated section:
// operators always see the section exists, with a green "healthy, just waiting
// for data" checkmark and a friendly "Need at least N {noun}, you have M so
// far" count message.
//
// The web source pulls three browser/web-only modules with no native parity
// surface:
//   - react-i18next `useTranslation` is absent from the native deps, so a local
//     fallback resolver returns the inline English string and interpolates the
//     {{threshold}}/{{noun}}/{{current}} tokens (same approach as the sibling
//     BrowserCompatBanner / AiLimitBanner ports). The i18n keys
//     (emptyState.threshold.*) are still referenced so intent is preserved.
//   - lucide-react `CheckCircle2` / `Info` SVG icons become AppText glyphs (a
//     check inside an emerald ring, and a muted circled-i), both flagged
//     decorative to mirror the web `aria-hidden`.
//   - the `cn` Tailwind class merger has no native analog; `className` is kept
//     on props for source compatibility but ignored, and a `style` override is
//     added for native consumers. The Tailwind tints / CSS theme vars map to the
//     shared native tokens (emerald-400 -> colors.success, --text-primary/
//     secondary/muted -> the matching token colors, --glass-border ->
//     colors.border, --surface-1/40 -> a translucent surface fill).
//
// The web `role="status"` + `aria-live="polite"` region maps to
// accessibilityLiveRegion="polite"; the `testId` hook maps to `testID`. The
// description / message / action props stay ReactNode: strings and numbers are
// wrapped in the styled AppText the web `<p>` supplied, while caller-supplied
// native nodes render as-is. The responsive `sm:` padding step has no native
// breakpoint and collapses to the base padding (documented in the sidecar).

import React, {type ReactNode, useCallback} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

export interface EmptyStateThresholdProps {
  /** How many items the user currently has. */
  currentCount: number;
  /** Minimum items required for the section to become useful. */
  threshold: number;
  /**
   * Short noun label for the *items* (e.g. "sessions", "drives", "trips").
   * Used to compose the default "Need at least N {label}..." message.
   */
  itemNoun?: string;
  /**
   * Short label for the section being gated (e.g. "Cost Heatmap",
   * "Optimizer recommendations"). Rendered as the title.
   */
  sectionLabel: string;
  /** Optional one-line description below the title. */
  description?: ReactNode;
  /**
   * Override the auto-generated message. Use when default phrasing
   * doesn't fit (e.g. when threshold isn't a simple count).
   */
  message?: ReactNode;
  /** Optional CTA below the message (e.g. "Adjust filters"). */
  action?: ReactNode;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testId?: string;
}

// react-i18next has no native parity module; translations resolve to their
// inline English fallback with {{token}} interpolation, matching the sibling
// feedback ports.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      return Object.entries(options).reduce(
        (text, [token, value]) =>
          text.split(`{{${token}}}`).join(String(value)),
        fallback,
      );
    },
    [],
  );
}

// Wrap raw string/number copy in the styled AppText the web `<p>` supplied;
// caller-supplied native nodes render unchanged.
function renderCopy(
  node: ReactNode,
  textStyle: StyleProp<TextStyle>,
  tone: 'secondary' | 'muted',
): ReactNode {
  if (node == null || node === false) {
    return null;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return (
      <AppText style={textStyle} tone={tone}>
        {node}
      </AppText>
    );
  }
  return node;
}

/**
 * `EmptyStateThreshold` -- non-error empty state for sections that become
 * useful only at scale (e.g. heatmap needs >= 30 sessions). Rendered with a
 * green checkmark (the section is *healthy*, just waiting for more data) and a
 * friendly count message. Per the /charging redesign spec: never silently hide
 * a section -- operators should see it exists and know what unlocks it.
 *
 * Default copy:
 *   "Need at least N {itemNoun} to show meaningful patterns. You have M so far."
 */
export function EmptyStateThreshold({
  currentCount,
  threshold,
  itemNoun,
  sectionLabel,
  description,
  message,
  action,
  className: _className,
  style,
  testId,
}: EmptyStateThresholdProps) {
  const t = useNativeTranslationFallback();
  const noun = itemNoun ?? t('emptyState.threshold.defaultItem', 'items');

  const defaultMessage = t(
    'emptyState.threshold.message',
    'Need at least {{threshold}} {{noun}} to show meaningful patterns. You have {{current}} so far.',
    {threshold, noun, current: currentCount},
  );

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.card, style]}
      testID={testId}>
      <View style={styles.row}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.checkBadge}>
          <AppText style={styles.checkGlyph} weight="bold">
            ✓
          </AppText>
        </View>
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <AppText style={styles.title} weight="semibold">
              {sectionLabel}
            </AppText>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.infoGlyph}>
              ⓘ
            </AppText>
          </View>
          {renderCopy(description, styles.description, 'secondary')}
          {renderCopy(message ?? defaultMessage, styles.message, 'muted')}
          {action ? <View style={styles.action}>{action}</View> : null}
        </View>
      </View>
    </View>
  );
}

EmptyStateThreshold.displayName = 'EmptyStateThreshold';

const styles = StyleSheet.create({
  action: {
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: 'rgba(12, 18, 31, 0.4)',
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
  },
  checkBadge: {
    alignItems: 'center',
    borderColor: colors.successBorder,
    borderRadius: 10,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  checkGlyph: {
    color: colors.success,
    fontSize: 12,
    lineHeight: 16,
  },
  content: {
    flex: 1,
  },
  description: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  infoGlyph: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  message: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
});

export default EmptyStateThreshold;
