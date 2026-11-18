import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SectionGroup, SidebarSectionInput } from '../sectionGroups'
import { groupSidebarItems, type FlatSidebarEntry } from '../sidebar/collections'
import { matchesSidebarTokens, searchSidebarSections, tokenizeSidebarQuery } from '../sidebar/sidebarSearch'

export interface NavGroup {
  id: string
  label: string
  pages: FlatSidebarEntry[]
}

export interface NavModel {
  sections: readonly SidebarSectionInput[]
  collections: readonly SectionGroup[]
  pathname: string
  pinnedPaths: ReadonlySet<string>
  onPin: (path: string) => void
  onUnpin: (path: string) => void
  pinSyncUnavailable?: boolean
  unreadCount: number
  vehicleId?: string
  vehicleCount: number
  staleCount: number
}

export const PINNED = 'pinned'

export function useNavGroups(section: SidebarSectionInput | undefined, model: NavModel, editing: boolean) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const tokens = tokenizeSidebarQuery(query)
  const hits = new Set(section ? searchSidebarSections([section], model.collections, query,
    item => t(item.labelKey, item.label), { matchSectionTitle: false }).flatMap(result => result.hits.map(hit => hit.to)) : [])
  const groups: NavGroup[] = []
  const other: FlatSidebarEntry[] = []
  const pinned: FlatSidebarEntry[] = []
  for (const { label, labelKey, entries } of groupSidebarItems(section?.items ?? [], model.collections)) {
    const name = label && labelKey ? t(labelKey, label) : label
    const matchGroup = name && matchesSidebarTokens(`${label} ${name}`.toLowerCase(), tokens)
    const pages = entries.filter(page => !tokens.length || matchGroup || hits.has(page.to))
    for (const page of pages) if (model.pinnedPaths.has(page.to)) pinned.push(page)
    if (!pages.length) continue
    if (name) groups.push({ id: entries[0].to, label: name, pages })
    else other.push(...pages)
  }
  if (other.length) groups.push({ id: 'other', label: groups.length ? t('nav.flyout.other', 'Other pages') : t('nav.flyout.pages', 'Pages'), pages: other })
  if (pinned.length && !editing) groups.unshift({ id: PINNED, label: t('nav.sidenav.pinned', 'Pinned'), pages: pinned })
  return { groups, query, setQuery }
}
