/**
 * ActiveVehicleSegment — behaviour, a11y, and hardening coverage.
 *
 * The footer status-bar segment shows the active vehicle and, for multi-vehicle
 * accounts, opens a dialog of ordinary buttons to switch between them. These tests
 * pin every branch of the component:
 *   - render guards (empty fleet → nothing; the state hook is still called with a
 *     safe `0` so hook order stays stable);
 *   - the single-vehicle static chip (+ its icon-only compact form);
 *   - the multi-vehicle switcher (open/close, aria wiring, option selection);
 *   - the SI→display metrics composition (km / mi) and the label fallbacks.
 *
 * They also lock in the hardening applied while elevating the file:
 *   - `metricsLabel` never renders a literal "NaN%" / "NaN km" when a direct
 *     backend `state` payload carries non-finite battery / range values;
 *   - keyboard dismissal (Escape) and option selection both return focus to the
 *     trigger instead of dropping it on <body>.
 *
 * Collaborators are mocked at the module boundary so no network is touched. The
 * real `convertDistanceFromSI` runs so the unit math is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { Vehicle } from '@/types/vehicle'
import type { VehicleState } from '@/api/types'

/** U+00B7 middle dot — the separator the component composes into its labels. */
const DOT = '\u00B7'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  setVehicleId: vi.fn(),
  useVehicleState: vi.fn(),
  selected: {
    vehicle: null as Vehicle | null,
    vehicles: [] as Vehicle[],
    vehicleId: null as number | null,
  },
  unitDistance: 'km' as 'km' | 'mi',
}))

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicle: mocks.selected.vehicle,
    vehicles: mocks.selected.vehicles,
    vehicleId: mocks.selected.vehicleId,
    setVehicleId: mocks.setVehicleId,
  }),
}))

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicleState: (id: number, options?: { refetchInterval?: number }) =>
    mocks.useVehicleState(id, options),
}))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: mocks.unitDistance } }),
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

// Thin Tooltip stand-in: renders the trigger (children) plus the tooltip content
// in a queryable container, so the two never collide in role/text lookups.
vi.mock('@/components/ui/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>()
  return {
    ...actual,
    Tooltip: ({ content, children }: { content: ReactNode; children: ReactNode }) => (
      <span data-testid="tooltip">
        <span data-testid="tooltip-content">{content}</span>
        {children}
      </span>
    ),
  }
})

import { ActiveVehicleSegment } from './ActiveVehicleSegment'

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1,
    vehicle_id: 1,
    vin: 'VIN1',
    display_name: 'Model 3',
    model: 'model3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function makeState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 85,
    rated_range: 400_000,
    ideal_range: 420_000,
    odometer: 0,
    inside_temp: 0,
    outside_temp: 0,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '',
    ...overrides,
  }
}

/** Drive what `useVehicleState(...).data` resolves to for the next render. */
function setStateData(data: { state?: VehicleState; live?: boolean } | undefined) {
  mocks.useVehicleState.mockReturnValue({ data })
}

beforeEach(() => {
  cleanup()
  mocks.setVehicleId.mockReset()
  mocks.useVehicleState.mockReset()
  mocks.useVehicleState.mockReturnValue({ data: undefined })
  mocks.selected.vehicle = null
  mocks.selected.vehicles = []
  mocks.selected.vehicleId = null
  mocks.unitDistance = 'km'
})

// ── Render guards ────────────────────────────────────────────────────────────

describe('ActiveVehicleSegment — render guards', () => {
  it('renders nothing when the fleet is empty', () => {
    const { container } = render(<ActiveVehicleSegment />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByTestId('tooltip')).toBeNull()
  })

  it('still calls the state hook with a safe 0 (never null) so hook order is stable', () => {
    // vehicleId is null here; the component must coerce it to 0 for the hook
    // before its early return, otherwise TanStack Query would receive null.
    render(<ActiveVehicleSegment />)

    expect(mocks.useVehicleState).toHaveBeenCalledWith(0, { refetchInterval: 60_000 })
  })
})

// ── Single-vehicle static chip ───────────────────────────────────────────────

