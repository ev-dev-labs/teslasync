/**
 * TagInput — native parity port of web/src/components/forms/TagInput.tsx.
 *
 * Free-text tag chip input: the canonical primitive for collecting an arbitrary
 * list of short user-typed strings (alert tags, vehicle nicknames, custom
 * labels, vehicle-ID lists). It CREATES new values from free text — unlike a
 * combobox, which picks from an existing set with autocomplete.
 *
 * UX contract (preserved from web):
 *   - Return (onSubmitEditing) or any configured separator character (default
 *     `,`) commits the pending text as a tag.
 *   - Typing/pasting "foo, bar; baz" splits into multiple tags via the same
 *     separator-aware onChangeText path.
 *   - Backspace at an empty input removes the trailing tag.
 *   - Whitespace-trimmed; empty / duplicate tags are rejected silently. Both
 *     rejections trigger a polite live-region announcement.
 *   - `maxTags` caps the list; once reached the input becomes disabled and a
 *     helper line shows the count.
 *   - `validateTag` returning a non-null string surfaces the message under the
 *     field and blocks the commit until the user edits or clears the text.
 *
 * a11y contract (preserved):
 *   - The chip strip and the input share the same label (nativeID `labelId`).
 *   - The input is associated (Android `accessibilityLabelledBy`) with the
 *     label PLUS a visually-hidden enumeration of current tags AND the
 *     helper/error rows, so assistive tech can hear the current selection.
 *   - Each chip's remove button carries `accessibilityLabel="Remove {{tag}}"`.
 *   - Add/remove/duplicate/limit events announce on the global polite live
 *     region via the native `announce()` (the RN equivalent of the web
 *     `useAnnouncer`).
 *
 * Native adaptations vs. the web source:
 *   - `react-i18next` useTranslation -> a native-safe `t(key, fallback, opts?)`
 *     fallback that preserves the original keys, English fallbacks, and
 *     `{{count}}`/`{{tag}}`/`{{tags}}` interpolation.
 *   - `@/hooks/useAnnouncer` `announce` -> the global `announce()` exported by
 *     the native AnnouncerRegion (polite priority, matching the web global
 *     polite live region).
 *   - lucide `<X />` -> the native SemanticIcon 'close' glyph rendered as text.
 *   - `<ErrorText>` / `<HelperText>` -> `AppText` with danger / muted tones
 *     (no native equivalents exist; mirrors the FormField parity port).
 *   - DOM `<input>` -> `<TextInput>`. The web `onKeyDown` split (Enter +
 *     Backspace) maps to `onSubmitEditing` (Enter -> commit pending) and
 *     `onKeyPress` (Backspace at empty -> remove last chip). The web
 *     `onPaste` handler has no RN equivalent; multi-value paste is handled by
 *     `onChangeText` separator-splitting (the trailing fragment stays pending,
 *     committed on Return/blur) — preserving the multi-tag paste intent.
 *   - The DOM `aria-labelledby` + `aria-describedby` pair collapses to a single
 *     `accessibilityLabelledBy` array (RN has no describedby); `describedByIds`
 *     is preserved verbatim and folded into that array.
 *   - Tailwind `cn()` class merges -> StyleSheet token styles; `className` /
 *     `chipClassName` are accepted for source compatibility but ignored on
 *     native. The CSS focus-within ring maps to a focused-border style driven
 *     by onFocus/onBlur.
 */

