import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/lib/routePrefetch', () => {
  const prefetchRoute = vi.fn()
  const cancellers: Array<ReturnType<typeof vi.fn>> = []
  const schedulePrefetch = vi.fn(() => {
    const cancel = vi.fn()
    cancellers.push(cancel)
    return cancel
  })
  return {
    prefetchRoute,
    schedulePrefetch,
    __cancellers: cancellers,
    TOUCH_INTENT_PREFETCH_DELAY_MS: 120,
  }
})

import { PrefetchLink, PrefetchNavLink } from '../PrefetchLink'
import { prefetchRoute, schedulePrefetch } from '@/lib/routePrefetch'
import * as routePrefetch from '@/lib/routePrefetch'

const mockedPrefetch = vi.mocked(prefetchRoute)
const mockedSchedule = vi.mocked(schedulePrefetch)
const cancellers = (
  routePrefetch as unknown as {
    __cancellers: Array<ReturnType<typeof vi.fn>>
  }
).__cancellers

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

beforeEach(() => {
  mockedPrefetch.mockClear()
  mockedSchedule.mockClear()
  cancellers.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PrefetchLink', () => {
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
    expect(mockedSchedule).not.toHaveBeenCalled()
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

  it('prefetches immediately for a mouse pointerdown (hover already proved intent)', () => {
    renderLink('/timeline')
    fireEvent.pointerDown(screen.getByRole('link'), { pointerType: 'mouse' })
    expect(mockedPrefetch).toHaveBeenCalledWith('/timeline')
    expect(mockedSchedule).not.toHaveBeenCalled()
  })

  it('schedules — rather than fires — a touch pointerdown so scrolls can cancel it', () => {
    renderLink('/timeline')
    fireEvent.pointerDown(screen.getByRole('link'), { pointerType: 'touch' })
    expect(mockedSchedule).toHaveBeenCalledTimes(1)
    expect(mockedSchedule).toHaveBeenCalledWith('/timeline')
    expect(mockedPrefetch).not.toHaveBeenCalled()
  })

  it('schedules for pen input too', () => {
    renderLink('/timeline')
    fireEvent.pointerDown(screen.getByRole('link'), { pointerType: 'pen' })
    expect(mockedSchedule).toHaveBeenCalledWith('/timeline')
  })

  it('cancels a pending touch intent on pointerup', () => {
    renderLink('/timeline')
    const link = screen.getByRole('link')
    fireEvent.pointerDown(link, { pointerType: 'touch' })
    fireEvent.pointerUp(link, { pointerType: 'touch' })
    expect(cancellers).toHaveLength(1)
    expect(cancellers[0]).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending touch intent on pointercancel (scroll takeover)', () => {
    renderLink('/timeline')
    const link = screen.getByRole('link')
    fireEvent.pointerDown(link, { pointerType: 'touch' })
    fireEvent.pointerCancel(link, { pointerType: 'touch' })
    expect(cancellers[0]).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending touch intent when the pointer leaves the link', () => {
    renderLink('/timeline')
    const link = screen.getByRole('link')
    fireEvent.pointerDown(link, { pointerType: 'touch' })
    fireEvent.pointerLeave(link, { pointerType: 'touch' })
    expect(cancellers[0]).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending touch intent on unmount so it cannot resolve late', () => {
    const view = renderLink('/timeline')
    fireEvent.pointerDown(screen.getByRole('link'), { pointerType: 'touch' })
    expect(cancellers).toHaveLength(1)
    act(() => view.unmount())
    expect(cancellers[0]).toHaveBeenCalled()
  })

  it('never leaves two intents in flight for repeated pointerdowns', () => {
    renderLink('/timeline')
    const link = screen.getByRole('link')
    fireEvent.pointerDown(link, { pointerType: 'touch' })
    fireEvent.pointerDown(link, { pointerType: 'touch' })
    // The first intent is cancelled before the second is scheduled.
    expect(cancellers[0]).toHaveBeenCalledTimes(1)
    expect(cancellers[1]).not.toHaveBeenCalled()
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

  it('forwards user-supplied pointer handlers alongside the intent wiring', () => {
    const onPointerDown = vi.fn()
    const onPointerUp = vi.fn()
    renderLink('/battery', { onPointerDown, onPointerUp })
    const link = screen.getByRole('link')
    fireEvent.pointerDown(link, { pointerType: 'touch' })
    fireEvent.pointerUp(link, { pointerType: 'touch' })
    expect(onPointerDown).toHaveBeenCalledTimes(1)
    expect(onPointerUp).toHaveBeenCalledTimes(1)
    expect(mockedSchedule).toHaveBeenCalledTimes(1)
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
  it('prefetches active-state navigation destinations on hover and focus', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <PrefetchNavLink to="/battery">Battery</PrefetchNavLink>
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: 'Battery' })
    fireEvent.mouseEnter(link)
    fireEvent.focus(link)

    expect(mockedPrefetch).toHaveBeenNthCalledWith(1, '/battery')
    expect(mockedPrefetch).toHaveBeenNthCalledWith(2, '/battery')
  })

  it('uses the same cancellable touch-intent path as PrefetchLink', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <PrefetchNavLink to="/battery">Battery</PrefetchNavLink>
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: 'Battery' })
    fireEvent.pointerDown(link, { pointerType: 'touch' })
    expect(mockedSchedule).toHaveBeenCalledWith('/battery')
    fireEvent.pointerCancel(link, { pointerType: 'touch' })
    expect(cancellers[0]).toHaveBeenCalledTimes(1)
  })
})
