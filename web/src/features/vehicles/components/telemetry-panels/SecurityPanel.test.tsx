/**
 * SecurityPanel unit tests.
 *
 * The panel renders a live security snapshot (lock / sentry / doors / windows /
 * occupant presence) plus a remote-start capability flag. The three headline
 * booleans (`locked`, `sentry_mode`, `user_present`) are `boolean | null` on the
 * wire — `null` means "unknown", NOT "off".
 *
 * These tests act as the regression guard for the null-as-false bug: an unknown
 * lock state used to render as a definitive "Unlocked" (amber), which is
 * dangerously misleading in a security context. The panel now renders three
 * distinct states, and the assertions below pin that behaviour.
 *
 * `react-i18next` is stubbed so `t(key, fallback)` returns the English fallback,
 * matching the convention in the sibling EnergyChargingPanel.test.tsx. No network
 * is touched — the component is pure props-in / markup-out.
 *
 * Coverage:
 *   1. Heading renders as a real heading; every labelled row is present.
 *   2. Lock tri-state: true→Locked(green), false→Unlocked(amber), null→Unknown.
 *   3. Sentry tri-state: true→Active(red badge), false→Inactive, null→Unknown.
 *   4. Doors/windows: string values render; null degrades to "Closed".
 *   5. User-present tri-state: true→Yes(green), false→No, null→em-dash.
 *   6. Detail line shows only when present.
 *   7. Remote start: true→Enabled(green), false→Disabled, null→em-dash.
 *   8. Empty state (role=status) when there is no data at all (null + undefined).
 *   9. Partial data: remote-start-only render hides the security section.
 *  10. a11y: every decorative icon is aria-hidden.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SecurityEvent } from '@/api/types'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import { SecurityPanel } from './SecurityPanel'

function makeSecurity(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    vehicle_id: 1,
    ts: '2026-01-01T00:00:00Z',
    event_type: 'lock',
    doors_open: null,
    windows_open: null,
    locked: true,
    sentry_mode: false,
    user_present: false,
    detail: null,
    source: 'test',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('SecurityPanel — structure & heading', () => {
  it('renders the localized heading and every labelled row when full data is present', () => {
    render(
      <SecurityPanel
        securityData={makeSecurity({ doors_open: '1 open', windows_open: '2 vented' })}
        remoteStartEnabled={true}
      />,
    )

    expect(screen.getByRole('heading', { name: /Security/i })).toBeInTheDocument()
    expect(screen.getByText('Vehicle lock status')).toBeInTheDocument()
    expect(screen.getByText('Sentry Mode')).toBeInTheDocument()
    expect(screen.getByText('Doors')).toBeInTheDocument()
    expect(screen.getByText('Windows')).toBeInTheDocument()
    expect(screen.getByText('User Present')).toBeInTheDocument()
    expect(screen.getByText('Remote Start')).toBeInTheDocument()
  })
})

describe('SecurityPanel — lock tri-state (null-as-false regression guard)', () => {
  it('renders a green "Locked" state when locked === true', () => {
    render(<SecurityPanel securityData={makeSecurity({ locked: true })} />)

    const label = screen.getByText('Locked')
    expect(label).toBeInTheDocument()
    expect(label).toHaveClass('text-green-400')
    expect(screen.queryByText('Unlocked')).toBeNull()
  })

  it('renders an amber "Unlocked" state when locked === false', () => {
    render(<SecurityPanel securityData={makeSecurity({ locked: false })} />)

    const label = screen.getByText('Unlocked')
    expect(label).toHaveClass('text-amber-400')
    expect(screen.queryByText('Locked')).toBeNull()
  })

  it('renders a muted "Unknown" state when locked is null — never a false "Unlocked"', () => {
    // sentry_mode + user_present are given definite values so "Unknown" is
    // unambiguously the lock label.
    render(
      <SecurityPanel securityData={makeSecurity({ locked: null, sentry_mode: false, user_present: false })} />,
    )

    const label = screen.getByText('Unknown')
    expect(label).toHaveClass('text-[var(--text-muted)]')
    // The core of the bug fix: an unknown lock must NOT read as Unlocked/Locked.
    expect(screen.queryByText('Unlocked')).toBeNull()
    expect(screen.queryByText('Locked')).toBeNull()
  })
})

describe('SecurityPanel — sentry tri-state', () => {
  it('shows an active red badge when sentry_mode === true', () => {
    render(<SecurityPanel securityData={makeSecurity({ sentry_mode: true })} />)

    const badge = screen.getByText('Active')
    expect(badge).toHaveClass('text-red-400')
    expect(badge).toHaveClass('bg-red-500/10')
  })

  it('shows "Inactive" when sentry_mode === false', () => {
    render(<SecurityPanel securityData={makeSecurity({ sentry_mode: false })} />)

    expect(screen.getByText('Inactive')).toBeInTheDocument()
    expect(screen.queryByText('Active')).toBeNull()
  })

  it('shows "Unknown" (not "Inactive") when sentry_mode is null', () => {
    render(
      <SecurityPanel securityData={makeSecurity({ sentry_mode: null, locked: true, user_present: false })} />,
    )

    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByText('Inactive')).toBeNull()
    expect(screen.queryByText('Active')).toBeNull()
  })
})

describe('SecurityPanel — doors & windows', () => {
  it('renders the door/window strings verbatim when present', () => {
    render(
      <SecurityPanel securityData={makeSecurity({ doors_open: '2 open', windows_open: '1 vented' })} />,
    )

    expect(screen.getByText('2 open')).toBeInTheDocument()
    expect(screen.getByText('1 vented')).toBeInTheDocument()
  })

  it('degrades doors and windows to "Closed" when both are null', () => {
    render(<SecurityPanel securityData={makeSecurity({ doors_open: null, windows_open: null })} />)

    expect(screen.getAllByText('Closed')).toHaveLength(2)
  })
})

describe('SecurityPanel — user presence tri-state', () => {
  it('renders a green "Yes" when user_present === true', () => {
    render(<SecurityPanel securityData={makeSecurity({ user_present: true })} />)

    const value = screen.getByText('Yes')
    expect(value).toHaveClass('text-green-400')
  })

  it('renders "No" when user_present === false', () => {
    render(<SecurityPanel securityData={makeSecurity({ user_present: false })} />)

    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('renders an em-dash when user_present is null', () => {
    // remoteStartEnabled is set so the only em-dash on screen is the presence value.
    render(
      <SecurityPanel
        securityData={makeSecurity({ user_present: null })}
        remoteStartEnabled={true}
      />,
    )

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('Yes')).toBeNull()
    expect(screen.queryByText('No')).toBeNull()
  })
})

describe('SecurityPanel — detail line', () => {
  it('renders the detail text when provided', () => {
    render(<SecurityPanel securityData={makeSecurity({ detail: 'Front left door ajar' })} />)

    expect(screen.getByText('Front left door ajar')).toBeInTheDocument()
  })

  it('omits the detail line when detail is null', () => {
    render(<SecurityPanel securityData={makeSecurity({ detail: null })} />)

    expect(screen.queryByText('Front left door ajar')).toBeNull()
  })
})

describe('SecurityPanel — remote start', () => {
  it('shows a green "Enabled" when remoteStartEnabled is true', () => {
    render(<SecurityPanel securityData={makeSecurity()} remoteStartEnabled={true} />)

    const value = screen.getByText('Enabled')
    expect(value).toHaveClass('text-green-400')
  })

  it('shows "Disabled" when remoteStartEnabled is false', () => {
    render(<SecurityPanel securityData={makeSecurity()} remoteStartEnabled={false} />)

    expect(screen.getByText('Disabled')).toBeInTheDocument()
    expect(screen.queryByText('Enabled')).toBeNull()
  })

  it('shows an em-dash when remoteStartEnabled is null', () => {
    render(<SecurityPanel securityData={makeSecurity()} remoteStartEnabled={null} />)

    // makeSecurity() defaults leave only the remote-start value as an em-dash.
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('SecurityPanel — empty & partial states', () => {
  it('renders the empty state (role=status) when securityData is null and no remote flag', () => {
    render(<SecurityPanel securityData={null} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No security data available')).toBeInTheDocument()
    // The security rows must be absent — not a blank panel.
    expect(screen.queryByText('Vehicle lock status')).toBeNull()
  })

  it('renders the empty state when securityData is undefined', () => {
    render(<SecurityPanel securityData={undefined} />)

    expect(screen.getByText('No security data available')).toBeInTheDocument()
    expect(screen.queryByText('Sentry Mode')).toBeNull()
  })

  it('shows only the remote-start row when securityData is null but a remote flag exists', () => {
    render(<SecurityPanel securityData={null} remoteStartEnabled={true} />)

    // Remote start still renders...
    expect(screen.getByText('Remote Start')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    // ...but the lock/sentry section is skipped and the empty state is not shown.
    expect(screen.queryByText('Vehicle lock status')).toBeNull()
    expect(screen.queryByText('Sentry Mode')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('SecurityPanel — accessibility', () => {
  it('marks every decorative icon as aria-hidden so it stays out of the a11y tree', () => {
    const { container } = render(
      <SecurityPanel
        securityData={makeSecurity({ doors_open: '1 open', windows_open: null })}
        remoteStartEnabled={true}
      />,
    )

    const icons = container.querySelectorAll('svg')
    expect(icons.length).toBeGreaterThan(0)
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'))
  })
})
