export interface SectionGroup {
  primary: string
  label: string
  labelKey: string
  pages: readonly { to: string; label: string; labelKey: string }[]
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
  const hidden = new Set(groups.flatMap(group =>
    group.pages.filter(page => page.to !== group.primary).map(page => page.to),
  ))
  const shown = standalonePaths && new Set([...groups.map(group => group.primary), ...standalonePaths])
  return labelSectionPrimaries(items.filter(item =>
    !hidden.has(item.to) && (!shown || shown.has(item.to)),
  ), groups)
}
