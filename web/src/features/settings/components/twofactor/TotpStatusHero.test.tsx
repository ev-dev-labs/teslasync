/**
 * TotpStatusHero contract.
 *
 * The hero is a pure presentational surface for the two-factor page: it
 * reflects the current credential state and forwards user intent (enroll /
 * regenerate / disable) to callbacks owned by `useTotpEnrollmentFlow`. The
 * behaviours pinned here:
 *
 *   1. Shell & a11y — the section panel, the level-3 heading, the subtitle and
 *      the status pill render in both branches, so the surface is never blank.
 *   2. Not-enrolled branch — the status pill reads "Not enrolled", only the
 *      "Enable TOTP" primary action + its compatibility hint render, and the
 *      active-state controls (Regenerate / Disable / last-used / backup count)
 *      are absent. Clicking Enable raises `onEnroll`; while `enrolling` the
 *      button is disabled and marked aria-busy.
 *   3. Active branch — the pill reads "Active", the last-used timestamp is
 *      delegated to `formatDateTime` with the RAW value, the remaining
 *      backup-code count surfaces, and Regenerate + Disable render (Enable is
 *      gone). Each button raises its own callback; while `regenerating` only
 *      Regenerate is disabled/busy — Disable stays operable.
 *   4. Null-safety / hardening — a missing or negative backup count collapses
 *      to "0" (never a blank or "-1" cell), and a blank/whitespace `lastUsedAt`
 *      falls back to "Never" instead of formatting an "Invalid Date".
 *   5. Variant mapping — the pill flips success↔neutral with the activated flag.
 *
 * react-i18next is stubbed so `t(key, default)` echoes the English fallback —
 * the same convention as every sibling test. `useDateFormat` is mocked to a
 * deterministic, hermetic `formatDateTime` (no QueryClient, timezone router or
 * real clock). `@testing-library/user-event` is not installed in this repo, so
 * `fireEvent` drives interactions. No network is touched — the component is
 * pure props-in, DOM-out.
 */
import '@testing-library/jest-dom'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ComponentProps } from 'react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

// Hoisted so the vi.mock factory below can reference it (vitest hoists both).
const { formatDateTimeMock } = vi.hoisted(() => ({
  formatDateTimeMock: vi.fn((value?: unknown) => `formatted(${String(value)})`),
}))

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    opts: { locale: 'en-US', tz: 'UTC' },
    tz: 'UTC',
    locale: 'en-US',
    formatDate: (v: unknown) => String(v),
    formatDateTime: formatDateTimeMock,
    formatTime: () => 't',
    formatDateShort: () => 's',
    formatDateWithDay: () => 'd',
    formatRelative: () => 'r',
    formatRelativeTime: () => 'rt',
    formatRelativeDays: () => 'rd',
  }),
}))

import { TotpStatusHero } from './TotpStatusHero'
import TotpStatusHeroDefault from './TotpStatusHero'

type Props = ComponentProps<typeof TotpStatusHero>

const LAST_USED = '2026-06-01T12:00:00.000Z'

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    activated: false,
    lastUsedAt: undefined,
    backupRemaining: 0,
    enrolling: false,
    regenerating: false,
    onEnroll: vi.fn(),
    onRegenerate: vi.fn(),
    onDisable: vi.fn(),
    ...overrides,
  }
}

function renderHero(overrides: Partial<Props> = {}) {
  const props = makeProps(overrides)
  return { props, ...render(<TotpStatusHero {...props} />) }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TotpStatusHero — shell & a11y', () => {
  it('renders the section panel, a level-3 heading and the subtitle', () => {
    renderHero()

    expect(screen.getByTestId('totp-section')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: 'Two-factor authentication' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/TOTP codes from your authenticator app are required/i),
    ).toBeInTheDocument()
  })

  it('always renders the status pill in both branches', () => {
    const { unmount } = renderHero({ activated: false })
    expect(screen.getByTestId('totp-status-pill')).toBeInTheDocument()
    unmount()

    renderHero({ activated: true })
    expect(screen.getByTestId('totp-status-pill')).toBeInTheDocument()
  })
})