describe('ActiveVehicleSegment — single-vehicle chip', () => {
  beforeEach(() => {
    mocks.selected.vehicles = [makeVehicle()]
    mocks.selected.vehicle = makeVehicle()
    mocks.selected.vehicleId = 1
    setStateData({ state: makeState() })
  })

  it('renders a static, non-interactive chip (no switcher button)', () => {
    render(<ActiveVehicleSegment />)

    // A lone vehicle has nothing to switch to → no button, just a labelled chip.
    expect(screen.queryByRole('button')).toBeNull()
    const chip = screen.getByLabelText('Active vehicle: Model 3')
    expect(chip).toBeInTheDocument()
    expect(within(chip).getByText('Model 3')).toBeInTheDocument()
  })

  it('composes "<battery>% · <range> <unit>" in kilometres', () => {
    render(<ActiveVehicleSegment />)

    const chip = screen.getByLabelText('Active vehicle: Model 3')
    // 400_000 m ÷ 1000 = 400 km.
    expect(chip.textContent).toContain(`85% ${DOT} 400 km`)
  })

  it('reconverts the SI range when the user prefers miles', () => {
    mocks.unitDistance = 'mi'
    setStateData({ state: makeState({ battery_level: 90, rated_range: 400_000 }) })
    render(<ActiveVehicleSegment />)

    const chip = screen.getByLabelText('Active vehicle: Model 3')
    // 400_000 m ÷ 1609.344 = 248.55 → rounds to 249 mi.
    expect(chip.textContent).toContain(`90% ${DOT} 249 mi`)
    expect(chip.textContent).not.toContain('400 km')
  })

  it('never renders "NaN" when battery / range are non-finite (hardening)', () => {
    setStateData({
      state: makeState({
        battery_level: NaN as unknown as number,
        rated_range: NaN as unknown as number,
      }),
    })
    render(<ActiveVehicleSegment />)

    const chip = screen.getByLabelText('Active vehicle: Model 3')
    expect(chip.textContent).not.toMatch(/NaN/)
    // Non-finite values collapse to a safe zero rather than a broken string.
    expect(chip.textContent).toContain(`0% ${DOT} 0 km`)
    expect(screen.getByTestId('tooltip-content').textContent).not.toMatch(/NaN/)
  })

  it('omits the metrics entirely while the live snapshot is still loading', () => {
    setStateData(undefined)
    render(<ActiveVehicleSegment />)

    const chip = screen.getByLabelText('Active vehicle: Model 3')
    expect(within(chip).getByText('Model 3')).toBeInTheDocument()
    // No battery percentage when there is no state — the chip degrades, not crashes.
    expect(within(chip).queryByText(/\d+%/)).toBeNull()
  })

  it('hides the visible label + metrics in icon-only mode but keeps the a11y name', () => {
    render(<ActiveVehicleSegment iconOnly />)

    const chip = screen.getByLabelText('Active vehicle: Model 3')
    expect(chip).toBeInTheDocument()
    expect(within(chip).queryByText('Model 3')).toBeNull()
    expect(within(chip).queryByText(new RegExp(`85% ${DOT} 400 km`))).toBeNull()
  })

  it('surfaces vehicle name, model, and metrics in the tooltip content', () => {
    render(<ActiveVehicleSegment />)

    const tip = screen.getByTestId('tooltip-content')
    expect(tip.textContent).toContain('Active vehicle')
    expect(tip.textContent).toContain('Model 3')
    expect(tip.textContent).toContain('model3')
    expect(tip.textContent).toContain(`85% ${DOT} 400 km`)
  })
})

// ── Multi-vehicle switcher ───────────────────────────────────────────────────

