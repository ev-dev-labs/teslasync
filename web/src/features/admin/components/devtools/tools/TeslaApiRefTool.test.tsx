/**
 * TeslaApiRefTool contract tests.
 *
 * Covers the tool's single export end-to-end with behavioural, multi-facet
 * assertions (never a smoke render):
 *
 *   - structure/a11y: the ToolCard heading, a *named* search field
 *     (getByRole('searchbox', { name }) — the field now carries an aria-label,
 *     not just a placeholder), and the three column headers as columnheaders;
 *   - the full listing: every endpoint from the shared TESLA_ENDPOINTS constant
 *     renders one method badge and one copy affordance (counts derived from the
 *     constant so the test can never drift out of sync with the data);
 *   - the method→variant mapping: GET renders an `info` (blue) badge and every
 *     other verb a `warning` (yellow) badge — exercising both ternary branches;
 *   - filtering: case-insensitive method match, path/description substring
 *     match, and the whitespace-only guard that must show the whole list (the
 *     trim fix — a stray "   " previously matched nothing);
 *   - the empty branch: a no-match query surfaces the translated emptyMessage
 *     and retracts every row/badge/copy button (never a blank panel);
 *   - the copy interaction: clicking a row's copy button writes that row's exact
 *     path to the clipboard.
 *
 * `react-i18next` is mocked so `t(key, fallback)` returns the fallback and
 * `t(key)` returns the key verbatim — deterministic, translation-file-free and
 * matching the sibling HashCalculator.test convention. Nothing touches the
 * network: the component reads a static module constant.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

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
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { TeslaApiRefTool } from './TeslaApiRefTool'
import { TESLA_ENDPOINTS } from '../constants'

// Expected counts are DERIVED from the shared constant, never hard-coded, so
// adding/removing an endpoint keeps these assertions honest.
const TOTAL = TESLA_ENDPOINTS.length
const GET_COUNT = TESLA_ENDPOINTS.filter((e) => e.method === 'GET').length
const POST_COUNT = TESLA_ENDPOINTS.filter((e) => e.method === 'POST').length
const matchesQuery = (q: string) =>
  TESLA_ENDPOINTS.filter(
    (e) =>
      e.method.toLowerCase().includes(q) ||
      e.path.toLowerCase().includes(q) ||
      e.desc.toLowerCase().includes(q),
  )

const SEARCH_NAME = 'Search Endpoints'
const LIST_PATH = '/api/1/vehicles' // the sole GET list endpoint
const WAKE_PATH = '/api/1/vehicles/{id}/command/wake_up' // a POST command

function getSearch(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: SEARCH_NAME }) as HTMLInputElement
}
function methodBadges(method: 'GET' | 'POST') {
  return screen.queryAllByText(method)
}
function copyButtons() {
  return screen.queryAllByRole('button', { name: 'Copy' })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TeslaApiRefTool', () => {
  it('renders the card, a named search field, and the three column headers', () => {
    render(<TeslaApiRefTool />)

    expect(
      screen.getByRole('heading', { name: 'Tesla Api Ref' }),
    ).toBeInTheDocument()

    // The field exposes an accessible name (aria-label), not merely a
    // placeholder, so a screen reader can announce it.
    const search = getSearch()
    expect(search.tagName).toBe('INPUT')
    expect(search).toHaveAttribute('type', 'search')
    expect(search).toHaveAttribute('placeholder', SEARCH_NAME)

    expect(screen.getByRole('columnheader', { name: 'Method' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Path' })).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Endpoint Desc' }),
    ).toBeInTheDocument()
  })

  it('lists every endpoint with one method badge and one copy button per row', () => {
    render(<TeslaApiRefTool />)

    // One badge per row, split by verb; totals match the source constant.
    expect(methodBadges('GET')).toHaveLength(GET_COUNT)
    expect(methodBadges('POST')).toHaveLength(POST_COUNT)
    expect(GET_COUNT + POST_COUNT).toBe(TOTAL)

    // One copy affordance per row.
    expect(copyButtons()).toHaveLength(TOTAL)

    // The path is rendered inside a <code> element.
    const code = screen.getByText(LIST_PATH)
    expect(code.tagName).toBe('CODE')
  })

  it('maps GET to an info (blue) badge and POST to a warning (yellow) badge', () => {
    render(<TeslaApiRefTool />)

    const getRow = screen.getByText(LIST_PATH).closest('tr') as HTMLElement
    const getBadge = within(getRow).getByText('GET')
    expect(getBadge.className).toMatch(/bg-blue/)

    const postRow = screen.getByText(WAKE_PATH).closest('tr') as HTMLElement
    const postBadge = within(postRow).getByText('POST')
    expect(postBadge.className).toMatch(/bg-yellow/)
  })

  it('filters by HTTP method case-insensitively', () => {
    render(<TeslaApiRefTool />)

    // Mixed case proves the query is lower-cased before matching.
    fireEvent.change(getSearch(), { target: { value: 'PoSt' } })

    expect(methodBadges('POST')).toHaveLength(POST_COUNT)
    expect(methodBadges('GET')).toHaveLength(0)
    // A GET-only description is gone.
    expect(screen.queryByText('List vehicles')).toBeNull()
  })

  it('filters by a path/description substring', () => {
    render(<TeslaApiRefTool />)

    const expected = matchesQuery('lock')
    // Guard the fixture: "lock" should match the lock + unlock command rows.
    expect(expected.length).toBeGreaterThanOrEqual(2)

    fireEvent.change(getSearch(), { target: { value: 'lock' } })

    expect(copyButtons()).toHaveLength(expected.length)
    expect(screen.getByText('Lock doors')).toBeInTheDocument()
    expect(screen.getByText('Unlock doors')).toBeInTheDocument()
    expect(screen.queryByText('List vehicles')).toBeNull()
  })

  it('treats a whitespace-only query as empty and shows the full list', () => {
    render(<TeslaApiRefTool />)

    fireEvent.change(getSearch(), { target: { value: '   ' } })

    // The trim guard means no filtering happened — every row is still present.
    expect(copyButtons()).toHaveLength(TOTAL)
    expect(screen.getByText(LIST_PATH)).toBeInTheDocument()
  })

  it('shows a translated empty state and no rows when nothing matches', () => {
    render(<TeslaApiRefTool />)

    fireEvent.change(getSearch(), {
      target: { value: 'zzz-not-a-real-endpoint' },
    })

    expect(
      screen.getByText('No endpoints match your search'),
    ).toBeInTheDocument()
    expect(methodBadges('GET')).toHaveLength(0)
    expect(methodBadges('POST')).toHaveLength(0)
    expect(copyButtons()).toHaveLength(0)
  })

  it('copies a row\u2019s exact path to the clipboard when its copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    render(<TeslaApiRefTool />)

    const row = screen.getByText(WAKE_PATH).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(WAKE_PATH))
    expect(writeText).toHaveBeenCalledTimes(1)
  })
})
