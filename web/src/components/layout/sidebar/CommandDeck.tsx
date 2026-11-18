import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/runtime'
import { SectionRail } from './SectionRail'
import { AtlasPanel, type AtlasPanelProps } from './AtlasPanel'
import { BottomTabBar } from '../BottomTabBar'
import { resolveSectionIcon } from './sidebarIcons'
import { NavSheet } from '../horizontal-nav/NavSheet'
import { handleMenuVertical, inlineKeys, menuItems } from '../horizontal-nav/navKeyboard'
import { Icons } from '@/lib/icons'
import type { SidebarSectionInput, SectionGroup } from '../sectionGroups'
import type { SidebarSuggestion } from './sidebarSuggest'
import './sidenav.css'
type RailSelection = { kind: 'more' } | { kind: 'section'; title: string }
export type DeckSelection = { kind: 'suggested' } | { kind: 'favorites' } | { kind: 'section'; title: string }
export interface CommandDeckProps {
  sections: SidebarSectionInput[]
  pinnedItems: SidebarSectionInput['items']
  suggestions?: SidebarSuggestion[]
  pathname: string
  navLabel: AtlasPanelProps['navLabel']
  navSectionTitle: AtlasPanelProps['navSectionTitle']
  onPin: (to: string) => void
  onUnpin: (to: string) => void
  pinSyncUnavailable?: boolean
  onItemSelect?: () => void
  alertCount?: number
  vehicleCount?: number
  staleCount?: number
  vehicleId?: string
  collections?: readonly SectionGroup[]
  panelOpen: boolean
  onPanelOpenChange: (open: boolean) => void
  activeSectionTitle?: string
  mobileBrowseOpen?: boolean
  getBrowseTrigger?: () => HTMLElement | null
  // Public callers still using the previous deck controls remain type-compatible.
  railCollapsed?: boolean
  onToggleRailCollapsed?: () => void
  panelCollapsed?: boolean
  onTogglePanelCollapsed?: () => void
}
const VIEW_KEY = 'teslasync-deck-view'
function readView(): DeckSelection | null {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as DeckSelection | null } catch { return null }
}
export function resolveDeckSection(stored: DeckSelection | null, sections: readonly SidebarSectionInput[] = [], routeTitle?: string): string {
  const routeSection = sections.find(section => section.title === routeTitle)
  if (routeSection) return routeSection.title
  if (stored?.kind === 'section' && sections.some(section => section.title === stored.title)) return stored.title
  return sections[0]?.title ?? 'Home'
}
export function CommandDeck(props: CommandDeckProps) {
  const { t } = useTranslation()
  const { sections = [], pathname, activeSectionTitle, panelOpen, onPanelOpenChange, onItemSelect, mobileBrowseOpen } = props
  const sectionLabel = props.navSectionTitle ?? ((section: { title: string }) => section.title)
  const id = useId()
  const content = useRef<HTMLDivElement>(null)
  const invoker = useRef<HTMLElement | null>(null)
  const enterPanel = useRef(false)
  const [stored, setStored] = useState(readView)
  const [browsed, setBrowsed] = useState<{ pathname: string; title: string } | null>(null)
  const title = browsed?.pathname === pathname && sections.some(section => section.title === browsed.title)
    ? browsed.title : resolveDeckSection(stored, sections, activeSectionTitle)
  const [homeView, setHomeView] = useState<DeckSelection | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [phoneSheet, setPhoneSheet] = useState<{ section?: string } | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth < 1024 ? 'phone' : window.innerWidth < 1280 ? 'tablet' : 'desktop')
  const currentViewport = useRef(viewport)
  const [deferTabletPanel, setDeferTabletPanel] = useState(false)
  const panelVisible = panelOpen && !(viewport === 'tablet' && deferTabletPanel)
  const previousPath = useRef(pathname)
  const previousBrowse = useRef(false)
  useEffect(() => {
    const resize = () => {
      const next = window.innerWidth < 1024 ? 'phone' : window.innerWidth < 1280 ? 'tablet' : 'desktop'
      if (next !== currentViewport.current) {
        // Keep the docked preference without mounting a competing modal on resize.
        setDeferTabletPanel(next === 'tablet' && document.querySelector(
          '[aria-modal="true"]:not(.sidenav-tablet-panel):not(.horizontal-nav-sheet)',
        ) !== null)
        if (next !== 'phone' && currentViewport.current === 'phone') {
          setPhoneSheet(null)
          if (previousBrowse.current) onItemSelect?.()
        }
        currentViewport.current = next
      }
      setViewport(next)
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [onItemSelect])
  useEffect(() => {
    if (mobileBrowseOpen && !previousBrowse.current) {
      if (viewport === 'phone') {
        invoker.current = props.getBrowseTrigger?.() ?? null
        setPhoneSheet({})
      }
    }
    previousBrowse.current = !!mobileBrowseOpen
  }, [mobileBrowseOpen, viewport, props.getBrowseTrigger])
  useEffect(() => {
    if (pathname === previousPath.current) return
    previousPath.current = pathname
    setBrowsed(null)
    setStored({ kind: 'section', title: activeSectionTitle ?? sections[0]?.title ?? 'Home' })
    setHomeView(null)
    setMoreOpen(false)
    setPhoneSheet(null)
    if (viewport !== 'desktop') onPanelOpenChange(false)
  }, [pathname, activeSectionTitle, sections, viewport, onPanelOpenChange])
  useEffect(() => {
    // Preserve a fallback until route metadata or the saved section arrives.
    if (!activeSectionTitle && stored?.kind === 'section' && !sections.some(section => section.title === stored.title)) return
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ kind: 'section', title })) } catch { /* Private storage is optional. */ }
  }, [title, stored, sections, activeSectionTitle])
  useLayoutEffect(() => {
    if (!panelVisible || !enterPanel.current || !content.current) return
    enterPanel.current = false
    ;(menuItems(content.current)[0] ?? content.current.querySelector('input'))?.focus()
  }, [panelVisible, title, moreOpen])
  const getReturnFocusTarget = () => invoker.current?.isConnected ? invoker.current : props.getBrowseTrigger?.() ?? null
  const close = () => {
    onPanelOpenChange(false); setPhoneSheet(null); setMoreOpen(false); onItemSelect?.()
    if (viewport === 'desktop') getReturnFocusTarget()?.focus()
  }
  const select = (selection: RailSelection, trigger: HTMLButtonElement, enter = false, fromMore = false) => {
    if (!fromMore) invoker.current = trigger
    setDeferTabletPanel(false)
    setHomeView(null)
    enterPanel.current = enter
    if (selection.kind === 'more') {
      if (!enter && moreOpen && panelVisible) { close(); return }
      if (moreOpen && panelVisible) menuItems(content.current)[0]?.focus()
      setMoreOpen(true)
      onPanelOpenChange(true)
      return
    }
    if (!enter && panelVisible && !moreOpen && title === selection.title) { close(); return }
    if (enter && panelVisible && !moreOpen && title === selection.title) menuItems(content.current)[0]?.focus()
    setMoreOpen(false)
    setBrowsed({ pathname, title: selection.title })
    setStored(selection)
    onPanelOpenChange(true)
  }
  const view: DeckSelection = title === 'Home' && homeView ? homeView : { kind: 'section', title }
  const panel = <div ref={content} id={id} className="flex h-full min-h-0 w-full flex-col" onKeyDown={event => {
    if (event.key === 'Escape' || event.key === inlineKeys(event.currentTarget).back && menuItems(content.current).includes(event.target as HTMLElement)) {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else handleMenuVertical(event)
  }}>
    {moreOpen ? <div role="navigation" data-testid="atlas-panel-secondary" data-app-part="navigation"
      aria-label={t('nav.mobileMore', 'More')} className="sidenav-panel min-h-0 flex-1 overflow-y-auto bg-[var(--nav-context-bg)] p-2">
      {sections.filter(section => section.railPlacement === 'more').map(section => {
        const Icon = resolveSectionIcon(section.title)
        return <Button key={section.title} data-nav-choice variant="ghost" className="min-h-11 w-full justify-start whitespace-normal text-start"
          onKeyDown={event => {
            if (event.key !== inlineKeys(event.currentTarget).forward) return
            event.preventDefault()
            select({ kind: 'section', title: section.title }, event.currentTarget, true, true)
          }}
          onClick={event => select({ kind: 'section', title: section.title }, event.currentTarget, true, true)}>
          <Icon className="size-4 shrink-0" aria-hidden />{sectionLabel(section)}<Icons.next className="ms-auto size-4 shrink-0 rtl:rotate-180" aria-hidden />
        </Button>
      })}
    </div> : <AtlasPanel {...props} sections={sections} navSectionTitle={sectionLabel} key={title} view={view}
    onClose={close} onHomeViewChange={setHomeView}
    onItemSelect={() => { if (viewport !== 'desktop') onPanelOpenChange(false); onItemSelect?.() }} />}
  </div>
  return <div data-role="command-deck" data-panel-open={panelVisible} className="sidenav-deck">
    {viewport !== 'phone' && <>
      <div data-testid="command-deck-rail" className="sidenav-rail-column" onKeyDown={event => {
        if (event.key === 'Escape' && panelVisible) { event.stopPropagation(); close() }
      }}><SectionRail sections={sections} navSectionTitle={sectionLabel}
        selection={{ kind: 'section', title }} onSelect={select} panelOpen={panelVisible} panelId={id} moreOpen={moreOpen} pathname={pathname} /></div>
      {viewport === 'desktop' && panelOpen && <div data-testid="command-deck-secondary" className="sidenav-context-column">{panel}</div>}
      <Modal open={viewport === 'tablet' && panelVisible} onClose={close} getReturnFocusTarget={getReturnFocusTarget}
        ariaLabel={moreOpen ? t('nav.mobileMore', 'More') : sectionLabel(sections.find(s => s.title === title) ?? { title })}
        className="sidenav-tablet-panel">{panel}</Modal>
    </>}
    {viewport === 'phone' && <>
      <BottomTabBar sections={sections} activeSection={activeSectionTitle} openSection={phoneSheet && invoker.current !== props.getBrowseTrigger?.() ? phoneSheet.section ?? null : undefined}
        sheetId={id} onChoose={(section, element) => { invoker.current = element; setPhoneSheet(section ? { section } : {}) }} />
      {phoneSheet && <NavSheet id={id} initialSection={phoneSheet.section} activeSectionTitle={activeSectionTitle}
        model={{ sections, collections: props.collections ?? [], pathname, pinnedPaths: new Set(props.pinnedItems.map(item => item.to)),
          onPin: props.onPin, onUnpin: props.onUnpin, pinSyncUnavailable: props.pinSyncUnavailable, unreadCount: props.alertCount ?? 0,
          vehicleId: props.vehicleId, vehicleCount: props.vehicleCount ?? 0, staleCount: props.staleCount ?? 0 }}
        onClose={() => { setPhoneSheet(null); onItemSelect?.() }} getReturnFocusTarget={getReturnFocusTarget} />}
    </>}
  </div>
}
export default CommandDeck
