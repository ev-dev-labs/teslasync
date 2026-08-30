/**
 * WAI-ARIA multi-select combobox primitive.
 * Variant of {@link Combobox} where the value is an array. Selected
 * options render as removable chips inside the field. The text input
 * always represents "what to filter / add next" — never an active
 * selection that hasn't been committed yet.
 * a11y contract
 * -------------
 * Same as Combobox plus `aria-multiselectable="true"` on the listbox.
 * Each chip's remove button has an explicit `aria-label="Remove
 * {{label}}"`. Pressing Backspace at an empty input removes the last
 * chip — a discoverability win for keyboard-only users.
 * The dropdown ALWAYS hides options that are already in `value`, so
 * the user never sees the same row twice.
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
import type { ComboboxOptions } from './Combobox';

export interface ComboboxMultiProps<T> {
  /** Currently selected options. */
  value: T[];
  /** Fired when a chip is added or removed. */
  onChange: (next: T[]) => void;
  /** Static array OR async loader. See {@link ComboboxOptions}. */
  options: ComboboxOptions<T>;
  /** Returns the visible label for an option / chip. */
  getOptionLabel: (option: T) => string;
  /** Returns a stable string key for an option (for React keys + aria ids). */
  getOptionKey: (option: T) => string;
  /** Override the chip label (defaults to `getOptionLabel`). */
  getChipLabel?: (option: T) => string;
  /** Required visible OR aria-label. */
  label: string;
  /** When true, label is rendered visually-hidden. */
  hideLabel?: boolean;
  /** ID of an element that further describes the field. */
  describedBy?: string;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Cap visible dropdown options for performance. Defaults to 50. */
  maxVisibleOptions?: number;
  /** Maximum number of chips allowed. */
  maxItems?: number;
  /** Async fetch debounce in ms. Defaults to 200. Static-array case ignores this. */
  asyncDebounceMs?: number;
  /** Custom option renderer. */
  renderOption?: (
    option: T,
    state: { active: boolean },
  ) => ReactNode;
  /** Outer wrapper className. */
  className?: string;
  /** Optional leading icon shown before the chips. */
  icon?: ReactNode;
  /** Hide the trailing chevron toggle. */
  noChevron?: boolean;
  /** Tailwind class controlling the chip colour family. */
  chipClassName?: string;
}

/* ── Static-array filter ─────────────────────────────────────── */

function defaultFilter<T>(
  options: readonly T[],
  query: string,
  getLabel: (o: T) => string,
): readonly T[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => getLabel(o).toLowerCase().includes(q));
}

/* ── Component ────────────────────────────────────────────────── */

