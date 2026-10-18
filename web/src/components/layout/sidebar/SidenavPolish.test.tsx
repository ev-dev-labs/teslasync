import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { Icons } from '@/lib/icons'
import { CommandDeck } from './CommandDeck'
import { navSections } from '../Layout'
import { collectionGroups, collectionSidebarSections } from './collections'
import { PHONE_TAB_SECTIONS, SIDEBAR_SECTION_ICONS, resolveSectionIcon } from './sidebarIcons'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string | { defaultValue: string }) => typeof fallback === 'string' ? fallback : fallback.defaultValue }) }))
vi.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => ({ reduce: true, durationMs: 0 }) }))
const collections = collectionGroups(navSections)
const sections = collectionSidebarSections(navSections, collections)
function Deck({ title = 'Battery', path = '/battery', large = false }: { title?: string; path?: string; large?: boolean }) {
  const [open, setOpen] = useState(true)
  const pages = Array.from({ length: 26 }, (_, index) => ({ to: `/large/${index}`, label: `Page ${index}`, labelKey: `test.${index}`, icon: Icons.home }))
  const largeCollections = [
    { primary: '/large/0', label: 'First group', labelKey: 'first', pages: pages.slice(0, 13) },
    { primary: '/large/13', label: 'Second group', labelKey: 'second', pages: pages.slice(13) },
  ]
  return <MemoryRouter initialEntries={[path]}><CommandDeck sections={large ? [{ title: 'Large', items: largeCollections.map(group => ({ to: group.primary, label: group.label, labelKey: group.labelKey, icon: Icons.home })) }] : sections}
    collections={large ? largeCollections : collections} pinnedItems={[]} recentItems={[]}
    pathname={path} activeSectionTitle={large ? 'Large' : title} navLabel={item => item.label} navSectionTitle={section => section.title}
    onPin={() => undefined} onUnpin={() => undefined} panelOpen={open} onPanelOpenChange={setOpen} /></MemoryRouter>
}
beforeEach(() => { localStorage.clear(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 }) })
afterEach(cleanup)
const svg = (element: Element) => element.querySelector('svg')?.innerHTML

describe('sidenav polish', () => {
  it.each(sections.map(section => section.title))('%s has one shared glyph in the rail, header, phone tab or More, and section sheet', title => {
    expect(resolveSectionIcon(title)).toBe(SIDEBAR_SECTION_ICONS[title])
    const view = render(<Deck title={title} />)
    const rail = screen.getByTestId('command-deck-rail')
    const item = within(rail).getByRole('button', { name: title, exact: true })
    expect(item).toHaveAccessibleName(title)
    expect(item).not.toHaveAttribute('title')
    expect(item).not.toHaveAttribute('aria-describedby')
    const glyph = svg(item)!
    expect(svg(screen.getByTestId('atlas-panel-secondary'))).toBe(glyph)
    view.unmount()
    Object.defineProperty(window, 'innerWidth', { value: 375 })
    render(<Deck title={title} />)
    if (PHONE_TAB_SECTIONS.some(tab => tab === title)) {
      const tab = screen.getByRole('button', { name: title, exact: true })
      expect(svg(tab)).toBe(glyph)
      fireEvent.click(tab)
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'More', exact: true }))
      const sheet = screen.getByRole('dialog')
      for (const tab of PHONE_TAB_SECTIONS) expect(within(sheet).queryByRole('button', { name: tab, exact: true })).toBeNull()
      const item = within(sheet).getByRole('button', { name: title, exact: true })
      expect(item).toHaveAttribute('aria-current', 'true')
      expect(svg(item)).toBe(glyph)
      fireEvent.click(item)
    }
    expect(svg(screen.getByTestId('atlas-panel-secondary'))).toBe(glyph)
  })

  it('expands small-section groups initially and restores an explicit collapse on remount', () => {
    const view = render(<Deck />)
    expect(screen.getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'true')
    const group = screen.getByRole('button', { name: 'Battery insights' })
    expect(group).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(group)
    view.unmount()
    render(<Deck />)
    expect(screen.getByRole('button', { name: 'Battery insights' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('defaults large sections to the active group, preserves explicit opens and closes after remount', () => {
    const view = render(<Deck large path="/large/0" />)
    expect(screen.getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'First group' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Second group' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Second group' }))
    fireEvent.click(screen.getByRole('button', { name: 'First group' }))
    view.unmount()
    render(<Deck large path="/large/0" />)
    expect(screen.getByRole('button', { name: 'Second group' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'First group' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('defines fine-pointer density separately from coarse touch and keeps phone rows touch sized', () => {
    const css = readFileSync('src/components/layout/sidebar/sidenav.css', 'utf8')
    expect(css).toMatch(/@media \(min-width: 768px\) and \(pointer: fine\)\s*\{\s*\.sidenav-panel \{ --sidenav-row-height: 34px; --sidenav-group-height: 28px; --sidenav-filter-height: 34px;/)
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.sidenav-panel \{ --sidenav-row-height: 44px;/)
    expect(css).toContain('outline-offset: -2px')
  })
})
