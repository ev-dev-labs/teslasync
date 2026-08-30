import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'

// Mock framer-motion: render children immediately, ignore animation props,
// and let tests drive useReducedMotion deterministically. framer-motion v12
// caches matchMedia at module load — mocking the export is the canonical
// pattern (see hooks/__tests__/useMotionPreference.test.ts).
const reducedMotionMock = vi.fn<() => boolean | null>(() => false)
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, transition, initial: _i, animate: _a, exit: _e, ...rest }: any) => (
      <div data-duration={transition?.duration} {...filterDomProps(rest)}>
        {children}
      </div>
    ),
  },
  useReducedMotion: () => reducedMotionMock(),
}))

function filterDomProps(props: Record<string, any>) {
  const { variants: _v, layoutId: _l, ...rest } = props
  return rest
}

import { RouteTransition } from '../RouteTransition'

function PageA() { return <div>page-a</div> }
function PageB() { return <div>page-b</div> }
function DriveDetail() { return <div>drive-detail</div> }
function DrivesList() { return <div>drives-list</div> }

function renderAt(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <RouteTransition>
        <Routes>
          <Route path="/" element={<PageA />} />
          <Route path="/b" element={<PageB />} />
          <Route path="/drives" element={<DrivesList />} />
          <Route path="/drives/:id" element={<DriveDetail />} />
        </Routes>
      </RouteTransition>
    </MemoryRouter>,
  )
}

describe('RouteTransition', () => {
  beforeEach(() => {
    reducedMotionMock.mockReset()
    reducedMotionMock.mockReturnValue(false)
  })

  it('renders children for the current route', () => {
    renderAt(['/'])
    expect(screen.getByText('page-a')).toBeInTheDocument()
  })

  it('uses 120ms duration by default', () => {
    const { container } = renderAt(['/'])
    const wrapper = container.querySelector('[data-duration]') as HTMLElement
    expect(wrapper).not.toBeNull()
    // 120ms expressed in seconds for framer-motion's transition.duration
    expect(Number(wrapper.dataset.duration)).toBeCloseTo(0.12, 5)
  })

  it('collapses duration to 0 when prefers-reduced-motion: reduce', () => {
    reducedMotionMock.mockReturnValue(true)
    const { container } = renderAt(['/'])
    const wrapper = container.querySelector('[data-duration]') as HTMLElement
    expect(Number(wrapper.dataset.duration)).toBe(0)
  })

  it('skips animation when navigating into a list-detail route (default skip pattern)', () => {
    function Trigger() {
      const navigate = useNavigate()
      useEffect(() => { navigate('/drives/123') }, [navigate])
      return null
    }
    const { container } = render(
      <MemoryRouter initialEntries={['/drives']}>
        <RouteTransition>
          <Routes>
            <Route path="/drives" element={<DrivesList />} />
            <Route path="/drives/:id" element={<DriveDetail />} />
          </Routes>
        </RouteTransition>
        <Trigger />
      </MemoryRouter>,
    )
    // After navigation, current path matches `/drives/:id` → skip animation.
    expect(screen.getByText('drive-detail')).toBeInTheDocument()
    const wrapper = container.querySelector('[data-duration]') as HTMLElement
    expect(Number(wrapper.dataset.duration)).toBe(0)
  })

  it('animates regular page-to-page navigation', () => {
    const { container } = renderAt(['/b'])
    const wrapper = container.querySelector('[data-duration]') as HTMLElement
    // /b doesn't match a skip pattern → animate.
    expect(Number(wrapper.dataset.duration)).toBeCloseTo(0.12, 5)
  })

  it('honours custom skipPattern overrides', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/b']}>
        <RouteTransition skipPattern={['/b']}>
          <Routes>
            <Route path="/b" element={<PageB />} />
          </Routes>
        </RouteTransition>
      </MemoryRouter>,
    )
    const wrapper = container.querySelector('[data-duration]') as HTMLElement
    expect(Number(wrapper.dataset.duration)).toBe(0)
  })

  // Suppress an unused-import warning for `act` while keeping it available
  // for future timing-sensitive cases.
  it('exports act helper for follow-up tests', () => { expect(typeof act).toBe('function') })
})
