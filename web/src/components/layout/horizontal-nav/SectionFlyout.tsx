import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Icons } from '@/lib/icons'
import type { SidebarSectionInput } from '../sectionGroups'
import { resolveSectionIcon } from '../sidebar/sidebarIcons'
import { NavFilter } from './NavFilter'
import { NavPages } from './NavPages'
import { PINNED, useNavGroups, type NavModel } from './navGroups'
import { handleMenuVertical, inlineKeys, menuItems } from './navKeyboard'
import { useFlyoutAnchor } from './useFlyoutAnchor'

const HOVER_INTENT_MS = 140

export function SectionFlyout({ id, section, model, onSelect, onClose, anchor, onDismiss }: {
  id: string
  section: SidebarSectionInput
  model: NavModel
  onSelect: () => void
  onClose: () => void
  anchor: HTMLElement | null
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const { groups, query, setQuery } = useNavGroups(section, model, editing)
  const [selected, setSelected] = useState<string>()
  const group = groups.find(candidate => candidate.id === selected)
    ?? groups.find(candidate => candidate.id !== PINNED && candidate.pages.some(page => page.to === model.pathname))
    ?? groups[0]
  const label = section.titleKey ? t(section.titleKey, section.title) : section.title
  const SectionIcon = resolveSectionIcon(section.title)
  const groupsRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const { panel: panelRef, position } = useFlyoutAnchor(anchor, onDismiss)
  const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancelHover = () => clearTimeout(hover.current)
  const focusGroup = () => groupsRef.current?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus()

  useLayoutEffect(() => {
    const active = groupsRef.current?.querySelector<HTMLElement>('[aria-expanded="true"]')
    ;(active ?? panelRef.current?.querySelector('input'))?.focus()
  }, [])
  useEffect(() => cancelHover, [])
  useLayoutEffect(() => {
    if (pagesRef.current) pagesRef.current.scrollTop = 0
  }, [group?.id])

  return <div ref={panelRef} style={position} data-role="section-flyout" className="horizontal-nav-popup horizontal-nav-flyout">
    <div className="horizontal-nav-section-header">
      <h2 className="horizontal-nav-heading">
        <SectionIcon className="size-5 shrink-0" aria-hidden />{label}
      </h2>
      <Button type="button" variant="ghost" className="horizontal-nav-icon"
        aria-label={t('nav.sidenav.hidePanel', 'Hide panel')} onClick={onClose}>
        <Icons.close className="size-4" aria-hidden />
      </Button>
    </div>
    <div className="horizontal-nav-groups">
      <NavFilter label={label} query={query} setQuery={value => { cancelHover(); setQuery(value) }} onDown={focusGroup} />
      <div id={id} role="menu" tabIndex={-1} aria-label={t('nav.flyout.groups', { section: label, defaultValue: '{{section}} groups' })}
        aria-orientation="vertical" ref={groupsRef} className="horizontal-nav-group-list"
        onKeyDown={event => {
          cancelHover()
          if (handleMenuVertical(event)) return
          if (event.key === inlineKeys(event.currentTarget).forward) {
            event.preventDefault()
            menuItems(pagesRef.current)[0]?.focus()
          }
        }}>
        {groups.map(candidate => <Button key={candidate.id} data-nav-choice role="menuitem" variant="ghost"
          tabIndex={candidate.id === group?.id ? 0 : -1} aria-haspopup="menu" aria-expanded={candidate.id === group?.id}
          aria-controls={candidate.id === group?.id ? `${id}-pages` : undefined}
          className="horizontal-nav-row" onFocus={() => { cancelHover(); setSelected(candidate.id) }}
          onPointerEnter={event => {
            cancelHover()
            if (event.pointerType !== 'mouse') return
            hover.current = setTimeout(() => {
              if (!pagesRef.current?.contains(document.activeElement)) setSelected(candidate.id)
            }, HOVER_INTENT_MS)
          }} onPointerLeave={cancelHover}
          onClick={() => { cancelHover(); setSelected(candidate.id); if (candidate.id === group?.id) menuItems(pagesRef.current)[0]?.focus() }}>
          {candidate.id === group?.id
            ? <Icons.expand className="size-4 shrink-0" aria-hidden />
            : <Icons.next className="size-4 shrink-0 rtl:rotate-180" aria-hidden />}
          {candidate.id === PINNED && <Icons.pin className="size-4 shrink-0" aria-hidden />}
          <span>{candidate.label}</span>
          <span className="horizontal-nav-count">{candidate.pages.length}</span>
        </Button>)}
      </div>
    </div>
    <div className="horizontal-nav-destinations">
      <div className="horizontal-nav-pane-header">
        <h3 className="horizontal-nav-heading">{group?.label ?? t('nav.flyout.pages', 'Pages')}</h3>
        {group && <Button variant="ghost" size="sm" className="horizontal-nav-pin" aria-pressed={editing} onClick={() => setEditing(value => !value)}>
          <Icons.pin className="size-4 shrink-0" aria-hidden />
          {editing ? t('nav.flyout.done', 'Done') : t('nav.flyout.editPins', 'Edit pins')}
        </Button>}
      </div>
      {editing && model.pinSyncUnavailable && <p role="status">{t('nav.deck.pinOfflineHint', 'Saved here until navigation pins can sync')}</p>}
      {group ? <NavPages group={group} model={model} editing={editing} menu id={`${id}-pages`}
        paneRef={pagesRef} onSelect={onSelect} onKeyDown={event => {
          if (handleMenuVertical(event, 2)) return
          const items = menuItems(event.currentTarget)
          const index = items.indexOf(event.target as HTMLElement)
          const { forward, back } = inlineKeys(event.currentTarget)
          if (index < 0 || (event.key !== forward && event.key !== back)) return
          event.preventDefault()
          if (event.key === back && index % 2 === 0) focusGroup()
          else if (event.key === back) items[index - 1]?.focus()
          else if (index % 2 === 0) items[index + 1]?.focus()
        }} /> : <p role="status">{t('nav.sidenav.noMatches', { query: query.trim(), defaultValue: 'No pages match "{{query}}".' })}</p>}
    </div>
  </div>
}
