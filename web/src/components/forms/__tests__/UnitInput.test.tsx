/**
 * Phase-46 / Prompt 26 — UnitInput integration tests.
 *
 * Locks in:
 *   1. Renders an <input> with the user's display unit symbol as suffix.
 *   2. Stores canonical metric on commit; display reflects user pref.
 *   3. Settings change re-displays the same canonical value in the new
 *      unit WITHOUT losing precision (round-trip safety).
 *   4. Local typing is not clobbered by an external value/settings
 *      change while the input has focus.
 *   5. Blank input commits as null.
 *   6. parseStrict bypasses locale-aware parsing.
 *   7. forwards `required` / `aria-required` from the underlying Input.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { UnitInput, type UnitInputProps } from '../UnitInput'
import type { AppSettings } from '@/api/types'
import { useSettings } from '@/hooks/useSettings'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? '',
  }),
}))

const baseSettings: AppSettings = {
  unit_of_length: 'mi',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
  currency_symbol: '$',
  locale: 'en-US',
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...baseSettings, ...overrides }
}

function mockSettings(overrides: Partial<AppSettings> = {}): void {
  vi.mocked(useSettings).mockReturnValue({
    settings: settings(overrides),
  } as never)
}

interface HarnessProps extends Omit<UnitInputProps, 'value' | 'onChange'> {
  initial?: number | null
  onCommit?: (v: number | null) => void
}

function Harness({ initial = null, onCommit, ...rest }: HarnessProps) {
  const [v, setV] = useState<number | null>(initial)
  return (
    <UnitInput
      {...rest}
      value={v}
      onChange={(next) => {
        setV(next)
        onCommit?.(next)
      }}
    />
  )
}

beforeEach(() => {
  vi.mocked(useSettings).mockReset()
  mockSettings()
})

describe('UnitInput — display & symbol', () => {
  it('renders an input with the user-preferred unit symbol as suffix', () => {
    mockSettings({ unit_of_length: 'mi' })
    render(<Harness label="Distance" unit="distance" initial={100} />)
    const input = screen.getByLabelText(/distance/i) as HTMLInputElement
    expect(input).toBeInstanceOf(HTMLInputElement)
    expect(screen.getByTestId('unit-input-symbol').textContent).toBe('mi')
  })

  it('renders km/h symbol when settings switches to kilometres for speed', () => {
    mockSettings({ unit_of_length: 'km' })
    render(<Harness label="Speed" unit="speed" initial={60} />)
    expect(screen.getByTestId('unit-input-symbol').textContent).toBe('km/h')
  })

  it('renders °F symbol when settings switches to Fahrenheit for temperature', () => {
    mockSettings({ unit_of_temp: 'F' })
    render(<Harness label="Temp" unit="temperature" initial={20} />)
    expect(screen.getByTestId('unit-input-symbol').textContent).toBe('°F')
  })

  it('renders the configured currency symbol for currency', () => {
    mockSettings({ currency_symbol: '€' })
    render(<Harness label="Price" unit="currency" initial={1.23} />)
    expect(screen.getByTestId('unit-input-symbol').textContent).toBe('€')
  })

  it('renders kWh / % literals', () => {
    mockSettings()
    const { rerender } = render(<Harness label="Energy" unit="energy" initial={75} />)
    expect(screen.getByTestId('unit-input-symbol').textContent).toBe('kWh')
    rerender(<Harness label="Charge" unit="percent" initial={80} />)
    expect(screen.getByTestId('unit-input-symbol').textContent).toBe('%')
  })

  it('formats canonical 60 mi as "97" when display unit is km (decimal_precision=0)', () => {
    mockSettings({ unit_of_length: 'km', decimal_precision: 0 })
    render(<Harness label="Distance" unit="distance" initial={60} />)
    const input = screen.getByLabelText(/distance/i) as HTMLInputElement
    expect(input.value).toBe('97')
  })

  it('formats canonical 0 °C as "32" when display unit is °F', () => {
    mockSettings({ unit_of_temp: 'F', decimal_precision: 0 })
    render(<Harness label="Temp" unit="temperature" initial={0} />)
    const input = screen.getByLabelText(/temp/i) as HTMLInputElement
    expect(input.value).toBe('32')
  })

  it('formats null as empty string', () => {
    mockSettings()
    render(<Harness label="Distance" unit="distance" initial={null} />)
    const input = screen.getByLabelText(/distance/i) as HTMLInputElement
    expect(input.value).toBe('')
  })
})

describe('UnitInput — commit on blur / Enter', () => {
  it('parses typed value and commits canonical on blur', () => {
    mockSettings({ unit_of_length: 'mi' })
    const onCommit = vi.fn()
    render(<Harness label="Speed" unit="speed" initial={null} onCommit={onCommit} />)
    const input = screen.getByLabelText(/speed/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '70' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith(70)
  })

  it('converts typed display unit → canonical on commit (km/h → mph)', () => {
    mockSettings({ unit_of_length: 'km', decimal_precision: 4 })
    const onCommit = vi.fn()
    render(<Harness label="Speed" unit="speed" initial={null} onCommit={onCommit} />)
    const input = screen.getByLabelText(/speed/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '100' } })
    fireEvent.blur(input)
    // 100 km/h → ~62.137 mph (canonical)
    expect(onCommit).toHaveBeenCalledTimes(1)
    const arg = onCommit.mock.calls[0][0]
    expect(arg).not.toBeNull()
    expect(arg).toBeCloseTo(62.137, 2)
  })

  it('commits on Enter key without losing focus contract', () => {
    mockSettings({ unit_of_length: 'mi' })
    const onCommit = vi.fn()
    render(<Harness label="Distance" unit="distance" initial={null} onCommit={onCommit} />)
    const input = screen.getByLabelText(/distance/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '42' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(42)
  })

  it('strips trailing unit suffix from typed value before parsing', () => {
    mockSettings({ unit_of_length: 'km' })
    const onCommit = vi.fn()
    render(<Harness label="Speed" unit="speed" initial={null} onCommit={onCommit} />)
    const input = screen.getByLabelText(/speed/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '80 km/h' } })
    fireEvent.blur(input)
    expect(onCommit.mock.calls[0][0]).toBeCloseTo(49.71, 1)
  })

  it('commits null when the field is cleared', () => {
    mockSettings()
    const onCommit = vi.fn()
    render(<Harness label="Energy" unit="energy" initial={75} onCommit={onCommit} />)
    const input = screen.getByLabelText(/energy/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith(null)
  })

  it('renormalises display after commit (typing "60.0001" → blur → settings precision 2 → "60")', () => {
    mockSettings({ unit_of_length: 'mi', decimal_precision: 2 })
    const onCommit = vi.fn()
    render(<Harness label="Distance" unit="distance" initial={null} onCommit={onCommit} />)
    const input = screen.getByLabelText(/distance/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '60.0001' } })
    fireEvent.blur(input)
    // Display rounds to 2 decimals → "60"
    expect(input.value).toBe('60')
    // Canonical preserves precision (60.0001)
    expect(onCommit.mock.calls[0][0]).toBeCloseTo(60.0001)
  })
})

describe('UnitInput — re-display on settings change', () => {
  it('rerenders the same canonical value in the new unit when settings flip', () => {
    mockSettings({ unit_of_length: 'mi', decimal_precision: 0 })
    const { rerender } = render(
      <Harness label="Distance" unit="distance" initial={60} />,
    )
    const input = screen.getByLabelText(/distance/i) as HTMLInputElement
    expect(input.value).toBe('60')
    expect(screen.getByTestId('unit-input-symbol').textContent).toBe('mi')

    // Flip to km
    mockSettings({ unit_of_length: 'km', decimal_precision: 0 })
    rerender(<Harness label="Distance" unit="distance" initial={60} />)
    expect(input.value).toBe('97')
    expect(screen.getByTestId('unit-input-symbol').textContent).toBe('km')
  })

  it('does NOT clobber typed text while the input is focused (settings change ignored)', () => {
    mockSettings({ unit_of_length: 'mi', decimal_precision: 0 })
    const { rerender } = render(
      <Harness label="Distance" unit="distance" initial={60} />,
    )
    const input = screen.getByLabelText(/distance/i) as HTMLInputElement

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '123' } })

    // Settings switch under our feet while user is typing
    mockSettings({ unit_of_length: 'km', decimal_precision: 0 })
    rerender(<Harness label="Distance" unit="distance" initial={60} />)

    // The local buffer must be preserved
    expect(input.value).toBe('123')
  })
})

describe('UnitInput — strict & required', () => {
  it('strict mode bypasses locale-aware parsing', () => {
    mockSettings({ locale: 'de-DE' })
    const onCommit = vi.fn()
    render(
      <Harness
        label="Energy"
        unit="energy"
        initial={null}
        onCommit={onCommit}
        parseStrict
      />,
    )
    const input = screen.getByLabelText(/energy/i) as HTMLInputElement
    fireEvent.focus(input)
    // "0,5" in de-DE non-strict would be 0.5; strict goes through Number() → NaN → null
    fireEvent.change(input, { target: { value: '0,5' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith(null)
  })

  it('forwards `required` to the underlying input element', () => {
    mockSettings()
    render(<Harness label="Energy" unit="energy" initial={null} required />)
    const input = screen.getByLabelText(/energy/i) as HTMLInputElement
    expect(input.required).toBe(true)
    expect(input.getAttribute('aria-required')).toBe('true')
  })

  it('respects placeholder & disabled passthrough', () => {
    mockSettings()
    render(
      <Harness
        label="Distance"
        unit="distance"
        initial={null}
        placeholder="Enter distance"
        disabled
      />,
    )
    const input = screen.getByLabelText(/distance/i) as HTMLInputElement
    expect(input.placeholder).toBe('Enter distance')
    expect(input.disabled).toBe(true)
  })
})
