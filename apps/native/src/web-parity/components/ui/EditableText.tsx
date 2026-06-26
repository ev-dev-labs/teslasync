// Native parity port of web/src/components/ui/EditableText.tsx.
//
// The web component is an inline-edit primitive: a double-click / Enter / F2
// "display" surface (a transparent <button> styled as text with a hover-reveal
// lucide <Pencil/>) that swaps to a controlled <input> with Enter-to-save /
// Escape-to-cancel / blur-to-commit, a spinner while saving, an <ErrorText>
// (role="alert") on validation/save failure, and a useAnnouncer() screen-reader
// announcement on success. None of the DOM pieces exist in this React Native
// parity workspace, so the port replaces them 1:1 while preserving the full
// public contract and the entire commit state machine:
//
//   - DOM <input>                    -> controlled <TextInput> (value/onChangeText),
//                                       editable={!saving}, autoFocus, placeholder,
//                                       maxLength preserved verbatim.
//   - onKeyDown Enter/Escape         -> onKeyPress (nativeEvent.key) for hardware
//                                       keyboards PLUS onSubmitEditing for the soft
//                                       keyboard's return key; both route through the
//                                       single idempotent commitDraft() path.
//   - onBlur commit                  -> TextInput onBlur (same "stay in edit mode
//                                       while invalid, else commit" guard).
//   - DOM <button> display surface   -> Pressable accessibilityRole="button"; press
//                                       enters edit mode (web wired onClick AND
//                                       onDoubleClick to the same startEdit).
//   - lucide <Pencil/> (hover-reveal)-> a small muted text glyph affordance, shown
//                                       persistently because RN has no :hover; marked
//                                       decorative (the button already carries the
//                                       accessible name), mirroring aria-hidden.
//   - CSS spinner span (role=status) -> <ActivityIndicator> with the same a11y label.
//   - <ErrorText> (role="alert")     -> <AppText tone="danger" accessibilityRole="alert">.
//   - useTranslation()/t(key, def)   -> useNativeTranslationFallback with {{token}}
//                                       interpolation so the "{{label}} saved"
//                                       announcement still resolves.
//   - useAnnouncer()                 -> the parity a11y AnnouncerRegion's announce(),
//                                       wrapped in the same stable { announce } shape.
//
// Web-keyboard-only affordances with no native analog are documented in the parity
// sidecar (rule 7): the display-surface F2 shortcut is dropped (Enter/Space activation
// survives via the button role + onPress), and aria-invalid / aria-describedby have no
// RN equivalent so the error is linked via nativeID + an assertive alert role instead.
// The DOM-only `className` wrapper override becomes `style` (StyleProp<ViewStyle>).

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputKeyPressEventData,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {announce} from '../a11y/AnnouncerRegion';

export type EditableTextVariant = 'body' | 'heading';

type TranslationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

// Native stand-in for react-i18next's useTranslation: the native bundle ships no
// i18n runtime, so `t` returns the English fallback while preserving the key at
// every call site. It interpolates `{{token}}` placeholders from `values` so the
// "{{label}} saved" success announcement resolves identically to the web copy.
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

// Parity equivalent of web `@/hooks/useAnnouncer`: returns the same stable
// `{ announce }` object (safe in dependency arrays) backed by the native
// AnnouncerRegion live-region module.
function useAnnouncer() {
  return useMemo(() => ({announce}), []);
}

export interface EditableTextDisplayProps {
  /** Current saved value (NOT the in-flight draft). */
  value: string;
  /** Imperatively enter edit mode — wire to a pencil affordance press. */
  onStartEdit: () => void;
  /** True when `disabled` is set on the parent. */
  disabled: boolean;
}

