/**
 * VehicleHeader — behaviour, branch, null-safety, a11y and i18n coverage for the
 * vehicle-detail page header (its sole export: the `VehicleHeader` component).
 *
 * The header takes a possibly-`undefined` `vehicle` (the detail query is still in
 * flight on first paint), a derived `status`, a `waking` flag and an `onWake`
 * callback. This suite pins the three hardening fixes plus the a11y/interaction
 * contract:
 *   1. STATUS — the badge renders the localised, capitalised label
 *      ("online" → "Online") via t(`vehicle.state.${status}`, LABEL), reflects
 *      the status→variant colour mapping, and stays readable ("mystery", never
 *      the raw i18n key) for an unexpected runtime value.
 *   2. MODEL  — model + trim collapse to one clean chip: no trailing space when
 *      the trim is absent (regression), and an em-dash placeholder — never a
 *      lone-whitespace chip — when the vehicle hasn't loaded.
 *   3. VIN    — an empty-string / missing VIN renders "—", never a blank <p>.
 *   4. A11Y   — the back link is labelled, its arrow icon + the wake icon are
 *      hidden from assistive tech, and the wake button exposes its busy state.
 *   5. WAKE   — clicking fires `onWake` once; the busy state disables the button.
 *
 * Strategy (mirrors the sibling RecentChargesSection.test.tsx / FleetSummary.test.tsx):
 *   - react-i18next is mocked so `t(key, fallback)` renders the English fallback
 *     deterministically while a spy records the (key, fallback) pairs.
 *   - renders are wrapped in MemoryRouter because the back <Link> needs router
 *     context.
 *   - user-event is intentionally NOT a dependency (see web/package.json); the
 *     one interactive control (the wake <button>) is exercised with fireEvent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Vehicle, VehicleStatus } from '@/api/types'

// jsdom lacks matchMedia; install a benign stub before anything evaluates in case
// a transitively-imported shared component reads it at render.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false
      },
    })) as unknown as typeof window.matchMedia
  }
})

// i18n → return the developer fallback so labels read as real English; the spy
// records the (key, fallback) pairs so the i18n contract can be asserted.
const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}))
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({ t: tSpy, i18n: { language: 'en', changeLanguage: vi.fn() } }),
  }
})

import { VehicleHeader } from './VehicleHeader'

function makeVehicle(over: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1,
    vehicle_id: 100,
    vin: '5YJ3E1EA7KF000000',
    display_name: 'My Tesla',
    model: 'Model 3',
    trim_badging: 'Performance',
    exterior_color: 'DeepBlueMetallic',
    wheel_type: 'Stiletto20',
    state: 'online',
    healthy: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    ...over,
  }
}

function renderHeader(
  opts: {
    vehicle?: Vehicle | undefined
    status?: VehicleStatus
    onWake?: () => void
    waking?: boolean
  } = {},
) {
  const onWake = opts.onWake ?? vi.fn()
  const view = render(
    <MemoryRouter>
      <VehicleHeader
        // `'vehicle' in opts` lets a caller pass `vehicle: undefined` explicitly
        // to exercise the loading branch without falling back to a real vehicle.
        vehicle={'vehicle' in opts ? opts.vehicle : makeVehicle()}
        status={opts.status ?? 'online'}
        onWake={onWake}
        waking={opts.waking ?? false}
      />
    </MemoryRouter>,
  )
  return { ...view, onWake }
}

beforeEach(() => tSpy.mockClear())
afterEach(() => cleanup())

describe('VehicleHeader — status badge', () => {
  it.each([
    ['online', 'Online'],
    ['charging', 'Charging'],
    ['asleep', 'Asleep'],
    ['offline', 'Offline'],
  ] as const)('renders status "%s" as the localised label "%s"', (status, label) => {
    renderHeader({ status })
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(tSpy).toHaveBeenCalledWith(`vehicle.state.${status}`, label)
  })

  it('reflects the status→variant mapping in the badge colour', () => {
    const { unmount } = renderHeader({ status: 'online' })
    // online → 'success' variant → green chip.
    expect(screen.getByText('Online').className).toMatch(/bg-green/)
    unmount()
    renderHeader({ status: 'offline' })
    // offline → 'danger' variant → red chip.
    expect(screen.getByText('Offline').className).toMatch(/bg-red/)
  })

  it('keeps an unexpected status readable (raw value, not the i18n key)', () => {
    // Defensive fallback: VEHICLE_STATE_LABELS has no entry for a rogue value, so
    // the raw status is passed as the t() default instead of leaking the key.
    renderHeader({ status: 'mystery' as VehicleStatus })
    expect(screen.getByText('mystery')).toBeInTheDocument()
    expect(screen.queryByText('vehicle.state.mystery')).toBeNull()
    expect(tSpy).toHaveBeenCalledWith('vehicle.state.mystery', 'mystery')
  })
})

describe('VehicleHeader — model + trim chip', () => {
  it('joins model and trim into one label', () => {
    renderHeader({ vehicle: makeVehicle({ model: 'Model 3', trim_badging: 'Performance' }) })
    expect(screen.getByText('Model 3 Performance')).toBeInTheDocument()
  })

  it('omits the trailing space when the trim is empty (regression)', () => {
    renderHeader({ vehicle: makeVehicle({ model: 'Model Y', trim_badging: '' }) })
    // getByText normalises whitespace, so assert the exact textContent to catch
    // the old `${model} ${trim}` trailing-space artifact.
    expect(screen.getByText('Model Y').textContent).toBe('Model Y')
  })

  it('renders an em-dash placeholder (never a lone-space chip) with no vehicle', () => {
    renderHeader({ vehicle: undefined })
    // While loading, both the model chip and the VIN line collapse to "—".
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('shows the placeholder for a blank model even when a VIN is present', () => {
    renderHeader({
      vehicle: makeVehicle({ model: '', trim_badging: '', vin: '5YJXCAE40LF000000' }),
    })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('5YJXCAE40LF000000')).toBeInTheDocument()
  })
})

describe('VehicleHeader — VIN', () => {
  it('renders the trimmed VIN when present', () => {
    renderHeader({ vehicle: makeVehicle({ vin: '  5YJ3E1EA7KF123456  ' }) })
    expect(screen.getByText('5YJ3E1EA7KF123456')).toBeInTheDocument()
  })

  it('falls back to "—" for an empty-string VIN (regression: blank <p>)', () => {
    renderHeader({ vehicle: makeVehicle({ model: 'Model 3', trim_badging: 'LR', vin: '' }) })
    // The model chip reads "Model 3 LR", so the only "—" is the VIN line.
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('Model 3 LR')).toBeInTheDocument()
  })
})

describe('VehicleHeader — back link a11y', () => {
  it('exposes a labelled back link to the vehicles list', () => {
    renderHeader()
    const link = screen.getByRole('link', { name: 'Back' })
    expect(link).toHaveAttribute('href', '/vehicles')
    expect(tSpy).toHaveBeenCalledWith('common.back', 'Back')
  })

  it('hides the decorative back-arrow icon from assistive tech', () => {
    renderHeader()
    const icon = screen.getByRole('link', { name: 'Back' }).querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('VehicleHeader — wake button', () => {
  it('renders the wake control and fires onWake once when clicked', () => {
    const { onWake } = renderHeader({ waking: false })
    const btn = screen.getByRole('button', { name: 'Wake Up' })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(onWake).toHaveBeenCalledTimes(1)
    expect(tSpy).toHaveBeenCalledWith('common.wakeUp', 'Wake Up')
  })

  it('hides the decorative power icon from assistive tech', () => {
    renderHeader({ waking: false })
    const icon = screen.getByRole('button', { name: 'Wake Up' }).querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('disables the button and marks it busy while waking', () => {
    renderHeader({ waking: true })
    const btn = screen.getByRole('button', { name: 'Wake Up' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })
})
