/**
 * compactNav — pure builder tests.
 *
 * These exercise the derivation logic in isolation (no React, no router).
 * The blueprint↔catalog cross-checks live in `Layout.test.tsx`, which is the
 * only place that already mounts the heavy shell module that owns
 * `navSections`.
 */

import { describe, it, expect } from 'vitest'
import {
  ADVANCED_GROUP_TITLES,
  buildCompactNavTree,
  compactGroupTier,
  findMostSpecificNavEntry,
  isCompactActivePath,
  CANONICAL_SECTION_TO_COMPACT_GROUP,
  COMPACT_GROUP_TITLES,
  COMPACT_NAV_BLUEPRINT,
  EXPLORE_PATH,
  MAX_COMPACT_GROUPS,
  PRIMARY_GROUP_TITLES,
  prioritizeCompactNavTree,
  prioritizeCanonicalNavSections,
  type CompactNavSectionLike,
} from '../compactNav'
import type { NavCapability } from '@/lib/navCapabilities'

type Item = { to: string; label: string }

const ALL_CAPABILITIES = new Set<NavCapability>([
  'core',
  'account',
  'administration',
  'developer',
])
const CORE_ONLY = new Set<NavCapability>(['core'])

/**
 * A miniature stand-in for the canonical catalog: same section titles, a
 * mix of curated + long-tail paths, so the builder can be driven without
 * importing the 190-item literal.
 */
function catalog(): Array<CompactNavSectionLike<Item>> {
  return [
    {
      title: 'Home',
      items: [
        { to: '/', label: 'Dashboard' },
        { to: '/action-center', label: 'Action Center' },
        { to: EXPLORE_PATH, label: 'Explore Features' },
        { to: '/live', label: 'Live Map' },
        { to: '/timeline', label: 'Timeline' },
        { to: '/weekly-digest', label: 'Weekly Digest' },
      ],
    },
    {
      title: 'Vehicles',
      items: [
        { to: '/vehicles', label: 'My Vehicles' },
        { to: '/digital-twin', label: 'Vehicle Live View' },
        { to: '/locations', label: 'Saved Locations' },
        { to: '/time-machine', label: 'Time Machine' },
      ],
    },
    {
      title: 'Driving',
      items: [
        { to: '/drives', label: 'Drives' },
        { to: '/trips', label: 'Trips' },
        { to: '/drive-dna', label: 'Drive DNA' },
        { to: '/segments', label: 'Ghost Racing' },
      ],
    },
    {
      title: 'Reports',
      items: [
        { to: '/analytics', label: 'Analytics' },
        { to: '/analytics/carbon', label: 'Carbon Intelligence' },
        { to: '/statistics', label: 'Statistics' },
      ],
    },
    {
      title: 'Security',
      items: [{ to: '/security-access', label: 'Security & Access' }],
    },
    {
      title: 'Data',
      items: [
        { to: '/backup', label: 'Backup & Restore' },
        { to: '/data-repair', label: 'Data Repair' },
      ],
    },
    {
      title: 'Diagnostics',
      items: [
        { to: '/system-status', label: 'System Status' },
        { to: '/db-health', label: 'Database Health' },
        { to: '/dashcam', label: 'Dashcam & Sentry' },
      ],
    },
    {
      title: 'Settings',
      items: [{ to: '/settings', label: 'General Settings' }],
    },
  ]
}

function titlesOf<T extends { title: string }>(sections: readonly T[]): string[] {
  return sections.map((s) => s.title)
}

