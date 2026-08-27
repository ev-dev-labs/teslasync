/**
 * WAI-ARIA combobox / autocomplete primitive.
 *
 * Implements the shared "type to filter then pick" pattern for signal
 * pickers, geocoded address inputs, vehicle pickers, and similar UI.
 * Centralizing it gives us one place to get the keyboard and
 * screen-reader contract right.
 *
 * a11y contract
 * -------------
 * Follows WAI-ARIA 1.2 combobox pattern (no `aria-owns` because
 * `aria-controls` covers the same ground in modern AT). Specifically
 * the input renders:
 *
 *   role="combobox"
 *   aria-autocomplete="list"
 *   aria-haspopup="listbox"
 *   aria-expanded={open}
 *   aria-controls={listboxId}
 *   aria-activedescendant={activeOptionId}
 *
 * The listbox renders `role="listbox"` with `role="option"` children,
 * each carrying `aria-selected`. Focus stays on the input — only the
 * `aria-activedescendant` reference moves as the user arrows through
 * options. This is the recommended pattern for editable comboboxes.
 *
 * Selection / cancellation:
 *   - ↑ / ↓ move the active descendant
 *   - Home / End jump to first / last
 *   - Enter commits the highlighted option (or, when allowFreeText,
 *     commits the typed text)
 *   - Esc closes without committing and reverts the visible text
 *   - Tab commits highlighted option (if any) then continues tab order
 *   - Click outside closes without committing
 *
 * For async option fetching, every new keystroke cancels the previous
 * in-flight request.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAnnouncer } from '@/hooks/useAnnouncer';
import { VisuallyHidden } from '@/components/a11y';

/* ── Shared types ──────────────────────────────────────────────── */

/**
 * Options can be a static array or an async loader. The loader
 * receives the current input text and an `AbortSignal` that fires
 * when a newer keystroke arrives — implementations MUST forward the
 * signal to fetch / cancellable APIs to avoid races.
 */
export type ComboboxOptions<T> =
  | readonly T[]
  | ((query: string, signal: AbortSignal) => Promise<readonly T[]>);

export interface ComboboxProps<T> {
  /** Currently selected option (`null` = nothing selected). */
  value: T | null;
  /** Fired when the user picks an option (or clears the selection). */
  onChange: (value: T | null) => void;
  /** Static array OR async loader (see `ComboboxOptions`). */
  options: ComboboxOptions<T>;
  /** Returns the visible label for an option. */
  getOptionLabel: (option: T) => string;
  /** Returns a stable string key for an option (for React keys + aria ids). */
  getOptionKey: (option: T) => string;
  /**
   * Equality test used to highlight the currently-selected option in
   * the dropdown. Defaults to comparing keys via `getOptionKey`.
   */
  isOptionEqualToValue?: (a: T, b: T) => boolean;
  /**
   * Required visible OR aria-label. Pair with `hideLabel` when the
   * surrounding context already names the field (e.g. inside a panel
   * header).
   */
  label: string;
  /** When true, label is rendered visually-hidden (still announced). */
  hideLabel?: boolean;
  /** ID of an element that further describes the field. */
  describedBy?: string;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Override the loading indicator. When the options prop is a
   * function this is also derived from in-flight fetches; pass
   * explicit `loading` for parent-driven loading state.
   */
  loading?: boolean;
  /**
   * When true, pressing Enter without an active option commits the
   * raw typed text via {@link onFreeTextCommit}. Used by inputs whose
   * value is not constrained to the options list (tag entry, address
   * geocoding fallback).
   */
  allowFreeText?: boolean;
  /** Fired on free-text commit. Only meaningful when allowFreeText is true. */
  onFreeTextCommit?: (text: string) => void;
  /**
   * Controlled input text. When omitted, the component manages its
   * own internal text and resets to the selected option's label on
   * close.
   */
  inputValue?: string;
  /** Fires whenever the user types (or clears). */
  onInputChange?: (text: string) => void;
  /** Cap visible options for performance. Defaults to 50. */
  maxVisibleOptions?: number;
  /** Custom option renderer (defaults to `getOptionLabel`). */
  renderOption?: (
    option: T,
    state: { active: boolean; selected: boolean },
  ) => ReactNode;
  /** Async fetch debounce in ms. Defaults to 200. Ignored for static arrays. */
  asyncDebounceMs?: number;
  /** Outer wrapper className. */
  className?: string;
  /** Override the input element className. */
  inputClassName?: string;
  /** Optional leading icon shown inside the input. */
  icon?: ReactNode;
  /** Hide the trailing chevron toggle. */
  noChevron?: boolean;
  /** When true, the input's clear (×) button is hidden. */
  noClearButton?: boolean;
}

/* ── Static-array filter (default behaviour) ──────────────────── */

