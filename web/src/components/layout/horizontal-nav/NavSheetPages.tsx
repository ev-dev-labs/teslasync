import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { PanelTitle } from '@/components/ui/Typography'
import { Icons } from '@/lib/icons'
import { ROUTE_REGISTRY } from '@/lib/routeRegistry'
import { NavPages } from './NavPages'
import { PINNED, type NavGroup, type NavModel } from './navGroups'

const QUICK_ROUTE_IDS = ['Drives', 'DriveCalendar', 'Explorer']
const QUICK_PATHS = QUICK_ROUTE_IDS.flatMap(id => {
  const route = ROUTE_REGISTRY.find(candidate => candidate.name === id)
  return route ? [route.path] : []
})

export function NavSheetPages({ id, groups, model, editing, query, onSelect }: {
  id: string
  groups: NavGroup[]
  model: NavModel
  editing: boolean
  query: string
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const searching = !!query.trim()
  const [expanded, setExpanded] = useState<ReadonlyMap<string, boolean>>(new Map())
  const collections = groups.filter(group => group.id !== PINNED)
  const pages = new Map(collections.flatMap(group => group.pages.map(page => [page.to, page] as const)))
  const shortcuts = [...new Set([...QUICK_PATHS, ...model.pinnedPaths])]
    .flatMap(path => {
      const page = pages.get(path)
      return page ? [page] : []
    })
  const quickLabel = t('nav.quickAccess', 'Quick access')

  return <>
    {!searching && !editing && shortcuts.length > 0 && <section className="horizontal-nav-sheet-quick" aria-label={quickLabel}>
      <PanelTitle as="h3">{quickLabel}</PanelTitle>
      <NavPages group={{ id: 'quick', label: quickLabel, pages: shortcuts }} model={model}
        editing={editing} onSelect={onSelect} />
    </section>}
    {collections.map((group, index) => {
      const open = searching || editing || (expanded.get(group.id) ?? group.expandInSheet ?? false)
      const panelId = `${id}-group-${index}`
      return <section key={group.id} className="horizontal-nav-sheet-group" aria-label={group.label}>
        {searching || editing ? <PanelTitle as="h3">{group.label}</PanelTitle>
          : <Button data-nav-choice={group.id} variant="ghost" className="horizontal-nav-row"
              aria-expanded={open} aria-controls={panelId}
              onClick={() => setExpanded(current => new Map(current).set(group.id, !open))}>
              <span>{group.label}</span><span className="horizontal-nav-count">{group.pages.length}</span>
              <Icons.next className={open ? 'size-4 shrink-0 -rotate-90' : 'size-4 shrink-0 rotate-90'} aria-hidden />
            </Button>}
        <div id={panelId} hidden={!open}>
          {open && <NavPages group={group} model={model} editing={editing} onSelect={onSelect} />}
        </div>
      </section>
    })}
    {collections.length === 0 && <p role="status">{t('nav.sidenav.noMatches', {
      query: query.trim(), defaultValue: 'No pages match "{{query}}".',
    })}</p>}
  </>
}
