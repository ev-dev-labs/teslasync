import * as React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AchievementUnlockedEvent } from '@/api/hooks/useAchievementUnlocks'

/**
 * Optional-surface containment for the deferred celebration toast.
 *
 * The celebration stack is loaded with `React.lazy`. A lazy import can REJECT —
 * a hashed chunk that no longer exists after a deploy, or a first unlock while
 * offline. `Suspense` does not catch a rejection: it is re-thrown during render
 * and propagates to the nearest error boundary.
 *
 * With only the root `<ErrorBoundary>` above it, that meant a decorative toast
 * could:
 *   1. replace the ENTIRE application with the full-page error card, and
 *   2. trigger the shared boundary's chunk-error recovery, which force-reloads
 *      the page five seconds later — destroying unsaved work in any open form.
 *
 * This file proves the failure is now contained locally, silently, and without
 * disturbing the eager half of the listener (subscription, chime, seen-set).
 */

let mockRecent: AchievementUnlockedEvent[] = []
let mockPrefs = {
  showToasts: true,
  playSound: false,
  showOnDashboard: true,
  pushOnUnlock: true,
}
const mockDismiss = vi.fn()
const mockUseUnlocks = vi.fn(() => ({ recent: mockRecent, dismiss: mockDismiss }))

vi.mock('@/api/hooks/useAchievementUnlocks', () => ({
  useAchievementUnlocks: () => mockUseUnlocks(),
}))

vi.mock('@/hooks/useAchievementCelebrationPrefs', () => ({
  useAchievementCelebrationPrefs: () => mockPrefs,
}))

/**
 * Simulate a stale/offline chunk: the dynamic import REJECTS. A throwing
 * factory is what makes `import('../AchievementUnlockedToast')` return a
 * rejected promise, which is the runtime shape of a hashed chunk that 404s
 * after a deploy. (Vitest logs its own "error when mocking a module" notice
 * for this on stderr — that notice IS the simulated failure firing.)
 */
vi.mock('../AchievementUnlockedToast', () => {
  throw new Error(
    'Failed to fetch dynamically imported module: /assets/AchievementUnlockedToast-abc123.js',
  )
})

import { AchievementUnlockListener } from '../AchievementUnlockListener'
import { ErrorBoundary } from '../ErrorBoundary'
import { OptionalSurfaceBoundary } from '../_OptionalSurfaceBoundary'

function makeEvent(id: string, name = `Achievement ${id}`): AchievementUnlockedEvent {
  return {
    vehicle_id: 1,
    unlocked_at: '2025-01-01T00:00:00Z',
    achievement: {
      id,
      name,
      description: `${name} description`,
      icon: '🏆',
      unlocked: true,
      progress: 1,
      target: 1,
    },
  } as unknown as AchievementUnlockedEvent
}

function installAudioContext(state: 'running' | 'suspended' = 'running') {
  const oscStart = vi.fn()
  const oscStop = vi.fn()
  const createOscillator = vi.fn(() => ({
    type: '',
    frequency: { value: 0 },
    connect: vi.fn(),
    start: oscStart,
    stop: oscStop,
  }))
  const createGain = vi.fn(() => ({
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  }))
  const ctor = vi.fn(function (this: Record<string, unknown>) {
    this.currentTime = 0
    this.state = state
    this.destination = {}
    this.createOscillator = createOscillator
    this.createGain = createGain
    this.resume = vi.fn(() => Promise.resolve())
    this.close = vi.fn(() => Promise.resolve())
  })
  vi.stubGlobal('AudioContext', ctor)
  return { ctor, createOscillator, oscStart }
}

/** The app the celebration must never be able to take down. */
function AppUnderRootBoundary() {
  const [count, setCount] = React.useState(0)
  return (
    <ErrorBoundary>
      <div data-testid="app-shell">
        <button data-testid="core-action" onClick={() => setCount((c) => c + 1)}>
          core
        </button>
        <span data-testid="core-count">{count}</span>
      </div>
      <AchievementUnlockListener />
    </ErrorBoundary>
  )
}

/**
 * CONTROL. The same failing lazy import behind Suspense ONLY — i.e. the
 * pre-fix shape. If this does not blow the app away, the assertions above are
 * vacuous and the local boundary is proving nothing.
 */
const UncontainedStack = React.lazy(() =>
  import('../AchievementUnlockedToast').then((m) => ({
    default: m.AchievementUnlockedToastStack,
  })),
)

function AppWithoutContainment() {
  return (
    <ErrorBoundary>
      <div data-testid="app-shell" />
      <React.Suspense fallback={null}>
        <UncontainedStack events={[]} onDismiss={() => {}} />
      </React.Suspense>
    </ErrorBoundary>
  )
}

