/**
 * BackendTool contract tests.
 *
 * BackendTool is a one-click "run this backend dev-tools endpoint" card.
 * These tests exercise every branch of its single export:
 *   1. Static chrome — title / description / children render through ToolCard.
 *   2. Idle — no status badge or result panel before the first run.
 *   3. GET default — clicking Run drives the real apiFetch → request() with
 *      the `/dev-tools/{endpoint}` path, GET method, and no body.
 *   4. POST + bodyBuilder — method and JSON-serialised body are forwarded.
 *   5. DELETE method passes through.
 *   6. Success — 'Success' badge + JSON payload rendered in the panel.
 *   7. Failure (request rejects) — apiFetch's `{ error }` envelope surfaces
 *      as a 'Failed' badge + the message, with no raw-payload copy button.
 *   8. Non-string truthy error (regression) — still shows a human message
 *      instead of the panel's idle "No result yet" copy.
 *   9. Pending — the Run button is disabled + aria-busy while in flight.
 *  10. a11y — the completion badge is exposed as an ARIA status region.
 *
 * Network is mocked at the `@/api/client` boundary (the repo convention —
 * see RateLimitStatusPanel.test.tsx) so the real `apiFetch` helper — URL
 * building, method, body serialisation, and error catching — stays under
 * test rather than being stubbed out.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Wrench } from 'lucide-react'
import type { ComponentProps } from 'react'

vi.mock('@/api/client', () => ({
  request: vi.fn(),
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    // t(key, defaultStr) → defaultStr; falls back to the key otherwise so the
    // component's copy is deterministic and locale-file independent.
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import { request } from '@/api/client'
import { BackendTool } from './BackendTool'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderTool(props?: Partial<ComponentProps<typeof BackendTool>>) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <BackendTool
        icon={Wrench}
        color="cyan"
        title="Flush Cache"
        description="Drops the Redis signal cache"
        endpoint="flush-cache"
        {...props}
      />
    </QueryClientProvider>,
  )
}

function clickRun() {
  fireEvent.click(screen.getByRole('button', { name: /Run/i }))
}

beforeEach(() => {
  mockedRequest.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('BackendTool', () => {
  it('renders the tool-card chrome: title, description, children, and a Run action', () => {
    renderTool({ children: <span>extra-controls</span> })

    expect(screen.getByText('Flush Cache')).toBeInTheDocument()
    expect(screen.getByText('Drops the Redis signal cache')).toBeInTheDocument()
    expect(screen.getByText('extra-controls')).toBeInTheDocument()

    const run = screen.getByRole('button', { name: /Run/i })
    expect(run).toBeInTheDocument()
    expect(run).toBeEnabled()
  })

  it('shows no status badge or result panel before the first run', () => {
    renderTool()

    expect(screen.queryByText('Success')).toBeNull()
    expect(screen.queryByText('Failed')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('No result yet')).toBeNull()
    // No request goes out until the user clicks Run.
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('runs a GET request against the dev-tools endpoint by default', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true })
    renderTool({ endpoint: 'ping' })

    clickRun()

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    // Real apiFetch prefixes `/dev-tools/` and sends no body for a GET.
    expect(mockedRequest).toHaveBeenCalledWith('/dev-tools/ping', { method: 'GET' })
  })

  it('forwards the method and JSON-serialised body from bodyBuilder on POST', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true })
    const bodyBuilder = vi.fn(() => ({ vin: '5YJ', force: true }))
    renderTool({ endpoint: 'resubscribe', method: 'POST', bodyBuilder })

    clickRun()

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    expect(bodyBuilder).toHaveBeenCalledTimes(1)
    expect(mockedRequest).toHaveBeenCalledWith('/dev-tools/resubscribe', {
      method: 'POST',
      body: JSON.stringify({ vin: '5YJ', force: true }),
    })
  })

  it('passes the DELETE method through to the request client', async () => {
    mockedRequest.mockResolvedValueOnce({ deleted: 3 })
    renderTool({ endpoint: 'purge', method: 'DELETE' })

    clickRun()

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith('/dev-tools/purge', { method: 'DELETE' }),
    )
  })

  it('renders a success badge and the JSON payload after a successful run', async () => {
    mockedRequest.mockResolvedValueOnce({ status: 'ok', flushed: 42 })
    const { container } = renderTool({ endpoint: 'flush' })

    clickRun()

    await waitFor(() => expect(screen.getByText('Success')).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Success')
    // The parsed payload is pretty-printed into the result panel.
    expect(container).toHaveTextContent('"flushed": 42')
    // A copy affordance appears alongside the serialised payload.
    expect(screen.getByRole('button', { name: /Copy/i })).toBeInTheDocument()
  })

  it('renders a failure badge and the error message when the request rejects', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('redis down'))
    renderTool({ endpoint: 'flush' })

    clickRun()

    await waitFor(() => expect(screen.getByText('Failed')).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Failed')
    expect(screen.getByText('redis down')).toBeInTheDocument()
    // On failure the raw-payload panel (and its copy button) must NOT appear.
    expect(screen.queryByRole('button', { name: /Copy/i })).toBeNull()
  })

  it('surfaces a human-readable message when the backend returns a non-string error', async () => {
    // A dev-tools endpoint that responds 200 with a truthy, non-string `error`
    // field used to leave the panel stuck on its idle "No result yet" copy.
    mockedRequest.mockResolvedValueOnce({ error: true })
    renderTool({ endpoint: 'weird' })

    clickRun()

    await waitFor(() => expect(screen.getByText('Failed')).toBeInTheDocument())
    expect(screen.getByText('Request failed')).toBeInTheDocument()
    expect(screen.queryByText('No result yet')).toBeNull()
  })

  it('disables the Run button and marks it busy while the request is in flight', async () => {
    let resolve: (value: Record<string, unknown>) => void = () => {}
    mockedRequest.mockImplementationOnce(
      () =>
        new Promise<Record<string, unknown>>((r) => {
          resolve = r
        }),
    )
    renderTool({ endpoint: 'slow' })

    const run = screen.getByRole('button', { name: /Run/i })
    fireEvent.click(run)

    await waitFor(() => expect(run).toBeDisabled())
    expect(run).toHaveAttribute('aria-busy', 'true')

    // Settle the in-flight promise so the mutation resolves cleanly.
    resolve({ ok: true })
    await waitFor(() => expect(run).toBeEnabled())
  })

  it('exposes the completion badge as an ARIA status region for screen readers', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true })
    renderTool({ endpoint: 'flush' })

    expect(screen.queryByRole('status')).toBeNull()
    clickRun()

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Success')
  })
})
