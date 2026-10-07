/**
 * UnixPermissionTool contract tests.
 *
 * UnixPermissionTool is a "Utilities" devtool that turns a 3-digit octal
 * permission (e.g. 755) into its rwx symbolic notation, broken down per scope
 * (owner / group / other) plus a combined, copyable string. It is a pure,
 * self-contained widget (no network, react-query, or router), so these tests
 * drive it entirely through its two controls and assert the rendered contract
 * across every facet:
 *
 *   1. Structure   — the tool renders its (i18n-defaulted) title/description and
 *                    the two labelled controls, and the preset picker offers the
 *                    exact catalogue of six presets.
 *   2. Conversion  — the default 755 (and a typed 644) are decoded per scope and
 *                    combined, using the real PERMS map so the assertions can
 *                    never drift from the component's own lookup table.
 *   3. Presets     — choosing a preset from the <Select> recomputes every scope.
 *   4. Empty state — clearing the field replaces the breakdown with a neutral
 *                    EmptyState (role="status"), never a blank panel (guideline
 *                    #6). This is the source bug this elevation fixes — the old
 *                    code hid every section when the value was not valid.
 *   5. Invalid     — out-of-range digits (888), a too-short value (75), and a
 *                    non-octal value (7ab) each degrade to a *distinct* invalid
 *                    hint rather than silently disappearing.
 *   6. Whitespace  — a whitespace-only value reads as "empty", not "invalid".
 *   7. a11y        — the input is reachable by its label, the decorative Lock
 *                    glyph is hidden from assistive tech, and the breakdown grid
 *                    is an accessibly-named list of three items.
 *   8. Interaction — the CopyButton writes the *symbolic* string (not the raw
 *                    octal) to the clipboard and confirms with a "Copied" toggle.
 *   9. Lifecycle   — the memoised result re-derives correctly across the full
 *                    ok -> empty -> invalid -> ok transition sequence.
 *
 * `react-i18next` is mocked (the same seam the sibling devtools tests use) so
 * `t(key, fallback)` returns the English default and label assertions stay
 * deterministic.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import { UnixPermissionTool } from './UnixPermissionTool'
import { PERMS } from '../constants'

const RESULTS_LABEL = 'Permission breakdown by scope'
const EMPTY_MSG = 'Enter a 3-digit octal value to see its symbolic notation.'
const INVALID_FRAGMENT = 'Enter a valid 3-digit octal value'
const PRESET_VALUES = ['755', '644', '700', '600', '777', '444']

/** The symbolic string the component should derive for `octal`, from PERMS. */
function sym(octal: string): string {
  return PERMS[octal[0]] + PERMS[octal[1]] + PERMS[octal[2]]
}

const octalInput = () =>
  screen.getByLabelText('Octal Permission') as HTMLInputElement
const presetSelect = () => screen.getByLabelText('Presets') as HTMLSelectElement
const resultsList = () => screen.queryByRole('list', { name: RESULTS_LABEL })
const codeEl = () => screen.queryByText(/^[rwx-]{9}$/, { selector: 'code' })
const copyBtn = () => screen.queryByRole('button', { name: 'Copy' })

/** The breakdown <li> whose label matches a scope name (Owner/Group/Other). */
function scopeCell(label: 'Owner' | 'Group' | 'Other'): HTMLElement {
  const list = screen.getByRole('list', { name: RESULTS_LABEL })
  const li = within(list).getByText(label).closest('li')
  if (!li) throw new Error(`no breakdown cell for scope "${label}"`)
  return li as HTMLElement
}

function typeOctal(v: string) {
  fireEvent.change(octalInput(), { target: { value: v } })
}