describe('group taxonomy', () => {
  it('declares seven everyday primary groups in the required product order', () => {
    expect([...PRIMARY_GROUP_TITLES]).toEqual([
      'Overview',
      'Vehicles',
      'Drives',
      'Charging',
      'Energy',
      'Insights',
      'Operations',
    ])
  })

  it('parks admin/developer/experimental destinations in advanced groups', () => {
    expect([...ADVANCED_GROUP_TITLES]).toEqual([
      'Advanced Intelligence',
      'Administration',
      'Developer',
      'Settings & Account',
    ])
  })

  it('composes the canonical title list as primary-then-advanced', () => {
    expect([...COMPACT_GROUP_TITLES]).toEqual([
      ...PRIMARY_GROUP_TITLES,
      ...ADVANCED_GROUP_TITLES,
    ])
    expect(COMPACT_GROUP_TITLES.length).toBeLessThanOrEqual(MAX_COMPACT_GROUPS)
  })

  it('tags every blueprint group with the tier its title belongs to', () => {
    for (const group of COMPACT_NAV_BLUEPRINT) {
      const expected = (PRIMARY_GROUP_TITLES as readonly string[]).includes(group.title)
        ? 'primary'
        : 'advanced'
      expect(group.tier, group.title).toBe(expected)
      expect(compactGroupTier(group.title)).toBe(expected)
    }
  })

  it('gates only the administration and developer groups on a capability', () => {
    const gated = COMPACT_NAV_BLUEPRINT.filter((g) => g.capability !== 'core').map(
      (g) => g.title,
    )
    expect(gated).toEqual(['Administration', 'Developer'])
  })
})

describe('isCompactActivePath', () => {
  it('matches the root only on an exact "/"', () => {
    expect(isCompactActivePath('/', '/')).toBe(true)
    expect(isCompactActivePath('/drives', '/')).toBe(false)
  })

  it('matches exact paths and descendants but not sibling prefixes', () => {
    expect(isCompactActivePath('/drives', '/drives')).toBe(true)
    expect(isCompactActivePath('/drives/42', '/drives')).toBe(true)
    expect(isCompactActivePath('/drives-archive', '/drives')).toBe(false)
  })
})

describe('findMostSpecificNavEntry', () => {
  it('prefers the longest matching destination over the first one', () => {
    const entry = findMostSpecificNavEntry(catalog(), '/analytics/carbon')
    expect(entry?.item.to).toBe('/analytics/carbon')
    expect(entry?.sectionTitle).toBe('Reports')
  })

  it('falls back to the parent route for an unlisted child page', () => {
    const entry = findMostSpecificNavEntry(catalog(), '/drives/42')
    expect(entry?.item.to).toBe('/drives')
  })

  it('returns null for a path with no catalog entry at all', () => {
    expect(findMostSpecificNavEntry(catalog(), '/totally-unknown')).toBeNull()
  })
})

