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
  buildCompactNavTree,
  findMostSpecificNavEntry,
  isCompactActivePath,
  CANONICAL_SECTION_TO_COMPACT_GROUP,
  COMPACT_GROUP_TITLES,
  COMPACT_NAV_BLUEPRINT,
  EXPLORE_PATH,
  MAX_COMPACT_GROUPS,
  type CompactNavSectionLike,
} from '../compactNav'

type Item = { to: string; label: string }

/**
 * A miniature stand-in for the canonical catalog: same section titles, a
 * mix of curated + long-tail paths, so the builder can be driven without
 * importing the 150-item literal.
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
      title: 'Diagnostics',
      items: [
        { to: '/system-status', label: 'System Status' },
        { to: '/dashcam', label: 'Dashcam & Sentry' },
      ],
    },
    {
      title: 'Settings',
      items: [{ to: '/settings', label: 'General Settings' }],
    },
  ]
}

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
  it('produces at most nine groups, ordered by the blueprint', () => {
    const { sections } = buildCompactNavTree(catalog(), '/')
    expect(sections.length).toBeLessThanOrEqual(MAX_COMPACT_GROUPS)
    const order = sections.map((s) => s.title)
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
    expect(paths).not.toContain('/weekly-digest')
    expect(paths).not.toContain('/drive-dna')
    expect(paths).not.toContain('/dashcam')
  })

  it('reports the compact group that owns a curated active route', () => {
    expect(buildCompactNavTree(catalog(), '/drives').activeSectionTitle).toBe('Driving')
    expect(buildCompactNavTree(catalog(), '/drives/42').activeSectionTitle).toBe('Driving')
    expect(buildCompactNavTree(catalog(), '/').activeSectionTitle).toBe('Overview')
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
    expect(activeSectionTitle).toBe('System & Developer')
    expect(injectedActivePath).toBe('/dashcam')

    const group = sections.find((s) => s.title === 'System & Developer')
    const injected = group?.items.find((i) => i.to === '/dashcam')
    // Same object → icon, badge, dataTour and pin wiring all survive.
    expect(injected).toBe(original)
  })

  it('injects the most specific long-tail route rather than its curated parent', () => {
    const { sections, activeSectionTitle } = buildCompactNavTree(catalog(), '/analytics/carbon')
    expect(activeSectionTitle).toBe('Reports & Analytics')
    const group = sections.find((s) => s.title === 'Reports & Analytics')
    const paths = group!.items.map((i) => i.to)
    expect(paths).toContain('/analytics/carbon')
    // The curated parent stays put — it is not replaced or duplicated.
    expect(paths.filter((p) => p === '/analytics')).toHaveLength(1)
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
    expect(sections.map((s) => s.title)).toEqual(['Overview'])
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
})
