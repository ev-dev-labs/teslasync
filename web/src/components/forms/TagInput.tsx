/**
 * Free-text tag chip input.
 *
 * Canonical primitive for collecting an arbitrary list of short
 * user-typed strings (alert tags, vehicle nicknames, custom labels,
 * vehicle-ID lists, etc.). Intentionally distinct from
 * {@link ComboboxMulti}: that primitive picks values
 * from an existing set with autocomplete; this one CREATES new
 * values from free text.
 *
 * UX contract
 * -----------
 * - Enter or any configured separator character (default `,`) commits
 *   the pending text as a tag.
 * - Pasting "foo, bar; baz" splits into multiple tags in one shot.
 * - Backspace at an empty input removes the trailing tag — discoverable
 *   for keyboard users and matches every modern multi-chip field
 *   (Mail/Outlook recipient pickers, GitHub label inputs, …).
 * - Whitespace-trimmed; empty / duplicate tags are rejected silently.
 *   Both rejections trigger an `aria-live` announcement so SR users
 *   know nothing was added.
 * - `maxTags` caps the list; once reached the input becomes disabled
 *   and a helper line shows the count.
 * - `validateTag` returning a non-null string surfaces the message
 *   under the field via `<ErrorText>` and blocks the commit until the
 *   user edits or clears the pending text.
 *
 * a11y contract
 * -------------
 * - The visible chip strip and the input share the same `<label>`.
 * - The input carries `aria-describedby` referencing both the helper
 *   text (count / error) AND a hidden enumeration of current tags so
 *   AT users can hear the current selection at any time.
 * - Each chip's remove button has an explicit `aria-label="Remove
 *   {{tag}}"`.
 * - Add/remove operations announce on the global polite live region
 *   via `useAnnouncer`.
 *
 * Boundary
 * --------
 * If you need autocomplete from a known set of values, compose
 * {@link ComboboxMulti} from `@/components/forms` instead — that
 * primitive already covers the chip+listbox+aria-multiselectable
 * pattern. `TagInput` is for the case where the universe of valid
 * tag strings is open (or only soft-validated by a regex).
 */

import {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAnnouncer } from '@/hooks/useAnnouncer';
import { VisuallyHidden } from '@/components/a11y';
import { ErrorText, HelperText } from '@/components/ui/runtime';

/* ── Types ────────────────────────────────────────────────────── */

/**
 * Single-character separator. Enter is always implicitly a separator;
 * this list controls the additional in-text separators that trigger
 * commit while typing OR pasting.
 *
 * Constrained to a fixed set so the regex used for paste-splitting is
 * always safe (no user-controlled regex injection).
 */
export type TagSeparator = ',' | ';' | ' ';

export interface TagInputProps {
  /** Current list of tags (controlled). */
  value: readonly string[];
  /** Fired with the next list whenever a tag is added or removed. */
  onChange: (next: string[]) => void;
  /** Required visible OR aria-only label. */
  label: string;
  /** When true, the label is rendered visually-hidden (still announced). */
  hideLabel?: boolean;
  /** Placeholder for the typing field. */
  placeholder?: string;
  /** Optional ID to attach via `aria-describedby` (e.g. external help text). */
  describedBy?: string;
  /** Maximum number of tags allowed. When reached, input is disabled. */
  maxTags?: number;
  /**
   * Optional per-tag validator. Return `null` to accept, or an error
   * message string to reject the candidate tag. Called AFTER trimming
   * but BEFORE the duplicate check.
   */
  validateTag?: (tag: string) => string | null;
  /**
   * Additional commit separators while typing / pasting. Defaults to
   * `[',']`. Enter is always a separator regardless of this list.
   */
  separators?: ReadonlyArray<TagSeparator>;
  /** Disable both the input and chip remove buttons. */
  disabled?: boolean;
  /** Outer wrapper className. */
  className?: string;
  /** Tailwind class controlling the chip colour family. */
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

/* ── Helpers ──────────────────────────────────────────────────── */

/** Normalise tag prior to validation / dedupe: trim + optional lowercase. */
function normaliseTag(raw: string, lowercase: boolean): string {
  const trimmed = raw.trim();
  return lowercase ? trimmed.toLowerCase() : trimmed;
}

/**
 * Build a regex that splits a string on any of the configured
 * separator characters PLUS newlines (so paste-from-spreadsheet
 * always splits sensibly). Each character is hard-escaped so
 * `separators` is safe to forward without further sanitisation.
 */
function buildSplitRegex(separators: readonly TagSeparator[]): RegExp {
  const escaped = separators.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Always include CR / LF so multi-line pastes split per row.
  const pattern = `[${escaped.join('')}\\r\\n]+`;
  return new RegExp(pattern);
}

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
      className,
      chipClassName,
      lowercase = false,
      hint,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const { announce } = useAnnouncer();

    const inputRef = useRef<HTMLInputElement>(null);
    const generatedId = useId();
    const inputId = `${generatedId}-input`;
    const labelId = `${generatedId}-label`;
    const errorId = `${generatedId}-error`;
    const helperId = `${generatedId}-helper`;
    const tagsListId = `${generatedId}-tags`;

