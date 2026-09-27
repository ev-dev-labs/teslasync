/**
 * SectionRail
 * ───────────
 * The primary column of the Command Deck: every parent group in one
 * scrolling list — hub shortcuts (Search, Suggested, Saved, All pages)
 * pinned above the section groups, utility links plus the collapse
 * toggle pinned below.
 *
 * Collapses to icons-only (persisted by the host): labels unmount, the
 * accessible names stay full, and sighted users get an instant label
 * flyout on hover/focus (native `title` is too slow to scan by).
 * Desktop renders it in-flow at rail width; mobile renders it full
 * drawer width as the drill-in root (always expanded there).
 */

import { useTranslation } from 'react-i18next'
import { PrefetchNavLink } from '../PrefetchLink'
import { Button } from '@/components/ui/runtime'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import type { SidebarSectionInput } from '../sectionGroups'
import type { SectionGroup } from '../sectionGroups'
import { flattenSidebarItems } from './collections'
import { SIDEBAR_SECTION_ICONS, SIDEBAR_SHORTCUT_ICONS } from './sidebarIcons'
import { routeIconColor } from './iconColors'
import { SidebarFlyout, useSidebarFlyout } from './SidebarFlyout'
import type { DeckSelection } from './CommandDeck'

export interface SectionRailProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  showCollapseControl?: boolean
  /** Current secondary-panel selection, or null when it is closed. */
  selection: DeckSelection | null
  onSelect: (selection: DeckSelection) => void
  onItemSelect?: () => void
  /** Ref sink so the deck can return focus here when the panel closes. */
  itemRef?: (key: string, el: HTMLButtonElement | null) => void
  sections: SidebarSectionInput[]
  collections?: readonly SectionGroup[]
  navSectionTitle: (section: { title: string; titleKey?: string }) => string
  suggestedCount: number
  favoritesCount: number
  alertCount: number
}

export function selectionKey(selection: DeckSelection): string {
  return selection.kind === 'section' ? `section:${selection.title}` : selection.kind
}

function RailBadge({ value, label }: { value: number; label: string }) {
  if (value <= 0) return null
  return (
    <span
      aria-label={label}
      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--theme-primary)] px-1 text-2xs font-semibold tabular-nums text-[var(--text-on-accent)]"
    >
      {value > 99 ? '99+' : value}
    </span>
  )
}

interface RailButtonProps {
  icon: typeof Icons.home
  iconColor?: string
  label: string
  countLabel?: string
  active: boolean
  collapsed: boolean
  onClick: () => void
  badge?: React.ReactNode
  buttonRef?: (el: HTMLButtonElement | null) => void
  /** Secondary flyout line when collapsed; falls back to `countLabel`. */
  tipContext?: string
  onShowTip?: (anchor: HTMLElement, label: string, context?: string) => void
  onHideTip?: () => void
}

function RailButton({
  icon: Icon,
  iconColor,
  label,
  countLabel,
  active,
  collapsed,
  onClick,
  badge,
  buttonRef,
  tipContext,
  onShowTip,
  onHideTip,
}: RailButtonProps) {
  const tipDetail = tipContext ?? countLabel
  const handleTipShow = (e: React.SyntheticEvent<HTMLButtonElement>) => {
    onShowTip?.(e.currentTarget, label, tipDetail)
  }
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      onMouseEnter={collapsed ? handleTipShow : undefined}
      onMouseLeave={collapsed ? onHideTip : undefined}
      onFocus={collapsed ? handleTipShow : undefined}
      onBlur={collapsed ? onHideTip : undefined}
      aria-label={countLabel ? `${label}, ${countLabel}` : label}
      aria-pressed={active}
      className={cn(
        'h-auto min-h-11 w-full gap-2.5 rounded-shape-md px-2.5 py-2 text-sm',
        collapsed ? 'justify-center px-1' : 'justify-start',
        active
          ? 'bg-[var(--surface-2)] font-medium text-[var(--text-primary)]'
          : 'font-normal text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
        'focus-visible:ring-[var(--focus-ring)]',
      )}
    >
      <span className="relative inline-flex shrink-0">
        <Icon className={cn(collapsed ? 'h-6 w-6' : 'h-5 w-5', active ? 'text-[var(--theme-primary)]' : routeIconColor(iconColor))} aria-hidden />
        {collapsed && badge && (
          <span className="absolute -end-2 -top-2">{badge}</span>
        )}
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate text-start leading-snug">{label}</span>
          {badge}
        </>
      )}
    </Button>
  )
}

