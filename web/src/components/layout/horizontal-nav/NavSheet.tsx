import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Icons } from '@/lib/icons'
import { resolveSectionIcon } from '../sidebar/sidebarIcons'
import { NavFilter } from './NavFilter'
import { NavSheetPages } from './NavSheetPages'
import { useNavGroups, type NavModel } from './navGroups'
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
  const [editing, setEditing] = useState(false)
  const section = model.sections.find(candidate => candidate.title === sectionId)
  const { groups, query, setQuery } = useNavGroups(section, model, false)
  const browse = t('nav.flyout.browse', 'Browse sections')
  const label = section?.titleKey ? t(section.titleKey, section.title) : section?.title ?? browse
  const heading = useRef<HTMLHeadingElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const nextFocus = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    const previous = menuItems(content.current).find(item => item.dataset.navChoice === nextFocus.current)
    ;(previous ?? heading.current)?.focus()
    nextFocus.current = undefined
  }, [sectionId])

  const back = () => {
    nextFocus.current = sectionId
    setEditing(false)
    setQuery('')
    setSectionId(undefined)
  }
  return <Modal open onClose={onClose} id={id} ariaLabel={browse} getReturnFocusTarget={getReturnFocusTarget}
    placement="bottom" className="horizontal-nav-sheet" aboveNotifications>
    <div className="horizontal-nav-sheet-title">
      <h2 ref={heading} data-autofocus tabIndex={-1} className="horizontal-nav-heading">{label}</h2>
      <Button variant="ghost" className="horizontal-nav-icon" aria-label={t('modal.close', 'Close')} onClick={onClose}>
        <Icons.close className="size-5" aria-hidden />
      </Button>
    </div>
    {section && <NavFilter label={label} query={query} setQuery={setQuery}
      onDown={() => menuItems(content.current)[0]?.focus()} />}
    <div ref={content} className="horizontal-nav-sheet-body" onKeyDown={event => { handleMenuVertical(event) }}>
      {section ? <NavSheetPages key={section.title} id={id} groups={groups} model={model}
        editing={editing} query={query} onSelect={onClose} /> : model.sections.map(candidate => {
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
    {section && <div className="horizontal-nav-sheet-footer">
      {!initialSection && <Button variant="ghost" className="horizontal-nav-pin" onClick={back}>
        <Icons.next className="size-4 shrink-0 rotate-180 rtl:rotate-0" aria-hidden />{t('common.back', 'Back')}
      </Button>}
      <Button variant="ghost" className="horizontal-nav-pin" aria-pressed={editing} onClick={() => setEditing(value => !value)}>
        <Icons.pin className="size-4 shrink-0" aria-hidden />
        {editing ? t('nav.flyout.done', 'Done') : t('nav.flyout.editPins', 'Edit pins')}
      </Button>
    </div>}
    {editing && model.pinSyncUnavailable && <p role="status">{t('nav.deck.pinOfflineHint', 'Saved here until navigation pins can sync')}</p>}
  </Modal>
}
