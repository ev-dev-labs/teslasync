// Behavioural test suite for AIAutoNameUnnamedLocations.
//
// This is the co-located Project-Apex elevation test for
// `web/src/components/ai/AIAutoNameUnnamedLocations.tsx`. It exercises
// every runtime facet of the component's public contract rather than a
// smoke render:
//
//   - the AI-off / per-feature gate (withAiFeature) in both the
//     negative and positive-control directions;
//   - baseline panel content (current-label context, the computed —
//     never literal — disabled state of the Suggest button);
//   - the streaming wiring (single POST to the correct route with an
//     empty body and SSE headers, delta rendering, the double-submit
//     guard, and the off-mode 404 → error fallback);
//   - typed `tool_result` envelope handling (accepted proposal → Apply
//     hands the name back to the baseline form; rejected proposal →
//     Apply stays disabled; malformed / mismatched / failed frames are
//     ignored);
//   - the null-safety hardening added alongside this suite: an `ok`
//     envelope carrying a blank proposed_name must NOT be applyable and
//     must render the `—` placeholder rather than a blank line;
//   - the lifecycle contract: a location change clears a stale draft.
//
// Network is never hit — `globalThis.fetch` is stubbed per-test with an
// in-memory ReadableStream that replays canned SSE frames, mirroring the
// established convention in the sibling AI-stream tests
// (TestAutoNameLocationsAIOffManualNamingWorks.test.tsx et al.).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import {
  AIAutoNameUnnamedLocations,
  type LocationNameDraft,
} from '@/components/ai/AIAutoNameUnnamedLocations'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-auto-name-unnamed-locations-root'
const DRAFT_TESTID = 'ai-feature-auto-name-unnamed-locations-draft'
const APPLY_TESTID = 'ai-feature-auto-name-unnamed-locations-apply'

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

/** Enable the feature end-to-end (mode on + per-feature toggle on). */
function enableAi() {
  mockUseSettings.mockReturnValue(
    settingsPayload({
      ai_mode: 'cloud',
      ai_features: { 'auto-name-unnamed-locations': true },
    }),
  )
}

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

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

type FetchCall = { url: string; init: RequestInit | undefined }

/** Stub fetch to replay one canned SSE body (or an HTTP status). */
function stubFetch(sseBody: string, status = 200): FetchCall[] {
  const calls: FetchCall[] = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    if (status !== 200) {
      return new Response(null, { status })
    }
    return new Response(makeReadableStream([sseBody]), {
      status,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as unknown as typeof globalThis.fetch
  return calls
}

/** A well-formed accepted draft envelope. */
function okEnvelope(overrides: Partial<LocationNameDraft> = {}): LocationNameDraft {
  return {
    location_id: 501,
    proposed_name: 'Frequent Stop — South Lake Union',
    status: 'ok',
    reason: 'High visit_count and stable dwell pattern at this coordinate.',
    ...overrides,
  }
}

function toolResultBody(data: unknown, ok = true): string {
  return (
    sseFrame('tool_call', {
      id: 'tc1',
      name: 'draft_location_name',
      arguments: { location_id: 501 },
    }) +
    sseFrame('tool_result', { id: 'tc1', name: 'draft_location_name', ok, data }) +
    sseFrame('delta', { text: 'Draft ready.' }) +
    sseFrame('done', { finish_reason: 'stop', usage: { in: 100, out: 30 } })
  )
}

async function clickSuggest() {
  const button = screen.getByRole('button', { name: /Suggest name/i })
  await act(async () => {
    fireEvent.click(button)
  })
  return button
}

beforeEach(() => {
  mockUseSettings.mockReset()
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AIAutoNameUnnamedLocations — AI-off contract & gating', () => {
  it('renders nothing when ai_mode=off even if the per-feature toggle is on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'auto-name-unnamed-locations': true },
      }),
    )

    const { container } = render(
      <AIAutoNameUnnamedLocations locationId={501} onApplyName={vi.fn()} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the mode is on but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'auto-name-unnamed-locations': false },
      }),
    )

    const { container } = render(
      <AIAutoNameUnnamedLocations locationId={501} onApplyName={vi.fn()} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) when mode=cloud AND the toggle is on', () => {
    enableAi()

    render(<AIAutoNameUnnamedLocations locationId={501} onApplyName={vi.fn()} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'auto-name-unnamed-locations')
    expect(
      screen.getByRole('button', { name: /Suggest name/i }),
    ).toBeInTheDocument()
  })
})