describe('UnixPermissionTool', () => {
  it('renders its title, description, and both labelled controls with the preset catalogue', () => {
    render(<UnixPermissionTool />)

    expect(
      screen.getByRole('heading', { name: 'Unix Permissions' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Convert an octal permission (e.g. 755) to rwx symbolic notation.',
      ),
    ).toBeInTheDocument()

    // Both controls are reachable by their accessible label and are the right
    // element kind (shared <Input>/<Select>, not raw HTML that lost its label).
    expect(octalInput().tagName).toBe('INPUT')
    expect(presetSelect().tagName).toBe('SELECT')

    // The preset picker offers exactly the documented catalogue.
    expect(
      within(presetSelect())
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value),
    ).toEqual(PRESET_VALUES)
  })

  it('decodes the default 755 value into per-scope rwx notation and a combined string', () => {
    render(<UnixPermissionTool />)

    // Default state is immediately valid (755) — no empty/invalid placeholder.
    expect(screen.queryByRole('status')).toBeNull()

    // Each scope is decoded via the real PERMS table (owner=7, group=5, other=5).
    expect(within(scopeCell('Owner')).getByText(PERMS['7'])).toBeInTheDocument()
    expect(within(scopeCell('Group')).getByText(PERMS['5'])).toBeInTheDocument()
    expect(within(scopeCell('Other')).getByText(PERMS['5'])).toBeInTheDocument()

    // The combined, copyable symbolic string matches the concatenation exactly.
    expect(codeEl()).not.toBeNull()
    expect(codeEl()!.textContent).toBe(sym('755'))
    expect(copyBtn()).toBeInTheDocument()
  })

  it('recomputes every scope when a different valid value is typed', () => {
    render(<UnixPermissionTool />)
    typeOctal('644')

    expect(within(scopeCell('Owner')).getByText(PERMS['6'])).toBeInTheDocument()
    expect(within(scopeCell('Group')).getByText(PERMS['4'])).toBeInTheDocument()
    expect(within(scopeCell('Other')).getByText(PERMS['4'])).toBeInTheDocument()
    expect(codeEl()!.textContent).toBe(sym('644'))
  })

  it('recomputes the breakdown when a preset is chosen from the select', () => {
    render(<UnixPermissionTool />)
    fireEvent.change(presetSelect(), { target: { value: '700' } })

    // 700 -> owner rwx, group ---, other ---
    expect(within(scopeCell('Owner')).getByText(PERMS['7'])).toBeInTheDocument()
    expect(within(scopeCell('Group')).getByText(PERMS['0'])).toBeInTheDocument()
    expect(within(scopeCell('Other')).getByText(PERMS['0'])).toBeInTheDocument()
    expect(codeEl()!.textContent).toBe(sym('700'))
    // The input control mirrors the preset selection.
    expect(octalInput().value).toBe('700')
  })

  it('shows a neutral empty state (not a blank panel) when the field is cleared', () => {
    render(<UnixPermissionTool />)
    typeOctal('')

    // Regression guard: the old code rendered nothing at all here.
    expect(resultsList()).toBeNull()
    expect(codeEl()).toBeNull()
    expect(copyBtn()).toBeNull()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(EMPTY_MSG)
    expect(status).not.toHaveTextContent(INVALID_FRAGMENT)
  })

  it('rejects out-of-range octal digits with the invalid hint', () => {
    render(<UnixPermissionTool />)
    typeOctal('888') // 8 and 9 are not valid octal digits

    expect(resultsList()).toBeNull()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(INVALID_FRAGMENT)
    expect(status).not.toHaveTextContent(EMPTY_MSG)
  })

  it('rejects a too-short and a non-octal value with the invalid hint', () => {
    render(<UnixPermissionTool />)

    typeOctal('75') // only two digits
    expect(resultsList()).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(INVALID_FRAGMENT)

    typeOctal('7ab') // trailing non-octal characters
    expect(resultsList()).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(INVALID_FRAGMENT)
  })

  it('treats a whitespace-only value as empty rather than invalid', () => {
    render(<UnixPermissionTool />)
    typeOctal('   ')

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(EMPTY_MSG)
    expect(status).not.toHaveTextContent(INVALID_FRAGMENT)
  })

  it('exposes accessible affordances: labelled input, hidden glyph, named list', () => {
    const { container } = render(<UnixPermissionTool />)

    // The value field has an accessible name via its associated label.
    expect(octalInput()).toHaveAccessibleName('Octal Permission')
    // The decorative Lock icon inside the field is hidden from assistive tech.
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    // The breakdown grid is a named list of exactly the three permission scopes.
    const list = screen.getByRole('list', { name: RESULTS_LABEL })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  })

  it('copies the symbolic string (not the raw octal) to the clipboard on demand', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<UnixPermissionTool />) // default 755

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith(sym('755'))
    // The affordance confirms success by toggling to "Copied".
    expect(
      await screen.findByRole('button', { name: 'Copied' }),
    ).toBeInTheDocument()
  })

  it('re-derives correctly across the ok -> empty -> invalid -> ok lifecycle', () => {
    render(<UnixPermissionTool />)

    // ok (default 755)
    expect(codeEl()!.textContent).toBe(sym('755'))

    // empty
    typeOctal('')
    expect(codeEl()).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(EMPTY_MSG)

    // invalid
    typeOctal('999')
    expect(codeEl()).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(INVALID_FRAGMENT)

    // ok again
    typeOctal('444')
    expect(screen.queryByRole('status')).toBeNull()
    expect(codeEl()!.textContent).toBe(sym('444'))
  })
})
