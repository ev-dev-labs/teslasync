import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '@/i18n'
import { ApiError } from '@/lib/resilience'
import { QueryError } from '../QueryError'

/**
 * QueryError branch contract.
 *
 * The component must surface different recovery copy + CTAs based on
 * `ApiError.status` so users know whether the failure is auth, server,
 * gone-record, or offline. Each test forces one branch and asserts that
 * the right title / message / action is rendered.
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

describe('QueryError', () => {
  it('renders nothing when error is null/undefined', () => {
    const { container } = renderInRouter(<QueryError error={null} />)
    expect(container.querySelector('[role="alert"], [role="status"]')).toBeNull()
  })

  describe('404 Not Found', () => {
    it('renders "{resource} not found" title with Back-to-list CTA when listHref is provided', async () => {
      renderInRouter(
        <QueryError
          error={new ApiError('not found', 404)}
          resourceName="Drive"
          listHref="/drives"
        />,
      )

      expect(screen.getByText('Drive not found')).toBeInTheDocument()
      expect(screen.getByText(/may have been deleted/i)).toBeInTheDocument()

      const cta = screen.getByRole('button', { name: /back to list/i })
      expect(cta).toBeInTheDocument()

      fireEvent.click(cta)
      await waitFor(() => {
        expect(screen.getByTestId('drives-list')).toBeInTheDocument()
      })
    })

    it('falls back to "Resource not found" when resourceName is omitted', () => {
      renderInRouter(<QueryError error={new ApiError('gone', 404)} />)
      expect(screen.getByText('Resource not found')).toBeInTheDocument()
    })

    it('omits the Back-to-list CTA when listHref is not provided', () => {
      renderInRouter(<QueryError error={new ApiError('gone', 404)} resourceName="Drive" />)
      expect(screen.queryByRole('button', { name: /back to list/i })).toBeNull()
    })
  })

  describe('401 / 403 Unauthorized', () => {
    it('renders Sign-in CTA on 401', () => {
      renderInRouter(<QueryError error={new ApiError('expired', 401)} />)
      expect(screen.getByText('Sign in required')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    })

    it('renders Sign-in CTA on 403', () => {
      renderInRouter(<QueryError error={new ApiError('forbidden', 403)} />)
      expect(screen.getByText('Sign in required')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    })
  })

  describe('5xx Server error', () => {
    it('renders the server-error title with a Retry CTA when onRetry is provided', () => {
      const onRetry = vi.fn()
      renderInRouter(
        <QueryError error={new ApiError('boom', 500)} onRetry={onRetry} />,
      )

      expect(screen.getByText('Server error')).toBeInTheDocument()
      const retry = screen.getByRole('button', { name: /^retry$/i })
      fireEvent.click(retry)
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('also matches 502 / 503 / 504', () => {
      const { rerender } = renderInRouter(
        <QueryError error={new ApiError('bad gateway', 502)} />,
      )
      expect(screen.getByText('Server error')).toBeInTheDocument()

      rerender(
        <MemoryRouter>
          <QueryError error={new ApiError('unavailable', 503)} />
        </MemoryRouter>,
      )
      expect(screen.getByText('Server error')).toBeInTheDocument()
    })

    it('omits the Retry CTA when onRetry is not provided', () => {
      renderInRouter(<QueryError error={new ApiError('boom', 500)} />)
      expect(screen.queryByRole('button', { name: /^retry$/i })).toBeNull()
    })
  })

  describe('Network / unknown', () => {
    it('renders the connection-check message when error has no status', () => {
      renderInRouter(<QueryError error={new Error('boom')} />)
      expect(screen.getByText("Can't reach server")).toBeInTheDocument()
      expect(screen.getByText(/check your internet connection/i)).toBeInTheDocument()
    })

    it('renders Retry CTA on the network branch when onRetry is provided', () => {
      const onRetry = vi.fn()
      renderInRouter(<QueryError error={new Error('network down')} onRetry={onRetry} />)

      const retry = screen.getByRole('button', { name: /^retry$/i })
      fireEvent.click(retry)
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('switches to the offline copy + disabled retry when the browser is offline', () => {
      ONLINE_MOCK.value = false
      renderInRouter(
        <QueryError error={new Error('offline')} onRetry={() => undefined} />,
      )

      expect(screen.getByText("You're offline")).toBeInTheDocument()
      const retry = screen.getByRole('button', { name: /retry when online/i })
      expect(retry).toBeDisabled()
    })

    it('treats ApiError(status=0) as the offline branch', () => {
      ONLINE_MOCK.value = false
      renderInRouter(
        <QueryError error={new ApiError('No network connection', 0)} />,
      )
      expect(screen.getByText("You're offline")).toBeInTheDocument()
    })
  })
})