describe('AIAutoNameUnnamedLocations — baseline panel content', () => {
  it('surfaces the current label context when currentName is provided', () => {
    enableAi()

    render(
      <AIAutoNameUnnamedLocations
        locationId={501}
        currentName="47.6062,-122.3321"
        onApplyName={vi.fn()}
      />,
    )

    expect(screen.getByText(/Current label/i)).toBeInTheDocument()
    expect(screen.getByText('47.6062,-122.3321')).toBeInTheDocument()
  })

  it('omits the current-label line when currentName is undefined', () => {
    enableAi()

    render(<AIAutoNameUnnamedLocations locationId={501} onApplyName={vi.fn()} />)

    expect(screen.queryByText(/Current label/i)).not.toBeInTheDocument()
  })

  it('exposes an accessible name combining the Helix CTA and the per-feature verb', () => {
    enableAi()

    render(<AIAutoNameUnnamedLocations locationId={501} onApplyName={vi.fn()} />)

    const button = screen.getByRole('button', { name: /Suggest name/i })
    expect(button).toHaveAttribute('aria-label', 'Ask Helix · Suggest name')
    expect(button).not.toBeDisabled()
  })

  it('computes the disabled state from a non-positive locationId (never a literal disabled prop)', () => {
    enableAi()

    const { rerender } = render(
      <AIAutoNameUnnamedLocations locationId={0} onApplyName={vi.fn()} />,
    )
    const button = screen.getByRole('button', { name: /Suggest name/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')

    rerender(<AIAutoNameUnnamedLocations locationId={-3} onApplyName={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Suggest name/i })).toBeDisabled()
  })
})

describe('AIAutoNameUnnamedLocations — streaming wiring', () => {
  it('POSTs exactly once to /api/v1/ai/locations/{id}/name/draft with an empty body + SSE headers, then renders the delta', async () => {
    enableAi()
    const body =
      sseFrame('delta', {
        text: 'I drafted "Frequent Stop — South Lake Union".',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } })
    const calls = stubFetch(body)

    render(
      <AIAutoNameUnnamedLocations
        locationId={501}
        currentName="47.6062,-122.3321"
        onApplyName={vi.fn()}
      />,
    )

    await clickSuggest()

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe('/api/v1/ai/locations/501/name/draft')
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({})
    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() =>
      expect(screen.getByTestId(ROOT_TESTID)).toHaveTextContent(
        /I drafted "Frequent Stop — South Lake Union"/,
      ),
    )
  })

  it('ignores a second click while streaming (double-submit guard)', async () => {
    enableAi()
    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      // Never enqueue, never close — keeps state='streaming'.
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(<AIAutoNameUnnamedLocations locationId={501} onApplyName={vi.fn()} />)

    const button = await clickSuggest()
    await waitFor(() => expect(fetchCount).toBe(1))
    await waitFor(() => expect(button).toBeDisabled())

    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(fetchCount).toBe(1)
  })

  it('falls back on an off-mode 404: surfaces the Helix error, renders no draft, and re-enables the button', async () => {
    enableAi()
    stubFetch('', 404)

    render(<AIAutoNameUnnamedLocations locationId={501} onApplyName={vi.fn()} />)

    const button = await clickSuggest()

    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(/Helix error/i),
    )
    expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(/stream_http_404/)
    expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument()
    // 'error' is not a busy state — the user can retry.
    await waitFor(() => expect(button).not.toBeDisabled())
  })
})