export function SectionRail({
  collapsed,
  onToggleCollapsed,
  showCollapseControl = true,
  selection,
  onSelect,
  onItemSelect,
  itemRef,
  sections,
  collections = [],
  navSectionTitle,
  suggestedCount,
  favoritesCount,
  alertCount,
}: SectionRailProps) {
  const { t } = useTranslation()
  const safeSections = sections ?? []
  const safeCollections = collections ?? []
  const isActive = (key: string) => selection !== null && selectionKey(selection) === key

  const { rootRef, tip, showTip, hideTip, tipHandlers } = useSidebarFlyout()

  return (
    <div
      ref={rootRef}
      role="navigation"
      aria-label={t('nav.deck.groups', 'Sections and shortcuts')}
      onMouseLeave={hideTip}
      className="relative flex h-full min-h-0 w-full flex-col bg-[var(--surface-1)]"
    >
      <div
        onScroll={hideTip}
        className="min-h-0 flex-1 space-y-px overflow-y-auto overscroll-contain px-1.5 py-2 scrollbar-thin"
      >
        <RailButton
          icon={SIDEBAR_SHORTCUT_ICONS.search}
          label={t('nav.deck.search', 'Search')}
          active={isActive('search')}
          collapsed={collapsed}
          onClick={() => onSelect({ kind: 'search' })}
          buttonRef={el => itemRef?.('search', el)}
          onShowTip={showTip}
          onHideTip={hideTip}
        />
        <RailButton
          icon={SIDEBAR_SHORTCUT_ICONS.suggested}
          label={t('nav.deck.suggested', 'Suggested')}
          active={isActive('suggested')}
          collapsed={collapsed}
          onClick={() => onSelect({ kind: 'suggested' })}
          buttonRef={el => itemRef?.('suggested', el)}
          tipContext={suggestedCount > 0 ? t('nav.deck.suggestedCount', { count: suggestedCount, defaultValue: '{{count}} suggestions' }) : undefined}
          onShowTip={showTip}
          onHideTip={hideTip}
          badge={(
            <RailBadge
              value={suggestedCount}
              label={t('nav.deck.suggestedCount', { count: suggestedCount, defaultValue: '{{count}} suggestions' })}
            />
          )}
        />
        <RailButton
          icon={SIDEBAR_SHORTCUT_ICONS.saved}
          label={t('nav.deck.saved', 'Saved')}
          active={isActive('favorites')}
          collapsed={collapsed}
          onClick={() => onSelect({ kind: 'favorites' })}
          buttonRef={el => itemRef?.('favorites', el)}
          tipContext={favoritesCount > 0 ? t('nav.deck.favoritesCount', { count: favoritesCount, defaultValue: '{{count}} pinned pages' }) : undefined}
          onShowTip={showTip}
          onHideTip={hideTip}
          badge={(
            <RailBadge
              value={favoritesCount}
              label={t('nav.deck.favoritesCount', { count: favoritesCount, defaultValue: '{{count}} pinned pages' })}
            />
          )}
        />

        <PrefetchNavLink
          to="/explore"
          onClick={onItemSelect}
          aria-label={t('nav.deck.allPages', 'All pages')}
          {...(collapsed ? tipHandlers(t('nav.deck.allPages', 'All pages')) : {})}
          className={cn(
            'flex min-h-11 w-full items-center gap-2.5 rounded-shape-md px-2.5 py-2 text-sm font-normal text-[var(--text-secondary)] transition-colors',
            collapsed && 'justify-center px-1',
            'hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
          )}
        >
          <SIDEBAR_SHORTCUT_ICONS.allPages className={cn(collapsed ? 'h-6 w-6 shrink-0' : 'h-5 w-5 shrink-0', routeIconColor(undefined))} aria-hidden />
          {!collapsed && (
            <span className="min-w-0 flex-1 truncate text-start leading-snug">{t('nav.deck.allPages', 'All pages')}</span>
          )}
        </PrefetchNavLink>

        <div aria-hidden className="mx-2 py-1.5">
          <div className="border-t border-[var(--border-default)]" />
        </div>

        {safeSections.map(section => {
          const count = flattenSidebarItems(section.items, safeCollections).length
          if (count === 0) return null
          const key = `section:${section.title}`
          const SectionIcon = SIDEBAR_SECTION_ICONS[section.title] ?? section.items[0]?.icon ?? Icons.home
          return (
            <RailButton
              key={section.title}
              icon={SectionIcon}
              iconColor={section.items[0]?.color}
              label={navSectionTitle(section)}
              countLabel={t('nav.deck.pageCount', { count, defaultValue: '{{count}} pages' })}
              active={isActive(key)}
              collapsed={collapsed}
              onClick={() => onSelect({ kind: 'section', title: section.title })}
              buttonRef={el => itemRef?.(key, el)}
              onShowTip={showTip}
              onHideTip={hideTip}
            />
          )
        })}
      </div>

      <div className="shrink-0 border-t border-[var(--border-default)] px-1.5 py-1.5">
        <div className="flex flex-col gap-0.5">
          <PrefetchNavLink
            to="/notifications/inbox"
            onClick={onItemSelect}
            aria-label={t('nav.deck.alerts', 'Alerts')}
            {...(collapsed ? tipHandlers(
              t('nav.deck.alerts', 'Alerts'),
              alertCount > 0 ? t('nav.deck.alertCount', { count: alertCount, defaultValue: '{{count}} unread alerts' }) : undefined,
            ) : {})}
            className={cn(
              'relative flex min-h-11 w-full items-center gap-2.5 rounded-shape-md px-2.5 text-sm text-[var(--text-secondary)] transition-colors',
              collapsed && 'justify-center px-1',
              'hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
            )}
          >
            <SIDEBAR_SHORTCUT_ICONS.alerts className={collapsed ? 'h-6 w-6' : 'h-5 w-5'} aria-hidden />
            {!collapsed && <span className="min-w-0 flex-1 truncate text-start">{t('nav.deck.alerts', 'Alerts')}</span>}
            {alertCount > 0 && (
              <span className={collapsed ? 'absolute -end-0.5 top-0' : 'shrink-0'}>
                <RailBadge value={alertCount} label={t('nav.deck.alertCount', { count: alertCount, defaultValue: '{{count}} unread alerts' })} />
              </span>
            )}
          </PrefetchNavLink>
          <PrefetchNavLink
            to="/settings#appearance"
            onClick={onItemSelect}
            aria-label={t('nav.deck.display', 'Display')}
            {...(collapsed ? tipHandlers(t('nav.deck.display', 'Display')) : {})}
            className={cn(
              'flex min-h-11 w-full items-center gap-2.5 rounded-shape-md px-2.5 text-sm text-[var(--text-secondary)] transition-colors',
              collapsed && 'justify-center px-1',
              'hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
            )}
          >
            <SIDEBAR_SHORTCUT_ICONS.display className={collapsed ? 'h-6 w-6' : 'h-5 w-5'} aria-hidden />
            {!collapsed && <span className="min-w-0 flex-1 truncate text-start">{t('nav.deck.display', 'Display')}</span>}
          </PrefetchNavLink>
        </div>
        {showCollapseControl && <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            // The label flips with the state — dismiss the stale flyout.
            hideTip()
            onToggleCollapsed()
          }}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('nav.deck.expand', 'Expand sidebar') : t('nav.deck.collapse', 'Collapse sidebar')}
          title={collapsed ? t('nav.deck.expand', 'Expand sidebar') : t('nav.deck.collapse', 'Collapse sidebar')}
          {...tipHandlers(collapsed ? t('nav.deck.expand', 'Expand sidebar') : t('nav.deck.collapse', 'Collapse sidebar'))}
          className={cn(
            'mt-1 min-h-11 w-full gap-2.5 rounded-shape-md text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]',
            collapsed ? 'justify-center p-0' : 'justify-start px-2.5',
          )}
        >
          {collapsed
            ? <Icons.sidebarPrimaryExpand className="h-5 w-5 rtl:scale-x-[-1]" aria-hidden />
            : <Icons.sidebarPrimaryCollapse className="h-5 w-5 rtl:scale-x-[-1]" aria-hidden />}
          {!collapsed && <span>{t('nav.deck.collapseShort', 'Collapse')}</span>}
        </Button>}
      </div>

      <SidebarFlyout tip={tip} testId="rail-tip" />
    </div>
  )
}

export default SectionRail
