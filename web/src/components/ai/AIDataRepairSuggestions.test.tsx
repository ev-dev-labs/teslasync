// Co-located unit + wiring test for AIDataRepairSuggestions.
//
// The module exports a single symbol: the
// `withAiFeature('data-repair-suggestions', InnerSection)` gated
// component. The optional vehicleId prop scopes the server-side stale-session
// inventory; changing that scope aborts any active request and clears prior
// output. This suite covers every observable facet of the component so the
// file can be marked production-grade:
//
//   1. Render gate (ADR-015 §I5/§I6): the surface is entirely absent
//      when ai_mode='off' OR the per-feature toggle is off OR settings
//      have not resolved, and present (with the registered
//      `ai-feature-data-repair-suggestions-root` test id) only when the
//      mode is on AND the toggle is true. The positive control proves
//      the negative assertions are not trivially true (a typo in the
//      registry/HOC that hid the section forever would still pass the
//      negatives). Both non-off modes ('cloud' and 'local') are
//      exercised.
//
//   2. Surface structure + a11y: the enabled card renders the Helix
//      heading, the propose-only description, the "Helix" badge, and a
//      single "Draft repair plan" action whose accessible name carries
//      the per-feature verb (aria-label = "Ask Helix · Draft repair
//      plan"). The button is a COMPUTED-disabled control (never a
//      literal `disabled`): enabled at idle with aria-disabled='false',
//      and it exposes no output panel until a stream has run.
//
//   3. On-mode SSE wiring: clicking Draft POSTs exactly once to the
//      registered route /api/v1/ai/system/data-repair/draft with an
//      empty `{}` fleet-wide body or `{ vehicle_id }` scoped body + SSE
//      headers, shows the thinking indicator while awaiting the first delta,
//      renders the delta text, coalesces a double-submit while streaming,
//      surfaces a stream error on a non-2xx response, and re-enables the
//      button after a completed draft so the user can draft again.
//
// Network is stubbed at the `fetch` boundary — the same pattern the
// sibling wiring tests use; no real request is ever made.
// @testing-library/user-event is intentionally NOT a dependency of this
// codebase (see web/package.json), so interactions use fireEvent.click.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIDataRepairSuggestions } from '@/components/ai/AIDataRepairSuggestions'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

// baseSettings is a complete AppSettings with realistic non-AI
// defaults. Per-test overrides flip ai_mode + ai_features to exercise
// the gate's off (negative) and on (positive) paths.
const baseSettings: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
}

function settingsPayload(overrides: Partial<AppSettings>) {
  return { settings: { ...baseSettings, ...overrides } }
}

// enabled() returns the fully-on settings shape (mode + toggle) so the
// on-mode tests read one intent-revealing helper instead of repeating
// the two-field override.
function enabled(overrides: Partial<AppSettings> = {}) {
  return settingsPayload({
    ai_mode: 'cloud',
    ai_features: { 'data-repair-suggestions': true },
    ...overrides,
  })
}

// makeReadableStream constructs a ReadableStream<Uint8Array> from
// arbitrarily-sized text chunks, matching the helper used by the
// useAiStream + sibling wiring tests so the SSE parser receives
// byte-for-byte equivalent input.
function makeReadableStream(chunks: Array<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]))
        i++
      } else {
        controller.close()
      }
    },
  })
}

// sseFrame formats a single SSE event the way
// internal/ai/stream/writer.go emits it.
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

const ROOT_TESTID = 'ai-feature-data-repair-suggestions-root'
const FEATURE_ID = 'data-repair-suggestions'
const ROUTE = '/api/v1/ai/system/data-repair/draft'
const BUTTON_NAME = /Draft repair plan/i
const TITLE = /Helix repair suggestions/i
const DESCRIPTION = /Propose a typed repair plan/i

