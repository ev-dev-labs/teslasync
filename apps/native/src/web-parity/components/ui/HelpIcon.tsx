// Native parity port of web/src/components/ui/HelpIcon.tsx.
//
// The web module is the field-level `(?)` help primitive: a tiny HelpCircle
// icon button placed next to a form <Label> that, on hover / focus / tap,
// reveals explanatory help text through the shared <Tooltip>. Behavior, prop
// names (`i18nKey`, `content`, `for`, `side`, `ariaLabel`, `className`), the
// "render nothing when there is no help text" short-circuit (L67-69), and the
// i18n keys/intent (`a11y.helpFor` with the {{field}} variable, falling back to
// `help.tooltip.iconLabel`) are all preserved.
//
// DOM/web-only pieces and their native mappings:
//   - `lucide-react`'s <HelpCircle> (L3, L101) has no native package here; the
//     glyph is reproduced as a "?" inside a rounded-full bordered <View>,
//     matching the web button's h-4 w-4 rounded-full + inner h-3.5 icon intent.
//   - `react-i18next` (L2, L64) is not installed on native; `useTranslation().t`
//     is replaced by a local `translate(key, options)` shim that honors the same
//     `{ defaultValue, ...vars }` contract and performs `{{var}}` interpolation,
//     preserving every i18n key + default string as intent.
//   - The shared web `<Tooltip>` (L6, L86) is not yet ported to native and relies
//     on CSS `:hover` / `:focus-within` reveal, which do not exist on touch RN.
//     A native-safe inline tooltip is provided instead: tapping the trigger
//     toggles a high-contrast floating bubble (the web inverted-surface contract
//     — light card + dark text against the dark native theme), honoring `side`
//     placement and the hardcoded `multiline` wrapping (max-w-[260px]).
//   - The web `onKeyDown` Escape->blur dismissal (L77-83, L92) is a browser
//     keyboard affordance with no RN analog; native dismissal is reproduced by
//     tapping the trigger again (toggle off). The `cn` class merge helper (L5,
//     L93-99), the `aria-describedby` / `data-help-for` DOM hooks (L90-91), and
//     hover / focus-visible ring affordances are dropped or mapped to RN
//     accessibility props (accessibilityLabel, accessibilityState, nativeID).
//     `className` is accepted-but-ignored for source compatibility. See the
//     .parity.json sidecar for the line-by-line map.

import React, {useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

// --- Local i18n shim: preserves the web `t(key, { defaultValue, ...vars })`
// contract and `{{var}}` interpolation without react-i18next (not installed on
// native). ---

type TranslateOptions = {defaultValue?: string} & Record<
  string,
  string | number
>;

function translate(_key: string, options?: TranslateOptions): string {
  const fallback = options?.defaultValue ?? '';
  if (!options) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name !== 'defaultValue' &&
    Object.prototype.hasOwnProperty.call(options, name)
      ? String(options[name])
      : match,
  );
}

