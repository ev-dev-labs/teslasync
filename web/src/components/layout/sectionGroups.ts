import type { Icons } from '@/lib/icons'

export interface SectionGroup {
  primary: string
  label: string
  labelKey: string
  includeSingleton?: boolean
  pages: readonly { to: string; label: string; labelKey: string; icon?: typeof Icons.home; color?: string }[]
}

/**
 * Canonical sidebar section input: title plus catalog items. Re-derived
 * from Layout's exported navSections so consumers stay in lockstep with
 * the canonical nav tree without a circular import.
 */
export type SidebarSectionInput = {
  title: string
  /** Catalog key for the section title (`nav.groups.*`) — canonical sections only. */
  titleKey?: string
  items: Array<{
    to: string
    icon: typeof Icons.home
    label: string
    /** Stable catalog key (`nav.items.*`) — every canonical nav item has one. */
    labelKey: string
    color?: string
    dataTour?: string
    minVehicles?: number
  }>
}

export function findSectionGroup(groups: readonly SectionGroup[], pathname: string) {
  return groups.find(group => group.pages.some(page => page.to === pathname))
}

export function sectionPrimaryPath(groups: readonly SectionGroup[], pathname: string) {
  return findSectionGroup(groups, pathname)?.primary ?? pathname
}

export function labelSectionPrimaries<T extends { to: string; label: string; labelKey: string }>(
  items: readonly T[],
  groups: readonly SectionGroup[],
): T[] {
  return items.map(item => {
    const group = groups.find(candidate => candidate.primary === item.to)
    return group ? { ...item, label: group.label, labelKey: group.labelKey } : item
  })
}

export function sectionSidebarItems<T extends { to: string; label: string; labelKey: string }>(
  items: readonly T[],
  groups: readonly SectionGroup[],
  standalonePaths?: readonly string[],
): T[] {
  return labelSectionPrimaries(items.filter(item =>
    standalonePaths
      ? standalonePaths.includes(item.to) || groups.some(group => group.primary === item.to)
      : sectionPrimaryPath(groups, item.to) === item.to,
  ), groups)
}
