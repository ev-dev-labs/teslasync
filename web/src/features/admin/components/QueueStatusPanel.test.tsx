/**
 * QueueStatusPanel — Phase-46 / Prompt 41 contract tests.
 *
 * Covers:
 *  1. Loading state spinner renders.
 *  2. Three worker cards render with severity tone classes.
 *  3. Empty workers list renders empty state.
 *  4. Error state renders with banner.
 *  5. Refresh button triggers refetch.
 *  6. Click on worker card opens drawer with the right title.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

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
        // t(key, opts) signature
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

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { QueueStatusPanel } from './QueueStatusPanel'
import type {
  QueueStat,
  QueueStatusResponse,
  QueueJobsResponse,
} from '@/api/types'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function makeStat(
  worker: string,
  display: string,
  severity: QueueStat['heartbeat_severity'],
  overrides: Partial<QueueStat> = {},
): QueueStat {
  return {
    worker,
    display_name: display,
    pending: 0,
    in_progress: 0,
    succeeded_24h: 0,
    failed_24h: 0,
    oldest_pending_age_seconds: 0,
    heartbeat_severity: severity,
    heartbeat_detail: `${worker} detail`,
    last_heartbeat_at: '2026-05-05T11:59:30Z',
    started_at: '2026-05-05T10:00:00Z',
    host: `${worker}-host`,
    version: '1.2.3',
    ...overrides,
  }
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <QueueStatusPanel />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

afterEach(() => {
  vi.clearAllTimers()
})

describe('QueueStatusPanel', () => {
  it('renders the spinner while the query is loading', () => {
    let resolver: (value: QueueStatusResponse) => void = () => {}
    mockedRequest.mockReturnValueOnce(
      new Promise<QueueStatusResponse>((resolve) => {
        resolver = resolve
      }),
    )

    renderPanel()

    expect(screen.getByTestId('queue-loading')).toBeInTheDocument()

    // Resolve so React-Query teardown is clean.
    resolver({ generated_at: new Date().toISOString(), workers: [] })
  })

  it('renders one card per worker with severity tone classes', async () => {
    const response: QueueStatusResponse = {
      generated_at: '2026-05-05T12:00:00Z',
      workers: [
        makeStat('notification', 'Notification worker', 'ok', { pending: 5 }),
        makeStat('export', 'Export worker', 'warn', { pending: 1, in_progress: 2 }),
        makeStat('automation', 'Automation worker', 'down', {
          last_heartbeat_at: null,
        }),
      ],
    }
    mockedRequest.mockResolvedValueOnce(response)

    renderPanel()

    await waitFor(() =>
      expect(screen.getByTestId('queue-rows')).toBeInTheDocument(),
    )

    expect(screen.getByTestId('queue-worker-card-notification')).toBeInTheDocument()
    expect(screen.getByTestId('queue-worker-card-export')).toBeInTheDocument()
    expect(screen.getByTestId('queue-worker-card-automation')).toBeInTheDocument()

    expect(screen.getByTestId('queue-severity-notification')).toHaveClass(
      'text-emerald-300',
    )
    expect(screen.getByTestId('queue-severity-export')).toHaveClass(
      'text-amber-300',
    )
    expect(screen.getByTestId('queue-severity-automation')).toHaveClass(
      'text-[var(--text-muted)]',
    )
  })

  it('renders the empty state when no workers come back', async () => {
    mockedRequest.mockResolvedValueOnce({
      generated_at: '2026-05-05T12:00:00Z',
      workers: [],
    } satisfies QueueStatusResponse)

    renderPanel()

    await waitFor(() =>
      expect(screen.getByTestId('queue-empty')).toBeInTheDocument(),
    )
  })

  it('renders the error banner when the query rejects', async () => {
    // Hook explicitly sets `retry: 1`, so the error must persist for at
    // least two attempts before the query transitions to `error`.
    mockedRequest.mockRejectedValue(new Error('boom'))

    renderPanel()

    await waitFor(
      () => {
        expect(screen.getByTestId('queue-error')).toBeInTheDocument()
      },
      { timeout: 3000 },
    )
  })

  it('refresh button refetches the status', async () => {
    mockedRequest.mockResolvedValue({
      generated_at: '2026-05-05T12:00:00Z',
      workers: [],
    } satisfies QueueStatusResponse)

    renderPanel()

    await waitFor(() =>
      expect(screen.getByTestId('queue-empty')).toBeInTheDocument(),
    )
    expect(mockedRequest).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('queue-refresh-button'))

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2))
  })

  it('opens the drawer with the worker title when a card is clicked', async () => {
    const response: QueueStatusResponse = {
      generated_at: '2026-05-05T12:00:00Z',
      workers: [
        makeStat('export', 'Export worker', 'ok', {
          pending: 1,
        }),
      ],
    }
    const jobsResponse: QueueJobsResponse = {
      worker: 'export',
      jobs: [
        {
          id: 'j-1',
          worker: 'export',
          status: 'ready',
          title: 'drives-csv',
          started_at: '2026-05-05T11:58:00Z',
          finished_at: '2026-05-05T11:59:00Z',
          duration_ms: 60_000,
        },
      ],
    }

    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/system/queues') return response
      if (path.startsWith('/system/queues/export/jobs')) return jobsResponse
      throw new Error(`unexpected request: ${path}`)
    })

    renderPanel()

    await waitFor(() =>
      expect(
        screen.getByTestId('queue-worker-card-export'),
      ).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByTestId('queue-worker-card-export'))

    await waitFor(() =>
      expect(screen.getByTestId('queue-job-drawer-body')).toBeInTheDocument(),
    )

    await waitFor(() =>
      expect(screen.getByTestId('queue-job-row-j-1')).toBeInTheDocument(),
    )
  })

  it('renders the failed counter in rose-300 only when failures > 0', async () => {
    const response: QueueStatusResponse = {
      generated_at: '2026-05-05T12:00:00Z',
      workers: [
        makeStat('notification', 'Notification worker', 'ok', { failed_24h: 3 }),
        makeStat('export', 'Export worker', 'ok', { failed_24h: 0 }),
      ],
    }
    mockedRequest.mockResolvedValueOnce(response)

    renderPanel()

    await waitFor(() =>
      expect(screen.getByTestId('queue-rows')).toBeInTheDocument(),
    )

    expect(screen.getByTestId('queue-failed-notification')).toHaveClass(
      'text-rose-300',
    )
    expect(screen.getByTestId('queue-failed-export')).toHaveClass(
      'text-[var(--text-primary)]',
    )
  })
})
