import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Compass, LifeBuoy, Search as SearchIcon, Wrench } from 'lucide-react'

import { cn } from '@/lib/cn'
import { Input, Text } from '@/components/ui'
import {
  searchHelpIndex,
  helpEntriesForRoute,
  type HelpEntryKind,
  type HelpIndexEntry,
} from '@/lib/helpIndex'

/**
 * Searchable in-app help index (HELP-06).
 *
 * The static, deterministic baseline: no network, no AI, no ranking that
 * depends on a model or a clock. Typing the same query always produces the
 * same ordered list, which is what makes it usable as documentation.
 *
 * Keyboard model — a combobox over a listbox, wired explicitly because the
 * results are navigational rather than a form value:
 *   ↓ / ↑    move the active option (wrapping)
 *   Enter    navigate to the active option
 *   Escape   clear the query and the active option
 * `aria-activedescendant` keeps DOM focus in the text field while the screen
 * reader announces the active option, so the query stays editable throughout.
 */

const KIND_ICON: Record<HelpEntryKind, typeof BookOpen> = {
  glossary: BookOpen,
  troubleshooting: Wrench,
  task: LifeBuoy,
  page: Compass,
}

const KIND_LABEL: Record<HelpEntryKind, { key: string; fallback: string }> = {
  glossary: { key: 'helpIndex.kind.glossary', fallback: 'Definition' },
  troubleshooting: { key: 'helpIndex.kind.troubleshooting', fallback: 'Troubleshooting' },
  task: { key: 'helpIndex.kind.task', fallback: 'Setup task' },
  page: { key: 'helpIndex.kind.page', fallback: 'Page' },
}

export interface HelpSearchProps {
  /** Current route — seeds the "relevant here" results before any typing. */
  pathname?: string
  className?: string
}

export function HelpSearch({ pathname, className }: HelpSearchProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const trimmed = query.trim()
  const results = useMemo<HelpIndexEntry[]>(() => {
    if (trimmed === '') {
      return pathname ? helpEntriesForRoute(pathname, { limit: 6 }) : []
    }
    return searchHelpIndex(trimmed)
  }, [trimmed, pathname])

  const isSuggesting = trimmed === ''

  const go = useCallback(
    (entry: HelpIndexEntry | undefined) => {
      if (!entry?.route) return
      navigate(entry.route)
    },
    [navigate],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (results.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((index) => (index + 1) % results.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((index) => (index - 1 + results.length) % results.length)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        go(results[activeIndex])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setQuery('')
        setActiveIndex(0)
      }
    },
    [results, activeIndex, go],
  )

  const activeId = results[activeIndex] ? `${listboxId}-${activeIndex}` : undefined

  return (
    <div className={cn('space-y-3', className)} data-testid="help-search">
      <Input
        ref={inputRef}
        type="search"
        role="combobox"
        label={t('helpIndex.searchLabel', 'Search help')}
        placeholder={t(
          'helpIndex.searchPlaceholder',
          'Search terms, pages and troubleshooting — e.g. "phantom drain"',
        )}
        value={query}
        icon={<SearchIcon className="h-4 w-4" aria-hidden />}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={onKeyDown}
        aria-expanded={results.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        data-testid="help-search-input"
      />

      <Text as="p" variant="caption" aria-live="polite" data-testid="help-search-status">
        {isSuggesting
          ? t('helpIndex.relevantHere', 'Relevant to this page')
          : t('helpIndex.resultCount', '{{count}} results', { count: results.length })}
      </Text>

      <ul
        id={listboxId}
        role="listbox"
        aria-label={t('helpIndex.resultsLabel', 'Help results')}
        className="space-y-1.5"
        data-testid="help-search-results"
      >
        {results.map((entry, index) => {
          const Icon = KIND_ICON[entry.kind]
          const kindLabel = KIND_LABEL[entry.kind]
          const active = index === activeIndex
          return (
            <li
              key={entry.id}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={active}
              data-help-entry-id={entry.id}
              className={cn(
                'cursor-pointer rounded-lg border p-2.5 transition-colors',
                active
                  ? 'border-[var(--theme-primary)]/50 bg-[rgba(var(--theme-primary-rgb),0.08)]'
                  : 'border-[var(--glass-border)] bg-[var(--surface-1)] hover:bg-[var(--surface-2)]',
              )}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => go(entry)}
            >
              <div className="flex items-start gap-2.5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--theme-primary)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Text as="span" size="sm" weight="medium" color="primary">
                      {t(entry.titleKey, entry.titleFallback)}
                    </Text>
                    <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-2xs uppercase tracking-wide text-[var(--text-muted)]">
                      {t(kindLabel.key, kindLabel.fallback)}
                    </span>
                  </div>
                  <Text as="p" variant="bodySm" color="muted" className="mt-0.5">
                    {t(entry.summaryKey, entry.summaryFallback)}
                  </Text>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {results.length === 0 && !isSuggesting && (
        <Text as="p" variant="bodySm" color="muted" data-testid="help-search-empty">
          {t(
            'helpIndex.noResults',
            'Nothing in the help index matches that. Try a shorter word, or send a problem report below.',
          )}
        </Text>
      )}
    </div>
  )
}
