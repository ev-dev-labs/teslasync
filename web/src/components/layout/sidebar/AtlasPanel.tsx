/**
 * AtlasPanel
 * ──────────
 * The secondary column of the Command Deck: shows whatever the rail
 * selected — Search, Suggested, Favorites, or one section's flat page
 * list. The rail owns navigation; this panel owns content.
 *
 * Deliberately NOT a floating card: it sits in-flow beside the rail on
 * the same surface with a plain divider, so the two columns read as one
 * sidebar. Two variants share every view:
 *   - `secondary` — desktop column that can close or shrink to icons.
 *   - `inline` — the mobile drill-in level with a Back button.
 *
 * Sparse views fill on purpose: an empty search shows recents plus
 * suggestions above the hint line, and Suggested splits into Now and
 * Up next groups, so the column never rattles half-empty.
 *
 * Views reuse the sidebar's proven engines: `searchSidebarSections`
 * for search, the `suggestions` feed for Suggested, pin state for
 * Favorites, and `flattenSidebarItems` for sections.
 */

import { useEffect, useId, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion } from '@/components/motion/runtime'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { VisuallyHidden } from '@/components/a11y'
import { SearchInput } from '@/components/forms/SearchInput'
import { Button } from '@/components/ui/runtime'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import type { SidebarSectionInput } from '../sectionGroups'
import type { SectionGroup } from '../sectionGroups'
import { isExclusiveActivePath } from './compactNav'
import { groupSidebarItems } from './collections'
import { searchSidebarSections, type SidebarSearchHit } from './sidebarSearch'
import { NavSectionHeader } from './NavSectionHeader'
import { SidebarCountChip, SidebarNotificationDot, SidebarRow } from './SidebarRow'
import { SidebarFlyout, useSidebarFlyout } from './SidebarFlyout'
import type { SidebarSuggestion } from './sidebarSuggest'
import type { DeckSelection } from './CommandDeck'

export interface AtlasPanelProps {
  variant: 'secondary' | 'inline'
  collapsed?: boolean
  onToggleCollapsed?: () => void
  view: DeckSelection
  /** Inline only: back to the rail. */
  onBack?: () => void
  /** Collapse the column (desktop control; mobile drawer close). */
  onClose?: () => void
  sections: SidebarSectionInput[]
  pinnedItems: SidebarSectionInput['items']
  recentItems?: SidebarSectionInput['items']
  suggestions?: SidebarSuggestion[]
  pathname: string
  navLabel: (item: { label: string; labelKey: string }) => string
  navSectionTitle: (section: { title: string; titleKey?: string }) => string
  onPin: (to: string) => void
  onUnpin: (to: string) => void
  onItemSelect?: () => void
  alertCount?: number
  vehicleCount?: number
  staleCount?: number
  collections?: readonly SectionGroup[]
}

