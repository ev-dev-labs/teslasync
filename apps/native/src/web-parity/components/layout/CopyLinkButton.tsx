// Native parity port of web/src/components/layout/CopyLinkButton.tsx.
//
// The web component copies the current browser URL (window.location.href —
// path + query string) to the clipboard via navigator.clipboard.writeText, with
// a hidden-textarea + document.execCommand('copy') fallback for older/non-secure
// contexts, shows a success/error toast, and flips a lucide Link2 -> Check icon
// for 2s. React Native has NONE of those browser primitives — there is no
// `window.location` "current URL", no `navigator.clipboard`, and no DOM textarea
// fallback (conversion contract rule 7) — so the browser-only plumbing is moved
// behind explicit host bridges while the copied-state + toast + icon-swap
// behavior is preserved verbatim:
//   - `window.location.href` (the value to copy) -> the `url` prop. Native has no
//     implicit current URL; the host supplies the shareable deep link for the
//     current view. When it is missing the button renders the explicit
//     UNAVAILABLE state (disabled).
//   - `navigator.clipboard.writeText` + the textarea/execCommand fallback -> the
//     `onCopy(url)` bridge prop (host clipboard writer, e.g. wired to
//     @react-native-clipboard/clipboard or expo-clipboard). Missing -> disabled.
//   - `useToast()` success/error -> the `onToast(kind, message)` bridge prop; the
//     same two i18n keys + English fallbacks are passed through verbatim.
//   - react-i18next `useTranslation` -> the shared native fallback hook (key +
//     English fallback); all five t() keys/fallbacks are copied verbatim.
//   - lucide `Link2` / `Check` (h-3.5 w-3.5) -> SemanticIcon `link` / `confirm`
//     (size="sm"), preserving the default-link / copied-check intent.
//   - `../ui/Button` (variant="ghost" size="sm") -> a ghost Pressable + AppText.
// See the .parity.json sidecar for the line-by-line source map.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

// Web `window.setTimeout(() => setCopied(false), 2000)`.
const COPIED_RESET_MS = 2000;

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

export interface CopyLinkButtonProps {
  /**
   * Shareable link to copy. Replaces the web `window.location.href` (path +
   * query) which native has no analogue for — the host supplies the deep link
   * for the current view. When undefined the button is the explicit native
   * unavailable state (disabled).
   */
  url?: string;
  /**
   * Host clipboard writer. Replaces `navigator.clipboard.writeText` and the
   * hidden-textarea/execCommand fallback (both browser-only). When undefined the
   * button is disabled (copy unavailable on this host).
   */
  onCopy?: (url: string) => void | Promise<void>;
  /**
   * Transient feedback bridge. Replaces the web `useToast()` success/error
   * calls; receives the same i18n key fallbacks the web toasts used.
   */
  onToast?: (kind: 'success' | 'error', message: string) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * CopyLinkButton — copies a shareable link to the current view to the clipboard
 * so users can share a filtered/deep-linked view of the page. On native the
 * current-URL read and the clipboard write are browser-only, so both are
 * delegated to the host via the `url` and `onCopy` props; without them the
 * button renders disabled (the explicit unavailable state). The copied-state
 * icon swap + 2s reset and the success/error toast intent are preserved.
 *
 * Use sparingly — only on views where sharing makes sense (a filtered list, a
 * date range, a specific map view). Don't sprinkle this on every screen.
 */
export function CopyLinkButton({
  url,
  onCopy,
  onToast,
  style,
  testID,
}: CopyLinkButtonProps) {
  const t = useNativeTranslationFallback();
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReset = useCallback(() => {
    if (resetRef.current) {
      clearTimeout(resetRef.current);
      resetRef.current = null;
    }
  }, []);

  useEffect(() => clearReset, [clearReset]);

  // Web guards `if (typeof window === 'undefined') return` (no URL) before
  // reading window.location.href; natively the equivalent is "no host-supplied
  // link or clipboard writer", which is the explicit unavailable state.
  const available = url != null && url.length > 0 && onCopy != null;

  const handlePress = useCallback(async () => {
    if (!available || url == null || onCopy == null) {
      return;
    }
    try {
      await onCopy(url);
      setCopied(true);
      onToast?.(
        'success',
        t('common.copyLink.success', 'Link copied to clipboard'),
      );
      clearReset();
      resetRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      onToast?.('error', t('common.copyLink.error', 'Could not copy link'));
    }
  }, [available, url, onCopy, onToast, t, clearReset]);

  const label = copied
    ? t('common.copyLink.copied', 'Copied')
    : t('common.copyLink.action', 'Copy link');

  return (
    <Pressable
      accessibilityLabel={t('common.copyLink.label', 'Copy link to this view')}
      accessibilityRole="button"
      accessibilityState={{disabled: !available}}
      disabled={!available}
      hitSlop={6}
      onPress={handlePress}
      style={({pressed}) => [
        styles.button,
        pressed && available && styles.buttonPressed,
        !available && styles.buttonDisabled,
        style,
      ]}
      testID={testID ?? 'copy-link-button'}>
      <SemanticIcon
        decorative
        name={copied ? 'confirm' : 'link'}
        size="sm"
        style={styles.icon}
      />
      <AppText style={styles.label} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

CopyLinkButton.displayName = 'CopyLinkButton';

// Web `../ui/Button` variant="ghost" size="sm": transparent, content-sized,
// h-8 (32) with gap-2 between the icon and the text-xs label.
const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  icon: {
    borderWidth: 0,
  },
  label: {
    color: colors.textSecondary,
  },
});
