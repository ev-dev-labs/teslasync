/**
 * CommandDeck
 * ───────────
 * The default TeslaSync sidebar, re-invented as master-detail instead of
 * a scrolling list.
 *
 * - Desktop: the section rail and secondary panel dock side by side.
 *   Either rail can shrink to icons. Pressing the active primary item
 *   again closes the secondary panel; following a link keeps it open.
 *   The aside width transitions with both rail preferences.
 * - Mobile: the drawer shows the rail full-width; tapping drills into
 *   the secondary panel with a Back button, and following a link closes
 *   the drawer.
 *
 * Selection and both icon-width preferences persist; the secondary
 * panel starts closed. The primary rail still highlights the section
 * holding the current page for orientation.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from '@/components/motion/runtime'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { cn } from '@/lib/cn'
import { SectionRail, selectionKey } from './SectionRail'
import { AtlasPanel } from './AtlasPanel'
import type { SidebarSectionInput } from '../sectionGroups'
import type { SectionGroup } from '../sectionGroups'
import type { SidebarSuggestion } from './sidebarSuggest'

export type DeckSelection =
  | { kind: 'suggested' }
  | { kind: 'favorites' }
  | { kind: 'section'; title: string }

export interface CommandDeckProps {
  sections: SidebarSectionInput[]
  pinnedItems: SidebarSectionInput['items']
  recentItems?: SidebarSectionInput['items']
  suggestions?: SidebarSuggestion[]
  pathname: string
  navLabel: (item: { label: string; labelKey: string }) => string
  navSectionTitle: (section: { title: string; titleKey?: string }) => string
  onPin: (to: string) => void
  onUnpin: (to: string) => void
  pinSyncUnavailable?: boolean
  onItemSelect?: () => void
  alertCount?: number
  vehicleCount?: number
  staleCount?: number
  vehicleId?: string
  collections?: readonly SectionGroup[]
  /** Rail collapse is host-owned: Layout derives the aside width from it. */
  railCollapsed: boolean
  onToggleRailCollapsed: () => void
  /** Secondary-panel open state, host-owned for the same reason. */
  panelOpen: boolean
  onPanelOpenChange: (open: boolean) => void
  panelCollapsed: boolean
  onTogglePanelCollapsed: () => void
  /** Section holding the current page — highlighted while collapsed. */
  activeSectionTitle?: string
}

const DECK_VIEW_STORAGE_KEY = 'teslasync-deck-view'

function readStoredView(sections: readonly { title: string }[], activeSectionTitle?: string): DeckSelection {
  try {
    const stored = window.localStorage.getItem(DECK_VIEW_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as DeckSelection | null
      if (parsed?.kind === 'suggested' || parsed?.kind === 'favorites') {
        return parsed
      }
      if (parsed?.kind === 'section' && sections.some(section => section.title === parsed.title)) {
        return parsed
      }
    }
  } catch {
    // Storage may be disabled or hold a stale section; default below.
  }
  return activeSectionTitle && sections.some(section => section.title === activeSectionTitle)
    ? { kind: 'section', title: activeSectionTitle }
    : { kind: 'suggested' }
}

