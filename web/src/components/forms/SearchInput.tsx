import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type FocusEvent as ReactFocusEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  recordSearch,
  getRecentSearches,
  removeSearch,
  clearScope,
  MIN_QUERY_LEN,
} from '@/lib/searchHistory';

export interface SearchInputProps {
  /** Current committed value (controlled). */
  value: string;
  /** Called with the new value once the debounce window elapses. */
  onChange: (value: string) => void;
  /** Programmatic label for the underlying search field. */
  ariaLabel?: string;
  /** Placeholder shown when the field is empty. */
  placeholder?: string;
  /** Debounce window in milliseconds. Defaults to 250ms. */
  debounceMs?: number;
  /** Auto-focus the field on mount. */
  autoFocus?: boolean;
  /** Optional class applied to the outer wrapper (use for sizing). */
  className?: string;
  /** Optional accessible label for the clear button. */
  clearLabel?: string;
  /**
   * Enables the recent-searches dropdown. The string is the storage scope
   * (e.g. `'drives'`, `'admin:audit'`); each scope has its own independent
   * history. Omit to keep the field history-less.
   */
  historyScope?: string;
  /**
   * When `historyScope` is set, controls whether focusing the empty field
   * shows the recent-searches dropdown. Defaults to `true`.
   */
  showHistoryOnFocus?: boolean;
  /**
   * Maximum number of history entries to render in the dropdown. Defaults
   * to 8. Capped internally by the storage capacity.
   */
  maxHistory?: number;
}

/**
 * Debounced search input with leading magnifier icon and trailing clear button.
 *
 * The `value` prop is controlled by the parent. Local typing state is buffered
 * until `debounceMs` elapses, then `onChange` fires with the latest text. The
 * clear button immediately resets to an empty string and emits `onChange('')`.
 *
 * Rendered as a wrapper around the shared `<Input>` component using its `icon`
 * and `suffix` slots so styling stays consistent with other form fields.
 *
 * When `historyScope` is set, the field also exposes a "recent searches"
 * dropdown that shows when the input is focused with an empty value. Entries
 * are recorded automatically on Enter / blur (≥ {@link MIN_QUERY_LEN} chars,
 * after trimming) and persist to localStorage via `@/lib/searchHistory`.
 */