export function ComboboxMulti<T>(props: ComboboxMultiProps<T>) {
  const {
    value,
    onChange,
    options,
    getOptionLabel,
    getOptionKey,
    getChipLabel,
    label,
    hideLabel = false,
    describedBy,
    placeholder,
    disabled = false,
    loading: loadingProp = false,
    maxVisibleOptions = 50,
    maxItems,
    asyncDebounceMs = 200,
    renderOption,
    className,
    icon,
    noChevron = false,
    chipClassName,
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
  const [inputText, setInputText] = useState('');
  const [asyncOptions, setAsyncOptions] = useState<readonly T[] | null>(null);
  const [asyncLoading, setAsyncLoading] = useState(false);
  const lastAnnouncedRef = useRef<string>('');

  const isAsync = typeof options === 'function';

  /* Keys of already-selected options so we can hide them from the
   * dropdown. Memoised against `value` length so chip removals
   * trigger recomputation without referential churn. */
  const selectedKeys = useMemo(
    () => new Set(value.map((v) => getOptionKey(v))),
    [value, getOptionKey],
  );

  const atMax = maxItems !== undefined && value.length >= maxItems;

  /* Async options: re-fetch on inputText change with debounced
   * abort-on-keystroke. */
  useEffect(() => {
    if (!isAsync) {
      setAsyncOptions(null);
      setAsyncLoading(false);
      return;
    }
    if (!open && !inputText) return;
    const controller = new AbortController();
    const debounceId = setTimeout(() => {
      setAsyncLoading(true);
      Promise.resolve(
        (options as (q: string, signal: AbortSignal) => Promise<readonly T[]>)(
          inputText,
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
  }, [isAsync, options, inputText, open, asyncDebounceMs]);

  const loading = loadingProp || asyncLoading;

  /* Filtered + selected-removed options. */
  const filteredOptions = useMemo<readonly T[]>(() => {
    const base: readonly T[] = isAsync
      ? (asyncOptions ?? [])
      : defaultFilter(options as readonly T[], inputText, getOptionLabel);
    return base.filter((o) => !selectedKeys.has(getOptionKey(o)));
  }, [
    isAsync,
    asyncOptions,
    options,
    inputText,
    getOptionLabel,
    selectedKeys,
    getOptionKey,
  ]);

  const visibleOptions = useMemo<readonly T[]>(
    () => filteredOptions.slice(0, maxVisibleOptions),
    [filteredOptions, maxVisibleOptions],
  );

  /* Announce result count for SR. */
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

  /* Reset active index whenever the visible options change. */
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

  const addOption = useCallback(
    (opt: T) => {
      if (atMax) return;
      if (selectedKeys.has(getOptionKey(opt))) return;
      onChange([...value, opt]);
      setInputText('');
      setActiveIndex(-1);
      // Keep dropdown open for rapid multi-select; user closes via
      // Esc or blur.
      inputRef.current?.focus();
    },
    [atMax, selectedKeys, getOptionKey, onChange, value],
  );

  const removeAt = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= value.length) return;
      const next = value.slice();
      const [removed] = next.splice(idx, 1);
      onChange(next);
      announce(
        t('combobox.removedChip', 'Removed {{label}}', {
          label: (getChipLabel ?? getOptionLabel)(removed),
        }),
      );
    },
    [value, onChange, announce, t, getChipLabel, getOptionLabel],
  );

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  /* ── Event handlers ────────────────────────────────────────── */

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputText(e.target.value);
      if (!open) setOpen(true);
    },
    [open],
  );

  const handleInputFocus = useCallback(() => {
    if (disabled) return;
    setOpen(true);
  }, [disabled]);

  const handleWrapperBlur = useCallback(
    (e: ReactFocusEvent<HTMLDivElement>) => {
      if (wrapperRef.current?.contains(e.relatedTarget as Node | null)) return;
      closeDropdown();
    },
    [closeDropdown],
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
            addOption(visibleOptions[activeIndex]);
          }
          return;
        }
        case 'Escape': {
          if (!open) return;
          e.preventDefault();
          closeDropdown();
          return;
        }
        case 'Backspace': {
          // Backspace at an empty input removes the trailing chip.
          if (inputText.length === 0 && value.length > 0) {
            e.preventDefault();
            removeAt(value.length - 1);
          }
          return;
        }
        case 'Tab': {
          if (open && activeIndex >= 0 && activeIndex < visibleOptions.length) {
            addOption(visibleOptions[activeIndex]);
          } else {
            closeDropdown();
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
      addOption,
      inputText,
      value,
      removeAt,
      closeDropdown,
    ],
  );

  /* Close on outside mousedown. */
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (ev: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(ev.target as Node)) return;
      closeDropdown();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open, closeDropdown]);

  /* ── Render ────────────────────────────────────────────────── */

  const activeOptionId =
    open && activeIndex >= 0 && activeIndex < visibleOptions.length
      ? `${listboxId}-opt-${getOptionKey(visibleOptions[activeIndex])}`
      : undefined;

  const visibleLabelClass =
    'mb-1 block text-xs font-medium text-[var(--text-secondary)]';

  const chipBase = cn(
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
    'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    'forced-colors:border forced-colors:border-[CanvasText]',
    chipClassName,
  );

  const labelContent = (
    <>
      {label}
      {maxItems !== undefined && (
        <span className="ml-1 text-[var(--text-muted)]">
          ({value.length}/{maxItems})
        </span>
      )}
    </>
  );

  return (
    <div
      ref={wrapperRef}
      className={cn('relative', className)}
      onBlur={handleWrapperBlur}
    >
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
        className={cn(
          'flex w-full flex-wrap items-center gap-1.5 rounded-md border border-[var(--glass-border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm transition-colors',
          'focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-1 focus-within:ring-offset-[var(--bg)]',
          disabled && 'cursor-not-allowed opacity-50',
        )}
        onClick={() => {
          if (!disabled) inputRef.current?.focus();
        }}
      >
        {icon && (
          <span aria-hidden="true" className="text-[var(--text-muted)]">
            {icon}
          </span>
        )}
        {value.map((opt, i) => (
          <span key={getOptionKey(opt)} className={chipBase}>
            <span className="truncate" title={(getChipLabel ?? getOptionLabel)(opt)}>
              {(getChipLabel ?? getOptionLabel)(opt)}
            </span>
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                removeAt(i);
                inputRef.current?.focus();
              }}
              aria-label={t('combobox.removeChip', 'Remove {{label}}', {
                label: (getChipLabel ?? getOptionLabel)(opt),
              })}
              className="touch-target-overlay rounded p-0.5 transition-colors hover:bg-[var(--surface-overlay)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
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
          aria-disabled={disabled || atMax || undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={
            value.length === 0
              ? placeholder
              : atMax
                ? t('combobox.maxReached', 'Maximum reached')
                : undefined
          }
          value={inputText}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          className="min-w-[6rem] flex-1 bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <div className="ml-auto flex items-center gap-1">
          {loading && (
            <span
              className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-transparent"
              role="status"
              aria-label={t('combobox.loading', 'Loading')}
            />
          )}
          {!noChevron && (
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                if (disabled) return;
                if (open) {
                  closeDropdown();
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
      <VisuallyHidden id={statusId}>
        {loading ? t('combobox.loading', 'Loading') : ''}
      </VisuallyHidden>
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-md border border-[var(--glass-border)] bg-[var(--surface-1)] py-1 shadow-lg"
        >
          {visibleOptions.length === 0 && !loading && (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="px-3 py-2 text-xs text-[var(--text-muted)]"
            >
              {atMax
                ? t('combobox.maxReached', 'Maximum reached')
                : t('combobox.noResults', 'No results')}
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
            return (
              <li
                key={getOptionKey(opt)}
                id={optionId}
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => addOption(opt)}
                className={cn(
                  'cursor-pointer px-3 py-1.5 text-sm text-[var(--text-primary)] transition-colors',
                  isActive && 'bg-[var(--surface-2)]',
                  atMax && 'pointer-events-none opacity-50',
                )}
              >
                {renderOption
                  ? renderOption(opt, { active: isActive })
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
