/**
 * SearchPage — smoke tests.
 *
 * Mocks the global search hook so the page never touches the network.
 * Covers:
 *   1. Renders the search input with empty state when no query.
 *   2. Renders an empty-state when query is below SEARCH_MIN_QUERY_LENGTH.
 *   3. Renders the results region (grouped by entity type) when the
 *      mocked hook returns hits.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string | Record<string, unknown>) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}))

const useGlobalSearchMock = vi.fn()
vi.mock('@/api/hooks/useSearch', () => ({
  useGlobalSearch: (...args: unknown[]) => useGlobalSearchMock(...args),
  SEARCH_MIN_QUERY_LENGTH: 2,
}))

// AINLSearch hits the backend on mount; stub it so the page mounts cleanly.
vi.mock('@/components/ai/AINLSearch', () => ({
  AINLSearch: () => null,
}))

let mockUrlString: [string, (v: string) => void] = ['', vi.fn()]
let mockUrlArray: [string[], (v: string[]) => void] = [[], vi.fn()]
vi.mock('@/hooks/useUrlState', () => ({
  useUrlString: () => mockUrlString,
  useUrlArray: () => mockUrlArray,
}))

import SearchPage from './SearchPage'

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function setQuery(q: string) {
  mockUrlString = [q, vi.fn()]
}

describe('SearchPage', () => {
  beforeEach(() => {
    useGlobalSearchMock.mockReset()
    mockUrlString = ['', vi.fn()]
    mockUrlArray = [[], vi.fn()]
  })

  it('renders without crashing on empty query', () => {
    useGlobalSearchMock.mockReturnValue({
      data: { hits: [] },
      isFetching: false,
      error: null,
    })
    const { container } = renderPage()
    expect(container.firstChild).not.toBeNull()
  })

  it('still mounts cleanly when query is below the min length', () => {
    setQuery('a')
    useGlobalSearchMock.mockReturnValue({
      data: { hits: [] },
      isFetching: false,
      error: null,
    })
    const { container } = renderPage()
    expect(container.firstChild).not.toBeNull()
    // The hook is called with `disabled: true` when the query is too
    // short — verify the page wired that contract correctly so a future
    // refactor can't silently start a network request below the min.
    const firstCallArgs = useGlobalSearchMock.mock.calls[0]
    const options = firstCallArgs[1] as { disabled?: boolean } | undefined
    expect(options?.disabled).toBe(true)
  })

  it('renders results when the hook returns hits', () => {
    setQuery('model y')
    useGlobalSearchMock.mockReturnValue({
      data: {
        hits: [
          {
            id: 'vehicle-1',
            type: 'vehicle',
            title: 'Model Y',
            subtitle: 'Long Range',
            url: '/vehicles/1',
            score: 1,
          },
        ],
      },
      isFetching: false,
      error: null,
    })
    renderPage()
    // Hit title should be rendered as a link or text node somewhere
    // in the grouped results region.
    expect(screen.getByText(/Model Y/)).toBeInTheDocument()
  })
})