import {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';

import {VisuallyHidden} from '../a11y';
import {announce} from '../a11y/AnnouncerRegion';
import {getSemanticIconDefinition} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../theme/tokens';

/* ── Types ────────────────────────────────────────────────────── */

/**
 * Single-character separator. Return is always implicitly a separator; this
 * list controls the additional in-text separators that trigger a commit while
 * typing OR pasting.
 *
 * Constrained to a fixed set so the regex used for paste-splitting is always
 * safe (no user-controlled regex injection).
 */
export type TagSeparator = ',' | ';' | ' ';

export interface TagInputProps {
  /** Current list of tags (controlled). */
  value: readonly string[];
  /** Fired with the next list whenever a tag is added or removed. */
  onChange: (next: string[]) => void;
  /** Required visible OR a11y-only label. */
  label: string;
  /** When true, the label is rendered visually-hidden (still announced). */
  hideLabel?: boolean;
  /** Placeholder for the typing field. */
  placeholder?: string;
  /** Optional nativeID to associate (e.g. external help text). */
  describedBy?: string;
  /** Maximum number of tags allowed. When reached, input is disabled. */
  maxTags?: number;
  /**
   * Optional per-tag validator. Return `null` to accept, or an error message
   * string to reject the candidate tag. Called AFTER trimming but BEFORE the
   * duplicate check.
   */
  validateTag?: (tag: string) => string | null;
  /**
   * Additional commit separators while typing / pasting. Defaults to `[',']`.
   * Return is always a separator regardless of this list.
   */
  separators?: ReadonlyArray<TagSeparator>;
  /** Disable both the input and chip remove buttons. */
  disabled?: boolean;
  /** Web wrapper className retained for source compatibility; ignored on native. */
  className?: string;
  /** Web chip className retained for source compatibility; ignored on native. */
  chipClassName?: string;
  /** Lower-case all tags before commit. Defaults to false. */
  lowercase?: boolean;
  /** Optional helper hint shown below the input when there is no error. */
  hint?: ReactNode;
}

/** Imperative handle for callers that need to focus the input. */
export interface TagInputHandle {
  focus: () => void;
  /** Force-commit the currently-pending text as a tag, if any. */
  commitPending: () => void;
}

type InterpolationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

/* ── Helpers ──────────────────────────────────────────────────── */

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, options) => {
    if (!options) {
      return fallback;
    }
    return interpolate(fallback, options);
  }, []);
}

/** Normalise tag prior to validation / dedupe: trim + optional lowercase. */
function normaliseTag(raw: string, lowercase: boolean): string {
  const trimmed = raw.trim();
  return lowercase ? trimmed.toLowerCase() : trimmed;
}

/**
 * Build a regex that splits a string on any of the configured separator
 * characters PLUS newlines (so paste-from-spreadsheet always splits sensibly).
 * Each character is hard-escaped so `separators` is safe to forward without
 * further sanitisation.
 */
function buildSplitRegex(separators: readonly TagSeparator[]): RegExp {
  const escaped = separators.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Always include CR / LF so multi-line pastes split per row.
  const pattern = `[${escaped.join('')}\\r\\n]+`;
  return new RegExp(pattern);
}

const CLOSE_GLYPH = getSemanticIconDefinition('close').glyph;

/* ── Component ────────────────────────────────────────────────── */

