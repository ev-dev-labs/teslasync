// Phase-50 / 0034 — A1 Alert tuning suggestions.
//
// `TestAlertTuningSuggestionsAIOffManualTuningWorks` (the Vitest
// sibling to the Go test of the same name) is the slice's
// load-bearing AI-OFF contract proof on the React side. It mounts
// the AIAlertTuningSuggestions component with ai_mode='off' (plus
// the per-feature toggle on, to defeat the obvious "off because
// nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND alert-tuning-suggestions=true,
//      the section IS present + carries the expected test ID.
//      This is the positive control that proves the gate
//      actually works (otherwise the "absent in off mode"
//      assertion is trivially true).
//
// W1 inline wiring — also asserts the on-mode wiring contract:
//   - clicking "Suggest tuning" POSTs exactly one request to
//     `/api/v1/ai/alerts/rules/{ruleID}/tune/draft`.
//   - the first delta event's text renders inside the gated
//     wrapper.
//   - a second click while streaming is a no-op (double-submit
//     guard).
//   - the proposal preview renders after a tool_result frame and
//     the "Apply to form" button calls onApplyDraft with the
//     extracted patch (proves the typed draft → baseline form
//     copy path; the AI panel never persists state directly).
//
// The HTTP /api/v1/ai/alerts/rules/{ruleID}/tune/draft
// 404-in-off-mode invariant is proven by the Go-side
// TestAlertTuningSuggestionsAIOffManualTuningWorks in
// internal/api/ai_alert_tuning_handler_test.go — the network
// layer does not exist in the React unit-test scope.
//
// File name MUST stay
// `TestAlertTuningSuggestionsAIOffManualTuningWorks.test.tsx` —
// the slice prompt's verification command runs
// `vitest --run TestAlertTuningSuggestionsAIOffManualTuningWorks`,
// where the positional pattern is matched against the file
// PATH.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIAlertTuningSuggestions } from '@/components/ai/AIAlertTuningSuggestions'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

// baseSettings is a complete AppSettings with realistic non-AI
// defaults. Per-test cases override `ai_mode` + `ai_features` to
// exercise the off-mode (negative) and on-mode (positive
// control) paths.
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

// makeReadableStream constructs a ReadableStream<Uint8Array>
// from arbitrarily-sized text chunks. Mirrors the helper used
// by useAiStream.test.ts so the parser receives byte-for-byte
// equivalent input.
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
// internal/ai/stream/writer.go emits it (`event: <name>\ndata:
// <json>\n\n`).
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

beforeEach(() => {
  mockUseSettings.mockReset()
  // Default fetch mock yells if a test forgets to install its
  // own — surfaces miswiring as a clear failure rather than a
  // silent timeout.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TestAlertTuningSuggestionsAIOffManualTuningWorks (alert-tuning-suggestions AI-off contract)', () => {
  it('TestAlertTuningSuggestionsAIOffManualTuningWorks: renders nothing when ai_mode=off even with the alert-tuning-suggestions toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle (ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'alert-tuning-suggestions': true },
      }),
    )

    const { container } = render(
      <AIAlertTuningSuggestions ruleId={42} onApplyDraft={vi.fn()} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByTestId('ai-feature-alert-tuning-suggestions-root'),
    ).not.toBeInTheDocument()
  })

  it('TestAlertTuningSuggestionsAIOffManualTuningWorks: renders nothing when ai_mode is non-off but the alert-tuning-suggestions toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'alert-tuning-suggestions': false },
      }),
    )

    const { container } = render(
      <AIAlertTuningSuggestions ruleId={42} onApplyDraft={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByTestId('ai-feature-alert-tuning-suggestions-root'),
    ).not.toBeInTheDocument()
  })

  it('TestAlertTuningSuggestionsAIOffManualTuningWorks: renders the section when ai_mode=cloud AND alert-tuning-suggestions toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'alert-tuning-suggestions': true },
      }),
    )

    render(<AIAlertTuningSuggestions ruleId={42} onApplyDraft={vi.fn()} />)
    const root = screen.getByTestId(
      'ai-feature-alert-tuning-suggestions-root',
    )
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'alert-tuning-suggestions',
    )
  })
})

