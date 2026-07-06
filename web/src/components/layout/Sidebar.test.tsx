/**
 * Sidebar nav registry — data-contract + icon-render tests.
 *
 * `Sidebar.tsx` is a pure data module: it exports the individual nav entries
 * (DIAGNOSTIC / LIVE_LOGS / RBAC) plus the `SIDEBAR_NAV_ENTRIES` registry that
 * the Layout splices into its accordions. A silent change to the shape,
 * ordering, section, or icon of any entry reshuffles the sidebar for every
 * user, so these tests lock that contract and prove each entry's `icon` is a
 * real, renderable React component.
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Activity, ScrollText, ShieldCheck } from 'lucide-react'

import {
  DIAGNOSTIC_NAV_ENTRY,
  LIVE_LOGS_NAV_ENTRY,
  RBAC_NAV_ENTRY,
  SIDEBAR_NAV_ENTRIES,
  type SidebarNavEntry,
} from './Sidebar'

const KNOWN_SECTIONS: ReadonlyArray<SidebarNavEntry['section']> = [
  'admin',
  'infrastructure',
  'tools',
]

describe('SIDEBAR_NAV_ENTRIES', () => {
  it('lists the three nav entries in a stable, referentially-equal order', () => {
    expect(SIDEBAR_NAV_ENTRIES).toHaveLength(3)
    expect(SIDEBAR_NAV_ENTRIES).toEqual([
      DIAGNOSTIC_NAV_ENTRY,
      LIVE_LOGS_NAV_ENTRY,
      RBAC_NAV_ENTRY,
    ])
    // Identity, not just deep-equality: Layout depends on the exported singletons.
    expect(SIDEBAR_NAV_ENTRIES[0]).toBe(DIAGNOSTIC_NAV_ENTRY)
    expect(SIDEBAR_NAV_ENTRIES[2]).toBe(RBAC_NAV_ENTRY)
  })

  it('gives every entry a unique, absolute route path', () => {
    const paths = SIDEBAR_NAV_ENTRIES.map((entry) => entry.to)
    expect(paths).toEqual(['/diagnostic', '/live-logs', '/admin/rbac'])
    for (const to of paths) {
      expect(to.startsWith('/')).toBe(true)
    }
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('assigns each entry to a known logical section', () => {
    for (const entry of SIDEBAR_NAV_ENTRIES) {
      expect(KNOWN_SECTIONS).toContain(entry.section)
    }
    expect(DIAGNOSTIC_NAV_ENTRY.section).toBe('infrastructure')
    expect(LIVE_LOGS_NAV_ENTRY.section).toBe('infrastructure')
    expect(RBAC_NAV_ENTRY.section).toBe('admin')
  })

  it('provides a unique i18n key and a non-empty English fallback per entry', () => {
    const keys = SIDEBAR_NAV_ENTRIES.map((entry) => entry.i18nKey)
    expect(new Set(keys).size).toBe(keys.length)
    for (const entry of SIDEBAR_NAV_ENTRIES) {
      expect(entry.i18nKey.length).toBeGreaterThan(0)
      expect(entry.defaultLabel.trim().length).toBeGreaterThan(0)
    }
  })

  it('wires each entry to its dedicated lucide icon component', () => {
    expect(DIAGNOSTIC_NAV_ENTRY.icon).toBe(Activity)
    expect(LIVE_LOGS_NAV_ENTRY.icon).toBe(ScrollText)
    expect(RBAC_NAV_ENTRY.icon).toBe(ShieldCheck)
  })
})

describe('nav entry icons', () => {
  it('render an accessible <svg> that forwards aria-label props', () => {
    for (const entry of SIDEBAR_NAV_ENTRIES) {
      const Icon = entry.icon
      const { container, unmount } = render(<Icon aria-label={entry.defaultLabel} />)
      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg?.tagName.toLowerCase()).toBe('svg')
      expect(svg?.getAttribute('aria-label')).toBe(entry.defaultLabel)
      unmount()
    }
  })
})
