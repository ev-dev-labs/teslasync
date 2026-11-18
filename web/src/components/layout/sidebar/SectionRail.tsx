import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/runtime'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'
import type { SidebarSectionInput } from '../sectionGroups'
import { handleMenuVertical, inlineKeys, menuItems } from '../horizontal-nav/navKeyboard'
import { useNavIconMotion } from './useNavIconMotion'
import { resolveSectionIcon } from './sidebarIcons'

interface SectionRailProps {
  sections: readonly SidebarSectionInput[]
  selected: string
  onSelect: (title: string, trigger: HTMLButtonElement, enter?: boolean) => void
  navSectionTitle: (section: { title: string; titleKey?: string }) => string
  panelOpen?: boolean
  panelId?: string
  pathname?: string
}

export function SectionRail({ sections, selected, onSelect, navSectionTitle, panelOpen, panelId, pathname }: SectionRailProps) {
  const { t } = useTranslation()
  const motion = useNavIconMotion()
  const rail = useRef<HTMLDivElement>(null)
  const [focusTitle, setFocusTitle] = useState(selected)
  const [fades, setFades] = useState({ top: false, bottom: false })
  const shortLabels: Record<string, string> = {
    'Advanced intelligence': t('nav.sidenav.shortAdvanced', 'Advanced'),
    'Ownership intelligence': t('nav.sidenav.shortOwnership', 'Ownership'),
    'Tesla physics': t('nav.sidenav.shortPhysics', 'Physics'),
    Notifications: t('nav.sidenav.shortInbox', 'Inbox'),
    Integrations: t('nav.sidenav.shortConnect', 'Connect'),
  }
  useEffect(() => {
    setFocusTitle(selected)
    if (rail.current && rail.current.scrollHeight > rail.current.clientHeight) {
      rail.current.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }
  }, [selected, pathname])
  useEffect(() => {
    const scroll = rail.current
    if (!scroll) return
    const update = () => {
      const top = scroll.scrollTop > 1
      const bottom = scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 2
      setFades(previous => previous.top === top && previous.bottom === bottom ? previous : { top, bottom })
    }
    update()
    scroll.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(scroll)
    return () => { observer?.disconnect(); scroll.removeEventListener('scroll', update) }
  }, [sections.length])
  const tabStop = sections.some(section => section.title === focusTitle) ? focusTitle
    : sections.some(section => section.title === selected) ? selected : sections[0]?.title

  return <div {...motion} data-app-part="navigation" role="navigation" className="sidenav-rail" aria-label={t('nav.deck.groups', 'Sections and shortcuts')}>
    <div className="sidenav-brand" aria-hidden="true"><Icons.charging className="h-6 w-6" /></div>
    <div className="sidenav-scroll-wrap">
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
        {sections.map(section => {
          const { title } = section
          const label = navSectionTitle(section)
          const Icon = resolveSectionIcon(title)
          const isCurrent = selected === title
          const expanded = !!panelOpen && isCurrent
          return <Button key={title} data-nav-choice data-nav-action data-app-part="nav-item" type="button" variant="ghost"
            aria-label={label} aria-current={isCurrent ? 'true' : undefined} aria-expanded={expanded}
            aria-controls={expanded ? panelId : undefined} tabIndex={tabStop === title ? 0 : -1}
            className={cn('sidenav-rail-item', isCurrent && 'is-selected')}
            onFocus={() => setFocusTitle(title)}
            onKeyDown={event => {
              if ((event.key === 'ArrowDown' && !event.ctrlKey) || event.key === inlineKeys(event.currentTarget).forward) {
                event.preventDefault()
                onSelect(title, event.currentTarget, true)
              }
            }} onClick={event => onSelect(title, event.currentTarget)}>
            <span data-nav-motion className="sidenav-icon nav-motion-target"><Icon className="h-5 w-5" aria-hidden /></span>
            <span className="sidenav-short-label">{shortLabels[title] ?? label}</span>
          </Button>
        })}
      </div>
      <div aria-hidden data-testid="rail-fade-top" data-visible={fades.top} className="sidenav-fade sidenav-fade-top" />
      <div aria-hidden data-testid="rail-fade-bottom" data-visible={fades.bottom} className="sidenav-fade sidenav-fade-bottom" />
    </div>
  </div>
}
