import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { DataPipelineSection } from '../DataPipelineSection'
import type { CompressionStats, ExportJobSummary } from '@/api/types'

/**
 * DataPipelineSection is an accordion that fans two independent system-status
 * queries (compression stats + export-job queue) into one collapsible panel.
 * These tests exercise every branch: the always-visible header badges, the
 * collapsed→expanded interaction, the loading skeletons, the success render
 * (metric cards, savings gauge, job table + per-status counts), the two empty
 * states, and — the reason this file was hardened — the error/retry paths that
 * previously showed a misleading "no jobs" placeholder on a failed request.
 */

const compressionMock = vi.fn()
const exportJobsMock = vi.fn()

vi.mock('@/api/devtools', () => ({
  getCompressionStats: () => compressionMock(),
  getExportJobs: () => exportJobsMock(),
}))

// QueryError branches on connectivity. Pin it online so a failed request
// renders the assertive, retryable "can't reach server" alert deterministically
// in jsdom (rather than the polite offline placeholder with a disabled CTA).
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}))

function makeCompression(overrides: Partial<CompressionStats> = {}): CompressionStats {
  return {
    total: 1_000_000,
    compressed: 700_000,
    savings_percent: 42.5,
    total_positions: 1_000_000,
    compressed_positions: 700_000,
    estimated_saved_rows: 300_000,
    estimated_saved_bytes: 15_728_640, // exactly 15.0 MB
    ...overrides,
  }
}

let jobSeq = 0
function makeJob(overrides: Partial<ExportJobSummary> = {}): ExportJobSummary {
  jobSeq += 1
  return {
    id: `job-${jobSeq}`,
    type: 'drives',
    format: 'csv',
    status: 'ready',
    file_name: `export-${jobSeq}.csv`,
    file_size: 2048,
    record_count: 1234,
    error_message: '',
    created_at: '2025-01-15T12:00:00Z',
    completed_at: '2025-01-15T12:05:00Z',
    ...overrides,
  }
}

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DataPipelineSection />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function header(): HTMLElement {
  return screen.getByRole('button', { name: /Data Pipeline/i })
}

function expand() {
  fireEvent.click(header())
}

/** Resolve a StatCard's outer Card element from its label so counts can be
 *  asserted in isolation (the header "N active" badge shares digits). */
function statCard(label: string): HTMLElement {
  const card = screen.getByText(label).closest('div')?.parentElement
  if (!card) throw new Error(`StatCard container not found for "${label}"`)
  return card
}

beforeEach(() => {
  compressionMock.mockReset()
  exportJobsMock.mockReset()
  jobSeq = 0
})

