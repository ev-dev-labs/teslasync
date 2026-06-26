// Native parity port of web/src/components/ui/Input.tsx.
//
// The web component is a labelled form `<input>` primitive composed of a DOM
// `<input>`, a `<Label>` (with a visible `*` + VisuallyHidden "required"
// indicator), an optional field-level `<HelpIcon>` (a `(?)` button that reveals
// help text via the shared hover/focus `<Tooltip>`), optional leading icon /
// trailing suffix adornments, an inline error `<p>`, and a hint `<p>`. None of
// the DOM pieces exist in this React Native parity workspace, so the port
// replaces them 1:1 with RN primitives while preserving the full public
// contract and the visual + behavioural intent:
//
//   - DOM <input>                 -> controlled/uncontrolled <TextInput> (every
//                                    extra TextInput prop is spread through, the
//                                    same way the web spread `{...props}` onto
//                                    the native <input>).
//   - size 'sm'|'md'|'lg'|'auto'  -> the same four-key map; the web 'auto'
//                                    density utilities (min-h-d-row/px-d-pad-x)
//                                    have no native density runtime, so 'auto'
//                                    folds to the md metrics plus a 44pt min
//                                    touch height (documented in the sidecar).
//   - <Label required>            -> a styled label row; the visible rose `*`
//                                    is kept (decorative), and the screen-reader
//                                    "required" text — which the web exposes via
//                                    a VisuallyHidden inside the <label> linked
//                                    by htmlFor — is folded into the TextInput's
//                                    accessibilityLabel ("{label}, required")
//                                    because RN has no label/for association.
//   - <HelpIcon>                  -> an inlined native HelpIcon: a `(?)`
//                                    Pressable that toggles an inline help
//                                    popover (RN has no :hover/:focus Tooltip),
//                                    rendering nothing when no help text is
//                                    supplied, exactly like the web primitive.
//   - leading icon / suffix       -> absolutely-positioned adornments inside a
//                                    relative field wrapper; the input gains
//                                    paddingLeft/paddingRight (web pl-10/pr-10).
//   - focus:ring-blue-500         -> an onFocus/onBlur-driven accent border
//                                    (RN has no focus ring); composed with any
//                                    caller-supplied onFocus/onBlur.
//   - error <p> / hint <p>        -> <AppText> caption rows (danger / muted);
//                                    aria-invalid + aria-describedby have no RN
//                                    equivalent, so the active message is also
//                                    surfaced via the TextInput accessibilityHint
//                                    while the nativeIDs (`${id}-error/-hint`)
//                                    are preserved for parity.
//   - cn() Tailwind + CSS vars    -> StyleSheet style arrays + theme tokens.
//   - DOM-only `className`         -> `style` (the input field) and
//                                    `containerStyle` (the outer wrapper).

import React, {
  forwardRef,
  useCallback,
  useId,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

export type InputSize = 'sm' | 'md' | 'lg' | 'auto';

// RN versions disagree on the focus/blur event type name (NativeSyntheticEvent<
// TextInputFocusEventData> vs FocusEvent/BlurEvent), so derive the exact param
// types from TextInputProps to stay version-agnostic.
type InputFocusEvent = Parameters<NonNullable<TextInputProps['onFocus']>>[0];
type InputBlurEvent = Parameters<NonNullable<TextInputProps['onBlur']>>[0];

type TranslationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

// Native stand-in for react-i18next's `useTranslation`: the parity bundle ships
// no i18n runtime, so `t` returns the English fallback while preserving the key
// at every call site, interpolating `{{token}}` placeholders so the
// "Help for {{field}}" trigger label resolves identically to the web copy.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback<NativeTFunction>((_key, fallback, values) => {
    if (!values) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (match, token: string) => {
      const value = values[token];
      return value === undefined ? match : String(value);
    });
  }, []);
}

/**
 * Parity port of web `HelpIconProps`. `className` becomes `style`; the rest of
 * the shape is preserved so callers can pass the same `help={{ ... }}` object.
 */
