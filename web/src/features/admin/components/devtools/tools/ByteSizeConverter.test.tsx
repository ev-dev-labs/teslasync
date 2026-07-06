/**
 * ByteSizeConverterTool contract tests.
 *
 * ByteSizeConverterTool is a "Utilities" devtool that converts a numeric value
 * expressed in one binary unit (B/KB/MB/GB/TB) into every unit at once. It is a
 * pure, self-contained widget (no network, react-query, or router), so these
 * tests drive it entirely through its two controls and assert the rendered
 * contract across every facet:
 *
 *   1. Structure   — the tool renders its (i18n-defaulted) title/description and
 *                    the two labelled controls.
 *   2. Empty state — before any input the results grid is replaced by a neutral
 *                    EmptyState, never a blank panel (guideline #6).
 *   3. Conversion  — a valid number is converted across every unit using the
 *                    same formatter the component uses (no drift).
 *   4. Unit switch — changing the source unit recomputes and moves the
 *                    "current item" marker.
 *   5. a11y        — the active unit is exposed via aria-current, the results
 *                    region carries an accessible name, and the decorative input
 *                    glyph is hidden from assistive tech.
 *   6. Bug guards  — a NEGATIVE value and a non-finite "Infinity" value both
 *                    degrade to the invalid empty state instead of rendering
 *                    nonsensical negatives / a misleading grid of zeros. These
 *                    are the two source bugs this elevation fixes.
 *   7. Edge cases  — non-numeric text is invalid; a leading-numeric string is
 *                    still parsed (lenient parseFloat behaviour preserved);
 *                    whitespace reads as "empty" not "invalid"; zero is a valid,
 *                    non-empty value.
 *
 * `react-i18next` is mocked (the same seam the sibling devtools tests use) so
 * `t(key, fallback)` returns the English default and label assertions stay
 * deterministic. Expected numeric output is derived from the real `fmtNumber`
 * so the assertions can never drift from the component's own formatting.
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

import { ByteSizeConverterTool } from './ByteSizeConverter'
import { fmtNumber } from '@/lib/numberFormat'
import { BYTE_UNITS } from '../constants'

const RESULTS_LABEL = 'Converted byte sizes'
const EMPTY_MSG = 'Enter a value to convert it across every unit.'
const INVALID_MSG = 'Enter a valid, non-negative number.'

// Compute the expected formatted cell for `num` given in `from`, shown in `to`,
// exactly the way the component does (fmtNumber with 0 decimals for bytes, 4
// otherwise) so the expectations track the source formatter with zero drift.
function expected(num: number, from: string, to: string): string {
  const fromIdx = BYTE_UNITS.indexOf(from as (typeof BYTE_UNITS)[number])
  const toIdx = BYTE_UNITS.indexOf(to as (typeof BYTE_UNITS)[number])
  const bytes = num * Math.pow(1024, fromIdx)
  return fmtNumber(bytes / Math.pow(1024, toIdx), toIdx === 0 ? 0 : 4)
}

const valueInput = () => screen.getByLabelText('Value') as HTMLInputElement
const unitSelect = () => screen.getByLabelText('Unit') as HTMLSelectElement
const resultsList = () => screen.queryByRole('list', { name: RESULTS_LABEL })

/** The result <li> whose unit label matches `unit`. */
function cardFor(unit: string): HTMLElement {
  const list = screen.getByRole('list', { name: RESULTS_LABEL })
  const li = within(list).getByText(unit).closest('li')
  if (!li) throw new Error(`no result card for unit "${unit}"`)
  return li as HTMLElement
}

function typeValue(v: string) {
  fireEvent.change(valueInput(), { target: { value: v } })
}

