// Native parity port of web/src/components/ui/Textarea.tsx.
//
// `Textarea` is a labelled multi-line form field: an optional <Label> row (with
// an optional field-level help `(?)` icon), the <textarea> control itself, and
// an optional error message. The web source (L30-67) is a
// `forwardRef<HTMLTextAreaElement>` that derives the control id from `id ?? the
// slugified label` (L32), renders the shared form <Label> + <HelpIcon> when a
// `label` is supplied (L35-46), the <textarea> with size/focus/error Tailwind
// classes (L47-62), and a red error <p> (L63).
//
// Native-safe mapping (rules 4/5/6/7):
//   - `forwardRef<HTMLTextAreaElement>` (L30) -> `forwardRef<TextInput>`: the
//     ref-forwarding API is preserved, now pointing at the React Native
//     TextInput instance. The DOM `React.TextareaHTMLAttributes` base (L6) ->
//     `Omit<TextInputProps,'style'>` (rule 4: no DOM types in native) plus an
//     explicit web-compat surface (className/id/required/disabled/rows) and a
//     native `style?:StyleProp<TextStyle>`. The web `Omit<…,'size'>` only
//     existed to free up the custom `size` union; TextInputProps has no `size`,
//     so `size` is added directly.
//   - The `<textarea>` host (L47-62) -> a React Native `<TextInput multiline>`
//     with `textAlignVertical="top"` so text starts at the top like a textarea.
//     `value`/`onChangeText`/`placeholder`/`maxLength`/`autoFocus`/… flow
//     through `...rest` (the web `{...props}` spread, L61). `disabled` ->
//     `editable={false}`; `rows` -> a `minHeight` derived from the line height.
//     The web `resize-y` manual drag-resize (L57) and `transition-colors`
//     (L57) have no React Native analog and are omitted (the field grows with
//     content; the focus/error border colour swaps immediately).
//   - `cn` from @/lib/cn (L2) is dropped: React Native has no className, so the
//     class-driven base/size/focus/error styling moves to StyleSheet + computed
//     colour literals. `className` is retained on props for source compatibility
//     but ignored (`_className`), matching the Badge / Label / PrintButton ports.
//   - `Label` from './Label' (L3) -> the already-ported native ./Label (rule 5).
//     The web `className="block text-xs font-medium text-[var(--text-secondary)]"`
//     (L40) maps to the native Label `style` prop (text-xs 12/16, font-medium
//     '500', --text-secondary). `htmlFor`/`required` are passed through (htmlFor
//     is a documented native no-op inside the Label port).
//   - `HelpIcon` + `HelpIconProps` from './HelpIcon' (L4) are NOT yet ported and
//     the web HelpIcon pulls lucide-react / Tooltip / react-i18next / cn (all
//     DOM/web-only). So the dependency's surface is reproduced locally
//     (the PrintButton precedent for an unported host): `HelpIconProps` is
//     redeclared with the same members and a native-safe `HelpIcon` renders a
//     `(?)` Pressable. React Native has no hover/focus tooltip, so the web
//     Tooltip (hover/focus-within reveal) collapses to a tap-to-toggle inline
//     disclosure bubble; the help text is ALSO exposed via `accessibilityHint`
//     so screen readers announce it. The "render nothing when no help text"
//     behaviour (web L69) and the per-field "Help for {{for}}" aria-label (web
//     L71-75) are preserved. The Escape-blur key handler (web L77-83) and the
//     `side` placement (mapped to above/below) are documented in the sidecar.
//   - react-i18next `useTranslation` (web HelpIcon L2) is absent from the native
//     deps -> a local fallback hook returning the inline English fallback, same
//     call shape as the Label / PrintButton ports. Keys (`a11y.helpFor`,
//     `help.tooltip.iconLabel`) are referenced verbatim so i18n intent survives.
//
// Visual intent / Tailwind -> px (1 unit = 4px): rounded-lg = 8, border = 1,
// bg-[var(--surface-1)] = #0e1727, text-[var(--text-primary)] = colors.textPrimary,
// placeholder:text-[var(--text-muted)] = colors.textMuted. sizeClasses (L23-28):
// sm px-2 py-1.5 text-xs = {8,6,12/16}; md px-3 py-2 text-sm = {12,8,14/20};
// lg px-4 py-2.5 text-base = {16,10,16/24}; auto px-d-pad-x py-d-pad-y text-d-base
// is density-aware on web (CSS vars from ui_density) — native has no
// CSS-variable density cascade, so it resolves statically to the default
// "comfortable" density (pad-x 16, pad-y 12, base 14/20). focus:border-cyan-500/50
// (L56) = rgba(6,182,212,0.5) applied on focus; error border-red-500/50 (L58) =
// rgba(239,68,68,0.5) and takes precedence over the focus tint; the error <p>
// text-xs text-red-400 (L63) = 12/16 #f87171.

