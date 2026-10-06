import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { HelperText } from '@/components/ui/Typography'
import { typography } from '@/lib/tokens'
import { FormSection } from './FormSection'

describe('FormSection production composition', () => {
  it('uses canonical typography without truncating long localized copy', () => {
    const title = 'DatenschutzeinstellungenUndBenachrichtigungspräferenzen'.repeat(3)
    const description = 'إعدادات الإشعارات والخصوصية — '.repeat(12)
    render(
      <FormSection title={title} description={description}>
        <Input label="Adresse" />
      </FormSection>,
    )

    const group = screen.getByRole('group', { name: title })
    const heading = within(group).getByRole('heading', { name: title, level: 3 })
    const supportingCopy = within(group).getByText(description.trim())
    expect(heading.textContent).toBe(title)
    expect(supportingCopy.textContent).toBe(description)
    expect(group).toHaveAccessibleDescription(description.trim())
    expect(group).toHaveClass('min-w-0')
    expect(heading).toHaveClass(...typography.role.panelTitle.split(' '), 'break-words')
    expect(supportingCopy).toHaveClass(...typography.role.helper.split(' '), 'break-words')
    expect(heading).not.toHaveClass('truncate')
    expect(supportingCopy).not.toHaveClass('truncate')
  })

  it('gives repeated titles independent heading and description associations', () => {
    render(
      <>
        <FormSection title="Settings" description="First vehicle">
          <Input label="First name" />
        </FormSection>
        <FormSection title="Settings" description="Second vehicle">
          <Input label="Second name" />
        </FormSection>
      </>,
    )

    const groups = screen.getAllByRole('group', { name: 'Settings' })
    const associationIds = groups.flatMap((group) => [
      group.getAttribute('aria-labelledby'),
      group.getAttribute('aria-describedby'),
    ])
    expect(associationIds.every(Boolean)).toBe(true)
    expect(new Set(associationIds).size).toBe(4)
    groups.forEach((group, index) => {
      const heading = within(group).getByRole('heading', { level: 3 })
      expect(group).toHaveAttribute('aria-labelledby', heading.id)
      expect(group).toHaveAccessibleDescription(index === 0 ? 'First vehicle' : 'Second vehicle')
    })
  })

  it('keeps section and child identity, edited values and focus across translated copy', () => {
    const content = (
      <Input id="vehicle-name" name="vehicle_name" label="Vehicle name" defaultValue="Roadster" />
    )
    const { rerender } = render(
      <FormSection title="Settings" description="Choose your preferences">
        {content}
      </FormSection>,
    )
    const group = screen.getByRole('group', { name: 'Settings' })
    const headingId = group.getAttribute('aria-labelledby')
    const descriptionId = group.getAttribute('aria-describedby')
    const input = screen.getByRole('textbox', { name: 'Vehicle name' })
    input.focus()
    fireEvent.change(input, { target: { value: 'Model S' } })

    rerender(
      <FormSection title="Einstellungen" description="Wählen Sie Ihre Einstellungen">
        {content}
      </FormSection>,
    )
    expect(screen.getByRole('group', { name: 'Einstellungen' })).toBe(group)
    expect(group).toHaveAttribute('aria-labelledby', headingId)
    expect(group).toHaveAttribute('aria-describedby', descriptionId)
    expect(group).toHaveAccessibleDescription('Wählen Sie Ihre Einstellungen')
    expect(screen.getByRole('textbox', { name: 'Vehicle name' })).toBe(input)
    expect(input).toHaveValue('Model S')
    expect(input).toHaveFocus()
  })

  it('restores the same description association after optional copy is removed', () => {
    const content = <Input label="Interval" />
    const { rerender } = render(
      <FormSection title="Refresh" description="In seconds">{content}</FormSection>,
    )
    const group = screen.getByRole('group', { name: 'Refresh' })
    const descriptionId = group.getAttribute('aria-describedby')
    rerender(<FormSection title="Refresh" description="">{content}</FormSection>)
    expect(group).not.toHaveAttribute('aria-describedby')
    expect(group.querySelector('p')).toBeNull()
    rerender(<FormSection title="Refresh" description="Sekunden">{content}</FormSection>)
    expect(group).toHaveAttribute('aria-describedby', descriptionId)
    expect(group).toHaveAccessibleDescription('Sekunden')
  })

  it('preserves field identity, ref, native attributes and external error feedback', () => {
    const ref = createRef<HTMLInputElement>()
    render(
      <FormSection title="General" description="Automation preferences">
        <HelperText id="name-guidance">Use a unique name</HelperText>
        <Input
          ref={ref}
          id="automation-name"
          name="automation_name"
          label="Name"
          required
          defaultValue="Morning"
          error="Name already exists"
          aria-describedby="name-guidance"
          className="caller-control"
        />
      </FormSection>,
    )

    const group = screen.getByRole('group', { name: 'General' })
    const input = within(group).getByRole('textbox', { name: /Name/ })
    expect(ref.current).toBe(input)
    expect(input).toHaveAttribute('id', 'automation-name')
    expect(input).toHaveAttribute('name', 'automation_name')
    expect(input).toBeRequired()
    expect(input).toHaveValue('Morning')
    expect(input).toHaveClass('caller-control')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', 'name-guidance automation-name-error')
    expect(input).toHaveAccessibleDescription('Use a unique name Name already exists')
    expect(within(group).getByRole('alert')).toHaveAttribute('id', 'automation-name-error')
    expect(group).toHaveAccessibleDescription('Automation preferences')
  })

  it('preserves child order, focusability and caller keyboard handlers without an extra focus stop', () => {
    const onSave = vi.fn()
    const onKeyDown = vi.fn()
    const onChange = vi.fn()
    render(
      <FormSection title="Display">
        <Input label="First" onChange={onChange} />
        <div><Input label="Second" /></div>
        <Button type="button" onClick={onSave} onKeyDown={onKeyDown}>Save</Button>
      </FormSection>,
    )

    const first = screen.getByRole('textbox', { name: 'First' })
    const second = screen.getByRole('textbox', { name: 'Second' })
    const save = screen.getByRole('button', { name: 'Save' })
    const group = screen.getByRole('group')
    expect(Array.from(group.querySelectorAll('input, button'))).toEqual([first, second, save])
    first.focus()
    expect(first).toHaveFocus()
    fireEvent.change(first, { target: { value: 'New value' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    second.focus()
    expect(second).toHaveFocus()
    save.focus()
    expect(save).toHaveFocus()
    fireEvent.keyDown(save, { key: 'Enter', code: 'Enter' })
    expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: 'Enter' }))
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(first).toHaveValue('New value')
    expect(group).not.toHaveAttribute('tabindex')
    expect([first, second, save].every((control) => control.tabIndex === 0)).toBe(true)
  })

  it('leaves native submission and reset with the caller form', () => {
    const submissions: FormData[] = []
    render(
      <form onSubmit={(event) => {
        event.preventDefault()
        submissions.push(new FormData(event.currentTarget))
      }}>
        <FormSection title="Vehicle">
          <Input label="Name" name="vehicle_name" defaultValue="Roadster" />
          <Button type="submit">Save</Button>
          <Button type="reset">Reset</Button>
        </FormSection>
      </form>,
    )

    const input = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(input, { target: { value: 'Model Y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(submissions).toHaveLength(1)
    expect(submissions[0].get('vehicle_name')).toBe('Model Y')
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(input).toHaveValue('Roadster')
    expect(submissions).toHaveLength(1)
  })

  it('retains caller styling and all supplied content without introducing async state', () => {
    render(
      <FormSection title="Appearance" className="p-2 sm:p-3 ring-2 caller-panel">
        <HelperText>Custom explanatory content</HelperText>
        <Input label="Editable" />
        <Input label="Unavailable" disabled />
        <Button type="button">Preview</Button>
      </FormSection>,
    )

    const group = screen.getByRole('group', { name: 'Appearance' })
    expect(group).toHaveClass('glass-panel', 'space-y-4', 'p-2', 'sm:p-3', 'ring-2', 'caller-panel')
    expect(group).not.toHaveClass('p-5', 'sm:p-6')
    expect(within(group).getByText('Custom explanatory content')).toBeVisible()
    expect(within(group).getByRole('textbox', { name: 'Editable' })).toBeEnabled()
    expect(within(group).getByRole('textbox', { name: 'Unavailable' })).toBeDisabled()
    expect(within(group).getByRole('button', { name: 'Preview' })).toBeEnabled()
    expect(group.querySelector('form')).toBeNull()
    expect(group).not.toHaveAttribute('aria-busy')
    expect(group).not.toHaveAttribute('aria-live')
  })
})
