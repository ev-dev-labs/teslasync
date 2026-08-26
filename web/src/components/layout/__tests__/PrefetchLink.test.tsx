import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/lib/routePrefetch', () => ({
  prefetchRoute: vi.fn(),
}))

import { PrefetchLink, PrefetchNavLink } from '../PrefetchLink'
import { prefetchRoute } from '@/lib/routePrefetch'

const mockedPrefetch = vi.mocked(prefetchRoute)

const renderLink = (
  to: string | { pathname: string },
  extraProps: Partial<React.ComponentProps<typeof PrefetchLink>> = {},
) =>
  render(
    <MemoryRouter>
      <PrefetchLink to={to} {...extraProps}>
        Battery
      </PrefetchLink>
    </MemoryRouter>,
  )

describe('PrefetchLink', () => {
  beforeEach(() => {
    mockedPrefetch.mockClear()
  })

  it('renders an anchor with the correct href', () => {
    renderLink('/battery')
    const link = screen.getByRole('link', { name: 'Battery' })
    expect(link).toHaveAttribute('href', '/battery')
  })

  it('renders an anchor for object-style `to` prop', () => {
    renderLink({ pathname: '/drives' })
    const link = screen.getByRole('link', { name: 'Battery' })
    expect(link).toHaveAttribute('href', '/drives')
  })

  it('does not call prefetchRoute on initial render', () => {
    renderLink('/battery')
    expect(mockedPrefetch).not.toHaveBeenCalled()
  })

  it('calls prefetchRoute with the destination path on mouseenter', () => {
    renderLink('/battery')
    fireEvent.mouseEnter(screen.getByRole('link'))
    expect(mockedPrefetch).toHaveBeenCalledTimes(1)
    expect(mockedPrefetch).toHaveBeenCalledWith('/battery')
  })

  it('calls prefetchRoute with the destination path on focus', () => {
    renderLink('/drives')
    fireEvent.focus(screen.getByRole('link'))
    expect(mockedPrefetch).toHaveBeenCalledTimes(1)
    expect(mockedPrefetch).toHaveBeenCalledWith('/drives')
  })

  it('calls prefetchRoute on pointerdown for touch and pen navigation', () => {
    renderLink('/timeline')
    fireEvent.pointerDown(screen.getByRole('link'), { pointerType: 'touch' })
    expect(mockedPrefetch).toHaveBeenCalledTimes(1)
    expect(mockedPrefetch).toHaveBeenCalledWith('/timeline')
  })

  it('calls prefetchRoute with the pathname when `to` is an object', () => {
    renderLink({ pathname: '/charging' })
    fireEvent.mouseEnter(screen.getByRole('link'))
    expect(mockedPrefetch).toHaveBeenCalledWith('/charging')
  })

  it('forwards user-supplied onMouseEnter alongside prefetch', () => {
    const userHandler = vi.fn()
    renderLink('/battery', { onMouseEnter: userHandler })
    fireEvent.mouseEnter(screen.getByRole('link'))
    expect(userHandler).toHaveBeenCalledTimes(1)
    expect(mockedPrefetch).toHaveBeenCalledTimes(1)
  })

  it('forwards user-supplied onFocus alongside prefetch', () => {
    const userHandler = vi.fn()
    renderLink('/battery', { onFocus: userHandler })
    fireEvent.focus(screen.getByRole('link'))
    expect(userHandler).toHaveBeenCalledTimes(1)
    expect(mockedPrefetch).toHaveBeenCalledTimes(1)
  })

  it('forwards user-supplied onPointerDown alongside prefetch', () => {
    const userHandler = vi.fn()
    renderLink('/battery', { onPointerDown: userHandler })
    fireEvent.pointerDown(screen.getByRole('link'))
    expect(userHandler).toHaveBeenCalledTimes(1)
    expect(mockedPrefetch).toHaveBeenCalledTimes(1)
  })

  it('passes additional props through to the underlying anchor', () => {
    renderLink('/battery', {
      'aria-label': 'Battery health',
      className: 'custom-class',
    } as Partial<React.ComponentProps<typeof PrefetchLink>>)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('aria-label', 'Battery health')
    expect(link).toHaveClass('custom-class')
  })
})

describe('PrefetchNavLink', () => {
  beforeEach(() => {
    mockedPrefetch.mockClear()
  })

  it('prefetches active-state navigation destinations on intent', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <PrefetchNavLink to="/battery">Battery</PrefetchNavLink>
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: 'Battery' })
    fireEvent.mouseEnter(link)
    fireEvent.focus(link)
    fireEvent.pointerDown(link)

    expect(mockedPrefetch).toHaveBeenNthCalledWith(1, '/battery')
    expect(mockedPrefetch).toHaveBeenNthCalledWith(2, '/battery')
    expect(mockedPrefetch).toHaveBeenNthCalledWith(3, '/battery')
  })
})
