// Co-located unit tests for the unsaved-changes navigation guards.
//
// Covers both exports — <GuardedLink> and <GuardedNavLink> — across the full
// decision tree of their shared click handler:
//
//   - plain in-app click: suppresses the browser default, consults the guard,
//     and only performs the SPA navigation (forwarding replace/state/relative)
//     when the guard resolves true;
//   - guard resolves false: navigation is cancelled, current route stays put;
//   - a caller onClick runs first and can pre-empt the guard via preventDefault;
//   - native escape hatches (modifier / middle / target!=_self clicks) bypass
//     the guard entirely so the browser opens the new tab/window itself;
//   - <GuardedNavLink> preserves NavLink's function-as-children (isActive) and
//     function-as-className APIs.
//
// react-router's useNavigate is mocked to a spy so we can assert the exact
// (to, options) tuple; the guard context is mocked so each test drives the
// confirm outcome deterministically without mounting the full provider tree.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  confirmIfDirty: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mocks.navigate }
})

vi.mock('./NavigationGuardProvider', () => ({
  useNavigationGuardContext: () => ({
    confirmIfDirty: mocks.confirmIfDirty,
    register: () => () => {},
  }),
}))

import { GuardedLink, GuardedNavLink } from './GuardedLink'

function renderAt(ui: ReactElement, path = '/start') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)
}

/** Let the internal `confirmIfDirty().then(...)` microtask settle. */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  mocks.navigate.mockReset()
  mocks.confirmIfDirty.mockReset()
  // Default: no unsaved changes → guard immediately allows navigation.
  mocks.confirmIfDirty.mockResolvedValue(true)
})

