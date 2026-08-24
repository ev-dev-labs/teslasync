/**
 * LinearSidebar
 * ─────────────
 * A Linear / Notion-inspired alternative to the default TeslaSync sidebar.
 *
 * Design principles
 * - Single persistent column. No rail + flyout split.
 * - Quiet, monochrome. No glow, no neon, no gradient tiles.
 * - Tree-style: tiny uppercase section headers + click-to-collapse.
 * - Active state: 2px left accent bar + medium font weight. Nothing else.
 * - Icons are page-marker glyphs (14px, muted) — no decorative tiles.
 * - Navigation search is owned by the command palette trigger mounted directly
 *   above this tree, avoiding two competing search boxes in the same sidebar.
 *
 * What this does NOT change
 * - Sidebar wrapper, mobile slide animation, vehicle picker, command-palette
 *   trigger, status bar, footer — all owned by Layout.tsx. This component
 *   only replaces the `<nav>` block (sections + pinned).
 * - Pin / unpin behaviour and the canonical `navSections` source of truth.
 * - Per-page badges that came in via props (alerts, vehicles count, stale
 *   data count).
 *
 * Behaviour
 * - All sections start collapsed EXCEPT the one containing the current
 *   page. Toggling persists in component state only (no localStorage —
 *   layout already restores expansion via its own effect when this
 *   component is not used).
 * - "Favorites" (pinned) is a permanent un-collapsable group at the top
 *   whenever there is at least one pinned item.
 */

import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PrefetchNavLink } from '../PrefetchLink'
import { Button } from '@/components/ui'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import { EXPLORE_PATH } from './compactNav'

const COMPACT_GROUP_I18N_KEYS: Readonly<Record<string, string>> = {
  Overview: 'nav.compactOverview',
  Fleet: 'nav.compactFleet',
  Driving: 'nav.compactDriving',
  'Charging & Energy': 'nav.compactChargingEnergy',
  Battery: 'nav.compactBattery',
  'Reports & Analytics': 'nav.compactReportsAnalytics',
  'Automation & Alerts': 'nav.compactAutomationAlerts',
  'System & Developer': 'nav.compactSystemDeveloper',
  'Settings & Account': 'nav.compactSettingsAccount',
}

// Re-derive the structural types from Layout's exported navSections so this
// component stays in lockstep with the canonical nav tree without taking
// on a circular import or duplicating the literal.
export type LinearSidebarSectionInput = {
  title: string
  items: Array<{
    to: string
    icon: typeof Icons.home
    label: string
    color?: string
    dataTour?: string
    minVehicles?: number
  }>
}

export interface LinearSidebarProps {
  /** Already filtered by visibility (vehicle count, forward-auth, etc.). */
  sections: LinearSidebarSectionInput[]
  /** Pinned items, in pin-order, already visibility-filtered. */
  pinnedItems: LinearSidebarSectionInput['items']
  /** Active path (usually `useLocation().pathname`). */
  pathname: string
  /** Translate a nav label key/value. Caller already knows the i18n map. */
  navLabel: (label: string) => string
  /** Pin / unpin callbacks — already exposed by Layout. */
  onPin: (to: string) => void
  onUnpin: (to: string) => void
  /** Called when a link is followed — mobile uses this to close the drawer. */
  onItemSelect?: () => void
  /** Title of the section that currently contains the active page. */
  activeSectionTitle?: string
  /** Badge counts — kept as dots, not numbers, per the quiet principle. */
  alertCount?: number
  vehicleCount?: number
  staleCount?: number
}

// ─── Active-path helpers ─────────────────────────────────────────────────

function isActiveLinearPath(pathname: string, to: string) {
  return to === '/'
    ? pathname === '/'
    : pathname === to || pathname.startsWith(to + '/')
}

// ─── Tiny components ─────────────────────────────────────────────────────

interface LinearNavLinkProps {
  to: string
  label: string
  icon: typeof Icons.home
  active: boolean
  onSelect?: () => void
  /** Right-side hint (e.g., dot for unread, count for vehicles). */
  trailing?: React.ReactNode
  /** Optional action that appears on hover (unpin in favorites). */
  hoverAction?: React.ReactNode
  dataTour?: string
}