export interface HelpIconProps {
  /** i18n key for the help text (preferred over plain `content`). */
  i18nKey?: string;
  /** Default fallback when key is missing or for one-offs. */
  content?: string;
  /** Id of the labelled field; surfaces in the trigger label as "Help for {{for}}". */
  for?: string;
  /**
   * Tooltip placement on web. Retained for API parity; native renders an inline
   * popover with no directional positioning, so this is accepted and ignored.
   */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Override the trigger's accessibility label entirely. */
  ariaLabel?: string;
  /** Native composition hook replacing the DOM-only `className`. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Inlined native HelpIcon. Web reveals the help text on hover/focus/tap via the
 * shared <Tooltip>; RN has no hover/focus pseudo-states, so the `(?)` Pressable
 * toggles an inline help popover on press. Renders nothing when no help text is
 * supplied, matching the web primitive's self-gating behaviour.
 */
function HelpIcon({i18nKey, content, for: forId, ariaLabel, style}: HelpIconProps) {
  const t = useNativeTranslationFallback();
  const [open, setOpen] = useState(false);

  // Web: `i18nKey ? t(i18nKey, { defaultValue: content ?? '' }) : content ?? ''`.
  // With no key store the native shim resolves to the content fallback either way.
  const text = i18nKey ? content ?? '' : content ?? '';
  if (!text) {
    return null;
  }

  const label =
    ariaLabel ??
    (forId
      ? t('a11y.helpFor', 'Help for {{field}}', {field: forId})
      : t('help.tooltip.iconLabel', 'More info'));

  const toggle = () => setOpen(prev => !prev);

  return (
    <View style={styles.helpWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={text}
        accessibilityState={{expanded: open}}
        hitSlop={8}
        onPress={toggle}
        testID={forId ? `${forId}-help-trigger` : 'input-help-trigger'}
        style={({pressed}) => [
          styles.helpTrigger,
          pressed ? styles.helpTriggerPressed : null,
          style,
        ]}>
        <AppText style={styles.helpGlyph}>?</AppText>
      </Pressable>
      {open ? (
        <View
          accessibilityRole="text"
          nativeID={forId ? `${forId}-help` : undefined}
          style={styles.helpBubble}>
          <AppText tone="secondary" variant="caption">
            {text}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

HelpIcon.displayName = 'HelpIcon';

export interface InputProps extends Omit<TextInputProps, 'style' | 'id'> {
  label?: string;
  /**
   * Optional help affordance rendered immediately after the label. The
   * HelpIcon's `for` defaults to the input's resolved id so the trigger
   * announces "Help for {{id}}".
   */
  help?: Omit<HelpIconProps, 'for'> & {for?: string};
  error?: string;
  hint?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
  /**
   * Sizing scale. Defaults to `'md'`. `'auto'` follows the web `ui_density`
   * intent; with no native density runtime it folds to the md metrics with a
   * 44pt min touch height.
   */
  size?: InputSize;
  /** Marks the field required: visible `*` + folded into the accessibilityLabel. */
  required?: boolean;
  /** DOM `disabled` analog — maps to `editable={false}` plus dimmed styling. */
  disabled?: boolean;
  /** Explicit id (web `id`); falls back to a slug of `label`, then a generated id. */
  id?: string;
  /** Input field style (web `className`). */
  style?: StyleProp<TextStyle>;
  /** Outer wrapper style (the web outer `<div>`). */
  containerStyle?: StyleProp<ViewStyle>;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    help,
    error,
    hint,
    icon,
    suffix,
    size = 'md',
    required,
    disabled,
    id,
    style,
    containerStyle,
    testID,
    onFocus,
    onBlur,
    editable,
    placeholderTextColor,
    ...props
  },
  ref,
) {
  const reactId = useId();
  const inputId =
    id || (label ? label.toLowerCase().replace(/\s+/g, '-') : reactId);
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const [focused, setFocused] = useState(false);

  const handleFocus = useCallback(
    (event: InputFocusEvent) => {
      setFocused(true);
      onFocus?.(event);
    },
    [onFocus],
  );

  const handleBlur = useCallback(
    (event: InputBlurEvent) => {
      setFocused(false);
      onBlur?.(event);
    },
    [onBlur],
  );

  // RN has no label/for association, so the screen-reader "required" suffix the
  // web Label appends via VisuallyHidden is folded into the control's name.
  const accessibilityLabel = label
    ? required
      ? `${label}, required`
      : label
    : undefined;

  // aria-describedby has no RN equivalent — surface the active message via hint.
  const accessibilityHint = error ?? hint;

  return (
    <View style={[styles.container, containerStyle]} testID={testID}>
      {label ? (
        <View style={styles.labelRow}>
          <AppText style={styles.labelText}>
            {label}
            {required ? (
              <AppText
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.requiredMark}>
                {' *'}
              </AppText>
            ) : null}
          </AppText>
          {help ? <HelpIcon {...help} for={help.for ?? inputId} /> : null}
        </View>
      ) : null}

      <View style={styles.fieldWrap}>
        {icon ? (
          <View pointerEvents="none" style={styles.iconWrap}>
            {typeof icon === 'string' ? (
              <AppText tone="muted">{icon}</AppText>
            ) : (
              icon
            )}
          </View>
        ) : null}

        <TextInput
          ref={ref}
          {...props}
          nativeID={inputId}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          accessibilityState={{disabled: !!disabled}}
          editable={!disabled && (editable ?? true)}
          placeholderTextColor={placeholderTextColor ?? colors.textMuted}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[
            styles.inputBase,
            sizeStyles[size],
            icon ? styles.inputWithIcon : null,
            suffix ? styles.inputWithSuffix : null,
            focused ? styles.inputFocused : null,
            error ? styles.inputError : null,
            disabled ? styles.inputDisabled : null,
            style,
          ]}
        />

        {suffix ? <View style={styles.suffixWrap}>{suffix}</View> : null}
      </View>

      {error ? (
        <AppText
          accessibilityLiveRegion="polite"
          nativeID={errorId}
          style={styles.errorText}
          tone="danger"
          variant="caption">
          {error}
        </AppText>
      ) : null}
      {hint && !error ? (
        <AppText
          nativeID={hintId}
          style={styles.hintText}
          tone="muted"
          variant="caption">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

Input.displayName = 'Input';

const FIELD_RADIUS = 6;
const ADORNMENT_PAD = 40;

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  labelText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  requiredMark: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '500',
  },
  fieldWrap: {
    justifyContent: 'center',
    position: 'relative',
  },
  iconWrap: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 12,
    position: 'absolute',
    top: 0,
    zIndex: 1,
  },
  suffixWrap: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    right: 12,
    top: 0,
    zIndex: 1,
  },
  inputBase: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: FIELD_RADIUS,
    borderWidth: 1,
    color: colors.textPrimary,
    width: '100%',
  },
  inputWithIcon: {
    paddingLeft: ADORNMENT_PAD,
  },
  inputWithSuffix: {
    paddingRight: ADORNMENT_PAD,
  },
  inputFocused: {
    borderColor: colors.accent,
  },
  inputError: {
    borderColor: colors.danger,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 16,
  },
  hintText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  helpWrap: {
    position: 'relative',
  },
  helpTrigger: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 9,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    marginLeft: spacing.xs,
    width: 18,
  },
  helpTriggerPressed: {
    backgroundColor: colors.surfaceHover,
  },
  helpGlyph: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
  helpBubble: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    left: 0,
    maxWidth: 240,
    minWidth: 160,
    padding: spacing.sm,
    position: 'absolute',
    top: 24,
    zIndex: 10,
  },
});

const sizeStyles = StyleSheet.create<Record<InputSize, TextStyle>>({
  sm: {
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  md: {
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  lg: {
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  auto: {
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