import React, {forwardRef, useCallback, useState} from 'react';
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

// Event payload types for the TextInput focus/blur handlers, derived from the
// installed react-native TextInputProps so the port stays robust across RN
// versions (0.81 types these as FocusEvent/BlurEvent rather than the older
// NativeSyntheticEvent<TextInputFocusEventData>).
type FocusHandlerEvent = Parameters<NonNullable<TextInputProps['onFocus']>>[0];
type BlurHandlerEvent = Parameters<NonNullable<TextInputProps['onBlur']>>[0];

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows} from '../../../theme/tokens';
import {Label} from './Label';

// ── Local i18n fallback ───────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. The hook shape mirrors the web
// `const { t } = useTranslation()` so the call sites are unchanged.
type TFn = (key: string, fallback: string) => string;

function useTranslation(): {t: TFn} {
  const t = useCallback<TFn>((_key, fallback) => fallback, []);
  return {t};
}

// Web `size` union literals → native size geometry. Tailwind spacing/text → px.
type TextareaSize = 'sm' | 'md' | 'lg' | 'auto';

interface SizeStyle {
  paddingHorizontal: number;
  paddingVertical: number;
  fontSize: number;
  lineHeight: number;
}

const sizeStyles: Record<TextareaSize, SizeStyle> = {
  // px-2 py-1.5 text-xs
  sm: {paddingHorizontal: 8, paddingVertical: 6, fontSize: 12, lineHeight: 16},
  // px-3 py-2 text-sm
  md: {paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, lineHeight: 20},
  // px-4 py-2.5 text-base
  lg: {paddingHorizontal: 16, paddingVertical: 10, fontSize: 16, lineHeight: 24},
  // Density-aware on web (px-d-pad-x py-d-pad-y text-d-base). Native has no
  // CSS-variable density cascade, so it resolves to the default "comfortable"
  // density (pad-x 1rem = 16, pad-y 0.75rem = 12, base 14/20).
  auto: {paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, lineHeight: 20},
};

// Static Tailwind border colours resolved to literals.
const FOCUS_BORDER = 'rgba(6, 182, 212, 0.5)'; // focus:border-cyan-500/50
const ERROR_BORDER = 'rgba(239, 68, 68, 0.5)'; // border-red-500/50

// ── Native-safe HelpIcon ───────────────────────────────────────────────────
// The web './HelpIcon' (lucide-react + Tooltip + react-i18next + cn) is not
// ported; its prop surface is reproduced here and the hover/focus tooltip
// collapses to a tap-to-toggle inline disclosure (see file header).

export interface HelpIconProps {
  /** i18n key for the help text (preferred over plain `content`). */
  i18nKey?: string;
  /** Default fallback when key is missing or for one-offs. */
  content?: string;
  /** Field id; surfaces in the trigger's aria-label as "Help for {{for}}". */
  for?: string;
  /** Tooltip placement on web; on native it picks the disclosure side. */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Override the trigger's accessible label entirely. */
  ariaLabel?: string;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
}

function HelpIcon({
  i18nKey,
  content,
  for: forId,
  side = 'top',
  ariaLabel,
  className: _className,
}: HelpIconProps) {
  const {t} = useTranslation();
  // Web: i18nKey ? t(i18nKey, { defaultValue: content ?? '' }) : (content ?? '').
  // The native fallback `t` returns its fallback, so this resolves to `content`.
  const text = i18nKey ? t(i18nKey, content ?? '') : content ?? '';
  const [open, setOpen] = useState(false);

  // Render nothing when no help content is supplied (web L67-69).
  if (!text) {
    return null;
  }

  const label =
    ariaLabel ??
    (forId
      ? t('a11y.helpFor', `Help for ${forId}`)
      : t('help.tooltip.iconLabel', 'More info'));

  // Web `side` default 'top' opens above; left/right collapse to above/below.
  const above = side === 'top' || side === 'left';

  return (
    <View style={styles.helpWrap}>
      <Pressable
        accessibilityHint={text}
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        hitSlop={6}
        onPress={() => setOpen(prev => !prev)}
        style={({pressed}) => [styles.helpTrigger, pressed && styles.pressed]}>
        <AppText style={styles.helpGlyph}>?</AppText>
      </Pressable>
      {open ? (
        <View
          style={[
            styles.helpBubble,
            above ? styles.helpBubbleAbove : styles.helpBubbleBelow,
          ]}>
          <AppText style={styles.helpBubbleText}>{text}</AppText>
        </View>
      ) : null}
    </View>
  );
}

HelpIcon.displayName = 'HelpIcon';

