import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { navSections } from '../Layout'
import { CommandDeck } from './CommandDeck'
import { collectionGroups, collectionSidebarSections } from './collections'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : String(fallback.defaultValue ?? _key)
      return text.replace(/{{(\w+)}}/g, (_, key: string) => String(typeof fallback === 'object' ? fallback[key] ?? '' : ''))
    },
  }),
}))
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}))

const paths = [
  '/experiments/vehicle-lab',
  '/experiments/route-flyover',
  '/experiments/energy-flow',
  '/experiments/year-in-motion',
  '/experiments/battery-what-if',
  '/experiments/drive-art',
]
const collections = collectionGroups(navSections)
const sections = collectionSidebarSections(navSections, collections)

function Harness() {
  const [open, setOpen] = useState(true)
  return (
    <MemoryRouter initialEntries={['/experiments/vehicle-lab']}>
      <CommandDeck
        sections={sections}
        collections={collections}
        pinnedItems={[]}
        pathname="/experiments/vehicle-lab"
        activeSectionTitle="Experiments"
        navLabel={item => item.label}
        navSectionTitle={section => section.title}
        onPin={() => undefined}
        onUnpin={() => undefined}
        panelOpen={open}
        onPanelOpenChange={setOpen}
      />
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.clear()
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe('Experiments navigation', () => {
  it.each([1920, 768, 390])('lists six badged destinations with one section icon at %ipx', width => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    render(<Harness />)
    let sectionButton: HTMLElement
    if (width < 768) {
      fireEvent.click(screen.getByRole('button', { name: 'More', exact: true }))
      sectionButton = within(screen.getByRole('dialog')).getByRole('button', { name: 'Experiments', exact: true })
    } else {
      sectionButton = within(screen.getByTestId('command-deck-rail')).getByRole('button', { name: 'Experiments', exact: true })
    }
    const icon = sectionButton.querySelector('svg')!.innerHTML
    if (width < 768) fireEvent.click(sectionButton)
    const panel = screen.getByTestId('atlas-panel-secondary')
    expect(panel.querySelector('svg')!.innerHTML).toBe(icon)
    expect(within(panel).getAllByText('Experimental')).toHaveLength(6)
    const links = within(panel).getAllByRole('link')
    expect(links.map(link => link.getAttribute('href'))).toEqual(paths)
    expect(links.every(link => link.textContent?.includes('Experimental'))).toBe(true)
    expect(links[0]).toHaveAttribute('aria-current', 'page')
    expect(panel.querySelector('.is-animating')).toBeNull()
  })

  it('keeps the new section after the original sections, just above rail utilities', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 })
    render(<Harness />)
    const rail = screen.getByTestId('command-deck-rail')
    expect(within(rail).getAllByRole('button').at(-1)).toHaveAccessibleName('Experiments')
    expect(within(rail).getByRole('link', { name: 'Alerts', exact: true })).toBeInTheDocument()
  })
})
