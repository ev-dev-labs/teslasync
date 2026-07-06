/**
 * InfrastructureSection contract tests.
 *
 * InfrastructureSection is the single public export of this module. It
 * composes five developer-tool cards:
 *   - four read-only <BackendTool> cards, each firing a GET against its own
 *     /dev-tools/{endpoint} route (db-stats, migration-status, env-check,
 *     runtime-info);
 *   - one interactive MqttTestTool that POSTs a {topic, message} body to
 *     /dev-tools/mqtt-test and renders the broker's response.
 *
 * MqttTestTool and the BackendTool instances are private, so they are
 * exercised transitively through the section. The suite locks:
 *   - structure (five titled cards, responsive grid, one action per card);
 *   - wiring (each card calls its OWN endpoint with the right verb/body);
 *   - the success / failure / loading / idle result branches; and
 *   - accessibility (label association on the MQTT inputs, named buttons).
 *
 * The network boundary is the shared request() client (mocked); apiFetch's
 * real error-catching + URL-building logic runs unmocked. react-i18next is
 * stubbed so t(key, 'Default') renders the English default deterministically.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
        // t(key, defaultStr, opts?) signature — return the default copy.
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        // t(key, opts) signature — honour an explicit defaultValue, else key.
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
import { InfrastructureSection } from './InfrastructureSection'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <InfrastructureSection />
    </QueryClientProvider>,
  )
}

// Resolve the GlassPanel card root that owns a given tool heading so queries
// for the (non-unique) "Run" button can be scoped to a single card. GlassPanel
// tags its root with data-print-card, which gives us a stable anchor.
function cardByTitle(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title })
  const card = heading.closest('[data-print-card]')
  if (!card) throw new Error(`no card root found for tool "${title}"`)
  return card as HTMLElement
}

beforeEach(() => {
  mockedRequest.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('InfrastructureSection', () => {
  it('renders all five infrastructure tools as titled cards', () => {
    renderSection()

    expect(screen.getByRole('heading', { name: 'Db Stats' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Migrations' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mqtt' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Env Check' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Runtime' })).toBeInTheDocument()
  })

  it('renders a meaningful description under each backend tool (no raw i18n keys)', () => {
    renderSection()

    // Regression guard for the old bare-key wiring that rendered the literal
    // string "Db Stats Desc" as the card description.
    expect(
      screen.getByText('Inspect TimescaleDB table sizes and row counts'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Publish a test message to the MQTT broker'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Desc$/)).toBeNull()
  })

  it('lays the tools out in a responsive grid', () => {
    const { container } = renderSection()
    const root = container.firstElementChild

    expect(root).toHaveClass('grid')
    expect(root).toHaveClass('md:grid-cols-2')
    expect(root).toHaveClass('2xl:grid-cols-3')
  })

  it('exposes one action per tool: a Run button for each backend card and a Send button for MQTT', () => {
    renderSection()

    expect(screen.getAllByRole('button', { name: 'Run' })).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Send Test' })).toBeInTheDocument()
  })

  it('runs a backend tool against its endpoint and shows the success result', async () => {
    mockedRequest.mockResolvedValueOnce({ tables: 12, hypertables: 3 })
    renderSection()

    const card = cardByTitle('Db Stats')
    fireEvent.click(within(card).getByRole('button', { name: 'Run' }))

    await waitFor(() => {
      expect(within(card).getByText('Success')).toBeInTheDocument()
    })
    expect(mockedRequest).toHaveBeenCalledWith('/dev-tools/db-stats', {
      method: 'GET',
    })
    expect(card).toHaveTextContent(/"tables": 12/)
  })

  it('targets a distinct GET endpoint for every backend tool', async () => {
    mockedRequest.mockResolvedValue({ ok: true })
    renderSection()

    const wiring: Array<[string, string]> = [
      ['Db Stats', 'db-stats'],
      ['Migrations', 'migration-status'],
      ['Env Check', 'env-check'],
      ['Runtime', 'runtime-info'],
    ]
    for (const [title] of wiring) {
      fireEvent.click(within(cardByTitle(title)).getByRole('button', { name: 'Run' }))
    }

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledTimes(4)
    })
    for (const [, endpoint] of wiring) {
      expect(mockedRequest).toHaveBeenCalledWith(`/dev-tools/${endpoint}`, {
        method: 'GET',
      })
    }
  })

  it('shows a Failed badge and the error message when a backend request rejects', async () => {
    // apiFetch swallows the rejection and returns { error }, so the mutation
    // resolves with an error-shaped payload rather than throwing.
    mockedRequest.mockRejectedValueOnce(new Error('db unreachable'))
    renderSection()

    const card = cardByTitle('Db Stats')
    fireEvent.click(within(card).getByRole('button', { name: 'Run' }))

    await waitFor(() => {
      expect(within(card).getByText('Failed')).toBeInTheDocument()
    })
    expect(within(card).getByText('db unreachable')).toBeInTheDocument()
    expect(within(card).queryByText('Success')).toBeNull()
  })

  it('associates the MQTT topic and message fields with accessible labels', () => {
    renderSection()

    const topic = screen.getByLabelText('Topic')
    const message = screen.getByLabelText('Message')

    expect(topic.tagName).toBe('INPUT')
    expect(message.tagName).toBe('TEXTAREA')
    // The controls are keyboard-reachable form fields, not decorative spans.
    expect(topic).toHaveAttribute('placeholder', 'test/topic')
  })

  it('does not render an MQTT result panel before anything is sent', () => {
    renderSection()
    const card = cardByTitle('Mqtt')

    expect(within(card).getByRole('button', { name: 'Send Test' })).toBeInTheDocument()
    // No result <pre> and no idle placeholder — the panel only mounts on demand.
    expect(card.querySelector('pre')).toBeNull()
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('publishes the entered topic and message to the mqtt-test endpoint', async () => {
    mockedRequest.mockResolvedValueOnce({ published: true, topic: 'sensors/temp' })
    renderSection()

    fireEvent.change(screen.getByLabelText('Topic'), {
      target: { value: 'sensors/temp' },
    })
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: '{"c":21}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send Test' }))

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith('/dev-tools/mqtt-test', {
        method: 'POST',
        body: JSON.stringify({ topic: 'sensors/temp', message: '{"c":21}' }),
      })
    })
    const card = cardByTitle('Mqtt')
    await waitFor(() => {
      expect(card).toHaveTextContent(/"published": true/)
    })
  })

  it('surfaces an MQTT broker error in the result panel', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('broker unreachable'))
    renderSection()

    fireEvent.change(screen.getByLabelText('Topic'), {
      target: { value: 'test/topic' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send Test' }))

    const card = cardByTitle('Mqtt')
    await waitFor(() => {
      expect(within(card).getByText('broker unreachable')).toBeInTheDocument()
    })
    // Error branch renders a rose <p>, never a data <pre>.
    expect(within(card).getByText('broker unreachable').className).toMatch(/rose/)
    expect(card.querySelector('pre')).toBeNull()
  })

  it('shows a busy, disabled Send button while the request is in flight', async () => {
    let resolve: (v: Record<string, unknown>) => void = () => {}
    mockedRequest.mockImplementationOnce(
      () =>
        new Promise<Record<string, unknown>>((r) => {
          resolve = r
        }),
    )
    renderSection()

    const sendBtn = screen.getByRole('button', { name: 'Send Test' })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(sendBtn).toHaveAttribute('aria-busy', 'true')
    })
    expect(sendBtn).toBeDisabled()

    // Settle the in-flight request so the mutation state doesn't leak.
    resolve({ published: true })
    await waitFor(() => {
      expect(sendBtn).not.toHaveAttribute('aria-busy')
    })
  })
})