export function SearchInput({
  value,
  onChange,
  ariaLabel,
  placeholder,
  debounceMs = 250,
  autoFocus,
  className,
  clearLabel,
  historyScope,
  showHistoryOnFocus = true,
  maxHistory = 8,
}: SearchInputProps) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const [entries, setEntries] = useState<string[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // Re-sync from the parent if the controlled value changes externally
  // (e.g. consumer resets the filter).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  // Debounce: only emit onChange once the user stops typing for `debounceMs`.
  useEffect(() => {
    if (local === value) return;
    const id = setTimeout(() => onChange(local), debounceMs);
    return () => clearTimeout(id);
  }, [local, value, debounceMs, onChange]);

  const refreshEntries = useCallback(() => {
    if (!historyScope) {
      setEntries([]);
      return;
    }
    setEntries(getRecentSearches(historyScope, maxHistory));
  }, [historyScope, maxHistory]);

  const dropdownVisible = useMemo(
    () =>
      Boolean(historyScope) &&
      showHistoryOnFocus &&
      isFocused &&
      local === '' &&
      entries.length > 0,
    [historyScope, showHistoryOnFocus, isFocused, local, entries.length],
  );

  const handleClear = useCallback(() => {
    setLocal('');
    setActiveIdx(-1);
    refreshEntries();
  }, [refreshEntries]);

  const handleFocus = useCallback(() => {
    refreshEntries();
    setIsFocused(true);
    setActiveIdx(-1);
  }, [refreshEntries]);

  const commitToHistory = useCallback(() => {
    if (!historyScope) return;
    if (local.trim().length >= MIN_QUERY_LEN) {
      recordSearch(historyScope, local);
    }
  }, [historyScope, local]);

  const handleWrapperBlur = useCallback(
    (e: ReactFocusEvent<HTMLDivElement>) => {
      // Closing the dropdown only when focus leaves the entire wrapper.
      // Clicks on dropdown rows/buttons preserve input focus via
      // `onMouseDown=preventDefault`, so this branch covers the
      // "user clicked elsewhere on the page" case.
      if (wrapperRef.current?.contains(e.relatedTarget as Node | null)) return;
      setIsFocused(false);
      setActiveIdx(-1);
      commitToHistory();
    },
    [commitToHistory],
  );

  const selectEntry = useCallback(
    (entry: string) => {
      setLocal(entry);
      // Skip the debounce for an explicit selection so the parent sees the
      // chosen query immediately.
      onChange(entry);
      if (historyScope) recordSearch(historyScope, entry);
      setActiveIdx(-1);
      // Keep input focus so the user can refine without re-clicking; the
      // dropdown hides naturally once `local !== ''`.
      inputRef.current?.focus();
    },
    [historyScope, onChange],
  );

  const handleRemoveEntry = useCallback(
    (entry: string) => {
      if (!historyScope) return;
      removeSearch(historyScope, entry);
      const next = getRecentSearches(historyScope, maxHistory);
      setEntries(next);
      setActiveIdx((prev) => Math.min(prev, next.length - 1));
      inputRef.current?.focus();
    },
    [historyScope, maxHistory],
  );

  const handleClearAll = useCallback(() => {
    if (!historyScope) return;
    clearScope(historyScope);
    setEntries([]);
    setActiveIdx(-1);
    inputRef.current?.focus();
  }, [historyScope]);

  const handleInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        if (dropdownVisible) {
          e.preventDefault();
          setIsFocused(false);
          setActiveIdx(-1);
        }
        return;
      }
      if (e.key === 'Enter') {
        if (dropdownVisible && activeIdx >= 0 && activeIdx < entries.length) {
          e.preventDefault();
          selectEntry(entries[activeIdx]);
        } else if (historyScope && local.trim().length >= MIN_QUERY_LEN) {
          recordSearch(historyScope, local);
        }
        return;
      }
      if (!dropdownVisible) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((prev) => Math.min(prev + 1, entries.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((prev) => Math.max(prev - 1, -1));
      }
    },
    [dropdownVisible, activeIdx, entries, historyScope, local, selectEntry],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocal(e.target.value);
    setActiveIdx(-1);
  }, []);

  const label = clearLabel ?? t('common.clear', 'Clear');
  const historyEnabled = Boolean(historyScope);
  const activeOptionId = activeIdx >= 0 ? `${listboxId}-opt-${activeIdx}` : undefined;

  return (
    <div
      ref={wrapperRef}
      className={cn('relative', className)}
      onBlur={historyEnabled ? handleWrapperBlur : undefined}
    >
      <Input
        ref={inputRef}
        type="search"
        value={local}
        onChange={handleInputChange}
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onFocus={historyEnabled ? handleFocus : undefined}
        onKeyDown={historyEnabled ? handleInputKeyDown : undefined}
        role={historyEnabled ? 'combobox' : undefined}
        aria-autocomplete={historyEnabled ? 'list' : undefined}
        aria-expanded={historyEnabled ? dropdownVisible : undefined}
        aria-controls={historyEnabled && dropdownVisible ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
        aria-haspopup={historyEnabled ? 'listbox' : undefined}
        icon={<Search className="h-4 w-4" aria-hidden />}
        suffix={local ? (
          <button
            type="button"
            onClick={handleClear}
            className="touch-target-overlay rounded p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label={label}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : undefined}
      />
      {dropdownVisible && (
        <div
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-[var(--glass-border)] bg-[var(--surface-1)] shadow-lg"
        >
          <div className="px-3 py-1.5 text-2xs uppercase tracking-wider text-[var(--text-muted)]">
            {t('search.history.title', 'Recent searches')}
          </div>
          <ul
            id={listboxId}
            role="listbox"
            aria-label={t('search.history.title', 'Recent searches')}
            className="max-h-64 overflow-y-auto py-1"
          >
            {entries.map((entry, i) => {
              const optionId = `${listboxId}-opt-${i}`;
              const isActive = i === activeIdx;
              return (
                <li
                  key={`${entry}-${i}`}
                  id={optionId}
                  role="option"
                  aria-selected={isActive}
                >
                  <div className="flex items-center gap-1 px-2">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectEntry(entry)}
                      onMouseEnter={() => setActiveIdx(i)}
                      className={cn(
                        'flex flex-1 items-center gap-2 truncate rounded px-2 py-1.5 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-2)] focus:outline-none',
                        isActive && 'bg-[var(--surface-2)]',
                      )}
                    >
                      <Search className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-muted)]" aria-hidden />
                      <span className="truncate">{entry}</span>
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleRemoveEntry(entry)}
                      aria-label={t('search.history.removeAria', 'Remove "{{query}}" from search history', { query: entry })}
                      className="touch-target-overlay rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-[var(--glass-border)] px-2 py-1">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleClearAll}
              className="w-full rounded px-2 py-1 text-left text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {t('search.history.clear', 'Clear history')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
