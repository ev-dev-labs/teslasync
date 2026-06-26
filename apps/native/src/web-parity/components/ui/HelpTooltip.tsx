// Native parity port of web/src/components/ui/HelpTooltip.tsx.
//
// Compact "?" affordance that reveals an explanatory tooltip next to non-obvious
// metric titles, settings labels, or advanced concepts (e.g. "Vampire Drain").
//
// On web the trigger composes the shared <Tooltip>, inheriting hover / focus /
// tap reveal, ARIA wiring (role="tooltip" + aria-describedby on the trigger),
// keyboard focus, placement, and prefers-reduced-motion handling. React Native
// has no DOM hover/focus, no <button>/<div>/<a>/<p>, no lucide SVGs, no @/lib/cn
// Tailwind merge, no react-i18next, and (yet) no shared native <Tooltip>
// primitive, so this port reproduces the same contract natively:
//   - The trigger is a <Pressable accessibilityRole="button"> carrying the
//     accessibilityLabel (web aria-label / translated "More info" fallback) and
//     accessibilityState={{expanded}} so screen readers announce the popover
//     state. The default icon is a small "?" glyph inside a hairline circle
//     (lucide HelpCircle parity), sized by the xs/sm/md prop; a `children`
//     override icon is honored verbatim.
//   - Tap toggles a transparent fade <Modal> popover (the established native
//     popover idiom — see DataTableColumnsMenu) showing the resolved body text
//     and the optional "Learn more" link. Touch has no :hover / :focus-within,
//     so tap-to-reveal replaces the web hover/focus/tap behavior; tapping the
//     backdrop or pressing platform back dismisses it (web blur-to-dismiss
//     parity).
//   - "Learn more" opens the url via Linking.openURL (web target="_blank"
//     new-tab) and is trailed by a "\u2197" external-link glyph (lucide
//     ExternalLink parity).
//
// Native-safe adaptations (documented in the sidecar):
//   - react-i18next is not wired in native, so useTranslation()'s `t` is replaced
//     by the established useNativeTranslationFallback helper, which returns the
//     English defaultValue. The i18n keys/copy (help.tooltip.iconLabel,
//     common.learnMore) and the i18nKey/defaultValue/text resolution precedence
//     are preserved verbatim, including the "render nothing when empty" guard.
//   - `placement` is retained for source compatibility and used best-effort to
//     bias the popover toward the top / bottom / center of the screen; native
//     modals cannot anchor an edge bubble to an inline trigger, so left/right
//     fall back to centered.
//   - Tailwind utility classes + CSS custom properties become StyleSheet styles
//     against theme tokens. The optional web `className` is accepted-but-ignored
//     for source compatibility and mirrored by a native `style` override on the
//     trigger; web hover/focus color shifts have no native analog and are
//     represented by a press-opacity affordance instead.

