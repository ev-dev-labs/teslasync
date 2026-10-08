import { createRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { typography } from '@/lib/tokens'
import { FormField } from './FormField'

describe('FormField', () => {
  it('renders the label and child input', () => {
    render(
      <FormField label="Name">
        <input id="name" defaultValue="" />
      </FormField>,
    )
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('associates the label with the htmlFor target via the generated id', () => {
    render(
      <FormField label="Email" htmlFor="email">
        <input id="email" type="email" />
      </FormField>,
    )
    const label = screen.getByText('Email').closest('label')
    expect(label).toHaveAttribute('for', 'email')
  })

  it('uses an auto-generated id when htmlFor is omitted', () => {
    render(
      <FormField label="Phone">
        <input />
      </FormField>,
    )
    const label = screen.getByText('Phone').closest('label')
    const forAttr = label?.getAttribute('for')
    expect(forAttr).toBeTruthy()
    expect(screen.getByRole('textbox')).toHaveAttribute('id', forAttr)
  })

  it('shows an asterisk and aria-label when required', () => {
    render(
      <FormField label="Name" required>
        <input />
      </FormField>,
    )
    const input = screen.getByRole('textbox', { name: /Name/i })
    expect(input).toHaveAttribute('aria-required', 'true')
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the hint when no error is set', () => {
    render(
      <FormField label="Threshold" hint="0–100 percent">
        <input />
      </FormField>,
    )
    expect(screen.getByText('0–100 percent')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-describedby')
  })

  it('renders the error and hides the hint when both are set', () => {
    render(
      <FormField label="Threshold" hint="0–100 percent" error="Must be a number">
        <input />
      </FormField>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Must be a number')
    expect(screen.queryByText('0–100 percent')).toBeNull()
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')
  })

  it('error text includes role=alert for screen readers', () => {
    render(
      <FormField label="Threshold" error="Required">
        <input />
      </FormField>,
    )
    const alert = screen.getByRole('alert')
    expect(alert.tagName.toLowerCase()).toBe('p')
    expect(alert).toHaveTextContent('Required')
  })

  it('renders neither hint nor error block when both are absent', () => {
    const { container } = render(
      <FormField label="Name">
        <input />
      </FormField>,
    )
    // Only one <p> ever appears for hint/error. With both absent, none.
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })

  it('uses shared typography without losing semantic feedback or rich hints', () => {
    const { rerender } = render(
      <FormField label="Threshold" hint={<strong>0–100 percent</strong>}>
        <input />
      </FormField>,
    )
    const input = screen.getByRole('textbox')
    const id = input.id
    expect(screen.getByText('Threshold').closest('label')).toHaveClass(typography.role.label)
    const hint = screen.getByText('0–100 percent').closest('p')
    expect(hint).toHaveClass(typography.role.helper, 'break-words')
    expect(hint).toHaveAttribute('id', `${id}-hint`)
    expect(input).toHaveAccessibleDescription('0–100 percent')

    rerender(
      <FormField label="Threshold" hint="0–100 percent" error="Must be a number">
        <input />
      </FormField>,
    )
    expect(input).toHaveAttribute('id', id)
    expect(screen.getByRole('alert')).toHaveClass(typography.role.error, 'break-words')
    expect(screen.getByRole('alert')).toHaveAttribute('id', `${id}-error`)
    expect(input).toHaveAttribute('aria-describedby', `${id}-error`)
    expect(input).toHaveAccessibleDescription('Must be a number')
  })

  it('preserves child identity, external descriptions, native attributes, ref and callbacks', () => {
    const ref = createRef<HTMLInputElement>()
    const onChange = vi.fn()
    const onFocus = vi.fn()
    render(
      <>
        <p id="external-hint">External instructions</p>
        <FormField label="Amount" hint="Enter an amount">
          <input
            id="amount"
            name="amount"
            ref={ref}
            required
            defaultValue="12"
            aria-label="Currency amount"
            aria-describedby="external-hint"
            aria-invalid="false"
            aria-required="true"
            onChange={onChange}
            onFocus={onFocus}
          />
        </FormField>
      </>,
    )
    const input = screen.getByRole('textbox', { name: 'Currency amount' })
    expect(ref.current).toBe(input)
    expect(input).toHaveAttribute('id', 'amount')
    expect(input).toHaveAttribute('name', 'amount')
    expect(input).toBeRequired()
    expect(input).toHaveValue('12')
    expect(input).toHaveAttribute('aria-describedby', 'external-hint amount-hint')
    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(input).toHaveAttribute('aria-required', 'true')
    expect(screen.getByText('Amount').closest('label')).toHaveAttribute('for', 'amount')
    fireEvent.change(input, { target: { value: '15' } })
    fireEvent.focus(input)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onFocus).toHaveBeenCalledTimes(1)
  })

  it('preserves disabled and native validation rather than introducing validation rules', () => {
    render(
      <FormField label="Code" required error="Invalid code">
        <input disabled required pattern="[A-Z]+" defaultValue="abc" />
      </FormField>,
    )
    const input = screen.getByRole('textbox', { name: /Code/ })
    expect(input).toBeDisabled()
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('pattern', '[A-Z]+')
    expect(input).toHaveValue('abc')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('keeps generated IDs distinct and stable when localized labels change', () => {
    const { rerender } = render(
      <>
        <FormField label="Name"><input /></FormField>
        <FormField label="Name"><input /></FormField>
      </>,
    )
    const ids = screen.getAllByRole('textbox').map(input => input.id)
    expect(ids[0]).not.toBe(ids[1])
    rerender(
      <>
        <FormField label="Nom"><input /></FormField>
        <FormField label="Nom"><input /></FormField>
      </>,
    )
    expect(screen.getAllByRole('textbox').map(input => input.id)).toEqual(ids)
  })

  it('preserves explicit target and multiple children without injecting group attributes', () => {
    const { container } = render(
      <FormField label="Costs" htmlFor="first-cost" hint="Both costs" className="custom-field">
        <input id="first-cost" aria-label="First cost" />
        <input id="second-cost" aria-label="Second cost" />
        <span>Contextual help</span>
      </FormField>,
    )
    expect(screen.getByText('Costs').closest('label')).toHaveAttribute('for', 'first-cost')
    expect(screen.getByRole('textbox', { name: 'First cost' })).not.toHaveAttribute('aria-describedby')
    expect(screen.getByRole('textbox', { name: 'Second cost' })).toHaveAttribute('id', 'second-cost')
    expect(screen.getByText('Contextual help')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('min-w-0', 'space-y-1.5', 'custom-field')
  })
})
