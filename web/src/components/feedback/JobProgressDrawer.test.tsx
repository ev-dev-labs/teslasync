/**
 * JobProgressDrawer contract.
 *
 * The drawer is a floating widget that surfaces in-flight + recently
 * finished export jobs. It has three localStorage-persisted states
 * (open / minimized / dismissed) and reads jobs through the real
 * `useExportJobs` hook. The shared `request` client is mocked so the hook
 * runs end-to-end without touching the network; `react-i18next` is stubbed
 * to fall back to default values (with `{{token}}` interpolation) so the
 * rendered copy asserts cleanly.
 *
 * Coverage:
 *   1. Empty: settles to nothing when there are no jobs.
 *   2. Minimized-by-default chip surfaces the active count.
 *   3. Clicking the chip expands + persists the `open` state.
 *   4. Open drawer renders active + recent sections and a download link
 *      with a descriptive accessible name + correct href (a11y regression).
 *   5. Failed jobs surface their error message and no download link.
 *   6. Minimize collapses to the chip; Dismiss (no active jobs) fully hides.
 *   7. A dismissed drawer auto-promotes to the chip when a new active job
 *      appears (never the full drawer) and persists the promotion.
 *   8. Loading copy shows while the request is in flight.
 *   9. Every status icon + pretty type/status label branch renders.
 *  10. Paused initial requests are not confused with loading or empty success.
 *  11. Refresh failures retain jobs, zero-byte downloads and drawer preferences.
 *  12. Initial failure and retained refresh failure recover through shared retry.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        const interpolate = (str: string) => {
          if (!opts) return str
          return Object.entries(opts).reduce<string>((acc, [k, v]) => {
            if (k === 'defaultValue') return acc
            return acc.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v))
          }, str)
        }
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue)
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { exportDownloadUrl, exportKeys, type ExportJobSummary } from '@/api/hooks/useExports'
import { JobProgressDrawer } from './JobProgressDrawer'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>
const STORAGE_KEY = 'teslasync.exportDrawer.state'

/** Build a job with sensible defaults; `created_at` is a fixed 10 minutes
 *  ago so the relative-time copy renders deterministically as "10m ago". */
function makeJob(overrides: Partial<ExportJobSummary> = {}): ExportJobSummary {
  return {
    id: 'job-1',
    type: 'drives',
    format: 'csv',
    status: 'processing',
    created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    ...overrides,
  }
}

function renderDrawer(props: { maxRecent?: number; className?: string } = {}) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  const result = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <JobProgressDrawer {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...result, qc }
}

