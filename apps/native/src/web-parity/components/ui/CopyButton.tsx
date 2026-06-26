// Native parity port of web/src/components/ui/CopyButton.tsx.
//
// The web component is a one-click clipboard primitive built on the shared web
// <Button> + lucide <Copy>/<CheckCircle> icons + react-i18next + the optional
// Toast provider, and it copies via the browser-only `navigator.clipboard
// .writeText`. None of those exist in this React Native parity workspace, so the
// port replaces them 1:1 with native-safe equivalents while preserving the full
// public contract (text/label/iconOnly/variant/size/withToast/ariaLabel/disabled/
// title/onCopy), the `copied` Copy -> Copied toggle, the 2000ms auto-reset, the
// onCopy success callback, and the aria-label/aria-live announce semantics:
//
//   - web <Button variant/size>      -> a self-contained Pressable styled to
//                                       mirror the web button variant/size map
//                                       (no parity <Button> exists yet).
//   - lucide <Copy>/<CheckCircle>    -> SemanticIcon 'copy'/'successFilled' glyphs.
//   - useTranslation()/t(key, def)   -> useNativeTranslationFallback (key,fallback)=>fallback.
//   - useOptionalToast()             -> Alert.alert (the parity toast primitive,
//                                       matching api/hooks/_toastHelpers.ts), opt-in
//                                       via `withToast`, degrading silently otherwise.
//   - navigator.clipboard.writeText  -> a registrable native clipboard writer.
//
// Clipboard caveat (rule 7 — explicit unavailable state): React Native 0.81
// removed the core `Clipboard` API and no clipboard package
// (@react-native-clipboard/clipboard or expo-clipboard) is bundled in this
// workspace. Rather than import a DOM `navigator`, the writer is injectable via
// `setCopyButtonClipboardWriter()` so production apps can wire a real clipboard;
// when no writer is registered (the default here) a copy attempt enters an
// explicit `unavailable` state (announced to a11y, optionally toasted, warned to
// the console) instead of silently pretending to copy. `copied` only ever flips
// on a genuinely successful write, keeping the affordance truthful.
//
// DOM-only props are mapped to their native analogs: `className` -> `style`
// (StyleProp<ViewStyle>), `title` (HTML tooltip) -> accessibilityHint, the
// implicit `type="button"` is dropped, and `aria-live="polite"` ->
// accessibilityLiveRegion="polite".

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

/** Button visual variants, mirroring the web shared <Button> variant map. */
export type CopyButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'danger'
  | 'ghost';

/** Button sizes, mirroring the web shared <Button> size map (`auto` folds to md). */
export type CopyButtonSize = 'sm' | 'md' | 'lg' | 'auto';

type NativeTFunction = (key: string, fallback: string) => string;

/** Performs the actual clipboard write. Sync or async; rejections surface the error path. */
export type CopyButtonClipboardWriter = (text: string) => void | Promise<void>;

let registeredClipboardWriter: CopyButtonClipboardWriter | null = null;

/**
 * Register the native clipboard implementation (e.g. backed by
 * @react-native-clipboard/clipboard or expo-clipboard) at app bootstrap. Until a
 * writer is registered, CopyButton reports an explicit `unavailable` state on
 * press instead of importing a browser-only `navigator.clipboard`.
 */
export function setCopyButtonClipboardWriter(
  writer: CopyButtonClipboardWriter | null,
): void {
  registeredClipboardWriter = writer;
}

/** Whether a native clipboard writer has been registered (false by default in this parity workspace). */
export function isCopyButtonClipboardAvailable(): boolean {
  return registeredClipboardWriter !== null;
}

// Native i18n shim mirroring the web `t(key, fallback)` call shape used across
// the parity tree; returns the English fallback until a provider exists.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