export interface EditableTextProps {
  /** The currently-saved value. Becomes the starting point for each edit. */
  value: string;
  /**
   * Called with the trimmed next value when the user commits a non-empty,
   * valid, changed draft. Must return a Promise so we can show a spinner
   * while the save is in flight and roll back on rejection.
   */
  onSave: (next: string) => Promise<void>;
  /**
   * Optional synchronous validator. Return null/undefined for valid input,
   * or a localised error message string. Runs on every keystroke and
   * gates Enter-to-save / blur-to-save.
   */
  validate?: (next: string) => string | null | undefined;
  /** Placeholder for the input AND fallback for the empty display. */
  placeholder?: string;
  /** Native `maxLength` on the input. */
  maxLength?: number;
  /**
   * Required accessible name describing the editable field
   * (e.g. "Rename geofence Home"). Used as the button's accessibility label
   * AND the input's accessibility label, so screen readers know what's being
   * edited.
   */
  ariaLabel: string;
  /** 'body' (default) or 'heading' — controls visible text size only. */
  variant?: EditableTextVariant;
  /** Renders display-only with no edit affordance. */
  disabled?: boolean;
  /**
   * Optional render prop for the display state. When set, the consumer
   * fully controls the display layout (e.g. Link + pencil) and calls
   * `onStartEdit` to enter edit mode. When unset, we render a default
   * button-styled-as-text that enters edit mode on press.
   */
  display?: (props: EditableTextDisplayProps) => ReactNode;
  /** Native composition hook replacing the web `className` outer wrapper. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Trim is the canonical normaliser — same value sent to the server. */
function normalise(s: string): string {
  return s.trim();
}

export function EditableText({
  value,
  onSave,
  validate,
  placeholder,
  maxLength,
  ariaLabel,
  variant = 'body',
  disabled = false,
  display,
  style,
  testID,
}: EditableTextProps) {
  const t = useNativeTranslationFallback();
  const {announce: announceMessage} = useAnnouncer();
  const reactId = useId();
  const inputId = `editable-${reactId}`;
  const errorId = `${inputId}-error`;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<TextInput | null>(null);
  /** True while a commit is in-flight; blocks duplicate submits. */
  const savingRef = useRef(false);
  /** Last value we submitted to onSave; blocks identical re-submits. */
  const lastSubmittedRef = useRef<string | null>(null);

  // Re-sync draft if the canonical value changes from outside while we're
  // NOT editing (e.g. another tab's update lands via TanStack Query
  // invalidation). When the user is editing we leave their draft alone.
  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [value, editing]);

  const startEdit = useCallback(() => {
    if (disabled) {
      return;
    }
    setDraft(value);
    setError(null);
    lastSubmittedRef.current = null;
    setEditing(true);
  }, [disabled, value]);

  const cancelEdit = useCallback(() => {
    if (savingRef.current) {
      return;
    }
    setDraft(value);
    setError(null);
    setEditing(false);
  }, [value]);

