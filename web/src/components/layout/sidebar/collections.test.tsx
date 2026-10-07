import { describe, expect, it } from 'vitest'
import { navSections } from '../Layout'
import { ROUTE_REGISTRY } from '@/lib/routeRegistry'
import en from '@/i18n/en.json'
import { SIDEBAR_SECTION_ICONS, SIDEBAR_SHORTCUT_ICONS } from './sidebarIcons'
import { COLLECTION_DEFINITIONS, collectionGroups, collectionPrimaryPath, collectionSidebarSections, flattenSidebarItems, groupSidebarItems } from './collections'

describe('sidebar collections', () => {
  const groups = collectionGroups(navSections)
  const catalogPaths = navSections.flatMap(section => section.items.map(item => item.to))

  it('gives every section, collection, and destination a distinct visible name', () => {
    const english = (key: string, fallback: string) => {
      const value = key.split('.').reduce<unknown>(
        (current, segment) => current && typeof current === 'object'
          ? (current as Record<string, unknown>)[segment]
          : undefined,
        en,
      )
      return typeof value === 'string' ? value : fallback
    }
    for (const label of [(key: string, fallback: string) => fallback, english]) {
      const names = [
        ...navSections.map(section => [label(section.titleKey, section.title), section.title]),
        ...navSections.flatMap(section => section.items.map(item => [label(item.labelKey, item.label), item.to])),
        ...groups.map(group => [label(group.labelKey, group.label), `collection:${group.primary}`]),
      ]
      const seen = new Map<string, string>()
      for (const [name, path] of names) {
        const normalized = name.trim().toLocaleLowerCase()
        expect(seen.get(normalized), `${name}: ${path}`).toBeUndefined()
        seen.set(normalized, path)
      }
    }
  })

  it('uses a distinct glyph for every destination and section', () => {
    const entries = [
      ...navSections.flatMap(section => section.items.map(item => [item.to, item.icon] as const)),
      ...navSections.map(section => [`section:${section.title}`, SIDEBAR_SECTION_ICONS[section.title]] as const),
      ...Object.entries(SIDEBAR_SHORTCUT_ICONS).map(([name, icon]) => [`shortcut:${name}`, icon] as const),
    ]
    expect(entries.filter(([, icon]) => !icon).map(([path]) => path)).toEqual([])
    const seen = new Map<unknown, string>()
    const repeated = entries.flatMap(([path, icon]) => {
      const previous = seen.get(icon)
      seen.set(icon, path)
      return previous ? [`${previous}, ${path}`] : []
    })
    expect(repeated).toEqual([])
  })

  it('uses each registered catalog destination at most once and leaves every route discoverable', () => {
    const paths = groups.flatMap(group => group.pages.map(page => page.to))
    const registered = new Set(ROUTE_REGISTRY.map(route => route.path))
    expect(new Set(paths).size).toBe(paths.length)
    expect(COLLECTION_DEFINITIONS.flatMap(group => group.paths).every(path => catalogPaths.includes(path))).toBe(true)
    expect(paths.every(path => registered.has(path))).toBe(true)
    expect(groups.flatMap(group => group.pages).every(page => page.icon)).toBe(true)
    expect(groups.every(group => group.pages[0].to === group.primary)).toBe(true)
    const rendered = collectionSidebarSections(navSections, groups).flatMap(section => section.items.map(item => item.to))
    for (const path of catalogPaths) {
      expect(rendered, `missing ${path}`).toContain(collectionPrimaryPath(groups, path))
    }
    expect(navSections.flatMap(section => section.items.map(item => item.to))).toEqual(catalogPaths)
  })

  it('never leaks a hidden child into a collection', () => {
    const sections = navSections.map(section => ({
      ...section,
      items: section.items.filter(item => item.to !== '/vehicle-comparison' && item.to !== '/account/2fa'),
    }))
    const visible = collectionGroups(sections).flatMap(group => group.pages.map(page => page.to))
    expect(visible).not.toContain('/vehicle-comparison')
    expect(visible).not.toContain('/account/2fa')
  })

  it('flattens every group inline, preserving catalog order with a resolved glyph per row', () => {
    const sections = collectionSidebarSections(navSections, groups)
    const reports = sections.find(section => section.title === 'Reports')!
    const flat = flattenSidebarItems(reports.items, groups)
    // Fleet Insights (3) + Driving Efficiency (3) + Costs (2) + 3 standalones.
    expect(flat.map(entry => entry.to)).toEqual([
      '/statistics', '/analytics', '/period-compare',
      '/efficiency', '/temperature-impact', '/drive-archetypes',
      '/cost-analysis', '/tco',
      '/share-card', '/analytics/carbon', '/benchmarks/privacy',
    ])
    expect(flat.every(entry => entry.icon)).toBe(true)
    // Pages keep their own catalog labels — the group label never renders.
    expect(flat.find(entry => entry.to === '/tco')?.label).toBe('Cost of Ownership')
  })

  it('adds collection headings without changing the flat order or hiding standalone pages', () => {
    const reports = collectionSidebarSections(navSections, groups).find(section => section.title === 'Reports')!
    const grouped = groupSidebarItems(reports.items, groups)
    expect(grouped.map(group => group.label)).toEqual([
      'Fleet Insights', 'Driving Efficiency', 'Costs', undefined, undefined, undefined,
    ])
    expect(grouped.flatMap(group => group.entries.map(entry => entry.to)))
      .toEqual(flattenSidebarItems(reports.items, groups).map(entry => entry.to))
  })

  it('keeps pinned pages in the flat list: pins bookmark, they never relocate', () => {
    const sections = collectionSidebarSections(navSections, groups)
    const driving = sections.find(section => section.title === 'Driving')!
    const flat = flattenSidebarItems(driving.items, groups)
    const paths = flat.map(entry => entry.to)
    // Group pages stay flat and in order regardless of pin state.
    expect(paths).toContain('/driving-dynamics')
    expect(paths).toContain('/drive-dna')
    expect(paths).toContain('/speed-profile')
    expect(paths).toContain('/regen-efficiency')
    expect(paths.indexOf('/speed-profile')).toBeLessThan(paths.indexOf('/regen-efficiency'))
    const home = sections.find(section => section.title === 'Home')!
    const homePaths = flattenSidebarItems(home.items, groups).map(entry => entry.to)
    expect(homePaths).toContain('/explore')
    expect(homePaths).toContain('/action-center')
  })

  it('keeps Charging Overview first in the flat list', () => {
    const chargingSection = collectionSidebarSections(navSections, groups).find(section => section.title === 'Charging')!
    const flat = flattenSidebarItems(chargingSection.items, groups)
    expect(flat[0].to).toBe('/charging')
  })

  it('lists every page directly when a section holds a single group', () => {
    const sections = collectionSidebarSections(navSections, groups)
    const commands = sections.find(section => section.title === 'Commands')
    expect(commands).toBeDefined()
    const flat = flattenSidebarItems(commands!.items, groups)
    expect(flat.map(entry => entry.to)).toEqual(['/commands', '/command-history', '/command-reliability'])
    expect(flat.map(entry => entry.label)).toEqual(['Send Commands', 'Command History', 'Command Reliability'])
  })

  it('groups the singleton Vehicle Cost destination in Diagnostics without duplicating it', () => {
    const diagnostics = collectionSidebarSections(navSections, groups).find(section => section.title === 'Diagnostics')!
    const grouped = groupSidebarItems(diagnostics.items, groups)
    const vehicleCosts = grouped.find(group => group.label === 'Vehicle Costs')
    expect(vehicleCosts?.labelKey).toBe('nav.diagnosticGroups.vehicleCost')
    expect(vehicleCosts?.entries.map(entry => entry.to)).toEqual(['/admin/vehicle-cost'])
    expect(grouped.flatMap(group => group.entries).filter(entry => entry.to === '/admin/vehicle-cost')).toHaveLength(1)
  })

  it('uses distinct icons for sibling destinations', () => {
    const repeated = groups.flatMap(group => {
      const seen = new Map<unknown, string>()
      return group.pages.flatMap(page => {
        const previous = seen.get(page.icon)
        seen.set(page.icon, page.to)
        return previous ? [`${group.label}: ${previous}, ${page.to}`] : []
      })
    })
    expect(repeated).toEqual([])
  })
})
