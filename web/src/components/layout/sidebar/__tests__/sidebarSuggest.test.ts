/**
 * sidebarSuggest — pure suggestion-engine tests.
 *
 * The default sidebar volunteers pages before the user looks for them:
 * live context (charging car, driving car, critical alerts) first, then
 * pages related to the current route. These tests pin the priority,
 * caps, and exclusion rules without rendering any DOM.
 */

import { describe, it, expect } from 'vitest'
import { Icons } from '@/lib/icons'
import type { SectionGroup } from '../../sectionGroups'
import { suggestSidebarPages, type SuggestReasonKind } from '../sidebarSuggest'

const identity = (entry: { label: string }) => entry.label
const reasonStub = (kind: SuggestReasonKind, vars: { vehicle?: string; page?: string; count?: number }) =>
  `${kind}:${vars.vehicle ?? vars.page ?? vars.count ?? ''}`

const actionCenter = { to: '/action-center', icon: Icons.notificationsActive, label: 'Action Center', labelKey: 'nav.items.action-center' }
const liveItem = { to: '/live', icon: Icons.map, label: 'Live Map', labelKey: 'nav.items.live' }
const chargingItem = { to: '/charging', icon: Icons.charging, label: 'Charging Overview', labelKey: 'nav.items.charging' }
const drivesItem = { to: '/drives', icon: Icons.drive, label: 'Drives', labelKey: 'nav.items.drives' }
const dynamicsItem = { to: '/driving-dynamics', icon: Icons.activity, label: 'Driving Dynamics', labelKey: 'nav.items.driving-dynamics' }

const collections: SectionGroup[] = [
  {
    primary: '/charging',
    label: 'Charging Activity',
    labelKey: 'nav.collections.charging',
    pages: [
      { to: '/charging', label: 'Charging Overview', labelKey: 'nav.items.charging' },
      { to: '/charging-curve', label: 'Charging Curve', labelKey: 'nav.items.charging-curve' },
    ],
  },
  {
    primary: '/driving-dynamics',
    label: 'Driving Performance',
    labelKey: 'nav.collections.driving_dynamics',
    pages: [
      { to: '/driving-dynamics', label: 'Driving Dynamics', labelKey: 'nav.items.driving-dynamics' },
      { to: '/drive-dna', label: 'Drive DNA', labelKey: 'nav.items.drive-dna' },
    ],
  },
]

const sections = [
  { title: 'Home', titleKey: 'nav.groups.home', items: [actionCenter, liveItem] },
  { title: 'Charging', titleKey: 'nav.groups.charging', items: [chargingItem] },
  { title: 'Driving', titleKey: 'nav.groups.driving', items: [drivesItem, dynamicsItem] },
]

function suggest(pathname: string, overrides: Parameters<typeof suggestSidebarPages>[3] = {}) {
  return suggestSidebarPages(sections, collections, pathname, {
    resolveLabel: identity,
    formatReason: reasonStub,
    ...overrides,
  })
}

describe('suggestSidebarPages — NOW (live context)', () => {
  it('leads with the Action Center when critical alerts are unread', () => {
    const rows = suggest('/drives', { signals: { criticalAlertCount: 2 } })
    expect(rows[0].to).toBe('/action-center')
    expect(rows[0].reason).toBe('alerts:2')
  })

  it('suggests charging pages while the vehicle charges', () => {
    const rows = suggest('/drives', {
      signals: { criticalAlertCount: 0, vehicleName: 'Model 3', vehicleStatus: 'charging' },
    })
    expect(rows.map(row => row.to).slice(0, 2)).toEqual(['/charging', '/charging-curve'])
    expect(rows[0].reason).toBe('charging:Model 3')
  })

  it('suggests live + drives pages while the vehicle drives', () => {
    const rows = suggest('/charging', {
      signals: { criticalAlertCount: 0, vehicleName: 'Model Y', vehicleStatus: 'driving' },
    })
    expect(rows.map(row => row.to).slice(0, 2)).toEqual(['/live', '/drives'])
    expect(rows[0].reason).toBe('driving:Model Y')
  })

  it('prioritizes alerts over vehicle state and caps live rows at two', () => {
    const rows = suggest('/drives', {
      signals: { criticalAlertCount: 1, vehicleName: 'Model 3', vehicleStatus: 'charging' },
    })
    expect(rows.map(row => row.to).slice(0, 2)).toEqual(['/action-center', '/charging'])
  })

  it('skips live candidates outside the visible catalog', () => {
    const rows = suggest('/charging', {
      signals: { criticalAlertCount: 0, vehicleStatus: 'charging' },
    })
    // /charging is current → only the curve survives from the NOW block.
    expect(rows.map(row => row.to)).not.toContain('/charging')
    expect(rows.map(row => row.to)).toContain('/charging-curve')
  })
})

describe('suggestSidebarPages — UP NEXT (related pages)', () => {
  it('fills from same-collection siblings first, tagged with the current page', () => {
    const rows = suggest('/driving-dynamics', { signals: { criticalAlertCount: 0 } })
    expect(rows.map(row => row.to)).toContain('/drive-dna')
    expect(rows.find(row => row.to === '/drive-dna')?.reason).toBe('related:Driving Dynamics')
  })

  it('falls back to section siblings once the collection is exhausted', () => {
    const rows = suggest('/drives', {
      signals: { criticalAlertCount: 0 },
      pinnedPaths: new Set(['/drive-dna']),
    })
    // Driving section flattened: Drives (current, excluded) + Driving
    // Performance pages → dynamics first, then the rest in order.
    expect(rows.map(row => row.to)).toContain('/driving-dynamics')
  })

  it('never echoes the current page, pins, or recents', () => {
    const rows = suggest('/drives', {
      pinnedPaths: new Set(['/live']),
      recentPaths: new Set(['/charging']),
      signals: { criticalAlertCount: 0 },
    })
    const paths = rows.map(row => row.to)
    expect(paths).not.toContain('/drives')
    expect(paths).not.toContain('/live')
    expect(paths).not.toContain('/charging')
  })

  it('caps the list so the group stays a nudge', () => {
    const rows = suggest('/drives', {
      signals: { criticalAlertCount: 1, vehicleStatus: 'charging' },
      max: 3,
    })
    expect(rows).toHaveLength(3)
  })

  it('uses page labels, not group labels, for rows and reasons', () => {
    // Grouped section items carry the GROUP label; the corpus must prefer
    // each page's own label so rows read "Driving Dynamics", never the
    // "Driving Performance" umbrella users never see anywhere else.
    const relabeled = [
      {
        title: 'Driving',
        titleKey: 'nav.groups.driving',
        items: [
          { to: '/driving-dynamics', icon: Icons.activity, label: 'Driving Performance', labelKey: 'nav.collections.driving_dynamics' },
        ],
      },
    ]
    const rows = suggestSidebarPages(relabeled, collections, '/drive-dna', {
      resolveLabel: identity,
      formatReason: reasonStub,
      signals: { criticalAlertCount: 0 },
    })
    expect(rows[0].to).toBe('/driving-dynamics')
    expect(rows[0].label).toBe('Driving Dynamics')
    expect(rows[0].reason).toBe('related:Drive DNA')
  })

  it('returns only live rows on an unknown route, and nothing without signals', () => {
    expect(suggest('/no-such-route', { signals: { criticalAlertCount: 0 } })).toEqual([])
    const rows = suggest('/no-such-route', {
      signals: { criticalAlertCount: 1, vehicleStatus: 'driving' },
    })
    expect(rows.map(row => row.to)).toEqual(['/action-center', '/live'])
  })
})