import React, {useCallback, useState, type ReactNode} from 'react';
import {
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';

export interface HelpTooltipProps {
  /** Plain text content (use `i18nKey` instead when localising). */
  text?: string;
  /** i18n key to translate. Pair with `defaultValue` for the English fallback. */
  i18nKey?: string;
  /** Fallback used when `i18nKey` is missing from the translation bundle. */
  defaultValue?: string;
  /** Tooltip placement relative to the trigger (best-effort on native). */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Optional "Learn more" link rendered below the body. Opens externally. */
  learnMore?: {url: string; label?: string};
  /** Trigger icon size. */
  size?: 'xs' | 'sm' | 'md';
  /** Override the trigger icon (defaults to a "?" help glyph). */
  children?: ReactNode;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for the trigger (RN equivalent of `className`). */
  style?: StyleProp<ViewStyle>;
  /**
   * Accessible label for the trigger. Defaults to a translated "More info"
   * string; override when the surrounding context already names the tooltip
   * subject (e.g. "More info about vampire drain").
   */
  ariaLabel?: string;
  testID?: string;
}

type NativeTFunction = (key: string, fallback: string) => string;

/**
 * Native i18n fallback: react-i18next is not wired in native, so this returns
 * the English defaultValue — preserving the web i18n keys and copy verbatim.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// lucide HelpCircle / ExternalLink affordances rendered as text glyphs.
const EXTERNAL_LINK_GLYPH = '\u2197'; // ↗ — "opens externally" affordance.

// Trigger icon dimensions resolved from the web SIZE_CLASS map (lucide HelpCircle
// h-3/h-3.5/h-4 -> 12/14/16dp), padded by the surrounding ring so the "?" fits.
const SIZES = {
  xs: {circle: 14, glyph: 9},
  sm: {circle: 16, glyph: 10},
  md: {circle: 18, glyph: 12},
} as const;

// Literal resolution of the web bg-gray-900 inverted tooltip surface mapped onto
// the native popover palette: surface fill + faint white hairline border.
const HAIRLINE = 'rgba(255, 255, 255, 0.08)';

/**
 * Compact "?" help affordance that reveals an explanatory tooltip.
 *
 * Mirrors the web shared <HelpTooltip>: it resolves its body from `text` or an
 * `i18nKey` (+ `defaultValue` fallback), renders nothing when no content is
 * supplied, and exposes the same placement / learnMore / size / icon-override
 * API. Feature screens should import this component instead of building their
 * own help affordance.
 */
export function HelpTooltip({
  text,
  i18nKey,
  defaultValue,
  placement = 'top',
  learnMore,
  size = 'sm',
  children,
  className: _className,
  style,
  ariaLabel,
  testID,
}: HelpTooltipProps) {
  const t = useNativeTranslationFallback();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const toggleOpen = useCallback(() => setOpen(value => !value), []);

  const openLearnMore = useCallback(() => {
    const url = learnMore?.url;
    if (!url) {
      return;
    }
    // Mirror the web target="_blank" new-tab open. Swallow rejection so a
    // missing URL handler never crashes the tooltip, then dismiss the popover
    // since the OS browser takes focus on native (web parity: tab switches away).
    Linking.openURL(url).then(close, () => undefined);
  }, [learnMore, close]);

  const resolved = i18nKey
    ? t(i18nKey, defaultValue ?? '')
    : text ?? '';

  // Render nothing when no content is supplied — keeps consumers from having to
  // gate the tooltip themselves (matches the web early return).
  if (!resolved) {
    return null;
  }

  const dims = SIZES[size];
  const label = ariaLabel ?? t('help.tooltip.iconLabel', 'More info');

  // Best-effort placement: bias the centered popover toward the requested edge.
  const verticalAlign: ViewStyle['justifyContent'] =
    placement === 'top'
      ? 'flex-start'
      : placement === 'bottom'
        ? 'flex-end'
        : 'center';

  return (
    <>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        hitSlop={8}
        onPress={toggleOpen}
        style={({pressed}) => [
          styles.trigger,
          pressed && styles.triggerPressed,
          style,
        ]}
        testID={testID}>
        {children ?? (
          <View
            style={[
              styles.iconCircle,
              {
                width: dims.circle,
                height: dims.circle,
                borderRadius: dims.circle / 2,
              },
            ]}>
            <AppText
              accessible={false}
              allowFontScaling={false}
              style={[
                styles.iconGlyph,
                {fontSize: dims.glyph, lineHeight: dims.circle},
              ]}>
              ?
            </AppText>
          </View>
        )}
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={close}
        transparent
        visible={open}>
        <View style={[styles.overlay, {justifyContent: verticalAlign}]}>
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="button"
            onPress={close}
            style={styles.backdrop}
          />
          <View
            accessibilityLiveRegion="polite"
            style={styles.card}
            testID={testID ? `${testID}-popover` : undefined}>
            <AppText style={styles.body}>{resolved}</AppText>
            {learnMore ? (
              <Pressable
                accessibilityRole="link"
                hitSlop={8}
                onPress={openLearnMore}
                style={({pressed}) => [
                  styles.learnMore,
                  pressed && styles.learnMorePressed,
                ]}>
                <AppText style={styles.learnMoreText}>
                  {learnMore.label ?? t('common.learnMore', 'Learn more')}
                </AppText>
                <AppText
                  accessible={false}
                  allowFontScaling={false}
                  style={styles.learnMoreGlyph}>
                  {EXTERNAL_LINK_GLYPH}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

HelpTooltip.displayName = 'HelpTooltip';

const styles = StyleSheet.create({
  // inline-flex items-center justify-center align-middle rounded-full trigger
  trigger: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  // Press affordance standing in for the web hover/focus color shift.
  triggerPressed: {
    opacity: 0.7,
  },
  // text-[var(--text-muted)] "?" inside a lucide HelpCircle-style ring.
  iconCircle: {
    alignItems: 'center',
    borderColor: colors.textMuted,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  iconGlyph: {
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: 'center',
  },
  // Full-screen modal layer; placement biases the popover vertically.
  overlay: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  // Inverted web tooltip card (max-w-[260px] rounded-lg px-2.5 py-1.5).
  card: {
    ...shadows.panel,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: HAIRLINE,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 260,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // text-2xs leading-snug text-[var(--text-primary)] body copy.
  body: {
    color: colors.textPrimary,
    fontSize: 11,
    lineHeight: 15,
  },
  // pointer-events-auto mt-1 inline-flex items-center gap-1 "Learn more" link.
  learnMore: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: spacing.xs,
  },
  learnMorePressed: {
    opacity: 0.7,
  },
  // text-[var(--text-secondary)] underline link label.
  learnMoreText: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    textDecorationLine: 'underline',
  },
  learnMoreGlyph: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 15,
  },
});

export default HelpTooltip;
