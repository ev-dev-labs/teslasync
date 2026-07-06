/**
 * TourLauncher tests.
 *
 * The launcher is an event-driven modal (it deliberately exposes no `open`
 * prop): it mounts hidden and pops open in response to the global
 * TOUR_OPEN_LAUNCHER_EVENT. These tests drive it exclusively through that
 * public contract and exercise every branch of the single exported component:
 *
 *   1. Hidden until the open event; opening records the "list seen" flag.
 *   2. Renders one row per registered tour with its title + description.
 *   3. Highlights the tour recommended for the current route (badge + primary
 *      CTA) and threads location.pathname into the registry predicate.
 *   4. Completed tours show a "Completed" badge and a "Replay" CTA; pending
 *      tours show "Start".
 *   5. Starting a tour closes the modal and dispatches the start event on the
 *      NEXT tick (never synchronously — the spotlight needs the portal gone).
 *   6. "Reset all tours" clears completion and live-refreshes the badges.
 *   7. An empty registry renders an explicit empty state, not a blank list.
 *   8. A TOUR_START_EVENT from another surface refreshes the completion badges.
 *
 * The tour registry is mocked so the tour list, completion state, and route
 * recommendation are deterministic, and the side-effecting helpers
 * (markTourListSeen / resetAllTours / dispatchTourStart) can be asserted as
 * spies. The real event-name constants are preserved (via importActual) so the
 * window events the component subscribes to are dispatched with identical
 * names. `@testing-library/user-event` is intentionally NOT used — it is not a
 * dependency of this repo (see the sibling OnboardingResources.test.tsx note),
 * so interactions go through `fireEvent`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Registry mock ───────────────────────────────────────────────────────────
// A tiny in-memory completion store lets resetAllTours() actually clear the
// badges so the forced-re-render path can be asserted end-to-end.
const {
  completedIds,
  listToursMock,
  isTourCompletedMock,
  isRecommendedForRouteMock,
  markTourListSeenMock,
  resetAllToursMock,
  dispatchTourStartMock,
} = vi.hoisted(() => {
  const completedIds = new Set<string>()
  return {
    completedIds,
    listToursMock: vi.fn(),
    isTourCompletedMock: vi.fn((id: string) => completedIds.has(id)),
    isRecommendedForRouteMock: vi.fn(),
    markTourListSeenMock: vi.fn(),
    resetAllToursMock: vi.fn(() => completedIds.clear()),
    dispatchTourStartMock: vi.fn(),
  }
})

vi.mock('@/lib/tourRegistry', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/tourRegistry')>('@/lib/tourRegistry')
  return {
    ...actual,
    listTours: listToursMock,
    isTourCompleted: isTourCompletedMock,
    isRecommendedForRoute: isRecommendedForRouteMock,
    markTourListSeen: markTourListSeenMock,
    resetAllTours: resetAllToursMock,
    dispatchTourStart: dispatchTourStartMock,
  }
})

// Deterministic i18n: echo the inline English fallback and apply {{var}}
// interpolation so the aria-labels ("Start tour: {{title}}") assert cleanly
// without depending on which translation bundle is loaded.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
        let out = typeof fallback === 'string' ? fallback : _key
        if (opts && typeof opts === 'object') {
          for (const [k, v] of Object.entries(opts)) {
            out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v))
          }
        }
        return out
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import { TourLauncher } from './TourLauncher'
import {
  TOUR_OPEN_LAUNCHER_EVENT,
  TOUR_START_EVENT,
  type TourDefinition,
} from '@/lib/tourRegistry'

function makeTour(overrides: Partial<TourDefinition> & { id: string }): TourDefinition {
  return {
    routeMatch: `/${overrides.id}`,
    titleKey: `tour.${overrides.id}.title`,
    titleFallback: `${overrides.id} tour`,
    descriptionKey: `tour.${overrides.id}.desc`,
    descriptionFallback: `${overrides.id} description`,
    version: 1,
    steps: [],
    ...overrides,
  }
}

const MAIN = makeTour({
  id: 'main',
  titleFallback: 'Main tour',
  descriptionFallback: 'Dashboard walkthrough',
})
const DRIVES = makeTour({
  id: 'drives',
  titleFallback: 'Drives tour',
  descriptionFallback: 'Drive analytics',
})
const CHARGING = makeTour({
  id: 'charging',
  titleFallback: 'Charging tour',
  descriptionFallback: 'Charging sessions',
})

function renderLauncher(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <TourLauncher />
    </MemoryRouter>,
  )
}

function openLauncher() {
  act(() => {
    window.dispatchEvent(new CustomEvent(TOUR_OPEN_LAUNCHER_EVENT))
  })
}

/** The visible footer "Close" (the Modal header X shares the same name). */
function footerCloseButton(): HTMLButtonElement {
  const btn = screen.getByText('Close').closest('button')
  if (!btn) throw new Error('footer Close button not found')
  return btn as HTMLButtonElement
}

