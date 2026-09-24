import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { navSections } from '../Layout'
import { ROUTE_REGISTRY } from '@/lib/routeRegistry'
import { Icons } from '@/lib/icons'
import { CollectionTreeRow } from './CollectionTreeRow'
import { COLLECTION_DEFINITIONS, collectionGroups, collectionPrimaryPath, collectionSidebarSections } from './collections'

function CurrentPath() {
  return <span data-testid="current-path">{useLocation().pathname}</span>
}

describe('sidebar collections', () => {
  const groups = collectionGroups(navSections)
  const catalogPaths = navSections.flatMap(section => section.items.map(item => item.to))

  it('uses each registered catalog destination at most once and leaves every route discoverable', () => {
    const paths = groups.flatMap(group => group.pages.map(page => page.to))
    const registered = new Set(ROUTE_REGISTRY.map(route => route.path))
    expect(new Set(paths).size).toBe(paths.length)
    expect(COLLECTION_DEFINITIONS.flatMap(group => group.paths).every(path => catalogPaths.includes(path))).toBe(true)
    expect(paths.every(path => registered.has(path))).toBe(true)
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

  it('opens the active group inline and switches between original routes without a detour', async () => {
    const group = groups.find(candidate => candidate.primary === '/driving-dynamics')
    expect(group).toBeDefined()
    function Collection() {
      const { pathname } = useLocation()
      return <CollectionTreeRow group={group!} icon={Icons.drive} pathname={pathname} />
    }
    render(
      <MemoryRouter initialEntries={['/driving-dynamics']}>
        <Collection />
        <CurrentPath />
      </MemoryRouter>,
    )
    const button = screen.getByRole('button', { name: /Driving Dynamics, 7 views/ })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByRole('group', { name: 'Driving Dynamics' })).getByRole('link', { name: 'Drive DNA' }))
      .toHaveAttribute('href', '/drive-dna')
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