function LinearNavLink({
  to,
  label,
  icon: Icon,
  active,
  onSelect,
  trailing,
  hoverAction,
  dataTour,
}: LinearNavLinkProps) {
  return (
    <div className="group relative flex items-center">
      {/* Active accent bar — 2px, full-height, neutral white. No glow. */}
      {active && (
        <span
          aria-hidden
          className="absolute start-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-e-sm bg-[var(--theme-primary)]"
        />
      )}
      <PrefetchNavLink
        to={to}
        onClick={onSelect}
        aria-current={active ? 'page' : false}
        data-tour={dataTour}
        className={cn(
          'flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-shape-md py-2 pe-2.5 ps-3 text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-0',
          active
            ? 'bg-[var(--surface-2)] font-medium text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
        )}
      >
        <Icon
          className={cn(
            'h-4 w-4 shrink-0 transition-colors',
            active ? 'text-[var(--theme-primary)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
      </PrefetchNavLink>
      {hoverAction && (
        <div className="ms-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {hoverAction}
        </div>
      )}
    </div>
  )
}

interface SectionHeaderProps {
  title: string
  icon: typeof Icons.home
  expanded: boolean
  active: boolean
  onToggle: () => void
  count?: number
}

function LinearSectionHeader({
  title,
  icon: Icon,
  expanded,
  active,
  onToggle,
  count,
}: SectionHeaderProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        'group h-auto min-h-10 w-full justify-start gap-2.5 rounded-shape-md px-2.5 py-2 text-left',
        'text-sm font-medium transition-colors',
        active
          ? 'bg-[var(--surface-2)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
      )}
    >
      <Icons.next
        className={cn(
          'h-3 w-3 shrink-0 transition-transform duration-fast ease-out',
          expanded ? 'rotate-90' : 'rotate-0',
        )}
        aria-hidden
      />
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          active ? 'text-[var(--theme-primary)]' : 'text-[var(--text-muted)]',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="rounded-shape-sm bg-[var(--surface-3)] px-1.5 py-0.5 text-xs font-medium tabular-nums text-[var(--text-muted)]">
          {count}
        </span>
      )}
    </Button>
  )
}

// ─── Trailing badges ─────────────────────────────────────────────────────

/** Single 6px dot — used for "has unread", never a number. */
function NotificationDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--theme-primary)]', className)}
    />
  )
}

/** Tiny monochrome count chip — used for vehicles, stale-data, etc. */
function CountChip({ value, label }: { value: number; label: string }) {
  return (
    <span
      aria-label={label}
      className="inline-flex h-4 min-w-[18px] items-center justify-center rounded-shape-sm bg-[var(--surface-2)] px-1 text-2xs font-medium tabular-nums text-[var(--text-secondary)]"
    >
      {value > 99 ? '99+' : value}
    </span>
  )
}

// ─── Main component ──────────────────────────────────────────────────────