type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface HelpIconProps {
  /** i18n key for the help text (preferred over plain `content`). */
  i18nKey?: string;
  /** Default fallback when key is missing or for one-offs. */
  content?: string;
  /**
   * Used to attach the helper to a labelled control: id of the field. Surfaces
   * in the trigger's accessibility label as "Help for {{for}}", and (when
   * provided) the tooltip body is exposed under the nativeID `${for}-help`
   * (the web `aria-describedby` association).
   */
  for?: string;
  /** Tooltip placement relative to the icon. */
  side?: TooltipSide;
  /** Override the trigger's accessibility label entirely (web `ariaLabel`). */
  ariaLabel?: string;
  /** Web Tailwind className. Retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Field-level `<HelpIcon>` help primitive (native parity).
 *
 * A tiny `(?)` icon placed next to a form label. On native, tapping it toggles
 * a high-contrast tooltip bubble with the explanatory text (the web hover /
 * focus-within reveal has no touch analog). Renders nothing when neither
 * `i18nKey` nor `content` resolves to text, so call-sites don't have to gate
 * the icon when a help string is conditionally absent.
 */
export function HelpIcon({
  i18nKey,
  content,
  for: forId,
  side = 'top',
  ariaLabel,
  className: _className,
  style,
  testID,
}: HelpIconProps) {
  const t = translate;
  const [open, setOpen] = useState(false);
  const text = i18nKey
    ? t(i18nKey, {defaultValue: content ?? ''})
    : content ?? '';

  // Render nothing when no help content is supplied — keeps callers from having
  // to gate the icon themselves when a help string is missing.
  if (!text) {
    return null;
  }

  const label =
    ariaLabel ??
    (forId
      ? t('a11y.helpFor', {field: forId, defaultValue: `Help for ${forId}`})
      : t('help.tooltip.iconLabel', {defaultValue: 'More info'}));

  // Web blurs the trigger on Escape to collapse the focus-within tooltip; native
  // has no keyboard blur, so re-tapping the trigger toggles the bubble closed.
  const toggle = () => setOpen(prev => !prev);

  return (
    <View style={[styles.root, style]} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{expanded: open}}
        onPress={toggle}
        testID={forId ? `help-icon-${forId}` : 'help-icon'}
        style={({pressed}) => [
          styles.trigger,
          (open || pressed) && styles.triggerActive,
        ]}>
        <AppText
          accessible={false}
          style={[styles.glyph, open && styles.glyphActive]}>
          ?
        </AppText>
      </Pressable>

      {open ? (
        <View
          accessibilityLiveRegion="polite"
          nativeID={forId ? `${forId}-help` : undefined}
          pointerEvents="none"
          style={[styles.bubble, sideStyles[side]]}>
          <AppText style={styles.bubbleText}>{text}</AppText>
        </View>
      ) : null}
    </View>
  );
}

HelpIcon.displayName = 'HelpIcon';

// Web tooltip inverted-surface contract for the dark native theme: a light card
// (bg-gray-100) with dark text (text-gray-900) — high contrast against the dark
// app background, matching the web `dark:` branch of `<Tooltip>`.
const INVERTED_SURFACE = '#f1f5f9';
const INVERTED_TEXT = '#0f172a';

const styles = StyleSheet.create({
  bubble: {
    backgroundColor: INVERTED_SURFACE,
    borderRadius: 8, // rounded-lg
    elevation: 6,
    maxWidth: 260, // multiline max-w-[260px]
    paddingHorizontal: 10, // px-2.5
    paddingVertical: 6, // py-1.5
    position: 'absolute',
    shadowColor: '#000', // shadow-lg
    shadowOffset: {height: 6, width: 0},
    shadowOpacity: 0.3,
    shadowRadius: 12,
    zIndex: 50, // z-50
  },
  bubbleText: {
    color: INVERTED_TEXT,
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
    lineHeight: 16,
  },
  glyph: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  glyphActive: {
    color: colors.textSecondary, // hover / focus-visible:text-[var(--text-secondary)]
  },
  root: {
    alignSelf: 'flex-start',
    position: 'relative',
  },
  trigger: {
    alignItems: 'center',
    borderColor: colors.textMuted,
    borderRadius: 999, // rounded-full
    borderWidth: 1,
    height: 16, // h-4
    justifyContent: 'center',
    marginLeft: 4, // ml-1
    width: 16, // w-4
  },
  triggerActive: {
    borderColor: colors.textSecondary,
  },
});

const sideStyles = StyleSheet.create<Record<TooltipSide, ViewStyle>>({
  bottom: {left: 0, marginTop: 8, top: '100%'},
  left: {marginRight: 8, right: '100%', top: 0},
  right: {left: '100%', marginLeft: 8, top: 0},
  top: {bottom: '100%', left: 0, marginBottom: 8},
});
