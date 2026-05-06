import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * Phase-46 / Prompt 66 — EditConflictBanner contract.
 *
 * The banner composes <AlertBanner> and reads lease state from
 * useEditLease. Tests mock the hook to deterministically simulate the
 * three states {owner, no-peer, peer-active} without driving the
 * BroadcastChannel election protocol — the protocol itself is covered
 * exhaustively in `hooks/__tests__/useEditLease.test.ts`.
 *
 * react-i18next is stubbed to echo the default value so assertions
 * match the fallback English copy directly.
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

vi.mock('@/hooks/useEditLease', () => ({
  useEditLease: vi.fn(),
}))

import { EditConflictBanner } from '../EditConflictBanner'
import { useEditLease } from '@/hooks/useEditLease'

const mockHook = useEditLease as unknown as ReturnType<typeof vi.fn>

const noop = () => {}

describe('EditConflictBanner', () => {
  beforeEach(() => {
    mockHook.mockReset()
  })

  it('renders nothing when this tab is the owner', () => {
    mockHook.mockReturnValue({
      isOwner: true,
      otherTab: null,
      claim: noop,
    })
    const { container } = render(<EditConflictBanner resourceKey="test" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when no other tab has been observed', () => {
    mockHook.mockReturnValue({
      isOwner: false,
      otherTab: null,
      claim: noop,
    })
    const { container } = render(<EditConflictBanner resourceKey="test" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when isOwner is true even if otherTab is non-null', () => {
    // Defensive — this state is brief during a take-over handoff but
    // the banner should never appear on the owning tab.
    mockHook.mockReturnValue({
      isOwner: true,
      otherTab: { tabId: 'peer', claimedAt: 1 },
      claim: noop,
    })
    const { container } = render(<EditConflictBanner resourceKey="test" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the warning banner when not owner and another tab is editing', () => {
    mockHook.mockReturnValue({
      isOwner: false,
      otherTab: { tabId: 'peer-tab-aaa', claimedAt: 100 },
      claim: noop,
    })
    render(<EditConflictBanner resourceKey="settings/general" />)

    const banner = screen.getByTestId('edit-conflict-banner')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveAttribute('data-resource-key', 'settings/general')
    expect(banner).toHaveAttribute('data-other-tab-id', 'peer-tab-aaa')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    // Default copy renders.
    expect(
      screen.getByText(/another browser tab is editing this/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/saving here will overwrite changes made there/i),
    ).toBeInTheDocument()
  })

  it('clicking "Take over" calls claim() on the lease', () => {
    const claim = vi.fn()
    mockHook.mockReturnValue({
      isOwner: false,
      otherTab: { tabId: 'peer-tab-aaa', claimedAt: 100 },
      claim,
    })
    render(<EditConflictBanner resourceKey="test" />)

    fireEvent.click(screen.getByTestId('edit-conflict-take-over'))
    expect(claim).toHaveBeenCalledTimes(1)
  })

  it('renders the resourceLabel-aware copy when the prop is set', () => {
    mockHook.mockReturnValue({
      isOwner: false,
      otherTab: { tabId: 'peer-tab-aaa', claimedAt: 100 },
      claim: noop,
    })
    render(
      <EditConflictBanner
        resourceKey="settings/general"
        resourceLabel="Your settings"
      />,
    )
    // The resource-aware fallback string starts with the label.
    expect(screen.getByText(/^Your settings is open in another tab/i)).toBeInTheDocument()
  })

  it('renders a dismiss-style switch hint alongside the take-over action', () => {
    mockHook.mockReturnValue({
      isOwner: false,
      otherTab: { tabId: 'peer-tab-aaa', claimedAt: 100 },
      claim: noop,
    })
    render(<EditConflictBanner resourceKey="test" />)

    const hint = screen.getByTestId('edit-conflict-switch-hint')
    expect(hint).toBeInTheDocument()
    expect(hint).toHaveTextContent(/switch to your other tab/i)
  })
})
