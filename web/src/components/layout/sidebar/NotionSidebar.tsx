/**
 * NotionSidebar
 * ─────────────
 * A Notion-inspired alternative to the default TeslaSync sidebar.
 *
 * What makes this "Notion-style" (vs Linear-style)
 * - Workspace header at top — small wordmark + chevron, mimics Notion's
 *   workspace switcher (purely visual here; the real vehicle picker still
 *   lives above this in Layout).
 * - Quick links group: Inbox / Settings — single-row entries with a tiny
 *   muted icon, no decoration.
 * - "Favorites" and "Pages" group labels — sentence case, NOT uppercase,
 *   small muted text. Notion never shouts.
 * - Each section row is itself a clickable line with caret-on-left + icon
 *   + label + count. Click anywhere on the row to toggle. Caret rotates.
 * - Sub-items indent under the parent icon (ps-6) — Notion's nested-page
 *   hierarchy. No icon on sub-items by default (sub-items are
 *   "documents", not "folders").
 * - Hover-only actions: "+" to pin to favorites, "×" to unpin, all
 *   right-aligned and revealed on row hover (like Notion's "•••" menu).
 * - Active state: just bg-white/[0.05] — NO accent bar, NO bold weight.
 *   Notion is the quietest possible.
 * - Row height: 28px (h-7) — denser than Linear's 32px.
 *
 * Shared with LinearSidebar
 * - Same data contract (LinearSidebarSectionInput + props), so the parent
 *   wiring in Layout.tsx is one switch statement away from each other.
 * - Same inline tree filter at the top.
 * - Same favorites group powered by pinnedItems.
 */

import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { GuardedNavLink } from '../../feedback/GuardedLink'
import { Button } from '@/components/ui'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import type {
  LinearSidebarSectionInput as NotionSidebarSectionInput,
  LinearSidebarProps as NotionSidebarProps,
} from './LinearSidebar'

export type { NotionSidebarSectionInput, NotionSidebarProps }

// ─── Active-path helpers ─────────────────────────────────────────────────

function isActiveNotionPath(pathname: string, to: string) {
  return to === '/'
    ? pathname === '/'
    : pathname === to || pathname.startsWith(to + '/')
}

// ─── Tiny components ─────────────────────────────────────────────────────

interface NotionRowProps {
  to: string
  label: string
  icon: typeof Icons.home
  iconColor?: string
  active: boolean
  onSelect?: () => void
  trailing?: React.ReactNode
  hoverAction?: React.ReactNode
  dataTour?: string
  /** Indent depth in Tailwind padding-start units (default ps-2). */
  indent?: 'ps-2' | 'ps-7'
}

/**
 * The base "row" for any clickable nav line. Used by both quick-links and
 * leaf items. Section rows use a separate component because they need a
 * caret + toggle handler instead of a NavLink.
 */
function NotionRow({
  to,
  label,
  icon: Icon,
  iconColor,
  active,
  onSelect,
  trailing,
  hoverAction,
  dataTour,
  indent = 'ps-2',
}: NotionRowProps) {
  return (
    <div className="group relative flex items-center">
      <GuardedNavLink
        to={to}
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        data-tour={dataTour}
        className={cn(
          'flex min-h-7 min-w-0 flex-1 items-center gap-2 rounded py-0.5 pe-1.5 text-sm transition-colors',
          indent,
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]',
          active
            ? 'bg-white/[0.05] text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-white/[0.03] hover:text-[var(--text-primary)]',
        )}
      >
        <Icon
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-colors',
            iconColor && !active && 'opacity-90',
            active
              ? 'text-[var(--text-primary)]'
              : iconColor ?? 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
      </GuardedNavLink>
      {hoverAction && (
        <div className="ms-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {hoverAction}
        </div>
      )}
    </div>
  )
}

interface NotionSectionRowProps {
  title: string
  icon: typeof Icons.home
  iconColor?: string
  expanded: boolean
  onToggle: () => void
  count: number
}

/**
 * Section row — caret + icon + label + count, all in one clickable line.
 * Whole row toggles. Notion uses this pattern for every "page that has
 * sub-pages" — the caret rotates and children slide open below.
 */
function NotionSectionRow({
  title,
  icon: Icon,
  iconColor,
  expanded,
  onToggle,
  count,
}: NotionSectionRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        'group flex w-full min-h-7 items-center gap-1 rounded px-1.5 py-0.5 text-left text-sm text-[var(--text-secondary)]',
        'transition-colors hover:bg-white/[0.03] hover:text-[var(--text-primary)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]',
      )}
    >
      <Icons.next
        className={cn(
          'h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform duration-fast ease-out',
          expanded ? 'rotate-90' : 'rotate-0',
        )}
        aria-hidden
      />
      <Icon
        className={cn('h-3.5 w-3.5 shrink-0', iconColor ?? 'text-[var(--text-muted)]')}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="text-2xs tabular-nums text-[var(--text-muted)]/80">{count}</span>
    </button>
  )
}