export const TagInput = forwardRef<TagInputHandle, TagInputProps>(
  function TagInput(
    {
      value,
      onChange,
      label,
      hideLabel = false,
      placeholder,
      describedBy,
      maxTags,
      validateTag,
      separators,
      disabled = false,
      className: _className,
      chipClassName: _chipClassName,
      lowercase = false,
      hint,
    },
    ref,
  ) {
    const t = useNativeTranslationFallback();

    const inputRef = useRef<TextInput>(null);
    const generatedId = useId();
    const inputId = `${generatedId}-input`;
    const labelId = `${generatedId}-label`;
    const errorId = `${generatedId}-error`;
    const helperId = `${generatedId}-helper`;
    const tagsListId = `${generatedId}-tags`;

    const [pending, setPending] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [focused, setFocused] = useState(false);

    /* Memoise the effective separator list so identity is stable for the regex
     * factory below. Defaults to comma-only — the most common shape for
     * free-text tag entry. */
    const effectiveSeparators = useMemo<readonly TagSeparator[]>(
      () => separators ?? [','],
      [separators],
    );

    const splitRegex = useMemo(
      () => buildSplitRegex(effectiveSeparators),
      [effectiveSeparators],
    );

    const atMax = maxTags !== undefined && value.length >= maxTags;
    const inputDisabled = disabled || atMax;

    /* Stable case-insensitive duplicate check. We always lowercase for the
     * COMPARISON regardless of the `lowercase` storage flag — "FOO" and "foo"
     * should not coexist in a tag list. */
    const existingLower = useMemo(
      () => new Set(value.map(v => v.toLowerCase())),
      [value],
    );

    /* ── Add / remove ──────────────────────────────────────────── */

    /**
     * Try to add a single normalised tag. Returns one of:
     *   - 'added'      tag accepted, list updated
     *   - 'duplicate'  tag rejected because it's already present
     *   - 'invalid'    tag rejected by `validateTag`
     *   - 'empty'      tag was empty after trim
     *   - 'full'       maxTags reached
     */
    const tryAddOne = useCallback(
      (
        raw: string,
        accumulated: readonly string[],
      ): {
        status: 'added' | 'duplicate' | 'invalid' | 'empty' | 'full';
        tag: string;
        error?: string;
        next: readonly string[];
      } => {
        const tag = normaliseTag(raw, lowercase);
        if (!tag) {
          return {status: 'empty', tag, next: accumulated};
        }
        if (maxTags !== undefined && accumulated.length >= maxTags) {
          return {status: 'full', tag, next: accumulated};
        }
        if (validateTag) {
          const err = validateTag(tag);
          if (err) {
            return {status: 'invalid', tag, error: err, next: accumulated};
          }
        }
        const lower = tag.toLowerCase();
        if (
          existingLower.has(lower) ||
          accumulated.some(existing => existing.toLowerCase() === lower)
        ) {
          return {status: 'duplicate', tag, next: accumulated};
        }
        return {status: 'added', tag, next: [...accumulated, tag]};
      },
      [existingLower, lowercase, maxTags, validateTag],
    );

    /**
     * Process a single user "commit" event (Return, separator key, blur,
     * paste). Splits the raw text on the configured separators and runs each
     * fragment through `tryAddOne`. Updates state once at the end with the
     * surviving fragments + the FIRST error encountered (if any).
     */
    const commitText = useCallback(
      (raw: string): {committed: number; remainder: string} => {
        const parts = raw.split(splitRegex);
        let acc: readonly string[] = value;
        let firstError: string | null = null;
        let added = 0;
        let lastDuplicate: string | null = null;
        let hitMax = false;
        let lastFragment = '';
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          // The trailing fragment (after the last separator) is what remains in
          // the input — DO NOT consume it on a typed-key commit. The caller
          // decides whether to commit it (Return does, mid-string separator
          // does not).
          if (i === parts.length - 1) {
            lastFragment = part;
            continue;
          }
          const result = tryAddOne(part, acc);
          if (result.status === 'added') {
            acc = result.next;
            added++;
          } else if (result.status === 'invalid' && firstError === null) {
            firstError = result.error ?? null;
          } else if (result.status === 'duplicate') {
            lastDuplicate = result.tag;
          } else if (result.status === 'full') {
            hitMax = true;
            break;
          }
        }
        if (acc !== value) {
          onChange([...acc]);
        }
        setError(firstError);
        if (firstError === null) {
          if (added > 0) {
            announce(
              added === 1
                ? t('tagInput.addedOne', 'Tag added')
                : t('tagInput.added', '{{count}} tags added', {count: added}),
            );
          } else if (lastDuplicate !== null) {
            announce(
              t('tagInput.duplicate', '{{tag}} is already added', {
                tag: lastDuplicate,
              }),
            );
          } else if (hitMax) {
            announce(t('tagInput.maxReachedAnnounce', 'Tag limit reached'));
          }
        }
        return {committed: added, remainder: lastFragment};
      },
      [onChange, splitRegex, t, tryAddOne, value],
    );

    /**
     * Force-commit the entire `text` argument as one or more tags (Return /
     * blur / explicit imperative commit). This DOES consume the trailing
     * fragment, by appending a synthetic separator at the end so `commitText`'s
     * "preserve last fragment" rule sees the real input content as a
     * fully-terminated piece.
     */
    const commitAll = useCallback(
      (text: string) => {
        if (!text) {
          // Clear stale error if the user emptied the field by other means
          // (Backspace etc.).
          if (error) {
            setError(null);
          }
          return;
        }
        const sep = effectiveSeparators[0] ?? ',';
        const {remainder} = commitText(text + sep);
        setPending(remainder);
      },
      [commitText, effectiveSeparators, error],
    );

    const removeAt = useCallback(
      (idx: number) => {
        if (disabled) {
          return;
        }
        if (idx < 0 || idx >= value.length) {
          return;
        }
        const next = value.slice();
        const [removed] = next.splice(idx, 1);
        onChange(next);
        if (error) {
          setError(null);
        }
        announce(t('tagInput.removed', 'Removed {{tag}}', {tag: removed}));
      },
      [disabled, error, onChange, t, value],
    );

    /* ── Event handlers ────────────────────────────────────────── */

    const handleChangeText = useCallback(
      (raw: string) => {
        // If the user typed (or pasted) a separator, commit everything up to
        // and including the LAST separator and keep the trailing remainder as
        // the new pending text.
        if (splitRegex.test(raw)) {
          const {remainder} = commitText(raw);
          setPending(remainder);
          return;
        }
        setPending(raw);
        // Clear any stale validation error as soon as the user edits — no point
        // holding "tag too short" up while they're typing more characters.
        if (error) {
          setError(null);
        }
      },
      [commitText, error, splitRegex],
    );

    const handleSubmitEditing = useCallback(() => {
      if (disabled) {
        return;
      }
      commitAll(pending);
    }, [commitAll, disabled, pending]);

    const handleKeyPress = useCallback(
      (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        if (disabled) {
          return;
        }
        if (
          e.nativeEvent.key === 'Backspace' &&
          pending === '' &&
          value.length > 0
        ) {
          // Backspace at empty input — remove the last chip.
          removeAt(value.length - 1);
        }
      },
      [disabled, pending, removeAt, value.length],
    );

    const handleFocus = useCallback(() => setFocused(true), []);

    const handleBlur = useCallback(() => {
      setFocused(false);
      // Commit any pending text on blur so users don't accidentally drop a tag
      // they were halfway through typing.
      if (pending.trim() !== '') {
        commitAll(pending);
      }
    }, [commitAll, pending]);

    /* ── Imperative handle ─────────────────────────────────────── */

    useImperativeHandle(
      ref,
      () => ({
        focus: () => inputRef.current?.focus(),
        commitPending: () => {
          if (pending.trim() !== '') {
            commitAll(pending);
          }
        },
      }),
      [commitAll, pending],
    );

    /* ── Render ────────────────────────────────────────────────── */

    const describedByIds =
      [
        describedBy,
        tagsListId,
        error ? errorId : null,
        hint || atMax ? helperId : null,
      ]
        .filter(Boolean)
        .join(' ') || undefined;

    // RN has no `aria-describedby`; fold the web labelledby (labelId) and
    // describedby (tags/error/helper) relationships into one labelledBy array.
    const labelledByIds = [
      labelId,
      ...(describedByIds ? describedByIds.split(' ') : []),
    ];

    const labelContent = (
      <>
        {label}
        {maxTags !== undefined ? (
          <AppText tone="muted" variant="caption">
            {` (${value.length}/${maxTags})`}
          </AppText>
        ) : null}
      </>
    );

    return (
      <View style={styles.root}>
        {hideLabel ? (
          <VisuallyHidden as="label" nativeID={labelId}>
            {labelContent}
          </VisuallyHidden>
        ) : (
          <AppText
            nativeID={labelId}
            style={styles.label}
            tone="secondary"
            variant="caption">
            {labelContent}
          </AppText>
        )}

        <Pressable
          accessibilityState={{disabled: inputDisabled}}
          onPress={() => {
            if (!disabled) {
              inputRef.current?.focus();
            }
          }}
          style={[
            styles.field,
            focused && styles.fieldFocused,
            error ? styles.fieldError : null,
            disabled && styles.fieldDisabled,
          ]}>
          {value.map((tag, i) => (
            <View key={`${tag}-${i}`} style={styles.chip}>
              <AppText
                numberOfLines={1}
                style={styles.chipText}
                variant="caption">
                {tag}
              </AppText>
              <Pressable
                accessibilityLabel={t('tagInput.removeTag', 'Remove {{tag}}', {
                  tag,
                })}
                accessibilityRole="button"
                disabled={disabled}
                hitSlop={8}
                onPress={() => removeAt(i)}
                style={({pressed}) => [
                  styles.chipRemove,
                  pressed && styles.chipRemovePressed,
                ]}>
                <AppText
                  style={styles.chipRemoveGlyph}
                  tone="muted"
                  variant="caption"
                  weight="bold">
                  {CLOSE_GLYPH}
                </AppText>
              </Pressable>
            </View>
          ))}

          <TextInput
            accessibilityLabel={label}
            accessibilityLabelledBy={labelledByIds}
            accessibilityState={{disabled: inputDisabled}}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!inputDisabled}
            nativeID={inputId}
            onBlur={handleBlur}
            onChangeText={handleChangeText}
            onFocus={handleFocus}
            onKeyPress={handleKeyPress}
            onSubmitEditing={handleSubmitEditing}
            placeholder={
              atMax
                ? t('tagInput.maxReached', 'Tag limit reached')
                : placeholder ?? t('tagInput.placeholder', 'Add a tag…')
            }
            placeholderTextColor={colors.textMuted}
            ref={inputRef}
            style={styles.input}
            submitBehavior="submit"
            value={pending}
          />
        </Pressable>

        {/* Hidden enumeration of current tags for screen readers. The input's
         * labelledBy references this so AT users can hear the active selection
         * at any time without stepping through every chip. */}
        <VisuallyHidden nativeID={tagsListId}>
          {value.length === 0
            ? t('tagInput.tagsNone', 'No tags yet')
            : t('tagInput.tagsList', 'Tags: {{tags}}', {
                tags: value.join(', '),
              })}
        </VisuallyHidden>

        {error ? (
          <AppText
            accessibilityLiveRegion="assertive"
            accessibilityRole="alert"
            nativeID={errorId}
            style={styles.message}
            tone="danger"
            variant="caption">
            {error}
          </AppText>
        ) : null}
        {!error && (hint || atMax) ? (
          <AppText
            nativeID={helperId}
            style={styles.message}
            tone="muted"
            variant="caption">
            {atMax
              ? t('tagInput.maxReachedHint', 'Maximum {{count}} tags', {
                  count: maxTags ?? 0,
                })
              : hint}
          </AppText>
        ) : null}
      </View>
    );
  },
);

TagInput.displayName = 'TagInput';

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: '100%',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipRemove: {
    alignItems: 'center',
    borderRadius: 999,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  chipRemoveGlyph: {
    fontSize: 11,
    lineHeight: 14,
  },
  chipRemovePressed: {
    backgroundColor: colors.surfaceHover,
  },
  chipText: {
    flexShrink: 1,
  },
  field: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  fieldDisabled: {
    opacity: 0.5,
  },
  fieldError: {
    borderColor: colors.danger,
  },
  fieldFocused: {
    borderColor: colors.borderAccent,
  },
  input: {
    color: colors.textPrimary,
    flexGrow: 1,
    flexShrink: 1,
    fontSize: typography.body,
    minWidth: 64,
    paddingVertical: 0,
  },
  label: {
    fontWeight: '500',
    marginBottom: 4,
  },
  message: {
    marginTop: 4,
  },
  root: {
    width: '100%',
  },
});