describe('TestAlertTuningSuggestionsAIOnWiredCallsRoute (alert-tuning-suggestions on-mode SPA wiring)', () => {
  it('TestAlertTuningSuggestionsAIOnWiredCallsRoute: clicking Suggest POSTs once to /api/v1/ai/alerts/rules/{ruleID}/tune/draft and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'alert-tuning-suggestions': true },
      }),
    )

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text:
          'Recent firings show 23 alerts in 7 days; raising the threshold from 20 to 15 and the cooldown to 30 min would have produced 3 alerts — descriptive replay.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(
      <AIAlertTuningSuggestions
        ruleId={42}
        vehicleId={7}
        onApplyDraft={vi.fn()}
      />,
    )

    // 1) The gated wrapper renders with the registered test ID.
    const root = screen.getByTestId(
      'ai-feature-alert-tuning-suggestions-root',
    )
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'alert-tuning-suggestions',
    )

    // 2) Suggest button is enabled (ruleId>0, not streaming).
    const button = screen.getByRole('button', { name: /Suggest tuning/i })
    expect(button).toBeInTheDocument()
    expect(button).not.toBeDisabled()

    // 3) Click — fires the SSE stream against the registered route.
    await act(async () => {
      fireEvent.click(button)
    })

    // 4) Exactly one fetch must have been enqueued, against the
    // registered backend path. useAiStream prepends
    // `${getApiBase()}/api/v1`; getApiBase returns '' in the test
    // environment, so the final URL is
    // `/api/v1/ai/alerts/rules/42/tune/draft`.
    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe('/api/v1/ai/alerts/rules/42/tune/draft')
    expect(init?.method).toBe('POST')
    expect(typeof init?.body).toBe('string')
    const parsedBody = JSON.parse(init?.body as string)
    expect(parsedBody).toEqual({ vehicle_id: 7 })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // 5) The first delta's text renders inside the gated wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        /Recent firings show 23 alerts in 7 days/,
      )
    })
  })

  it('TestAlertTuningSuggestionsAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'alert-tuning-suggestions': true },
      }),
    )

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

    render(
      <AIAlertTuningSuggestions ruleId={42} onApplyDraft={vi.fn()} />,
    )

    const button = screen.getByRole('button', { name: /Suggest tuning/i })

    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))

    // While streaming the button's disabled is COMPUTED from
    // `isBusy || !ruleId`. The hook's `runningRef` also coalesces
    // duplicate start() calls, so the second click is a
    // defence-in-depth no-op even if a future refactor
    // accidentally drops the visual disabled.
    await waitFor(() => expect(button).toBeDisabled())
    await act(async () => {
      fireEvent.click(button)
    })

    // Give any rogue fetch a microtask to land.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })

  it('TestAlertTuningSuggestionsAIOnWiredCallsRoute: tool_result proposal renders preview and Apply-to-form copies typed draft to onApplyDraft', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'alert-tuning-suggestions': true },
      }),
    )

    const onApplyDraft = vi.fn()

    // SSE stream: tool_call, tool_result with typed proposal,
    // then a final delta + done. The tool_result envelope shape
    // mirrors the AlertRulePatchProposal Go struct.
    const proposalEnvelope = {
      rule_id: 42,
      status: 'ok',
      rule_before: {
        id: 42,
        name: 'Battery low',
        signal_name: 'battery_level',
        op: '<',
        value_num: 20,
        cooldown_min: 5,
        severity: 'warn',
        trigger_mode: 'repeat',
      },
      proposed: {
        id: 42,
        name: 'Battery low',
        signal_name: 'battery_level',
        op: '<',
        value_num: 15,
        cooldown_min: 30,
        severity: 'warn',
        trigger_mode: 'repeat',
      },
    }

    const sseBody =
      sseFrame('tool_call', {
        id: 'tc1',
        name: 'draft_alert_rule_patch',
        arguments: { rule_id: 42, new_value_num: 15, new_cooldown_min: 30 },
      }) +
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_alert_rule_patch',
        ok: true,
        data: proposalEnvelope,
      }) +
      sseFrame('delta', {
        text: 'Proposed tuning: raise threshold from 20 to 15 and increase cooldown from 5 to 30 minutes.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 100, out: 30 } })

    globalThis.fetch = vi.fn(
      async () =>
        new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ) as unknown as typeof globalThis.fetch

    render(
      <AIAlertTuningSuggestions ruleId={42} onApplyDraft={onApplyDraft} />,
    )

    const suggest = screen.getByRole('button', { name: /Suggest tuning/i })
    await act(async () => {
      fireEvent.click(suggest)
    })

    // The proposal preview renders once tool_result lands.
    await waitFor(() => {
      expect(screen.getByText(/value_num: 15/)).toBeInTheDocument()
      expect(screen.getByText(/cooldown_min: 30/)).toBeInTheDocument()
    })

    // Apply-to-form is enabled now and pushes the typed patch
    // up to the parent. The AI panel never persists state
    // directly — onApplyDraft is the canonical hand-off into the
    // baseline AlertStudio form, whose own Save button writes
    // through PUT /api/v1/alerts/rules/{id} (the unguarded
    // baseline path).
    const apply = screen.getByRole('button', { name: /Apply to form/i })
    await waitFor(() => expect(apply).not.toBeDisabled())
    await act(async () => {
      fireEvent.click(apply)
    })

    expect(onApplyDraft).toHaveBeenCalledTimes(1)
    expect(onApplyDraft).toHaveBeenCalledWith({
      value_num: 15,
      cooldown_min: 30,
      severity: 'warn',
      trigger_mode: 'repeat',
      op: '<',
    })
  })
})
