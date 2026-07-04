/**
 * UsersPage (admin Subjects cockpit) contract tests.
 *
 * The page orchestrates three self-sufficient sections — a 4-tile KPI band, a
 * hero SubjectsTable + live ImpersonationStatusPanel, and a policy band — off
 * two discriminated-union queries (status + candidates). These tests pin the
 * behaviour that actually matters to an operator and lock in the hardening:
 *
 *   1. Forward-auth + candidates → KPI band derives the count/mode/session/limit
 *      and the table lists every subject.
 *   2. Both queries loading → per-section skeletons, never a page-level block.
 *   3. Open mode → "Open" access, zero subjects, forward-auth callout (no list).
 *   4. Active impersonation → "Active" session KPI + the target row is flagged.
 *   5. Candidates error → retryable QueryError AND an em-dash count (NOT "0"),
 *      wired to refetch.
 *   6. Status error → access-mode + session KPIs blank to "—" instead of
 *      confidently claiming Forward-auth/Idle.
 *   7. Refresh control refetches BOTH queries and is accessibly labelled.
 *   8. Refresh is disabled (and inert) while a fetch is already in flight.
 *   9. No other subjects → the table's empty state renders and the count is 0.
 *
 * The two query hooks are mocked via `vi.hoisted` so no network is touched; the
 * pure `isImpersonation*` helpers and every real shared component (MetricCard,
 * DataTable, QueryError, PageContainer, StatusPanel, PolicyPanel) render for a
 * true integration signal.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

import type {
  ImpersonationStatus,
  ImpersonationCandidatesResponse,
} from '@/api/types'

interface QueryStub<T> {
  data: T | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  isFetching: boolean
  isStale: boolean
  dataUpdatedAt: number
  refetch: () => void
}

type StatusQuery = QueryStub<ImpersonationStatus>
type CandidatesQuery = QueryStub<ImpersonationCandidatesResponse>

const hoisted = vi.hoisted(() => ({
  statusRefetch: vi.fn(),
  candidatesRefetch: vi.fn(),
  state: {} as { status: StatusQuery; candidates: CandidatesQuery },
}))

// Keep the real (pure) `isImpersonationOpenMode` / `isImpersonationActive`
// helpers so the page's derivation logic is exercised end-to-end; only the two
// data hooks are swapped for controllable stubs.
vi.mock('@/api/hooks/useImpersonation', async () => {
  const actual = await vi.importActual<
    typeof import('@/api/hooks/useImpersonation')
  >('@/api/hooks/useImpersonation')
  return {
    ...actual,
    useImpersonationStatus: () => hoisted.state.status,
    useImpersonationCandidates: () => hoisted.state.candidates,
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback =
          typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        const interpolate = (str: string) => {
          if (!opts) return str
          return Object.entries(opts).reduce<string>((acc, [k, v]) => {
            if (k === 'defaultValue') return acc
            return acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
          }, str)
        }
        if (opts && typeof opts.defaultValue === 'string') {
          return interpolate(opts.defaultValue)
        }
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { ApiError } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import UsersPage from './UsersPage'

// jsdom lacks matchMedia; framer-motion's useReducedMotion (via FadeIn + the
// freshness chip) reads it. A canonical stub removes any ambiguity.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

function makeStatusQuery(overrides: Partial<StatusQuery> = {}): StatusQuery {
  return {
    data: { mode: 'inactive' },
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: hoisted.statusRefetch,
    ...overrides,
  }
}

function makeCandidatesQuery(
  overrides: Partial<CandidatesQuery> = {},
): CandidatesQuery {
  return {
    data: { mode: 'session', candidates: [{ subject: 'alice' }, { subject: 'bob' }] },
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: hoisted.candidatesRefetch,
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <UsersPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

/** Read a KPI tile's rendered value by its label, scoped to the KPI region so
 *  the "Session Status" label doesn't collide with the status panel title. */
function kpiValue(label: string): string {
  const region = screen.getByRole('region', { name: 'Impersonation summary' })
  const labelEl = within(region).getByText(label)
  return labelEl.closest('p')?.nextElementSibling?.textContent ?? ''
}

/** The real <button> refresh control — disambiguated from the freshness chip,
 *  which is a <span role="button"> that also exposes the name "Refresh". */
function getRefreshButton(): HTMLElement {
  const btn = screen
    .getAllByRole('button', { name: 'Refresh' })
    .find((el) => el.tagName === 'BUTTON')
  if (!btn) throw new Error('refresh <button> not found')
  return btn
}

beforeEach(() => {
  hoisted.statusRefetch.mockReset()
  hoisted.candidatesRefetch.mockReset()
  hoisted.state.status = makeStatusQuery()
  hoisted.state.candidates = makeCandidatesQuery()
})

