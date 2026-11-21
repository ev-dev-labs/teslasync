import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { Icons } from '@/lib/icons'
import { Button } from '@/components/ui/Button'
import { NavSheet } from './NavSheet'
import { SectionFlyout } from './SectionFlyout'
import { HorizontalSectionRail } from './HorizontalSectionRail'
import type { NavModel } from './navGroups'
import './horizontal-nav.css'

const COMPACT_NAV = '(max-width: 1023px)'
type Popup = { kind: 'section'; section: string } | { kind: 'sheet'; section?: string }
type Props = {
  model: NavModel
  activeSectionTitle?: string
  context?: ReactNode
  workspace?: ReactNode
  tools?: ReactNode
  label?: string
}

/** Navigation presentation only: callers own data, persistence and workspace controls. */
export function HorizontalNavigation({ model, activeSectionTitle, context, workspace, tools, label }: Props) {
  const { t } = useTranslation()
  const compact = useMediaQuery(COMPACT_NAV)
  const id = useId()
  const header = useRef<HTMLElement>(null)
  const browseTrigger = useRef<HTMLButtonElement>(null)
  const returnTarget = useRef<HTMLElement | null>(null)
  const [popup, setPopup] = useState<Popup | null>(null)
  const account = model.sections.find(section => section.titleKey === 'nav.groups.account')
  const sections = model.sections.filter(section => section !== account)
  const browseLabel = t('nav.flyout.browse', 'Browse sections')
  const section = model.sections.find(candidate => candidate.title === popup?.section)
  const desktopPopup = !compact && popup?.kind === 'section'
  const getReturnFocusTarget = () => returnTarget.current?.isConnected ? returnTarget.current
    : browseTrigger.current ?? header.current?.querySelector<HTMLButtonElement>('[data-horizontal-nav-trigger]') ?? null
  const close = useCallback((restore = false) => {
    if (restore && returnTarget.current?.isConnected) returnTarget.current.focus()
    setPopup(null)
  }, [])
  const dismiss = useCallback(() => close(), [close])
  const dismissFlyout = useCallback(() => {
    // Let the breakpoint transition close the flyout and restore focus.
    if (!window.matchMedia(COMPACT_NAV).matches) dismiss()
  }, [dismiss])
  const activate = (next: Popup, invoker: HTMLElement, toggle = true) => {
    const same = popup?.kind === next.kind && popup.section === next.section
    returnTarget.current = invoker
    setPopup(toggle && same ? null : next)
  }
  const focusOpenGroup = () => header.current
    ?.querySelector<HTMLElement>('[data-role="section-flyout"] [data-nav-choice][aria-expanded="true"]')?.focus()
  const openOnDown = (event: KeyboardEvent<HTMLButtonElement>, next: Popup) => {
    if (event.key !== 'ArrowDown') return
    event.preventDefault()
    activate(next, event.currentTarget, false)
    if (next.kind === 'section') focusOpenGroup()
  }

  useLayoutEffect(() => {
    if (!popup || (compact === (popup.kind === 'sheet') && returnTarget.current?.isConnected)) return
    const fallback = browseTrigger.current ?? header.current?.querySelector<HTMLButtonElement>('[data-horizontal-nav-trigger]')
    fallback?.focus()
    setPopup(null)
  }, [compact, popup])
  useEffect(() => { setPopup(null) }, [model.pathname])
  useEffect(() => {
    if (!desktopPopup) return
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !header.current?.contains(event.target) ||
        !event.target.closest('.horizontal-nav-popup, [data-horizontal-nav-trigger]')) dismiss()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [desktopPopup, dismiss])

  const breadcrumbs = context && <div className="horizontal-nav-context">{context}</div>
  const primary = <nav data-app-part="navigation" data-tour="sidebar" aria-label={label ?? t('a11y.primaryNav', 'Primary')} className="horizontal-nav-primary">
    {compact ? <Button ref={browseTrigger} data-horizontal-nav-trigger variant="ghost" className="horizontal-nav-trigger"
      aria-label={browseLabel} aria-haspopup="dialog" aria-expanded={popup?.kind === 'sheet' && !popup.section}
      aria-controls={popup?.kind === 'sheet' ? id : undefined}
      onClick={event => activate({ kind: 'sheet' }, event.currentTarget)} onKeyDown={event => openOnDown(event, { kind: 'sheet' })}>
      <Icons.menu className="size-5 shrink-0" aria-hidden /><span className="hidden sm:inline">{browseLabel}</span>
    </Button> : <HorizontalSectionRail sections={sections} activeSectionTitle={activeSectionTitle}
      openSectionTitle={desktopPopup ? popup.section : undefined} panelId={id}
      onSelect={(title, trigger, enter) => {
        activate({ kind: 'section', section: title }, trigger, !enter)
        if (enter) focusOpenGroup()
      }} />}
  </nav>
  const utilities = <div className="horizontal-nav-tools">
    {tools}
    {account && <Button data-horizontal-nav-trigger variant="ghost" className="horizontal-nav-icon"
      aria-label={account.titleKey ? t(account.titleKey, account.title) : account.title}
      aria-haspopup={compact ? 'dialog' : 'menu'}
      aria-expanded={!!popup && popup.section === account.title} aria-controls={popup?.section === account.title ? id : undefined}
      onClick={event => activate({ kind: compact ? 'sheet' : 'section', section: account.title }, event.currentTarget)}
      onKeyDown={event => openOnDown(event, { kind: compact ? 'sheet' : 'section', section: account.title })}>
      <Icons.user className="size-5" aria-hidden />
    </Button>}
  </div>

  return <header ref={header} data-role="horizontal-header" className="horizontal-header" aria-label={label ?? t('a11y.primaryHeader', 'Site header')}
    onKeyDownCapture={event => {
      if (event.key === 'Escape' && desktopPopup) { event.preventDefault(); event.stopPropagation(); close(true) }
    }} onBlur={event => {
      if (desktopPopup && event.relatedTarget && !header.current?.contains(event.relatedTarget)) close()
    }}>
    {compact ? <>{breadcrumbs}{primary}{utilities}{workspace}</> : <>
      <div className="horizontal-nav-command">
        <div className="horizontal-nav-brand"><Icons.charging className="size-6 shrink-0" aria-hidden />TeslaSync</div>
        {breadcrumbs}
        {workspace}
        {utilities}
      </div>
      {primary}
    </>}
    {desktopPopup && section && <SectionFlyout key={section.title} id={id} anchor={returnTarget.current}
      section={section} model={model} onSelect={dismiss} onClose={() => close(true)} onDismiss={dismissFlyout} />}
    {compact && popup?.kind === 'sheet' && <NavSheet id={id} model={model} initialSection={popup.section} activeSectionTitle={activeSectionTitle}
      onClose={dismiss} getReturnFocusTarget={getReturnFocusTarget} />}
  </header>
}
