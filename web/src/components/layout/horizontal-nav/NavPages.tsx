import { useTranslation } from 'react-i18next'
import type { KeyboardEvent, Ref } from 'react'
import { Button } from '@/components/ui/Button'
import { Icons } from '@/lib/icons'
import { PrefetchLink } from '../PrefetchLink'
import { isExclusiveActivePath } from '../sidebar/compactNav'
import { NavPageBadge } from './NavPageBadge'
import type { NavGroup, NavModel } from './navGroups'

export function NavPages({ group, model, editing, menu, id, paneRef, onKeyDown, onSelect }: {
  group: NavGroup
  model: NavModel
  editing: boolean
  menu?: boolean
  id?: string
  paneRef?: Ref<HTMLDivElement>
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const paths = model.sections.flatMap(section => section.items.map(item => item.to))
    .concat(model.collections.flatMap(collection => collection.pages.map(page => page.to)))
  return <div ref={paneRef} id={id} role={menu ? 'menu' : undefined} tabIndex={menu ? -1 : undefined} aria-label={menu ? group.label : undefined}
    className="horizontal-nav-pages" onKeyDown={onKeyDown}>
    {group.pages.map((page, index) => {
      const label = t(page.labelKey, page.label)
      const pinned = model.pinnedPaths.has(page.to)
      const Icon = page.icon
      const text = <><Icon className="size-4 shrink-0" aria-hidden /><span>{label}</span></>
      const tabIndex = menu ? (index === 0 ? 0 : -1) : undefined
      return editing
        ? <Button key={page.to} data-nav-choice variant="ghost" role={menu ? 'menuitemcheckbox' : undefined}
            className="horizontal-nav-row" tabIndex={tabIndex}
            aria-checked={menu ? pinned : undefined} aria-pressed={!menu ? pinned : undefined}
            onClick={() => pinned ? model.onUnpin(page.to) : model.onPin(page.to)}>
            {text}<Icons.pin className={pinned ? 'size-4 shrink-0 fill-current' : 'size-4 shrink-0'} aria-hidden />
          </Button>
        : <PrefetchLink key={page.to} data-nav-choice role={menu ? 'menuitem' : undefined}
            className="horizontal-nav-row" to={page.to} tabIndex={tabIndex} data-tour={page.dataTour}
            aria-current={isExclusiveActivePath(model.pathname, page.to, paths) ? 'page' : undefined}
            onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) onSelect() }}
            onKeyDown={event => {
              if (!menu || event.key !== ' ') return
              event.preventDefault()
              event.currentTarget.click()
            }}>
            {text}{page.badge && <NavPageBadge badge={page.badge} model={model} />}
          </PrefetchLink>
    })}
  </div>
}