describe('UsersPage', () => {
  it('derives the KPI band and lists subjects for a forward-auth install', () => {
    renderPage()

    // Page chrome + all three sections render.
    expect(screen.getByRole('heading', { name: 'Subjects', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('How impersonation works')).toBeInTheDocument()

    // KPI band derived from the candidates + inactive status.
    expect(kpiValue('Available Subjects')).toBe('2')
    expect(kpiValue('Access Mode')).toBe('Forward-auth')
    expect(kpiValue('Session Status')).toBe('Idle')
    expect(kpiValue('Session Limit')).toBe('15 min')

    // Both subjects appear in the hero table.
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  it('renders per-section skeletons while both queries are loading', () => {
    hoisted.state.status = makeStatusQuery({ data: undefined, isLoading: true, dataUpdatedAt: 0 })
    hoisted.state.candidates = makeCandidatesQuery({
      data: undefined,
      isLoading: true,
      isFetching: true,
      dataUpdatedAt: 0,
    })
    renderPage()

    // KPI band collapses to a skeleton — no derived metric labels yet.
    expect(screen.getByTestId('stat-grid-skeleton')).toBeInTheDocument()
    expect(screen.queryByText('Available Subjects')).not.toBeInTheDocument()
    // The subjects table shows its own loading affordance.
    expect(screen.getByTestId('users-page-loading')).toBeInTheDocument()
  })

  it('surfaces open mode: Open access, zero subjects, and the forward-auth callout', () => {
    hoisted.state.status = makeStatusQuery({ data: { mode: 'open' } })
    hoisted.state.candidates = makeCandidatesQuery({ data: { mode: 'open' } })
    renderPage()

    expect(kpiValue('Access Mode')).toBe('Open')
    expect(kpiValue('Available Subjects')).toBe('0')
    // The table renders the open-mode callout, not a searchable list.
    expect(screen.getByTestId('users-page-open-mode')).toBeInTheDocument()
    expect(screen.queryByTestId('users-page-list')).not.toBeInTheDocument()
  })

  it('flags the impersonated subject and shows an active session status', () => {
    hoisted.state.status = makeStatusQuery({
      data: {
        mode: 'active',
        original_admin: 'admin@ops',
        target: 'bob',
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
    })
    renderPage()

    expect(kpiValue('Session Status')).toBe('Active')
    // The impersonated row is badged; the other stays "Available".
    expect(screen.getByText('Current target')).toBeInTheDocument()
    expect(screen.getByText('Available')).toBeInTheDocument()
    // The live status panel echoes the original admin.
    expect(screen.getByText('admin@ops')).toBeInTheDocument()
    // 'bob' shows both in the table row and the status panel.
    expect(screen.getAllByText('bob').length).toBeGreaterThanOrEqual(2)
  })

  it('shows a retryable error and an em-dash count when the candidates query fails', async () => {
    hoisted.state.candidates = makeCandidatesQuery({
      data: undefined,
      isError: true,
      error: new ApiError('candidates down', 500, 'INTERNAL'),
    })
    renderPage()

    // Bug-fix: the count is unknown, not zero — "—" avoids implying 0 subjects.
    expect(kpiValue('Available Subjects')).toBe('—')

    // The table degrades to a retryable QueryError wired to refetch.
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1)
    const retry = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(retry)
    await waitFor(() => expect(hoisted.candidatesRefetch).toHaveBeenCalled())
  })

  it('blanks the access-mode and session KPIs when the status query errors', () => {
    hoisted.state.status = makeStatusQuery({
      data: undefined,
      isError: true,
      error: new ApiError('status down', 500, 'INTERNAL'),
      dataUpdatedAt: 0,
    })
    renderPage()

    // Hardening: don't confidently claim Forward-auth/Idle on a failed fetch.
    expect(kpiValue('Access Mode')).toBe('—')
    expect(kpiValue('Session Status')).toBe('—')
    // Candidates are still healthy, so the count remains truthful.
    expect(kpiValue('Available Subjects')).toBe('2')
  })

  it('refetches both queries and exposes an accessible refresh control', () => {
    renderPage()

    const refresh = getRefreshButton()
    expect(refresh.tagName).toBe('BUTTON')
    expect(refresh).toHaveAccessibleName('Refresh')
    expect(refresh).not.toBeDisabled()

    fireEvent.click(refresh)
    expect(hoisted.statusRefetch).toHaveBeenCalledTimes(1)
    expect(hoisted.candidatesRefetch).toHaveBeenCalledTimes(1)
  })

  it('disables the refresh control while a fetch is already in flight', () => {
    hoisted.state.status = makeStatusQuery({ isFetching: true })
    renderPage()

    const refresh = getRefreshButton()
    expect(refresh).toBeDisabled()

    // A disabled control must not fire the refetch handlers.
    fireEvent.click(refresh)
    expect(hoisted.statusRefetch).not.toHaveBeenCalled()
    expect(hoisted.candidatesRefetch).not.toHaveBeenCalled()
  })

  it('renders the empty state and a zero count when no other subjects are active', () => {
    hoisted.state.candidates = makeCandidatesQuery({
      data: { mode: 'session', candidates: [] },
    })
    renderPage()

    expect(kpiValue('Available Subjects')).toBe('0')
    expect(screen.getByText('No other subjects')).toBeInTheDocument()
    // No searchable list is drawn when there is nothing to search.
    expect(screen.queryByTestId('users-page-list')).not.toBeInTheDocument()
  })
})