export function CommandDeck({
  sections,
  pinnedItems,
  recentItems,
  suggestions,
  pathname,
  navLabel,
  navSectionTitle,
  onPin,
  onUnpin,
  pinSyncUnavailable = false,
  onItemSelect,
  alertCount = 0,
  vehicleCount = 0,
  staleCount = 0,
  vehicleId,
  collections = [],
  railCollapsed,
  onToggleRailCollapsed,
  panelOpen,
  onPanelOpenChange,
  panelCollapsed,
  onTogglePanelCollapsed,
  activeSectionTitle,
}: CommandDeckProps) {
  const safeSections = sections ?? []
  const safePinnedItems = pinnedItems ?? []
  const safeSuggestions = suggestions ?? []
  const safeCollections = collections ?? []
  const { reduce, durationMs } = useMotionPreference()

  const [view, setView] = useState<DeckSelection>(() => readStoredView(sections ?? [], activeSectionTitle))
  const [mobileLevel, setMobileLevel] = useState<'rail' | 'panel'>('rail')
  const railRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const previousPath = useRef(pathname)

  useEffect(() => {
    if (pathname === previousPath.current) return
    previousPath.current = pathname
    if (activeSectionTitle && safeSections.some(section => section.title === activeSectionTitle)) {
      setView({ kind: 'section', title: activeSectionTitle })
    }
  }, [pathname, activeSectionTitle, safeSections])

  useEffect(() => {
    try {
      window.localStorage.setItem(DECK_VIEW_STORAGE_KEY, JSON.stringify(view))
    } catch {
      // Storage may be disabled; the view still works for the session.
    }
  }, [view])

  const railItemRef = useCallback((key: string, el: HTMLButtonElement | null) => {
    if (el) railRefs.current.set(key, el)
    else railRefs.current.delete(key)
  }, [])

  const closePanel = useCallback(() => {
    onPanelOpenChange(false)
    railRefs.current.get(selectionKey(view))?.focus()
  }, [onPanelOpenChange, view])

  // Desktop: the active rail item toggles its docked panel.
  const selectDesktop = (selection: DeckSelection) => {
    if (panelOpen && selectionKey(selection) === selectionKey(view)) {
      closePanel()
      return
    }
    setView(selection)
    onPanelOpenChange(true)
  }

  // Mobile: rail drills into the panel level.
  const selectMobile = (selection: DeckSelection) => {
    setView(selection)
    setMobileLevel('panel')
  }

  // Following a link never collapses the desktop panel. Mobile still
  // resets to the rail level while the host closes
  // the drawer.
  const handleItemSelect = useCallback(() => {
    setMobileLevel('rail')
    onItemSelect?.()
  }, [onItemSelect])

  const favoritesCount = safePinnedItems.length

  // Rail highlight: the open view while expanded, else the section
  // holding the current page so orientation survives collapse.
  const routeSelection: DeckSelection | null = activeSectionTitle && safeSections.some(section => section.title === activeSectionTitle)
    ? { kind: 'section', title: activeSectionTitle }
    : null
  const railSelection: DeckSelection | null = panelOpen ? view : routeSelection

  const railProps = {
    sections: safeSections,
    collections: safeCollections,
    navSectionTitle,
    suggestedCount: safeSuggestions.length,
    favoritesCount,
    alertCount,
    onToggleCollapsed: onToggleRailCollapsed,
    onItemSelect: handleItemSelect,
  }
  const panelProps = {
    sections,
    pinnedItems,
    recentItems,
    suggestions,
    pathname,
    navLabel,
    navSectionTitle,
    onPin,
    onUnpin,
    pinSyncUnavailable,
    onItemSelect: handleItemSelect,
    alertCount,
    vehicleCount,
    staleCount,
    vehicleId,
    collections,
  }

  return (
    <div data-role="command-deck" className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Desktop: rail + docked secondary panel in one row. */}
      <div className="hidden min-h-0 min-w-0 flex-1 flex-row xl:flex">
        <div data-testid="command-deck-rail" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SectionRail
            collapsed={railCollapsed}
            onSelect={selectDesktop}
            selection={railSelection}
            panelOpen={panelOpen}
            itemRef={railItemRef}
            {...railProps}
          />
        </div>
        {panelOpen && (
          <motion.div
            data-testid="command-deck-secondary"
            initial={reduce ? false : {
              opacity: 0,
              x: typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 22 : -22,
            }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: durationMs / 1000, ease: [0.2, 0, 0, 1] }}
            className={cn('flex min-h-0 shrink-0 origin-top-left flex-col overflow-visible transition-width duration-normal ease-standard rtl:origin-top-right motion-reduce:transition-none', panelCollapsed ? 'w-command-deck-collapsed' : 'w-command-deck-expanded')}
          >
            <AtlasPanel
              variant="secondary"
              view={view}
              onClose={closePanel}
              collapsed={panelCollapsed}
              onToggleCollapsed={onTogglePanelCollapsed}
              {...panelProps}
            />
          </motion.div>
        )}
      </div>

      {/* Mobile drill: rail root… */}
      {mobileLevel === 'rail' && (
        <div data-testid="command-deck-mobile-rail" className="flex min-h-0 flex-1 xl:hidden">
          <SectionRail
            collapsed={false}
            showCollapseControl={false}
            onSelect={selectMobile}
            selection={routeSelection}
            {...railProps}
          />
        </div>
      )}

      {/* …and secondary level with Back. Enter-only fade: no exit lag. */}
      {mobileLevel === 'panel' && (
        <motion.div
          data-testid="command-deck-mobile-panel"
          initial={reduce ? false : {
            opacity: 0,
            x: typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? -22 : 22,
          }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: durationMs / 1000, ease: [0.2, 0, 0, 1] }}
          className="flex min-h-0 flex-1 xl:hidden"
        >
          <AtlasPanel
            variant="inline"
            view={view}
            onBack={() => setMobileLevel('rail')}
            onClose={onItemSelect}
            {...panelProps}
          />
        </motion.div>
      )}
    </div>
  )
}

export default CommandDeck
