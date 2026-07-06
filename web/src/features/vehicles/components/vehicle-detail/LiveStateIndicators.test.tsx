/**
 * LiveStateIndicators — behaviour + a11y coverage.
 *
 * The component renders a `role="group"` cluster of five status <Badge>s
 * (speed, lock, sentry, climate, charging) derived from a live VehicleState.
 * Each badge maps a slice of state to a semantic variant + label.
 *
 * `@/components/ui` Badge is replaced with a thin stand-in that surfaces its
 * `variant` / `size` / `dot` props as data-attributes, so the state→variant
 * mapping is directly assertable without coupling to Badge's Tailwind classes.
 * `useUnits().formatSpeed` is a spy so the SI→display speed passthrough (and
 * its `{ precision: 0 }` option) is verifiable, and `react-i18next` is stubbed
 * to echo the English fallback. No network is touched.
 *
 * It also locks in the hardening applied while elevating the file:
 *   - the "moving" check is null-safe (`(state.speed ?? 0) > 0`) so a parked
 *     car's null speed can't leak NaN into the variant decision;
 *   - the badge cluster is an aria-labelled group for assistive tech.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { VehicleState } from '@/api/types'

// Spy formatter shared with the `useUnits` mock below. Mirrors the lib
// contract: finite → "<n> km/h", null/undefined/NaN → em dash.
const mocks = vi.hoisted(() => ({
  formatSpeed: vi.fn((value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? `${value} km/h` : '—',
  ),
}))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatSpeed: mocks.formatSpeed }),
}))

// Echo the English fallback so assertions read naturally.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// Thin Badge stand-in: surfaces variant/size/dot for assertion, renders text.
vi.mock('@/components/ui', () => ({
  Badge: ({
    variant,
    size,
    dot,
    children,
  }: {
    variant?: string
    size?: string
    dot?: boolean
    children?: ReactNode
  }) => (
    <span
      data-testid="badge"
      data-variant={variant}
      data-size={size}
      data-dot={dot ? 'true' : 'false'}
    >
      {children}
    </span>
  ),
}))

import { LiveStateIndicators } from './LiveStateIndicators'

function makeState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 60,
    rated_range: 400_000,
    ideal_range: 420_000,
    odometer: 1_000_000,
    inside_temp: 21,
    outside_temp: 15,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '2024.0',
    ...overrides,
  }
}

/** Badges in DOM order: [speed, lock, sentry, climate, charging]. */
function badges(): HTMLElement[] {
  return within(screen.getByRole('group')).getAllByTestId('badge')
}

beforeEach(() => {
  mocks.formatSpeed.mockClear()
})

describe('LiveStateIndicators — structure & a11y', () => {
  it('renders exactly five status badges inside a labelled group', () => {
    render(<LiveStateIndicators state={makeState()} />)

    // The cluster is exposed to assistive tech as a named group rather than a
    // bare div of loose text.
    expect(screen.getByRole('group', { name: 'Live State' })).toBeInTheDocument()
    expect(badges()).toHaveLength(5)
  })

  it('renders every badge at the large size with a status dot', () => {
    render(<LiveStateIndicators state={makeState()} />)

    const rendered = badges()
    expect(rendered).toHaveLength(5)
    for (const badge of rendered) {
      expect(badge.dataset.size).toBe('lg')
      expect(badge.dataset.dot).toBe('true')
    }
  })

  it('renders human-readable text (not colour alone) for each indicator', () => {
    render(<LiveStateIndicators state={makeState()} />)

    const text = badges()
      .map((b) => b.textContent)
      .join(' | ')
    expect(text).toContain('Speed:')
    expect(text).toContain('Locked')
    expect(text).toContain('Sentry:')
    expect(text).toContain('Climate:')
    expect(text).toContain('Not Charging')
  })
})

describe('LiveStateIndicators — speed badge', () => {
  it('marks the vehicle moving (success) and shows the formatted speed', () => {
    render(<LiveStateIndicators state={makeState({ speed: 20 })} />)
    const [speed] = badges()

    // SI value + precision are forwarded to the shared formatter untouched.
    expect(mocks.formatSpeed).toHaveBeenCalledWith(20, { precision: 0 })
    expect(speed.dataset.variant).toBe('success')
    expect(speed.textContent).toBe('Speed: 20 km/h')
  })

  it('is neutral when the vehicle is stationary (speed 0)', () => {
    render(<LiveStateIndicators state={makeState({ speed: 0 })} />)
    const [speed] = badges()

    expect(speed.dataset.variant).toBe('neutral')
    expect(speed.textContent).toBe('Speed: 0 km/h')
  })

  it('treats a null speed (parked) as neutral without leaking NaN', () => {
    render(<LiveStateIndicators state={makeState({ speed: null as unknown as number })} />)
    const [speed] = badges()

    expect(mocks.formatSpeed).toHaveBeenCalledWith(null, { precision: 0 })
    expect(speed.dataset.variant).toBe('neutral')
    expect(speed.textContent).not.toMatch(/NaN/)
    expect(speed.textContent).toBe('Speed: —')
  })

  it('treats an undefined speed as neutral (guards NaN in the variant)', () => {
    render(<LiveStateIndicators state={makeState({ speed: undefined as unknown as number })} />)

    expect(badges()[0].dataset.variant).toBe('neutral')
  })
})

describe('LiveStateIndicators — lock badge', () => {
  it('shows a success "Locked" chip when the car is locked', () => {
    render(<LiveStateIndicators state={makeState({ is_locked: true })} />)
    const lock = badges()[1]

    expect(lock.textContent).toBe('Locked')
    expect(lock.dataset.variant).toBe('success')
  })

  it('shows a danger "Unlocked" chip when the car is unlocked', () => {
    render(<LiveStateIndicators state={makeState({ is_locked: false })} />)
    const lock = badges()[1]

    expect(lock.textContent).toBe('Unlocked')
    expect(lock.dataset.variant).toBe('danger')
  })
})

describe('LiveStateIndicators — sentry / climate / charging badges', () => {
  it('reflects sentry mode active (warning) vs off (neutral)', () => {
    const { rerender } = render(<LiveStateIndicators state={makeState({ sentry_mode: true })} />)
    let sentry = badges()[2]
    expect(sentry.textContent).toBe('Sentry: Active')
    expect(sentry.dataset.variant).toBe('warning')

    rerender(<LiveStateIndicators state={makeState({ sentry_mode: false })} />)
    sentry = badges()[2]
    expect(sentry.textContent).toBe('Sentry: Off')
    expect(sentry.dataset.variant).toBe('neutral')
  })

  it('reflects climate on (info) vs off (neutral)', () => {
    const { rerender } = render(<LiveStateIndicators state={makeState({ is_climate_on: true })} />)
    let climate = badges()[3]
    expect(climate.textContent).toBe('Climate: On')
    expect(climate.dataset.variant).toBe('info')

    rerender(<LiveStateIndicators state={makeState({ is_climate_on: false })} />)
    climate = badges()[3]
    expect(climate.textContent).toBe('Climate: Off')
    expect(climate.dataset.variant).toBe('neutral')
  })

  it('reflects charging (warning) vs not charging (neutral)', () => {
    const { rerender } = render(<LiveStateIndicators state={makeState({ is_charging: true })} />)
    let charging = badges()[4]
    expect(charging.textContent).toBe('Charging')
    expect(charging.dataset.variant).toBe('warning')

    rerender(<LiveStateIndicators state={makeState({ is_charging: false })} />)
    charging = badges()[4]
    expect(charging.textContent).toBe('Not Charging')
    expect(charging.dataset.variant).toBe('neutral')
  })
})
