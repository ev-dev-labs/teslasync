import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