function defaultFilter<T>(
  options: readonly T[],
  query: string,
  getLabel: (o: T) => string,
): readonly T[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => getLabel(o).toLowerCase().includes(q));
}

/* ── Shared input styling — mirrors @/components/ui/Input ─────── */

const INPUT_BASE = cn(
  'w-full rounded-md border border-[var(--glass-border)] bg-[var(--surface-1)] text-[var(--text-primary)] transition-colors',
  'px-3 py-2 text-sm',
  'placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-[var(--bg)]',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

/* ── Component ─────────────────────────────────────────────────── */

export function Combobox<T>(props: ComboboxProps<T>) {
  const {
    value,
    onChange,
    options,
    getOptionLabel,
    getOptionKey,
    isOptionEqualToValue,
    label,
    hideLabel = false,
    describedBy,
    placeholder,
    disabled = false,
    loading: loadingProp = false,
    allowFreeText = false,
    onFreeTextCommit,
    inputValue: inputValueProp,
    onInputChange,
    maxVisibleOptions = 50,
    renderOption,
    asyncDebounceMs = 200,
    className,
    inputClassName,
    icon,
    noChevron = false,
    noClearButton = false,
  } = props;

  const { t } = useTranslation();
  const { announce } = useAnnouncer();

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const generatedId = useId();
  const inputId = `${generatedId}-input`;
  const labelId = `${generatedId}-label`;
  const listboxId = `${generatedId}-listbox`;
  const statusId = `${generatedId}-status`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [internalText, setInternalText] = useState<string>(
    value ? getOptionLabel(value) : '',
  );
  const [asyncOptions, setAsyncOptions] = useState<readonly T[] | null>(null);
  const [asyncLoading, setAsyncLoading] = useState(false);
  const lastAnnouncedRef = useRef<string>('');

  /* Controlled vs uncontrolled input text. */
  const isInputControlled = inputValueProp !== undefined;
  const inputValue = isInputControlled
    ? (inputValueProp ?? '')
    : internalText;

  /* Sync uncontrolled internal text when the selected value changes
   * (e.g. parent reset). Only runs while the input is closed so the
   * user's in-progress typing is never clobbered. */
  useEffect(() => {
    if (isInputControlled) return;
    if (open) return;
    setInternalText(value ? getOptionLabel(value) : '');
  }, [value, open, isInputControlled, getOptionLabel]);

  const isAsync = typeof options === 'function';

  /* Async options: re-fetch on inputValue change with debounced
   * abort-on-keystroke. Static-array branch never runs this effect. */
  useEffect(() => {
    if (!isAsync) {
      setAsyncOptions(null);
      setAsyncLoading(false);
      return;
    }
    if (!open && !inputValue) {
      // Don't fire fetches before the user opens the dropdown.
      return;
    }
    const controller = new AbortController();
    const debounceId = setTimeout(() => {
      setAsyncLoading(true);
      Promise.resolve(
        (options as (q: string, signal: AbortSignal) => Promise<readonly T[]>)(
          inputValue,
          controller.signal,
        ),
      )
        .then((next) => {
          if (controller.signal.aborted) return;
          setAsyncOptions(next ?? []);
          setAsyncLoading(false);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          if (err && (err as { name?: string }).name === 'AbortError') return;
          setAsyncOptions([]);
          setAsyncLoading(false);
        });
    }, asyncDebounceMs);
    return () => {
      clearTimeout(debounceId);
      controller.abort();
    };
  }, [isAsync, options, inputValue, open, asyncDebounceMs]);

  const loading = loadingProp || asyncLoading;

  /* Compute the options visible in the dropdown right now. For the
   * static-array case we filter locally; the async case renders
   * whatever the loader returned (loaders own their own filtering). */
  const filteredOptions = useMemo<readonly T[]>(() => {
    if (isAsync) return asyncOptions ?? [];
    return defaultFilter(options as readonly T[], inputValue, getOptionLabel);
  }, [isAsync, asyncOptions, options, inputValue, getOptionLabel]);

  const visibleOptions = useMemo<readonly T[]>(
    () => filteredOptions.slice(0, maxVisibleOptions),
    [filteredOptions, maxVisibleOptions],
  );

  /* Announce result count (debounced via the natural async cycle) so
   * screen-reader users get "5 results" feedback as they type. */
  useEffect(() => {
    if (!open) return;
    if (loading) return;
    const count = filteredOptions.length;
    const message =
      count === 0
        ? t('combobox.noResults', 'No results')
        : count === 1
          ? t('combobox.resultsCountOne', '1 result')
          : t('combobox.resultsCount', '{{count}} results', { count });
    if (message !== lastAnnouncedRef.current) {
      lastAnnouncedRef.current = message;
      announce(message);
    }
  }, [open, loading, filteredOptions.length, announce, t]);

  const eq = useCallback(
    (a: T, b: T): boolean => {
      if (isOptionEqualToValue) return isOptionEqualToValue(a, b);
      return getOptionKey(a) === getOptionKey(b);
    },
    [isOptionEqualToValue, getOptionKey],
  );

  /* Reset the active index whenever the visible options change so we
   * never point at a now-missing row. Default to first option when
   * dropdown is open and there are options. */
  useEffect(() => {
    if (!open || visibleOptions.length === 0) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex((prev) => {
      if (prev >= 0 && prev < visibleOptions.length) return prev;
      return 0;
    });
  }, [open, visibleOptions]);

  /* ── Imperative helpers ────────────────────────────────────── */

  const updateInputText = useCallback(
    (next: string) => {
      if (!isInputControlled) setInternalText(next);
      onInputChange?.(next);
    },
    [isInputControlled, onInputChange],
  );

  const commitOption = useCallback(
    (opt: T) => {
      onChange(opt);
      updateInputText(getOptionLabel(opt));
      setOpen(false);
      setActiveIndex(-1);
    },
    [onChange, updateInputText, getOptionLabel],
  );

  const commitFreeText = useCallback(
    (text: string) => {
      onFreeTextCommit?.(text);
      // Free-text commit clears any structured selection — the value
      // no longer matches the typed text.
      onChange(null);
      setOpen(false);
      setActiveIndex(-1);
    },
    [onFreeTextCommit, onChange],
  );

  const closeWithoutCommit = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    if (!isInputControlled) {
      setInternalText(value ? getOptionLabel(value) : '');
    }
  }, [isInputControlled, value, getOptionLabel]);

  const handleClear = useCallback(() => {
    onChange(null);
    updateInputText('');
    setActiveIndex(-1);
    inputRef.current?.focus();
    setOpen(true);
  }, [onChange, updateInputText]);

  /* ── Event handlers ────────────────────────────────────────── */

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateInputText(e.target.value);
      if (!open) setOpen(true);
    },
    [updateInputText, open],
  );

  const handleInputFocus = useCallback(() => {
    if (disabled) return;
    setOpen(true);
  }, [disabled]);

  const handleWrapperBlur = useCallback(
    (e: ReactFocusEvent<HTMLDivElement>) => {
      // Skip when focus moves to another element inside the wrapper
      // (option click, chevron click, clear-button click). Without
      // this guard the dropdown closes before the option's onMouseDown
      // can fire.
      if (wrapperRef.current?.contains(e.relatedTarget as Node | null)) return;
      closeWithoutCommit();
    },
    [closeWithoutCommit],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          if (!open) {
            setOpen(true);
            return;
          }
          if (visibleOptions.length === 0) return;
          setActiveIndex((prev) =>
            prev < visibleOptions.length - 1 ? prev + 1 : 0,
          );
          return;
        }
        case 'ArrowUp': {
          e.preventDefault();
          if (!open) {
            setOpen(true);
            return;
          }
          if (visibleOptions.length === 0) return;
          setActiveIndex((prev) =>
            prev > 0 ? prev - 1 : visibleOptions.length - 1,
          );
          return;
        }
        case 'Home': {
          if (!open) return;
          e.preventDefault();
          setActiveIndex(0);
          return;
        }
        case 'End': {
          if (!open) return;
          e.preventDefault();
          setActiveIndex(visibleOptions.length - 1);
          return;
        }
        case 'Enter': {
          if (open && activeIndex >= 0 && activeIndex < visibleOptions.length) {
            e.preventDefault();
            commitOption(visibleOptions[activeIndex]);
          } else if (allowFreeText && inputValue.trim().length > 0) {
            e.preventDefault();
            commitFreeText(inputValue.trim());
          }
          return;
        }
        case 'Escape': {
          if (!open) return;
          e.preventDefault();
          closeWithoutCommit();
          return;
        }
        case 'Tab': {
          // Commit a highlighted option on Tab so the user can keep
          // moving through the form without losing their pick.
          if (open && activeIndex >= 0 && activeIndex < visibleOptions.length) {
            commitOption(visibleOptions[activeIndex]);
          } else {
            closeWithoutCommit();
          }
          return;
        }
        default:
          return;
      }
    },
    [
      disabled,
      open,
      visibleOptions,
      activeIndex,
      commitOption,
      allowFreeText,
      inputValue,
      commitFreeText,
      closeWithoutCommit,
    ],
  );

  /* Close on document mousedown outside the wrapper (covers the
   * "user clicked the page background" path which `onBlur` doesn't
   * see when focus stays in the body). */
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (ev: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(ev.target as Node)) return;
      closeWithoutCommit();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open, closeWithoutCommit]);

  /* ── Render ────────────────────────────────────────────────── */

  const activeOptionId =
    open && activeIndex >= 0 && activeIndex < visibleOptions.length
      ? `${listboxId}-opt-${getOptionKey(visibleOptions[activeIndex])}`
      : undefined;

  const showClear =
    !noClearButton && !disabled && (value !== null || inputValue.length > 0);

  const visibleLabelClass =
    'mb-1 block text-xs font-medium text-[var(--text-secondary)]';

  return (
    <div
      ref={wrapperRef}
      className={cn('relative', className)}
      onBlur={handleWrapperBlur}
    >
      {hideLabel ? (
        <VisuallyHidden as="label" htmlFor={inputId} id={labelId}>
          {label}
        </VisuallyHidden>
      ) : (
        <label htmlFor={inputId} id={labelId} className={visibleLabelClass}>
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          >
            {icon}
          </span>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          aria-labelledby={labelId}
          aria-describedby={describedBy ?? statusId}
          aria-disabled={disabled || undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={placeholder}
          value={inputValue}
          // Exposes the full selected value on hover via the native tooltip
          // when the trigger is closed — otherwise a long option label (e.g.
          // a vehicle VIN or a long signal name) is silently clipped at the
          // input's right edge with no way to read the rest without opening
          // the dropdown. Suppressed while open/typing so it doesn't shadow
          // the in-progress filter text.
          title={!open && inputValue ? inputValue : undefined}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          onClick={() => {
            if (!disabled && !open) setOpen(true);
          }}
          className={cn(
            INPUT_BASE,
            'text-ellipsis',
            icon && 'pl-10',
            (showClear || !noChevron || loading) && 'pr-16',
            inputClassName,
          )}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {loading && (
            <span
              className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-transparent"
              role="status"
              aria-label={t('combobox.loading', 'Loading')}
            />
          )}
          {showClear && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleClear}
              aria-label={t('combobox.clearAria', 'Clear selection')}
              className="touch-target-overlay rounded p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {!noChevron && (
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (disabled) return;
                if (open) {
                  closeWithoutCommit();
                } else {
                  setOpen(true);
                  inputRef.current?.focus();
                }
              }}
              aria-label={
                open
                  ? t('combobox.closeListAria', 'Hide options')
                  : t('combobox.openListAria', 'Show options')
              }
              className="rounded p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform',
                  open && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      </div>
      {/* SR status announcement target — kept in sync via useAnnouncer
       * but a static fallback aria-describedby still helps NVDA pick
       * up "loading" hints when the announcer hasn't been mounted by
       * the surrounding test harness. */}
      <VisuallyHidden id={statusId}>
        {loading ? t('combobox.loading', 'Loading') : ''}
      </VisuallyHidden>
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-md border border-[var(--glass-border)] bg-[var(--surface-1)] py-1 shadow-lg"
        >
          {visibleOptions.length === 0 && !loading && (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="px-3 py-2 text-xs text-[var(--text-muted)]"
            >
              {t('combobox.noResults', 'No results')}
            </li>
          )}
          {visibleOptions.length === 0 && loading && (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="px-3 py-2 text-xs text-[var(--text-muted)]"
            >
              {t('combobox.loading', 'Loading')}
            </li>
          )}
          {visibleOptions.map((opt, i) => {
            const optionId = `${listboxId}-opt-${getOptionKey(opt)}`;
            const isActive = i === activeIndex;
            const isSelected = value !== null && eq(opt, value);
            return (
              <li
                key={getOptionKey(opt)}
                id={optionId}
                role="option"
                aria-selected={isSelected}
                // A plain `title` is inert markup — it adds a native hover
                // tooltip without touching ARIA semantics or introducing
                // nested interactive elements, so it's safe to surface the
                // full label even when `renderOption` owns the visible
                // content (e.g. a custom row that itself truncates/clamps).
                title={getOptionLabel(opt)}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => commitOption(opt)}
                className={cn(
                  'cursor-pointer px-3 py-1.5 text-sm text-[var(--text-primary)] transition-colors',
                  // `truncate` (incl. `white-space: nowrap`) only applies to
                  // the default plain-label branch. A custom `renderOption`
                  // owns its own layout — e.g. AddressInput's
                  // `line-clamp-2` needs normal wrapping, which an inherited
                  // `nowrap` from this `<li>` would silently defeat.
                  !renderOption && 'truncate',
                  isActive && 'bg-[var(--surface-2)]',
                  isSelected && 'font-semibold',
                )}
              >
                {renderOption
                  ? renderOption(opt, { active: isActive, selected: isSelected })
                  : getOptionLabel(opt)}
              </li>
            );
          })}
          {filteredOptions.length > visibleOptions.length && (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="border-t border-[var(--glass-border)] px-3 py-1.5 text-2xs text-[var(--text-muted)]"
            >
              {t('combobox.moreHidden', '{{count}} more — refine search', {
                count: filteredOptions.length - visibleOptions.length,
              })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