describe('buildCompactNavTree', () => {
  it('produces at most MAX_COMPACT_GROUPS groups, ordered by the blueprint', () => {
    const { sections } = buildCompactNavTree(catalog(), '/', {
      capabilities: ALL_CAPABILITIES,
    })
    expect(sections.length).toBeLessThanOrEqual(MAX_COMPACT_GROUPS)
    const order = titlesOf(sections)
    const expectedOrder = COMPACT_GROUP_TITLES.filter((t) => order.includes(t))
    expect(order).toEqual([...expectedOrder])
  })

  it('never emits a duplicate path', () => {
    const paths = buildCompactNavTree(catalog(), '/analytics/carbon').sections.flatMap((s) =>
      s.items.map((i) => i.to),
    )
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('keeps the Feature Hub in Overview so the full catalog stays one click away', () => {
    const { sections } = buildCompactNavTree(catalog(), '/')
    const overview = sections.find((s) => s.title === 'Overview')
    expect(overview?.items.map((i) => i.to)).toContain(EXPLORE_PATH)
  })

  it('drops long-tail routes from the curated tree', () => {
    const paths = buildCompactNavTree(catalog(), '/').sections.flatMap((s) =>
      s.items.map((i) => i.to),
    )
    expect(paths).not.toContain('/dashcam')
    expect(paths).not.toContain('/analytics/carbon')
    expect(paths).not.toContain('/segments')
  })

  it('reports the compact group that owns a curated active route', () => {
    expect(buildCompactNavTree(catalog(), '/drives').activeSectionTitle).toBe('Drives')
    expect(buildCompactNavTree(catalog(), '/drives/42').activeSectionTitle).toBe('Drives')
    expect(buildCompactNavTree(catalog(), '/').activeSectionTitle).toBe('Overview')
    expect(buildCompactNavTree(catalog(), '/vehicles').activeSectionTitle).toBe('Vehicles')
    expect(buildCompactNavTree(catalog(), '/statistics').activeSectionTitle).toBe('Insights')
    expect(buildCompactNavTree(catalog(), '/system-status').activeSectionTitle).toBe(
      'Operations',
    )
  })

  it('injects an omitted active route into its mapped group, preserving identity', () => {
    const source = catalog()
    const original = source
      .find((s) => s.title === 'Diagnostics')!
      .items.find((i) => i.to === '/dashcam')!

    const { sections, activeSectionTitle, injectedActivePath } = buildCompactNavTree(
      source,
      '/dashcam',
    )
    expect(activeSectionTitle).toBe('Developer')
    expect(injectedActivePath).toBe('/dashcam')

    const group = sections.find((s) => s.title === 'Developer')
    const injected = group?.items.find((i) => i.to === '/dashcam')
    // Same object → icon, badge, dataTour and pin wiring all survive.
    expect(injected).toBe(original)
  })

  it('injects the most specific long-tail route rather than its curated parent', () => {
    const { sections, activeSectionTitle } = buildCompactNavTree(catalog(), '/analytics/carbon')
    expect(activeSectionTitle).toBe('Insights')
    const group = sections.find((s) => s.title === 'Insights')
    const paths = group!.items.map((i) => i.to)
    expect(paths).toContain('/analytics/carbon')
    // The curated parent stays put — it is not replaced or duplicated.
    expect(paths.filter((p) => p === '/analytics')).toHaveLength(1)
  })

  it('keeps location context even when the owning group is restricted', () => {
    const { sections, activeSectionTitle } = buildCompactNavTree(catalog(), '/dashcam', {
      capabilities: CORE_ONLY,
    })
    const developer = sections.find((s) => s.title === 'Developer')
    expect(activeSectionTitle).toBe('Developer')
    expect(developer?.restricted).toBe(true)
    expect(developer?.items.map((i) => i.to)).toContain('/dashcam')
  })

  it('never leaves a route without sidebar context when it is in the catalog', () => {
    for (const section of catalog()) {
      for (const item of section.items) {
        const tree = buildCompactNavTree(catalog(), item.to)
        expect(tree.activeSectionTitle, `no active group for ${item.to}`).toBeTruthy()
        const paths = tree.sections.flatMap((s) => s.items.map((i) => i.to))
        expect(paths, `${item.to} missing from compact tree`).toContain(item.to)
      }
    }
  })

  it('leaves activeSectionTitle undefined for a path outside the catalog', () => {
    const tree = buildCompactNavTree(catalog(), '/not-a-nav-route')
    expect(tree.activeSectionTitle).toBeUndefined()
    expect(tree.injectedActivePath).toBeUndefined()
  })

  it('honours upstream visibility filtering — hidden items never reappear', () => {
    // Simulate Layout having filtered `/vehicles` out (minVehicles / auth).
    const filtered = catalog().map((section) => ({
      ...section,
      items: section.items.filter((item) => item.to !== '/vehicles'),
    }))
    const paths = buildCompactNavTree(filtered, '/').sections.flatMap((s) =>
      s.items.map((i) => i.to),
    )
    expect(paths).not.toContain('/vehicles')
  })

  it('omits groups that end up empty', () => {
    const onlyHome: Array<CompactNavSectionLike<Item>> = [
      { title: 'Home', items: [{ to: '/', label: 'Dashboard' }] },
    ]
    const { sections } = buildCompactNavTree(onlyHome, '/')
    expect(titlesOf(sections)).toEqual(['Overview'])
  })

  it('is null-safe for empty or malformed input', () => {
    expect(buildCompactNavTree([], '/').sections).toEqual([])
    expect(
      buildCompactNavTree(undefined as unknown as Array<CompactNavSectionLike<Item>>, '/').sections,
    ).toEqual([])
  })

  it('does not mutate the caller-supplied sections', () => {
    const source = catalog()
    const before = source.map((s) => s.items.length)
    buildCompactNavTree(source, '/dashcam')
    expect(source.map((s) => s.items.length)).toEqual(before)
  })
})

describe('capability-aware grouping', () => {
  it('promotes privileged groups when the capability is granted', () => {
    const { sections } = buildCompactNavTree(catalog(), '/', {
      capabilities: ALL_CAPABILITIES,
    })
    expect(sections.find((s) => s.title === 'Administration')?.restricted).toBe(false)
    expect(sections.find((s) => s.title === 'Developer')?.restricted).toBe(false)
  })

  it('demotes but never deletes privileged groups when the capability is missing', () => {
    const granted = buildCompactNavTree(catalog(), '/', { capabilities: ALL_CAPABILITIES })
    const restricted = buildCompactNavTree(catalog(), '/', { capabilities: CORE_ONLY })

    // Same groups, same destinations — only the `restricted` flag differs.
    expect(titlesOf(restricted.sections).sort()).toEqual(titlesOf(granted.sections).sort())
    expect(restricted.sections.find((s) => s.title === 'Administration')?.restricted).toBe(
      true,
    )
    expect(restricted.sections.find((s) => s.title === 'Developer')?.restricted).toBe(true)
    const paths = restricted.sections.flatMap((s) => s.items.map((i) => i.to))
    expect(paths).toContain('/backup')
    expect(paths).toContain('/db-health')
  })

  it('defaults to core-only when capabilities have not resolved yet', () => {
    const { sections } = buildCompactNavTree(catalog(), '/')
    expect(sections.find((s) => s.title === 'Administration')?.restricted).toBe(true)
    expect(sections.find((s) => s.title === 'Overview')?.restricted).toBe(false)
  })

  it('sorts restricted advanced groups below granted ones', () => {
    const tree = prioritizeCompactNavTree(
      buildCompactNavTree(catalog(), '/', { capabilities: CORE_ONLY }),
      'owner',
    )
    const order = titlesOf(tree.sections)
    expect(order.indexOf('Settings & Account')).toBeLessThan(order.indexOf('Administration'))
    expect(order.indexOf('Advanced Intelligence')).toBeLessThan(order.indexOf('Developer'))
  })
})

describe('prioritizeCompactNavTree', () => {
  it('keeps the owner product order unchanged', () => {
    const tree = buildCompactNavTree(catalog(), '/', { capabilities: ALL_CAPABILITIES })
    expect(titlesOf(prioritizeCompactNavTree(tree, 'owner').sections)).toEqual(
      titlesOf(tree.sections),
    )
  })

  it('moves analytical work ahead of operational groups for analysts', () => {
    const tree = buildCompactNavTree(catalog(), '/analytics', {
      capabilities: ALL_CAPABILITIES,
    })
    const prioritized = prioritizeCompactNavTree(tree, 'analyst')
    const titles = titlesOf(prioritized.sections)

    expect(titles.indexOf('Insights')).toBeLessThan(titles.indexOf('Drives'))
    expect(titles.indexOf('Insights')).toBeLessThan(titles.indexOf('Vehicles'))
    expect(prioritized.activeSectionTitle).toBe('Insights')
  })

  it('moves operational work near the top for administrators without hiding groups', () => {
    const tree = buildCompactNavTree(catalog(), '/system-status', {
      capabilities: ALL_CAPABILITIES,
    })
    const prioritized = prioritizeCompactNavTree(tree, 'administrator')

    expect(prioritized.sections[0]?.title).toBe('Overview')
    expect(prioritized.sections[1]?.title).toBe('Operations')
    expect(titlesOf(prioritized.sections).sort()).toEqual(titlesOf(tree.sections).sort())
    expect(prioritized.injectedActivePath).toBeUndefined()
  })

  it('never lets an advanced group outrank a primary group, for any persona', () => {
    for (const persona of ['owner', 'fleet_operator', 'analyst', 'administrator'] as const) {
      const tree = prioritizeCompactNavTree(
        buildCompactNavTree(catalog(), '/', { capabilities: ALL_CAPABILITIES }),
        persona,
      )
      const tiers = tree.sections.map((s) => s.tier)
      const firstAdvanced = tiers.indexOf('advanced')
      if (firstAdvanced === -1) continue
      expect(
        tiers.slice(firstAdvanced).every((tier) => tier === 'advanced'),
        `advanced/primary interleaved for ${persona}`,
      ).toBe(true)
    }
  })

  it('does not mutate the source tree while prioritizing fleet operations', () => {
    const tree = buildCompactNavTree(catalog(), '/')
    const before = titlesOf(tree.sections)
    const prioritized = prioritizeCompactNavTree(tree, 'fleet_operator')

    expect(titlesOf(tree.sections)).toEqual(before)
    expect(prioritized.sections).not.toBe(tree.sections)
  })
})

describe('prioritizeCanonicalNavSections', () => {
  it('prioritizes complete sidebar sections without dropping long-tail groups', () => {
    const source = catalog()
    const prioritized = prioritizeCanonicalNavSections(source, 'administrator')

    expect(prioritized[0]?.title).toBe('Home')
    expect(titlesOf(prioritized).sort()).toEqual(titlesOf(source).sort())
  })

  it('keeps advanced canonical sections behind every primary one', () => {
    const prioritized = prioritizeCanonicalNavSections(catalog(), 'owner')
    const titles = titlesOf(prioritized)
    expect(titles.indexOf('Reports')).toBeLessThan(titles.indexOf('Data'))
    expect(titles.indexOf('Diagnostics')).toBeLessThan(titles.indexOf('Settings'))
  })

  it('preserves source order within one persona priority group', () => {
    const source = [
      { title: 'Vehicles', items: [] },
      { title: 'Service', items: [] },
      { title: 'Cabin', items: [] },
    ]
    expect(titlesOf(prioritizeCanonicalNavSections(source, 'fleet_operator'))).toEqual([
      'Vehicles',
      'Service',
      'Cabin',
    ])
  })
})

describe('compact group mapping table', () => {
  it('maps only onto declared compact group titles', () => {
    for (const target of Object.values(CANONICAL_SECTION_TO_COMPACT_GROUP)) {
      expect(COMPACT_GROUP_TITLES).toContain(target)
    }
  })

  it('covers every section title used by the sample catalog', () => {
    for (const section of catalog()) {
      expect(CANONICAL_SECTION_TO_COMPACT_GROUP[section.title]).toBeTruthy()
    }
  })

  it('declares a non-empty curated path list for every group', () => {
    expect(COMPACT_NAV_BLUEPRINT.every((g) => g.paths.length > 0)).toBe(true)
  })

  it('routes admin/data destinations to Administration and diagnostics to Developer', () => {
    expect(CANONICAL_SECTION_TO_COMPACT_GROUP['Data']).toBe('Administration')
    expect(CANONICAL_SECTION_TO_COMPACT_GROUP['Diagnostics']).toBe('Developer')
    expect(CANONICAL_SECTION_TO_COMPACT_GROUP['Advanced Intelligence']).toBe(
      'Advanced Intelligence',
    )
    expect(CANONICAL_SECTION_TO_COMPACT_GROUP['Ownership Intelligence']).toBe(
      'Advanced Intelligence',
    )
  })
})