export interface CopyButtonProps {
  /** The string to copy to clipboard. */
  text: string;
  /** Override the default 'Copy' / 'Copied' button label. */
  label?: string;
  /** Show only the icon (no text). Defaults to false. */
  iconOnly?: boolean;
  /** Override variant; defaults to 'ghost'. */
  variant?: CopyButtonVariant;
  /** Override size; defaults to 'sm'. */
  size?: CopyButtonSize;
  /** When true, also fires a toast (native Alert) on success/failure. Defaults to false. */
  withToast?: boolean;
  /** Optional accessibility label override (auto-generated when iconOnly). */
  ariaLabel?: string;
  /** Disable the button (e.g. when the text isn't ready). */
  disabled?: boolean;
  /** Web `title` tooltip — mapped to accessibilityHint in native. */
  title?: string;
  /** Called after a successful copy. */
  onCopy?: () => void;
  /** Native composition hook replacing the DOM-only `className`. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function CopyButton({
  text,
  label,
  iconOnly = false,
  variant = 'ghost',
  size = 'sm',
  withToast = false,
  ariaLabel,
  disabled,
  title,
  onCopy,
  style,
  testID,
}: CopyButtonProps) {
  const t = useNativeTranslationFallback();
  const [copied, setCopied] = useState(false);
  // Explicit native "clipboard unavailable" state (rule 7): set when a copy is
  // attempted without a registered writer, surfaced via a11y + optional toast.
  const [unavailable, setUnavailable] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyLabel = t('common.copyButton.copy', 'Copy');
  const copiedLabel = t('common.copyButton.copied', 'Copied');

  useEffect(
    () => () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    if (!registeredClipboardWriter) {
      // Native clipboard not wired in this workspace — degrade explicitly
      // instead of claiming a successful copy.
      setUnavailable(true);
      if (withToast) {
        Alert.alert(
          t(
            'common.copyButton.unavailableToast',
            'Clipboard is unavailable on this device',
          ),
        );
      }
      console.warn(
        'CopyButton: no native clipboard writer registered; text was not copied',
      );
      return;
    }
    try {
      await registeredClipboardWriter(text);
      setUnavailable(false);
      setCopied(true);
      onCopy?.();
      if (withToast) {
        Alert.alert(
          t('common.copyButton.successToast', 'Copied to clipboard'),
        );
      }
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      if (withToast) {
        Alert.alert(t('common.copyButton.errorToast', 'Failed to copy'));
      }
      console.error('CopyButton: clipboard write failed', err);
    }
  }, [text, withToast, onCopy, t]);

  const visibleLabel = iconOnly
    ? null
    : label ?? (copied ? copiedLabel : copyLabel);
  const icon = (
    <SemanticIcon
      decorative
      name={copied ? 'successFilled' : 'copy'}
      size="sm"
    />
  );

  // Resolve the assistive label. When the visible text already conveys the
  // action, skip it so screen readers don't double-announce. The unavailable
  // state is surfaced through accessibilityHint below.
  const resolvedAriaLabel =
    ariaLabel ??
    (iconOnly ? (copied ? copiedLabel : label ?? copyLabel) : undefined);

  const accessibilityHint = unavailable
    ? t(
        'common.copyButton.unavailableHint',
        'Clipboard is unavailable on this device',
      )
    : title;

  const sizeKey = size === 'auto' ? 'md' : size;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={resolvedAriaLabel}
      accessibilityHint={accessibilityHint}
      accessibilityLiveRegion="polite"
      accessibilityState={{disabled: !!disabled}}
      disabled={disabled}
      onPress={handleCopy}
      testID={testID}
      style={({pressed}) => [
        styles.base,
        sizeStyles[sizeKey],
        variantStyles[variant],
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
        pressed && !disabled && variant === 'ghost' ? styles.pressedGhost : null,
        style,
      ]}>
      {icon}
      {visibleLabel != null ? (
        <AppText
          numberOfLines={1}
          weight="semibold"
          style={[styles.label, labelSizeStyles[sizeKey], labelVariantStyles[variant]]}>
          {visibleLabel}
        </AppText>
      ) : null}
    </Pressable>
  );
}

CopyButton.displayName = 'CopyButton';

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    includeFontPadding: false,
  },
  pressed: {
    opacity: 0.82,
  },
  pressedGhost: {
    backgroundColor: colors.surfaceHover,
  },
});

const sizeStyles = StyleSheet.create<Record<'sm' | 'md' | 'lg', ViewStyle>>({
  sm: {
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  md: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  lg: {
    minHeight: 52,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
});

const variantStyles = StyleSheet.create<
  Record<CopyButtonVariant, ViewStyle>
>({
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.surfaceRaised,
  },
  outline: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
    borderWidth: 1,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
});

const labelSizeStyles = StyleSheet.create<Record<'sm' | 'md' | 'lg', TextStyle>>(
  {
    sm: {
      fontSize: 12,
      lineHeight: 16,
    },
    md: {
      fontSize: 14,
      lineHeight: 18,
    },
    lg: {
      fontSize: 16,
      lineHeight: 20,
    },
  },
);

const labelVariantStyles = StyleSheet.create<
  Record<CopyButtonVariant, TextStyle>
>({
  primary: {
    color: colors.background,
  },
  secondary: {
    color: colors.textPrimary,
  },
  outline: {
    color: colors.textPrimary,
  },
  danger: {
    color: colors.textPrimary,
  },
  ghost: {
    color: colors.textPrimary,
  },
});