function GroupLabel({
  children,
  action,
  id,
}: {
  children: React.ReactNode
  action?: React.ReactNode
  id?: string
}) {
  return (
    <div
      id={id}
      className="group flex items-center gap-1 px-2 pb-0.5 pt-2 text-xs font-medium text-[var(--text-muted)]"
    >
      <span className="flex-1 truncate">{children}</span>
      {action && (
        <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {action}
        </span>
      )}
    </div>
  )
}

function NotificationDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--theme-primary)]',
        className,
      )}
    />
  )
}

function CountChip({ value, label }: { value: number; label: string }) {
  return (
    <span
      aria-label={label}
      className="inline-flex h-4 min-w-[18px] items-center justify-center rounded bg-white/[0.05] px-1 text-2xs font-medium tabular-nums text-[var(--text-secondary)]"
    >
      {value > 99 ? '99+' : value}
    </span>
  )
}

// ─── Main component ──────────────────────────────────────────────────────

export function NotionSidebar({
  sections,
  pinnedItems,
  pathname,
  navLabel,
  onPin,
  onUnpin,
  onItemSelect,
  activeSectionTitle,
  alertCount = 0,
  vehicleCount = 0,
  staleCount = 0,
}: NotionSidebarProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const effectivePath = pathname ?? location.pathname

  // Null-safe views of the array props so a not-yet-loaded or malformed
  // parent (undefined sections / pinned list) degrades to an empty tree
  // instead of throwing on `.map` / `.filter` / `.length`.
  const safeSections = sections ?? []
  const safePinnedItems = pinnedItems ?? []

  // ── Tree state ─────────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    // Default: collapse everything except the active section. Notion's
    // "show me the page I'm on" behaviour.
    const initial = new Set<string>()
    for (const section of safeSections) {
      if (section.title !== activeSectionTitle) initial.add(section.title)
    }
    return initial
  })

  useEffect(() => {
    if (!activeSectionTitle) return
    setCollapsed(prev => {
      if (!prev.has(activeSectionTitle)) return prev
      const next = new Set(prev)
      next.delete(activeSectionTitle)
      return next
    })
  }, [activeSectionTitle])

  const toggleSection = (title: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  // ── Tree filter ────────────────────────────────────────────────────────
  const [filter, setFilter] = useState('')
  const filterTokens = useMemo(
    () => filter.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [filter],
  )
  const matchesFilter = (label: string) => {
    if (filterTokens.length === 0) return true
    const haystack = label.toLowerCase()
    return filterTokens.every(token => haystack.includes(token))
  }

  const filteredSections = useMemo(
    () =>
      safeSections.map(section => ({
        ...section,
        items: (section.items ?? []).filter(item => matchesFilter(navLabel(item.label))),
      })),
    [safeSections, filterTokens, navLabel],
  )

  const isExpanded = (title: string) => {
    if (filterTokens.length > 0) {
      const sec = filteredSections.find(s => s.title === title)
      return Boolean(sec && sec.items.length > 0)
    }
    return !collapsed.has(title)
  }

  // ── Per-section icon (first item's icon as the section glyph) ─────────
  // Sections don't have their own icon definition, but Notion shows one
  // on every collapsible row. We borrow the first item's icon+color so the
  // glyph stays in the same visual family as the section contents.
  const sectionGlyph = (section: NotionSidebarSectionInput) => {
    const first = section.items?.[0]
    return {
      icon: first?.icon ?? Icons.home,
      color: first?.color,
    }
  }

  // ── Trailing badges ────────────────────────────────────────────────────
  const trailingFor = (to: string): React.ReactNode => {
    if (to === '/notifications/alerts' && alertCount > 0) return <NotificationDot />
    if (to === '/vehicles' && vehicleCount > 0) {
      return (
        <CountChip
          value={vehicleCount}
          label={t('nav.vehicleCount', {
            count: vehicleCount,
            defaultValue: '{{count}} vehicles',
          })}
        />
      )
    }
    if (to === '/data-repair' && staleCount > 0) {
      return (
        <CountChip
          value={staleCount}
          label={t('nav.staleCount', {
            count: staleCount,
            defaultValue: '{{count}} stale rows',
          })}
        />
      )
    }
    return null
  }

  // Hover action — "pin" if not pinned, "unpin" if pinned.
  const pinnedSet = useMemo(() => new Set(safePinnedItems.map(p => p.to)), [safePinnedItems])
  const pinAction = (item: NotionSidebarSectionInput['items'][number]) => {
    const pinned = pinnedSet.has(item.to)
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={
          pinned
            ? t('nav.unpinPage', { page: navLabel(item.label), defaultValue: 'Unpin {{page}}' })
            : t('nav.pinPage', { page: navLabel(item.label), defaultValue: 'Pin {{page}}' })
        }
        onClick={(e: React.MouseEvent) => {
          e.preventDefault()
          if (pinned) onUnpin(item.to)
          else onPin(item.to)
        }}
        className="touch-target-overlay h-5 w-5 rounded p-0 text-[var(--text-muted)] hover:bg-white/[0.05] hover:text-[var(--text-secondary)]"
      >
        {pinned ? <Icons.close className="h-3 w-3" /> : <Icons.star className="h-3 w-3" />}
      </Button>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const expandedSections = filteredSections.filter(s => s.items.length > 0)

  return (
    <div className="flex h-full min-h-0 flex-col" data-role="notion-sidebar">
      {/* Tree */}
      <nav
        aria-label={t('nav.sidebar', 'Sidebar navigation')}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-1.5 pb-3 scrollbar-thin"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* Favorites group — only when there's at least one pin. */}
        {safePinnedItems.length > 0 && (
          <div className="mb-1">
            <GroupLabel id="notion-favorites-label">
              {t('nav.favorites', 'Favorites')}
            </GroupLabel>
            <div className="space-y-px" aria-labelledby="notion-favorites-label">
              {safePinnedItems
                .filter(item => matchesFilter(navLabel(item.label)))
                .map(item => (
                  <NotionRow
                    key={`fav-${item.to}`}
                    to={item.to}
                    label={navLabel(item.label)}
                    icon={item.icon}
                    iconColor={item.color}
                    active={isActiveNotionPath(effectivePath, item.to)}
                    onSelect={onItemSelect}
                    trailing={trailingFor(item.to)}
                    hoverAction={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('nav.unpinPage', {
                          page: navLabel(item.label),
                          defaultValue: 'Unpin {{page}}',
                        })}
                        onClick={(e: React.MouseEvent) => {
                          e.preventDefault()
                          onUnpin(item.to)
                        }}
                        className="touch-target-overlay h-5 w-5 rounded p-0 text-[var(--text-muted)] hover:bg-white/[0.05] hover:text-[var(--text-secondary)]"
                      >
                        <Icons.close className="h-3 w-3" />
                      </Button>
                    }
                  />
                ))}
            </div>
          </div>
        )}

        {/* Pages group — Notion calls everything below "Workspace"/"Private". */}
        <GroupLabel id="notion-pages-label">{t('nav.pages', 'Pages')}</GroupLabel>
        <div className="space-y-px" aria-labelledby="notion-pages-label">
          {expandedSections.map(section => {
            const expanded = isExpanded(section.title)
            const glyph = sectionGlyph(section)
            return (
              <div key={section.title}>
                <NotionSectionRow
                  title={section.title}
                  icon={glyph.icon}
                  iconColor={glyph.color}
                  expanded={expanded}
                  onToggle={() => toggleSection(section.title)}
                  count={section.items.length}
                />
                {expanded && (
                  <div className="space-y-px" role="group" aria-label={section.title}>
                    {section.items.map(item => (
                      <NotionRow
                        key={item.to}
                        to={item.to}
                        label={navLabel(item.label)}
                        icon={item.icon}
                        iconColor={item.color}
                        active={isActiveNotionPath(effectivePath, item.to)}
                        onSelect={onItemSelect}
                        trailing={trailingFor(item.to)}
                        hoverAction={pinAction(item)}
                        dataTour={item.dataTour}
                        indent="ps-7"
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {filterTokens.length === 0 && expandedSections.length === 0 && (
            <div
              className="rounded px-3 py-4 text-center text-xs text-[var(--text-muted)]"
              role="status"
              data-testid="notion-sidebar-empty"
            >
              <p>{t('nav.empty', 'No pages yet.')}</p>
            </div>
          )}

          {filterTokens.length > 0 && expandedSections.length === 0 && (
            <div
              className="rounded px-3 py-4 text-center text-xs text-[var(--text-muted)]"
              role="status"
              data-testid="notion-sidebar-empty-filter"
            >
              <p>{t('nav.filterNoMatch', 'No matches.')}</p>
              <button
                type="button"
                onClick={() => setFilter('')}
                className="mt-2 rounded px-2 py-1 text-xs text-[var(--theme-primary)] hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
              >
                {t('nav.filterClear', 'Clear filter')}
              </button>
            </div>
          )}
        </div>
      </nav>
    </div>
  )
}

export default NotionSidebar
