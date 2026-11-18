import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Icons } from '@/lib/icons'
import { resolveSectionIcon } from '../sidebar/sidebarIcons'
import { NavFilter } from './NavFilter'
import { NavPages } from './NavPages'
import { PINNED, useNavGroups, type NavModel } from './navGroups'
import { handleMenuVertical, menuItems } from './navKeyboard'
import './horizontal-nav.css'

export function NavSheet({ id, model, initialSection, activeSectionTitle, onClose, getReturnFocusTarget }: {
  id: string
  model: NavModel
  initialSection?: string
  activeSectionTitle?: string
  onClose: () => void
  getReturnFocusTarget: () => HTMLElement | null
}) {
  const { t } = useTranslation()
  const [sectionId, setSectionId] = useState(initialSection)
  const [groupId, setGroupId] = useState<string>()
  const [editing, setEditing] = useState(false)
  const section = model.sections.find(candidate => candidate.title === sectionId)
  const { groups, query, setQuery } = useNavGroups(section, model, editing)
  const group = groups.find(candidate => candidate.id === groupId) ?? (groupId ? groups[0] : undefined)
  const browse = t('nav.flyout.browse', 'Browse sections')
  const label = section?.titleKey ? t(section.titleKey, section.title) : section?.title ?? browse
  const heading = useRef<HTMLHeadingElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const nextFocus = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    const previous = menuItems(content.current).find(item => item.dataset.navChoice === nextFocus.current)
    ;(previous ?? heading.current)?.focus()
    nextFocus.current = undefined
  }, [sectionId, groupId])

  const back = () => {
    if (groupId) {
      nextFocus.current = group?.id
      setEditing(false)
      setGroupId(undefined)
    } else {
      nextFocus.current = sectionId
      setQuery('')
      setSectionId(undefined)
    }
  }
  return <Modal open onClose={onClose} id={id} ariaLabel={browse} getReturnFocusTarget={getReturnFocusTarget}
    placement="bottom" className="horizontal-nav-sheet" aboveNotifications>
    <div className="horizontal-nav-sheet-title">
      <h2 ref={heading} data-autofocus tabIndex={-1} className="horizontal-nav-heading">{group?.label ?? label}</h2>
      <Button variant="ghost" className="horizontal-nav-icon" aria-label={t('modal.close', 'Close')} onClick={onClose}>
        <Icons.close className="size-5" aria-hidden />
      </Button>
    </div>
    <div ref={content} className="horizontal-nav-sheet-body" onKeyDown={event => { handleMenuVertical(event) }}>
      {group ? <NavPages group={group} model={model} editing={editing} onSelect={onClose} />
        : section ? <>
          <NavFilter label={label} query={query} setQuery={setQuery} />
          {groups.map(candidate => <Button key={candidate.id} data-nav-choice={candidate.id} variant="ghost"
            className="horizontal-nav-row" onClick={() => setGroupId(candidate.id)}>
            <span>{candidate.label}</span><span className="horizontal-nav-count">{candidate.pages.length}</span>
            <Icons.next className="size-4 shrink-0 rtl:rotate-180" aria-hidden />
          </Button>)}
          {groups.length === 0 && <p role="status">{t('nav.sidenav.noMatches', { query: query.trim(), defaultValue: 'No pages match "{{query}}".' })}</p>}
        </> : model.sections.map(candidate => {
          const Icon = resolveSectionIcon(candidate.title)
          return <Button key={candidate.title} data-nav-choice={candidate.title} variant="ghost" className="horizontal-nav-row"
            aria-current={candidate.title === activeSectionTitle ? 'true' : undefined}
            onClick={() => { setQuery(''); setSectionId(candidate.title) }}>
            <Icon className="size-5 shrink-0" aria-hidden />
            <span>{candidate.titleKey ? t(candidate.titleKey, candidate.title) : candidate.title}</span>
            <Icons.next className="size-4 shrink-0 rtl:rotate-180" aria-hidden />
          </Button>
        })}
    </div>
    {(section || group) && <div className="horizontal-nav-sheet-footer">
      <Button variant="ghost" className="horizontal-nav-pin" onClick={back}>
        <Icons.next className="size-4 shrink-0 rotate-180 rtl:rotate-0" aria-hidden />{t('common.back', 'Back')}
      </Button>
      {group && <Button variant="ghost" className="horizontal-nav-pin" aria-pressed={editing} onClick={() => {
        if (!editing && group.id === PINNED) setGroupId(groups.find(candidate => candidate.id !== PINNED)?.id)
        setEditing(value => !value)
      }}>
        <Icons.pin className="size-4 shrink-0" aria-hidden />
        {editing ? t('nav.flyout.done', 'Done') : t('nav.flyout.editPins', 'Edit pins')}
      </Button>}
    </div>}
    {editing && model.pinSyncUnavailable && <p role="status">{t('nav.deck.pinOfflineHint', 'Saved here until navigation pins can sync')}</p>}
  </Modal>
}
