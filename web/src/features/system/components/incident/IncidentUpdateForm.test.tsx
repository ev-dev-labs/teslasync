/**
 * IncidentUpdateForm tests (Project Apex elevation).
 *
 * IncidentUpdateForm is the operator "append update" surface for one open
 * incident. Its single export owns:
 *   - a draft message textarea (required, trimmed before send),
 *   - a status <Select> whose first option keeps the incident's current status
 *     and whose remaining four advance it (investigating → resolved),
 *   - a submit that POSTs `{ message, status? }` to the canonical
 *     `/status/incidents/{id}/updates` route via the real
 *     `useAppendIncidentUpdate` mutation, then resets the draft and toasts,
 *   - client-side validation (whitespace-only is rejected before any network),
 *   - failure handling that surfaces the API error message and preserves the
 *     draft so the operator can retry.
 *
 * These tests exercise every branch. The shared `request` client is stubbed so
 * the real TanStack Query mutation hook runs end-to-end without a network.
 * i18n is stubbed to return the English `defaultValue` so visible copy is
 * deterministic. user-event is intentionally NOT used — it is not installed in
 * this repo (see DriveRepairForm.test.tsx); interactions go through `fireEvent`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// Stub the resilient fetch client while preserving the rest of the module so
// transitive consumers (ApiError, camelCaseKeys, query broadcast) keep working.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

// Deterministic i18n: return the English defaultValue for every key so the
// component (and the transitive useIncidentStatusLabel helper) render fixed,
// assertable copy without an i18n provider.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, dflt?: unknown) => (typeof dflt === 'string' ? dflt : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { IncidentUpdateForm } from './IncidentUpdateForm'
import type { Incident } from '@/api/hooks/useIncidents'

const mockRequest = request as unknown as ReturnType<typeof vi.fn>

type RequestArgs = [string, RequestInit?]

/** A well-formed open incident. Override per test. */
function buildIncident(overrides?: Partial<Incident>): Incident {
  return {
    id: 77,
    title: 'Ingest lag on telemetry pipeline',
    description: 'Signals delayed by ~4m.',
    severity: 'major',
    status: 'investigating',
    source: 'manual',
    affected_components: ['ingest'],
    updates: [],
    started_at: '2026-07-05T00:00:00Z',
    created_at: '2026-07-05T00:00:00Z',
    updated_at: '2026-07-05T00:05:00Z',
    ...overrides,
  }
}

function renderForm(incident: Incident = buildIncident()) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const utils = render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <IncidentUpdateForm incident={incident} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { ...utils }
}

/** The single native <textarea> for the draft message. */
function messageInput(): HTMLTextAreaElement {
  return screen.getByLabelText(/^Update message/) as HTMLTextAreaElement
}

/** The status <select>. */
function statusSelect(): HTMLSelectElement {
  return screen.getByLabelText('Change status with this update') as HTMLSelectElement
}

/** Dispatch the form's submit event directly (bypasses native `required`
 *  constraint validation, matching a keyboard/programmatic submit). */
function submitForm() {
  fireEvent.submit(screen.getByRole('form', { name: 'Add incident update' }))
}

/** Find the first stubbed request call issued with the given HTTP method. */
function findCall(method: string): RequestArgs | undefined {
  return (mockRequest.mock.calls as RequestArgs[]).find((c) => c[1]?.method === method)
}

/** Parse the JSON body of a captured request call into a plain object. */
function bodyOf(call: RequestArgs | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.[1]?.body ?? '{}')) as Record<string, unknown>
}

beforeEach(() => {
  mockRequest.mockReset()
  mockRequest.mockResolvedValue({})
})