describe('AchievementUnlockListener — lazy chunk failure containment', () => {
  let reloadSpy: ReturnType<typeof vi.fn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockRecent = []
    mockPrefs = { showToasts: true, playSound: false, showOnDashboard: true, pushOnUnlock: true }
    mockDismiss.mockClear()
    mockUseUnlocks.mockClear()
    vi.useFakeTimers()

    reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    })
    // React logs the caught error; keep the suite output readable while still
    // being able to assert on what was logged.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('keeps the application rendered when the celebration chunk fails to load', async () => {
    mockRecent = [makeEvent('a1', 'First Drive')]

    render(<AppUnderRootBoundary />)

    // Let the rejected lazy import settle and React re-render.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    // The app is untouched: no full-page error card, no blanked shell.
    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reload/i })).not.toBeInTheDocument()

    // No celebration UI, and crucially no error UI in its place.
    expect(screen.queryByTestId('toast-stack')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // The shared boundary's chunk-error recovery must NOT have been armed:
    // an optional toast may not force a reload that discards unsaved work.
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(reloadSpy).not.toHaveBeenCalled()
    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
  })

  it('leaves core application behaviour working after the failure', async () => {
    mockRecent = [makeEvent('a1')]

    render(<AppUnderRootBoundary />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.click(screen.getByTestId('core-action'))
    fireEvent.click(screen.getByTestId('core-action'))
    expect(screen.getByTestId('core-count').textContent).toBe('2')
  })

  it('keeps the subscription and the chime eager when the visual chunk is gone', async () => {
    mockPrefs.playSound = true
    mockRecent = [makeEvent('a1')]
    const audio = installAudioContext('running')

    render(<AppUnderRootBoundary />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    // The SSE queue is still being drained…
    expect(mockUseUnlocks).toHaveBeenCalled()
    // …and the audible celebration still fired even though the visual one
    // could not be downloaded.
    expect(audio.ctor).toHaveBeenCalledTimes(1)
    expect(audio.createOscillator).toHaveBeenCalledTimes(2)
    expect(audio.oscStart).toHaveBeenCalledTimes(2)
  })

  it('does not replay the chime on later renders after the chunk failure', async () => {
    mockPrefs.playSound = true
    mockRecent = [makeEvent('a1'), makeEvent('a2')]
    const audio = installAudioContext('running')

    const { rerender } = render(<AppUnderRootBoundary />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(audio.createOscillator).toHaveBeenCalledTimes(2)

    // Seen-set bookkeeping still works: a shrinking queue must stay silent.
    audio.createOscillator.mockClear()
    mockRecent = [makeEvent('a2')]
    rerender(<AppUnderRootBoundary />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(audio.createOscillator).not.toHaveBeenCalled()

    // …and a genuinely new unlock still chimes.
    mockRecent = [makeEvent('a3'), makeEvent('a2')]
    rerender(<AppUnderRootBoundary />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(audio.createOscillator).toHaveBeenCalledTimes(2)
    expect(audio.ctor).toHaveBeenCalledTimes(1)
  })

  it('reports the suppressed surface once, without user-facing noise', async () => {
    mockRecent = [makeEvent('a1')]

    render(<AppUnderRootBoundary />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const suppressed = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('OptionalSurfaceBoundary'),
    )
    expect(suppressed).toHaveLength(1)
    expect(String(suppressed[0][0])).toContain('AchievementCelebration')
    // Nothing was rendered for the user to see or dismiss.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // ── Non-vacuity control ─────────────────────────────────────────────────
  it('CONTROL: the same rejection with only Suspense DOES replace the app', async () => {
    render(<AppWithoutContainment />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    // This is the behaviour the local boundary exists to prevent: the whole
    // shell is gone and the full-page error card is showing instead.
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument()
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
  })
})

describe('OptionalSurfaceBoundary — chunk errors are contained, not escalated', () => {
  let reloadSpy: ReturnType<typeof vi.fn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  function Exploding(): React.ReactElement {
    // The exact message a bundler produces, which is also what the shared
    // ErrorBoundary classifies as `isChunkLoadError` and answers with a forced
    // `window.location.reload()` five seconds later.
    throw new Error('Loading chunk 42 failed. (error: /assets/AchievementUnlockedToast-abc123.js)')
  }

  beforeEach(() => {
    vi.useFakeTimers()
    reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    })
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      sessionStorage.removeItem('teslasync-chunk-reload')
    } catch {
      /* jsdom private-mode simulation — nothing to clear */
    }
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('renders null and never reloads for a chunk-load error', async () => {
    const { container } = render(
      <OptionalSurfaceBoundary name="AchievementCelebration">
        <Exploding />
      </OptionalSurfaceBoundary>,
    )

    expect(container.firstChild).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('CONTROL: the shared ErrorBoundary force-reloads for the same error', async () => {
    render(
      <ErrorBoundary>
        <Exploding />
      </ErrorBoundary>,
    )

    await act(async () => {
      vi.advanceTimersByTime(6_000)
    })
    // Proves the previous assertion is meaningful: this IS a chunk error, and
    // the shared boundary really does escalate it to a page reload.
    expect(reloadSpy).toHaveBeenCalled()
  })

  it('stays suppressed on re-render instead of retrying a permanently rejected import', () => {
    const { container, rerender } = render(
      <OptionalSurfaceBoundary name="AchievementCelebration">
        <Exploding />
      </OptionalSurfaceBoundary>,
    )
    expect(container.firstChild).toBeNull()

    rerender(
      <OptionalSurfaceBoundary name="AchievementCelebration">
        <div data-testid="recovered" />
      </OptionalSurfaceBoundary>,
    )
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('recovered')).not.toBeInTheDocument()
  })
})
