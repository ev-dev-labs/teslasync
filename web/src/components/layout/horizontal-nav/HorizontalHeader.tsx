import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useUnreadCount } from '@/api/hooks/useNotifications'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { Icons } from '@/lib/icons'
import { Button } from '@/components/ui/Button'
import { CommandPaletteTrigger } from '@/components/ui/CommandPaletteTrigger'
import { NotificationBellPopover } from '../NotificationBellPopover'
import { VehiclePicker } from '../VehiclePicker'
import { WorkspaceContextControl } from '../WorkspaceContextControl'
import { resolveSectionIcon } from '../sidebar/sidebarIcons'
import { NavSheet } from './NavSheet'
import { SectionFlyout } from './SectionFlyout'
import { handleMenuVertical, menuItems } from './navKeyboard'
import type { NavModel } from './navGroups'
import { usePrioritySections } from './usePrioritySections'
import './horizontal-nav.css'

type Popup = { kind: 'more'; section?: never } | { kind: 'section'; section: string; fromMore?: boolean } | { kind: 'sheet'; section?: string }
type Props = Omit<NavModel, 'unreadCount'> & { activeSectionTitle?: string; appearance: ReactNode }

export default function HorizontalHeader({ activeSectionTitle, appearance, ...data }: Props) {
  const { t } = useTranslation()
  const compact = useMediaQuery('(max-width: 1023px), (hover: none)')
  const { data: unreadCount = 0 } = useUnreadCount()
  const scope = useWorkspaceScope()
  const id = useId()
  const header = useRef<HTMLElement>(null)
  const moreMenu = useRef<HTMLDivElement>(null)
  const browseTrigger = useRef<HTMLButtonElement>(null)
  const moreTrigger = useRef<HTMLButtonElement>(null)
  const returnTarget = useRef<HTMLElement | null>(null)
  const [popup, setPopup] = useState<Popup | null>(null)
  const model = { ...data, unreadCount }
  const account = data.sections.find(section => section.titleKey === 'nav.groups.account')
  const sections = data.sections.filter(section => section !== account)
  const label = (section: (typeof sections)[number]) => section.titleKey ? t(section.titleKey, section.title) : section.title
  const moreLabel = t('nav.mobileMore', 'More')
  const browseLabel = t('nav.flyout.browse', 'Browse sections')
  const { lane, ruler, count } = usePrioritySections(!compact, sections.map(label), moreLabel)
  const folded = sections.slice(count)
  const section = data.sections.find(candidate => candidate.title === popup?.section)
  const desktopPopup = !compact && popup && popup.kind !== 'sheet'
  const isMore = desktopPopup && (popup.kind === 'more' || (popup.kind === 'section' && popup.fromMore))
  const showRange = scope.range || (!compact && !scope.managed)
  const showVehicle = scope.vehicle || (!compact && !scope.managed)
  const workspace = (showRange || showVehicle) && <div className="horizontal-nav-scope">
    <WorkspaceContextControl hidden={!showRange} className={compact ? 'max-w-40 px-2' : 'max-w-32 px-2'} />
    {showVehicle && <VehiclePicker hideWhenSingle={false}
      className={compact ? 'min-w-0 flex-1 border-b-0 px-0 py-0 lg:px-0 lg:py-0' : 'w-32 min-w-0 border-b-0 px-0 py-0 lg:px-0 lg:py-0'} />}
  </div>
  const getReturnFocusTarget = () => returnTarget.current?.isConnected ? returnTarget.current
    : browseTrigger.current ?? moreTrigger.current ?? header.current?.querySelector<HTMLButtonElement>('[data-horizontal-nav-trigger]') ?? null
  const close = (restore = false) => {
    if (restore) getReturnFocusTarget()?.focus()
    setPopup(null)
  }
  const activate = (next: Popup, invoker: HTMLElement, toggle = true) => {
    const same = popup?.kind === next.kind && popup.section === next.section
    returnTarget.current = invoker
    setPopup(toggle && same ? null : next)
  }
  const openOnDown = (event: KeyboardEvent<HTMLButtonElement>, next: Popup) => {
    if (event.key !== 'ArrowDown') return
    event.preventDefault()
    activate(next, event.currentTarget, false)
    if (next.kind === 'more') menuItems(moreMenu.current)[0]?.focus()
    else if (next.kind === 'section') {
      header.current?.querySelector<HTMLElement>('[data-role="section-flyout"] [data-nav-choice]')?.focus()
    }
  }

  useLayoutEffect(() => {
    if (popup?.kind === 'more') menuItems(moreMenu.current)[0]?.focus()
  }, [popup])
  useLayoutEffect(() => {
    if (!popup || (compact === (popup.kind === 'sheet') && returnTarget.current?.isConnected)) return
    const fallback = browseTrigger.current ?? moreTrigger.current ?? header.current?.querySelector<HTMLButtonElement>('[data-horizontal-nav-trigger]')
    fallback?.focus()
    setPopup(null)
  }, [compact, count, popup])
  useEffect(() => { setPopup(null) }, [data.pathname])
  useEffect(() => {
    if (!desktopPopup) return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !header.current?.contains(event.target) ||
        !event.target.closest('.horizontal-nav-popup, [data-horizontal-nav-trigger]')) setPopup(null)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [desktopPopup])

  return <header ref={header} data-role="horizontal-header" className="horizontal-header" aria-label={t('a11y.primaryHeader', 'Site header')}
    onKeyDown={event => {
      if (event.key === 'Escape' && desktopPopup) { event.preventDefault(); event.stopPropagation(); close(true) }
    }} onBlur={event => {
      if (desktopPopup && event.relatedTarget && !header.current?.contains(event.relatedTarget)) close()
    }}>
    <span className="horizontal-nav-brand" aria-hidden><Icons.charging className="size-5" /></span>
    <nav data-app-part="navigation" data-tour="sidebar" aria-label={t('a11y.primaryNav', 'Primary')} className="horizontal-nav-primary">
      {compact ? <Button ref={browseTrigger} data-horizontal-nav-trigger variant="ghost" className="horizontal-nav-trigger"
        aria-haspopup="dialog" aria-expanded={popup?.kind === 'sheet' && !popup.section} aria-controls={popup?.kind === 'sheet' ? id : undefined}
        onClick={event => activate({ kind: 'sheet' }, event.currentTarget)} onKeyDown={event => openOnDown(event, { kind: 'sheet' })}>
        <Icons.menu className="size-5 shrink-0" aria-hidden /><span>{browseLabel}</span>
      </Button> : <>
        <div ref={lane} className="horizontal-nav-lane">
          {sections.slice(0, count).map(candidate => {
            const next = { kind: 'section', section: candidate.title } as const
            const expanded = desktopPopup && popup.kind === 'section' && !popup.fromMore && section === candidate
            return <Button key={candidate.title} data-horizontal-nav-trigger variant="ghost" className="horizontal-nav-trigger"
              aria-current={candidate.title === activeSectionTitle ? 'true' : undefined}
              aria-haspopup="menu" aria-expanded={!!expanded} aria-controls={expanded ? id : undefined}
              onClick={event => activate(next, event.currentTarget)} onKeyDown={event => openOnDown(event, next)}>
              {label(candidate)}
            </Button>
          })}
          {folded.length > 0 && <Button ref={moreTrigger} data-horizontal-nav-trigger variant="ghost" className="horizontal-nav-trigger"
            aria-haspopup="menu" aria-expanded={!!isMore} aria-controls={isMore ? id : undefined}
            aria-current={folded.some(candidate => candidate.title === activeSectionTitle) ? 'true' : undefined}
            onClick={event => isMore ? close(true) : activate({ kind: 'more' }, event.currentTarget)}
            onKeyDown={event => openOnDown(event, { kind: 'more' })}>
            {moreLabel}<Icons.expand className="size-4 shrink-0" aria-hidden />
          </Button>}
        </div>
        <div className="horizontal-nav-ruler-clip" aria-hidden>
          <div ref={ruler} className="horizontal-nav-lane horizontal-nav-ruler">
            {[...sections.map(label), moreLabel].map((text, index) =>
              <Button key={text} variant="ghost" className="horizontal-nav-trigger" tabIndex={-1}>
                {text}{index === sections.length && <Icons.expand className="size-4 shrink-0" aria-hidden />}
              </Button>)}
          </div>
        </div>
      </>}
    </nav>
    {!compact && workspace}
    <div className="horizontal-nav-tools">
      <CommandPaletteTrigger compact />
      <NotificationBellPopover className="horizontal-nav-bell" />
      {appearance}
      {account && <Button data-horizontal-nav-trigger variant="ghost" className="horizontal-nav-icon"
        aria-label={label(account)} aria-haspopup={compact ? 'dialog' : 'menu'}
        aria-expanded={!!popup && popup.section === account.title} aria-controls={popup?.section === account.title ? id : undefined}
        onClick={event => activate({ kind: compact ? 'sheet' : 'section', section: account.title }, event.currentTarget)}
        onKeyDown={event => openOnDown(event, { kind: compact ? 'sheet' : 'section', section: account.title })}>
        <Icons.user className="size-5" aria-hidden />
      </Button>}
    </div>
    {compact && workspace}
    {desktopPopup && popup.kind === 'more' && <div id={id} role="menu" tabIndex={-1} aria-label={moreLabel} ref={moreMenu}
      className="horizontal-nav-popup horizontal-nav-more" onKeyDown={event => { handleMenuVertical(event) }}>
      {folded.map((candidate, index) => {
        const Icon = resolveSectionIcon(candidate.title)
        const open = () => setPopup({ kind: 'section', section: candidate.title, fromMore: true })
        return <Button key={candidate.title} data-nav-choice variant="ghost" className="horizontal-nav-row" role="menuitem"
          aria-haspopup="menu" tabIndex={index === 0 ? 0 : -1} onClick={open} onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') return
            const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
            if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) { event.preventDefault(); open() }
          }}>
          <Icon className="size-4 shrink-0" aria-hidden /><span>{label(candidate)}</span>
          <Icons.next className="size-4 shrink-0 rtl:rotate-180" aria-hidden />
        </Button>
      })}
    </div>}
    {desktopPopup && popup.kind === 'section' && section && <SectionFlyout key={section.title} id={id}
      section={section} model={model} onSelect={() => close()} />}
    {compact && popup?.kind === 'sheet' && <NavSheet id={id} model={model} initialSection={popup.section}
      onClose={() => close()} getReturnFocusTarget={getReturnFocusTarget} />}
  </header>
}
