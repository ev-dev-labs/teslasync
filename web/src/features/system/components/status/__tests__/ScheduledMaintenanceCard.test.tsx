import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
const mode = vi.hoisted(() => ({ canWrite: true }))
vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => ({
    mode: mode.canWrite ? 'live' : 'as_of',
    asOf: mode.canWrite ? null : '2026-07-05T12:00:00Z',
    online: true,
    isReadOnly: !mode.canWrite,
    label: mode.canWrite ? 'Live' : 'Historical',
    description: 'Operational source mode',
    writeBlockReason: mode.canWrite ? null : 'Return to live mode',
    canWrite: mode.canWrite,
  }),
}))

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
  const ui = () => (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <ScheduledMaintenanceCard now={now} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
  return { ...render(ui()), client: qc, ui }
}

function getForm(): HTMLFormElement {
  const form = screen.getByLabelText('End time').closest('form')
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
    mode.canWrite = true
    stub(makeState({ mode: 'ok' }))
  })

  it('keeps an active maintenance message and remaining time after refresh failure', async () => {
    const until = new Date(NOW + 60 * 60_000).toISOString()
    stub(makeState({ mode: 'maintenance', maintenance_message: 'Original operator message', maintenance_until: until }))
    const { client } = renderCard()
    await screen.findByText('Original operator message')
    mockRequest.mockRejectedValue(new Error('maintenance refresh failed'))
    await act(async () => {
      await client.refetchQueries({ queryKey: ['admin', 'maintenance'] })
    })
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(screen.getByText('Original operator message')).toBeInTheDocument()
    expect(screen.getByText(/60 min remaining/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear maintenance' })).toBeEnabled()
    expect(postCount()).toBe(0)
  })

  it('preserves the end instant and discard protection through a read-source refresh failure', async () => {
    const { client } = renderCard()
    await waitFor(() => expect(mockRequest).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Enable immediately' }))
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '2026-07-06T02:00' } })
    fireEvent.change(screen.getByLabelText('Operator message'), { target: { value: 'Draft operator context' } })
    mockRequest.mockRejectedValue(new Error('maintenance refresh failed'))
    await act(async () => {
      await client.refetchQueries({ queryKey: ['admin', 'maintenance'] })
    })
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(screen.getByLabelText('End time')).toHaveValue('2026-07-06T02:00')
    expect(screen.getByLabelText('Operator message')).toHaveValue('Draft operator context')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument()
    expect(postCount()).toBe(0)
  })

  it('preserves read-only evidence and clears a scheduling draft when operational write permission is lost', async () => {
    const { rerender, ui } = renderCard()
    await waitFor(() => expect(mockRequest).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Enable immediately' }))
    fireEvent.change(screen.getByLabelText('Operator message'), { target: { value: 'Unsubmitted draft' } })
    mode.canWrite = false
    rerender(ui())
    expect(screen.queryByLabelText('Operator message')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable immediately' })).toBeDisabled()
    expect(screen.getByText('Maintenance controls are read-only')).toBeInTheDocument()
    expect(postCount()).toBe(0)
  })

  it('renders the scheduler affordance and no active-mode chrome when maintenance is off', async () => {
    renderCard()
    await waitFor(() => expect(mockRequest).toHaveBeenCalled())

    expect(screen.getByRole('heading', { name: 'Maintenance' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable immediately' })).toBeInTheDocument()
    expect(screen.queryByText('Maintenance active')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Clear maintenance/ })).not.toBeInTheDocument()
  })

  it('offers an immediate action with an end instant, not deferred-start or duration controls', () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Enable immediately' }))

    expect(screen.getByLabelText('End time')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Start \(local\)/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Duration \(minutes\)/)).not.toBeInTheDocument()
    expect(screen.queryByText(/schedul/i)).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText("What's happening (optional)")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable immediately' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('collapses the scheduler again when Cancel is pressed', () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Enable immediately' }))
    expect(screen.getByLabelText('End time')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('End time')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable immediately' })).toBeInTheDocument()
  })

  it('protects edited maintenance details from an accidental cancel', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Enable immediately' }))
    fireEvent.change(screen.getByLabelText('End time'), {
      target: { value: '2026-07-06T02:00' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const confirm = await screen.findByRole('dialog', { name: 'Unsaved changes' })
    expect(screen.getByLabelText('End time')).toBeInTheDocument()

    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => {
      expect(screen.queryByLabelText('End time')).not.toBeInTheDocument()
    })
  })

  it('blocks submission and associates an error when no end time is picked', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Enable immediately' }))
    fireEvent.submit(getForm())

    const start = screen.getByLabelText('End time')
    expect(screen.getByText('Enter a valid end time.')).toBeInTheDocument()
    expect(start).toHaveAttribute('aria-invalid', 'true')
    expect(start).toHaveAttribute('aria-describedby')
    expect(postCount()).toBe(0)
  })

  it('rejects end instants at or before now without issuing an immediate command', () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Enable immediately' }))
    const end = screen.getByLabelText('End time')
    for (const endMs of [NOW - 60_000, NOW]) {
      const local = new Date(endMs - new Date(endMs).getTimezoneOffset() * 60_000)
        .toISOString().slice(0, 16)
      fireEvent.change(end, { target: { value: local } })
      fireEvent.submit(getForm())
      expect(end).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByText('Enter a valid end time.')).toBeInTheDocument()
    }
    expect(postCount()).toBe(0)
  })

  it('enables maintenance immediately with the exact configured end instant, then toasts and closes', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Enable immediately' }))

    const startVal = '2026-07-06T02:00'
    const expectedUntil = new Date(startVal).toISOString()

    fireEvent.change(screen.getByLabelText('End time'), { target: { value: startVal } })
    fireEvent.change(screen.getByPlaceholderText("What's happening (optional)"), {
      target: { value: '  Upgrading firmware  ' },
    })
    fireEvent.submit(getForm())

    await waitFor(() => expect(postCount()).toBe(1))
    const { url, body } = lastPost()
    expect(url).toBe('/admin/maintenance')
    expect(body).toEqual({ mode: 'maintenance', message: 'Upgrading firmware', until: expectedUntil })

    expect((await screen.findAllByText('Maintenance state updated')).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByLabelText('End time')).not.toBeInTheDocument())
  })

  it('preserves the configured end without duration clamping and auto-fills an end-time message', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Enable immediately' }))

    const startVal = '2026-07-06T02:00'
    const expectedUntil = new Date(startVal).toISOString()

    fireEvent.change(screen.getByLabelText('End time'), { target: { value: startVal } })
    fireEvent.submit(getForm())

    await waitFor(() => expect(postCount()).toBe(1))
    const { body } = lastPost()
    expect(body.until).toBe(expectedUntil)
    expect(String(body.message)).toContain('Until ')
    expect(String(body.message)).not.toMatch(/schedul/i)
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

  it('shows a near end as active maintenance, not an imminent scheduled start', async () => {
    const until = new Date(NOW + 3 * 60 * 60 * 1000).toISOString() // 3h out
    stub(makeState({ mode: 'maintenance', maintenance_message: 'Quick reboot', maintenance_until: until }))
    renderCard()

    expect(await screen.findByText('Maintenance active')).toBeInTheDocument()
    expect(screen.queryByText(/Within 24h/)).not.toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: 'Enable immediately' }))
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '2026-07-06T02:00' } })
    fireEvent.submit(getForm())

    // Both the hook's onError toast and the component's catch toast carry the
    // same detail, so there may be more than one node — assert at least one.
    const hits = await screen.findAllByText('backend exploded')
    expect(hits.length).toBeGreaterThan(0)
    expect(screen.getByLabelText('End time')).toBeInTheDocument()
  })

  it('disables the actions and shows a pending label while the schedule is in flight', async () => {
    let resolvePost: (v: MaintenanceState) => void = () => {}
    mockRequest = vi.fn((_url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST') return new Promise<MaintenanceState>((res) => { resolvePost = res })
      return Promise.resolve(makeState({ mode: 'ok' }))
    })
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Enable immediately' }))
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '2026-07-06T02:00' } })
    fireEvent.submit(getForm())

    const pending = await screen.findByRole('button', { name: /Applying/ })
    expect(pending).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    resolvePost(makeState({ mode: 'ok' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Applying/ })).not.toBeInTheDocument())
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
