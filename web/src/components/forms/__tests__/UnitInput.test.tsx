/**
 * UnitInput integration tests.
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
import { SignalUnitInput } from '../SignalUnitInput'
import { UnitListInput } from '../UnitListInput'
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

describe('preferred-unit lists and constraints', () => {
  it('parses decimal-comma lists and preserves exact canonical thresholds', () => {
    mockSettings({ unit_of_temp: 'F', locale: 'de-DE' })
    const onChange = vi.fn()
    render(<UnitListInput label="Values" unit="temperature" values={[20, 25]} onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'Values' })
    expect(input).toHaveValue('68,00; 77,00')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '68,12345; 77,6789' } })
    expect(onChange.mock.calls.at(-1)?.[0][0]).toBeCloseTo((68.12345 - 32) / 1.8, 10)
    expect(onChange.mock.calls.at(-1)?.[0][1]).toBeCloseTo((77.6789 - 32) / 1.8, 10)
  })

  it('does not recommit a rounded list on untouched blur', () => {
    mockSettings({ unit_of_temp: 'F', decimal_precision: 0 })
    const onChange = vi.fn()
    render(<UnitListInput label="Values" unit="temperature" values={[20.123456]} onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'Values' })
    fireEvent.focus(input)
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps focused list units across preference changes and reports invalid tokens', () => {
    mockSettings({ unit_of_temp: 'F' })
    const onChange = vi.fn()
    const { rerender } = render(<UnitListInput label="Values" unit="temperature" values={[20]} onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'Values' })
    fireEvent.focus(input)
    mockSettings({ unit_of_temp: 'C' })
    rerender(<UnitListInput label="Values" unit="temperature" values={[20]} onChange={onChange} />)
    fireEvent.change(input, { target: { value: '77; 86' } })
    expect(onChange).toHaveBeenLastCalledWith([25, 30])
    fireEvent.change(input, { target: { value: '77; broken' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.getByText('Enter a valid number')).toBeInTheDocument()
  })

  it('validates canonical bounds after converting preferred temperature input', () => {
    mockSettings({ unit_of_temp: 'F' })
    const onChange = vi.fn()
    render(<UnitInput label="Temperature" unit="temperature" min={15} max={30} value={20} onChange={onChange} commitOnChange />)
    const input = screen.getByRole('textbox', { name: 'Temperature' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '77' } })
    expect(onChange).toHaveBeenLastCalledWith(25)
    fireEvent.change(input, { target: { value: '100' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
    fireEvent.blur(input)
    expect(screen.getByText('Enter a valid number')).toBeInTheDocument()
  })
})

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

  it('formats canonical meters as preferred kilometers at selected precision', () => {
    mockSettings({ unit_of_length: 'km', decimal_precision: 0 })
    render(<Harness label="Distance" unit="distance" initial={96560.64} />)
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
    expect(onCommit.mock.calls[0][0]).toBeCloseTo(31.2928, 7)
  })

  it('converts preferred km/h to canonical m/s on commit', () => {
    mockSettings({ unit_of_length: 'km', decimal_precision: 4 })
    const onCommit = vi.fn()
    render(<Harness label="Speed" unit="speed" initial={null} onCommit={onCommit} />)
    const input = screen.getByLabelText(/speed/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '100' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledTimes(1)
    const arg = onCommit.mock.calls[0][0]
    expect(arg).not.toBeNull()
    expect(arg).toBeCloseTo(27.77777778, 7)
  })

  it('commits on Enter key without losing focus contract', () => {
    mockSettings({ unit_of_length: 'mi' })
    const onCommit = vi.fn()
    render(<Harness label="Distance" unit="distance" initial={null} onCommit={onCommit} />)
    const input = screen.getByLabelText(/distance/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '42' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit.mock.calls[0][0]).toBeCloseTo(67592.448, 7)
  })

  it('strips trailing unit suffix from typed value before parsing', () => {
    mockSettings({ unit_of_length: 'km' })
    const onCommit = vi.fn()
    render(<Harness label="Speed" unit="speed" initial={null} onCommit={onCommit} />)
    const input = screen.getByLabelText(/speed/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '80 km/h' } })
    fireEvent.blur(input)
    expect(onCommit.mock.calls[0][0]).toBeCloseTo(22.22222222, 7)
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

  it('rounds display without rounding the committed canonical measurement', () => {
    mockSettings({ unit_of_length: 'mi', decimal_precision: 2 })
    const onCommit = vi.fn()
    render(<Harness label="Distance" unit="distance" initial={null} onCommit={onCommit} />)
    const input = screen.getByLabelText(/distance/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '60.0001' } })
    fireEvent.blur(input)
    expect(input.value).toBe('60.00')
    expect(onCommit.mock.calls[0][0]).toBeCloseTo(96560.8009344, 7)
  })
})

describe('UnitInput — re-display on settings change', () => {
  it('rerenders the same canonical value in the new unit when settings flip', () => {
    mockSettings({ unit_of_length: 'mi', decimal_precision: 0 })
    const { rerender } = render(
      <Harness label="Distance" unit="distance" initial={96560.64} />,
    )
    const input = screen.getByLabelText(/distance/i) as HTMLInputElement
    expect(input.value).toBe('60')
    expect(screen.getByTestId('unit-input-symbol').textContent).toBe('mi')

    // Flip to km
    mockSettings({ unit_of_length: 'km', decimal_precision: 0 })
    rerender(<Harness label="Distance" unit="distance" initial={96560.64} />)
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
    expect(screen.getByTestId('unit-input-symbol')).toHaveTextContent('mi')
  })

  it('does not commit a rounded display value when an unchanged field loses focus', () => {
    const onCommit = vi.fn()
    mockSettings({ unit_of_length: 'mi', decimal_precision: 0 })
    render(<Harness label="Distance" unit="distance" initial={96560.8009344} onCommit={onCommit} />)
    const input = screen.getByLabelText(/distance/i)
    fireEvent.focus(input)
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits edits using the units and locale present when editing began', () => {
    const onCommit = vi.fn()
    mockSettings({ unit_of_length: 'mi', locale: 'en-US', decimal_precision: 2 })
    const { rerender } = render(<Harness label="Distance" unit="distance" initial={null} onCommit={onCommit} />)
    const input = screen.getByLabelText(/distance/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '1.25' } })
    mockSettings({ unit_of_length: 'km', locale: 'de-DE', decimal_precision: 3 })
    rerender(<Harness label="Distance" unit="distance" initial={null} onCommit={onCommit} />)
    expect(input.value).toBe('1.25')
    expect(screen.getByTestId('unit-input-symbol')).toHaveTextContent('mi')
    fireEvent.blur(input)
    expect(onCommit.mock.calls[0][0]).toBeCloseTo(2011.68, 7)
    expect(input.value).toBe('2,012')
    expect(screen.getByTestId('unit-input-symbol')).toHaveTextContent('km')
  })

  it('does not commit twice or lose precision when Enter is followed by blur', () => {
    const onCommit = vi.fn()
    render(<Harness label="Distance" unit="distance" initial={null} onCommit={onCommit} />)
    const input = screen.getByLabelText(/distance/i)
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '60.0001' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit.mock.calls[0][0]).toBeCloseTo(96560.8009344, 7)
  })

  it('shows an explicit error for invalid text instead of silently fabricating zero', () => {
    const onCommit = vi.fn()
    render(<Harness label="Speed" unit="speed" initial={null} onCommit={onCommit} />)
    const input = screen.getByLabelText(/speed/i)
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'invalid' } })
    fireEvent.blur(input)
    expect(screen.getByText('Enter a valid number')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(onCommit).toHaveBeenCalledWith(null)
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
    // "0,5" in de-DE non-strict would be 0.5; strict goes through Number → NaN → null
    fireEvent.change(input, { target: { value: '0,5' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith(null)
  })

  describe('canonical signal input', () => {
    it('keeps draft state current with full-precision SI values while preserving typed text', () => {
      const onCommit = vi.fn()
      render(<Harness label="Speed" unit="speed" initial={null} onCommit={onCommit} commitOnChange />)
      const input = screen.getByLabelText(/speed/i) as HTMLInputElement
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: '70.0001' } })
      expect(onCommit.mock.calls[0][0]).toBeCloseTo(31.292844704, 8)
      expect(input.value).toBe('70.0001')
    })

    it('projects raw telemetry Pa into preferred pressure and saves Pa again', () => {
      const onCommit = vi.fn()
      mockSettings({ unit_of_pressure: 'bar', decimal_precision: 2 })
      const { rerender } = render(
        <SignalUnitInput label="Pressure" unitKind="pressure" value={241316.495} onChange={onCommit} />,
      )
      const input = screen.getByLabelText(/pressure/i) as HTMLInputElement
      expect(input.value).toBe('2.41')
      expect(screen.getByTestId('unit-input-symbol')).toHaveTextContent('bar')
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: '2.75' } })
      fireEvent.blur(input)
      expect(onCommit).toHaveBeenCalledWith(275000)

      mockSettings({ unit_of_pressure: 'psi', locale: 'de-DE', decimal_precision: 3 })
      rerender(<SignalUnitInput label="Pressure" unitKind="pressure" value={241316.495} onChange={onCommit} />)
      expect(input.value).toBe('35,000')
      expect(screen.getByTestId('unit-input-symbol')).toHaveTextContent('psi')
      fireEvent.focus(input)
      fireEvent.blur(input)
      expect(onCommit).toHaveBeenCalledTimes(1)
    })

    it('never invents a unit when signal metadata is unavailable', () => {
      render(<SignalUnitInput label="Value" unitKind={undefined} value={null} onChange={vi.fn()} />)
      expect(screen.getByLabelText('Value')).toHaveValue('')
      expect(screen.queryByTestId('unit-input-symbol')).toBeNull()
    })
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
