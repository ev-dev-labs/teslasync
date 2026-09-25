import { describe, expect, it } from 'vitest'
import { sidebarBreadcrumbs, type BreadcrumbSection } from './sidebarBreadcrumbs'
import type { SectionGroup } from '../sectionGroups'

const translate = (_key: string, fallback: string) => fallback
const sections: BreadcrumbSection[] = [
  { title: 'Commands', items: [{ to: '/commands', label: 'Commands', labelKey: 'commands' }] },
  { title: 'Reports', items: [{ to: '/statistics', label: 'Statistics', labelKey: 'stats' }] },
  { title: 'Driving', items: [{ to: '/drives', label: 'Drives', labelKey: 'drives' }] },
]
const collections: SectionGroup[] = [
  { primary: '/commands', label: 'Commands', labelKey: 'commands', pages: [
    { to: '/commands', label: 'Send Commands', labelKey: 'send' },
    { to: '/command-history', label: 'Command History', labelKey: 'history' },
  ] },
  { primary: '/statistics', label: 'Fleet Insights', labelKey: 'insights', pages: [
    { to: '/statistics', label: 'Statistics', labelKey: 'stats' },
    { to: '/analytics', label: 'Analytics', labelKey: 'analytics' },
  ] },
  { primary: '/drives', label: 'Drives', labelKey: 'drives', pages: [
    { to: '/drives', label: 'Drive Sessions', labelKey: 'sessions' },
    { to: '/drive-calendar', label: 'Drive Calendar', labelKey: 'calendar' },
  ] },
]

describe('sidebar breadcrumbs', () => {
  it('flattens the only collection in a section', () => {
    expect(sidebarBreadcrumbs('/commands', [{ label: 'Commands' }], sections, collections, translate))
      .toEqual([{ label: 'Commands' }, { label: 'Send Commands', href: undefined }])
  })

  it('shows section, collection, then page when the collection is a real rung', () => {
    const withOtherReports = sections.map(section => section.title === 'Reports'
      ? { ...section, items: [...section.items, { to: '/share-card', label: 'Share Card', labelKey: 'share' }] }
      : section)
    expect(sidebarBreadcrumbs('/analytics', [{ label: 'Statistics', href: '/statistics' }, { label: 'Analytics' }], withOtherReports, collections, translate))
      .toEqual([{ label: 'Reports' }, { label: 'Fleet Insights' }, { label: 'Analytics', href: undefined }])
  })

  it('preserves detail-page overrides below the actual sidebar path', () => {
    expect(sidebarBreadcrumbs('/drives/42', [
      { label: 'Drives', href: '/drives' },
      { label: 'Office trip' },
    ], sections, collections, translate)).toEqual([
      { label: 'Driving' }, { label: 'Drive Sessions', href: '/drives' }, { label: 'Office trip' },
    ])
  })

  it('does not change routes absent from the visible sidebar', () => {
    const fallback = [{ label: 'Private detail' }]
    expect(sidebarBreadcrumbs('/secret', fallback, sections, collections, translate)).toEqual(fallback)
  })
})
