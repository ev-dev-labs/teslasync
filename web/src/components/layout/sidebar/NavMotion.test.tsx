import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { navSections } from '../Layout'
import { BottomTabBar } from '../BottomTabBar'
import { CommandDeck } from './CommandDeck'
import { SectionRail } from './SectionRail'
import { NAV_ICON_PARTS } from './navIconParts'
import { NAV_SECTION_ICONS, NAV_UTILITY_ICONS } from './NavIcons'
import { collectionGroups, collectionSidebarSections } from './collections'

const preference = vi.hoisted(() => ({ reduce: false }))
vi.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => ({ reduce: preference.reduce, durationMs: preference.reduce ? 0 : 250 }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string | { defaultValue: string }) => typeof fallback === 'string' ? fallback : fallback.defaultValue }) }))
const collections = collectionGroups(navSections)
const sections = collectionSidebarSections(navSections, collections)
function Deck({ route = 'Home', path = '/' }: { route?: string; path?: string }) {
  const [open, setOpen] = useState(true)
  return <MemoryRouter><CommandDeck sections={sections} collections={collections} pinnedItems={[]} recentItems={[]}
    pathname={path} activeSectionTitle={route} navLabel={item => item.label} navSectionTitle={section => section.title}
    onPin={() => undefined} onUnpin={() => undefined} panelOpen={open} onPanelOpenChange={setOpen} alertCount={7} /></MemoryRouter>
}
const target = (item: HTMLElement) => item.querySelector<HTMLElement>('[data-nav-motion]')!
// React's JSDOM feature detection selects the prefixed event when AnimationEvent is absent.
const endMotion = (element: Element) => { fireEvent.animationEnd(element); fireEvent(element, new Event('webkitAnimationEnd', { bubbles: true })) }
const rail = () => within(screen.getByTestId('command-deck-rail'))
beforeEach(() => { localStorage.clear(); preference.reduce = false; Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 }); HTMLElement.prototype.scrollIntoView = vi.fn() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('selection-only nav icon motion', () => {
  it.each(navSections.map(section => section.title))('%s has a multipart animated variant and settles after one selection', title => {
    expect(NAV_SECTION_ICONS[title]).toBeDefined()
    render(<Deck />)
    const item = rail().getByRole('button', { name: title, exact: true })
    const icon = item.querySelector('svg')!
    expect(icon).toHaveAttribute('stroke-width', '1.8')
    expect(icon).toHaveAttribute('viewBox', '0 0 24 24')
    expect(icon.querySelectorAll('.nav-icon-part').length).toBeGreaterThanOrEqual(2)
    expect(icon.querySelectorAll('.nav-icon-part').length).toBeLessThanOrEqual(4)
    expect(target(item)).not.toHaveClass('is-animating')
    fireEvent.click(item)
    expect(target(item)).toHaveClass('is-animating')
    endMotion(icon.querySelector('.part-1')!)
    expect(target(item)).toHaveClass('is-animating')
    endMotion(target(item))
    expect(target(item)).not.toHaveClass('is-animating')
    fireEvent.click(item)
    expect(target(item)).toHaveClass('is-animating')
  })
  it.each(['Enter', ' '] as const)('native %s activation starts motion; focus and arrow navigation do not', async key => {
    render(<Deck />)
    const item = rail().getByRole('button', { name: 'Home', exact: true })
    const user = userEvent.setup()
    await user.tab()
    expect(target(item)).not.toHaveClass('is-animating')
    await user.keyboard(key === 'Enter' ? '{Enter}' : ' ')
    expect(target(item)).toHaveClass('is-animating')
    endMotion(target(item))
    await user.keyboard('{ArrowDown}')
    expect(document.querySelector('.is-animating')).toBeNull()
  })
  it('does not animate on initial render, restored selection, remount, or programmatic route change', () => {
    localStorage.setItem('teslasync-deck-view', JSON.stringify({ kind: 'section', title: 'Battery' }))
    const view = render(<Deck route="Driving" path="/drives" />)
    expect(rail().getByRole('button', { name: 'Battery', exact: true })).toHaveAttribute('aria-current', 'true')
    expect(document.querySelector('.is-animating')).toBeNull()
    view.rerender(<Deck route="Charging" path="/charging" />)
    expect(rail().getByRole('button', { name: 'Charging', exact: true })).toHaveAttribute('aria-current', 'true')
    expect(document.querySelector('.is-animating')).toBeNull()
    view.unmount()
    render(<Deck route="Charging" path="/charging" />)
    expect(document.querySelector('.is-animating')).toBeNull()
  })
  it.each(['Alerts', 'Display', 'Account'])('%s footer keeps its accessible control and has an animated variant', name => {
    render(<Deck />)
    const item = name === 'Alerts' || name === 'Display' ? rail().getByRole('link', { name, exact: true }) : rail().getByText('', { selector: 'summary' })
    expect(item.querySelector('svg')).toHaveAttribute('data-nav-icon', name === 'Alerts' ? 'alerts' : name === 'Display' ? 'display' : 'avatar')
    fireEvent.click(item)
    expect(target(item)).toHaveClass('is-animating')
    endMotion(target(item))
    expect(target(item)).not.toHaveClass('is-animating')
    if (name === 'Alerts') expect(item.querySelector('.sidenav-alert-count')).toHaveTextContent('7')
  })
  it('animates the injected appearance trigger without animating its menu actions', () => {
    function Appearance({ triggerIcon }: { triggerIcon?: React.ReactNode }) { return <><button data-nav-action>{triggerIcon}</button><button>Theme option</button></> }
    render(<MemoryRouter><SectionRail sections={sections} selection={{ kind: 'section', title: 'Home' }} onSelect={() => undefined} navSectionTitle={s => s.title} alertCount={0} appearanceControl={<Appearance />} /></MemoryRouter>)
    const trigger = document.querySelector<HTMLButtonElement>('.sidenav-utility button')!
    fireEvent.click(trigger)
    expect(target(trigger)).toHaveClass('is-animating')
    endMotion(target(trigger))
    fireEvent.click(screen.getByRole('button', { name: 'Theme option' }))
    expect(target(trigger)).not.toHaveClass('is-animating')
  })
  it.each(['Home', 'Vehicles', 'Driving', 'Charging', 'More'])('phone %s is animated on activation only', name => {
    render(<BottomTabBar activeSection="Driving" />)
    const tab = screen.getByRole('button', { name, exact: true })
    expect(target(tab)).not.toHaveClass('is-animating')
    fireEvent.click(tab)
    expect(target(tab)).toHaveClass('is-animating')
    endMotion(target(tab))
    expect(target(tab)).not.toHaveClass('is-animating')
  })
  it('does not add motion under either the app or OS reduced-motion preference, and clears it if preference changes', () => {
    const view = render(<BottomTabBar />)
    const home = screen.getByRole('button', { name: 'Home', exact: true })
    fireEvent.click(home)
    expect(target(home)).toHaveClass('is-animating')
    preference.reduce = true
    view.rerender(<BottomTabBar />)
    expect(target(home)).not.toHaveClass('is-animating')
    fireEvent.click(home)
    expect(target(home)).not.toHaveClass('is-animating')
    preference.reduce = false
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    view.rerender(<BottomTabBar />)
    fireEvent.click(home)
    expect(target(home)).not.toHaveClass('is-animating')
  })
  it('clears playback immediately when the OS cancels animation mid-flight', () => {
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const view = render(<BottomTabBar />)
    const home = screen.getByRole('button', { name: 'Home', exact: true })
    fireEvent.click(home)
    expect(target(home)).toHaveClass('is-animating')
    media.matches = true
    media.addEventListener.mock.calls[0][1]()
    expect(target(home)).not.toHaveClass('is-animating')
    view.unmount()
    expect(media.removeEventListener).toHaveBeenCalledWith('change', media.addEventListener.mock.calls[0][1])
  })
  it('keeps panel, More grid and section sheet icons identical but static', () => {
    const view = render(<Deck route="Notifications" />)
    const icon = rail().getByRole('button', { name: 'Notifications', exact: true }).querySelector('svg')!.innerHTML
    expect(screen.getByTestId('atlas-panel-secondary').querySelector('svg')!.innerHTML).toBe(icon)
    expect(screen.getByTestId('atlas-panel-secondary').querySelector('[data-nav-motion], .is-animating')).toBeNull()
    view.unmount()
    Object.defineProperty(window, 'innerWidth', { value: 375 })
    render(<Deck route="Notifications" />)
    fireEvent.click(screen.getByRole('button', { name: 'More', exact: true }))
    const item = within(screen.getByRole('dialog')).getByRole('button', { name: 'Notifications', exact: true })
    expect(item.querySelector('svg')!.innerHTML).toBe(icon)
    expect(item.querySelector('[data-nav-motion], .is-animating')).toBeNull()
    fireEvent.click(item)
    expect(screen.getByTestId('atlas-panel-secondary').querySelector('svg')!.innerHTML).toBe(icon)
    expect(screen.getByRole('dialog').querySelector('[data-nav-motion], .is-animating')).toBeNull()
  })
  it('has finite transforms/opacity-only keyframes, scoped behind reduced-motion, for every glyph', () => {
    const css = readFileSync('src/components/layout/sidebar/nav-motion.css', 'utf8')
    const media = css.indexOf('@media (prefers-reduced-motion: no-preference)')
    expect(media).toBeGreaterThan(0)
    expect(css.indexOf('@keyframes')).toBeGreaterThan(media)
    expect(css.indexOf('scale(.9)')).toBeGreaterThan(media)
    expect(css).not.toMatch(/infinite|stroke-dashoffset|animation[^;]*[1-9]s\b/)
    for (const id of Object.keys(NAV_ICON_PARTS)) expect(css).toContain(`.nav-glyph-${id}`)
    for (const [, body] of css.matchAll(/@keyframes [\w-]+\s*\{(.*?)(?=\n)/g)) {
      const declarations = [...body.matchAll(/([\w-]+)\s*:/g)].map(match => match[1])
      expect(declarations.every(property => property === 'transform' || property === 'opacity')).toBe(true)
    }
    expect(Object.keys(NAV_UTILITY_ICONS)).toEqual(['alerts', 'display', 'avatar', 'more'])
  })
})