describe('GuardedLink', () => {
  it('renders an accessible anchor pointing at the resolved href', () => {
    renderAt(<GuardedLink to="/dest">Go</GuardedLink>)
    const link = screen.getByRole('link', { name: 'Go' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/dest')
  })

  it('navigates via the SPA router (forwarding replace/state/relative) once the guard allows it', async () => {
    renderAt(
      <GuardedLink to="/dest" replace state={{ from: 'garage' }} relative="path">
        Go
      </GuardedLink>,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Go' }))

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/dest', {
        replace: true,
        state: { from: 'garage' },
        relative: 'path',
      }),
    )
    // preventDefault must suppress react-router's own click handler, so our
    // explicit navigate is the ONLY one — never a double navigation.
    expect(mocks.navigate).toHaveBeenCalledTimes(1)
    expect(mocks.confirmIfDirty).toHaveBeenCalledTimes(1)
  })

  it('cancels navigation when the guard resolves false (user chose "keep editing")', async () => {
    mocks.confirmIfDirty.mockResolvedValue(false)
    renderAt(<GuardedLink to="/dest">Go</GuardedLink>)

    fireEvent.click(screen.getByRole('link', { name: 'Go' }))
    await waitFor(() => expect(mocks.confirmIfDirty).toHaveBeenCalledTimes(1))
    await flushMicrotasks()

    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('supports an object "to" value', async () => {
    renderAt(<GuardedLink to={{ pathname: '/dest', search: '?a=1' }}>Go</GuardedLink>)
    const link = screen.getByRole('link', { name: 'Go' })
    expect(link).toHaveAttribute('href', '/dest?a=1')

    fireEvent.click(link)
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith(
        { pathname: '/dest', search: '?a=1' },
        { replace: undefined, state: undefined, relative: undefined },
      ),
    )
  })

  it('invokes a caller-supplied onClick before consulting the guard', async () => {
    const onClick = vi.fn()
    renderAt(
      <GuardedLink to="/dest" onClick={onClick}>
        Go
      </GuardedLink>,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Go' }))

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick.mock.calls[0][0]).toMatchObject({ type: 'click' })
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1))
  })

  it('yields to a caller onClick that calls preventDefault (no guard prompt, no navigation)', async () => {
    const onClick = vi.fn((e: ReactMouseEvent<HTMLAnchorElement>) => {
      e.preventDefault()
    })
    renderAt(
      <GuardedLink to="/dest" onClick={onClick}>
        Go
      </GuardedLink>,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Go' }))
    await flushMicrotasks()

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(mocks.confirmIfDirty).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  const modifierCases: Array<[string, MouseEventInit]> = [
    ['ctrl-click (background tab)', { ctrlKey: true }],
    ['meta/cmd-click (background tab, macOS)', { metaKey: true }],
    ['shift-click (new window)', { shiftKey: true }],
    ['alt-click (download)', { altKey: true }],
  ]

  it.each(modifierCases)(
    'bypasses the guard for a %s so the browser handles it natively',
    async (_label, init) => {
      renderAt(<GuardedLink to="/dest">Go</GuardedLink>)
      fireEvent.click(screen.getByRole('link', { name: 'Go' }), init)
      await flushMicrotasks()

      expect(mocks.confirmIfDirty).not.toHaveBeenCalled()
      expect(mocks.navigate).not.toHaveBeenCalled()
    },
  )

  it('bypasses the guard for non-primary (middle) button clicks', async () => {
    renderAt(<GuardedLink to="/dest">Go</GuardedLink>)
    fireEvent.click(screen.getByRole('link', { name: 'Go' }), { button: 1 })
    await flushMicrotasks()

    expect(mocks.confirmIfDirty).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('bypasses the guard when target opens outside the current tab (target="_blank")', async () => {
    renderAt(
      <GuardedLink to="/dest" target="_blank">
        Go
      </GuardedLink>,
    )
    const link = screen.getByRole('link', { name: 'Go' })
    expect(link).toHaveAttribute('target', '_blank')

    fireEvent.click(link)
    await flushMicrotasks()

    expect(mocks.confirmIfDirty).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('still guards a same-tab click (target="_self")', async () => {
    renderAt(
      <GuardedLink to="/dest" target="_self">
        Go
      </GuardedLink>,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Go' }))

    await waitFor(() => expect(mocks.confirmIfDirty).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1))
  })
})

describe('GuardedNavLink', () => {
  it('applies the same guard semantics — navigates on confirm', async () => {
    renderAt(<GuardedNavLink to="/dest">NavGo</GuardedNavLink>)
    fireEvent.click(screen.getByRole('link', { name: 'NavGo' }))

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/dest', {
        replace: undefined,
        state: undefined,
        relative: undefined,
      }),
    )
    expect(mocks.navigate).toHaveBeenCalledTimes(1)
  })

  it('cancels navigation when the guard resolves false', async () => {
    mocks.confirmIfDirty.mockResolvedValue(false)
    renderAt(<GuardedNavLink to="/dest">NavGo</GuardedNavLink>)

    fireEvent.click(screen.getByRole('link', { name: 'NavGo' }))
    await waitFor(() => expect(mocks.confirmIfDirty).toHaveBeenCalledTimes(1))
    await flushMicrotasks()

    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('preserves the function-as-children (isActive) API', () => {
    renderAt(
      <GuardedNavLink to="/dest">
        {({ isActive }) => (
          <span data-testid="nav-child">{isActive ? 'active' : 'inactive'}</span>
        )}
      </GuardedNavLink>,
      '/other',
    )
    // Current route is /other, so the /dest link is not active.
    expect(screen.getByTestId('nav-child')).toHaveTextContent('inactive')
  })

  it('preserves the function-as-className API and still bypasses the guard on modifier-click', async () => {
    renderAt(
      <GuardedNavLink to="/dest" className={({ isActive }) => (isActive ? 'on' : 'off')}>
        NavGo
      </GuardedNavLink>,
    )
    const link = screen.getByRole('link', { name: 'NavGo' })
    expect(link).toHaveClass('off')

    fireEvent.click(link, { ctrlKey: true })
    await flushMicrotasks()
    expect(mocks.confirmIfDirty).not.toHaveBeenCalled()
  })
})
