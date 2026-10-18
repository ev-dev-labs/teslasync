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
 * each branch by shaping a scenario. Single and bulk update hooks are spies.
 *
 * `@testing-library/user-event` is NOT installed in this repo (see
 * EditableText.test.tsx), so interactions are driven via `fireEvent`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, renderHook, act, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { FeedbackEntry } from '@/api/types'
import type { FeedbackListParams } from '@/api/hooks/useFeedback'
import * as apiClient from '@/api/client'
import type { OperationalModeContextValue } from '@/hooks/useOperationalMode'
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions'

vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => operationalMode,
}))

vi.mock('@/api/hooks/_toastHelpers', () => ({
  useMutationToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

let operationalMode: OperationalModeContextValue

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
  return {
    ...actual,
    useFeedbackList: vi.fn(),
    useUpdateFeedback: vi.fn(),
    useBulkUpdateFeedback: vi.fn(),
  }
})

import { useSettings } from '@/hooks/useSettings'
import {
  useBulkUpdateFeedback,
  useFeedbackList,
  useUpdateFeedback,
} from '@/api/hooks/useFeedback'
import FeedbackQueuePage from './FeedbackQueuePage'

const mockUseFeedbackList = useFeedbackList as unknown as ReturnType<typeof vi.fn>
const mockUseUpdateFeedback = useUpdateFeedback as unknown as ReturnType<typeof vi.fn>
const mockUseBulkUpdateFeedback =
  useBulkUpdateFeedback as unknown as ReturnType<typeof vi.fn>
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

type FeedbackFixture = Omit<FeedbackEntry, 'user_email' | 'console_tail' | 'submitter_ip'> & {
  user_email: string | null
  console_tail: string | null
  submitter_ip: string | null
}

interface Scenario {
  main: Record<string, unknown>
  counts: Record<FacetKey, Record<string, unknown>>
}

let refetches: Record<string, ReturnType<typeof vi.fn>>
let mockMutate: ReturnType<typeof vi.fn>
let mockBulkMutateAsync: ReturnType<typeof vi.fn>
let scenario: Scenario

function rowA(): FeedbackFixture {
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

function rowB(): FeedbackFixture {
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
  const counts = {} as Scenario['counts']
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
    isPending: Boolean(m.isPending),
    fetchStatus: m.fetchStatus,
    isPlaceholderData: Boolean(m.isPlaceholderData),
    refetch: refetches.main,
  }
}

function feedbackListImpl(params: FeedbackListParams = {}) {
  if (params?.limit === 1) {
    const facet = params.status || params.category
    if (facet) return countResult(facet)
  }
  return mainResult()
}

beforeEach(() => {
  operationalMode = {
    mode: 'live', asOf: null, online: true, isReadOnly: false,
    label: 'Live', description: '', canWrite: true, writeBlockReason: null,
  }
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
  mockBulkMutateAsync = vi.fn().mockResolvedValue([])

  mockUseSettings.mockReset()
  mockUseSettings.mockReturnValue({ settings: baseSettings, locale: 'en-US' })

  mockUseUpdateFeedback.mockReset()
  mockUseUpdateFeedback.mockReturnValue({ mutate: mockMutate, isPending: false })
  mockUseBulkUpdateFeedback.mockReset()
  mockUseBulkUpdateFeedback.mockReturnValue({
    mutateAsync: mockBulkMutateAsync,
    isPending: false,
  })

  mockUseFeedbackList.mockReset()
  mockUseFeedbackList.mockImplementation(feedbackListImpl)

  configure()
})

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/feedback']}>
        <FeedbackQueuePage />
      </MemoryRouter>
    </QueryClientProvider>
  )
  const result = render(tree())
  return { ...result, rerenderPage: () => result.rerender(tree()) }
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
  it.each(['cached', 'as_of'] as const)(
    'blocks manual writes in %s mode without losing retained feedback, selection or drafts, then recovers',
    async (mode) => {
      const { rerenderPage } = renderPage()
      fireEvent.click(screen.getAllByRole('checkbox', { name: /^Select (?!all)/ })[0])
      expandRow('Timeline cuts off early')
      fireEvent.change(within(drawerFor('Timeline cuts off early')).getByRole('textbox'), {
        target: { value: 'https://github.com/acme/repo/issues/7' },
      })
      const reason = mode === 'cached'
        ? 'Reconnect before making operational changes.'
        : 'Return to live mode before making operational changes.'
      operationalMode = { ...operationalMode, mode, canWrite: false, isReadOnly: true, writeBlockReason: reason }
      configure({ main: { isError: true, error: new Error('refresh failed') } })
      rerenderPage()

      expect(screen.getByText(reason)).toHaveAttribute('role', 'status')
      expect(screen.getByText('Add dark map tiles')).toBeInTheDocument()
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument()
      for (const name of ['Mark triaged', 'Close selected', 'Reopen selected']) {
        const button = screen.getByRole('button', { name })
        expect(button).toBeDisabled()
        expect(button).toHaveAttribute('title', reason)
        fireEvent.click(button)
      }
      const region = drawerFor('Timeline cuts off early')
      expect(within(region).getByRole('combobox')).toBeDisabled()
      expect(within(region).getByRole('textbox')).toBeDisabled()
      expect(within(region).getByRole('button', { name: 'Save URL' })).toBeDisabled()
      fireEvent.change(within(region).getByRole('combobox'), { target: { value: 'closed' } })
      expect(mockMutate).not.toHaveBeenCalled()
      expect(mockBulkMutateAsync).not.toHaveBeenCalled()
      expect(screen.getAllByRole('checkbox', { name: /^Deselect (?!all)/ })[0]).toBeChecked()

      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      expect(refetches.main).toHaveBeenCalledTimes(1)
      operationalMode = { ...operationalMode, mode: 'live', canWrite: true, isReadOnly: false, writeBlockReason: null }
      configure()
      rerenderPage()
      expect(screen.queryByText(reason)).toBeNull()
      expect(screen.queryByTestId('stale-refresh-warning')).toBeNull()
      expect(within(drawerFor('Timeline cuts off early')).getByRole('textbox')).toHaveValue('https://github.com/acme/repo/issues/7')
      fireEvent.change(within(drawerFor('Timeline cuts off early')).getByRole('combobox'), { target: { value: 'closed' } })
      expect(mockMutate).toHaveBeenCalledWith({ id: 101, update: { status: 'closed' } })
      fireEvent.click(screen.getByRole('button', { name: 'Close selected' }))
      await waitFor(() => expect(mockBulkMutateAsync).toHaveBeenCalledWith({ ids: [101], update: { status: 'closed' } }))
    },
  )

  it('uses restrained issue-link roles and retains every column in the contained mobile table', () => {
    renderPage()
    const link = screen.getByRole('link', { name: /Open issue/i })
    expect(link).toHaveClass('text-[var(--semantic-info)]', 'min-h-11')
    expect(link).not.toHaveClass('text-cyan-300', 'text-xs')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer noopener')
    for (const title of ['Category', 'Page', 'Reporter', 'GitHub']) {
      const header = screen.getByRole('columnheader', { name: title })
      expect(header).not.toHaveClass('hidden')
      expect(header).not.toHaveClass('md:table-cell')
    }
    expect(screen.getByText('/drives')).toBeInTheDocument()
  })

  describe('manual feedback request protection', () => {
    it.each(['single', 'bulk'] as const)('opts every %s PATCH into live-mode protection', async (kind) => {
      const actual = await vi.importActual<typeof import('@/api/hooks/useFeedback')>('@/api/hooks/useFeedback')
      const request = vi.spyOn(apiClient, 'request').mockResolvedValue(rowA())
      const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      )
      const { result, unmount } = renderHook(() => ({
        single: actual.useUpdateFeedback(),
        bulk: actual.useBulkUpdateFeedback(),
      }), { wrapper })
      try {
        await act(async () => {
          if (kind === 'single') await result.current.single.mutateAsync({ id: 101, update: { status: 'closed' } })
          else await result.current.bulk.mutateAsync({ ids: [101, 102], update: { status: 'closed' } })
        })
        expect(request).toHaveBeenCalledTimes(kind === 'single' ? 1 : 2)
        for (const [path, options] of request.mock.calls) {
          expect(path).toMatch(/^\/admin\/feedback\/10[12]$/)
          expect(options).toMatchObject({
            method: 'PATCH', requiresLiveMode: true, body: JSON.stringify({ status: 'closed' }),
          })
        }
      } finally {
        unmount()
        qc.clear()
        request.mockRestore()
      }
    })
  })

  it('distinguishes filtered no-results from an empty queue and clears both filters', () => {
    renderPage()
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'closed' } })
    configure({ main: { data: { items: [], total: 0, limit: 25, offset: 0, github_bridge_enabled: false } } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'bug' } })
    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.queryByText('No feedback yet')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Triage progress' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('')
    expect(mockUseFeedbackList).toHaveBeenCalledWith({
      status: undefined, category: undefined, limit: 25, offset: 0,
    })
  })

  it('retains placeholder evidence and selected IDs while disabling prior-scope mutations', () => {
    configure({ main: { isPlaceholderData: true, isFetching: true } })
    renderPage()
    expect(screen.getByText('Timeline cuts off early')).toBeInTheDocument()
    expect(screen.getByText('Loading...')).toHaveAttribute('role', 'status')
    fireEvent.click(screen.getAllByRole('checkbox', { name: /^Select (?!all)/ })[0])
    for (const name of ['Mark triaged', 'Close selected', 'Reopen selected']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expandRow('Timeline cuts off early')
    const region = drawerFor('Timeline cuts off early')
    expect(within(region).getByRole('combobox')).toBeDisabled()
    expect(within(region).getByRole('textbox')).toBeDisabled()
    expect(within(region).getByRole('button', { name: 'Save URL' })).toBeDisabled()
    expect(screen.getAllByRole('checkbox', { name: /^Deselect (?!all)/ })[0]).toBeChecked()
    expect(mockMutate).not.toHaveBeenCalled()
    expect(mockBulkMutateAsync).not.toHaveBeenCalled()
  })

  it('keeps whole-queue scope and all six facet measurements in the actual reviewable brief', () => {
    renderPage()
    const summary = screen.getByTestId('feedback-queue-summary')
    expect(summary).toHaveAttribute('data-operational-brief')
    expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(6)
    // Scope moved from the face to the Review-details drawer.
    expect(summary).not.toHaveTextContent('unaffected by the table filters')
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }))
    const drawer = screen.getByRole('dialog')
    expect(drawer).toHaveTextContent('unaffected by the table filters')
    expect(drawer).toHaveTextContent('independent status and category queries')
    expect(screen.getByText('Queue')).toBeInTheDocument()
  })

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
    expect(screen.getByText('6 · 60.00%')).toBeInTheDocument()

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
      main: { isLoading: true, isFetching: true, data: undefined },
      counts: Object.fromEntries(
        FACET_KEYS.map((k) => [k, { total: undefined, isLoading: true }]),
      ) as Partial<Record<FacetKey, Record<string, unknown>>>,
    })

    const { container } = renderPage()

    // The page mounted (title present) but the data + empty branches are gated.
    expect(screen.getByRole('heading', { name: 'Feedback queue' })).toBeInTheDocument()
    expect(screen.queryByText('Timeline cuts off early')).toBeNull()
    expect(screen.queryByText('No feedback yet')).toBeNull()
    // The table's multi-line Skeleton contains static source-shaped blocks.
    expect(container.querySelectorAll('[aria-hidden="true"] > [class~="bg-[var(--skeleton-bg)]"]').length).toBeGreaterThan(0)
  })

  it('renders the QueryError banner when the table query fails and retries the LIST on click', () => {
    configure({ main: { isError: true, error: new Error('boom'), data: undefined } })

    renderPage()

    // Generic Error (no ApiError status) + jsdom online → network error copy.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }))
    expect(refetches.main).toHaveBeenCalledTimes(1)
  })

  it.each(['paused', 'idle'] as const)(
    'does not infer an empty queue from an unresolved %s request and preserves neighboring sections',
    (fetchStatus) => {
      configure({
        main: { data: undefined, isPending: true, isLoading: false, fetchStatus },
      })
      const { container, rerenderPage } = renderPage()

      const unresolvedNotice = screen.getByText('No requested source has returned usable data yet.').closest('[role="status"]')
      expect(unresolvedNotice).toHaveTextContent(
        fetchStatus === 'paused' ? 'Refresh paused' : 'Unknown',
      )
      expect(unresolvedNotice).toHaveTextContent('No requested source has returned usable data yet.')
      expect(screen.queryByText('No feedback yet')).toBeNull()
      expect(screen.queryByText("Can't reach server")).toBeNull()
      expect(container.querySelector('[class~="bg-[var(--skeleton-bg)]"]')).toBeNull()
      expect(screen.getByTestId('feedback-queue-summary')).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Status distribution: 5 new, 3 triaged, 2 closed' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Category mix' })).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Status' })).toBeEnabled()
      expect(screen.getByRole('combobox', { name: 'Category' })).toBeEnabled()
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      expect(refetches.main).toHaveBeenCalledTimes(1)

      configure({
        main: { data: { items: [], total: 0, limit: 25, offset: 0 } },
      })
      rerenderPage()
      expect(screen.getByText('No feedback yet')).toBeInTheDocument()
      expect(screen.queryByText('No requested source has returned usable data yet.')).toBeNull()
    },
  )

  it('uses the unresolved DataState for active fetching even when isLoading is false', () => {
    configure({
      main: { data: undefined, isLoading: false, isPending: true, isFetching: true, fetchStatus: 'fetching' },
    })
    const { container } = renderPage()
    expect(container.querySelector('[class~="bg-[var(--skeleton-bg)]"]')).not.toBeNull()
    expect(screen.queryByText('No feedback yet')).toBeNull()
    expect(screen.queryByText('Refresh paused')).toBeNull()
    expect(screen.getByTestId('feedback-queue-summary')).toBeInTheDocument()
  })

  it('retains populated rows, expansion and selection when refreshing is paused', () => {
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getAllByRole('checkbox', { name: /^Select (?!all)/ })[0])
    expandRow('Timeline cuts off early')
    configure({ main: { fetchStatus: 'paused' } })
    rerenderPage()

    expect(screen.getByText('Timeline cuts off early')).toBeInTheDocument()
    expect(drawerFor('Timeline cuts off early')).toHaveTextContent('Body A')
    expect(screen.getAllByRole('checkbox', { name: /^Deselect (?!all)/ })[0]).toBeChecked()
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true')
    expect(screen.queryByText('No feedback yet')).toBeNull()
    expect(screen.queryByText("Can't reach server")).toBeNull()
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'closed' } })
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

  it('clamps to the last remaining page after a settled shrink without clearing filters, selection or expansion', () => {
    configure({
      main: { data: { items: [rowA()], total: 60, limit: 25, offset: 0 } },
    })
    const { rerenderPage } = renderPage()
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'new' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'bug' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getAllByRole('checkbox', { name: /^Select (?!all)/ })[0])
    expandRow('Timeline cuts off early')

    configure({ main: { data: { items: [], total: 26, limit: 25, offset: 50 } } })
    rerenderPage()

    expect(mockUseFeedbackList).toHaveBeenCalledWith({
      status: 'new', category: 'bug', limit: 25, offset: 25,
    })
    expect(screen.getByText('Page 2 of 2 (26 entries)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('new')
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('bug')

    configure({ main: { data: { items: [rowA()], total: 26, limit: 25, offset: 25 } } })
    rerenderPage()
    expect(screen.getAllByRole('checkbox', { name: /^Deselect (?!all)/ })[0]).toBeChecked()
    expect(drawerFor('Timeline cuts off early')).toHaveTextContent('Body A')
  })

  it.each([25, 0])('clamps an empty later page to offset zero when the settled total becomes %i', (total) => {
    configure({ main: { data: { items: [rowA()], total: 60, limit: 25, offset: 0 } } })
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    mockUseFeedbackList.mockClear()

    configure({ main: { data: { items: [], total, limit: 25, offset: 50 } } })
    rerenderPage()

    expect(mockUseFeedbackList).toHaveBeenLastCalledWith({ category: 'other', limit: 1 })
    expect(mockUseFeedbackList).toHaveBeenCalledWith({
      status: undefined, category: undefined, limit: 25, offset: 0,
    })
    expect(screen.getByText('No feedback yet')).toBeInTheDocument()
  })

  it.each([
    { isFetching: true },
    { isPlaceholderData: true },
    { isLoading: true },
    { isError: true, error: new Error('refresh failed') },
  ])('does not clamp from an unsettled or failed total: %j', (queryState) => {
    configure({ main: { data: { items: [rowA()], total: 60, limit: 25, offset: 0 } } })
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    mockUseFeedbackList.mockClear()

    configure({
      main: { ...queryState, data: { items: [], total: 0, limit: 25, offset: 50 } },
    })
    rerenderPage()
    expect(mockUseFeedbackList).not.toHaveBeenCalledWith(expect.objectContaining({ limit: 25, offset: 0 }))
    expect(screen.getByRole('button', { name: 'Previous' })).toBeInTheDocument()

    configure({ main: { data: { items: [], total: 0, limit: 25, offset: 50 } } })
    rerenderPage()
    expect(mockUseFeedbackList).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, offset: 0 }))
  })

  it('keeps Previous usable when a settled empty page still has a valid offset', () => {
    configure({ main: { data: { items: [rowA()], total: 60, limit: 25, offset: 0 } } })
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    configure({ main: { data: { items: [], total: 60, limit: 25, offset: 25 } } })
    rerenderPage()
    expect(screen.getByText('No feedback yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
    mockUseFeedbackList.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(mockUseFeedbackList).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, offset: 0 }))
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

  it.each(['single', 'bulk'] as const)(
    'blocks all manual actions while a %s update is pending and restores them without losing selection or drafts',
    (pendingMutation) => {
      configure({
        main: {
          data: {
            items: [rowA(), rowB()], total: 2, limit: 25, offset: 0,
            github_bridge_enabled: true, github_repo: 'ev-dev-labs/teslasync',
          },
        },
      })
      const { rerenderPage } = renderPage()
      fireEvent.click(screen.getAllByRole('checkbox', { name: /^Select (?!all)/ })[0])
      expandRow('Timeline cuts off early')
      const region = drawerFor('Timeline cuts off early')
      fireEvent.change(within(region).getByRole('textbox'), {
        target: { value: 'https://github.com/acme/repo/issues/7' },
      })

      mockUseUpdateFeedback.mockReturnValue({
        mutate: mockMutate, isPending: pendingMutation === 'single',
      })
      mockUseBulkUpdateFeedback.mockReturnValue({
        mutateAsync: mockBulkMutateAsync, isPending: pendingMutation === 'bulk',
      })
      rerenderPage()

      for (const name of ['Mark triaged', 'Close selected', 'Reopen selected']) {
        expect(screen.getByRole('button', { name })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name }))
      }
      expect(within(region).getByRole('combobox')).toBeDisabled()
      expect(within(region).getByRole('textbox')).toBeDisabled()
      for (const name of ['Save URL', 'Forward to GitHub']) {
        expect(within(region).getByRole('button', { name })).toBeDisabled()
        fireEvent.click(within(region).getByRole('button', { name }))
      }
      // Synthetic change events bypass native disabled-select behavior; the
      // page's handler must still reject the mutation.
      fireEvent.change(within(region).getByRole('combobox'), { target: { value: 'closed' } })
      expect(mockMutate).not.toHaveBeenCalled()
      expect(mockBulkMutateAsync).not.toHaveBeenCalled()
      expect(screen.getAllByRole('checkbox', { name: /^Deselect (?!all)/ })[0]).toBeChecked()

      mockUseUpdateFeedback.mockReturnValue({ mutate: mockMutate, isPending: false })
      mockUseBulkUpdateFeedback.mockReturnValue({ mutateAsync: mockBulkMutateAsync, isPending: false })
      rerenderPage()
      expect(screen.getByRole('button', { name: 'Mark triaged' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Close selected' })).toBeEnabled()
      expect(within(region).getByRole('combobox')).toBeEnabled()
      expect(within(region).getByRole('textbox')).toHaveValue('https://github.com/acme/repo/issues/7')
      expect(within(region).getByRole('button', { name: 'Save URL' })).toBeEnabled()
      expect(within(region).getByRole('button', { name: 'Forward to GitHub' })).toBeEnabled()
      fireEvent.click(within(region).getByRole('button', { name: 'Save URL' }))
      expect(mockMutate).toHaveBeenCalledWith({
        id: 101, update: { github_issue_url: 'https://github.com/acme/repo/issues/7' },
      })
    },
  )

  it('retains selected feedback after a failed bulk update so the same rows can be retried', async () => {
    mockBulkMutateAsync.mockRejectedValueOnce(new Error('bulk update failed'))
    renderPage()
    fireEvent.click(screen.getAllByRole('checkbox', { name: /^Select (?!all)/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Close selected' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close selected' })).toBeEnabled())
    expect(screen.getAllByRole('checkbox', { name: /^Deselect (?!all)/ })[0]).toBeChecked()
    expect(mockBulkMutateAsync).toHaveBeenCalledWith({ ids: [101], update: { status: 'closed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close selected' }))
    await waitFor(() => expect(mockBulkMutateAsync).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close selected' })).toBeNull())
  })

  it('bulk-updates selected feedback and clears the selection after success', async () => {
    renderPage()

    // Row checkboxes are named after the feedback entry (A11Y), e.g.
    // "Select bug: Charging graph is empty".
    fireEvent.click(screen.getAllByRole('checkbox', { name: /^Select (?!all)/ })[0])
    const closeSelected = screen.getByRole('button', { name: 'Close selected' })
    fireEvent.click(closeSelected)

    await waitFor(() =>
      expect(mockBulkMutateAsync).toHaveBeenCalledWith({
        ids: [101],
        update: { status: 'closed' },
      }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Close selected' })).toBeNull(),
    )
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

  it('keeps retained queue rows, whole-queue proportions and selected IDs during failed refreshes', async () => {
    configure({
      main: { isError: true, error: new Error('list refresh failed') },
      counts: { new: { error: new Error('status refresh failed') }, bug: { error: new Error('category refresh failed') } },
    })
    renderPage()
    expect(screen.getByText('Timeline cuts off early')).toBeInTheDocument()
    expect(screen.getByText('Add dark map tiles')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Status distribution: 5 new, 3 triaged, 2 closed' })).toBeInTheDocument()
    expect(screen.getByText('6 · 60.00%')).toBeInTheDocument()
    expect(screen.queryByText("Can't reach server")).toBeNull()
    expect(screen.getAllByText('Previously loaded data remains visible while affected sources recover.').length).toBeGreaterThanOrEqual(3)
    fireEvent.click(screen.getAllByRole('checkbox', { name: /^Select (?!all)/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Close selected' }))
    await waitFor(() => expect(mockBulkMutateAsync).toHaveBeenCalledWith({
      ids: [101], update: { status: 'closed' },
    }))
  })

  it('retains known status counts without inventing an unknown total or denominator after a partial first load', () => {
    configure({ counts: { new: { total: undefined, error: new Error('counts down') } } })
    renderPage()
    // The unknown total is omitted from the face (never dashed, never a
    // partial sum), as is the failed 'new' count it depends on; both are
    // counted as hidden in the drawer.
    const summary = screen.getByTestId('feedback-queue-summary')
    expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(4)
    assertOperationalMetricUnavailable(summary, 'Total feedback')
    assertOperationalMetricUnavailable(summary, 'New')
    expect(within(summary).queryByText('5')).toBeNull()
    expect(screen.queryByRole('img', { name: /Status distribution:/ })).toBeNull()
    const triageCard = screen.getByRole('heading', { name: 'Triage progress' }).closest('[data-card]')
    if (!triageCard) throw new Error('Missing triage panel')
    expect(within(triageCard).getByText('New').closest('div')).toHaveTextContent('—')
    expect(within(triageCard).getByText('Triaged').closest('div')).toHaveTextContent('3')
    expect(within(triageCard).getByText('Closed').closest('div')).toHaveTextContent('2')
    expect(within(triageCard).getByText('Partial data')).toBeInTheDocument()
    expect(screen.getByText('6 · 60.00%')).toBeInTheDocument()
    expect(screen.getByText('Timeline cuts off early')).toBeInTheDocument()
  })
})
