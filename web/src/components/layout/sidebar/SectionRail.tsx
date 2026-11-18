import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/runtime'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import { NAV_UTILITY_ICONS } from './NavIcons'
import type { SidebarSectionInput } from '../sectionGroups'
import { handleMenuVertical, inlineKeys, menuItems } from '../horizontal-nav/navKeyboard'
import { useNavIconMotion } from './useNavIconMotion'
import { resolveSectionIcon } from './sidebarIcons'
import type { DeckSelection } from './CommandDeck'

interface SectionRailProps {
  sections: readonly SidebarSectionInput[]
  selection: DeckSelection | null
  onSelect: (selection: { kind: 'more' } | { kind: 'section'; title: string }, trigger: HTMLButtonElement, enter?: boolean) => void
  navSectionTitle: (section: { title: string; titleKey?: string }) => string
  panelOpen?: boolean
  panelId?: string
  moreOpen?: boolean
  pathname?: string
}

export function SectionRail({ sections, selection, onSelect, navSectionTitle, panelOpen, panelId, moreOpen, pathname }: SectionRailProps) {
  const { t } = useTranslation()
  const motion = useNavIconMotion()
  const rail = useRef<HTMLDivElement>(null)
  const [focusTitle, setFocusTitle] = useState<string>()
  const selected = selection?.kind === 'section' ? selection.title : undefined
  const more = sections.filter(section => section.railPlacement === 'more')
  const moreActive = more.some(section => section.title === selected)
  const current = moreActive ? 'more' : selected
  useEffect(() => {
    setFocusTitle(current)
    if (rail.current && rail.current.scrollHeight > rail.current.clientHeight) {
      rail.current.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }
  }, [current, pathname])
  const asEntry = (section: SidebarSectionInput) => ({
    title: section.title, label: navSectionTitle(section), Icon: resolveSectionIcon(section.title),
    kind: 'section' as const, bottom: section.railPlacement === 'bottom',
  })
  const entries = [
    ...sections.filter(section => !section.railPlacement).map(asEntry),
    ...(more.length ? [{ title: 'more', label: t('nav.mobileMore', 'More'), Icon: NAV_UTILITY_ICONS.more, kind: 'more' as const, bottom: true }] : []),
    ...sections.filter(section => section.railPlacement === 'bottom').map(asEntry),
  ]
  const tabStop = entries.some(entry => entry.title === focusTitle) ? focusTitle
    : moreActive ? 'more' : entries.some(entry => entry.title === selected) ? selected : entries[0]?.title

  return <div {...motion} data-app-part="navigation" role="navigation" className="sidenav-rail" aria-label={t('nav.deck.groups', 'Sections and shortcuts')}>
    <div className="sidenav-brand" aria-hidden="true"><Icons.charging className="h-6 w-6" /></div>
    <div ref={rail} data-testid="rail-scroll" className="sidenav-rail-scroll" onKeyDown={event => {
      if (event.defaultPrevented) return
      if (event.ctrlKey && event.key === 'ArrowDown') {
        const items = menuItems(event.currentTarget)
        const index = items.indexOf(event.target as HTMLElement)
        if (index >= 0) { event.preventDefault(); items[(index + 1) % items.length]?.focus() }
        return
      }
      handleMenuVertical(event)
    }}>
      {entries.map(({ title, label, Icon, kind, bottom }, index) => {
        const isCurrent = kind === 'more' ? moreActive : selected === title
        const expanded = !!panelOpen && (kind === 'more' ? moreOpen || moreActive : isCurrent && !moreOpen)
        const target = kind === 'more' ? { kind } : { kind, title }
        return <Button key={title} data-nav-choice data-nav-action data-app-part="nav-item" type="button" variant="ghost"
          aria-label={label} aria-current={isCurrent ? 'true' : undefined} aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined} tabIndex={tabStop === title ? 0 : -1}
          className={cn('sidenav-rail-item', (expanded || isCurrent) && 'is-selected', bottom && !entries[index - 1]?.bottom && 'sidenav-rail-bottom')}
          onFocus={() => setFocusTitle(title)}
          onKeyDown={event => {
            if ((event.key === 'ArrowDown' && !event.ctrlKey) || event.key === inlineKeys(event.currentTarget).forward) {
              event.preventDefault()
              onSelect(target, event.currentTarget, true)
            }
          }} onClick={event => onSelect(target, event.currentTarget)}>
          <span data-nav-motion className="sidenav-icon nav-motion-target"><Icon className="h-5 w-5" aria-hidden /></span>
          <span className="sidenav-short-label">{title === 'Notifications' ? t('nav.sidenav.shortInbox', 'Inbox') : label}</span>
        </Button>
      })}
    </div>
  </div>
}
