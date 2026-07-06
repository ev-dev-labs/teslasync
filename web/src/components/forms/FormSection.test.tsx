/**
 * FormSection tests.
 *
 * FormSection is a presentational "labeled fieldset" that groups form controls
 * under a heading with optional description. These tests lock in:
 *   1. The title renders as an <h3> heading.
 *   2. Children render inside the group.
 *   3. The wrapper is an accessible group (role="group") named by the title
 *      via aria-labelledby — the id association is internally consistent.
 *   4. The description renders and is wired via aria-describedby when present.
 *   5. No description paragraph / aria-describedby when the prop is omitted…
 *   6. …or when it is an explicit empty string (the falsy branch).
 *   7. Caller className is merged onto (not replacing) the base panel classes.
 *   8. Multiple children render in order.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormSection } from './FormSection'

describe('FormSection', () => {
  it('renders the title as a level-3 heading', () => {
    render(
      <FormSection title="Vehicle Settings">
        <input aria-label="name" />
      </FormSection>,
    )
    const heading = screen.getByRole('heading', { level: 3 })
    expect(heading).toHaveTextContent('Vehicle Settings')
    expect(heading.tagName.toLowerCase()).toBe('h3')
  })

  it('renders its children', () => {
    render(
      <FormSection title="Group">
        <button type="button">Save</button>
      </FormSection>,
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('exposes an accessible group named by the title', () => {
    render(
      <FormSection title="Appearance">
        <input aria-label="toggle" />
      </FormSection>,
    )
    // Accessible name is computed from the aria-labelledby → heading text.
    const group = screen.getByRole('group', { name: 'Appearance' })
    expect(group).toBeInTheDocument()
  })

  it('wires aria-labelledby to the actual heading id', () => {
    render(
      <FormSection title="Refresh Interval">
        <input aria-label="rate" />
      </FormSection>,
    )
    const group = screen.getByRole('group')
    const heading = screen.getByRole('heading', { level: 3 })
    const labelledBy = group.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(heading).toHaveAttribute('id', labelledBy)
  })

  it('renders the description and links it via aria-describedby', () => {
    render(
      <FormSection title="When" description="Choose the trigger.">
        <input aria-label="trigger" />
      </FormSection>,
    )
    expect(screen.getByText('Choose the trigger.')).toBeInTheDocument()

    const group = screen.getByRole('group')
    const describedBy = group.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()

    const description = document.getElementById(describedBy as string)
    expect(description).toHaveTextContent('Choose the trigger.')
    expect(description?.tagName.toLowerCase()).toBe('p')
  })

  it('omits the description paragraph and aria-describedby when no description is given', () => {
    render(
      <FormSection title="Display">
        <input aria-label="display" />
      </FormSection>,
    )
    const group = screen.getByRole('group')
    expect(group).not.toHaveAttribute('aria-describedby')
    expect(group.querySelector('p')).toBeNull()
  })

  it('treats an explicit empty-string description as absent', () => {
    render(
      <FormSection title="Transparency" description="">
        <input aria-label="opacity" />
      </FormSection>,
    )
    const group = screen.getByRole('group')
    expect(group).not.toHaveAttribute('aria-describedby')
    expect(group.querySelector('p')).toBeNull()
  })

  it('merges a caller className onto the base panel classes', () => {
    render(
      <FormSection title="Styled" className="ring-2">
        <input aria-label="field" />
      </FormSection>,
    )
    const group = screen.getByRole('group')
    expect(group).toHaveClass('glass-panel', 'p-5', 'sm:p-6', 'space-y-4', 'ring-2')
  })

  it('renders multiple children in document order', () => {
    render(
      <FormSection title="Multi">
        <button type="button">First</button>
        <button type="button">Second</button>
      </FormSection>,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['First', 'Second'])
  })
})