describe('ActiveVehicleSegment — multi-vehicle switcher', () => {
  beforeEach(() => {
    mocks.selected.vehicles = [makeVehicle(), makeVehicle({ id: 2, display_name: 'Model Y' })]
    mocks.selected.vehicle = makeVehicle()
    mocks.selected.vehicleId = 1
    setStateData({ state: makeState() })
  })

  it('renders a collapsed switcher button with dialog aria semantics', () => {
    render(<ActiveVehicleSegment />)

    const trigger = screen.getByRole('button', { name: /Switch vehicle \(Model 3\)/ })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).not.toHaveAttribute('aria-controls')
    expect(screen.queryByRole('dialog', { name: 'Switch vehicle' })).toBeNull()
  })

  it('opens a dialog containing ordinary vehicle buttons', () => {
    render(<ActiveVehicleSegment />)

    const trigger = screen.getByRole('button', { name: /Switch vehicle/ })
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Switch vehicle' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getAllByRole('button')).toHaveLength(2)
  })

  it('marks the active vehicle as current', () => {
    render(<ActiveVehicleSegment />)
    fireEvent.click(screen.getByRole('button', { name: /Switch vehicle/ }))

    const options = within(
      screen.getByRole('dialog', { name: 'Switch vehicle' }),
    ).getAllByRole('button')
    expect(options[0]).toHaveAttribute('aria-current', 'true')
    expect(options[1]).not.toHaveAttribute('aria-current')
    expect(within(options[1]).getByText('Model Y')).toBeInTheDocument()
  })

  it('picking an option commits the id, closes the popover, and restores focus', () => {
    render(<ActiveVehicleSegment />)
    const trigger = screen.getByRole('button', { name: /Switch vehicle/ })
    fireEvent.click(trigger)

    const secondOption = within(
      screen.getByRole('dialog', { name: 'Switch vehicle' }),
    ).getAllByRole('button')[1]
    fireEvent.click(secondOption)

    expect(mocks.setVehicleId).toHaveBeenCalledTimes(1)
    expect(mocks.setVehicleId).toHaveBeenCalledWith(2)
    expect(screen.queryByRole('dialog', { name: 'Switch vehicle' })).toBeNull()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // Focus returns to the trigger — the option button unmounted with the dialog.
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on Escape and returns focus to the trigger', () => {
    render(<ActiveVehicleSegment />)
    const trigger = screen.getByRole('button', { name: /Switch vehicle/ })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Switch vehicle' })).toBeInTheDocument()

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(screen.queryByRole('dialog', { name: 'Switch vehicle' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(mocks.setVehicleId).not.toHaveBeenCalled()
  })

  it('closes on an outside pointer interaction without committing a selection', () => {
    render(<ActiveVehicleSegment />)
    fireEvent.click(screen.getByRole('button', { name: /Switch vehicle/ }))
    expect(screen.getByRole('dialog', { name: 'Switch vehicle' })).toBeInTheDocument()

    act(() => {
      fireEvent.pointerDown(document.body)
    })

    expect(screen.queryByRole('dialog', { name: 'Switch vehicle' })).toBeNull()
    expect(mocks.setVehicleId).not.toHaveBeenCalled()
  })

  it('keeps the click inside the popover from closing it', () => {
    render(<ActiveVehicleSegment />)
    fireEvent.click(screen.getByRole('button', { name: /Switch vehicle/ }))
    const dialog = screen.getByRole('dialog', { name: 'Switch vehicle' })

    act(() => {
      fireEvent.pointerDown(dialog)
    })

    expect(screen.getByRole('dialog', { name: 'Switch vehicle' })).toBeInTheDocument()
  })

  it('renders an icon-only trigger without the visible label or chevron text', () => {
    render(<ActiveVehicleSegment iconOnly />)

    const trigger = screen.getByRole('button', { name: /Switch vehicle \(Model 3\)/ })
    expect(trigger).toBeInTheDocument()
    expect(within(trigger).queryByText('Model 3')).toBeNull()
    expect(within(trigger).queryByText(new RegExp(`85% ${DOT} 400 km`))).toBeNull()
  })

  it('subscribes to the active vehicle state with a 60s footer-tier interval', () => {
    mocks.selected.vehicles = [makeVehicle({ id: 3 }), makeVehicle({ id: 4 })]
    mocks.selected.vehicle = makeVehicle({ id: 3 })
    mocks.selected.vehicleId = 3
    render(<ActiveVehicleSegment />)

    expect(mocks.useVehicleState).toHaveBeenCalledWith(3, { refetchInterval: 60_000 })
  })
})

// ── Label fallbacks ──────────────────────────────────────────────────────────

describe('ActiveVehicleSegment — label fallbacks', () => {
  it('falls back to "Vehicle <id>" when the record is not yet resolved', () => {
    mocks.selected.vehicles = [makeVehicle({ id: 7 }), makeVehicle({ id: 8 })]
    mocks.selected.vehicle = null // record not loaded yet
    mocks.selected.vehicleId = 7
    setStateData({ state: makeState() })
    render(<ActiveVehicleSegment />)

    expect(screen.getByRole('button', { name: /Switch vehicle \(Vehicle 7\)/ })).toBeInTheDocument()
  })

  it('falls back to the VIN when the vehicle has no display name', () => {
    const noName = makeVehicle({ display_name: '', vin: 'VIN-XYZ' })
    mocks.selected.vehicles = [noName, makeVehicle({ id: 2 })]
    mocks.selected.vehicle = noName
    mocks.selected.vehicleId = 1
    setStateData({ state: makeState() })
    render(<ActiveVehicleSegment />)

    expect(screen.getByRole('button', { name: /Switch vehicle \(VIN-XYZ\)/ })).toBeInTheDocument()
  })
})
