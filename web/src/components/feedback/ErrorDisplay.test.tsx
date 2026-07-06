import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '@/i18n'
import { ApiError } from '@/lib/resilience'
import { ErrorDisplay } from './ErrorDisplay'

/**
 * ErrorDisplay branch contract.
 *
 * ErrorDisplay is the non-query sibling of QueryError: it maps a raw
 * `unknown` error onto actionable recovery copy + CTA per `ApiError.status`
 * (404 / 401·403 / 5xx / network·offline), plus a `compact` variant for
 * inline panel contexts. Each test forces one branch and asserts the right
 * title / message / action / a11y wiring. `useOnlineStatus` is stubbed so
 * the offline branch is deterministic; the real i18n bundle is loaded so we
 * assert on the actual English copy (mirrors QueryError.test).
 */

const ONLINE_MOCK = { value: true }

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => ONLINE_MOCK.value,
}))

function renderInRouter(ui: React.ReactNode, initialEntry = '/start') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/start" element={ui} />
        <Route path="/drives" element={<div data-testid="drives-list">drives list</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  ONLINE_MOCK.value = true
})

describe('ErrorDisplay', () => {
  it('renders nothing when the error is null/undefined', () => {
    const { container } = renderInRouter(<ErrorDisplay error={null} />)
    expect(container.querySelector('[role="alert"], [role="status"]')).toBeNull()
  })

  describe('404 Not Found', () => {
    it('renders "{resource} not found" with a Back-to-list CTA that navigates', async () => {
      renderInRouter(
        <ErrorDisplay
          error={new ApiError('not found', 404)}
          resourceName="Drive"
          listHref="/drives"
        />,
      )

      expect(screen.getByText('Drive not found')).toBeInTheDocument()
      expect(screen.getByText(/may have been deleted/i)).toBeInTheDocument()

      const cta = screen.getByRole('button', { name: /back to list/i })
      fireEvent.click(cta)
      await waitFor(() => {
        expect(screen.getByTestId('drives-list')).toBeInTheDocument()
      })
    })

    it('falls back to the generic "Resource not found" when resourceName is omitted', () => {
      renderInRouter(<ErrorDisplay error={new ApiError('gone', 404)} />)
      expect(screen.getByText('Resource not found')).toBeInTheDocument()
    })

    it('omits the Back-to-list CTA when listHref is not provided', () => {
      renderInRouter(<ErrorDisplay error={new ApiError('gone', 404)} resourceName="Drive" />)
      expect(screen.queryByRole('button', { name: /back to list/i })).toBeNull()
    })
  })

  describe('401 / 403 Unauthorized', () => {
    it('renders a Sign-in CTA on 401 and hands off to /login on click', () => {
      const origLocation = window.location
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...origLocation, href: 'http://localhost/start', assign: vi.fn() },
      })

      try {
        renderInRouter(<ErrorDisplay error={new ApiError('expired', 401)} />)
        expect(screen.getByText('Sign in required')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
        expect(window.location.href).toBe('/login')
      } finally {
        Object.defineProperty(window, 'location', { configurable: true, value: origLocation })
      }
    })

    it('renders the same Sign-in banner on 403', () => {
      renderInRouter(<ErrorDisplay error={new ApiError('forbidden', 403)} />)
      expect(screen.getByText('Sign in required')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    })
  })

  describe('5xx Server error', () => {
    it('renders the server-error title with a Retry CTA that calls onRetry', () => {
      const onRetry = vi.fn()
      renderInRouter(<ErrorDisplay error={new ApiError('boom', 500)} onRetry={onRetry} />)

      expect(screen.getByText('Server error')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /^retry$/i }))
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('also treats 503 as a server error', () => {
      renderInRouter(<ErrorDisplay error={new ApiError('unavailable', 503)} />)
      expect(screen.getByText('Server error')).toBeInTheDocument()
    })

    it('omits the Retry CTA when onRetry is not provided', () => {
      renderInRouter(<ErrorDisplay error={new ApiError('boom', 500)} />)
      expect(screen.queryByRole('button', { name: /^retry$/i })).toBeNull()
    })
  })

  describe('Network / unknown', () => {
    it('renders the connection-check copy inside an assertive alert when the error has no status', () => {
      renderInRouter(<ErrorDisplay error={new Error('boom')} />)

      const alert = screen.getByRole('alert')
      expect(alert).toHaveAttribute('aria-live', 'assertive')
      expect(screen.getByText("Can't reach server")).toBeInTheDocument()
      expect(screen.getByText(/check your internet connection/i)).toBeInTheDocument()
    })

    it('calls onRetry when the network-branch Retry CTA is clicked', () => {
      const onRetry = vi.fn()
      renderInRouter(<ErrorDisplay error={new Error('network down')} onRetry={onRetry} />)

      fireEvent.click(screen.getByRole('button', { name: /^retry$/i }))
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('switches to offline copy inside a polite status with a disabled retry when offline', () => {
      ONLINE_MOCK.value = false
      renderInRouter(<ErrorDisplay error={new Error('offline')} onRetry={() => undefined} />)

      const status = screen.getByRole('status')
      expect(status).toHaveAttribute('aria-live', 'polite')
      expect(screen.getByText("You're offline")).toBeInTheDocument()

      const retry = screen.getByRole('button', { name: /retry when online/i })
      expect(retry).toBeDisabled()
      expect(retry).toHaveAttribute('aria-disabled', 'true')
    })

    it('treats an ApiError(status=0) as the offline branch', () => {
      ONLINE_MOCK.value = false
      renderInRouter(<ErrorDisplay error={new ApiError('No network connection', 0)} />)
      expect(screen.getByText("You're offline")).toBeInTheDocument()
    })
  })

  describe('offline auto-retry (honours the "retry automatically" copy)', () => {
    it('fires onRetry exactly once when the browser reconnects on a status-less error', () => {
      ONLINE_MOCK.value = false
      const onRetry = vi.fn()
      renderInRouter(<ErrorDisplay error={new Error('offline')} onRetry={onRetry} />)

      expect(onRetry).not.toHaveBeenCalled()

      // A flapping connection can emit `online` more than once; the guard
      // must collapse them into a single retry.
      act(() => {
        window.dispatchEvent(new Event('online'))
        window.dispatchEvent(new Event('online'))
      })

      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('does NOT auto-retry a permanent 5xx failure on reconnect', () => {
      ONLINE_MOCK.value = false
      const onRetry = vi.fn()
      renderInRouter(<ErrorDisplay error={new ApiError('boom', 500)} onRetry={onRetry} />)

      act(() => {
        window.dispatchEvent(new Event('online'))
      })

      expect(onRetry).not.toHaveBeenCalled()
    })

    it('does not register a reconnect listener when no onRetry is supplied', () => {
      ONLINE_MOCK.value = false
      const addSpy = vi.spyOn(window, 'addEventListener')
      try {
        renderInRouter(<ErrorDisplay error={new Error('offline')} />)
        expect(addSpy.mock.calls.some(([type]) => type === 'online')).toBe(false)
      } finally {
        addSpy.mockRestore()
      }
    })
  })

  describe('compact variant + className passthrough', () => {
    it('applies compact padding for inline contexts', () => {
      const { container } = renderInRouter(<ErrorDisplay error={new Error('inline')} compact />)
      const panel = container.querySelector('[role="alert"]') as HTMLElement

      expect(panel.className).toContain('p-3')
      expect(panel.className).not.toContain('p-4')
    })

    it('uses the roomier padding when compact is not set', () => {
      const { container } = renderInRouter(<ErrorDisplay error={new Error('inline')} />)
      const panel = container.querySelector('[role="alert"]') as HTMLElement

      expect(panel.className).toContain('p-4')
    })

    it('forwards a custom className onto the panel', () => {
      const { container } = renderInRouter(
        <ErrorDisplay error={new Error('x')} className="my-custom-class" />,
      )
      const panel = container.querySelector('[role="alert"]') as HTMLElement
      expect(panel.className).toContain('my-custom-class')
    })
  })
})