describe('TotpStatusHero — not-enrolled branch', () => {
  it('shows "Not enrolled", the Enable action and its hint only', () => {
    renderHero({ activated: false })

    expect(screen.getByTestId('totp-status-pill')).toHaveTextContent('Not enrolled')

    const enroll = screen.getByTestId('totp-enroll')
    expect(enroll).toBeInTheDocument()
    expect(enroll).toHaveAccessibleName('Enable TOTP')
    expect(
      screen.getByText(/Compatible with Google Authenticator/i),
    ).toBeInTheDocument()

    // Active-state controls and metrics must not leak into this branch.
    expect(screen.queryByTestId('totp-regenerate')).toBeNull()
    expect(screen.queryByTestId('totp-disable')).toBeNull()
    expect(screen.queryByTestId('totp-backup-remaining')).toBeNull()
    expect(screen.queryByText('Never')).toBeNull()
  })

  it('raises onEnroll exactly once when Enable is clicked', () => {
    const onEnroll = vi.fn()
    renderHero({ activated: false, onEnroll })

    fireEvent.click(screen.getByTestId('totp-enroll'))
    expect(onEnroll).toHaveBeenCalledTimes(1)
  })

  it('disables and marks the Enable button busy while enrolling', () => {
    renderHero({ activated: false, enrolling: true })

    const enroll = screen.getByTestId('totp-enroll')
    expect(enroll).toBeDisabled()
    expect(enroll).toHaveAttribute('aria-busy', 'true')
  })

  it('does not consult the date formatter when not enrolled', () => {
    renderHero({ activated: false, lastUsedAt: LAST_USED })
    expect(formatDateTimeMock).not.toHaveBeenCalled()
  })
})

describe('TotpStatusHero — active branch', () => {
  it('shows "Active", both management actions and hides Enable', () => {
    renderHero({ activated: true, backupRemaining: 7 })

    expect(screen.getByTestId('totp-status-pill')).toHaveTextContent('Active')
    expect(screen.getByTestId('totp-regenerate')).toBeInTheDocument()
    expect(screen.getByTestId('totp-disable')).toBeInTheDocument()
    expect(screen.queryByTestId('totp-enroll')).toBeNull()
  })

  it('surfaces the remaining backup-code count', () => {
    renderHero({ activated: true, backupRemaining: 9 })
    expect(screen.getByTestId('totp-backup-remaining')).toHaveTextContent('9')
  })

  it('delegates the last-used timestamp to formatDateTime with the raw value', () => {
    renderHero({ activated: true, lastUsedAt: LAST_USED })

    expect(formatDateTimeMock).toHaveBeenCalledWith(LAST_USED)
    expect(screen.getByText(`formatted(${LAST_USED})`)).toBeInTheDocument()
    expect(screen.queryByText('Never')).toBeNull()
  })

  it('shows "Never" and skips formatting when no timestamp is present', () => {
    renderHero({ activated: true, lastUsedAt: undefined })

    expect(screen.getByText('Never')).toBeInTheDocument()
    expect(formatDateTimeMock).not.toHaveBeenCalled()
  })

  it('raises onRegenerate and onDisable from their respective buttons', () => {
    const onRegenerate = vi.fn()
    const onDisable = vi.fn()
    renderHero({ activated: true, onRegenerate, onDisable })

    fireEvent.click(screen.getByTestId('totp-regenerate'))
    fireEvent.click(screen.getByTestId('totp-disable'))
    expect(onRegenerate).toHaveBeenCalledTimes(1)
    expect(onDisable).toHaveBeenCalledTimes(1)
  })

  it('disables only Regenerate while regenerating — Disable stays operable', () => {
    const onDisable = vi.fn()
    renderHero({ activated: true, regenerating: true, onDisable })

    const regenerate = screen.getByTestId('totp-regenerate')
    expect(regenerate).toBeDisabled()
    expect(regenerate).toHaveAttribute('aria-busy', 'true')

    const disable = screen.getByTestId('totp-disable')
    expect(disable).not.toBeDisabled()
    fireEvent.click(disable)
    expect(onDisable).toHaveBeenCalledTimes(1)
  })
})

describe('TotpStatusHero — null-safety & hardening', () => {
  it('clamps a negative backup count to "0"', () => {
    renderHero({ activated: true, backupRemaining: -5 })
    expect(screen.getByTestId('totp-backup-remaining')).toHaveTextContent('0')
    expect(screen.getByTestId('totp-backup-remaining')).not.toHaveTextContent('-5')
  })

  it('renders "0" rather than a blank cell when the count is missing', () => {
    // Simulate an upstream data bug that lets `undefined` slip past the typed
    // contract — the cell must still read a concrete "0", never empty.
    renderHero({
      activated: true,
      backupRemaining: undefined as unknown as number,
    })
    expect(screen.getByTestId('totp-backup-remaining')).toHaveTextContent('0')
  })

  it('treats a whitespace-only timestamp as "Never" (no Invalid Date)', () => {
    renderHero({ activated: true, lastUsedAt: '   ' })

    expect(screen.getByText('Never')).toBeInTheDocument()
    expect(formatDateTimeMock).not.toHaveBeenCalled()
  })
})

describe('TotpStatusHero — variant mapping & module surface', () => {
  it('flips the pill variant with the activated flag', () => {
    const { unmount } = renderHero({ activated: true })
    expect(screen.getByTestId('totp-status-pill')).toHaveClass('bg-green-100')
    unmount()

    renderHero({ activated: false })
    expect(screen.getByTestId('totp-status-pill')).toHaveClass('bg-gray-100')
  })

  it('exposes the same component as its default export', () => {
    expect(TotpStatusHeroDefault).toBe(TotpStatusHero)
  })
})