beforeEach(() => {
  // Clears call history but preserves the vi.fn factory implementations
  // (isTourCompleted → completedIds, resetAllTours → completedIds.clear).
  vi.clearAllMocks()
  completedIds.clear()
  listToursMock.mockReturnValue([MAIN, DRIVES, CHARGING])
  isTourCompletedMock.mockImplementation((id: string) => completedIds.has(id))
  isRecommendedForRouteMock.mockReturnValue(false)
  resetAllToursMock.mockImplementation(() => completedIds.clear())
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TourLauncher', () => {
  it('stays hidden until the open event fires, then records the list as seen', () => {
    renderLauncher()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(markTourListSeenMock).not.toHaveBeenCalled()

    openLauncher()

    expect(screen.getByRole('dialog', { name: 'Take a tour' })).toBeInTheDocument()
    expect(markTourListSeenMock).toHaveBeenCalledTimes(1)
  })

  it('renders one row per registered tour with its title and description', () => {
    renderLauncher()
    openLauncher()

    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(
      screen.getByRole('heading', { name: 'Main tour', level: 3 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Dashboard walkthrough')).toBeInTheDocument()
    expect(screen.getByText('Drive analytics')).toBeInTheDocument()
    expect(screen.getByText('Charging sessions')).toBeInTheDocument()
  })

  it('highlights the tour recommended for the current route and threads the pathname', () => {
    isRecommendedForRouteMock.mockImplementation(
      (def: TourDefinition, pathname: string) =>
        def.id === 'drives' && pathname === '/drives',
    )

    renderLauncher('/drives')
    openLauncher()

    // The predicate is consulted with the live location pathname.
    expect(isRecommendedForRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'drives' }),
      '/drives',
    )

    // Exactly one row carries the recommendation badge.
    expect(screen.getAllByText('Recommended for this page')).toHaveLength(1)

    // The recommended CTA is promoted to the primary variant; others stay ghost.
    const recommendedCta = screen.getByRole('button', { name: 'Start tour: Drives tour' })
    expect(recommendedCta.className).toContain('bg-[var(--theme-primary)]')
    const otherCta = screen.getByRole('button', { name: 'Start tour: Main tour' })
    expect(otherCta.className).not.toContain('bg-[var(--theme-primary)]')
  })

  it('marks completed tours with a badge + Replay action and pending ones with Start', () => {
    completedIds.add('main')

    renderLauncher()
    openLauncher()

    expect(screen.getByText('Completed')).toBeInTheDocument()
    // Completed → Replay CTA with a replay-specific accessible name.
    expect(
      screen.getByRole('button', { name: 'Replay tour: Main tour' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Start tour: Main tour' }),
    ).not.toBeInTheDocument()
    // Pending tours still say Start.
    expect(
      screen.getByRole('button', { name: 'Start tour: Drives tour' }),
    ).toBeInTheDocument()
  })

  it('closes the modal and dispatches the start event on the next tick, never synchronously', () => {
    vi.useFakeTimers()
    renderLauncher()
    openLauncher()

    fireEvent.click(screen.getByRole('button', { name: 'Start tour: Drives tour' }))

    // Modal closes immediately; the dispatch is deferred so the portal is gone
    // before the spotlight queries its target.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(dispatchTourStartMock).not.toHaveBeenCalled()

    act(() => {
      vi.runAllTimers()
    })

    expect(dispatchTourStartMock).toHaveBeenCalledTimes(1)
    expect(dispatchTourStartMock).toHaveBeenCalledWith('drives')
  })

  it('reset-all clears completion and live-refreshes the badges', () => {
    completedIds.add('main')

    renderLauncher()
    openLauncher()
    expect(screen.getByText('Completed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reset all tours' }))

    expect(resetAllToursMock).toHaveBeenCalledTimes(1)
    // The forced re-render picks up the freshly-cleared completion state.
    expect(screen.queryByText('Completed')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Start tour: Main tour' }),
    ).toBeInTheDocument()
  })

  it('renders an explicit empty state when no tours are registered', () => {
    listToursMock.mockReturnValue([])

    renderLauncher()
    openLauncher()

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('No tours are available yet.')
  })

  it('closes when the footer Close button is pressed', () => {
    renderLauncher()
    openLauncher()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(footerCloseButton())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('refreshes completion badges when a tour-start event fires from another surface', () => {
    renderLauncher()
    openLauncher()
    expect(
      screen.getByRole('button', { name: 'Start tour: Main tour' }),
    ).toBeInTheDocument()

    // Simulate the main tour completing elsewhere (command palette) then
    // broadcasting the shared start event.
    completedIds.add('main')
    act(() => {
      window.dispatchEvent(new CustomEvent(TOUR_START_EVENT, { detail: { id: 'main' } }))
    })

    expect(
      screen.getByRole('button', { name: 'Replay tour: Main tour' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })
})
