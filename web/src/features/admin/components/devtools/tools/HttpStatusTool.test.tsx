/**
 * HttpStatusTool behaviour + hardening contract tests.
 *
 * The tool is a pure, self-contained reference table — it reads the static
 * `HTTP_CODES` catalog (no hooks, no network) and renders it through the shared
 * `DataTable`. Every test therefore drives the real component through its
 * accessible surface (labelled search box + sortable column headers + rendered
 * rows) and asserts the rendered result, never an implementation detail.
 *
 * It locks the guarantees the elevation established / fixed:
 *
 *   - the ToolCard title/description render real localized copy, NOT the raw
 *     i18n key placeholders ("Http Status Desc" / "Status Desc") that leaked to
 *     the UI before the keys were namespaced (the same class of bug the
 *     Base64Tool test guards against with "Base64Desc");
 *   - every catalog code renders, with a semantic Badge variant per status
 *     class (2xx success / 3xx info / 4xx warning / 5xx danger);
 *   - the search box filters case-insensitively AND trims surrounding
 *     whitespace, matching by code, status text, or description;
 *   - a no-match search shows the localized empty message, never a blank panel;
 *   - the icon-only search box exposes a real accessible name (was placeholder
 *     only — invisible to assistive tech);
 *   - the "Status Code" header is a working sort control: it exposes `aria-sort`
 *     and toggling it actually reorders the rows. The pre-elevation column was
 *     marked `sortable` but never wired to sortKey/onSort, so the button was a
 *     dead no-op.
 *
 * `@testing-library/user-event` is not installed in this repo (see
 * Base64Tool.test.tsx), so interactions go through `fireEvent`. Real i18n is
 * loaded so assertions run against the production en.json strings.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import '@/i18n'
import { HttpStatusTool } from './HttpStatusTool'
import { HTTP_CODES } from '../constants'

function getSearchBox(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Search status codes' }) as HTMLInputElement
}

function setSearch(value: string): void {
  fireEvent.change(getSearchBox(), { target: { value } })
}

/** Codes in the order they currently appear in the rendered table body. */
function renderedCodes(): string[] {
  const table = screen.getByRole('table')
  const rows = within(table).getAllByRole('row').slice(1) // drop the header row
  return rows
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent?.trim() ?? '')
    .filter((text) => /^\d{3}$/.test(text)) // ignore the single empty-state row
}

describe('HttpStatusTool', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders localized card copy, not the raw i18n key placeholders', () => {
    render(<HttpStatusTool />)

    // Title + description come from the namespaced catalog keys. The negative
    // assertions are regression guards for the flat, defaultless keys that used
    // to render literally (t('Http Status Desc') → "Http Status Desc").
    expect(screen.getByRole('heading', { name: 'HTTP Status' })).toBeInTheDocument()
    expect(screen.getByText('Reference for HTTP response status codes')).toBeInTheDocument()
    expect(screen.queryByText('Http Status Desc')).toBeNull()
    expect(screen.queryByText('Status Desc')).toBeNull()

    // The description column header now reads "Description", never "Status Desc".
    expect(screen.getByRole('columnheader', { name: 'Description' })).toBeInTheDocument()
  })

  it('renders every status code from the catalog', () => {
    render(<HttpStatusTool />)

    // One data row per catalog entry (all 19 fit on a single page).
    expect(renderedCodes()).toHaveLength(HTTP_CODES.length)

    // Spot-check representative codes across every status class and their text.
    expect(screen.getByText('200')).toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()
    expect(screen.getByText('404')).toBeInTheDocument()
    expect(screen.getByText('Not Found')).toBeInTheDocument()
    expect(screen.getByText('500')).toBeInTheDocument()
    expect(screen.getByText('Internal Server Error')).toBeInTheDocument()
  })

  it('colors each code with a semantic Badge variant by status class', () => {
    render(<HttpStatusTool />)

    // 2xx → success, 3xx → info, 4xx → warning, 5xx → danger. The variant maps
    // to a distinct background utility class on the Badge span.
    expect(screen.getByText('200')).toHaveClass('bg-green-100') // success
    expect(screen.getByText('301')).toHaveClass('bg-blue-100') // info
    expect(screen.getByText('404')).toHaveClass('bg-yellow-100') // warning
    expect(screen.getByText('500')).toHaveClass('bg-red-100') // danger
  })

  it('filters by code, is case-insensitive, and trims surrounding whitespace', () => {
    render(<HttpStatusTool />)

    // Numeric substring match.
    setSearch('500')
    expect(screen.getByText('500')).toBeInTheDocument()
    expect(screen.queryByText('200')).toBeNull()
    expect(screen.queryByText('404')).toBeNull()

    // Mixed-case + leading/trailing whitespace still resolves to the 404 row —
    // the hardened query lower-cases AND trims before matching.
    setSearch('  NOT found  ')
    expect(renderedCodes()).toEqual(['404'])
    expect(screen.getByText('Not Found')).toBeInTheDocument()
    expect(screen.queryByText('200')).toBeNull()
  })

  it('matches on the description text as well as the status text', () => {
    render(<HttpStatusTool />)

    // "rate limited" only appears in the 429 description, proving the filter
    // reaches the desc column, not just code/text.
    setSearch('rate limited')
    expect(renderedCodes()).toEqual(['429'])
    expect(screen.getByText('Too Many Requests')).toBeInTheDocument()
  })

  it('shows the localized empty message when nothing matches', () => {
    render(<HttpStatusTool />)

    setSearch('zzzzz-no-such-code')
    expect(renderedCodes()).toEqual([]) // no data rows
    expect(screen.getByText('No status codes match your search')).toBeInTheDocument()
  })

  it('exposes the icon-only search box through a real accessible name', () => {
    render(<HttpStatusTool />)

    const box = getSearchBox()
    expect(box.tagName).toBe('INPUT')
    // Placeholder is preserved for sighted users; the aria-label is what makes
    // the control reachable for assistive tech (was placeholder-only before).
    expect(box).toHaveAttribute('placeholder', 'Search codes')
    expect(box).toHaveAccessibleName('Search status codes')
  })

  it('sorts by status code and toggling the header reorders the rows', () => {
    render(<HttpStatusTool />)

    // The sortable column renders an interactive button + reflects sort state
    // through aria-sort. Default is code-ascending, so the first row is 200.
    const header = screen.getByRole('columnheader', { name: /Status Code/ })
    expect(header).toHaveAttribute('aria-sort', 'ascending')

    const before = renderedCodes()
    expect(before[0]).toBe('200')
    expect(before[before.length - 1]).toBe('504')

    // Clicking the header toggles to descending — the row order actually flips.
    // Before the elevation this button was a no-op (no onSort wiring).
    fireEvent.click(screen.getByRole('button', { name: 'Status Code' }))

    expect(header).toHaveAttribute('aria-sort', 'descending')
    const after = renderedCodes()
    expect(after[0]).toBe('504')
    expect(after[after.length - 1]).toBe('200')
  })
})