  /**
   * Single commit path. Returns true when the editor should exit edit
   * mode (success or no-op), false when it should stay (invalid or
   * pending error).
   */
  const commitDraft = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) {
      return false;
    }

    const next = normalise(draft);
    const current = normalise(value);

    // No-op: just leave edit mode without touching the server.
    if (next === current) {
      setError(null);
      setEditing(false);
      return true;
    }

    // Validate before submitting. If the validator allows empty strings
    // it's responsible for saying so explicitly — by default we treat
    // empty as invalid via a built-in i18n message.
    let validationError: string | null = null;
    if (next === '') {
      validationError = t('editableText.error.empty', 'Value cannot be empty');
    } else if (validate) {
      const v = validate(next);
      if (v) {
        validationError = v;
      }
    }

    if (validationError) {
      setError(validationError);
      return false;
    }

    // Skip identical re-submit (e.g. Enter-then-blur fires twice).
    if (lastSubmittedRef.current === next) {
      setError(null);
      setEditing(false);
      return true;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      lastSubmittedRef.current = next;
      setEditing(false);
      announceMessage(
        t('editableText.announce.saved', '{{label}} saved', {label: ariaLabel}),
      );
      return true;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('editableText.error.saveFailed', 'Save failed');
      setError(message);
      // Keep focus on the input so the user can fix and retry. A resolved-
      // promise microtask is the native-safe equivalent of the web
      // queueMicrotask, deferring the focus until after this render commit.
      void Promise.resolve().then(() => inputRef.current?.focus());
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [announceMessage, ariaLabel, draft, onSave, t, validate, value]);

  const handleInputChange = useCallback(
    (next: string) => {
      setDraft(next);
      // Live validation so the user sees the error before pressing Enter.
      if (validate) {
        const trimmed = normalise(next);
        if (trimmed === '') {
          // Don't surface "empty" until commit; pre-empting on every
          // backspace is annoying.
          setError(null);
        } else {
          const v = validate(trimmed);
          setError(v ?? null);
        }
      } else {
        setError(null);
      }
    },
    [validate],
  );

  const handleInputKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const key = e.nativeEvent.key;
      if (key === 'Enter') {
        e.preventDefault?.();
        void commitDraft();
        return;
      }
      if (key === 'Escape' || key === 'Esc') {
        e.preventDefault?.();
        cancelEdit();
      }
    },
    [cancelEdit, commitDraft],
  );

  // Soft-keyboard return key (mobile) — routes through the same idempotent
  // commit path as the hardware Enter handled in handleInputKeyPress.
  const handleSubmitEditing = useCallback(() => {
    void commitDraft();
  }, [commitDraft]);

  const handleInputBlur = useCallback(() => {
    if (savingRef.current) {
      return;
    }
    // If the user blurs while invalid, stay in edit mode so the error
    // remains visible and they can fix or Escape out. Otherwise commit.
    if (error) {
      return;
    }
    void commitDraft();
  }, [commitDraft, error]);

  const variantTextStyle = variantTextStyles[variant];

  // ─── Edit mode ──────────────────────────────────────────────────────
  if (editing) {
    return (
      <View style={[styles.editColumn, style]} testID={testID}>
        <View style={styles.editRow}>
          <TextInput
            ref={inputRef}
            nativeID={inputId}
            value={draft}
            onChangeText={handleInputChange}
            onKeyPress={handleInputKeyPress}
            onSubmitEditing={handleSubmitEditing}
            onBlur={handleInputBlur}
            editable={!saving}
            autoFocus
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            maxLength={maxLength}
            accessibilityLabel={ariaLabel}
            accessibilityState={{busy: saving}}
            testID="editable-text-input"
            style={[
              styles.input,
              variantTextStyle,
              error ? styles.inputError : null,
              saving ? styles.inputDisabled : null,
            ]}
          />
          {saving ? (
            <ActivityIndicator
              accessibilityLabel={t('editableText.saving', 'Saving…')}
              color={colors.textMuted}
              size="small"
              testID="editable-text-spinner"
            />
          ) : null}
        </View>
        {error ? (
          <AppText
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            nativeID={errorId}
            style={styles.errorText}
            tone="danger"
            variant="caption">
            {error}
          </AppText>
        ) : null}
      </View>
    );
  }

  // ─── Display mode ───────────────────────────────────────────────────

  // Custom display: consumer renders Link + pencil etc.
  if (display) {
    return (
      <View style={[styles.customDisplayRow, style]} testID={testID}>
        {display({value, onStartEdit: startEdit, disabled})}
      </View>
    );
  }

  // Default display: button-styled-as-text. Enter/Space activate (native
  // button role), press enters edit mode.
  const visibleText = value === '' && placeholder ? placeholder : value;
  const isPlaceholder = value === '' && Boolean(placeholder);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ariaLabel}
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={startEdit}
      testID={testID ?? 'editable-text-trigger'}
      style={({pressed}) => [
        styles.trigger,
        pressed && !disabled ? styles.triggerPressed : null,
        disabled ? styles.triggerDisabled : null,
        style,
      ]}>
      <AppText
        numberOfLines={1}
        style={[
          styles.visibleText,
          variantTextStyle,
          isPlaceholder ? styles.placeholderText : null,
        ]}>
        {visibleText}
      </AppText>
      {!disabled ? (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.pencil}>
          {'\u270E'}
        </AppText>
      ) : null}
    </Pressable>
  );
}

EditableText.displayName = 'EditableText';

const styles = StyleSheet.create({
  customDisplayRow: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  editColumn: {
    alignSelf: 'flex-start',
    flexDirection: 'column',
    gap: spacing.xs,
  },
  editRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 16,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  inputDisabled: {
    opacity: 0.6,
  },
  inputError: {
    borderColor: colors.danger,
  },
  pencil: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  placeholderText: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  trigger: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  triggerDisabled: {
    opacity: 0.6,
  },
  triggerPressed: {
    backgroundColor: colors.surfaceHover,
  },
  visibleText: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
});

const variantTextStyles = StyleSheet.create<
  Record<EditableTextVariant, TextStyle>
>({
  body: {
    fontSize: 14,
    fontWeight: '400',
  },
  heading: {
    fontSize: 16,
    fontWeight: '600',
  },
});
