import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Icons } from '@/lib/icons'
import type { SidebarSectionInput } from '../sectionGroups'
import { resolveSectionIcon } from '../sidebar/sidebarIcons'
import { inlineKeys, menuItems } from './navKeyboard'

function revealItem(lane: HTMLElement, item: HTMLElement) {
  const bounds = lane.getBoundingClientRect()
  const tile = item.getBoundingClientRect()
  const left = tile.left < bounds.left - 1 ? tile.left - bounds.left
    : tile.right > bounds.right + 1 ? tile.right - bounds.right : 0
  if (left) lane.scrollBy?.({ left })
}

export function HorizontalSectionRail({ sections, activeSectionTitle, openSectionTitle, panelId, onSelect }: {
  sections: readonly SidebarSectionInput[]
  activeSectionTitle?: string
  openSectionTitle?: string
  panelId: string
  onSelect: (title: string, trigger: HTMLButtonElement, enter?: boolean) => void
}) {
  const { t } = useTranslation()
  const laneId = useId()
  const rail = useRef<HTMLDivElement>(null)
  const [focusTitle, setFocusTitle] = useState(activeSectionTitle)
  const [overflow, setOverflow] = useState({ previous: false, next: false })
  const tabStop = sections.some(section => section.title === focusTitle) ? focusTitle
    : sections.find(section => section.title === activeSectionTitle)?.title ?? sections[0]?.title
  const shortLabels: Record<string, string> = {
    'Advanced intelligence': t('nav.sidenav.shortAdvanced', 'Advanced'),
    'Ownership intelligence': t('nav.sidenav.shortOwnership', 'Ownership'),
    'Tesla physics': t('nav.sidenav.shortPhysics', 'Physics'),
  }

  useLayoutEffect(() => {
    setFocusTitle(activeSectionTitle)
    const lane = rail.current
    const current = lane?.querySelector<HTMLElement>('[aria-current="true"]')
    if (lane && current) revealItem(lane, current)
  }, [activeSectionTitle])
  useLayoutEffect(() => {
    const scroll = rail.current
    if (!scroll) return
    const update = () => {
      const bounds = scroll.getBoundingClientRect()
      const first = scroll.firstElementChild?.getBoundingClientRect()
      const last = scroll.lastElementChild?.getBoundingClientRect()
      const rtl = getComputedStyle(scroll).direction === 'rtl'
      const previous = !!first && (rtl ? first.right > bounds.right + 1 : first.left < bounds.left - 1)
      const next = !!last && (rtl ? last.left < bounds.left - 1 : last.right > bounds.right + 1)
      setOverflow(value => value.previous === previous && value.next === next ? value : { previous, next })
    }
    update()
    scroll.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(scroll)
    for (const item of scroll.children) observer?.observe(item)
    return () => { observer?.disconnect(); scroll.removeEventListener('scroll', update) }
  }, [sections])

  const pageRail = (direction: 'previous' | 'next') => {
    const lane = rail.current
    if (!lane || !overflow[direction]) return
    const rtl = getComputedStyle(lane).direction === 'rtl'
    lane.scrollBy({ left: (rtl === (direction === 'next') ? -1 : 1) * lane.clientWidth })
  }

  return <div className="horizontal-nav-rail-wrap">
    <Button type="button" variant="outline" className="horizontal-nav-icon horizontal-nav-page"
      aria-label={t('common.previous', 'Previous')} aria-controls={laneId} aria-disabled={!overflow.previous}
      onClick={() => pageRail('previous')}>
      <Icons.previous className="size-5 rtl:rotate-180" aria-hidden />
    </Button>
    <div id={laneId} ref={rail} data-horizontal-rail className="horizontal-nav-lane" onKeyDown={event => {
      if (event.defaultPrevented) return
      const items = menuItems(event.currentTarget)
      const index = items.indexOf(event.target as HTMLElement)
      if (index < 0) return
      const { forward, back } = inlineKeys(event.currentTarget)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : event.key === forward ? (index + 1) % items.length
        : event.key === back ? (index + items.length - 1) % items.length : -1
      if (next < 0) return
      event.preventDefault()
      items[next]?.focus({ preventScroll: true })
    }}>
      {sections.map(section => {
        const label = section.titleKey ? t(section.titleKey, section.title) : section.title
        const Icon = resolveSectionIcon(section.title)
        const expanded = openSectionTitle === section.title
        return <Button key={section.title} data-horizontal-nav-trigger data-nav-choice data-app-part="nav-item"
          type="button" variant="ghost" className="horizontal-nav-trigger horizontal-nav-rail-item" aria-label={label}
          aria-current={section.title === activeSectionTitle ? 'true' : undefined}
          aria-haspopup="menu" aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
          tabIndex={tabStop === section.title ? 0 : -1}
          onFocus={event => {
            setFocusTitle(section.title)
            if (rail.current) revealItem(rail.current, event.currentTarget)
          }}
          onClick={event => onSelect(section.title, event.currentTarget)}
          onKeyDown={event => {
            if (event.key !== 'ArrowDown') return
            event.preventDefault()
            onSelect(section.title, event.currentTarget, true)
          }}>
          <span className="horizontal-nav-section-icon"><Icon className="size-5 shrink-0" aria-hidden /></span>
          <span>{shortLabels[section.title] ?? label}</span>
        </Button>
      })}
    </div>
    <Button type="button" variant="outline" className="horizontal-nav-icon horizontal-nav-page"
      aria-label={t('common.next', 'Next')} aria-controls={laneId} aria-disabled={!overflow.next}
      onClick={() => pageRail('next')}>
      <Icons.next className="size-5 rtl:rotate-180" aria-hidden />
    </Button>
  </div>
}
