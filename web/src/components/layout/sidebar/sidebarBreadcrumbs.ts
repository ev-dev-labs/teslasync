import type { BreadcrumbItem } from '../Breadcrumbs'
import type { SectionGroup } from '../sectionGroups'

export interface BreadcrumbSection {
  title: string
  titleKey?: string
  items: readonly { to: string; label: string; labelKey: string }[]
}

export function sidebarBreadcrumbs(
  pathname: string,
  routeItems: BreadcrumbItem[],
  sections: readonly BreadcrumbSection[],
  collections: readonly SectionGroup[],
  translate: (key: string, fallback: string) => string,
): BreadcrumbItem[] {
  const candidates = [pathname, ...routeItems.flatMap(item => item.href ? [item.href] : [])]

  for (const path of candidates) {
    const collection = collections.find(group => group.pages.some(page => page.to === path))
    const primary = collection?.primary ?? path
    const section = sections.find(group => group.items.some(item => item.to === primary))
    if (!section) continue

    const page = collection?.pages.find(item => item.to === path)
      ?? section.items.find(item => item.to === path)
    if (!page) continue

    const sectionLabel = section.titleKey ? translate(section.titleKey, section.title) : section.title
    const pageLabel = translate(page.labelKey, page.label)
    // Flat trail: the sidebar lists every page directly under its
    // section, so the breadcrumb mirrors exactly that — Section >
    // Page. The collection name is deliberately NOT a rung: it links
    // nowhere and matches nothing in navigation, so it read as a
    // phantom level (Vehicles > Places > Geofences). Collections
    // still resolve the section via their primary above.
    const trail: BreadcrumbItem[] = section.title === 'Home' ? [] : [{ label: sectionLabel }]

    const routeIndex = routeItems.findIndex(item => item.href === path)
    const detailItems = path === pathname || routeIndex < 0 ? [] : routeItems.slice(routeIndex + 1)
    trail.push({ label: pageLabel, href: detailItems.length > 0 ? path : undefined })
    return [...trail, ...detailItems]
  }

  return routeItems
}
