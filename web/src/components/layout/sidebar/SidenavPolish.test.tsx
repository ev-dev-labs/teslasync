import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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
    collections={large ? largeCollections : collections} pinnedItems={[]}
    pathname={path} activeSectionTitle={large ? 'Large' : title} navLabel={item => item.label} navSectionTitle={section => section.title}
    onPin={() => undefined} onUnpin={() => undefined} panelOpen={open} onPanelOpenChange={setOpen} /></MemoryRouter>
}
beforeEach(() => { localStorage.clear(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 }) })
afterEach(cleanup)
const svg = (element: Element) => element.querySelector('svg')?.innerHTML

describe('sidenav polish', () => {
  it('renders the full registry directly in the rail and opens Diagnostics without More', () => {
    render(<Deck />)
    const rail = within(screen.getByTestId('rail-scroll'))
    expect(rail.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(sections.map(section => section.title))
    expect(rail.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    fireEvent.click(rail.getByRole('button', { name: 'Diagnostics' }))
    const panel = within(screen.getByTestId('atlas-panel-secondary'))
    expect(panel.getByText('Diagnostics', { exact: true })).toBeVisible()
    expect(panel.getByRole('link', { name: 'System Status', exact: true })).toHaveAttribute('href', '/system-status')
  })

  it('keeps the Home links and collections in registry order without an empty Pinned group', () => {
    render(<Deck title="Home" path="/" />)
    const panel = within(screen.getByTestId('atlas-panel-secondary'))
    const liveMap = panel.getByRole('link', { name: 'Live map', exact: true })
    const history = panel.getByRole('button', { name: 'Vehicle history', exact: true })
    const digest = panel.getByRole('link', { name: 'Weekly digest', exact: true })
    expect(liveMap.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(history.compareDocumentPosition(digest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(panel.queryByRole('button', { name: 'Pinned', exact: true })).not.toBeInTheDocument()
  })

  it.each(navSections)('$title resolves real rail, panel and palette glyphs for every destination', section => {
    const SectionIcon = SIDEBAR_SECTION_ICONS[section.title]
    expect(SectionIcon).toBeDefined()
    expect(resolveSectionIcon(section.title)).toBe(SectionIcon)
    const sectionMarkup = renderToStaticMarkup(<SectionIcon />)
    expect(sectionMarkup).toContain('<svg')
    expect(sectionMarkup).toMatch(/<(path|circle|rect|line|polyline|polygon)\b/)
    for (const item of section.items) {
      const markup = renderToStaticMarkup(<item.icon />)
      expect(markup, item.to).toContain('<svg')
      expect(markup, item.to).toMatch(/<(path|circle|rect|line|polyline|polygon)\b/)
      expect(markup, item.to).not.toMatch(/lucide-(dot|signal-zero|signal-low)\b/)
    }
  })
  it('labels Notifications clearly without a duplicate rail bell', () => {
    render(<Deck title="Notifications" path="/notifications/inbox" />)
    const rail = screen.getByTestId('command-deck-rail')
    const notifications = within(rail).getByRole('button', { name: 'Notifications', exact: true })
    expect(notifications).toHaveTextContent('Notifications')
    expect(notifications).not.toHaveTextContent('Alerts')
    expect(notifications.querySelector('svg')).toHaveClass('lucide-inbox')
    expect(rail.querySelectorAll('.lucide-bell, .lucide-bell-ring')).toHaveLength(0)
    expect(screen.getByTestId('atlas-panel-secondary')).toHaveTextContent('Notifications')
  })
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
      for (const tab of PHONE_TAB_SECTIONS) expect(within(sheet).getByRole('button', { name: tab, exact: true })).toBeVisible()
      const item = within(sheet).getByRole('button', { name: title, exact: true })
      expect(item).toHaveAttribute('aria-current', 'true')
      expect(svg(item)).toBe(glyph)
      fireEvent.click(item)
    }
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: title })).toBeVisible()
  })

  it('expands small-section groups initially and restores an explicit collapse on remount', () => {
    const view = render(<Deck path="/" />)
    expect(screen.queryByRole('button', { name: 'Pinned' })).toBeNull()
    const group = screen.getByRole('button', { name: 'Battery insights' })
    expect(group).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(group)
    view.unmount()
    render(<Deck path="/" />)
    expect(screen.getByRole('button', { name: 'Battery insights' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('expands every large-section group and preserves explicit collapses after remount', () => {
    const view = render(<Deck large path="/large/0" />)
    expect(screen.queryByRole('button', { name: 'Pinned' })).toBeNull()
    expect(screen.getByRole('button', { name: 'First group' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Second group' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Second group' }))
    fireEvent.click(screen.getByRole('button', { name: 'First group' }))
    view.unmount()
    render(<Deck large path="/large/0" />)
    expect(screen.getByRole('button', { name: 'Second group' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'First group' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('ignores collapse state written by the old design once, then persists new choices', () => {
    localStorage.setItem('teslasync-sidenav-collapsed-groups', JSON.stringify({ 'section:Battery:/battery': true, 'section:Battery:pinned': true }))
    const view = render(<Deck path="/" />)
    expect(screen.queryByRole('button', { name: 'Pinned' })).toBeNull()
    const group = screen.getByRole('button', { name: 'Battery insights' })
    expect(group).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(group)
    expect(JSON.parse(localStorage.getItem('teslasync-sidenav-collapsed-groups-v2')!)).toMatchObject({ 'section:Battery:/battery': true })
    view.unmount()
    render(<Deck path="/" />)
    expect(screen.getByRole('button', { name: 'Battery insights' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('defines fine-pointer density separately from coarse touch and keeps phone rows touch sized', () => {
    const css = readFileSync('src/components/layout/sidebar/sidenav.css', 'utf8')
    expect(css).toMatch(/@media \(min-width: 768px\) and \(pointer: fine\)\s*\{\s*\.sidenav-panel \{ --sidenav-row-height: 34px; --sidenav-group-height: 28px; --sidenav-filter-height: 34px;/)
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.sidenav-panel \{ --sidenav-row-height: 44px;/)
    expect(css).toContain('outline-offset: -2px')
  })
})
