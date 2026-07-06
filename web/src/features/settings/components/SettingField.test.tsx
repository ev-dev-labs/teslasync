// SettingField — label + optional inline-help field wrapper tests.
//
// SettingField is a presentational wrapper: it renders an uppercase
// <label>, an optional <HelpIcon> (which itself flows through
// react-i18next + the shared <Tooltip>), and arbitrary children. We mock
// react-i18next the same way components/ui/__tests__/HelpIcon.test.tsx
// does so the help-icon aria-label / tooltip text resolve
// deterministically. This tree is pure presentation — no QueryClient and
// no network are required, mirroring the bare render() the HelpIcon suite
// already relies on.

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      opts?: { defaultValue?: string; field?: string } | string,
    ) => {
      if (typeof opts === 'string') return opts || key
      if (opts && typeof opts === 'object') {
        if (key === 'a11y.helpFor' && opts.field) return `Help for ${opts.field}`
        if ('defaultValue' in opts && opts.defaultValue) return opts.defaultValue
      }
      return key
    },
  }),
}))

import { SettingField, type SettingFieldHelp } from './SettingField'

describe('SettingField — label + children', () => {
  it('renders the label text inside a <label> element', () => {
    render(
      <SettingField label="Electricity Cost">
        <input aria-label="cost" />
      </SettingField>,
    )
    const label = screen.getByText('Electricity Cost')
    expect(label).toBeInTheDocument()
    expect(label.tagName).toBe('LABEL')
  })

  it('renders arbitrary children below the label', () => {
    render(
      <SettingField label="Timezone">
        <input aria-label="tz" defaultValue="UTC" />
      </SettingField>,
    )
    expect(screen.getByLabelText('tz')).toHaveValue('UTC')
  })

  it('leaves the label unassociated (no `for`) when htmlFor is omitted', () => {
    render(
      <SettingField label="Gas Price">
        <input aria-label="gas" />
      </SettingField>,
    )
    expect(screen.getByText('Gas Price').getAttribute('for')).toBeNull()
  })

  it('associates the label with its control when htmlFor is provided', () => {
    render(
      <SettingField label="Comparison MPG" htmlFor="mpg-input">
        <input id="mpg-input" />
      </SettingField>,
    )
    expect(screen.getByText('Comparison MPG').getAttribute('for')).toBe('mpg-input')
    // htmlFor wiring means the control is reachable by its label text.
    expect(screen.getByLabelText('Comparison MPG')).toBe(
      document.getElementById('mpg-input'),
    )
  })
})

describe('SettingField — inline help', () => {
  it('does not render a help icon when `help` is omitted', () => {
    render(
      <SettingField label="No Help">
        <input aria-label="x" />
      </SettingField>,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('renders nothing extra when `help` is an empty object (no text resolves)', () => {
    render(
      <SettingField label="Empty Help" help={{}}>
        <input aria-label="x" />
      </SettingField>,
    )
    // HelpIcon short-circuits to null when neither i18nKey nor content
    // yields any text — the empty {} must not leave a dangling trigger.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('renders a focusable help trigger with a per-field aria-label from `for`', () => {
    const help: SettingFieldHelp = {
      content: 'Cost per kWh used across analytics.',
      for: 'electricity-cost',
    }
    render(
      <SettingField label="Electricity Cost" help={help}>
        <input aria-label="x" />
      </SettingField>,
    )
    const trigger = screen.getByRole('button', { name: 'Help for electricity-cost' })
    expect(trigger).toBeInTheDocument()
    expect(trigger.getAttribute('type')).toBe('button')
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Cost per kWh used across analytics.',
    )
  })

  it('falls back to the generic "More info" label when `for` is omitted', () => {
    render(
      <SettingField label="Region" help={{ content: 'Pick a region.' }}>
        <input aria-label="x" />
      </SettingField>,
    )
    expect(screen.getByRole('button', { name: 'More info' })).toBeInTheDocument()
  })

  it('resolves help text from i18nKey, falling back to `content` via defaultValue', () => {
    render(
      <SettingField
        label="Electricity Cost"
        help={{
          i18nKey: 'help.fields.settings.electricityCost',
          content: 'Fallback helper copy.',
          for: 'electricity-cost',
        }}
      >
        <input aria-label="x" />
      </SettingField>,
    )
    expect(screen.getByRole('tooltip')).toHaveTextContent('Fallback helper copy.')
  })

  it('keeps the help trigger keyboard-focusable and dismissible on Escape', () => {
    render(
      <SettingField label="Focusable" help={{ content: 'x', for: 'f' }}>
        <input aria-label="x" />
      </SettingField>,
    )
    const trigger = screen.getByRole('button')
    trigger.focus()
    expect(document.activeElement).toBe(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(document.activeElement).not.toBe(trigger)
  })
})
