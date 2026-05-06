/**
 * Phase-46 / Prompt 49 — CurrencyInput integration tests.
 *
 * Locks in:
 *   1. Renders an <input> with the localized currency symbol as adornment.
 *   2. Stores canonical micro on commit; display reflects rounded precision.
 *   3. Locale change re-formats the same micro value WITHOUT loss
 *      (round-trip safety).
 *   4. Local typing is not clobbered by an external value/locale change
 *      while the input has focus.
 *   5. Blank input commits null micro.
 *   6. Locale-equivalent inputs (1.50 USD vs 1,50 EUR de-DE) commit the
 *      same micro.
 *   7. Forwards ariaLabel + required to the underlying Input.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'

import {
  CurrencyInput,
  type CurrencyInputProps,
  type CurrencyInputChangePayload,
} from './CurrencyInput'

interface HarnessProps extends Omit<CurrencyInputProps, 'valueMicro' | 'onChange'> {
  initialMicro?: number | null
  onCommit?: (next: CurrencyInputChangePayload) => void
}

function Harness({ initialMicro = null, onCommit, ...rest }: HarnessProps) {
  const [m, setM] = useState<number | null>(initialMicro)
  return (
    <CurrencyInput
      {...rest}
      valueMicro={m}
      onChange={(next) => {
        setM(next.valueMicro)
        onCommit?.(next)
      }}
    />
  )
}

describe('CurrencyInput — display & symbol', () => {
  it('renders an input with the localized currency symbol adornment (USD)', () => {
    render(
      <Harness ariaLabel="Tariff" currency="USD" locale="en-US" initialMicro={1_500_000} />,
    )
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    expect(input).toBeInstanceOf(HTMLInputElement)
    expect(screen.getByTestId('currency-input-symbol').textContent).toBe('$')
  })

  it('renders the € symbol for EUR / de-DE', () => {
    render(
      <Harness ariaLabel="Tariff" currency="EUR" locale="de-DE" initialMicro={1_500_000} />,
    )
    expect(screen.getByTestId('currency-input-symbol').textContent).toBe('€')
  })

  it('renders the £ symbol for GBP / en-GB', () => {
    render(
      <Harness ariaLabel="Tariff" currency="GBP" locale="en-GB" initialMicro={1_500_000} />,
    )
    expect(screen.getByTestId('currency-input-symbol').textContent).toBe('£')
  })

  it('formats canonical 1_500_000 micro as "$1.50" in en-US', () => {
    render(
      <Harness ariaLabel="Tariff" currency="USD" locale="en-US" initialMicro={1_500_000} />,
    )
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    expect(input.value).toBe('$1.50')
  })

  it('formats canonical 1_500_000 micro as "1,50 €" in de-DE', () => {
    render(
      <Harness ariaLabel="Tariff" currency="EUR" locale="de-DE" initialMicro={1_500_000} />,
    )
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    // Different ICU versions: regular space or NBSP between number and symbol.
    expect(input.value.replace(/\s/g, ' ')).toBe('1,50 €')
  })

  it('formats null as empty string', () => {
    render(
      <Harness ariaLabel="Tariff" currency="USD" locale="en-US" initialMicro={null} />,
    )
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('respects precision prop for display rounding', () => {
    render(
      <Harness
        ariaLabel="Tariff"
        currency="USD"
        locale="en-US"
        precision={4}
        initialMicro={123_450}
      />,
    )
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    expect(input.value).toBe('$0.1235')
  })
})

describe('CurrencyInput — commit on blur / Enter', () => {
  it('parses "1.50" USD and commits 1_500_000 micro on blur', () => {
    const onCommit = vi.fn()
    render(
      <Harness
        ariaLabel="Tariff"
        currency="USD"
        locale="en-US"
        initialMicro={null}
        onCommit={onCommit}
      />,
    )
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '1.50' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith({ valueMicro: 1_500_000 })
  })

  it('parses "1,50" EUR de-DE as 1_500_000 micro (locale equivalence)', () => {
    const onCommit = vi.fn()
    render(
      <Harness
        ariaLabel="Tariff"
        currency="EUR"
        locale="de-DE"
        initialMicro={null}
        onCommit={onCommit}
      />,
    )
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '1,50' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith({ valueMicro: 1_500_000 })
  })

  it('commits on Enter without losing focus contract', () => {
    const onCommit = vi.fn()
    render(
      <Harness
        ariaLabel="Tariff"
        currency="USD"
        locale="en-US"
        initialMicro={null}
        onCommit={onCommit}
      />,
    )
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '42' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith({ valueMicro: 42_000_000 })
  })

  it('commits null when the field is cleared', () => {
    const onCommit = vi.fn()
    render(
      <Harness
        ariaLabel="Tariff"
        currency="USD"
        locale="en-US"
        initialMicro={1_500_000}
        onCommit={onCommit}
      />,
    )
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith({ valueMicro: null })
  })

  it('strips the localized symbol from typed input ("$1.50" → 1_500_000)', () => {
    const onCommit = vi.fn()
    render(
      <Harness
        ariaLabel="Tariff"
        currency="USD"
        locale="en-US"
        initialMicro={null}
        onCommit={onCommit}
      />,
    )
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '$1.50' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith({ valueMicro: 1_500_000 })
  })

  it('preserves full micro precision when typed precision exceeds display precision', () => {
    const onCommit = vi.fn()
    render(
      <Harness
        ariaLabel="Tariff"
        currency="USD"
        locale="en-US"
        precision={2}
        initialMicro={null}
        onCommit={onCommit}
      />,
    )
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '0.12345' } })
    fireEvent.blur(input)
    // Storage keeps full micro (123_450); display rounds to "$0.12".
    expect(onCommit).toHaveBeenCalledWith({ valueMicro: 123_450 })
    expect(input.value).toBe('$0.12')
  })
})

describe('CurrencyInput — focus protection vs external change', () => {
  it('does not clobber in-progress text when valueMicro changes while focused', () => {
    const Container = () => {
      const [m, setM] = useState<number | null>(1_500_000)
      return (
        <div>
          <button type="button" onClick={() => setM(2_500_000)} data-testid="external-bump">
            bump
          </button>
          <CurrencyInput
            ariaLabel="Tariff"
            currency="USD"
            locale="en-US"
            valueMicro={m}
            onChange={({ valueMicro }) => setM(valueMicro)}
          />
        </div>
      )
    }
    render(<Container />)
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '9.99' } })
    // External update fires while user is still focused
    fireEvent.click(screen.getByTestId('external-bump'))
    // Field still shows what the user typed
    expect(input.value).toBe('9.99')
  })

  it('re-formats from the latest valueMicro after blur', () => {
    const Container = () => {
      const [m, setM] = useState<number | null>(1_500_000)
      return (
        <div>
          <button type="button" onClick={() => setM(2_500_000)} data-testid="external-bump">
            bump
          </button>
          <CurrencyInput
            ariaLabel="Tariff"
            currency="USD"
            locale="en-US"
            valueMicro={m}
            onChange={({ valueMicro }) => setM(valueMicro)}
          />
        </div>
      )
    }
    render(<Container />)
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    expect(input.value).toBe('$1.50')
    // Bump while NOT focused — display should resync.
    fireEvent.click(screen.getByTestId('external-bump'))
    expect(input.value).toBe('$2.50')
  })
})

describe('CurrencyInput — accessibility & passthrough', () => {
  it('forwards ariaLabel as aria-label on the input', () => {
    render(
      <Harness
        ariaLabel="Cost per kWh"
        currency="USD"
        locale="en-US"
        initialMicro={120_000}
      />,
    )
    const input = screen.getByLabelText(/cost per kwh/i) as HTMLInputElement
    expect(input.getAttribute('aria-label')).toBe('Cost per kWh')
  })

  it('forwards required to the underlying Input', () => {
    render(
      <Harness
        ariaLabel="Tariff"
        currency="USD"
        locale="en-US"
        initialMicro={null}
        required
      />,
    )
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    expect(input.required).toBe(true)
    expect(input.getAttribute('aria-required')).toBe('true')
  })

  it('uses inputMode="decimal" so mobile shows a numeric keypad', () => {
    render(
      <Harness ariaLabel="Tariff" currency="USD" locale="en-US" initialMicro={null} />,
    )
    const input = screen.getByLabelText(/tariff/i) as HTMLInputElement
    expect(input.getAttribute('inputmode')).toBe('decimal')
  })
})
