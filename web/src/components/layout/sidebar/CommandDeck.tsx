import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { SectionRail } from './SectionRail'
import { AtlasPanel, type AtlasPanelProps } from './AtlasPanel'
import { BottomTabBar } from '../BottomTabBar'
import { NavSheet } from '../horizontal-nav/NavSheet'
import { handleMenuVertical, inlineKeys, menuItems } from '../horizontal-nav/navKeyboard'
import type { SidebarSectionInput, SectionGroup } from '../sectionGroups'
import type { SidebarSuggestion } from './sidebarSuggest'
import './sidenav.css'
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
  }, [panelVisible, title])
  const getReturnFocusTarget = () => invoker.current?.isConnected ? invoker.current : props.getBrowseTrigger?.() ?? null
  const close = () => {
    onPanelOpenChange(false); setPhoneSheet(null); onItemSelect?.()
    if (viewport === 'desktop') getReturnFocusTarget()?.focus()
  }
  const select = (sectionTitle: string, trigger: HTMLButtonElement, enter = false) => {
    invoker.current = trigger
    setDeferTabletPanel(false)
    setHomeView(null)
    if (panelVisible && title === sectionTitle) {
      if (enter) (menuItems(content.current)[0] ?? content.current?.querySelector('input'))?.focus()
      else close()
      return
    }
    enterPanel.current = enter
    setBrowsed({ pathname, title: sectionTitle })
    setStored({ kind: 'section', title: sectionTitle })
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
    <AtlasPanel {...props} sections={sections} navSectionTitle={sectionLabel} key={title} view={view}
      onClose={close} onHomeViewChange={setHomeView}
      onItemSelect={() => { if (viewport !== 'desktop') onPanelOpenChange(false); onItemSelect?.() }} />
  </div>
  return <div data-role="command-deck" data-panel-open={panelVisible} className="sidenav-deck">
    {viewport !== 'phone' && <>
      <div data-testid="command-deck-rail" className="sidenav-rail-column" onKeyDown={event => {
        if (event.key === 'Escape' && panelVisible) { event.stopPropagation(); close() }
      }}><SectionRail sections={sections} navSectionTitle={sectionLabel}
        selected={title} onSelect={select} panelOpen={panelVisible} panelId={id} pathname={pathname} /></div>
      {viewport === 'desktop' && panelOpen && <div data-testid="command-deck-secondary" className="sidenav-context-column">{panel}</div>}
      <Modal open={viewport === 'tablet' && panelVisible} onClose={close} getReturnFocusTarget={getReturnFocusTarget}
        ariaLabel={sectionLabel(sections.find(s => s.title === title) ?? { title })}
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
