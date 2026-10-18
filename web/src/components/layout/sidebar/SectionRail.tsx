import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/runtime'
import { Tooltip } from '@/components/ui/Tooltip'
import { Avatar } from '@/components/data-display/Avatar'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import { PrefetchNavLink } from '../PrefetchLink'
import type { SidebarSectionInput, SectionGroup } from '../sectionGroups'
import { resolveSectionIcon } from './sidebarIcons'
import { flattenSidebarItems } from './collections'
import type { DeckSelection } from './CommandDeck'

export interface SectionRailProps {
  sections: SidebarSectionInput[]
  selection: DeckSelection | null
  onSelect: (selection: DeckSelection) => void
  navLabel?: (item: { label: string; labelKey: string }) => string
  navSectionTitle: (section: { title: string; titleKey?: string }) => string
  panelOpen?: boolean
  pathname?: string
  alertCount: number
  appearanceControl?: ReactNode
  onItemSelect?: () => void
  onUtilityActivate?: () => void
  itemRef?: (key: string, el: HTMLButtonElement | null) => void
  // Retained for callers of the shared rail API.
  collapsed?: boolean
  onToggleCollapsed?: () => void
  showCollapseControl?: boolean
  collections?: readonly SectionGroup[]
  suggestedCount?: number
  favoritesCount?: number
}
export function selectionKey(selection: DeckSelection) {
  return selection.kind === 'section' ? `section:${selection.title}` : selection.kind
}
export function SectionRail({ sections, selection, onSelect, navSectionTitle, navLabel, panelOpen, pathname, alertCount, appearanceControl, onItemSelect, onUtilityActivate, itemRef, collections = [] }: SectionRailProps) {
  const { t } = useTranslation()
  const shortLabels: Record<string, string> = {
    'Advanced intelligence': t('nav.sidenav.shortAdvanced', 'Advanced'),
    'Ownership intelligence': t('nav.sidenav.shortOwnership', 'Ownership'),
    'Tesla physics': t('nav.sidenav.shortPhysics', 'Physics'),
    Notifications: t('nav.sidenav.shortAlerts', 'Alerts'),
    Integrations: t('nav.sidenav.shortConnect', 'Connect'),
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const selected = selection?.kind === 'section' ? selection.title : 'Home'
  const [focusTitle, setFocusTitle] = useState(selected)
  const [fades, setFades] = useState({ top: false, bottom: false })
  useEffect(() => {
    setFocusTitle(selected)
    buttons.current[sections.findIndex(s => s.title === selected)]?.scrollIntoView?.({ block: 'nearest' })
  }, [selected, sections, pathname])
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const update = () => setFades({ top: element.scrollTop > 1, bottom: element.scrollTop + element.clientHeight < element.scrollHeight - 2 })
    update()
    element.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(element)
    return () => { observer?.disconnect(); element.removeEventListener('scroll', update) }
  }, [sections])
  return <div role="navigation" className="sidenav-rail" aria-label={t('nav.deck.groups', 'Sections and shortcuts')}>
    <div className="sidenav-brand" aria-hidden="true"><Icons.charging className="h-6 w-6" /></div>
    <div className="sidenav-scroll-wrap">
      <div ref={scrollRef} data-testid="rail-scroll" className="sidenav-rail-scroll">
        {sections.map((section, index) => {
          const label = navSectionTitle(section)
          const short = shortLabels[section.title]
          const Icon = resolveSectionIcon(section.title)
          return <Button key={section.title} ref={element => { buttons.current[index] = element; itemRef?.(`section:${section.title}`, element) }}
              type="button" variant="ghost" aria-label={label} aria-current={selected === section.title ? 'true' : undefined}
              aria-expanded={selected === section.title && panelOpen} tabIndex={focusTitle === section.title ? 0 : -1}
              className={cn('sidenav-rail-item', selected === section.title && 'is-selected')}
              onFocus={() => setFocusTitle(section.title)}
              onKeyDown={event => {
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
                  : event.key === 'ArrowDown' ? (index + 1) % sections.length
                  : event.key === 'ArrowUp' ? (index - 1 + sections.length) % sections.length : -1
                if (next < 0) return
                event.preventDefault()
                buttons.current[next]?.focus()
                buttons.current[next]?.scrollIntoView?.({ block: 'nearest' })
              }} onClick={() => onSelect({ kind: 'section', title: section.title })}>
              <span className="sidenav-icon"><Icon className="h-5 w-5" aria-hidden /></span>
              <span className="sidenav-short-label">{short ?? label}</span>
            </Button>
        })}
      </div>
      <div aria-hidden data-testid="rail-fade-top" data-visible={fades.top} className="sidenav-fade sidenav-fade-top" />
      <div aria-hidden data-testid="rail-fade-bottom" data-visible={fades.bottom} className="sidenav-fade sidenav-fade-bottom" />
    </div>
    <div className="sidenav-utilities">
      <Tooltip content={t('nav.deck.alerts', 'Alerts')} side="right">
        <PrefetchNavLink to="/notifications/inbox" onClick={() => { onUtilityActivate?.(); onItemSelect?.() }} className="sidenav-utility" aria-label={t('nav.deck.alerts', 'Alerts')}>
          <Icons.notificationsActive className="h-5 w-5" aria-hidden />
          {alertCount > 0 && <span className="sidenav-alert-count" aria-label={t('nav.deck.alertCount', { count: alertCount, defaultValue: '{{count}} unread alerts' })}>{alertCount > 99 ? '99+' : alertCount}</span>}
        </PrefetchNavLink>
      </Tooltip>
      <Tooltip content={t('nav.deck.display', 'Display')} side="right">
        <div className="sidenav-utility">{appearanceControl ?? <PrefetchNavLink to="/settings#appearance" onClick={() => { onUtilityActivate?.(); onItemSelect?.() }} aria-label={t('nav.deck.display', 'Display')}><Icons.palette className="h-5 w-5" aria-hidden /></PrefetchNavLink>}</div>
      </Tooltip>
      <Tooltip content={t('nav.groups.account', 'Account')} side="right"><details className="sidenav-account" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false }}>
        <summary className="sidenav-utility" aria-label={t('nav.groups.account', 'Account')} onClick={onUtilityActivate} onKeyDown={event => {
          const account = event.currentTarget.closest('details')
          if (event.key === 'Escape' && account?.open) { event.stopPropagation(); account.open = false }
        }}><Avatar size="sm" /></summary>
        <div className="sidenav-account-menu">
          {flattenSidebarItems(sections.find(section => section.title === 'Account')?.items ?? [], collections).map(item => <PrefetchNavLink key={item.to} to={item.to} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onItemSelect?.() }} onKeyDown={event => {
            const account = event.currentTarget.closest('details')
            if (event.key === 'Escape' && account?.open) { event.stopPropagation(); account.open = false; account.querySelector('summary')?.focus() }
          }} className="sidenav-account-link">{navLabel?.(item) ?? item.label}</PrefetchNavLink>)}
        </div>
      </details></Tooltip>
    </div>
  </div>
}
export default SectionRail
