/**
 * `<EditableText>` inline-edit primitive.
 *
 * Replaces "open a Modal to rename" flows with a faster double-click
 * (or Enter/F2) → input → Enter-to-save / Escape-to-cancel pattern.
 *
 * Display surface
 * ---------------
 * By default the display state renders a transparent
 * button-styled-as-text — this gives us native keyboard semantics
 * (focusable, Enter/Space activate, screen readers announce as a
 * button) without manually wiring `tabIndex`, `role="button"`, and a
 * keydown handler. Double-click also enters edit mode.
 *
 * For surfaces where the value already lives inside a navigation
 * affordance (e.g. a `<Link>` on a table row), pass the optional
 * `display` render prop. It receives `{ value, onStartEdit }` so the
 * caller can render `Link + pencil button` and forward the pencil's
 * onClick to `onStartEdit`. We deliberately do NOT try to make
 * double-click on a `<Link>` enter edit mode — single-click navigation
 * fires before `dblclick` in every browser, so the affordance has to
 * be a separate element.
 *
 * Save flow
 * ---------
 * `commitDraft()` is the single commit path. It guards against:
 *   - rapid Enter+blur double-fires (`savingRef`)
 *   - duplicate submit of the same string (`lastSubmittedRef`)
 *   - validation errors (Enter blocked, blur stays in edit mode)
 *   - no-op edits where `trim(draft) === trim(value)` (just exit)
 *
 * On `onSave()` rejection we stay in edit mode, show the error via
 * `ErrorText`, and keep focus on the input so the user can retry
 * without losing their typed value.
 *
 * On success we exit edit mode and fire a screen-reader announcement
 * via the shared `useAnnouncer()` so the change is voiced even though
 * the visible state change is subtle.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';

import { cn } from '@/lib/cn';
import { useAnnouncer } from '@/hooks/useAnnouncer';
import { ErrorText } from './Typography';

export type EditableTextVariant = 'body' | 'heading';

export interface EditableTextDisplayProps {
  /** Current saved value (NOT the in-flight draft). */
  value: string;
  /** Imperatively enter edit mode — wire to a pencil button onClick. */
  onStartEdit: () => void;
  /** True when `disabled` is set on the parent. */
  disabled: boolean;
}

export interface EditableTextProps {
  /** The currently-saved value. Becomes the starting point for each edit. */
  value: string;
  /**
   * Called with the trimmed next value when the user commits a non-empty,
   * valid, changed draft. Must return a Promise so we can show a Spinner
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
   * (e.g. "Rename geofence Home"). Used as the button's aria-label
   * AND the input's aria-label, so screen readers know what's being
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
   * button-styled-as-text that enters edit mode on click, double-click,
   * Enter, or F2.
   */
  display?: (props: EditableTextDisplayProps) => ReactNode;
  /** Optional className for the outer wrapper. */
  className?: string;
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
  className,
}: EditableTextProps) {
  const { t } = useTranslation();
  const { announce } = useAnnouncer();
  const reactId = useId();
  const inputId = `editable-${reactId}`;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
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
    if (disabled) return;
    setDraft(value);
    setError(null);
    lastSubmittedRef.current = null;
    setEditing(true);
  }, [disabled, value]);

  const cancelEdit = useCallback(() => {
    if (savingRef.current) return;
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
    if (savingRef.current) return false;

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
      if (v) validationError = v;
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
      announce(
        t('editableText.announce.saved', '{{label}} saved', { label: ariaLabel }),
      );
      return true;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('editableText.error.saveFailed', 'Save failed');
      setError(message);
      // Keep focus on the input so the user can fix and retry.
      queueMicrotask(() => inputRef.current?.focus());
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [announce, ariaLabel, draft, onSave, t, validate, value]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.currentTarget.value;
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

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void commitDraft();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
        return;
      }
    },
    [cancelEdit, commitDraft],
  );

  const handleInputBlur = useCallback(() => {
    if (savingRef.current) return;
    // If the user blurs while invalid, stay in edit mode so the error
    // remains visible and they can fix or Escape out. Otherwise commit.
    if (error) return;
    void commitDraft();
  }, [commitDraft, error]);

  const handleDisplayKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'F2') {
        e.preventDefault();
        startEdit();
      }
      // Enter and Space are native button activations, no extra handler
      // needed — onClick fires for both.
    },
    [startEdit],
  );

  const sizeClass =
    variant === 'heading'
      ? 'text-base font-semibold'
      : 'text-sm font-normal';

  // ─── Edit mode ──────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className={cn('inline-flex flex-col gap-1', className)}>
        <div className="inline-flex items-center gap-2">
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={draft}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
            disabled={saving}
            autoFocus
            placeholder={placeholder}
            maxLength={maxLength}
            aria-label={ariaLabel}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            aria-busy={saving || undefined}
            data-testid="editable-text-input"
            className={cn(
              'rounded-md border border-[var(--glass-border)] bg-[var(--surface-1)] text-[var(--text-primary)] transition-colors',
              'px-2 py-1 placeholder:text-[var(--text-muted)]',
              'focus:outline-none focus:ring-2 focus:ring-blue-500',
              'disabled:cursor-not-allowed disabled:opacity-60',
              sizeClass,
              error && 'border-rose-400',
            )}
          />
          {saving && (
            <span
              role="status"
              aria-label={t('editableText.saving', 'Saving…')}
              data-testid="editable-text-spinner"
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-transparent"
            />
          )}
        </div>
        {error && (
          <ErrorText id={`${inputId}-error`} className="text-xs">
            {error}
          </ErrorText>
        )}
      </div>
    );
  }

  // ─── Display mode ───────────────────────────────────────────────────

  // Custom display: consumer renders Link + pencil etc.
  if (display) {
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        {display({ value, onStartEdit: startEdit, disabled })}
      </span>
    );
  }

  // Default display: button-styled-as-text. Enter/Space activate
  // (native button), F2 alternative, double-click also enters edit.
  const visibleText = value === '' && placeholder ? placeholder : value;
  const isPlaceholder = value === '' && Boolean(placeholder);

  return (
    <button
      type="button"
      onClick={startEdit}
      onDoubleClick={startEdit}
      onKeyDown={handleDisplayKeyDown}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid="editable-text-trigger"
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left',
        'text-[var(--text-primary)] transition-colors',
        'hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent',
        sizeClass,
        isPlaceholder && 'text-[var(--text-muted)] italic',
        className,
      )}
    >
      <span className="truncate">{visibleText}</span>
      {!disabled && (
        <Pencil
          aria-hidden="true"
          className="h-3 w-3 shrink-0 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      )}
    </button>
  );
}

EditableText.displayName = 'EditableText';
