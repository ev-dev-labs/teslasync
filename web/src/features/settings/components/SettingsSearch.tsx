// Find-as-you-type settings search.
// Renders a single `<Input>` with a popover dropdown of matching
// settings. Each match deep-links to its section anchor on the same
// page; the existing `useEffect` in `SettingsPage` listens for
// `location.hash` and smooth-scrolls into view.
// Matching is delegated to `searchSettings` in `searchIndex.ts` and
// covers substring + keyword + fuzzy-subsequence (e.g. "lng" → "Language").

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Button, Input, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { getSettingsIndex, searchSettings, type SettingsEntry } from '../searchIndex';

const MAX_RESULTS = 8;
// Time given for the URL change to propagate before we fall back to a
// direct `scrollIntoView` for the same-hash case (e.g. user already at
// `#appearance` clicks another appearance entry — `location.hash`
// doesn't change so the page-level scroll effect doesn't fire).
const SCROLL_FALLBACK_DELAY_MS = 300;

export interface SettingsSearchProps {
  /** Optional class applied to the outer wrapper for layout / sizing. */
  className?: string;
}

export function SettingsSearch({ className }: SettingsSearchProps) {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const index = useMemo(() => getSettingsIndex(t), [t]);
  const matches = useMemo(
    () => searchSettings(index, query).slice(0, MAX_RESULTS),
    [index, query],
  );

  // Reset the highlighted row whenever the result set changes so we
  // never end up with `activeIndex >= matches.length`.
  useEffect(() => {
    setActiveIndex(0);
  }, [matches]);

  // Close on click-outside. Mounted only when the dropdown is open so
  // we don't leak a global listener while the user is typing.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const root = wrapperRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  function commit(entry: SettingsEntry) {
    setQuery('');
    setOpen(false);
    navigate(entry.href);
    // Same-hash navigations (e.g. user already at #appearance picks
    // another appearance entry) don't change `location.hash`, so the
    // page-level scroll effect won't fire. Manually scroll after the
    // navigate has had a chance to commit so the browser's anchor
    // resolver and our smooth-scroll behave consistently.
    const id = entry.href.split('#')[1];
    if (!id) return;
    window.setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, SCROLL_FALLBACK_DELAY_MS);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (matches.length === 0) {
      if (event.key === 'Escape') setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = matches[activeIndex];
      if (target) commit(target);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  const showDropdown = open && query.length > 0;
  const placeholder = t('settings.search.placeholder', 'Search settings…');
  const ariaLabel = t('settings.search.label', 'Search settings');

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <Input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-activedescendant={
          showDropdown && matches[activeIndex]
            ? `${listboxId}-option-${matches[activeIndex].id}`
            : undefined
        }
        role="combobox"
        icon={<Search className="h-4 w-4" aria-hidden />}
      />

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            'absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-xl border',
            'border-[var(--glass-border)] bg-[var(--surface-1)] shadow-2xl backdrop-blur-xl',
          )}
        >
          {matches.length === 0 && (
            <li
              role="option"
              aria-selected={false}
              aria-disabled
              className="px-4 py-3 text-xs text-[var(--text-muted)]"
            >
              {t('settings.search.noResults', 'No matching settings.')}
            </li>
          )}
          {matches.map((entry, idx) => {
            const active = idx === activeIndex;
            return (
              <li key={entry.id}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  id={`${listboxId}-option-${entry.id}`}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => commit(entry)}
                  className={cn(
                    'h-auto w-full flex-col items-start gap-0.5 rounded-none px-4 py-2 text-left',
                    'focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-primary)]',
                    active
                      ? 'bg-white/[0.06] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-white/[0.04]',
                  )}
                >
                  <Text variant="body" className="font-medium">{entry.title}</Text>
                  {entry.description && (
                    <Text variant="caption">{entry.description}</Text>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
