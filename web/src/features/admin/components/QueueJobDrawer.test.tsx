/**
 * QueueJobDrawer contract tests.
 *
 * Exercises every rendered facet of the per-worker job-history drawer:
 *   - closed → nothing renders (no dialog, no network)
 *   - loading / error / empty branches each show their own testid
 *   - one row per job, with status-tone classes + unknown-status fallback
 *   - runtime label from `duration_ms`, derived from finished/started, or
 *     omitted entirely for zero/unresolved durations (the hardening fix —
 *     the old code rendered a meaningless "Took —")
 *   - per-job error box only when the job carries an error
 *   - title falls back to the job id when the title is blank
 *   - drawer heading reflects the optional displayName
 *   - the live hook only fetches when the drawer is open, and hits the
 *     correct snake_case endpoint
 *   - the icon-only Close control is reachable by its accessible name and
 *     fires onClose
 *
 * Network is mocked at `@/api/client` and react-i18next is stubbed so the
 * default English strings (with `{{var}}` interpolation) are asserted
 * deterministically. Nothing touches the real network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentProps, ReactNode } from 'react'

vi.mock('@/api/client', () => ({
  request: vi.fn(),
}))

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        // t(key, defaultStr, opts) signature
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { QueueJobDrawer, type QueueJobDrawerProps } from './QueueJobDrawer'
import type { QueueJobView, QueueJobsResponse } from '@/api/types'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

type JobsQuery = NonNullable<QueueJobDrawerProps['testHookOverride']>
type DrawerProps = ComponentProps<typeof QueueJobDrawer>

/** Minimal stand-in for the TanStack query result the drawer reads. */
function makeQuery(overrides: Partial<JobsQuery> = {}): JobsQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    ...overrides,
  } as unknown as JobsQuery
}

function makeJob(overrides: Partial<QueueJobView> = {}): QueueJobView {
  return {
    id: 'job-1',
    worker: 'export',
    status: 'ready',
    title: 'drives-csv',
    started_at: '2026-05-05T11:58:00Z',
    finished_at: '2026-05-05T11:59:00Z',
    duration_ms: 60_000,
    ...overrides,
  }
}

function jobsData(jobs: QueueJobView[]): QueueJobsResponse {
  return { worker: 'export', jobs }
}

function renderDrawer(props: Partial<DrawerProps> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const onClose = props.onClose ?? vi.fn()
  const merged: DrawerProps = {
    worker: 'export',
    open: true,
    ...props,
    onClose,
  }
  const utils = render(
    <QueryClientProvider client={client}>
      <QueueJobDrawer {...merged} />
    </QueryClientProvider>,
  )
  return { ...utils, onClose }
}