describe('ByteSizeConverterTool', () => {
  it('renders its title, description, and both labelled controls', () => {
    render(<ByteSizeConverterTool />)

    expect(
      screen.getByRole('heading', { name: 'Byte Size' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Convert a value between B, KB, MB, GB, and TB.'),
    ).toBeInTheDocument()

    // Both controls are reachable by their accessible label, and are the right
    // element kind (shared <Input>/<Select>, not raw HTML that lost its label).
    expect(valueInput().tagName).toBe('INPUT')
    expect(unitSelect().tagName).toBe('SELECT')
    // The unit picker offers exactly the catalog of binary units.
    expect(
      within(unitSelect())
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value),
    ).toEqual([...BYTE_UNITS])
  })

  it('shows a neutral empty state (not a blank grid) before any input', () => {
    render(<ByteSizeConverterTool />)

    expect(resultsList()).toBeNull()
    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
    expect(status).toHaveTextContent(EMPTY_MSG)
  })

  it('converts a value across every unit once a valid number is entered', () => {
    render(<ByteSizeConverterTool />)
    typeValue('1024') // unit defaults to B

    const list = resultsList()
    expect(list).not.toBeNull()
    expect(within(list as HTMLElement).getAllByRole('listitem')).toHaveLength(
      BYTE_UNITS.length,
    )

    // 1024 B → 1024 bytes → 1.0000 KB. Values come from the real formatter.
    expect(within(cardFor('B')).getByText(expected(1024, 'B', 'B'))).toBeInTheDocument()
    expect(within(cardFor('KB')).getByText(expected(1024, 'B', 'KB'))).toBeInTheDocument()
    // The empty state is gone now that there is real output.
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('marks the selected source unit as the current item', () => {
    render(<ByteSizeConverterTool />)
    typeValue('5') // unit still B

    const list = screen.getByRole('list', { name: RESULTS_LABEL })
    const active = list.querySelectorAll('[aria-current="true"]')
    expect(active).toHaveLength(1)
    expect(within(active[0] as HTMLElement).getByText('B')).toBeInTheDocument()
  })

  it('recomputes and moves the current-item marker when the unit changes', () => {
    render(<ByteSizeConverterTool />)
    typeValue('1')
    fireEvent.change(unitSelect(), { target: { value: 'KB' } })

    // 1 KB → 1024 bytes.
    expect(within(cardFor('B')).getByText(expected(1, 'KB', 'B'))).toBeInTheDocument()
    expect(within(cardFor('KB')).getByText(expected(1, 'KB', 'KB'))).toBeInTheDocument()

    // The active marker followed the selection to KB (and only KB).
    const list = screen.getByRole('list', { name: RESULTS_LABEL })
    const active = list.querySelectorAll('[aria-current="true"]')
    expect(active).toHaveLength(1)
    expect(within(active[0] as HTMLElement).getByText('KB')).toBeInTheDocument()
  })

  it('rejects a negative value with the invalid empty state (bug fix)', () => {
    render(<ByteSizeConverterTool />)
    typeValue('-5')

    // Regression guard: a negative byte size is meaningless — no grid of
    // negative sizes, just the invalid hint.
    expect(resultsList()).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(INVALID_MSG)
  })

  it('rejects a non-finite "Infinity" value instead of a grid of zeros (bug fix)', () => {
    render(<ByteSizeConverterTool />)
    typeValue('Infinity')

    // Regression guard: `parseFloat('Infinity')` is a number `isNaN` accepts,
    // and the formatter coerces it to 0 — the old code showed a misleading
    // all-zeros grid. The finite guard now degrades it to the invalid state.
    expect(resultsList()).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(INVALID_MSG)
  })

  it('rejects non-numeric text with the invalid empty state', () => {
    render(<ByteSizeConverterTool />)
    typeValue('abc')

    expect(resultsList()).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(INVALID_MSG)
  })

  it('still parses a leading-numeric string (lenient parseFloat preserved)', () => {
    render(<ByteSizeConverterTool />)
    typeValue('12abc') // parseFloat → 12

    expect(resultsList()).not.toBeNull()
    expect(within(cardFor('B')).getByText(expected(12, 'B', 'B'))).toBeInTheDocument()
  })

  it('treats a whitespace-only value as empty rather than invalid', () => {
    render(<ByteSizeConverterTool />)
    typeValue('   ')

    // Distinguishes "nothing entered yet" from "entered something wrong".
    expect(resultsList()).toBeNull()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(EMPTY_MSG)
    expect(status).not.toHaveTextContent(INVALID_MSG)
  })

  it('accepts zero as a valid, non-empty value', () => {
    render(<ByteSizeConverterTool />)
    typeValue('0')

    // 0 is a legitimate size — it must render the grid, not an empty state.
    expect(screen.queryByRole('status')).toBeNull()
    expect(within(cardFor('B')).getByText(expected(0, 'B', 'B'))).toBeInTheDocument()
  })

  it('labels the results region and hides the decorative input glyph from AT', () => {
    const { container } = render(<ByteSizeConverterTool />)
    typeValue('2048')

    // The results grid exposes an accessible name for screen readers.
    expect(screen.getByRole('list', { name: RESULTS_LABEL })).toBeInTheDocument()
    // The icon-only decoration inside the value field is aria-hidden so it is
    // not announced as content.
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })
})