beforeEach(() => {
  mockUseSettings.mockReset()
  // Loud default so a test that forgets to install its own fetch mock
  // fails clearly instead of silently timing out.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AIDataRepairSuggestions — AI-off render gate', () => {
  it('renders nothing when ai_mode=off even with the data-repair-suggestions toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'data-repair-suggestions': true },
      }),
    )

    const { container } = render(<AIDataRepairSuggestions />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: BUTTON_NAME }),
    ).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is off even with ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'data-repair-suggestions': false },
      }),
    )

    const { container } = render(<AIDataRepairSuggestions />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_features is entirely absent (undefined map)', () => {
    // The gate must fail-closed on a partial settings shape: an
    // ai_mode that is on but with no ai_features map at all yields
    // `flags === undefined` inside useAiEnabled, which returns false.
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: undefined }),
    )

    const { container } = render(<AIDataRepairSuggestions />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing while settings are still unresolved (settings undefined)', () => {
    // Before the Settings query resolves, useSettings yields
    // `settings: undefined`; useAiEnabled returns false so no AI
    // surface flashes in during the loading window.
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(<AIDataRepairSuggestions />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) when ai_mode=cloud AND the toggle is on', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AIDataRepairSuggestions />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    // The title heading + Draft button prove the InnerSection body
    // actually mounted (not just the gate wrapper).
    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: BUTTON_NAME })).toBeInTheDocument()
  })

  it('also renders under ai_mode=local (local mode is a non-off mode)', () => {
    // ADR-015 §I1: only `off` blocks every surface. `local` (on-device
    // provider) must render the section exactly as `cloud` does.
    mockUseSettings.mockReturnValue(enabled({ ai_mode: 'local' }))

    render(<AIDataRepairSuggestions />)

    expect(screen.getByTestId(ROOT_TESTID)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: BUTTON_NAME })).toBeInTheDocument()
  })
})

describe('AIDataRepairSuggestions — enabled surface structure + a11y', () => {
  it('renders the heading, propose-only description, Helix badge, and an idle-enabled Draft button', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AIDataRepairSuggestions />)

    // Heading + description copy (i18n falls back to the inline
    // defaults in the test env).
    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument()
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument()
    // The "Helix" brand badge sits in the header.
    expect(screen.getAllByText('Helix').length).toBeGreaterThan(0)

    // The action button is enabled at idle (no stream open) and its
    // disabled state is a COMPUTED expression mirrored by aria-disabled
    // — never a literal `disabled` (W1 Rule A).
    const button = screen.getByRole('button', { name: BUTTON_NAME })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    // The visible label is the universal Helix CTA; the per-feature
    // verb lives in the tooltip + accessible name.
    expect(button).toHaveTextContent(/Ask Helix/i)
    expect(button).toHaveAttribute('title', expect.stringMatching(BUTTON_NAME))
  })

  it('shows no output panel before any draft has run (idle state renders nothing)', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AIDataRepairSuggestions />)

    // AiOutputPanel returns null while idle with no accumulated text,
    // so the panel + thinking indicator are both absent until a stream
    // opens. This proves the surface does not render an empty box.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-thinking-indicator')).not.toBeInTheDocument()
  })
})

