/**
 * AtlasPanel
 * ──────────
 * The secondary column of the Command Deck: shows whatever the rail
 * selected — Suggested, Favorites, or one section's flat page
 * list. The rail owns navigation; this panel owns content.
 *
 * Deliberately NOT a floating card: it sits in-flow beside the tinted
 * rail on a contrasting surface with a plain divider. Two variants share every view:
 *   - `secondary` — desktop column that can close or shrink to icons.
 *   - `inline` — the mobile drill-in level with a Back button.
 *
 * Suggested shows recents alongside Now and Up next, so the column
 * never rattles half-empty.
 *
 * Views reuse the suggestions feed, pin state, and collection grouping.
 */

import { useEffect, useId, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from '@/components/motion/runtime'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { VisuallyHidden } from '@/components/a11y'
import { Button, Input } from '@/components/ui/runtime'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import type { SidebarSectionInput } from '../sectionGroups'
import type { SectionGroup } from '../sectionGroups'
import { isExclusiveActivePath } from './compactNav'
import { groupSidebarItems } from './collections'
import { matchesSidebarTokens, searchSidebarSections, tokenizeSidebarQuery } from './sidebarSearch'
import { NavSectionHeader } from './NavSectionHeader'
import { SidebarCountChip, SidebarNotificationDot, SidebarRow } from './SidebarRow'
import { SidebarDriveBadge } from './SidebarDriveBadge'
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
  vehicleId?: string
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
  vehicleId,
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

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const [filterQuery, setFilterQuery] = useState('')
  const toggleGroup = (key: string) => {
    setExpandedGroups(previous => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ── Shared row helpers ─────────────────────────────────────────────────
  const trailingFor = (to: string): React.ReactNode => {
    if (vehicleId && to === '/drives') return <SidebarDriveBadge kind="today" vehicleId={vehicleId} />
    if (vehicleId && to === '/drive-score') return <SidebarDriveBadge kind="score" vehicleId={vehicleId} />
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
    quickAccess = false,
  ): React.ReactNode => {
    const pinned = pinnedSet.has(item.to)
    const actionLabel = quickAccess
      ? t('nav.deck.removeQuickPin', { page: label, defaultValue: 'Remove {{page}} from quick access' })
      : pinned
        ? t('nav.unpinPage', { page: label, defaultValue: 'Unpin {{page}}' })
        : t('nav.pinPage', { page: label, defaultValue: 'Pin {{page}} to favorites' })
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={actionLabel}
        title={actionLabel}
        onClick={() => (pinned ? onUnpin(item.to) : onPin(item.to))}
        className={cn('h-11 w-11 shrink-0 rounded-shape-md p-0 hover:bg-[var(--control-bg)]', pinned ? 'text-amber-500' : 'text-[var(--text-muted)] hover:text-[var(--theme-primary)]')}
        data-testid={`atlas-pin-${item.to}`}
      >
        <motion.span
          key={pinned ? 'pinned' : 'unpinned'}
          initial={reduce ? false : { scale: 0.6, rotate: pinned ? -25 : 25, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ duration: durationMs / 1000 }}
        >
          <Icons.pin className={cn('h-4 w-4', pinned && 'fill-amber-500/30')} aria-hidden />
        </motion.span>
      </Button>
    )
  }

  const suggestionRow = (item: SidebarSuggestion) => (
    <SidebarRow
      key={`suggested-${item.to}`}
      to={item.to}
      label={navLabel(item)}
      icon={item.icon}
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
  const filtering = filterQuery.trim().length > 0
  const matchingPaths = new Set(
    openSection && filtering
      ? searchSidebarSections([openSection], safeCollections, filterQuery, navLabel, { matchSectionTitle: false })
        .flatMap(section => section.hits.map(hit => hit.to))
      : [],
  )
  const visibleGroups = filtering
    ? sectionGroups
      .map(group => ({
        ...group,
        groupKey: group.entries[0].to,
        entries: group.label && matchesSidebarTokens(
          `${group.label} ${group.labelKey ? t(group.labelKey, group.label) : ''}`.toLowerCase(),
          tokenizeSidebarQuery(filterQuery),
        )
          ? group.entries
          : group.entries.filter(entry => matchingPaths.has(entry.to)),
      }))
      .filter(group => group.entries.length > 0)
    : sectionGroups.map(group => ({ ...group, groupKey: group.entries[0].to }))
  const sectionPaths = new Set(sectionGroups.flatMap(group => group.entries.map(entry => entry.to)))
  const quickPins = openSection
    ? safePinnedItems.filter(item => sectionPaths.has(item.to))
    : []
  const collapsibleGroupKeys = sectionGroups.filter(group => group.label).map(group => group.entries[0].to)
  const activeGroupKey = sectionGroups.find(group =>
    group.label && group.entries.some(entry => itemIsActive(entry.to)),
  )?.entries[0].to ?? collapsibleGroupKeys[0]
  const viewKey = view.kind === 'section' ? `section:${view.title}` : view.kind
  useEffect(() => {
    setFilterQuery('')
    setExpandedGroups(new Set(activeGroupKey ? [activeGroupKey] : []))
  }, [viewKey, activeGroupKey, location.pathname])
  const anyGroupCollapsed = collapsibleGroupKeys.some(key => !expandedGroups.has(key))

  const viewTitle = (): string => {
    switch (view.kind) {
      case 'suggested': return t('nav.suggested', 'Suggested')
      case 'favorites': return t('nav.deck.saved', 'Saved')
      case 'section': return openSection ? navSectionTitle(openSection) : t('nav.empty', 'No pages yet.')
    }
  }
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
        'relative flex min-h-0 flex-col bg-white dark:bg-[var(--surface-1)]',
        variant === 'secondary' && 'h-full w-full border-s border-e border-[var(--border-default)]',
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
          <p className="min-w-0 flex-1 truncate px-1 text-sm font-semibold uppercase tracking-wide text-[var(--text-primary)]">
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
            onClick={() => setExpandedGroups(new Set(anyGroupCollapsed ? collapsibleGroupKeys : []))}
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

      {openSection && !compact && (
        <div className="shrink-0 px-3 pt-3">
          <Input
            type="search"
            value={filterQuery}
            onChange={event => {
              const next = event.target.value
              setFilterQuery(next)
              setExpandedGroups(new Set(next.trim() ? collapsibleGroupKeys : activeGroupKey ? [activeGroupKey] : []))
            }}
            aria-label={t('nav.deck.filterSectionLabel', { section: viewTitle(), defaultValue: 'Filter {{section}} tools' })}
            placeholder={t('nav.deck.filterSection', { section: viewTitle(), defaultValue: 'Filter {{section}} tools…' })}
            icon={<Icons.filter className="h-4 w-4" aria-hidden />}
            suffix={filterQuery && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('nav.deck.clearFilter', 'Clear filter')}
                onClick={() => {
                  setFilterQuery('')
                  setExpandedGroups(new Set(activeGroupKey ? [activeGroupKey] : []))
                }}
                className="h-7 w-7 rounded-shape-sm p-0"
              >
                <Icons.close className="h-4 w-4" aria-hidden />
              </Button>
            )}
          />
        </div>
      )}

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
                staggerChildren: reduce ? 0 : 0.012,
              },
            },
          }}
        >
        {view.kind === 'suggested' && (
          <div className="space-y-3">
            {safeSuggestions.length === 0 && visibleRecent.length === 0 && (
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
            {visibleRecent.length > 0 && (
              <div>
                {compact
                  ? <div role="separator" aria-label={t('nav.recentlyUsed', 'Recently Used')} className="mx-2 my-2 border-t border-[var(--border-default)]" />
                  : <NavSectionHeader label={t('nav.recentlyUsed', 'Recently Used')} />}
                <div className="space-y-px">
                  {visibleRecent.map(item => (
                    <SidebarRow
                      key={`recent-${item.to}`}
                      to={item.to}
                      label={navLabel(item)}
                      icon={item.icon}
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
            {openSection && (!filtering || quickPins.length > 0) && (!compact || quickPins.length > 0) && (
              <div className="pb-3">
                {!compact && (
                  <div className="flex items-center justify-between gap-2 px-2 py-2">
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      <Icons.pin className="h-4 w-4 text-amber-500" aria-hidden />
                      {t('nav.deck.quickAccessPins', 'Quick access pins')}
                    </span>
                    <span className="text-2xs text-[var(--text-muted)]">
                      {t('nav.deck.pinHint', 'Pin pages to save')}
                    </span>
                  </div>
                )}
                {quickPins.length === 0 && !compact && (
                  <p className="px-2 py-2 text-xs text-[var(--text-muted)]">
                    {t('nav.deck.noQuickPins', 'Pin a page below to keep it close.')}
                  </p>
                )}
                <AnimatePresence initial={false}>
                  {quickPins.map(item => (
                    <motion.div
                      key={item.to}
                      initial={reduce ? false : { opacity: 0, y: -6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={reduce ? undefined : { opacity: 0, y: -6, scale: 0.97 }}
                      transition={{ duration: durationMs / 1000 }}
                    >
                      <SidebarRow
                        to={item.to}
                        label={navLabel(item)}
                        ariaLabel={t('nav.deck.quickAccessLink', { page: navLabel(item), defaultValue: 'Quick access: {{page}}' })}
                        icon={item.icon}
                        active={false}
                        onSelect={onItemSelect}
                        compact={compact}
                        onShowTip={showTip}
                        onHideTip={hideTip}
                        actionAlwaysVisible
                        hoverAction={pinActionFor(item, navLabel(item), true)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
            {filtering && visibleGroups.length === 0 && (
              <p role="status" className="px-2 py-4 text-sm text-[var(--text-muted)]">
                {t('nav.deck.noFilterResults', { query: filterQuery.trim(), defaultValue: 'No tools match "{{query}}".' })}
              </p>
            )}
            {visibleGroups.map((group, index) => (
              <div key={group.groupKey}>
                {group.label && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={expandedGroups.has(group.groupKey)}
                    aria-controls={`${groupListId}-${index}`}
                    aria-label={group.labelKey ? t(group.labelKey, group.label) : group.label}
                    {...(compact ? tipHandlers(group.labelKey ? t(group.labelKey, group.label) : group.label) : {})}
                    onClick={() => toggleGroup(group.groupKey)}
                    className={cn(
                      'min-h-11 rounded-shape-md text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
                      compact ? 'mx-auto flex w-11 justify-center p-0' : 'w-full justify-start gap-2 px-2 text-sm font-semibold uppercase tracking-normal',
                    )}
                  >
                    {expandedGroups.has(group.groupKey)
                      ? <Icons.expand className="h-4 w-4 shrink-0" aria-hidden />
                      : <Icons.next className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />}
                    {!compact && (
                      <>
                        <span className="min-w-0 flex-1 truncate text-start">
                          {group.labelKey ? t(group.labelKey, group.label) : group.label}
                        </span>
                        <span aria-hidden className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-2xs tabular-nums text-[var(--text-secondary)]">
                          {group.entries.length}
                        </span>
                      </>
                    )}
                  </Button>
                )}
                <div
                  id={group.label ? `${groupListId}-${index}` : undefined}
                  hidden={Boolean(group.label && !expandedGroups.has(group.groupKey))}
                  className="space-y-px"
                >
                  {group.entries.map(entry => (
                    <SidebarRow
                      key={entry.to}
                      to={entry.to}
                      label={navLabel(entry)}
                      icon={entry.icon}
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
