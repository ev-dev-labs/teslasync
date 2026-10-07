// SecuritySection unit tests.
//
// Coverage (the section's single export — `SecuritySection`, plus its two
// module-private helpers exercised through the rendered output):
//   1. Empty state: renders the "Security" heading + a role="status"
//      placeholder when `securityData` is null OR undefined and draws none of
//      the four metric cards.
//   2. Locked card: reads `state.is_locked` (NOT the event), surfacing Yes/No
//      and swapping the Lock (closed padlock) / Unlock (open padlock) glyph.
//   3. Sentry card: reads `state.sentry_mode`, surfacing Active/Off.
//   4. Doors card (`normalizeDoorState`): shows a raw string enum, treats an
//      empty / whitespace-only string as closed, and — the bug this suite locks
//      in — maps a NATIVE BOOLEAN door_state to Open/Closed semantics instead of
//      stringifying it to the literal "true" / "false".
//   5. Windows card (`windowOpenCount`): counts only windows reading > 0,
//      tolerates string-percent, numeric, and boolean signal shapes, preserves a
//      genuine 0 reading, ignores a non-numeric (NaN) string, and pluralises the
//      open count.
//   6. a11y: every decorative lucide icon (the Shield title glyph + all four
//      metric-card glyphs) is marked aria-hidden, so the panel's accessible
//      heading name is the copy alone.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { SecurityEvent, VehicleState } from '@/api/types'

// i18n stub: return the default-fallback string so assertions read on stable
// English copy independent of the en.json shape, and interpolate `{{count}}`
// exactly like the real i18next runtime (same convention the sibling
// MotorSection / BatteryRangePanel tests use).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        if (opts && typeof opts.defaultValue === 'string') return opts.defaultValue as string
        let out = fallback ?? key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            out = out.replace(`{{${k}}}`, String(v))
          }
        }
        return out
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { SecuritySection } from './SecuritySection'

function makeState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 72,
    rated_range: 500,
    ideal_range: 480,
    odometer: 12_000,
    inside_temp: 21,
    outside_temp: 15,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 48,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '2024.1',
    ...overrides,
  }
}

// A "closed everything" security event; individual tests override the single
// field under exercise. Window/door fields default to null so a card that isn't
// the subject of a test reliably shows its closed fallback.
function makeSecurity(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    vehicle_id: 1,
    ts: '2026-07-05T10:00:00Z',
    event_type: 'state',
    doors_open: null,
    windows_open: null,
    locked: true,
    sentry_mode: false,
    user_present: false,
    detail: null,
    source: 'signal_log',
    created_at: '2026-07-05T10:00:00Z',
    door_state: null,
    fd_window: null,
    fp_window: null,
    rd_window: null,
    rp_window: null,
    ...overrides,
  }
}

/** Scope to the label + value block of a single metric card. */
function card(label: string): HTMLElement {
  return screen.getByText(label).closest('div') as HTMLElement
}

afterEach(() => {
  cleanup()
})

