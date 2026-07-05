import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * DraftRecoveryBanner contract tests.
 *
 * react-i18next is stubbed to echo the default English copy and interpolate
 * `{{noun}}` / `{{when}}` so assertions can match the rendered strings
 * directly without booting the full i18n runtime. The date formatter
 * (`formatRelativeTime`) is exercised for real so the interpolation path is
 * covered end-to-end.
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      defaultOrOpts?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      if (typeof defaultOrOpts === 'string') {
        let out = defaultOrOpts
        const interp = opts ?? {}
        for (const [k, v] of Object.entries(interp)) {
          out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
        }
        return out
      }
      return _key
    },
  }),
}))

import { DraftRecoveryBanner } from '../DraftRecoveryBanner'

/**
 * A draft persisted `mins` (+ optional `extraSeconds`) ago. `formatRelativeTime`
 * floors to whole minutes, so `minutesAgo(3, 30)` deterministically yields
 * "3m ago" with ~29s of slack against clock drift during the test run.
 */
function minutesAgo(mins: number, extraSeconds = 0): Date {
  return new Date(Date.now() - mins * 60_000 - extraSeconds * 1000)
}

describe('DraftRecoveryBanner', () => {
  it('renders nothing when hasDraft is false', () => {
    const { container } = render(
      <DraftRecoveryBanner
        hasDraft={false}
        draftSavedAt={null}
        onDiscard={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('draft-recovery-banner')).toBeNull()
  })

  it('renders the info banner with the noun-less copy and interpolated relative time', () => {
    render(
      <DraftRecoveryBanner
        hasDraft
        draftSavedAt={minutesAgo(3, 30)}
        onDiscard={vi.fn()}
      />,
    )
    const banner = screen.getByTestId('draft-recovery-banner')
    expect(banner).toBeInTheDocument()
    expect(screen.getByText('Draft restored from 3m ago.')).toBeInTheDocument()
  })

  it('uses the itemNoun variant copy when itemNoun is supplied', () => {
    render(
      <DraftRecoveryBanner
        hasDraft
        draftSavedAt={minutesAgo(3, 30)}
        onDiscard={vi.fn()}
        itemNoun="Settings"
      />,
    )
    expect(
      screen.getByText('Settings draft restored from 3m ago.'),
    ).toBeInTheDocument()
    // The generic (noun-less) sentence must NOT also render.
    expect(screen.queryByText('Draft restored from 3m ago.')).toBeNull()
  })

  it('falls back to "a moment ago" when draftSavedAt is null', () => {
    render(
      <DraftRecoveryBanner hasDraft draftSavedAt={null} onDiscard={vi.fn()} />,
    )
    expect(
      screen.getByText('Draft restored from a moment ago.'),
    ).toBeInTheDocument()
  })

  it('exposes a polite status live-region and a decorative (aria-hidden) icon', () => {
    render(
      <DraftRecoveryBanner
        hasDraft
        draftSavedAt={minutesAgo(1)}
        onDiscard={vi.fn()}
      />,
    )
    const banner = screen.getByTestId('draft-recovery-banner')
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    const icon = banner.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders both actions as buttons with accessible names', () => {
    render(
      <DraftRecoveryBanner
        hasDraft
        draftSavedAt={minutesAgo(1)}
        onDiscard={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Use draft' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Discard draft' }),
    ).toBeInTheDocument()
  })

  it('"Use draft" dismisses the banner and calls onRestore exactly once', () => {
    const onRestore = vi.fn()
    const onDiscard = vi.fn()
    render(
      <DraftRecoveryBanner
        hasDraft
        draftSavedAt={minutesAgo(1)}
        onRestore={onRestore}
        onDiscard={onDiscard}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Use draft' }))
    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onDiscard).not.toHaveBeenCalled()
    expect(screen.queryByTestId('draft-recovery-banner')).toBeNull()
  })

  it('"Use draft" is safe when the optional onRestore handler is omitted', () => {
    render(
      <DraftRecoveryBanner
        hasDraft
        draftSavedAt={minutesAgo(1)}
        onDiscard={vi.fn()}
      />,
    )
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Use draft' })),
    ).not.toThrow()
    expect(screen.queryByTestId('draft-recovery-banner')).toBeNull()
  })

  it('"Discard draft" dismisses the banner and calls onDiscard exactly once', () => {
    const onRestore = vi.fn()
    const onDiscard = vi.fn()
    render(
      <DraftRecoveryBanner
        hasDraft
        draftSavedAt={minutesAgo(1)}
        onRestore={onRestore}
        onDiscard={onDiscard}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onRestore).not.toHaveBeenCalled()
    expect(screen.queryByTestId('draft-recovery-banner')).toBeNull()
  })

  it('keeps the banner hidden across re-renders while the same draft stays dismissed', () => {
    const { rerender } = render(
      <DraftRecoveryBanner
        hasDraft
        draftSavedAt={minutesAgo(2)}
        onDiscard={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Use draft' }))
    expect(screen.queryByTestId('draft-recovery-banner')).toBeNull()

    // Parent state churn re-renders the still-present draft — the
    // acknowledgement must persist; the banner must not nag again.
    rerender(
      <DraftRecoveryBanner
        hasDraft
        draftSavedAt={minutesAgo(2)}
        onDiscard={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('draft-recovery-banner')).toBeNull()
  })

  it('re-surfaces a fresh draft after the previous one clears (dismissed resets)', () => {
    const { rerender } = render(
      <DraftRecoveryBanner
        hasDraft
        draftSavedAt={minutesAgo(2)}
        onDiscard={vi.fn()}
      />,
    )
    // Acknowledge the current draft.
    fireEvent.click(screen.getByRole('button', { name: 'Use draft' }))
    expect(screen.queryByTestId('draft-recovery-banner')).toBeNull()

    // Upstream clears the draft (saved/discarded) — banner stays hidden.
    rerender(
      <DraftRecoveryBanner
        hasDraft={false}
        draftSavedAt={null}
        onDiscard={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('draft-recovery-banner')).toBeNull()

    // A brand-new draft is persisted — the banner must reappear, proving the
    // internal `dismissed` acknowledgement reset when the draft cleared.
    rerender(
      <DraftRecoveryBanner
        hasDraft
        draftSavedAt={minutesAgo(1)}
        onDiscard={vi.fn()}
      />,
    )
    expect(screen.getByTestId('draft-recovery-banner')).toBeInTheDocument()
  })
})
