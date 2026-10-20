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
  compactGroupTier,
  findMostSpecificNavEntry,
  isCompactActivePath,
  isExclusiveActivePath,
  CANONICAL_SECTION_TO_COMPACT_GROUP,
  COMPACT_GROUP_TITLES,
  PRIMARY_GROUP_TITLES,
  prioritizeCanonicalNavSections,
  type CompactNavSectionLike,
} from '../compactNav'

type Item = { to: string; label: string }

/**
 * A miniature stand-in for the canonical catalog: same section titles, a
 * mix of curated + long-tail paths, so the matchers can be driven without
 * importing the 190-item literal.
 */
function catalog(): Array<CompactNavSectionLike<Item>> {
  return [
    {
      title: 'Home',
      items: [
        { to: '/', label: 'Dashboard' },
        { to: '/action-center', label: 'Action Center' },
        { to: '/explore', label: 'Explore Features' },
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
      'Advanced intelligence',
      'Administration',
      'Developer',
      'Settings & account',
    ])
  })

  it('composes the canonical title list as primary-then-advanced', () => {
    expect([...COMPACT_GROUP_TITLES]).toEqual([
      ...PRIMARY_GROUP_TITLES,
      ...ADVANCED_GROUP_TITLES,
    ])
  })

  it('tiers primary titles as primary and everything else as advanced', () => {
    for (const title of COMPACT_GROUP_TITLES) {
      const expected = (PRIMARY_GROUP_TITLES as readonly string[]).includes(title)
        ? 'primary'
        : 'advanced'
      expect(compactGroupTier(title)).toBe(expected)
    }
    expect(compactGroupTier('No Such Group')).toBe('advanced')
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

describe('isExclusiveActivePath', () => {
  const settingsCatalog = ['/settings', '/settings/fleet-setup', '/chatbot', '/dev-tools']
  const physicsCatalog = [
    '/tesla-physics',
    '/tesla-physics/clocks',
    '/tesla-physics/life-tape',
    '/physics-cockpit',
  ]

  it('lights only Fleet Setup on /settings/fleet-setup, not General Settings', () => {
    expect(isExclusiveActivePath('/settings/fleet-setup', '/settings/fleet-setup', settingsCatalog)).toBe(true)
    expect(isExclusiveActivePath('/settings/fleet-setup', '/settings', settingsCatalog)).toBe(false)
  })

  it('still lights General Settings on /settings and unlisted settings children', () => {
    expect(isExclusiveActivePath('/settings', '/settings', settingsCatalog)).toBe(true)
    expect(isExclusiveActivePath('/settings/appearance', '/settings', settingsCatalog)).toBe(true)
  })

  it('lights only the Tesla Physics child, not the hub, on nested routes', () => {
    expect(isExclusiveActivePath('/tesla-physics/clocks', '/tesla-physics/clocks', physicsCatalog)).toBe(true)
    expect(isExclusiveActivePath('/tesla-physics/clocks', '/tesla-physics', physicsCatalog)).toBe(false)
    expect(isExclusiveActivePath('/tesla-physics', '/tesla-physics', physicsCatalog)).toBe(true)
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
      { title: 'Battery', items: [] },
      { title: 'Energy', items: [] },
      { title: 'Cabin', items: [] },
    ]
    expect(titlesOf(prioritizeCanonicalNavSections(source, 'fleet_operator'))).toEqual([
      'Battery',
      'Energy',
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

  it('routes admin/data destinations to Administration and diagnostics to Developer', () => {
    expect(CANONICAL_SECTION_TO_COMPACT_GROUP['Data']).toBe('Administration')
    expect(CANONICAL_SECTION_TO_COMPACT_GROUP['Diagnostics']).toBe('Developer')
    expect(CANONICAL_SECTION_TO_COMPACT_GROUP['Advanced intelligence']).toBe(
      'Advanced intelligence',
    )
    expect(CANONICAL_SECTION_TO_COMPACT_GROUP['Ownership intelligence']).toBe(
      'Advanced intelligence',
    )
  })
})