describe('DataPipelineSection', () => {
  it('is collapsed by default and expands its body when the header is activated', async () => {
    compressionMock.mockResolvedValue(makeCompression())
    exportJobsMock.mockResolvedValue([])
    renderSection()

    const btn = header()
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Export Job Queue')).not.toBeInTheDocument()

    fireEvent.click(btn)

    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText('Export Job Queue')).toBeInTheDocument()
  })

  it('surfaces the compression savings and active-job count as header badges', async () => {
    compressionMock.mockResolvedValue(makeCompression({ savings_percent: 42.5 }))
    exportJobsMock.mockResolvedValue([
      makeJob({ status: 'queued' }),
      makeJob({ status: 'processing' }),
      makeJob({ status: 'ready' }), // completed jobs are NOT "active"
    ])
    renderSection()

    // Badges live in the always-visible header — no expand required.
    expect(await screen.findByText(/42\.50% saved/i)).toBeInTheDocument()
    // 1 queued + 1 processing = 2 active (the ready job is excluded).
    expect(screen.getByText(/2 active/i)).toBeInTheDocument()
  })

  it('omits both header badges when there is no compression data and no active jobs', async () => {
    compressionMock.mockResolvedValue(null)
    exportJobsMock.mockResolvedValue([makeJob({ status: 'ready' })])
    renderSection()

    await waitFor(() => expect(compressionMock).toHaveBeenCalled())
    await waitFor(() => expect(exportJobsMock).toHaveBeenCalled())

    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/active/i)).not.toBeInTheDocument()
  })

  it('shows loading skeletons while both queries are pending', async () => {
    compressionMock.mockReturnValue(new Promise<CompressionStats>(() => {}))
    exportJobsMock.mockReturnValue(new Promise<ExportJobSummary[]>(() => {}))
    const { container } = renderSection()

    // Nothing renders in the collapsed body yet.
    expect(container.querySelector('.animate-pulse')).toBeNull()

    expand()

    await waitFor(() => expect(container.querySelector('.animate-pulse')).not.toBeNull())
    expect(screen.queryByText('Compression Statistics')).not.toBeInTheDocument()
    expect(screen.queryByText('Export Job Queue')).not.toBeInTheDocument()
  })

  it('renders compression statistics and the savings gauge once data loads', async () => {
    compressionMock.mockResolvedValue(makeCompression())
    exportJobsMock.mockResolvedValue([])
    renderSection()
    expand()

    expect(await screen.findByText('Compression Statistics')).toBeInTheDocument()
    expect(screen.getByText('Compression Ratio')).toBeInTheDocument()
    expect(screen.getByText('42.50%')).toBeInTheDocument()
    expect(screen.getByText('15.0 MB')).toBeInTheDocument()
    expect(screen.getByText('1,000,000')).toBeInTheDocument()
    expect(screen.getByText('700,000')).toBeInTheDocument()
    expect(screen.getByText('Savings')).toBeInTheDocument() // radial gauge label
  })

  it('renders the export job table with correct per-status counts', async () => {
    compressionMock.mockResolvedValue(makeCompression())
    exportJobsMock.mockResolvedValue([
      makeJob({ status: 'queued', file_name: 'queued-1.csv' }),
      makeJob({ status: 'processing' }),
      makeJob({ status: 'processing' }),
      makeJob({ status: 'ready' }),
      makeJob({ status: 'ready' }),
      makeJob({ status: 'ready' }),
      makeJob({ status: 'failed' }),
    ])
    renderSection()
    expand()

    expect(await screen.findByText('Export Job Queue')).toBeInTheDocument()
    expect(within(statCard('Pending')).getByText('1')).toBeInTheDocument()
    expect(within(statCard('Processing')).getByText('2')).toBeInTheDocument()
    expect(within(statCard('Completed')).getByText('3')).toBeInTheDocument()
    expect(within(statCard('Failed')).getByText('1')).toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).getByText('queued-1.csv')).toBeInTheDocument()
    expect(within(table).getAllByText('ready')).toHaveLength(3)
  })

  it('shows an empty state (not a table) when there are no export jobs', async () => {
    compressionMock.mockResolvedValue(makeCompression())
    exportJobsMock.mockResolvedValue([])
    renderSection()
    expand()

    expect(await screen.findByText('No export jobs in queue')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('keeps the compression panel visible with a placeholder when stats are unavailable', async () => {
    // Regression guard for the null-hidden-section fix: the heading + a
    // placeholder must render instead of the whole panel silently vanishing,
    // and the export section must still render independently.
    compressionMock.mockResolvedValue(null)
    exportJobsMock.mockResolvedValue([makeJob({ status: 'ready', file_name: 'still-here.csv' })])
    renderSection()
    expand()

    expect(await screen.findByText('Compression Statistics')).toBeInTheDocument()
    expect(screen.getByText('No compression statistics available')).toBeInTheDocument()
    expect(screen.getByText('still-here.csv')).toBeInTheDocument()
  })

  it('surfaces a retryable error when the compression query fails, then recovers', async () => {
    compressionMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(makeCompression())
    exportJobsMock.mockResolvedValue([])
    renderSection()
    expand()

    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()

    const retry = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(retry)

    await waitFor(() => expect(compressionMock).toHaveBeenCalledTimes(2))
    // Successful refetch replaces the alert with the real metrics.
    expect(await screen.findByText('Compression Ratio')).toBeInTheDocument()
  })

  it('surfaces an error instead of a misleading empty state when the export query fails', async () => {
    compressionMock.mockResolvedValue(makeCompression())
    exportJobsMock.mockRejectedValue(new Error('kaboom'))
    renderSection()
    expand()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // The compression half still renders from its own successful query...
    expect(screen.getByText('Compression Statistics')).toBeInTheDocument()
    // ...and we must NOT claim the queue is empty when the request errored.
    expect(screen.queryByText('No export jobs in queue')).not.toBeInTheDocument()
  })
})