beforeEach(() => {
  mockedRequest.mockReset()
  localStorage.clear()
})

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('JobProgressDrawer', () => {
  it.each([
    ['missing', undefined, '—'],
    ['null', null, '—'],
    ['NaN', Number.NaN, '—'],
    ['positive infinity', Number.POSITIVE_INFINITY, '—'],
    ['negative infinity', Number.NEGATIVE_INFINITY, '—'],
    ['measured zero', 0, '0 B'],
    ['positive', 512, '512 B'],
    ['negative', -512, '-512 B'],
    ['fractional', 0.5, '0.5 B'],
    ['negative fractional', -0.5, '-0.5 B'],
    ['scaled fractional', 1536, '1.50 KB'],
  ])('renders %s bytes distinctly from missing measurements', async (_case, fileSize, expected) => {
    localStorage.setItem(STORAGE_KEY, 'open')
    mockedRequest.mockResolvedValue([{ ...makeJob({ status: 'ready' }), file_size: fileSize }])
    renderDrawer()

    expect(await screen.findByText(`${expected} · 10m ago`)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /download drives export/i })).toBeInTheDocument()
  })

  it('shows paused feedback without inventing loading, empty results or a failure', async () => {
    localStorage.setItem(STORAGE_KEY, 'open')
    onlineManager.setOnline(false)
    mockedRequest.mockResolvedValue([])
    const { container } = renderDrawer()

    expect(await screen.findByText('Refresh paused')).toBeInTheDocument()
    expect(screen.queryByText(/loading export jobs|no active exports|no recent exports/i)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mockedRequest).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('open')

    act(() => onlineManager.setOnline(true))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(localStorage.getItem(STORAGE_KEY)).toBe('open')
  })

  it('retains jobs and downloads through refresh failure, retry and recovery', async () => {
    localStorage.setItem(STORAGE_KEY, 'open')
    mockedRequest.mockResolvedValue([makeJob({ status: 'ready', file_size: 0 })])
    const { qc } = renderDrawer()
    expect(await screen.findByText('0 B · 10m ago')).toBeInTheDocument()
    const download = screen.getByRole('link', { name: /download drives export/i })

    mockedRequest.mockRejectedValueOnce(new Error('refresh failed'))
    await act(async () => {
      await qc.refetchQueries({ queryKey: exportKeys.jobs })
    })
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(download).toBeInTheDocument()
    expect(screen.getByText('0 B · 10m ago')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('open')

    let resolveRefresh!: (jobs: ExportJobSummary[]) => void
    mockedRequest.mockReturnValueOnce(new Promise<ExportJobSummary[]>((resolve) => {
      resolveRefresh = resolve
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('button', { name: 'Updating…' })).toBeDisabled()
    expect(download).toBeInTheDocument()
    await act(async () => {
      resolveRefresh([makeJob({ status: 'ready', file_size: 1024 })])
    })
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).toBeNull())
    expect(screen.getByText('1.00 KB · 10m ago')).toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('open')
  })

  it('offers initial failure recovery rather than treating a failed request as empty', async () => {
    localStorage.setItem(STORAGE_KEY, 'open')
    mockedRequest.mockRejectedValueOnce(new Error('request failed'))
    renderDrawer()
    const retry = await screen.findByRole('button', { name: 'Retry' })
    expect(screen.queryByText(/no active exports|no recent exports/i)).toBeNull()
    mockedRequest.mockResolvedValueOnce([makeJob({ status: 'ready' })])
    fireEvent.click(retry)
    expect(await screen.findByRole('link', { name: /download drives export/i })).toBeInTheDocument()
  })

  it.each(['minimized', 'dismissed'] as const)('preserves %s preference across a retained refresh failure', async (preference) => {
    localStorage.setItem(STORAGE_KEY, preference)
    mockedRequest.mockResolvedValue([makeJob({ status: 'ready' })])
    const { qc, container } = renderDrawer()
    await waitFor(() => expect(qc.getQueryData(exportKeys.jobs)).toBeDefined())
    mockedRequest.mockRejectedValueOnce(new Error('refresh failed'))
    await act(async () => {
      await qc.refetchQueries({ queryKey: exportKeys.jobs })
    })
    expect(localStorage.getItem(STORAGE_KEY)).toBe(preference)
    expect(screen.queryByRole('region')).toBeNull()
    if (preference === 'dismissed') {
      expect(container).toBeEmptyDOMElement()
    } else {
      fireEvent.click(screen.getByRole('button', { name: /show export jobs/i }))
      expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /download drives export/i })).toBeInTheDocument()
    }
  })

  it('keeps mobile targets, dense desktop actions, full errors and keyboard expansion', async () => {
    const user = userEvent.setup()
    const error = 'An export failed with a long diagnostic that must remain fully accessible on narrow screens.'
    mockedRequest.mockResolvedValue([
      makeJob({ id: 'ready', status: 'ready' }),
      makeJob({ id: 'failed', status: 'failed', error_message: error }),
    ])
    renderDrawer()
    const chip = await screen.findByRole('button', { name: /show export jobs/i })
    expect(chip).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'whitespace-normal')
    chip.focus()
    await user.keyboard('{Enter}')
    const region = await screen.findByRole('region', { name: /export job progress/i })
    const message = await within(region).findByText(error)
    expect(message).toHaveClass('break-words')
    expect(message).not.toHaveClass('truncate')
    for (const name of ['Minimize', 'Dismiss']) {
      expect(within(region).getByRole('button', { name })).toHaveClass('min-h-11', 'min-w-11', 'md:h-6', 'md:w-6')
    }
    expect(within(region).getByRole('link', { name: /download drives export/i })).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-0')
    const minimize = within(region).getByRole('button', { name: 'Minimize' })
    minimize.focus()
    await user.keyboard(' ')
    expect(await screen.findByRole('button', { name: /show export jobs/i })).toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('minimized')
  })

  it('preserves format acronyms without forcing the casing of other format values', async () => {
    localStorage.setItem(STORAGE_KEY, 'open')
    mockedRequest.mockResolvedValue([
      makeJob({ id: 'csv', format: 'csv' }),
      makeJob({ id: 'json', format: 'json' }),
      makeJob({ id: 'other', format: 'Custom format' }),
    ])
    renderDrawer()

    for (const format of ['CSV', 'JSON', 'Custom format']) {
      expect(await screen.findByText(format)).not.toHaveClass('uppercase', 'capitalize')
    }
  })

  it('hits the correct endpoint and renders nothing once an empty list settles', async () => {
    mockedRequest.mockResolvedValue([])
    const { container } = renderDrawer()

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/export/jobs', expect.anything()),
    )
    // No jobs + not loading → the widget removes itself entirely.
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(screen.queryByRole('region', { name: /export job progress/i })).toBeNull()
  })

  it('shows a minimized chip with the active count by default', async () => {
    mockedRequest.mockResolvedValue([makeJob({ id: 'a', status: 'processing' })])
    renderDrawer()

    // Wait for the fetched active count to land before asserting the copy.
    expect(await screen.findByText(/1 export running/i)).toBeInTheDocument()
    const chip = screen.getByRole('button', { name: /show export jobs/i })
    expect(chip).toHaveTextContent(/1 export running/i)
    // Collapsed chip only — the full drawer region is not mounted yet.
    expect(screen.queryByRole('region', { name: /export job progress/i })).toBeNull()
  })

  it('expands to the full drawer and persists the open state when the chip is clicked', async () => {
    mockedRequest.mockResolvedValue([
      makeJob({ id: 'a', status: 'processing', type: 'drives' }),
    ])
    renderDrawer()

    fireEvent.click(await screen.findByRole('button', { name: /show export jobs/i }))

    const region = await screen.findByRole('region', { name: /export job progress/i })
    expect(within(region).getByText('Export jobs')).toBeInTheDocument()
    expect(within(region).getByText(/1 active/i)).toBeInTheDocument()
    // prettyStatus + relative time render in the active status line.
    expect(within(region).getByText('Processing · started 10m ago')).toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('open')
  })

  it('renders active + recent sections and a labelled download link for ready jobs', async () => {
    localStorage.setItem(STORAGE_KEY, 'open')
    mockedRequest.mockResolvedValue([
      makeJob({
        id: 'ready-1',
        status: 'ready',
        type: 'charging',
        file_size: 2_500_000,
        completed_at: new Date().toISOString(),
      }),
    ])
    renderDrawer()

    const region = await screen.findByRole('region', { name: /export job progress/i })
    // Wait for the request to settle so the body swaps loading → sections.
    expect(await within(region).findByText('Charging')).toBeInTheDocument()
    // Active section shows its empty placeholder instead of a blank panel.
    expect(within(region).getByText(/no active exports/i)).toBeInTheDocument()
    // Recent job renders its formatted size.
    expect(within(region).getByText('2.38 MB · just now')).toBeInTheDocument()
    // The download link carries a descriptive accessible name (not just
    // "Download") so multiple links are distinguishable, and points at the
    // prefixed download URL.
    const link = within(region).getByRole('link', { name: /download charging export/i })
    expect(link).toHaveAttribute('href', exportDownloadUrl('ready-1'))
    expect(link).toHaveAttribute('href', '/api/v1/export/jobs/ready-1/download')
  })

  it('surfaces a failed job error message with no download link', async () => {
    localStorage.setItem(STORAGE_KEY, 'open')
    mockedRequest.mockResolvedValue([
      makeJob({
        id: 'f1',
        status: 'failed',
        type: 'backup',
        error_message: 'disk full',
        completed_at: new Date().toISOString(),
      }),
    ])
    renderDrawer()

    const region = await screen.findByRole('region', { name: /export job progress/i })
    expect(await within(region).findByText('disk full')).toBeInTheDocument()
    expect(within(region).getByText('Backup')).toBeInTheDocument()
    expect(within(region).queryByRole('link', { name: /download/i })).toBeNull()
  })

  it('collapses to the chip on Minimize and fully hides on Dismiss when idle', async () => {
    localStorage.setItem(STORAGE_KEY, 'open')
    // Recent-only (no active job) so Dismiss is honoured rather than bounced
    // back to the chip by the auto-promote effect.
    mockedRequest.mockResolvedValue([
      makeJob({
        id: 'r1',
        status: 'ready',
        type: 'drives',
        file_size: 1024,
        completed_at: new Date().toISOString(),
      }),
    ])
    const { container } = renderDrawer()

    const region = await screen.findByRole('region', { name: /export job progress/i })
    fireEvent.click(within(region).getByRole('button', { name: /minimize/i }))

    expect(await screen.findByRole('button', { name: /show export jobs/i })).toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('minimized')

    // Re-open, then dismiss.
    fireEvent.click(screen.getByRole('button', { name: /show export jobs/i }))
    const region2 = await screen.findByRole('region', { name: /export job progress/i })
    fireEvent.click(within(region2).getByRole('button', { name: /dismiss/i }))

    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dismissed')
  })

  it('auto-promotes a dismissed drawer to the chip when an active job appears', async () => {
    localStorage.setItem(STORAGE_KEY, 'dismissed')
    mockedRequest.mockResolvedValue([makeJob({ id: 'q1', status: 'queued' })])
    renderDrawer()

    // Dismissed + active → the subtle chip, never the popped-open drawer.
    const chip = await screen.findByRole('button', { name: /show export jobs/i })
    expect(chip).toHaveTextContent(/1 export running/i)
    expect(screen.queryByRole('region', { name: /export job progress/i })).toBeNull()
    // The promotion is persisted so a reload keeps it visible.
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('minimized'))
  })

  it('shows a loading message while the jobs request is in flight', async () => {
    localStorage.setItem(STORAGE_KEY, 'open')
    mockedRequest.mockReturnValue(new Promise<ExportJobSummary[]>(() => {}))
    renderDrawer()

    expect(await screen.findByText(/loading export jobs/i)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /export job progress/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/loading export jobs/i)
    expect(screen.queryByText(/no active exports|no recent exports/i)).toBeNull()
  })

  it('renders every status branch and pretty type/status label', async () => {
    localStorage.setItem(STORAGE_KEY, 'open')
    const now = new Date().toISOString()
    mockedRequest.mockResolvedValue([
      makeJob({ id: 'q', status: 'queued', type: 'analytics' }),
      makeJob({ id: 'p', status: 'processing', type: 'account' }),
      makeJob({ id: 'rd', status: 'ready', type: 'import_drives', file_size: 500, completed_at: now }),
      makeJob({ id: 'fl', status: 'failed', type: 'import_charging', error_message: 'boom', completed_at: now }),
      makeJob({ id: 'ex', status: 'expired', type: 'weird_custom_type', completed_at: now }),
      // Out-of-union status exercises the statusIcon default branch.
      makeJob({ id: 'unk', status: 'mystery' as ExportJobSummary['status'], type: 'backup', completed_at: now }),
    ])
    renderDrawer({ maxRecent: 10 })

    const region = await screen.findByRole('region', { name: /export job progress/i })

    // Wait for the request to settle, then assert the branches.
    expect(await within(region).findByText('Analytics')).toBeInTheDocument()

    // prettyStatus branches (active jobs).
    expect(within(region).getByText('Queued · started 10m ago')).toBeInTheDocument()
    expect(within(region).getByText('Processing · started 10m ago')).toBeInTheDocument()

    // prettyType branches: known labels + the raw fallback for an unknown type.
    expect(within(region).getByText('Account export')).toBeInTheDocument()
    expect(within(region).getByText('Import drives')).toBeInTheDocument()
    expect(within(region).getByText('Import charging')).toBeInTheDocument()
    expect(within(region).getByText('Backup')).toBeInTheDocument()
    expect(within(region).getByText('weird_custom_type')).toBeInTheDocument()

    // Both sections populated → neither empty placeholder shows.
    expect(within(region).queryByText(/no active exports/i)).toBeNull()
    expect(within(region).queryByText(/no recent exports/i)).toBeNull()
  })
})
