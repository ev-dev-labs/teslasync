import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { navSections } from '../Layout'
import { ROUTE_REGISTRY } from '@/lib/routeRegistry'
import en from '@/i18n/en.json'
import { SIDEBAR_SECTION_ICONS } from './sidebarIcons'
import { SIDEBAR_COLLECTION_ICONS } from './sidebarCollectionIcons'
import { CollectionTreeRow } from './CollectionTreeRow'
import { COLLECTION_DEFINITIONS, collectionGroups, collectionPrimaryPath, collectionSidebarSections, quickAccessSidebarItems, soleCollection, unpinnedSidebarItems } from './collections'

function CurrentPath() {
  return <span data-testid="current-path">{useLocation().pathname}</span>
}

describe('sidebar collections', () => {
  const groups = collectionGroups(navSections)
  const catalogPaths = navSections.flatMap(section => section.items.map(item => item.to))

  it('gives every section, collection, and destination a distinct visible name', () => {
    const english = (key: string, fallback: string) => {
      const value = key.split('.').reduce<unknown>(
        (current, segment) => current && typeof current === 'object'
          ? (current as Record<string, unknown>)[segment]
          : undefined,
        en,
      )
      return typeof value === 'string' ? value : fallback
    }
    for (const label of [(key: string, fallback: string) => fallback, english]) {
      const names = [
        ...navSections.map(section => [label(section.titleKey, section.title), section.title]),
        ...navSections.flatMap(section => section.items.map(item => [label(item.labelKey, item.label), item.to])),
        ...groups.map(group => [label(group.labelKey, group.label), `collection:${group.primary}`]),
      ]
      const seen = new Map<string, string>()
      for (const [name, path] of names) {
        const normalized = name.trim().toLocaleLowerCase()
        expect(seen.get(normalized), `${name}: ${path}`).toBeUndefined()
        seen.set(normalized, path)
      }
    }
  })

  it('uses a distinct glyph for every destination, section, and collection', () => {
    const entries = [
      ...navSections.flatMap(section => section.items.map(item => [item.to, item.icon] as const)),
      ...navSections.map(section => [`section:${section.title}`, SIDEBAR_SECTION_ICONS[section.title]] as const),
      ...groups.map(group => [`collection:${group.primary}`, SIDEBAR_COLLECTION_ICONS[group.primary]] as const),
    ]
    expect(entries.filter(([, icon]) => !icon).map(([path]) => path)).toEqual([])
    const seen = new Map<unknown, string>()
    const repeated = entries.flatMap(([path, icon]) => {
      const previous = seen.get(icon)
      seen.set(icon, path)
      return previous ? [`${previous}, ${path}`] : []
    })
    expect(repeated).toEqual([])
  })

  it('uses each registered catalog destination at most once and leaves every route discoverable', () => {
    const paths = groups.flatMap(group => group.pages.map(page => page.to))
    const registered = new Set(ROUTE_REGISTRY.map(route => route.path))
    expect(new Set(paths).size).toBe(paths.length)
    expect(COLLECTION_DEFINITIONS.flatMap(group => group.paths).every(path => catalogPaths.includes(path))).toBe(true)
    expect(paths.every(path => registered.has(path))).toBe(true)
    expect(groups.flatMap(group => group.pages).every(page => page.icon)).toBe(true)
    expect(groups.every(group => group.pages[0].to === group.primary)).toBe(true)
    const rendered = collectionSidebarSections(navSections, groups).flatMap(section => section.items.map(item => item.to))
    for (const path of catalogPaths) {
      expect(rendered, `missing ${path}`).toContain(collectionPrimaryPath(groups, path))
    }
    expect(navSections.flatMap(section => section.items.map(item => item.to))).toEqual(catalogPaths)
  })

  it('never leaks a hidden child into a collection', () => {
    const sections = navSections.map(section => ({
      ...section,
      items: section.items.filter(item => item.to !== '/vehicle-comparison' && item.to !== '/account/2fa'),
    }))
    const visible = collectionGroups(sections).flatMap(group => group.pages.map(page => page.to))
    expect(visible).not.toContain('/vehicle-comparison')
    expect(visible).not.toContain('/account/2fa')
  })

  it('moves pinned collection pages into Quick access without duplicating their names', () => {
    const group = groups.find(candidate => candidate.primary === '/driving-dynamics')!
    const pinned = new Set(['/driving-dynamics', '/drive-dna'])
    expect(collectionSidebarSections(navSections, groups).find(section =>
      section.items.some(item => item.to === '/driving-dynamics'),
    )).toBeDefined()
    render(
      <MemoryRouter>
        <CollectionTreeRow group={group} pathname="/driving-dynamics" pinnedPaths={pinned} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'Driving Performance, 5 views' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Driving Dynamics' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Drive DNA' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Regen Braking' })).toBeInTheDocument()
  })

  it('keeps Charging Overview first in Charging Activity even when pinned', () => {
    const group = groups.find(candidate => candidate.primary === '/charging')!
    const chargingSection = collectionSidebarSections(navSections, groups).find(section => section.title === 'Charging')!
    expect(unpinnedSidebarItems(chargingSection.items, groups, new Set(group.pages.map(page => page.to))))
      .toContainEqual(expect.objectContaining({ to: '/charging' }))
    expect(quickAccessSidebarItems(group.pages.slice(0, 2), groups).map(page => page.to))
      .toEqual(['/tesla-charging-history'])

    render(
      <MemoryRouter initialEntries={['/charging']}>
        <CollectionTreeRow group={group} pathname="/charging" pinnedPaths={new Set(['/charging'])} />
      </MemoryRouter>,
    )
    const activity = screen.getByRole('group', { name: 'Charging Activity' })
    expect(within(activity).getAllByRole('link')[0]).toHaveAttribute('href', '/charging')
    expect(within(activity).getByRole('link', { name: 'Charging Overview' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Charging Activity, 6 views' })).toBeInTheDocument()
  })

  it('uses distinct icons for sibling destinations', () => {
    const repeated = groups.flatMap(group => {
      const seen = new Map<unknown, string>()
      return group.pages.flatMap(page => {
        const previous = seen.get(page.icon)
        seen.set(page.icon, page.to)
        return previous ? [`${group.label}: ${previous}, ${page.to}`] : []
      })
    })
    expect(repeated).toEqual([])
  })

  it('lists pages directly when a section has only one collection', () => {
    const sections = collectionSidebarSections(navSections, groups)
    const commands = sections.find(section => section.title === 'Commands')
    expect(commands).toBeDefined()
    const group = soleCollection(commands!, groups)
    expect(group?.pages.map(page => page.to)).toEqual(['/commands', '/command-history', '/command-reliability'])
    render(
      <MemoryRouter>
        <CollectionTreeRow group={group!} pathname="/commands" flattened statusCount={2} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: 'Commands, 3 views' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Send Commands' })).toHaveAttribute('href', '/commands')
    expect(screen.getByRole('link', { name: 'Command History' })).toHaveAttribute('href', '/command-history')
    expect(screen.getByRole('link', { name: 'Command Reliability' })).toHaveAttribute('href', '/command-reliability')
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(soleCollection(sections.find(section => section.title === 'Charging')!, groups)).toBeUndefined()
  })

  it('opens the active group inline and switches between original routes without a detour', async () => {
    const group = groups.find(candidate => candidate.primary === '/driving-dynamics')
    expect(group).toBeDefined()
    function Collection() {
      const { pathname } = useLocation()
      return <CollectionTreeRow group={group!} pathname={pathname} />
    }
    render(
      <MemoryRouter initialEntries={['/driving-dynamics']}>
        <Collection />
        <CurrentPath />
      </MemoryRouter>,
    )
    const button = screen.getByRole('button', { name: /Driving Performance, 7 views/ })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).not.toHaveTextContent('views')
    expect(within(button).getByText('7')).toBeInTheDocument()
    expect(button.querySelectorAll('svg')).toHaveLength(2)
    const groupIcon = button.querySelectorAll('svg')[1]
    const primaryIcon = screen.getByRole('link', { name: 'Driving Dynamics' }).querySelector('svg')
    expect(groupIcon?.innerHTML).not.toBe(primaryIcon?.innerHTML)
    expect(within(screen.getByRole('group', { name: 'Driving Performance' })).getByRole('link', { name: 'Drive DNA' }))
      .toHaveAttribute('href', '/drive-dna')
    expect(screen.getByRole('link', { name: 'Drive DNA' }).querySelector('svg')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Drive DNA' }))
    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/drive-dna'))
    expect(screen.getByRole('link', { name: 'Drive DNA' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('link', { name: 'Regen Braking' }))
    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/regen-efficiency'))
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(screen.getByRole('link', { name: 'Drive DNA' })).toBeInTheDocument()
  })
})
