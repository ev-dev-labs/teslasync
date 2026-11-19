import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import type { SidebarSectionInput } from '../sectionGroups'
import { resolveSectionIcon } from '../sidebar/sidebarIcons'
import { inlineKeys, menuItems } from './navKeyboard'

export function HorizontalSectionRail({ sections, activeSectionTitle, openSectionTitle, panelId, onSelect }: {
  sections: readonly SidebarSectionInput[]
  activeSectionTitle?: string
  openSectionTitle?: string
  panelId: string
  onSelect: (title: string, trigger: HTMLButtonElement, enter?: boolean) => void
}) {
  const { t } = useTranslation()
  const rail = useRef<HTMLDivElement>(null)
  const [focusTitle, setFocusTitle] = useState(activeSectionTitle)
  const [fades, setFades] = useState({ left: false, right: false })
  const tabStop = sections.some(section => section.title === focusTitle) ? focusTitle
    : sections.find(section => section.title === activeSectionTitle)?.title ?? sections[0]?.title

  useLayoutEffect(() => {
    setFocusTitle(activeSectionTitle)
    rail.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeSectionTitle])
  useLayoutEffect(() => {
    const scroll = rail.current
    if (!scroll) return
    const update = () => {
      const bounds = scroll.getBoundingClientRect()
      const items = menuItems(scroll).map(item => item.getBoundingClientRect())
      // Physical edges avoid browser-specific RTL scrollLeft conventions.
      const left = items.some(item => item.left < bounds.left - 1)
      const right = items.some(item => item.right > bounds.right + 1)
      setFades(previous => previous.left === left && previous.right === right ? previous : { left, right })
    }
    update()
    scroll.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(scroll)
    for (const item of scroll.children) observer?.observe(item)
    return () => { observer?.disconnect(); scroll.removeEventListener('scroll', update) }
  }, [sections])

  return <div className="horizontal-nav-rail-wrap">
    <div ref={rail} data-horizontal-rail className="horizontal-nav-lane" onKeyDown={event => {
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
      items[next]?.focus()
    }}>
      {sections.map(section => {
        const label = section.titleKey ? t(section.titleKey, section.title) : section.title
        const Icon = resolveSectionIcon(section.title)
        const expanded = openSectionTitle === section.title
        return <Button key={section.title} data-horizontal-nav-trigger data-nav-choice data-app-part="nav-item"
          variant="ghost" className="horizontal-nav-trigger horizontal-nav-rail-item" aria-label={label}
          aria-current={section.title === activeSectionTitle ? 'true' : undefined}
          aria-haspopup="menu" aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
          tabIndex={tabStop === section.title ? 0 : -1}
          onFocus={event => {
            setFocusTitle(section.title)
            event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
          }}
          onClick={event => onSelect(section.title, event.currentTarget)}
          onKeyDown={event => {
            if (event.key !== 'ArrowDown') return
            event.preventDefault()
            onSelect(section.title, event.currentTarget, true)
          }}>
          <Icon className="size-5 shrink-0" aria-hidden />
          <span>{label}</span>
        </Button>
      })}
    </div>
    <div aria-hidden data-testid="horizontal-rail-fade-left" data-visible={fades.left} className="horizontal-nav-fade horizontal-nav-fade-left" />
    <div aria-hidden data-testid="horizontal-rail-fade-right" data-visible={fades.right} className="horizontal-nav-fade horizontal-nav-fade-right" />
  </div>
}