export interface TextareaProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  /**
   * Optional `(?)` help icon rendered immediately after the label. `for`
   * defaults to the textarea's resolved id so the trigger announces
   * "Help for {{id}}".
   */
  help?: Omit<HelpIconProps, 'for'> & {for?: string};
  error?: string;
  /**
   * Sizing scale. Defaults to `'md'` for back-compat. `'auto'` follows the
   * user's `ui_density` setting on web; native resolves it to the default
   * comfortable density.
   */
  size?: TextareaSize;
  /** Web `id`; derives the field id and maps to the TextInput `nativeID`. */
  id?: string;
  /** Web `required`; renders the Label required marker. */
  required?: boolean;
  /** Web `disabled` attribute → `editable={false}` + dimmed. */
  disabled?: boolean;
  /** Web textarea `rows` → a derived `minHeight`. */
  rows?: number;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override merged onto the TextInput. */
  style?: StyleProp<TextStyle>;
}

export const Textarea = forwardRef<TextInput, TextareaProps>(function Textarea(
  {
    className: _className,
    label,
    help,
    error,
    size = 'md',
    id,
    required,
    disabled,
    rows,
    style,
    editable,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);

  // Web L32: id ?? label?.toLowerCase().replace(/\s+/g, '-').
  const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

  const sizing = sizeStyles[size] ?? sizeStyles.md;
  // Web textarea defaults to ~2 visible rows; keep a textarea-like minimum.
  const resolvedRows = rows ?? 2;
  const minHeight = resolvedRows * sizing.lineHeight + sizing.paddingVertical * 2;

  const borderColor = error
    ? ERROR_BORDER
    : focused
    ? FOCUS_BORDER
    : colors.border;

  const handleFocus = useCallback(
    (event: FocusHandlerEvent) => {
      setFocused(true);
      onFocus?.(event);
    },
    [onFocus],
  );

  const handleBlur = useCallback(
    (event: BlurHandlerEvent) => {
      setFocused(false);
      onBlur?.(event);
    },
    [onBlur],
  );

  return (
    <View>
      {label ? (
        <View style={styles.labelRow}>
          <Label htmlFor={textareaId} required={required} style={styles.labelText}>
            {label}
          </Label>
          {help ? <HelpIcon {...help} for={help.for ?? textareaId} /> : null}
        </View>
      ) : null}
      <TextInput
        ref={ref}
        nativeID={textareaId}
        {...rest}
        accessibilityState={{disabled: Boolean(disabled)}}
        editable={disabled ? false : editable}
        multiline
        onBlur={handleBlur}
        onFocus={handleFocus}
        placeholderTextColor={colors.textMuted}
        textAlignVertical="top"
        style={[
          styles.base,
          {
            paddingHorizontal: sizing.paddingHorizontal,
            paddingVertical: sizing.paddingVertical,
            fontSize: sizing.fontSize,
            lineHeight: sizing.lineHeight,
            minHeight,
            borderColor,
          },
          disabled ? styles.disabled : null,
          style,
        ]}
      />
      {error ? <AppText style={styles.errorText}>{error}</AppText> : null}
    </View>
  );
});

Textarea.displayName = 'Textarea';

const styles = StyleSheet.create({
  labelRow: {
    alignItems: 'center', // items-center
    flexDirection: 'row',
    gap: 4, // gap-1
    marginBottom: 4, // mb-1
  },
  labelText: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
    lineHeight: 16,
  },
  base: {
    backgroundColor: '#0e1727', // bg-[var(--surface-1)]
    borderRadius: 8, // rounded-lg
    borderWidth: 1, // border
    color: colors.textPrimary, // text-[var(--text-primary)]
    width: '100%', // w-full
  } as ViewStyle & TextStyle,
  disabled: {
    opacity: 0.6,
  },
  errorText: {
    color: '#f87171', // text-red-400
    fontSize: 12, // text-xs
    lineHeight: 16,
    marginTop: 4, // mt-1
  },
  helpWrap: {
    marginLeft: 4, // ml-1
    position: 'relative',
  },
  helpTrigger: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 9999, // rounded-full
    borderWidth: 1,
    height: 16, // h-4
    justifyContent: 'center',
    width: 16, // w-4
  },
  helpGlyph: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  pressed: {
    opacity: 0.6,
  },
  helpBubble: {
    backgroundColor: '#0e1727',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    left: 0,
    maxWidth: 240,
    minWidth: 160,
    paddingHorizontal: 10,
    paddingVertical: 6,
    position: 'absolute',
    zIndex: 30,
    ...shadows.panel,
  },
  helpBubbleAbove: {
    bottom: '100%',
    marginBottom: 4,
  },
  helpBubbleBelow: {
    marginTop: 4,
    top: '100%',
  },
  helpBubbleText: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
  },
});

export default Textarea;