describe('AIDataRepairSuggestions — on-mode SSE wiring', () => {
  it('POSTs once to the registered route with an empty {} body + SSE headers and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(enabled())

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const proposal =
      'Charging session 42 has been open for 25 hours. Propose: close it now and accept the auto-derived ended_at timestamp.'
    const sseBody =
      sseFrame('delta', { text: proposal }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 200, out: 60 } })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(<AIDataRepairSuggestions />)

    const root = screen.getByTestId(ROOT_TESTID)
    const button = screen.getByRole('button', { name: BUTTON_NAME })
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })

    // Exactly one POST against the registered backend route. The hook
    // prepends `${getApiBase()}/api/v1`; getApiBase() is '' in tests,
    // so the final URL is the bare route.
    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe(ROUTE)
    expect(init?.method).toBe('POST')
    // The body is intentionally `{}` — the backend reads the inventory
    // itself; the SPA passes no ids or params, but the POST body must
    // still be valid JSON.
    expect(typeof init?.body).toBe('string')
    expect(JSON.parse(init?.body as string)).toEqual({})

    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // The accumulated delta text renders inside the gated wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(proposal)
    })
  })

  it('shows the thinking indicator and disables the button while the stream is open', async () => {
    mockUseSettings.mockReturnValue(enabled())

    // A stream that never enqueues/closes holds state === 'streaming'.
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // Never enqueue, never close.
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AIDataRepairSuggestions />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    await act(async () => {
      fireEvent.click(button)
    })

    // Loading state: the AiOutputPanel renders the animated thinking
    // indicator (role=status) while awaiting the first delta, and the
    // button flips to computed-disabled with the streaming label.
    const indicator = await screen.findByTestId('ai-thinking-indicator')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveAttribute('role', 'status')
    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveTextContent(/Helix is thinking/i)
  })

  it('coalesces a second click while streaming into a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(enabled())

    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // Never enqueue, never close — keeps state='streaming'.
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AIDataRepairSuggestions />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))

    // While streaming the button is computed-disabled.
    await waitFor(() => expect(button).toBeDisabled())
    await act(async () => {
      // fireEvent bypasses the disabled attribute, exercising the
      // hook's runningRef coalescer directly (defence in depth).
      fireEvent.click(button)
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })

  it('surfaces the stream error when the backend returns a non-2xx status', async () => {
    mockUseSettings.mockReturnValue(enabled())

    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof globalThis.fetch

    render(<AIDataRepairSuggestions />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    await act(async () => {
      fireEvent.click(button)
    })

    // useAiStream maps a non-ok response to `stream_http_<status>` and
    // flips to state='error'; AiOutputPanel renders the Helix error
    // affordance rather than any proposal text.
    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent('stream_http_404')
  })

  it('re-enables the button after a completed draft so the user can draft again (a fresh POST fires)', async () => {
    mockUseSettings.mockReturnValue(enabled())

    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      const text =
        fetchCount === 1 ? 'First proposal for stale drive 7.' : 'Second proposal after re-draft.'
      const sseBody =
        sseFrame('delta', { text }) +
        sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 5 } })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(<AIDataRepairSuggestions />)

    const root = screen.getByTestId(ROOT_TESTID)
    const button = screen.getByRole('button', { name: BUTTON_NAME })

    // First draft completes.
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))
    await waitFor(() => expect(root).toHaveTextContent('First proposal for stale drive 7.'))

    // After `done`, canStart recovers (state !== 'streaming') so the
    // button is enabled again for a follow-up draft.
    await waitFor(() => expect(button).not.toBeDisabled())

    // Second draft fires a fresh POST and replaces the rendered text.
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(2))
    await waitFor(() => expect(root).toHaveTextContent('Second proposal after re-draft.'))
    expect(root).not.toHaveTextContent('First proposal for stale drive 7.')
  })

  it('aborts an active draft when the selected vehicle changes', async () => {
    mockUseSettings.mockReturnValue(enabled())

    let requestSignal: AbortSignal | undefined
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => {
          const abortError = new Error('Aborted')
          abortError.name = 'AbortError'
          reject(abortError)
        }, { once: true })
      })
    }) as unknown as typeof globalThis.fetch

    const { rerender } = render(<AIDataRepairSuggestions vehicleId={7} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BUTTON_NAME }))
    })

    await waitFor(() => expect(requestSignal).toBeDefined())
    expect(requestSignal?.aborted).toBe(false)

    rerender(<AIDataRepairSuggestions vehicleId={8} />)

    await waitFor(() => expect(requestSignal?.aborted).toBe(true))
    expect(screen.getByRole('button', { name: BUTTON_NAME })).not.toBeDisabled()
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
  })

  it('clears a completed draft before showing another vehicle scope', async () => {
    mockUseSettings.mockReturnValue(enabled())

    const requestBodies: unknown[] = []
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { vehicle_id?: number }
      requestBodies.push(body)
      const proposal = body.vehicle_id === 7
        ? 'Proposal scoped to vehicle 7.'
        : 'Proposal scoped to vehicle 8.'
      return new Response(makeReadableStream([
        sseFrame('delta', { text: proposal }),
        sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 5 } }),
      ]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    const { rerender } = render(<AIDataRepairSuggestions vehicleId={7} />)
    fireEvent.click(screen.getByRole('button', { name: BUTTON_NAME }))
    await screen.findByText('Proposal scoped to vehicle 7.')

    rerender(<AIDataRepairSuggestions vehicleId={8} />)

    expect(screen.queryByText('Proposal scoped to vehicle 7.')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: BUTTON_NAME }))
    await screen.findByText('Proposal scoped to vehicle 8.')
    expect(requestBodies).toEqual([{ vehicle_id: 7 }, { vehicle_id: 8 }])
  })
})