describe('AIAutoNameUnnamedLocations — proposal envelope handling', () => {
  it('renders an accepted proposal and Apply hands the exact name back to the baseline form once', async () => {
    enableAi()
    const onApplyName = vi.fn()
    stubFetch(toolResultBody(okEnvelope()))

    render(
      <AIAutoNameUnnamedLocations locationId={501} onApplyName={onApplyName} />,
    )

    await clickSuggest()

    await waitFor(() =>
      expect(screen.getByTestId(DRAFT_TESTID)).toBeInTheDocument(),
    )
    const draft = screen.getByTestId(DRAFT_TESTID)
    expect(draft).toHaveTextContent(/Frequent Stop — South Lake Union/)
    expect(draft).toHaveTextContent(/stable dwell pattern/)
    // Async proposal is announced to assistive tech.
    expect(draft).toHaveAttribute('aria-live', 'polite')

    const apply = screen.getByTestId(APPLY_TESTID)
    expect(apply).toBeEnabled()
    expect(apply).toHaveAttribute('aria-disabled', 'false')

    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyName).toHaveBeenCalledTimes(1)
    expect(onApplyName).toHaveBeenCalledWith('Frequent Stop — South Lake Union')
  })

  it('shows the rejected label, disables Apply, and never calls onApplyName for a rejected envelope', async () => {
    enableAi()
    const onApplyName = vi.fn()
    stubFetch(
      toolResultBody(
        okEnvelope({
          proposed_name: '',
          status: 'rejected',
          reason: 'location name must not be empty',
        }),
      ),
    )

    render(
      <AIAutoNameUnnamedLocations locationId={501} onApplyName={onApplyName} />,
    )

    await clickSuggest()

    await waitFor(() =>
      expect(screen.getByTestId(DRAFT_TESTID)).toBeInTheDocument(),
    )
    expect(screen.getByText(/rejected by validator/i)).toBeInTheDocument()

    const apply = screen.getByTestId(APPLY_TESTID)
    expect(apply).toBeDisabled()
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyName).not.toHaveBeenCalled()
  })

  it('treats an ok envelope with a blank proposed_name as not-applyable and shows the — placeholder', async () => {
    enableAi()
    const onApplyName = vi.fn()
    stubFetch(toolResultBody(okEnvelope({ proposed_name: '   ', reason: undefined })))

    render(
      <AIAutoNameUnnamedLocations locationId={501} onApplyName={onApplyName} />,
    )

    await clickSuggest()

    await waitFor(() =>
      expect(screen.getByTestId(DRAFT_TESTID)).toBeInTheDocument(),
    )
    // Blank name renders the placeholder rather than an empty line.
    expect(screen.getByTestId(DRAFT_TESTID)).toHaveTextContent('—')

    const apply = screen.getByTestId(APPLY_TESTID)
    expect(apply).toBeDisabled()
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyName).not.toHaveBeenCalled()
  })

  it('ignores a tool_result frame whose ok flag is false', async () => {
    enableAi()
    stubFetch(toolResultBody(okEnvelope(), /* ok */ false))

    render(<AIAutoNameUnnamedLocations locationId={501} onApplyName={vi.fn()} />)

    await clickSuggest()
    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument()
  })

  it('ignores a tool_result frame from a different tool name', async () => {
    enableAi()
    const body =
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'some_other_tool',
        ok: true,
        data: okEnvelope(),
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } })
    stubFetch(body)

    render(<AIAutoNameUnnamedLocations locationId={501} onApplyName={vi.fn()} />)

    await clickSuggest()
    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument()
  })

  it('ignores a malformed envelope missing required fields', async () => {
    enableAi()
    stubFetch(toolResultBody({ location_id: 501, status: 'ok' /* no proposed_name */ }))

    render(<AIAutoNameUnnamedLocations locationId={501} onApplyName={vi.fn()} />)

    await clickSuggest()
    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument()
  })
})

describe('AIAutoNameUnnamedLocations — lifecycle', () => {
  it('clears a stale draft when the selected locationId changes', async () => {
    enableAi()
    stubFetch(toolResultBody(okEnvelope()))

    const { rerender } = render(
      <AIAutoNameUnnamedLocations locationId={501} onApplyName={vi.fn()} />,
    )

    await clickSuggest()
    await waitFor(() =>
      expect(screen.getByTestId(DRAFT_TESTID)).toBeInTheDocument(),
    )

    // Switching to another location must not bleed the previous
    // proposal into the new scope (cancel + reset on locationId change).
    rerender(<AIAutoNameUnnamedLocations locationId={777} onApplyName={vi.fn()} />)

    await waitFor(() =>
      expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId(ROOT_TESTID)).toBeInTheDocument()
  })
})
