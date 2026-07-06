import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { useState } from 'react'

// ── Controllable mock for the vite-plugin-pwa virtual module ──
// `useRegisterSW` is a *real* (mocked) hook backed by `useState`, so that
// `setNeedRefresh(false)` triggers an actual re-render of ReloadPrompt —
// which is exactly what lets us assert the banner shows and then hides.
// `updateServiceWorker` is a spy so we can assert reload behaviour.
const { mockUseRegisterSW, mockUpdateServiceWorker } = vi.hoisted(() => ({
  mockUseRegisterSW: vi.fn(),
  mockUpdateServiceWorker: vi.fn(() => Promise.resolve()),
}))

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: mockUseRegisterSW,
}))

// i18n passthrough: honour the inline default string and interpolate the
// `{{seconds}}` placeholder so the countdown copy renders verbatim.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: unknown) => {
      const str = typeof fallback === 'string' ? fallback : key
      const vars = (
        opts && typeof opts === 'object'
          ? opts
          : fallback && typeof fallback === 'object'
            ? fallback
            : null
      ) as Record<string, unknown> | null
      if (!vars) return str
      return Object.entries(vars).reduce<string>(
        (acc, [k, v]) =>
          k.startsWith('default')
            ? acc
            : acc.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v)),
        str,
      )
    },
  }),
}))

import ReloadPrompt from './ReloadPrompt'

const FIVE_MINUTES_MS = 5 * 60 * 1000

type RegisterOptions = {
  onRegisteredSW?: (url: string, reg?: ServiceWorkerRegistration) => void
  onRegisterError?: (error: unknown) => void
}

let initialNeedRefresh = false
let capturedOptions: RegisterOptions | undefined

beforeEach(() => {
  vi.useFakeTimers()
  initialNeedRefresh = false
  capturedOptions = undefined
  mockUpdateServiceWorker.mockClear()
  mockUseRegisterSW.mockReset()
  mockUseRegisterSW.mockImplementation((options: RegisterOptions) => {
    capturedOptions = options
    const [needRefresh, setNeedRefresh] = useState(initialNeedRefresh)
    return {
      needRefresh: [needRefresh, setNeedRefresh],
      offlineReady: [false, () => undefined],
      updateServiceWorker: mockUpdateServiceWorker,
    }
  })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

function renderPrompt(needRefresh: boolean) {
  initialNeedRefresh = needRefresh
  return render(<ReloadPrompt />)
}

describe('ReloadPrompt', () => {
  it('renders nothing when no update is pending', () => {
    const { container } = renderPrompt(false)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('reload-prompt')).toBeNull()
    expect(mockUpdateServiceWorker).not.toHaveBeenCalled()
  })

  it('renders the update banner with countdown copy and both actions when an update is pending', () => {
    renderPrompt(true)
    const banner = screen.getByTestId('reload-prompt')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('New version available')).toBeInTheDocument()
    expect(screen.getByText('Reloading in 3s...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload Now' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument()
  })

  it('marks the decorative spinner icon as aria-hidden for assistive tech', () => {
    const { container } = renderPrompt(true)
    const icon = container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('reloads immediately when Reload Now is clicked and cancels the countdown', () => {
    renderPrompt(true)
    fireEvent.click(screen.getByTestId('reload-prompt-reload'))

    expect(mockUpdateServiceWorker).toHaveBeenCalledTimes(1)
    expect(mockUpdateServiceWorker).toHaveBeenCalledWith(true)

    // The countdown interval must have been cleared — advancing time must
    // not fire a second (redundant) reload.
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(mockUpdateServiceWorker).toHaveBeenCalledTimes(1)
  })

  it('dismisses the banner and skips the reload when Later is clicked', () => {
    renderPrompt(true)
    expect(screen.getByTestId('reload-prompt')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('reload-prompt-dismiss'))

    // setNeedRefresh(false) unmounts the banner.
    expect(screen.queryByTestId('reload-prompt')).toBeNull()

    // Dismiss also cancels the countdown, so no auto-reload happens later.
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(mockUpdateServiceWorker).not.toHaveBeenCalled()
  })

  it('counts down each second and auto-reloads when it reaches zero', () => {
    renderPrompt(true)
    expect(screen.getByText('Reloading in 3s...')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('Reloading in 2s...')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('Reloading in 1s...')).toBeInTheDocument()
    expect(mockUpdateServiceWorker).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(mockUpdateServiceWorker).toHaveBeenCalledTimes(1)
    expect(mockUpdateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('starts polling registration.update() on the 5-minute interval once the SW registers', () => {
    renderPrompt(false)
    expect(typeof capturedOptions?.onRegisteredSW).toBe('function')

    const registration = { update: vi.fn() } as unknown as ServiceWorkerRegistration
    act(() => {
      capturedOptions?.onRegisteredSW?.('/sw.js', registration)
    })

    expect(registration.update).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(FIVE_MINUTES_MS)
    })
    expect(registration.update).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(FIVE_MINUTES_MS)
    })
    expect(registration.update).toHaveBeenCalledTimes(2)
  })

  it('does not throw or poll when the SW registers without a registration object', () => {
    renderPrompt(false)
    expect(() => {
      act(() => {
        capturedOptions?.onRegisteredSW?.('/sw.js', undefined)
      })
      act(() => {
        vi.advanceTimersByTime(FIVE_MINUTES_MS * 2)
      })
    }).not.toThrow()
  })

  it('stops polling registration.update() after the component unmounts', () => {
    const { unmount } = renderPrompt(false)
    const registration = { update: vi.fn() } as unknown as ServiceWorkerRegistration
    act(() => {
      capturedOptions?.onRegisteredSW?.('/sw.js', registration)
    })

    act(() => {
      vi.advanceTimersByTime(FIVE_MINUTES_MS)
    })
    expect(registration.update).toHaveBeenCalledTimes(1)

    unmount()

    act(() => {
      vi.advanceTimersByTime(FIVE_MINUTES_MS * 6)
    })
    // Interval was torn down on unmount — no further polls.
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('logs a registration error through console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderPrompt(false)

    const err = new Error('sw boom')
    act(() => {
      capturedOptions?.onRegisterError?.(err)
    })

    expect(spy).toHaveBeenCalledWith('[SW] Registration error:', err)
    spy.mockRestore()
  })
})
