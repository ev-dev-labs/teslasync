import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SectionGroup, SidebarSectionInput } from '../sectionGroups'
import { groupSidebarItems, type FlatSidebarEntry } from '../sidebar/collections'
import { matchesSidebarTokens, searchSidebarSections, tokenizeSidebarQuery } from '../sidebar/sidebarSearch'

export interface NavGroup {
  id: string
  label: string
  pages: FlatSidebarEntry[]
  ungrouped?: boolean
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
  const { groups } = deriveNavGroups(section, model, query, t)
  return { groups: editing ? groups.filter(group => group.id !== PINNED) : groups, query, setQuery }
}

export function deriveNavGroups(
  section: SidebarSectionInput | undefined,
  model: Pick<NavModel, 'collections' | 'pinnedPaths'>,
  query: string,
  t: (key: string, fallback: string) => string,
) {
  const tokens = tokenizeSidebarQuery(query)
  const hits = new Set(section && tokens.length ? searchSidebarSections([section], model.collections, query,
    item => t(item.labelKey, item.label), { matchSectionTitle: false }).flatMap(result => result.hits.map(hit => hit.to)) : [])
  const groups: NavGroup[] = []
  const other: FlatSidebarEntry[] = []
  const pinned: FlatSidebarEntry[] = []
  const orderedGroups: NavGroup[] = []
  const collectionIds: string[] = []
  for (const { label, labelKey, entries } of groupSidebarItems(section?.items ?? [], model.collections)) {
    const name = label && labelKey ? t(labelKey, label) : label
    if (name) collectionIds.push(entries[0].to)
    const matchGroup = name && matchesSidebarTokens(`${label} ${name}`.toLowerCase(), tokens)
    const pages = entries.filter(page => !tokens.length || matchGroup || hits.has(page.to))
    for (const page of pages) if (model.pinnedPaths.has(page.to)) pinned.push(page)
    if (!pages.length) continue
    if (name) {
      const group = { id: entries[0].to, label: name, pages }
      groups.push(group)
      orderedGroups.push(group)
    } else {
      other.push(...pages)
      orderedGroups.push({ id: entries[0].to, label: '', pages, ungrouped: true })
    }
  }
  if (other.length) groups.push({ id: 'other', label: groups.length ? t('nav.flyout.other', 'Other pages') : t('nav.flyout.pages', 'Pages'), pages: other, ungrouped: true })
  if (pinned.length) {
    const group = { id: PINNED, label: t('nav.sidenav.pinned', 'Pinned'), pages: pinned }
    groups.unshift(group)
    orderedGroups.unshift(group)
  }
  return { groups, orderedGroups, collectionIds }
}
