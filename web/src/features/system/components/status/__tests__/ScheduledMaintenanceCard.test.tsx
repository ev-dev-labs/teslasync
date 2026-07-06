import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScheduledMaintenanceCard } from '../ScheduledMaintenanceCard'
import { ToastProvider } from '@/components/feedback/Toast'
import type { MaintenanceState } from '@/types/admin'

// The card drives the REAL useMaintenanceState() query + useUpdateMaintenance()
// mutation. We mock ONLY the transport (`request`) so the production hooks —
// including their pending/error state machines and query invalidation — run for
// real and we can assert the exact URL + POST payload the backend receives.
// Nothing ever touches the network. The `mock` prefix lets vitest hoist safely.
let mockRequest: ReturnType<typeof vi.fn>

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: (...args: unknown[]) => mockRequest(...args) }
})

const NOW = Date.parse('2026-07-05T12:00:00Z')

function makeState(overrides: Partial<MaintenanceState> = {}): MaintenanceState {
  return {
    mode: 'ok',
    updated_at: '2026-07-05T00:00:00Z',
    source: 'db',
    ...overrides,
  }
}

/**
 * Wire `request` so GET /admin/maintenance resolves with `getState` and any
 * POST resolves with a plausible echoed state. Tests that want the POST to
 * fail pass `postError`.
 */
function stub(getState: MaintenanceState | null, postError?: Error) {
  mockRequest = vi.fn((_url: string, opts?: RequestInit) => {
    if (opts?.method === 'POST') {
      if (postError) return Promise.reject(postError)
      const body = JSON.parse((opts.body as string) ?? '{}') as Partial<MaintenanceState>
      return Promise.resolve(makeState({ ...body }))
    }
    return Promise.resolve(getState)
  })
}

function renderCard(now = NOW) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <ScheduledMaintenanceCard now={now} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function getForm(): HTMLFormElement {
  const form = screen.getByLabelText('Start (local)').closest('form')
  if (!form) throw new Error('ScheduledMaintenanceCard: <form> not found')
  return form
}

/** Most-recent POST call captured on the transport mock. */
function lastPost(): { url: string; body: Record<string, unknown> } {
  const call = [...mockRequest.mock.calls]
    .reverse()
    .find((c) => (c[1] as RequestInit | undefined)?.method === 'POST') as [string, RequestInit] | undefined
  if (!call) throw new Error('no POST request was captured')
  return { url: call[0], body: JSON.parse(call[1].body as string) as Record<string, unknown> }
}

function postCount(): number {
  return mockRequest.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST').length
}