describe('IncidentUpdateForm — Project Apex elevation', () => {
  it('renders the labelled form landmark with a draft textarea, status select, and submit button', () => {
    renderForm()

    // The <form> is a named landmark so assistive tech can jump to it.
    expect(screen.getByRole('form', { name: 'Add incident update' })).toBeInTheDocument()

    // Icon-free labelled controls are reachable by their accessible names.
    const ta = messageInput()
    expect(ta).toBeInTheDocument()
    expect(ta).toBeRequired()
    expect(ta).toHaveValue('')
    expect(statusSelect()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add update' })).toBeInTheDocument()
  })

  it('seeds five status options: keep-current plus the four transitions', () => {
    renderForm(buildIncident({ status: 'investigating' }))

    const opts = within(statusSelect()).getAllByRole('option')
    expect(opts).toHaveLength(5)
    expect(opts.map((o) => o.textContent)).toEqual([
      'Keep status as Investigating',
      '→ Investigating',
      '→ Identified',
      '→ Monitoring',
      '→ Resolved',
    ])
    // The keep-current option carries the empty value so no status is sent
    // unless the operator explicitly picks a transition.
    expect((opts[0] as HTMLOptionElement).value).toBe('')
  })

  it('reflects the incident\'s current status in the keep-current option label', () => {
    renderForm(buildIncident({ status: 'monitoring' }))

    const opts = within(statusSelect()).getAllByRole('option')
    expect(opts[0]).toHaveTextContent('Keep status as Monitoring')
  })

  it('rejects a whitespace-only message before any network call and surfaces a required-field alert', async () => {
    renderForm()

    fireEvent.change(messageInput(), { target: { value: '   \n  ' } })
    submitForm()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Update message is required.')
    expect(mockRequest).not.toHaveBeenCalled()
    // The draft is preserved so the operator can fix it rather than retype.
    expect(messageInput()).toHaveValue('   \n  ')
  })

  it('POSTs the trimmed message and chosen status to the canonical route, then resets and confirms', async () => {
    renderForm()

    fireEvent.change(messageInput(), { target: { value: '  Rebooted the ingest worker.  ' } })
    fireEvent.change(statusSelect(), { target: { value: 'identified' } })
    submitForm()

    await waitFor(() => expect(findCall('POST')).toBeDefined())
    const post = findCall('POST')
    expect(post?.[0]).toBe('/status/incidents/77/updates')
    expect(post?.[1]?.method).toBe('POST')
    // Message is trimmed; the explicit transition rides along.
    expect(bodyOf(post)).toEqual({ message: 'Rebooted the ingest worker.', status: 'identified' })

    // Success clears the draft (both fields) and toasts a confirmation.
    expect(await screen.findByText('Update added.')).toBeInTheDocument()
    await waitFor(() => expect(messageInput()).toHaveValue(''))
    expect(statusSelect()).toHaveValue('')
  })

  it('omits status from the payload when the keep-current option is left selected', async () => {
    renderForm()

    fireEvent.change(messageInput(), { target: { value: 'Still investigating.' } })
    submitForm()

    await waitFor(() => expect(findCall('POST')).toBeDefined())
    // `undefined` status is dropped by JSON.stringify — the body must not
    // carry a `status` key that would otherwise re-stamp the current status.
    expect(bodyOf(findCall('POST'))).toEqual({ message: 'Still investigating.' })
    expect(String(findCall('POST')?.[1]?.body)).not.toContain('status')
  })

  it('surfaces the API error message on failure and keeps the draft for retry', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Backend exploded'))
    renderForm()

    fireEvent.change(messageInput(), { target: { value: 'Mitigation applied.' } })
    submitForm()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Backend exploded')
    // No success toast, and the draft survives so the operator can resubmit.
    expect(screen.queryByText('Update added.')).not.toBeInTheDocument()
    expect(messageInput()).toHaveValue('Mitigation applied.')
  })

  it('falls back to the default error copy when the failure carries an empty message', async () => {
    // Regression guard: `new Error('')` is an Error but has no message —
    // the form must show the friendly default, never an empty toast.
    mockRequest.mockRejectedValueOnce(new Error(''))
    renderForm()

    fireEvent.change(messageInput(), { target: { value: 'Root cause found.' } })
    submitForm()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Failed to append update')
  })

  it('disables the submit button and swaps to the busy label while the mutation is in flight', async () => {
    // A request that never settles keeps the mutation pending.
    mockRequest.mockReturnValue(new Promise<never>(() => {}))
    renderForm()

    const button = screen.getByRole('button', { name: 'Add update' })
    fireEvent.change(messageInput(), { target: { value: 'Applying fix…' } })
    submitForm()

    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveTextContent('Adding…')
    expect(mockRequest).toHaveBeenCalledTimes(1)
    // No confirmation toast while the write is still outstanding.
    expect(screen.queryByText('Update added.')).not.toBeInTheDocument()
  })
})