describe('SecuritySection — empty state', () => {
  it('renders the Security heading + status placeholder and no cards when data is null', () => {
    render(<SecuritySection securityData={null} state={makeState()} />)

    expect(screen.getByRole('heading', { name: 'Security' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No security data available')).toBeInTheDocument()
    // None of the four metric-card labels render in the empty branch.
    expect(screen.queryByText('Locked')).toBeNull()
    expect(screen.queryByText('Sentry')).toBeNull()
    expect(screen.queryByText('Doors')).toBeNull()
    expect(screen.queryByText('Windows')).toBeNull()
  })

  it('renders the same placeholder when data is undefined', () => {
    render(<SecuritySection securityData={undefined} state={makeState()} />)

    expect(screen.getByText('No security data available')).toBeInTheDocument()
    expect(screen.queryByText('Windows')).toBeNull()
  })
})

describe('SecuritySection — locked card', () => {
  it('shows Yes with a closed-padlock glyph when the live state is locked', () => {
    const { container } = render(
      <SecuritySection securityData={makeSecurity()} state={makeState({ is_locked: true })} />,
    )

    expect(within(card('Locked')).getByText('Yes')).toBeInTheDocument()
    // lucide `Lock` → .lucide-lock; `Unlock` → .lucide-lock-open.
    expect(container.querySelector('.lucide-lock')).not.toBeNull()
    expect(container.querySelector('.lucide-lock-open')).toBeNull()
  })

  it('shows No with an open-padlock glyph when the live state is unlocked', () => {
    const { container } = render(
      <SecuritySection securityData={makeSecurity()} state={makeState({ is_locked: false })} />,
    )

    expect(within(card('Locked')).getByText('No')).toBeInTheDocument()
    expect(container.querySelector('.lucide-lock-open')).not.toBeNull()
    expect(container.querySelector('.lucide-lock')).toBeNull()
  })
})

describe('SecuritySection — sentry card', () => {
  it('reads sentry_mode from the live state: Active when enabled', () => {
    render(<SecuritySection securityData={makeSecurity()} state={makeState({ sentry_mode: true })} />)
    expect(within(card('Sentry')).getByText('Active')).toBeInTheDocument()
  })

  it('shows Off when sentry_mode is disabled', () => {
    render(
      <SecuritySection securityData={makeSecurity()} state={makeState({ sentry_mode: false })} />,
    )
    expect(within(card('Sentry')).getByText('Off')).toBeInTheDocument()
  })
})

describe('SecuritySection — doors card (normalizeDoorState)', () => {
  it('surfaces a raw string enum door_state verbatim', () => {
    render(<SecuritySection securityData={makeSecurity({ door_state: 'Open' })} state={makeState()} />)
    expect(within(card('Doors')).getByText('Open')).toBeInTheDocument()
  })

  it('falls back to Closed when door_state is null', () => {
    render(<SecuritySection securityData={makeSecurity({ door_state: null })} state={makeState()} />)
    expect(within(card('Doors')).getByText('Closed')).toBeInTheDocument()
  })

  it('treats an empty and a whitespace-only string as Closed', () => {
    const { rerender } = render(
      <SecuritySection securityData={makeSecurity({ door_state: '' })} state={makeState()} />,
    )
    expect(within(card('Doors')).getByText('Closed')).toBeInTheDocument()

    rerender(
      <SecuritySection securityData={makeSecurity({ door_state: '   ' })} state={makeState()} />,
    )
    expect(within(card('Doors')).getByText('Closed')).toBeInTheDocument()
  })

  it('maps a native boolean-true door_state to Open (never the literal "true")', () => {
    render(<SecuritySection securityData={makeSecurity({ door_state: true })} state={makeState()} />)

    expect(within(card('Doors')).getByText('Open')).toBeInTheDocument()
    expect(screen.queryByText('true')).toBeNull()
  })

  it('maps a native boolean-false door_state to Closed (never the literal "false")', () => {
    render(<SecuritySection securityData={makeSecurity({ door_state: false })} state={makeState()} />)

    expect(within(card('Doors')).getByText('Closed')).toBeInTheDocument()
    expect(screen.queryByText('false')).toBeNull()
  })
})

describe('SecuritySection — windows card (windowOpenCount)', () => {
  it('shows Closed when every window reads null', () => {
    render(<SecuritySection securityData={makeSecurity()} state={makeState()} />)
    expect(within(card('Windows')).getByText('Closed')).toBeInTheDocument()
  })

  it('shows Closed when every window reads a 0-percent string', () => {
    render(
      <SecuritySection
        securityData={makeSecurity({ fd_window: '0', fp_window: '0', rd_window: '0', rp_window: '0' })}
        state={makeState()}
      />,
    )
    expect(within(card('Windows')).getByText('Closed')).toBeInTheDocument()
  })

  it('counts a single open string-percent window', () => {
    render(
      <SecuritySection securityData={makeSecurity({ fd_window: '50' })} state={makeState()} />,
    )
    expect(within(card('Windows')).getByText('1 open')).toBeInTheDocument()
  })

  it('pluralises the count across multiple open windows of mixed signal shapes', () => {
    // rd_window arrives as a native number at runtime (the codec emits a raw
    // interface{}); fp_window as a string percent. Both > 0 → 2 open.
    render(
      <SecuritySection
        securityData={makeSecurity({
          fp_window: '30',
          rd_window: 45 as unknown as string,
        })}
        state={makeState()}
      />,
    )
    expect(within(card('Windows')).getByText('2 open')).toBeInTheDocument()
  })

  it('treats a boolean-true window as open and a boolean-false window as closed', () => {
    render(
      <SecuritySection
        securityData={makeSecurity({ fd_window: true, rp_window: false })}
        state={makeState()}
      />,
    )
    // Only the boolean-true window counts.
    expect(within(card('Windows')).getByText('1 open')).toBeInTheDocument()
  })

  it('ignores a non-numeric (NaN) string and preserves a genuine 0 reading', () => {
    render(
      <SecuritySection
        securityData={makeSecurity({
          fd_window: 'ajar', // Number('ajar') → NaN, not finite → skipped
          fp_window: 0 as unknown as string, // a real 0% reading → not open
          rp_window: '80', // the only genuinely-open window
        })}
        state={makeState()}
      />,
    )
    expect(within(card('Windows')).getByText('1 open')).toBeInTheDocument()
  })
})

describe('SecuritySection — accessibility', () => {
  it('marks every decorative icon (title glyph + all four card glyphs) aria-hidden', () => {
    const { container } = render(
      <SecuritySection securityData={makeSecurity()} state={makeState()} />,
    )

    const svgs = container.querySelectorAll('svg')
    // Shield title glyph + Lock/Unlock + Eye + DoorClosed + Car.
    expect(svgs.length).toBe(5)
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'))
  })

  it('exposes a Security heading whose accessible name is not polluted by the icon', () => {
    render(<SecuritySection securityData={makeSecurity()} state={makeState()} />)
    expect(screen.getByRole('heading', { name: 'Security' })).toBeInTheDocument()
  })
})