describe('ScheduledMaintenanceCard', () => {
  beforeEach(() => {
    stub(makeState({ mode: 'ok' }))
  })

  it('renders the scheduler affordance and no active-mode chrome when maintenance is off', async () => {
    renderCard()
    await waitFor(() => expect(mockRequest).toHaveBeenCalled())

    expect(screen.getByRole('heading', { name: 'Scheduled maintenance' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Schedule a window/ })).toBeInTheDocument()
    expect(screen.queryByText('Maintenance active')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Clear maintenance/ })).not.toBeInTheDocument()
  })

  it('reveals the start/duration/message fields when the operator opens the scheduler', () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /Schedule a window/ }))

    expect(screen.getByLabelText('Start (local)')).toBeInTheDocument()
    expect(screen.getByLabelText('Duration (minutes)')).toHaveValue(60)
    expect(screen.getByPlaceholderText("What's happening (optional)")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schedule' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('collapses the scheduler again when Cancel is pressed', () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /Schedule a window/ }))
    expect(screen.getByLabelText('Start (local)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Start (local)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Schedule a window/ })).toBeInTheDocument()
  })

  it('blocks submission and toasts when no start time is picked', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /Schedule a window/ }))
    fireEvent.submit(getForm())

    expect(await screen.findByText('Pick a start time.')).toBeInTheDocument()
    expect(postCount()).toBe(0)
  })

  it('POSTs a maintenance window whose `until` = start + duration, then toasts and closes', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /Schedule a window/ }))

    const startVal = '2026-07-06T02:00'
    const expectedUntil = new Date(Date.parse(startVal) + 90 * 60_000).toISOString()

    fireEvent.change(screen.getByLabelText('Start (local)'), { target: { value: startVal } })
    fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '90' } })
    fireEvent.change(screen.getByPlaceholderText("What's happening (optional)"), {
      target: { value: '  Upgrading firmware  ' },
    })
    fireEvent.submit(getForm())

    await waitFor(() => expect(postCount()).toBe(1))
    const { url, body } = lastPost()
    expect(url).toBe('/admin/maintenance')
    expect(body).toEqual({ mode: 'maintenance', message: 'Upgrading firmware', until: expectedUntil })

    expect(await screen.findByText('Maintenance window scheduled.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByLabelText('Start (local)')).not.toBeInTheDocument())
  })

  it('clamps sub-minimum durations to 5 minutes and auto-fills a default message', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /Schedule a window/ }))

    const startVal = '2026-07-06T02:00'
    const expectedUntil = new Date(Date.parse(startVal) + 5 * 60_000).toISOString()

    fireEvent.change(screen.getByLabelText('Start (local)'), { target: { value: startVal } })
    fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '1' } })
    fireEvent.submit(getForm())

    await waitFor(() => expect(postCount()).toBe(1))
    const { body } = lastPost()
    expect(body.until).toBe(expectedUntil)
    expect(String(body.message)).toContain('Scheduled maintenance')
  })

  it('renders the active window with a live "min remaining" countdown and no 24h chip when it ends far out', async () => {
    const until = new Date(NOW + 48 * 60 * 60 * 1000).toISOString() // 2 days out
    stub(makeState({ mode: 'maintenance', maintenance_message: 'DB migration in progress', maintenance_until: until }))
    renderCard()

    expect(await screen.findByText('Maintenance active')).toBeInTheDocument()
    expect(screen.getByText('DB migration in progress')).toBeInTheDocument()
    expect(screen.getByText(/2880 min remaining/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Clear maintenance/ })).toBeInTheDocument()
    expect(screen.queryByText(/Within 24h/)).not.toBeInTheDocument()
  })

  it('flags an imminent window with the amber "Within 24h" heads-up chip', async () => {
    const until = new Date(NOW + 3 * 60 * 60 * 1000).toISOString() // 3h out
    stub(makeState({ mode: 'maintenance', maintenance_message: 'Quick reboot', maintenance_until: until }))
    renderCard()

    expect(await screen.findByText(/Within 24h/)).toBeInTheDocument()
    expect(screen.getByText(/180 min remaining/)).toBeInTheDocument()
  })

  it('clears maintenance with an empty/null payload and a confirmation toast', async () => {
    const until = new Date(NOW + 60 * 60 * 1000).toISOString()
    stub(makeState({ mode: 'maintenance', maintenance_message: 'Reboot', maintenance_until: until }))
    renderCard()

    fireEvent.click(await screen.findByRole('button', { name: /Clear maintenance/ }))

    await waitFor(() => expect(postCount()).toBe(1))
    expect(lastPost().body).toEqual({ mode: 'ok', message: '', until: null })
    expect(await screen.findByText('Maintenance cleared.')).toBeInTheDocument()
  })

  it('surfaces the failure message and keeps the form open when the schedule POST rejects', async () => {
    stub(makeState({ mode: 'ok' }), new Error('backend exploded'))
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /Schedule a window/ }))
    fireEvent.change(screen.getByLabelText('Start (local)'), { target: { value: '2026-07-06T02:00' } })
    fireEvent.submit(getForm())

    // Both the hook's onError toast and the component's catch toast carry the
    // same detail, so there may be more than one node — assert at least one.
    const hits = await screen.findAllByText('backend exploded')
    expect(hits.length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Start (local)')).toBeInTheDocument()
  })

  it('disables the actions and shows a pending label while the schedule is in flight', async () => {
    let resolvePost: (v: MaintenanceState) => void = () => {}
    mockRequest = vi.fn((_url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST') return new Promise<MaintenanceState>((res) => { resolvePost = res })
      return Promise.resolve(makeState({ mode: 'ok' }))
    })
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /Schedule a window/ }))
    fireEvent.change(screen.getByLabelText('Start (local)'), { target: { value: '2026-07-06T02:00' } })
    fireEvent.submit(getForm())

    const pending = await screen.findByRole('button', { name: /Scheduling/ })
    expect(pending).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    resolvePost(makeState({ mode: 'ok' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Scheduling/ })).not.toBeInTheDocument())
  })

  it('ignores a malformed `maintenance_until` (NaN) instead of painting a stray "Until —" line', async () => {
    stub(makeState({ mode: 'maintenance', maintenance_message: 'Corrupt window', maintenance_until: 'not-a-timestamp' }))
    renderCard()

    // Active chrome still renders...
    expect(await screen.findByText('Maintenance active')).toBeInTheDocument()
    expect(screen.getByText('Corrupt window')).toBeInTheDocument()
    // ...but the unparseable timestamp must NOT produce an "Until"/"Active until" row.
    expect(screen.queryByText(/until/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Clear maintenance/ })).toBeInTheDocument()
  })
})
