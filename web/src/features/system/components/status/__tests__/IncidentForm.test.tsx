import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { IncidentForm } from '../IncidentForm'
import { ToastProvider } from '@/components/feedback/Toast'
import type { Incident } from '@/api/hooks/useIncidents'

// The form drives a real useCreateIncident() mutation, which calls
// createIncident() -> request('/status/incidents', { method: 'POST', ... }).
// We mock ONLY the transport (`request`) so the real hook + mutation state
// (isPending / error branches) exercise production code, and we can assert the
// exact URL + payload the backend receives. Nothing ever hits the network.
// The `mock` prefix is required for vitest to hoist the reference safely.
let mockRequest: ReturnType<typeof vi.fn>

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: (...args: unknown[]) => mockRequest(...args) }
})

const SAMPLE_INCIDENT: Incident = {
  id: 7,
  title: 'Wall connector restart',
  description: '',
  severity: 'major',
  status: 'monitoring',
  source: 'manual',
  affected_components: ['tesla'],
  updates: [],
  started_at: '2025-01-15T14:00:00Z',
  created_at: '2025-01-15T14:00:00Z',
  updated_at: '2025-01-15T14:00:00Z',
}

function renderForm(onClose: () => void = vi.fn()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <IncidentForm onClose={onClose} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { onClose, ...view }
}

// The <Modal> portals into document.body, so the form is not inside the
// render container. Reach it from the (portaled) title input instead.
function getForm(): HTMLFormElement {
  const form = screen.getByLabelText(/^Title/).closest('form')
  if (!form) throw new Error('IncidentForm: <form> not found')
  return form
}

function submittedPayload(): Record<string, unknown> {
  const call = mockRequest.mock.calls[0] as [string, RequestInit]
  return JSON.parse(call[1].body as string) as Record<string, unknown>
}

describe('IncidentForm', () => {
  beforeEach(() => {
    mockRequest = vi.fn().mockResolvedValue(SAMPLE_INCIDENT)
  })

  it('renders an accessible dialog with every field and both actions', () => {
    renderForm()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Log an incident' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument()
    expect(screen.getByLabelText('Severity')).toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
    expect(screen.getByLabelText(/Affected components/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Initial timeline message/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log incident' })).toBeInTheDocument()
  })

  it('defaults severity to Minor and status to Investigating', () => {
    renderForm()
    expect(screen.getByLabelText<HTMLSelectElement>('Severity').value).toBe('minor')
    expect(screen.getByLabelText<HTMLSelectElement>('Status').value).toBe('investigating')
  })

  it('blocks submit and shows a field-associated error when the title is too short', () => {
    renderForm()
    const title = screen.getByLabelText(/^Title/)
    fireEvent.change(title, { target: { value: 'ab' } })
    fireEvent.submit(getForm())

    expect(mockRequest).not.toHaveBeenCalled()
    expect(screen.getByText('Title must be at least 3 characters.')).toBeInTheDocument()
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(title).toHaveAttribute('aria-describedby')
  })

  it('trims surrounding whitespace before validating the title length', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: '  ab  ' } })
    fireEvent.submit(getForm())

    expect(mockRequest).not.toHaveBeenCalled()
    expect(screen.getByText('Title must be at least 3 characters.')).toBeInTheDocument()
  })

  it('clears the validation error as soon as the title is corrected', () => {
    renderForm()
    const title = screen.getByLabelText(/^Title/)
    fireEvent.change(title, { target: { value: 'ab' } })
    fireEvent.submit(getForm())
    expect(title).toHaveAttribute('aria-invalid', 'true')

    fireEvent.change(title, { target: { value: 'abc' } })
    expect(screen.queryByText('Title must be at least 3 characters.')).not.toBeInTheDocument()
    expect(title).not.toHaveAttribute('aria-invalid')
  })

  it('submits a trimmed, structured payload then closes and toasts on success', async () => {
    const onClose = vi.fn()
    renderForm(onClose)

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: '  Wall connector restart  ' } })
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'major' } })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'monitoring' } })
    fireEvent.change(screen.getByLabelText(/Affected components/i), { target: { value: 'tesla, telemetry,' } })
    fireEvent.change(screen.getByLabelText(/Initial timeline message/i), { target: { value: '  Restarted at 14:00  ' } })
    fireEvent.submit(getForm())

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1))
    const [url, opts] = mockRequest.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/status/incidents')
    expect(opts.method).toBe('POST')
    expect(submittedPayload()).toEqual({
      title: 'Wall connector restart',
      severity: 'major',
      status: 'monitoring',
      affected_components: ['tesla', 'telemetry'],
      initial_message: 'Restarted at 14:00',
    })

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Incident logged.')).toBeInTheDocument()
  })

  it('omits a blank initial message and sends an empty affected-components list', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Router flapped' } })
    fireEvent.change(screen.getByLabelText(/Initial timeline message/i), { target: { value: '   ' } })
    fireEvent.submit(getForm())

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1))
    const payload = submittedPayload()
    expect(payload).toEqual({
      title: 'Router flapped',
      severity: 'minor',
      status: 'investigating',
      affected_components: [],
    })
    expect('initial_message' in payload).toBe(false)
  })

  it('surfaces an error toast and keeps the dialog open when the request fails', async () => {
    const onClose = vi.fn()
    mockRequest = vi.fn().mockRejectedValue(new Error('boom: DB down'))
    renderForm(onClose)

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Something broke' } })
    fireEvent.submit(getForm())

    expect(await screen.findByText('boom: DB down')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('disables both actions and shows a pending label while the request is in flight', async () => {
    let resolveRequest: (value: Incident) => void = () => {}
    mockRequest = vi.fn().mockImplementation(
      () => new Promise<Incident>((resolve) => { resolveRequest = resolve }),
    )
    const onClose = vi.fn()
    renderForm(onClose)

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Slow incident' } })
    fireEvent.submit(getForm())

    const pendingBtn = await screen.findByRole('button', { name: 'Logging…' })
    expect(pendingBtn).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    resolveRequest(SAMPLE_INCIDENT)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('invokes onClose from Cancel without touching the API', () => {
    const onClose = vi.fn()
    renderForm(onClose)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('keeps a dirty incident draft open until discard is confirmed', async () => {
    const onClose = vi.fn()
    renderForm(onClose)
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: 'Unsubmitted incident' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const confirm = await screen.findByRole('dialog', { name: 'Unsaved changes' })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep editing' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const reopened = await screen.findByRole('dialog', { name: 'Unsaved changes' })
    fireEvent.click(within(reopened).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