beforeEach(() => {
  mockedRequest.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('QueueJobDrawer', () => {
  it('renders nothing (and fires no request) while closed', () => {
    renderDrawer({
      open: false,
      testHookOverride: makeQuery({ data: jobsData([makeJob()]) }),
    })

    expect(screen.queryByTestId('queue-job-drawer-body')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the loading branch with an accessible list skeleton', () => {
    renderDrawer({ testHookOverride: makeQuery({ isLoading: true }) })

    expect(screen.getByTestId('queue-job-drawer-loading')).toBeInTheDocument()
    expect(
      screen.getByRole('status', { name: 'Loading recent jobs…' }),
    ).toHaveAttribute('aria-busy', 'true')
    expect(
      screen.queryByTestId('queue-job-drawer-list'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('queue-job-drawer-empty'),
    ).not.toBeInTheDocument()
  })

  it('shows the error branch when the query rejects', () => {
    renderDrawer({ testHookOverride: makeQuery({ error: new Error('boom') }) })

    expect(screen.getByTestId('queue-job-drawer-error')).toBeInTheDocument()
    expect(
      screen.getByText(/Could not load recent jobs/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('queue-job-drawer-list'),
    ).not.toBeInTheDocument()
  })

  it('shows the empty branch when no jobs come back', () => {
    renderDrawer({ testHookOverride: makeQuery({ data: jobsData([]) }) })

    expect(screen.getByTestId('queue-job-drawer-empty')).toBeInTheDocument()
    expect(screen.getByText(/No recent jobs to show/i)).toBeInTheDocument()
  })

  it('renders one row per job with status-tone classes and an unknown-status fallback', () => {
    const jobs = [
      makeJob({ id: 'a', status: 'failed', title: 'send-alert' }),
      makeJob({ id: 'b', status: 'ready', title: 'drives-csv' }),
      makeJob({ id: 'c', status: 'made-up', title: 'weird-job' }),
    ]
    renderDrawer({ testHookOverride: makeQuery({ data: jobsData(jobs) }) })

    expect(screen.getByTestId('queue-job-drawer-list')).toBeInTheDocument()
    expect(screen.getByTestId('queue-job-row-a')).toBeInTheDocument()
    expect(screen.getByTestId('queue-job-row-b')).toBeInTheDocument()
    expect(screen.getByTestId('queue-job-row-c')).toBeInTheDocument()

    expect(screen.getByTestId('queue-job-status-a')).toHaveClass('text-rose-300')
    expect(screen.getByTestId('queue-job-status-b')).toHaveClass(
      'text-emerald-300',
    )
    expect(screen.getByTestId('queue-job-status-c')).toHaveClass(
      'text-[var(--text-primary)]',
    )

    expect(screen.getByText('send-alert')).toBeInTheDocument()
  })

  it('formats the runtime from an explicit duration_ms', () => {
    const job = makeJob({ id: 'd', duration_ms: 90_000 })
    renderDrawer({ testHookOverride: makeQuery({ data: jobsData([job]) }) })

    const row = screen.getByTestId('queue-job-row-d')
    expect(row).toHaveTextContent('Took 1m 30s')
    expect(row).toHaveTextContent('Started')
  })

  it('derives the runtime from finished/started when duration_ms is absent', () => {
    const job = makeJob({
      id: 'e',
      duration_ms: null,
      started_at: '2026-05-05T11:58:00Z',
      finished_at: '2026-05-05T11:59:30Z', // 90s
    })
    renderDrawer({ testHookOverride: makeQuery({ data: jobsData([job]) }) })

    expect(screen.getByTestId('queue-job-row-e')).toHaveTextContent(
      'Took 1m 30s',
    )
  })

  it('omits the runtime segment for zero-length or unresolved durations', () => {
    const jobs = [
      makeJob({ id: 'zero', duration_ms: 0, finished_at: null }),
      makeJob({ id: 'nofinish', duration_ms: null, finished_at: null }),
      makeJob({
        id: 'badstamp',
        duration_ms: null,
        finished_at: '2026-05-05T11:59:00Z',
        started_at: 'not-a-real-date',
      }),
    ]
    renderDrawer({ testHookOverride: makeQuery({ data: jobsData(jobs) }) })

    expect(screen.getByTestId('queue-job-row-zero')).not.toHaveTextContent(
      'Took',
    )
    expect(screen.getByTestId('queue-job-row-nofinish')).not.toHaveTextContent(
      'Took',
    )
    expect(screen.getByTestId('queue-job-row-badstamp')).not.toHaveTextContent(
      'Took',
    )
    // The row is never blank — the Started line is still present.
    expect(screen.getByTestId('queue-job-row-zero')).toHaveTextContent(
      'Started',
    )
  })

  it('renders the per-job error box only when a job carries an error', () => {
    const jobs = [
      makeJob({ id: 'ok' }),
      makeJob({ id: 'bad', status: 'failed', error: 'connection refused' }),
    ]
    renderDrawer({ testHookOverride: makeQuery({ data: jobsData(jobs) }) })

    expect(screen.queryByTestId('queue-job-error-ok')).not.toBeInTheDocument()
    expect(screen.getByTestId('queue-job-error-bad')).toBeInTheDocument()
    expect(screen.getByText('connection refused')).toBeInTheDocument()
  })

  it('falls back to the job id when the title is blank', () => {
    const job = makeJob({ id: 'job-xyz', title: '' })
    renderDrawer({ testHookOverride: makeQuery({ data: jobsData([job]) }) })

    const row = screen.getByTestId('queue-job-row-job-xyz')
    expect(within(row).getByText('job-xyz')).toBeInTheDocument()
  })

  it('renders the worker-specific heading when a displayName is supplied', () => {
    renderDrawer({
      displayName: 'Export worker',
      testHookOverride: makeQuery({ data: jobsData([]) }),
    })

    expect(
      screen.getByRole('heading', { name: 'Recent Export worker jobs' }),
    ).toBeInTheDocument()
  })

  it('renders the generic heading when no displayName is supplied', () => {
    renderDrawer({ testHookOverride: makeQuery({ data: jobsData([]) }) })

    expect(
      screen.getByRole('heading', { name: 'Recent jobs' }),
    ).toBeInTheDocument()
  })

  it('does not hit the network while the drawer is closed', () => {
    renderDrawer({ worker: 'export', open: false })

    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('fetches the worker jobs from the snake_case endpoint when opened', async () => {
    mockedRequest.mockResolvedValue(jobsData([]))

    renderDrawer({ worker: 'export', open: true })

    await waitFor(() => expect(mockedRequest).toHaveBeenCalled())
    expect(mockedRequest).toHaveBeenCalledWith(
      '/system/queues/export/jobs?limit=25',
      expect.anything(),
    )
  })

  it('invokes onClose when the icon-only Close control is activated', () => {
    const onClose = vi.fn()
    renderDrawer({
      onClose,
      testHookOverride: makeQuery({ data: jobsData([]) }),
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
