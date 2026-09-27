/**
 * sidebarSearch — pure query-engine tests.
 *
 * Sidebar matching must surface every destination,
 * including pages nested inside collections and aliases users type
 * that never appear in a label ("soh", "tpms"). These tests pin the
 * matching rules without rendering any DOM.
 */

import { describe, it, expect } from 'vitest'
import { Icons } from '@/lib/icons'
import type { SectionGroup } from '../../sectionGroups'
import {
  matchesSidebarTokens,
  searchSidebarSections,
  tokenizeSidebarQuery,
} from '../sidebarSearch'

const identity = (entry: { label: string }) => entry.label

const batteryItem = {
  to: '/battery',
  icon: Icons.battery,
  label: 'Battery Health',
  labelKey: 'nav.items.battery',
}
const cellsItem = {
  to: '/battery-cells',
  icon: Icons.battery,
  label: 'Battery Cells',
  labelKey: 'nav.items.battery-cells',
}
const drivesItem = {
  to: '/drives',
  icon: Icons.drive,
  label: 'Drives',
  labelKey: 'nav.items.drives',
}

const collections: SectionGroup[] = [
  {
    primary: '/battery',
    label: 'Battery Insights',
    labelKey: 'nav.collections.battery',
    pages: [
      { to: '/battery', label: 'Battery Health', labelKey: 'nav.items.battery' },
      { to: '/battery-cells', label: 'Battery Cells', labelKey: 'nav.items.battery-cells' },
      { to: '/battery-degradation', label: 'Battery Degradation', labelKey: 'nav.items.battery-degradation' },
    ],
  },
]

const sections = [
  { title: 'Energy', titleKey: 'nav.groups.energy', items: [batteryItem, cellsItem] },
  { title: 'Driving', titleKey: 'nav.groups.driving', items: [drivesItem] },
]

describe('tokenizeSidebarQuery', () => {
  it('lowercases, trims, and splits on whitespace', () => {
    expect(tokenizeSidebarQuery('  Battery   SOH ')).toEqual(['battery', 'soh'])
  })

  it('returns no tokens for a blank query', () => {
    expect(tokenizeSidebarQuery('   ')).toEqual([])
  })
})

describe('matchesSidebarTokens', () => {
  it('requires every token to match (AND semantics)', () => {
    expect(matchesSidebarTokens('battery health soh', ['battery', 'soh'])).toBe(true)
    expect(matchesSidebarTokens('battery health soh', ['battery', 'tires'])).toBe(false)
  })

  it('matches on substring, not whole words', () => {
    expect(matchesSidebarTokens('battery health', ['batt'])).toBe(true)
  })
})

describe('searchSidebarSections', () => {
  it('returns no sections for a blank query (caller renders the tree)', () => {
    expect(searchSidebarSections(sections, collections, '   ', identity)).toEqual([])
  })

  it('can exclude the section-title shortcut when filtering within a section', () => {
    expect(searchSidebarSections(sections, collections, 'Driving', identity, { matchSectionTitle: false })).toEqual([])
    expect(searchSidebarSections(sections, collections, 'Driving', identity)[0].hits.map(hit => hit.to)).toEqual(['/drives'])
  })

  it('matches labels case-insensitively', () => {
    const results = searchSidebarSections(sections, collections, 'DRIVES', identity)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Driving')
    expect(results[0].hits.map(hit => hit.to)).toEqual(['/drives'])
  })

  it('matches keyword aliases users type but labels never show', () => {
    // 'soh' appears only in navSearchKeywords['/battery'].
    const results = searchSidebarSections(sections, collections, 'soh', identity)
    expect(results.flatMap(section => section.hits.map(hit => hit.to))).toContain('/battery')
  })

  it('matches route paths', () => {
    const results = searchSidebarSections(sections, collections, 'battery-cells', identity)
    expect(results.flatMap(section => section.hits.map(hit => hit.to))).toContain('/battery-cells')
  })

  it('requires all tokens to match the same destination', () => {
    const results = searchSidebarSections(sections, collections, 'battery degradation', identity)
    const paths = results.flatMap(section => section.hits.map(hit => hit.to))
    expect(paths).toContain('/battery-degradation')
    expect(paths).not.toContain('/battery')
  })

  it('surfaces nested collection pages as flat hits with their collection as context', () => {
    const results = searchSidebarSections(sections, collections, 'degradation', identity)
    const energy = results.find(section => section.title === 'Energy')
    expect(energy).toBeTruthy()
    const hit = energy!.hits.find(candidate => candidate.to === '/battery-degradation')
    expect(hit).toBeTruthy()
    expect(hit!.label).toBe('Battery Degradation')
    expect(hit!.matchContext).toBe('Battery Insights')
  })

  it('never renders the same path twice when item and collection both match', () => {
    const results = searchSidebarSections(sections, collections, 'battery', identity)
    const paths = results.flatMap(section => section.hits.map(hit => hit.to))
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('returns the whole flattened section when the section title matches', () => {
    const results = searchSidebarSections(sections, collections, 'energy', identity)
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Energy')
    // Both catalog items plus the nested-only collection page.
    expect(results[0].hits.map(hit => hit.to).sort()).toEqual(
      ['/battery', '/battery-cells', '/battery-degradation'].sort(),
    )
  })

  it('matches translated labels through the resolver, not the raw label', () => {
    const results = searchSidebarSections(sections, collections, 'batterie', entry =>
      entry.labelKey === 'nav.items.battery' ? 'Batteriegesundheit' : entry.label,
    )
    expect(results.flatMap(section => section.hits.map(hit => hit.to))).toContain('/battery')
  })

  it('returns no sections when nothing matches', () => {
    expect(searchSidebarSections(sections, collections, 'zzz-no-such-page', identity)).toEqual([])
  })
})
