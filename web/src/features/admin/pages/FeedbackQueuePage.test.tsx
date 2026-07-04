/**
 * FeedbackQueuePage contract tests.
 *
 * The page is a single default export whose behaviour spans three bands:
 *   1. KPI band  — six whole-queue count tiles (independent limit:1 queries).
 *   2. Insights  — triage-progress distribution + category-mix + GitHub bridge,
 *                  each with its own loading / error / empty branch.
 *   3. Detail    — a filterable, paged, expandable table with per-row manual
 *                  triage controls (status change, GitHub URL, forward-to-GH).
 *
 * Every data source is a `useFeedbackList(...)` call, distinguished by its
 * params: `limit === 1` is one of the six count facets, anything else is the
 * table query. We stub the module so the tree mounts hermetically and drive
 * each branch by shaping a scenario. `useUpdateFeedback` is a mutate spy.
 *
 * `@testing-library/user-event` is NOT installed in this repo (see
 * EditableText.test.tsx), so interactions are driven via `fireEvent`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// ── Deterministic i18n: return the English fallback, interpolate {{vars}}. ─────
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// AI advisor gate + any settings consumers resolve to "AI off" so the
// `AIFeedbackQueueTriage` surface stays out of the DOM.
vi.mock('@/hooks/useSettings', () => ({ useSettings: vi.fn() }))

// The `created_at` column formatter — stub so the page never reaches the
// timezone → selected-vehicle → vehicles query chain.
vi.mock('@/hooks/useDateFormat', () => {
  const fmt = { formatDateTime: (v: unknown) => (v == null ? '—' : String(v)) }
  return { useDateFormat: () => fmt }
})

// The single data + mutation surface. Keep the real module (feedbackKeys /
// buildQuery are harmless) and override just the two hooks the page consumes.
vi.mock('@/api/hooks/useFeedback', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useFeedback')>('@/api/hooks/useFeedback')
  return { ...actual, useFeedbackList: vi.fn(), useUpdateFeedback: vi.fn() }
})

import { useSettings } from '@/hooks/useSettings'
import { useFeedbackList, useUpdateFeedback } from '@/api/hooks/useFeedback'
import FeedbackQueuePage from './FeedbackQueuePage'

const mockUseFeedbackList = useFeedbackList as unknown as ReturnType<typeof vi.fn>
const mockUseUpdateFeedback = useUpdateFeedback as unknown as ReturnType<typeof vi.fn>
const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const baseSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  decimal_precision: 0,
  ai_mode: 'off',
  ai_features: {},
}

type FacetKey = 'new' | 'triaged' | 'closed' | 'bug' | 'feature' | 'other'
const FACET_KEYS: FacetKey[] = ['new', 'triaged', 'closed', 'bug', 'feature', 'other']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Scenario { main: any; counts: Record<FacetKey, any> }

let refetches: Record<string, ReturnType<typeof vi.fn>>
let mockMutate: ReturnType<typeof vi.fn>
let scenario: Scenario

function rowA(): AnyRow {
  return {
    id: 101,
    created_at: '2024-01-15T12:00:00Z',
    category: 'bug',
    title: 'Timeline cuts off early',
    body: 'Body A — the drive timeline ends 30 minutes early.',
    page_route: '/drives',
    user_agent: 'Mozilla/5.0',
    app_version: '1.2.3',
    user_email: null,
    recent_errors: null,
    console_tail: null,
    status: 'new',
    github_issue_url: '',
    submitter_subject: 'user-a',
    submitter_ip: null,
    triaged_at: null,
    triaged_by: '',
  }
}

function rowB(): AnyRow {
  return {
    id: 102,
    created_at: '2024-02-01T09:30:00Z',
    category: 'feature',
    title: 'Add dark map tiles',
    body: 'Body B — please add a dark basemap.',
    page_route: '',
    user_agent: 'Mozilla/5.0',
    app_version: '1.2.4',
    user_email: null,
    recent_errors: null,
    console_tail: null,
    status: 'triaged',
    github_issue_url: 'https://github.com/ev-dev-labs/teslasync/issues/42',
    submitter_subject: 'user-b',
    submitter_ip: null,
    triaged_at: null,
    triaged_by: '',
  }
}

function defaults(): Scenario {
  return {
    main: {
      data: {
        items: [rowA(), rowB()],
        total: 2,
        limit: 25,
        offset: 0,
        github_bridge_enabled: false,
        github_repo: '',
      },
      isLoading: false,
      isError: false,
      error: null,
      isFetching: false,
    },
    counts: {
      new: { total: 5 },
      triaged: { total: 3 },
      closed: { total: 2 },
      bug: { total: 6 },
      feature: { total: 3 },
      other: { total: 1 },
    },
  }
}

function configure(
  over: { main?: Record<string, unknown>; counts?: Partial<Record<FacetKey, Record<string, unknown>>> } = {},
) {
  const d = defaults()
  const counts = {} as Record<FacetKey, AnyRow>
  for (const k of FACET_KEYS) counts[k] = { ...d.counts[k], ...(over.counts?.[k] ?? {}) }
  scenario = { main: { ...d.main, ...(over.main ?? {}) }, counts }
}

function countResult(facet: FacetKey) {
  const f = scenario.counts[facet]
  return {
    data:
      f.total === undefined
        ? undefined
        : { items: [], total: f.total, limit: 1, offset: 0, github_bridge_enabled: false },
    isLoading: Boolean(f.isLoading),
    isError: Boolean(f.error),
    error: f.error ?? null,
    isFetching: Boolean(f.isFetching),
    refetch: refetches[facet],
  }
}

function mainResult() {
  const m = scenario.main
  return {
    data: m.data,
    isLoading: Boolean(m.isLoading),
    isError: Boolean(m.isError),
    error: m.error ?? null,
    isFetching: Boolean(m.isFetching),
    refetch: refetches.main,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function feedbackListImpl(params: any = {}) {
  if (params?.limit === 1) {
    const facet: FacetKey | undefined = params.status ?? params.category
    if (facet) return countResult(facet)
  }
  return mainResult()
}

beforeEach(() => {
  refetches = {
    main: vi.fn(),
    new: vi.fn(),
    triaged: vi.fn(),
    closed: vi.fn(),
    bug: vi.fn(),
    feature: vi.fn(),
    other: vi.fn(),
  }
  mockMutate = vi.fn()

  mockUseSettings.mockReset()
  mockUseSettings.mockReturnValue({ settings: baseSettings, locale: 'en-US' })

  mockUseUpdateFeedback.mockReset()
  mockUseUpdateFeedback.mockReturnValue({ mutate: mockMutate, isPending: false })

  mockUseFeedbackList.mockReset()
  mockUseFeedbackList.mockImplementation(feedbackListImpl)

  configure()
})

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/feedback']}>
        <FeedbackQueuePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function rowTr(title: string): HTMLElement {
  const el = screen.getByText(title).closest('tr')
  if (!el) throw new Error(`no row found for "${title}"`)
  return el as HTMLElement
}

function expandRow(title: string) {
  fireEvent.click(within(rowTr(title)).getByRole('button', { name: /Expand row/i }))
}

// The expanded drawer is rendered as the data row's next sibling <tr>.
function drawerFor(title: string): HTMLElement {
  const region = rowTr(title).nextElementSibling
  if (!region || region.getAttribute('data-expanded-content') !== 'true') {
    throw new Error(`row "${title}" is not expanded`)
  }
  return region as HTMLElement
}

describe('FeedbackQueuePage', () => {
  it('renders the KPI band, status distribution, category mix, bridge status, rows, and GitHub link for a populated queue', () => {
    renderPage()

    // KPI band — the "Total feedback" tile sums the whole-queue status counts.
    expect(screen.getByText('Total feedback')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument() // 5 + 3 + 2

    // Triage-progress distribution renders with a screen-reader summary that
    // pins the exact per-status counts.
    expect(
      screen.getByRole('img', { name: 'Status distribution: 5 new, 3 triaged, 2 closed' }),
    ).toBeInTheDocument()

    // Category-mix bar for "bug": 6 of 10 → 60%.
    expect(screen.getByText('6 · 60%')).toBeInTheDocument()

    // Bridge is disabled by default → "Not configured".
    expect(screen.getByText('Not configured')).toBeInTheDocument()

    // Both rows surface.
    expect(screen.getByText('Timeline cuts off early')).toBeInTheDocument()
    expect(screen.getByText('Add dark map tiles')).toBeInTheDocument()

    // Row B has an issue URL → an "Open issue" link; row A has none.
    const link = screen.getByRole('link', { name: /Open issue/i })
    expect(link).toHaveAttribute('href', 'https://github.com/ev-dev-labs/teslasync/issues/42')

    // Whole-queue KPIs are read from limit:1 calls (independent of the table).
    expect(mockUseFeedbackList).toHaveBeenCalledWith({ status: 'new', limit: 1 })
    expect(mockUseFeedbackList).toHaveBeenCalledWith({ category: 'bug', limit: 1 })
  })

  it('shows the loading skeleton (and no rows or empty state) while the table query is loading', () => {
    configure({
      main: { isLoading: true, data: undefined },
      counts: Object.fromEntries(
        FACET_KEYS.map((k) => [k, { total: undefined, isLoading: true }]),
      ) as Partial<Record<FacetKey, Record<string, unknown>>>,
    })

    const { container } = renderPage()

    // The page mounted (title present) but the data + empty branches are gated.
    expect(screen.getByRole('heading', { name: 'Feedback queue' })).toBeInTheDocument()
    expect(screen.queryByText('Timeline cuts off early')).toBeNull()
    expect(screen.queryByText('No feedback yet')).toBeNull()
    // Skeletons render as `.animate-pulse` blocks.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('renders the QueryError banner when the table query fails and retries the LIST on click', () => {
    configure({ main: { isError: true, error: new Error('boom'), data: undefined } })

    renderPage()

    // Generic Error (no ApiError status) + jsdom online → network error copy.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }))
    expect(refetches.main).toHaveBeenCalledTimes(1)
  })

  it('shows empty states for the table, triage progress, and category mix when the whole queue is empty', () => {
    configure({
      main: {
        data: { items: [], total: 0, limit: 25, offset: 0, github_bridge_enabled: false, github_repo: '' },
      },
      counts: Object.fromEntries(FACET_KEYS.map((k) => [k, { total: 0 }])) as Partial<
        Record<FacetKey, Record<string, unknown>>
      >,
    })

    renderPage()

    expect(screen.getByText('No feedback yet')).toBeInTheDocument()
    expect(screen.getByText('No feedback to triage yet.')).toBeInTheDocument()
    expect(screen.getByText('No categories to show yet.')).toBeInTheDocument()

    // With no items the pagination controls are not rendered.
    expect(screen.queryByRole('button', { name: /^Next$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Previous$/i })).toBeNull()
  })

  it('applies the status filter and resets to the first page (offset 0) even after paging forward', () => {
    configure({
      main: {
        data: { items: [rowA()], total: 60, limit: 25, offset: 0, github_bridge_enabled: false, github_repo: '' },
      },
    })

    renderPage()

    // Page forward first so the reset is observable.
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }))
    expect(mockUseFeedbackList).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, offset: 25 }),
    )

    // Now change the status filter → param applied AND page reset to 0.
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'closed' } })
    expect(mockUseFeedbackList).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'closed', limit: 25, offset: 0 }),
    )
    expect(screen.getByText('Page 1 of 3 (60 entries)')).toBeInTheDocument()
  })

  it('paginates through pages and disables Previous/Next at the boundaries', () => {
    configure({
      main: {
        data: { items: [rowA()], total: 60, limit: 25, offset: 0, github_bridge_enabled: false, github_repo: '' },
      },
    })

    renderPage()

    // Page 1 of 3: Previous disabled, Next enabled.
    expect(screen.getByText('Page 1 of 3 (60 entries)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Previous$/i })).toBeDisabled()
    const next = screen.getByRole('button', { name: /^Next$/i })
    expect(next).not.toBeDisabled()

    // → page 2: Previous now enabled.
    fireEvent.click(next)
    expect(screen.getByText('Page 2 of 3 (60 entries)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Previous$/i })).not.toBeDisabled()

    // → page 3 (last): Next disabled.
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }))
    expect(screen.getByText('Page 3 of 3 (60 entries)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Next$/i })).toBeDisabled()
  })

  it('refresh refetches the table AND all six count queries so KPIs stay consistent', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }))

    expect(refetches.main).toHaveBeenCalledTimes(1)
    for (const k of FACET_KEYS) {
      expect(refetches[k]).toHaveBeenCalledTimes(1)
    }
  })

  it('disables the refresh button while any query is refetching', () => {
    configure({ main: { isFetching: true } })

    renderPage()

    expect(screen.getByRole('button', { name: /Refresh/i })).toBeDisabled()
  })

  it('expands a row to reveal the report body and manual triage controls; status change and Save URL both call update', () => {
    renderPage()

    expandRow('Timeline cuts off early')
    const region = drawerFor('Timeline cuts off early')
    expect(within(region).getByText('Body A — the drive timeline ends 30 minutes early.')).toBeInTheDocument()

    // Changing the per-row status select issues an update for that row. (The
    // select is queried by role because the page-level filter shares its id.)
    fireEvent.change(within(region).getByRole('combobox'), { target: { value: 'closed' } })
    expect(mockMutate).toHaveBeenCalledWith({ id: 101, update: { status: 'closed' } })

    // The Save URL button is disabled until the field diverges from the row's
    // current (empty) issue URL; typing enables it, clicking persists it.
    expect(within(region).getByRole('button', { name: 'Save URL' })).toBeDisabled()
    fireEvent.change(within(region).getByRole('textbox'), {
      target: { value: 'https://github.com/acme/repo/issues/7' },
    })
    const save = within(region).getByRole('button', { name: 'Save URL' })
    expect(save).not.toBeDisabled()
    fireEvent.click(save)
    expect(mockMutate).toHaveBeenCalledWith({
      id: 101,
      update: { github_issue_url: 'https://github.com/acme/repo/issues/7' },
    })
  })

  it('shows Forward to GitHub only when the bridge is enabled and the row has no issue; clicking it forwards', () => {
    configure({
      main: {
        data: {
          items: [rowA(), rowB()],
          total: 2,
          limit: 25,
          offset: 0,
          github_bridge_enabled: true,
          github_repo: 'ev-dev-labs/teslasync',
        },
      },
    })

    renderPage()

    // Bridge footer reflects the connected repo. The label ("Connected") and
    // the middot separator share one element, so match loosely.
    expect(screen.getByText(/Connected/)).toBeInTheDocument()
    expect(screen.getByText('ev-dev-labs/teslasync')).toBeInTheDocument()

    // Row A has no issue yet → Forward button present; clicking forwards it.
    expandRow('Timeline cuts off early')
    const regionA = drawerFor('Timeline cuts off early')
    fireEvent.click(within(regionA).getByRole('button', { name: /Forward to GitHub/i }))
    expect(mockMutate).toHaveBeenCalledWith({ id: 101, update: { forward_to_github: true } })

    // Row B already has an issue URL → no Forward button even with the bridge on.
    expandRow('Add dark map tiles')
    const regionB = drawerFor('Add dark map tiles')
    expect(within(regionB).queryByRole('button', { name: /Forward to GitHub/i })).toBeNull()
  })

  it('retry in the triage-progress panel refetches the STATUS counts, not the list', () => {
    configure({ counts: { new: { total: undefined, error: new Error('counts down') } } })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }))

    expect(refetches.new).toHaveBeenCalledTimes(1)
    expect(refetches.triaged).toHaveBeenCalledTimes(1)
    expect(refetches.closed).toHaveBeenCalledTimes(1)
    expect(refetches.main).not.toHaveBeenCalled()
  })

  it('retry in the category-mix panel refetches the CATEGORY counts, not the list', () => {
    configure({ counts: { bug: { total: undefined, error: new Error('counts down') } } })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }))

    expect(refetches.bug).toHaveBeenCalledTimes(1)
    expect(refetches.feature).toHaveBeenCalledTimes(1)
    expect(refetches.other).toHaveBeenCalledTimes(1)
    expect(refetches.main).not.toHaveBeenCalled()
  })
})