export function LinearSidebar({
  sections = [],
  pinnedItems = [],
  pathname,
  navLabel,
  onPin,
  onUnpin,
  onItemSelect,
  activeSectionTitle,
  alertCount = 0,
  vehicleCount = 0,
  staleCount = 0,
}: LinearSidebarProps) {
  const { t } = useTranslation()
  const location = useLocation()
  // Honour caller-supplied pathname (lets tests pass a controlled value),
  // but fall back to the live router location so we still react to route
  // changes that bypass the parent re-render.
  const effectivePath = pathname ?? location.pathname

  // Fast lookup so we can hide the "pin" hover action for items that are
  // already in Favorites (they would still appear in their source section,
  // matching the legacy sidebar's behaviour — but the duplicate pin button
  // would be confusing).
  const pinnedSet = useMemo(
    () => new Set(pinnedItems.map(item => item.to)),
    [pinnedItems],
  )

  // ── Tree state ─────────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    // Default: collapse everything EXCEPT the section that contains the
    // current page. This matches Linear's "show me where I am" behaviour
    // and prevents the sidebar from being a 90-row wall on first paint.
    const initial = new Set<string>()
    for (const section of sections) {
      if (section.title !== activeSectionTitle) initial.add(section.title)
    }
    return initial
  })

  // When the active section changes (user navigates to a page in a
  // currently-collapsed section), expand that section automatically.
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

  const visiblePinned = pinnedItems
  const isExpanded = (title: string) => !collapsed.has(title)

  // ── Trailing-badge logic per item ──────────────────────────────────────
  const trailingFor = (to: string): React.ReactNode => {
    if (to === '/notifications/alerts' && alertCount > 0) {
      return <NotificationDot />
    }
    if (to === '/vehicles' && vehicleCount > 0) {
      return <CountChip value={vehicleCount} label={t('nav.vehicleCount', { count: vehicleCount, defaultValue: '{{count}} vehicles' })} />
    }
    if (to === '/data-repair' && staleCount > 0) {
      return <CountChip value={staleCount} label={t('nav.staleCount', { count: staleCount, defaultValue: '{{count}} stale rows' })} />
    }
    return null
  }

  // Pin-to-favorites hover button, rendered to the right of each row in
  // the regular sections (skipped for items already pinned — those have
  // an explicit unpin button up in the Favorites group). Uses the same
  // opacity-on-hover affordance as the unpin action for visual symmetry.
  const pinActionFor = (item: LinearSidebarSectionInput['items'][number]): React.ReactNode => {
    if (pinnedSet.has(item.to)) return null
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t('nav.pinPage', { page: navLabel(item.label), defaultValue: 'Pin {{page}} to favorites' })}
        title={t('nav.pinPage', { page: navLabel(item.label), defaultValue: 'Pin {{page}} to favorites' })}
        onClick={() => onPin(item.to)}
        className="h-6 w-6 rounded-shape-sm p-0 text-[var(--text-muted)] hover:bg-[var(--control-bg)] hover:text-[var(--theme-primary)]"
        data-testid={`linear-sidebar-pin-${item.to}`}
      >
        <Icons.star className="h-3 w-3" />
      </Button>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const expandedSections = sections.filter(s => s.items.length > 0)
  const sectionLabel = (title: string) => {
    const key = COMPACT_GROUP_I18N_KEYS[title]
    return key ? t(key, title) : title
  }

  // "Browse all features" escape hatch.
  //
  // The Linear tree is a curated subset (see `compactNav.ts`); the complete
  // catalog lives in the Feature Hub at `/explore`. `/explore` is a
  // first-class row in the Overview group, so we only surface the footer
  // link when that row is not actually on screen — i.e. Overview is
  // collapsed — which keeps the affordance explicit without duplicating it.
  const exploreInTree = sections.some(section =>
    section.items.some(item => item.to === EXPLORE_PATH),
  )
  const exploreRowVisible =
    visiblePinned.some(item => item.to === EXPLORE_PATH) ||
    expandedSections.some(
      section => isExpanded(section.title) && section.items.some(item => item.to === EXPLORE_PATH),
    )
  const showExploreFooter = exploreInTree && !exploreRowVisible

  return (
    <div className="flex h-full min-h-0 flex-col" data-role="linear-sidebar">
      {/* Tree */}
      <nav
        aria-label={t('nav.sidebar', 'Sidebar navigation')}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3 pb-5 scrollbar-thin"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* Favorites — only when there is at least one pinned item.
            Never collapses (Linear style: favorites are always visible). */}
        {visiblePinned.length > 0 && (
          <div className="mb-4 rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-2)]/60 p-2">
            <div
              className="flex items-center gap-2 rounded-shape-md px-2 py-1.5 text-xs font-semibold text-[var(--text-secondary)]"
              id="linear-nav-favorites-label"
            >
              <Icons.star className="h-3 w-3 shrink-0" aria-hidden />
              <span>{t('nav.quickAccess', 'Quick access')}</span>
            </div>
            <div className="mt-0.5 space-y-px" aria-labelledby="linear-nav-favorites-label">
              {visiblePinned
                .map(item => (
                  <LinearNavLink
                    key={`pinned-${item.to}`}
                    to={item.to}
                    label={navLabel(item.label)}
                    icon={item.icon}
                    active={false}
                    onSelect={onItemSelect}
                    trailing={trailingFor(item.to)}
                    hoverAction={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('nav.unpinPage', { page: navLabel(item.label), defaultValue: 'Unpin {{page}}' })}
                        title={t('nav.unpinPage', { page: navLabel(item.label), defaultValue: 'Unpin {{page}}' })}
                        onClick={() => onUnpin(item.to)}
                        className="h-6 w-6 rounded-shape-sm p-0 text-[var(--text-muted)] hover:bg-[var(--control-bg)] hover:text-[var(--text-secondary)]"
                        data-testid={`linear-sidebar-unpin-${item.to}`}
                      >
                        <Icons.close className="h-3 w-3" />
                      </Button>
                    }
                  />
                ))}
            </div>
          </div>
        )}

        {/* Sections */}
        <div className="space-y-1.5">
          {expandedSections.map(section => {
            const expanded = isExpanded(section.title)
            const active = section.title === activeSectionTitle
            const sectionIcon = section.items[0]?.icon ?? Icons.home
            return (
              <div key={section.title} className="space-y-0.5">
                <LinearSectionHeader
                  title={sectionLabel(section.title)}
                  icon={sectionIcon}
                  expanded={expanded}
                  active={active}
                  onToggle={() => toggleSection(section.title)}
                  count={section.items.length}
                />
                {expanded && (
                  <div className="ms-4 space-y-px border-s border-[var(--border-default)] ps-2.5" role="group" aria-label={sectionLabel(section.title)}>
                    {section.items.map(item => (
                      <LinearNavLink
                        key={item.to}
                        to={item.to}
                        label={navLabel(item.label)}
                        icon={item.icon}
                        active={isActiveLinearPath(effectivePath, item.to)}
                        onSelect={onItemSelect}
                        trailing={trailingFor(item.to)}
                        hoverAction={pinActionFor(item)}
                        dataTour={item.dataTour}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {expandedSections.length === 0 && visiblePinned.length === 0 && (
            <div
              className="rounded-md px-3 py-4 text-center text-xs text-[var(--text-muted)]"
              role="status"
              data-testid="linear-sidebar-empty"
            >
              <p>{t('nav.empty', 'No pages available.')}</p>
            </div>
          )}
        </div>

        {showExploreFooter && (
          <div
            className="mt-3 border-t border-[var(--border-default)] pt-2"
            data-testid="linear-sidebar-explore-footer"
          >
            <LinearNavLink
              to={EXPLORE_PATH}
              label={t('nav.browseAllFeatures', 'Browse all features')}
              icon={Icons.sparkles}
              active={isActiveLinearPath(effectivePath, EXPLORE_PATH)}
              onSelect={onItemSelect}
            />
          </div>
        )}
      </nav>
    </div>
  )
}

export default LinearSidebar