export function AtlasPanel({
  variant,
  collapsed = false,
  onToggleCollapsed,
  view,
  onBack,
  onClose,
  sections,
  pinnedItems,
  recentItems,
  suggestions,
  pathname,
  navLabel,
  navSectionTitle,
  onPin,
  onUnpin,
  onItemSelect,
  alertCount = 0,
  vehicleCount = 0,
  staleCount = 0,
  collections = [],
}: AtlasPanelProps) {
  const { t } = useTranslation()
  const compact = variant === 'secondary' && collapsed
  const { rootRef, tip, showTip, hideTip, tipHandlers } = useSidebarFlyout()
  const location = useLocation()
  const groupListId = useId()
  const effectivePath = pathname ?? location.pathname
  const { reduce, durationMs } = useMotionPreference(150)

  const safeSections = sections ?? []
  const safePinnedItems = pinnedItems ?? []
  const safeRecentItems = recentItems ?? []
  const safeSuggestions = suggestions ?? []
  const safeCollections = collections ?? []

  const pinnedSet = useMemo(() => new Set(safePinnedItems.map(item => item.to)), [safePinnedItems])
  const catalogPaths = useMemo(() => {
    const paths = safeSections.flatMap(section => section.items.map(item => item.to))
    for (const item of safePinnedItems) paths.push(item.to)
    for (const group of safeCollections) {
      for (const page of group.pages) paths.push(page.to)
    }
    return paths
  }, [safeSections, safePinnedItems, safeCollections])
  const itemIsActive = (to: string) => isExclusiveActivePath(effectivePath, to, catalogPaths)
  const pinOnDoubleClick = (to: string) => {
    if (!pinnedSet.has(to)) onPin(to)
  }

  // ── Search state ───────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const toggleGroup = (key: string) => {
    setCollapsedGroups(previous => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  // Navigating away clears the filter: a stale query would otherwise
  // keep hiding recents behind old results.
  useEffect(() => {
    setQuery('')
  }, [location.pathname])
  const trimmedQuery = query.trim()
  const searching = trimmedQuery.length > 0
  const searchResults = useMemo(
    () => searchSidebarSections(safeSections, safeCollections, trimmedQuery, navLabel),
    [safeSections, safeCollections, trimmedQuery, navLabel],
  )
  const searchHitCount = useMemo(
    () => searchResults.reduce((total, section) => total + section.hits.length, 0),
    [searchResults],
  )

  // ── Shared row helpers ─────────────────────────────────────────────────
  const trailingFor = (to: string): React.ReactNode => {
    if (to === '/notifications/inbox' && alertCount > 0) return <SidebarNotificationDot />
    if (to === '/vehicles' && vehicleCount > 0) {
      return (
        <SidebarCountChip
          value={vehicleCount}
          label={t('nav.vehicleCount', { count: vehicleCount, defaultValue: '{{count}} vehicles' })}
        />
      )
    }
    if (to === '/data-repair' && staleCount > 0) {
      return (
        <SidebarCountChip
          value={staleCount}
          label={t('nav.staleCount', { count: staleCount, defaultValue: '{{count}} stale rows' })}
        />
      )
    }
    return null
  }

  const pinActionFor = (
    item: { to: string; label: string; labelKey?: string },
    label: string,
  ): React.ReactNode => {
    const pinned = pinnedSet.has(item.to)
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={
          pinned
            ? t('nav.unpinPage', { page: label, defaultValue: 'Unpin {{page}}' })
            : t('nav.pinPage', { page: label, defaultValue: 'Pin {{page}} to favorites' })
        }
        title={
          pinned
            ? t('nav.unpinPage', { page: label, defaultValue: 'Unpin {{page}}' })
            : t('nav.pinPage', { page: label, defaultValue: 'Pin {{page}} to favorites' })
        }
        onClick={() => (pinned ? onUnpin(item.to) : onPin(item.to))}
        className="h-11 w-11 shrink-0 rounded-shape-md p-0 text-[var(--text-muted)] hover:bg-[var(--control-bg)] hover:text-[var(--theme-primary)]"
        data-testid={`atlas-pin-${item.to}`}
      >
        {pinned ? <Icons.close className="h-4 w-4" /> : <Icons.star className="h-4 w-4" />}
      </Button>
    )
  }

  const hitRow = (hit: SidebarSearchHit) => (
    <SidebarRow
      key={hit.to}
      to={hit.to}
      label={hit.label}
      icon={hit.icon}
      iconColor={hit.color}
      active={itemIsActive(hit.to)}
      onSelect={onItemSelect}
      onDoubleClick={() => pinOnDoubleClick(hit.to)}
      compact={compact}
      onShowTip={showTip}
      onHideTip={hideTip}
      trailing={trailingFor(hit.to)}
      hoverAction={pinActionFor(hit, hit.label)}
      dataTour={hit.dataTour}
      context={hit.matchContext}
    />
  )

  const suggestionRow = (item: SidebarSuggestion) => (
    <SidebarRow
      key={`suggested-${item.to}`}
      to={item.to}
      label={navLabel(item)}
      icon={item.icon}
      iconColor={item.color}
      active={itemIsActive(item.to)}
      onSelect={onItemSelect}
      onDoubleClick={() => pinOnDoubleClick(item.to)}
      compact={compact}
      onShowTip={showTip}
      onHideTip={hideTip}
      trailing={trailingFor(item.to)}
      hoverAction={pinActionFor(item, navLabel(item))}
      dataTour={item.dataTour}
      context={item.reason}
    />
  )

  // ── Derived groups ─────────────────────────────────────────────────────
  const visiblePinned = safePinnedItems
  const visibleRecent = safeRecentItems.filter(
    item => !pinnedSet.has(item.to) && !itemIsActive(item.to),
  )
  const nowSuggestions = safeSuggestions.filter(item => item.kind === 'now')
  const relatedSuggestions = safeSuggestions.filter(item => item.kind !== 'now')
  const openSection = view.kind === 'section'
    ? (safeSections.find(section => section.title === view.title) ?? null)
    : null
  const sectionGroups = openSection ? groupSidebarItems(openSection.items, safeCollections) : []
  const collapsibleGroupKeys = sectionGroups.filter(group => group.label).map(group => group.entries[0].to)
  const anyGroupCollapsed = collapsibleGroupKeys.some(key => collapsedGroups.has(key))

  const viewTitle = (): string => {
    switch (view.kind) {
      case 'search': return t('nav.deck.search', 'Search')
      case 'suggested': return t('nav.suggested', 'Suggested')
      case 'favorites': return t('nav.deck.saved', 'Saved')
      case 'section': return openSection ? navSectionTitle(openSection) : t('nav.empty', 'No pages yet.')
    }
  }
  const viewKey = view.kind === 'section' ? `section:${view.title}` : view.kind

  useEffect(() => {
    if (variant !== 'inline') return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose?.()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [variant, onClose])

  return (
    <div
      ref={rootRef}
      role="navigation"
      aria-label={t('nav.sidebar', 'Sidebar navigation')}
      data-testid={variant === 'secondary' ? 'atlas-panel-secondary' : 'atlas-panel-inline'}
      data-collapsed={compact}
      onMouseLeave={hideTip}
      className={cn(
        'relative flex min-h-0 flex-col bg-[var(--surface-1)]',
        variant === 'secondary' && 'h-full w-full border-s border-[var(--border-default)]',
        variant === 'inline' && 'h-full w-full flex-1',
      )}
    >
      {/* Header: Back on the mobile drill level, collapse on desktop. */}
      <div className={cn('flex shrink-0 items-center gap-1 border-b border-[var(--border-default)] px-2', compact ? 'flex-col py-2' : 'h-12')}>
        {variant === 'inline' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            aria-label={t('nav.deck.backToRail', 'Back to sections')}
            className="h-9 w-9 shrink-0 rounded-shape-md p-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <Icons.back className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </Button>
        )}
        {!compact && (
          <p className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-[var(--text-primary)]">
            {viewTitle()}
          </p>
        )}
        {collapsibleGroupKeys.length > 1 && !compact && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={anyGroupCollapsed
              ? t('nav.deck.expandAllGroups', 'Expand all groups')
              : t('nav.deck.collapseAllGroups', 'Collapse all groups')}
            title={anyGroupCollapsed
              ? t('nav.deck.expandAllGroups', 'Expand all groups')
              : t('nav.deck.collapseAllGroups', 'Collapse all groups')}
            onClick={() => setCollapsedGroups(previous => {
              const next = new Set(previous)
              for (const key of collapsibleGroupKeys) {
                if (anyGroupCollapsed) next.delete(key)
                else next.add(key)
              }
              return next
            })}
            className="h-9 w-9 shrink-0 rounded-shape-md p-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {anyGroupCollapsed
              ? <Icons.expandAll className="h-5 w-5" aria-hidden />
              : <Icons.collapseAll className="h-5 w-5" aria-hidden />}
          </Button>
        )}
        {variant === 'secondary' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={compact
              ? t('nav.deck.expandPanel', 'Expand secondary navigation')
              : t('nav.deck.collapsePanel', 'Collapse secondary navigation')}
            title={compact
              ? t('nav.deck.expandPanel', 'Expand secondary navigation')
              : t('nav.deck.collapsePanel', 'Collapse secondary navigation')}
            aria-expanded={!compact}
            onClick={() => {
              hideTip()
              onToggleCollapsed?.()
            }}
            className="h-9 w-9 shrink-0 rounded-shape-md p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            {compact
              ? <Icons.sidebarSecondaryExpand className="h-5 w-5 rtl:scale-x-[-1]" aria-hidden />
              : <Icons.sidebarSecondaryCollapse className="h-5 w-5 rtl:scale-x-[-1]" aria-hidden />}
          </Button>
        )}
        {variant === 'secondary' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('nav.deck.close', 'Close panel')}
            title={t('nav.deck.close', 'Close panel')}
            onClick={onClose}
            className="h-9 w-9 shrink-0 rounded-shape-md p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <Icons.close className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>

      <div
        onScroll={hideTip}
        className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain pb-8 pt-3 scrollbar-thin', compact ? 'px-1' : 'px-3')}
      >
        <motion.div
          key={viewKey}
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: reduce ? 1 : 0 },
            show: {
              opacity: 1,
              transition: {
                duration: durationMs / 1000,
                ease: 'easeOut',
                // Rows cascade in DOM order on view mount; new rows from
                // typing land in their final state without replaying.
                staggerChildren: reduce ? 0 : 0.012,
              },
            },
          }}
        >
        {view.kind === 'search' && (compact ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('nav.deck.expandToSearch', 'Expand to search pages')}
            {...tipHandlers(t('nav.deck.expandToSearch', 'Expand to search pages'))}
            onClick={onToggleCollapsed}
            className="mx-auto flex h-11 w-11 items-center justify-center rounded-shape-md p-0 text-[var(--text-secondary)]"
          >
            <Icons.search className="h-6 w-6" aria-hidden />
          </Button>
        ) : (
          <div className="space-y-px">
            <SearchInput
              value={query}
              onChange={setQuery}
              debounceMs={120}
              historyScope="sidebar"
              autoFocus={variant === 'secondary'}
              ariaLabel={t('nav.searchPages', 'Search pages')}
              placeholder={t('nav.searchPagesPlaceholder', 'Search pages…')}
              clearLabel={t('nav.clearSearch', 'Clear search')}
            />
            {searching ? (
              <>
                <p role="status" className="px-2 text-xs tabular-nums text-[var(--text-muted)]">
                  {searchHitCount === 0
                    ? t('nav.noSearchResults', { query: trimmedQuery, defaultValue: 'No pages match "{{query}}".' })
                    : t('nav.searchResultCount', { count: searchHitCount, defaultValue: '{{count}} results' })}
                </p>
                {searchResults.map(section => (
                  <div key={section.title}>
                    <NavSectionHeader
                      label={section.titleKey ? t(section.titleKey, section.title) : section.title}
                    />
                    <div
                      className="space-y-px"
                      aria-label={section.titleKey ? t(section.titleKey, section.title) : section.title}
                    >
                      {section.hits.map(hitRow)}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <>
                {visibleRecent.length > 0 && (
                  <div>
                    <NavSectionHeader label={t('nav.recentlyUsed', 'Recently Used')} />
                    <div className="space-y-px">
                      {visibleRecent.map(item => (
                        <SidebarRow
                          key={`recent-${item.to}`}
                          to={item.to}
                          label={navLabel(item)}
                          icon={item.icon}
                          iconColor={item.color}
                          active={itemIsActive(item.to)}
                          onSelect={onItemSelect}
                          onDoubleClick={() => pinOnDoubleClick(item.to)}
                          compact={compact}
                          onShowTip={showTip}
                          onHideTip={hideTip}
                          trailing={trailingFor(item.to)}
                          hoverAction={pinActionFor(item, navLabel(item))}
                          dataTour={item.dataTour}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {safeSuggestions.length > 0 && (
                  <div>
                    <NavSectionHeader label={t('nav.suggested', 'Suggested')} />
                    <div className="space-y-px">
                      {safeSuggestions.map(suggestionRow)}
                    </div>
                  </div>
                )}
                <p role="status" className="px-2 text-xs leading-relaxed text-[var(--text-muted)]">
                  {t('nav.deck.searchHint', 'Type to search all pages. Keyword shortcuts like “soh” work too.')}
                </p>
              </>
            )}
          </div>
        ))}

        {view.kind === 'suggested' && (
          <div className="space-y-3">
            {safeSuggestions.length === 0 && (
              <div role="status" className={cn('text-center text-[var(--text-muted)]', compact ? 'py-4' : 'rounded-shape-lg px-3 py-6 text-xs leading-relaxed')}>
                {compact && <Icons.sparkles className="mx-auto h-6 w-6" aria-hidden />}
                {compact
                  ? <VisuallyHidden>{t('nav.deck.allCaughtUp', 'All caught up — nothing needs you right now.')}</VisuallyHidden>
                  : <p>{t('nav.deck.allCaughtUp', 'All caught up — nothing needs you right now.')}</p>}
              </div>
            )}
            {nowSuggestions.length > 0 && (
              <div>
                {compact
                  ? <div role="separator" aria-label={t('nav.deck.now', 'Now')} className="mx-2 my-2 border-t border-[var(--border-default)]" />
                  : <NavSectionHeader label={t('nav.deck.now', 'Now')} />}
                <div className="space-y-px">
                  {nowSuggestions.map(suggestionRow)}
                </div>
              </div>
            )}
            {relatedSuggestions.length > 0 && (
              <div>
                {compact
                  ? <div role="separator" aria-label={t('nav.deck.upNext', 'Up next')} className="mx-2 my-2 border-t border-[var(--border-default)]" />
                  : <NavSectionHeader label={t('nav.deck.upNext', 'Up next')} />}
                <div className="space-y-px">
                  {relatedSuggestions.map(suggestionRow)}
                </div>
              </div>
            )}
          </div>
        )}

        {view.kind === 'favorites' && (
          <div className="space-y-px">
            {visiblePinned.length === 0 && (
              <div role="status" className={cn('text-center text-[var(--text-muted)]', compact ? 'py-4' : 'rounded-shape-lg px-3 py-6 text-xs leading-relaxed')}>
                {compact && <Icons.star className="mx-auto h-6 w-6" aria-hidden />}
                {compact
                  ? <VisuallyHidden>{t('nav.deck.noFavorites', 'Pin pages from any row and they will live here.')}</VisuallyHidden>
                  : <p>{t('nav.deck.noFavorites', 'Pin pages from any row and they will live here.')}</p>}
              </div>
            )}
            {visiblePinned.map(item => (
              <SidebarRow
                key={`pinned-${item.to}`}
                to={item.to}
                label={navLabel(item)}
                icon={item.icon}
                iconColor={item.color}
                active={itemIsActive(item.to)}
                onSelect={onItemSelect}
                onDoubleClick={() => pinOnDoubleClick(item.to)}
                compact={compact}
                onShowTip={showTip}
                onHideTip={hideTip}
                trailing={trailingFor(item.to)}
                hoverAction={pinActionFor(item, navLabel(item))}
                dataTour={item.dataTour}
              />
            ))}
          </div>
        )}

        {view.kind === 'section' && (
          <div className={compact ? 'space-y-1' : 'space-y-2'}>
            {openSection === null && (
              <div role="status" className="rounded px-3 py-4 text-center text-xs text-[var(--text-muted)]">
                <p>{t('nav.empty', 'No pages yet.')}</p>
              </div>
            )}
            {sectionGroups.map((group, index) => (
              <div key={group.entries[0].to}>
                {group.label && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={!collapsedGroups.has(group.entries[0].to)}
                    aria-controls={`${groupListId}-${index}`}
                    aria-label={compact ? (group.labelKey ? t(group.labelKey, group.label) : group.label) : undefined}
                    {...(compact ? tipHandlers(group.labelKey ? t(group.labelKey, group.label) : group.label) : {})}
                    onClick={() => toggleGroup(group.entries[0].to)}
                    className={cn(
                      'min-h-11 rounded-shape-md text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
                      compact ? 'mx-auto flex w-11 justify-center p-0' : 'w-full justify-between px-3 text-2xs font-semibold uppercase tracking-[0.14em]',
                    )}
                  >
                    {!compact && <span className="truncate text-start">{group.labelKey ? t(group.labelKey, group.label) : group.label}</span>}
                    {collapsedGroups.has(group.entries[0].to)
                      ? <Icons.next className="h-5 w-5 shrink-0 rtl:rotate-180" aria-hidden />
                      : <Icons.expand className="h-5 w-5 shrink-0" aria-hidden />}
                  </Button>
                )}
                <div
                  id={group.label ? `${groupListId}-${index}` : undefined}
                  hidden={Boolean(group.label && collapsedGroups.has(group.entries[0].to))}
                  className="space-y-px"
                >
                  {group.entries.map(entry => (
                    <SidebarRow
                      key={entry.to}
                      to={entry.to}
                      label={navLabel(entry)}
                      icon={entry.icon}
                      iconColor={entry.color}
                      active={itemIsActive(entry.to)}
                      onSelect={onItemSelect}
                      onDoubleClick={() => pinOnDoubleClick(entry.to)}
                      compact={compact}
                      onShowTip={showTip}
                      onHideTip={hideTip}
                      trailing={trailingFor(entry.to)}
                      hoverAction={pinActionFor(entry, navLabel(entry))}
                      dataTour={entry.dataTour}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        </motion.div>
      </div>
      {compact && <SidebarFlyout tip={tip} testId="atlas-tip" />}
    </div>
  )
}

export default AtlasPanel