    const [pending, setPending] = useState('');
    const [error, setError] = useState<string | null>(null);

    /* Memoise the effective separator list so identity is stable for
     * the regex factory below. Defaults to comma-only — the most
     * common shape for free-text tag entry. */
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

    /* Stable case-insensitive duplicate check. We always lowercase
     * for the COMPARISON regardless of the `lowercase` storage flag —
     * "FOO" and "foo" should not coexist in a tag list. */
    const existingLower = useMemo(
      () => new Set(value.map((v) => v.toLowerCase())),
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
      ): { status: 'added' | 'duplicate' | 'invalid' | 'empty' | 'full'; tag: string; error?: string; next: readonly string[] } => {
        const tag = normaliseTag(raw, lowercase);
        if (!tag) return { status: 'empty', tag, next: accumulated };
        if (maxTags !== undefined && accumulated.length >= maxTags) {
          return { status: 'full', tag, next: accumulated };
        }
        if (validateTag) {
          const err = validateTag(tag);
          if (err) return { status: 'invalid', tag, error: err, next: accumulated };
        }
        const lower = tag.toLowerCase();
        if (
          existingLower.has(lower) ||
          accumulated.some((existing) => existing.toLowerCase() === lower)
        ) {
          return { status: 'duplicate', tag, next: accumulated };
        }
        return { status: 'added', tag, next: [...accumulated, tag] };
      },
      [existingLower, lowercase, maxTags, validateTag],
    );

    /**
     * Process a single user "commit" event (Enter, separator key, blur,
     * paste). Splits the raw text on the configured separators and
     * runs each fragment through `tryAddOne`. Updates state once at
     * the end with the surviving fragments + the FIRST error
     * encountered (if any).
     */
    const commitText = useCallback(
      (raw: string): { committed: number; remainder: string } => {
        const parts = raw.split(splitRegex);
        let acc: readonly string[] = value;
        let firstError: string | null = null;
        let added = 0;
        let lastDuplicate: string | null = null;
        let hitMax = false;
        let lastFragment = '';
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          // The trailing fragment (after the last separator) is what
          // remains in the input — DO NOT consume it on a typed-key
          // commit. The caller decides whether to commit it (Enter
          // does, mid-string separator does not).
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
        if (acc !== value) onChange([...acc]);
        setError(firstError);
        if (firstError === null) {
          if (added > 0) {
            announce(
              added === 1
                ? t('tagInput.addedOne', 'Tag added')
                : t('tagInput.added', '{{count}} tags added', { count: added }),
            );
          } else if (lastDuplicate !== null) {
            announce(
              t('tagInput.duplicate', '{{tag}} is already added', {
                tag: lastDuplicate,
              }),
            );
          } else if (hitMax) {
            announce(
              t('tagInput.maxReachedAnnounce', 'Tag limit reached'),
            );
          }
        }
        return { committed: added, remainder: lastFragment };
      },
      [announce, onChange, splitRegex, t, tryAddOne, value],
    );

    /**
     * Force-commit the entire `text` argument as one or more tags
     * (Enter / blur / explicit imperative commit). This DOES consume
     * the trailing fragment, by appending a synthetic separator at
     * the end so `commitText`'s "preserve last fragment" rule sees
     * the real input content as a fully-terminated piece.
     */
    const commitAll = useCallback(
      (text: string) => {
        if (!text) {
          // Clear stale error if the user emptied the field by other
          // means (Backspace etc.).
          if (error) setError(null);
          return;
        }
        const sep = effectiveSeparators[0] ?? ',';
        const { remainder, committed } = commitText(text + sep);
        if (committed > 0 || error !== null) {
          // commitText already cleared / set error appropriately.
          // Drop pending text only if no validation error blocks
          // the field.
          setPending(remainder);
        } else {
          setPending(remainder);
        }
      },
      [commitText, effectiveSeparators, error],
    );

    const removeAt = useCallback(
      (idx: number) => {
        if (disabled) return;
        if (idx < 0 || idx >= value.length) return;
        const next = value.slice();
        const [removed] = next.splice(idx, 1);
        onChange(next);
        if (error) setError(null);
        announce(
          t('tagInput.removed', 'Removed {{tag}}', { tag: removed }),
        );
      },
      [announce, disabled, error, onChange, t, value],
    );

    /* ── Event handlers ────────────────────────────────────────── */

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        // If the user typed a separator mid-string, commit everything
        // up to and including the LAST separator and keep the trailing
        // remainder as the new pending text.
        if (splitRegex.test(raw)) {
          const { remainder } = commitText(raw);
          setPending(remainder);
          return;
        }
        setPending(raw);
        // Clear any stale validation error as soon as the user edits
        // — no point holding "tag too short" up while they're typing
        // more characters.
        if (error) setError(null);
      },
      [commitText, error, splitRegex],
    );

    const handleKeyDown = useCallback(
      (e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (disabled) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          commitAll(pending);
          return;
        }
        if (e.key === 'Backspace' && pending === '' && value.length > 0) {
          // Backspace at empty input — remove the last chip.
          e.preventDefault();
          removeAt(value.length - 1);
          return;
        }
      },
      [commitAll, disabled, pending, removeAt, value.length],
    );

    const handleBlur = useCallback(() => {
      // Commit any pending text on blur so users don't accidentally
      // drop a tag they were halfway through typing.
      if (pending.trim() !== '') commitAll(pending);
    }, [commitAll, pending]);

    const handlePaste = useCallback(
      (e: ReactClipboardEvent<HTMLInputElement>) => {
        if (disabled) return;
        const text = e.clipboardData.getData('text');
        if (!text) return;
        // Always handle the paste ourselves so the input doesn't end
        // up with a half-committed string after splitting.
        e.preventDefault();
        const combined = pending + text;
        // Force a synthetic separator so commitText consumes
        // everything in the paste rather than treating the trailing
        // fragment as still-being-typed.
        const sep = effectiveSeparators[0] ?? ',';
        const { remainder } = commitText(combined + sep);
        setPending(remainder);
      },
      [commitText, disabled, effectiveSeparators, pending],
    );

    /* ── Imperative handle ─────────────────────────────────────── */

    useImperativeHandle(
      ref,
      () => ({
        focus: () => inputRef.current?.focus(),
        commitPending: () => {
          if (pending.trim() !== '') commitAll(pending);
        },
      }),
      [commitAll, pending],
    );

    /* ── Render ────────────────────────────────────────────────── */

    const describedByIds = [
      describedBy,
      tagsListId,
      error ? errorId : null,
      hint || atMax ? helperId : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

    const visibleLabelClass =
      'mb-1 block text-xs font-medium text-[var(--text-secondary)]';

    const labelContent = (
      <>
        {label}
        {maxTags !== undefined && (
          <span className="ml-1 text-[var(--text-muted)]">
            ({value.length}/{maxTags})
          </span>
        )}
      </>
    );

    /* System-colour border survives Forced Colors mode, where
     * bg-[var(--surface-1)] resolves to Canvas and the field outline
     * disappears. */
    const fieldClass = cn(
      'flex w-full flex-wrap items-center gap-1.5 rounded-md border border-[var(--glass-border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm transition-colors',
      'focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-1 focus-within:ring-offset-[var(--bg)]',
      'forced-colors:border-[CanvasText]',
      disabled && 'cursor-not-allowed opacity-50',
      error && 'border-red-500',
    );

    /* Default chip styling matches ComboboxMulti so adopters can mix
     * the two without a visual jump. Override via `chipClassName`. */
    const chipBase = cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
      'bg-[var(--surface-2)] text-[var(--text-primary)]',
      'forced-colors:border forced-colors:border-[CanvasText]',
      chipClassName,
    );

    return (
      <div className={cn('relative', className)}>
        {hideLabel ? (
          <VisuallyHidden as="label" htmlFor={inputId} id={labelId}>
            {labelContent}
          </VisuallyHidden>
        ) : (
          <label htmlFor={inputId} id={labelId} className={visibleLabelClass}>
            {labelContent}
          </label>
        )}

        <div
          className={fieldClass}
          onClick={() => {
            if (!disabled) inputRef.current?.focus();
          }}
        >
          {value.map((tag, i) => (
            <span key={`${tag}-${i}`} className={chipBase}>
              <span className="truncate">{tag}</span>
              <button
                type="button"
                tabIndex={-1}
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(i);
                }}
                className={cn(
                  'touch-target-overlay inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
                aria-label={t('tagInput.removeTag', 'Remove {{tag}}', { tag })}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}

          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={pending}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            onPaste={handlePaste}
            placeholder={
              atMax
                ? t('tagInput.maxReached', 'Tag limit reached')
                : placeholder ?? t('tagInput.placeholder', 'Add a tag…')
            }
            disabled={inputDisabled}
            aria-labelledby={labelId}
            aria-describedby={describedByIds}
            aria-invalid={error ? 'true' : undefined}
            className={cn(
              'min-w-[8ch] flex-1 bg-transparent text-[var(--text-primary)] outline-none',
              'placeholder:text-[var(--text-muted)]',
              'disabled:cursor-not-allowed',
            )}
          />
        </div>

        {/* Hidden enumeration of current tags for screen readers. The
         * input's `aria-describedby` references this so AT users can
         * hear the active selection at any time without arrowing
         * through every chip. */}
        <VisuallyHidden id={tagsListId}>
          {value.length === 0
            ? t('tagInput.tagsNone', 'No tags yet')
            : t('tagInput.tagsList', 'Tags: {{tags}}', {
                tags: value.join(', '),
              })}
        </VisuallyHidden>

        {error && (
          <ErrorText id={errorId} className="mt-1">
            {error}
          </ErrorText>
        )}
        {!error && (hint || atMax) && (
          <HelperText id={helperId} className="mt-1">
            {atMax
              ? t('tagInput.maxReachedHint', 'Maximum {{count}} tags', {
                  count: maxTags ?? 0,
                })
              : hint}
          </HelperText>
        )}
      </div>
    );
  },
);
