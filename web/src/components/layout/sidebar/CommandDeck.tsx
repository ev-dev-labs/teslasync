import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/runtime'
import { Icons } from '@/lib/icons'
import { SectionRail } from './SectionRail'
import { AtlasPanel, type AtlasPanelProps } from './AtlasPanel'
import { BottomTabBar } from '../BottomTabBar'
import { SIDEBAR_SECTION_ICONS } from './sidebarIcons'
import type { SidebarSectionInput, SectionGroup } from '../sectionGroups'
import type { SidebarSuggestion } from './sidebarSuggest'
import './sidenav.css'
export type DeckSelection = { kind: 'suggested' } | { kind: 'favorites' } | { kind: 'section'; title: string }
export interface CommandDeckProps {
  sections: SidebarSectionInput[]
  pinnedItems: SidebarSectionInput['items']
  recentItems?: SidebarSectionInput['items']
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
  appearanceControl?: ReactNode
  mobileBrowseOpen?: boolean
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
  if (stored?.kind === 'section' && sections.some(section => section.title === stored.title)) return stored.title
  return sections.find(section => section.title === routeTitle)?.title ?? sections[0]?.title ?? 'Home'
}
export function CommandDeck(props: CommandDeckProps) {
  const { t } = useTranslation()
  const { sections = [], pathname, activeSectionTitle, panelOpen, onPanelOpenChange, onItemSelect, mobileBrowseOpen } = props
  const sectionLabel = props.navSectionTitle ?? ((section: { title: string }) => section.title)
  const railItems = useRef(new Map<string, HTMLButtonElement>())
  const [stored, setStored] = useState(readView)
  const title = resolveDeckSection(stored, sections, activeSectionTitle)
  const [homeView, setHomeView] = useState<DeckSelection | null>(null)
  const [phoneSheet, setPhoneSheet] = useState<'more' | 'section' | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth < 768 ? 'phone' : window.innerWidth < 1280 ? 'tablet' : 'desktop')
  const previousPath = useRef(pathname)
  const previousBrowse = useRef(mobileBrowseOpen)
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth < 768 ? 'phone' : window.innerWidth < 1280 ? 'tablet' : 'desktop')
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    if (mobileBrowseOpen && !previousBrowse.current) {
      if (viewport === 'phone') setPhoneSheet('more')
      else onPanelOpenChange(true)
    }
    previousBrowse.current = mobileBrowseOpen
  }, [mobileBrowseOpen, viewport, onPanelOpenChange])
  useEffect(() => {
    if (pathname === previousPath.current) return
    previousPath.current = pathname
    setStored({ kind: 'section', title: activeSectionTitle ?? sections[0]?.title ?? 'Home' })
    setHomeView(null)
    setPhoneSheet(null)
    if (viewport !== 'desktop') onPanelOpenChange(false)
  }, [pathname, activeSectionTitle, sections, viewport, onPanelOpenChange])
  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ kind: 'section', title })) } catch { /* Private storage is optional. */ }
  }, [title])
  useEffect(() => {
    if (viewport !== 'tablet' || !panelOpen) return
    // The rail stays interactive beside the drawer, so Escape must also work
    // when focus is on its selected section rather than inside the modal.
    const escape = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]')
      if (event.key !== 'Escape' || event.defaultPrevented || !dialogs[dialogs.length - 1]?.classList.contains('sidenav-tablet-panel')) return
      onPanelOpenChange(false)
      onItemSelect?.()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [viewport, panelOpen, onPanelOpenChange, onItemSelect])
  const close = () => {
    onPanelOpenChange(false); setPhoneSheet(null); onItemSelect?.()
    if (viewport === 'desktop') requestAnimationFrame(() => railItems.current.get(title)?.focus())
  }
  const select = (selection: DeckSelection) => {
    if (selection.kind !== 'section') return
    setHomeView(null)
    setStored(selection)
    if (viewport === 'phone') setPhoneSheet('section')
    else onPanelOpenChange(!(panelOpen && title === selection.title))
  }
  const view: DeckSelection = title === 'Home' && homeView ? homeView : { kind: 'section', title }
  const panel = <AtlasPanel {...props} sections={sections} navSectionTitle={sectionLabel} key={title} view={view}
    onClose={close} onHomeViewChange={setHomeView}
    onItemSelect={() => { setPhoneSheet(null); if (viewport !== 'desktop') onPanelOpenChange(false); onItemSelect?.() }} />
  return <div data-role="command-deck" className="sidenav-deck">
    {viewport !== 'phone' && <>
      <div data-testid="command-deck-rail" className="sidenav-rail-column"><SectionRail {...props} sections={sections} navSectionTitle={sectionLabel} alertCount={props.alertCount ?? 0}
        onUtilityActivate={() => { if (viewport === 'tablet') { onPanelOpenChange(false); onItemSelect?.() } }}
        itemRef={(key, element) => { const name = key.replace(/^section:/, ''); if (element) railItems.current.set(name, element); else railItems.current.delete(name) }}
        selection={{ kind: 'section', title }} onSelect={select} panelOpen={panelOpen} /></div>
      {viewport === 'desktop' && panelOpen && <div data-testid="command-deck-secondary" className="sidenav-context-column">{panel}</div>}
      <Modal open={viewport === 'tablet' && panelOpen} onClose={close} ariaLabel={sectionLabel(sections.find(s => s.title === title) ?? { title })}
        className="sidenav-tablet-panel">{panel}</Modal>
    </>}
    {viewport === 'phone' && <>
      <BottomTabBar activeSection={activeSectionTitle} onChoose={section => { if (section) select({ kind: 'section', title: section }); else setPhoneSheet('more') }} />
      <Modal open={phoneSheet !== null} onClose={() => { setPhoneSheet(null); onItemSelect?.() }}
        title={phoneSheet === 'more' ? t('nav.mobileMore', 'More') : undefined}
        ariaLabel={sectionLabel(sections.find(s => s.title === title) ?? { title })} className="sidenav-sheet">
        {phoneSheet === 'more' ? <div className="sidenav-section-grid">{sections.map(section => {
          const Icon = SIDEBAR_SECTION_ICONS[section.title] ?? Icons.home
          return <Button key={section.title} type="button" variant="ghost" onClick={() => select({ kind: 'section', title: section.title })}>
            <Icon className="h-5 w-5" aria-hidden /><span>{sectionLabel(section)}</span>
          </Button>
        })}</div> : panel}
      </Modal>
    </>}
  </div>
}
export default CommandDeck
