/**
 * ChangelogModal contract.
 *
 * The modal owns two activation paths (auto-show throttled once/24h behind an
 * onboarding + tour gate, and an imperative window event), a three-way
 * subtitle (first-visit / has-new / caught-up), a collapsible per-release
 * entry list, and three CTAs whose "seen" side effects differ.
 *
 * {@link useChangelog} is mocked so each test drives the gating predicate and
 * entry data directly and spies on `markSeen`/`stampShown` — mirroring the
 * SessionExpiringModal/FeedbackModal convention. `react-i18next` is stubbed so
 * `t(key, fallback, vars)` resolves to the fallback with `{{count}}`
 * interpolated, letting us assert real UI copy without the translation bundle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { ChangelogEntry } from '@/generated/changelog'

const OPEN_EVENT = 'teslasync:changelog:open'

type MockChangelog = {
  entries: readonly ChangelogEntry[]
  newEntries: readonly ChangelogEntry[]
  latestVersion: string
  seenVersion: string | null
  hasUnseen: boolean
  canAutoShow: boolean
  hasCompletedOnboarding: boolean
  markSeen: ReturnType<typeof vi.fn>
  stampShown: ReturnType<typeof vi.fn>
}

let mockChangelog: MockChangelog

vi.mock('@/hooks/useChangelog', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useChangelog')>('@/hooks/useChangelog')
  return {
    ...actual,
    useChangelog: () => mockChangelog,
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
        let fallback = key
        let vars: Record<string, unknown> | undefined
        if (typeof fallbackOrOpts === 'string') {
          fallback = fallbackOrOpts
          vars = opts
        } else if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') fallback = o.defaultValue
          vars = o
        }
        if (vars) {
          return Object.entries(vars).reduce<string>(
            (acc, [k, v]) => acc.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v)),
            fallback,
          )
        }
        return fallback
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import { ChangelogModal } from './ChangelogModal'

// ── Fixtures ────────────────────────────────────────────────────────────────

const entryLatest: ChangelogEntry = {
  version: '0.7.0',
  date: '2026-03-29',
  badge: 'latest',
  changes: [
    { type: 'added', text: 'Quad-motor telemetry' },
    { type: 'fixed', text: 'Disconnect clears the token' },
  ],
}

const entryStable: ChangelogEntry = {
  version: '0.6.0',
  date: '2026-03-28',
  badge: 'stable',
  changes: [
    { type: 'added', text: 'Charging curve page' },
    { type: 'security', text: 'Per-route rate limiting' },
  ],
}

const entryBeta: ChangelogEntry = {
  version: '0.5.0',
  date: '2026-03-27',
  badge: 'beta',
  changes: [{ type: 'changed', text: 'Palette tokens' }],
}

const ALL = [entryLatest, entryStable, entryBeta] as const

function makeChangelog(overrides: Partial<MockChangelog> = {}): MockChangelog {
  return {
    entries: ALL,
    newEntries: ALL,
    latestVersion: '0.7.0',
    seenVersion: null,
    hasUnseen: true,
    canAutoShow: true,
    hasCompletedOnboarding: true,
    markSeen: vi.fn(),
    stampShown: vi.fn(),
    ...overrides,
  }
}

function openViaEvent() {
  act(() => {
    window.dispatchEvent(new Event(OPEN_EVENT))
  })
}

describe('ChangelogModal', () => {
  beforeEach(() => {
    mockChangelog = makeChangelog()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // Purge any tour marker a test appended to <body>.
    document.querySelectorAll('[data-tour-active]').forEach((el) => el.remove())
  })

  it('renders nothing until an activation path fires', () => {
    render(<ChangelogModal />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockChangelog.stampShown).not.toHaveBeenCalled()
  })

  it('opens on the imperative window event and stamps the throttle', () => {
    // canAutoShow off so ONLY the manual path can stamp — keeps the count exact.
    mockChangelog = makeChangelog({ canAutoShow: false })
    render(<ChangelogModal />)
    expect(screen.queryByRole('dialog')).toBeNull()

    openViaEvent()

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText("What's new in TeslaSync")).toBeTruthy()
    // Default-open entries (idx < 2) surface their change text immediately.
    expect(screen.getByText('Quad-motor telemetry')).toBeTruthy()
    expect(mockChangelog.stampShown).toHaveBeenCalledTimes(1)
  })

  it('shows the welcome subtitle on a first visit (seenVersion === null)', () => {
    mockChangelog = makeChangelog({ seenVersion: null, canAutoShow: false })
    render(<ChangelogModal />)
    openViaEvent()
    expect(screen.getByText(/Welcome!/)).toBeTruthy()
  })

  it('reports the NEW-entry count (not the visible list length) since last visit', () => {
    // Returning user: two of three releases are unseen. The subtitle must
    // count `newEntries` (2), and only those two entries may render.
    mockChangelog = makeChangelog({
      newEntries: [entryLatest, entryStable],
      seenVersion: '0.5.0',
      hasUnseen: true,
      canAutoShow: false,
    })
    render(<ChangelogModal />)
    openViaEvent()

    expect(screen.getByText(/2 new release\(s\) since your last visit/)).toBeTruthy()
    expect(screen.getByText('v0.7.0')).toBeTruthy()
    expect(screen.getByText('v0.6.0')).toBeTruthy()
    expect(screen.queryByText('v0.5.0')).toBeNull()
  })

  it('does NOT claim new releases when the user is already caught up (bug fix)', () => {
    // seenVersion is the latest → newEntries empty, but a manual open still
    // shows the FULL history. Previously the subtitle wrongly said
    // "3 new release(s)" because it counted the visible fallback list.
    mockChangelog = makeChangelog({
      newEntries: [],
      seenVersion: '0.7.0',
      hasUnseen: false,
      canAutoShow: false,
    })
    render(<ChangelogModal />)
    openViaEvent()

    expect(screen.getByText(/all caught up/i)).toBeTruthy()
    expect(screen.queryByText(/new release/i)).toBeNull()
    // Full history is still listed.
    expect(screen.getByText('v0.7.0')).toBeTruthy()
    expect(screen.getByText('v0.5.0')).toBeTruthy()
  })

  it('renders an empty state (never a blank panel) when there are no releases', () => {
    mockChangelog = makeChangelog({
      entries: [],
      newEntries: [],
      seenVersion: '0.7.0',
      hasUnseen: false,
      canAutoShow: false,
    })
    render(<ChangelogModal />)
    openViaEvent()

    expect(screen.getByText('No release notes are available yet.')).toBeTruthy()
    expect(screen.getByText(/all caught up/i)).toBeTruthy()
  })

  it('"Got it" marks the latest seen and closes', () => {
    mockChangelog = makeChangelog({ canAutoShow: false })
    render(<ChangelogModal />)
    openViaEvent()

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))

    expect(mockChangelog.markSeen).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closing via the X (unacknowledged) does NOT mark seen', () => {
    mockChangelog = makeChangelog({ canAutoShow: false })
    render(<ChangelogModal />)
    openViaEvent()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(mockChangelog.markSeen).not.toHaveBeenCalled()
    // The throttle was still stamped once, on open.
    expect(mockChangelog.stampShown).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"View full changelog" opens the releases page safely and marks seen', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    mockChangelog = makeChangelog({ canAutoShow: false })
    render(<ChangelogModal />)
    openViaEvent()

    fireEvent.click(screen.getByRole('button', { name: /view full changelog/i }))

    expect(openSpy).toHaveBeenCalledWith(
      'https://github.com/ev-dev-labs/teslasync/releases',
      '_blank',
      'noopener,noreferrer',
    )
    expect(mockChangelog.markSeen).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('expands and collapses a release entry via its disclosure button', () => {
    mockChangelog = makeChangelog({ canAutoShow: false })
    render(<ChangelogModal />)
    openViaEvent()

    // The third entry (idx 2) is collapsed by default, so its change is hidden.
    expect(screen.queryByText('Palette tokens')).toBeNull()
    const toggle = screen.getByRole('button', { name: /0\.5\.0/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // Disclosure a11y: the button points at the panel it controls.
    expect(toggle).toHaveAttribute('aria-controls')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Palette tokens')).toBeTruthy()
  })

  it('groups changes by type and omits empty sections', () => {
    mockChangelog = makeChangelog({ canAutoShow: false })
    render(<ChangelogModal />)
    openViaEvent()

    // Default-open entries carry Added / Fixed / Security sections…
    expect(screen.getAllByText('Added').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Fixed')).toBeTruthy()
    expect(screen.getByText('Security')).toBeTruthy()
    // …but no entry has a "removed" change, so that heading never renders.
    expect(screen.queryByText('Removed')).toBeNull()
  })

  it('survives a malformed entry whose `changes` is undefined', () => {
    const broken = {
      version: '9.9.9',
      date: '2030-01-01',
      badge: 'latest',
      changes: undefined,
    } as unknown as ChangelogEntry
    mockChangelog = makeChangelog({
      entries: [broken],
      newEntries: [broken],
      seenVersion: null,
      canAutoShow: false,
    })

    expect(() => {
      render(<ChangelogModal />)
      openViaEvent()
    }).not.toThrow()
    expect(screen.getByText('v9.9.9')).toBeTruthy()
  })

  it('auto-shows after the settle delay when the gate is open', () => {
    vi.useFakeTimers()
    try {
      mockChangelog = makeChangelog({
        hasUnseen: true,
        hasCompletedOnboarding: true,
        canAutoShow: true,
        seenVersion: null,
      })
      render(<ChangelogModal />)
      // Nothing before the delay elapses.
      expect(screen.queryByRole('dialog')).toBeNull()

      act(() => {
        vi.advanceTimersByTime(2_000)
      })

      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(mockChangelog.stampShown).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('suppresses auto-show while a tour overlay is active', () => {
    vi.useFakeTimers()
    try {
      const marker = document.createElement('div')
      marker.setAttribute('data-tour-active', '')
      document.body.appendChild(marker)

      render(<ChangelogModal />)
      act(() => {
        vi.advanceTimersByTime(2_000)
      })

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(mockChangelog.stampShown).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not auto-show until onboarding is complete', () => {
    vi.useFakeTimers()
    try {
      mockChangelog = makeChangelog({ hasCompletedOnboarding: false })
      render(<ChangelogModal />)
      act(() => {
        vi.advanceTimersByTime(2_000)
      })

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(mockChangelog.stampShown).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
