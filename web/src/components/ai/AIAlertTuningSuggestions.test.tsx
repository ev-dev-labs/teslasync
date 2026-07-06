// Comprehensive unit + behaviour coverage for AIAlertTuningSuggestions.
//
// This is the co-located Project Apex elevation test. It exercises the
// component's full public surface — the single runtime export
// `AIAlertTuningSuggestions` plus the exported `AlertRuleDraftPatch`
// type — across every branch that matters:
//
//   - the ADR-015 AI-off visibility gate (off-mode, per-feature toggle
//     off, and the positive control that proves the gate is real);
//   - the SSE wiring contract (exactly one POST to the registered
//     `/api/v1/ai/alerts/rules/{ruleID}/tune/draft` route, correct
//     method/headers, and the `vehicle_id` body branch);
//   - the streaming lifecycle (thinking indicator + disabled action
//     button while in flight, double-submit guard, HTTP-error fallback);
//   - the typed-proposal capture path (full patch, partial extraction
//     with invalid fields dropped, the `value_num: 0` falsy edge, and
//     the empty-patch guard) plus the tool_result rejection branches
//     (wrong tool name, ok=false, status!=ok);
//   - the "Apply to form" hand-off (the AI panel never persists — it
//     only forwards a typed patch to the parent via onApplyDraft); and
//   - the ruleId-change reset that prevents a stale proposal from one
//     rule bleeding into another rule's editor.
//
// Network is mocked via a hand-rolled ReadableStream that emits the
// exact SSE frames internal/ai/stream/writer.go produces — the same
// convention the sibling TestAlertTuningSuggestions test uses. No real
// network is ever touched. react-i18next returns the English fallback
// (2nd arg) with no provider mounted, so assertions read the defaults.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import {
  AIAlertTuningSuggestions,
  type AlertRuleDraftPatch,
} from '@/components/ai/AIAlertTuningSuggestions'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const SUGGEST_TESTID = 'ai-feature-alert-tuning-suggestions-suggest'
const PREVIEW_TESTID = 'ai-feature-alert-tuning-suggestions-preview'
const ROOT_TESTID = 'ai-feature-alert-tuning-suggestions-root'

// A complete AppSettings with realistic non-AI defaults. Per-test cases
// override `ai_mode` + `ai_features` to flip the gate.
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

// enableTuning flips the gate fully on: ai_mode != off AND the
// per-feature toggle true. Most tests below start here.
function enableTuning() {
  mockUseSettings.mockReturnValue(
    settingsPayload({
      ai_mode: 'cloud',
      ai_features: { 'alert-tuning-suggestions': true },
    }),
  )
}

// makeReadableStream constructs a ReadableStream<Uint8Array> from text
// chunks — byte-for-byte the input useAiStream's parser consumes.
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

// sseFrame formats one SSE event exactly as the backend writer emits it.
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// installStreamingFetch wires globalThis.fetch to reply once with the
// given SSE body and records every call for URL/body assertions.
function installStreamingFetch(
  sseBody: string,
  status = 200,
): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  ) as unknown as typeof globalThis.fetch
  return calls
}

// A proposal envelope mirroring the AlertRulePatchProposal Go struct.
function proposalBody(proposed: Record<string, unknown>) {
  return sseFrame('tool_result', {
    id: 'tc1',
    name: 'draft_alert_rule_patch',
    ok: true,
    data: { rule_id: 42, status: 'ok', proposed },
  }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 5 } })
}

async function clickSuggest(): Promise<HTMLElement> {
  const btn = screen.getByTestId(SUGGEST_TESTID)
  await act(async () => {
    fireEvent.click(btn)
  })
  return btn
}

beforeEach(() => {
  mockUseSettings.mockReset()
  // Loud default: a test that forgets to install its own fetch fails
  // clearly instead of silently timing out.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AIAlertTuningSuggestions — AI-off visibility gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the per-feature toggle on', () => {
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
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByTestId(SUGGEST_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode!=off but the per-feature toggle is false', () => {
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
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) when both mode and toggle are on', () => {
    enableTuning()

    render(<AIAlertTuningSuggestions ruleId={42} onApplyDraft={vi.fn()} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'alert-tuning-suggestions')
    // The visible title + Suggest CTA are present and the button is
    // enabled (ruleId > 0, idle stream).
    expect(screen.getByText('Suggest lower-noise tuning')).toBeInTheDocument()
    const suggest = screen.getByTestId(SUGGEST_TESTID)
    expect(suggest).toBeEnabled()
    expect(suggest).toHaveAttribute('aria-label', expect.stringContaining('Suggest tuning'))
  })
})

describe('AIAlertTuningSuggestions — SSE wiring + streaming lifecycle', () => {
  it('POSTs exactly once to the registered route with vehicle_id and renders the first delta', async () => {
    enableTuning()
    const sseBody =
      sseFrame('delta', {
        text: 'Recent firings show 23 alerts in 7 days; descriptive replay.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } })
    const calls = installStreamingFetch(sseBody)

    render(
      <AIAlertTuningSuggestions ruleId={42} vehicleId={7} onApplyDraft={vi.fn()} />,
    )

    await clickSuggest()

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe('/api/v1/ai/alerts/rules/42/tune/draft')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ vehicle_id: 7 })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /Recent firings show 23 alerts/,
      ),
    )
  })

  it('omits vehicle_id from the request body when no vehicleId prop is supplied', async () => {
    enableTuning()
    const calls = installStreamingFetch(
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    )

    render(<AIAlertTuningSuggestions ruleId={9} onApplyDraft={vi.fn()} />)

    await clickSuggest()

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe('/api/v1/ai/alerts/rules/9/tune/draft')
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({})
  })

  it('shows the thinking indicator and disables the action button while streaming', async () => {
    enableTuning()
    // A stream that opens but never emits/closes → stays streaming.
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({ start() {} }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
    ) as unknown as typeof globalThis.fetch

    render(<AIAlertTuningSuggestions ruleId={42} onApplyDraft={vi.fn()} />)
    const suggest = await clickSuggest()

    await waitFor(() => expect(suggest).toBeDisabled())
    expect(screen.getByTestId('ai-thinking-indicator')).toBeInTheDocument()
    expect(suggest).toHaveTextContent(/Helix is thinking/)
  })

  it('guards against double-submit: a second click while streaming issues no new request', async () => {
    enableTuning()
    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      return new Response(
        new ReadableStream<Uint8Array>({ start() {} }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AIAlertTuningSuggestions ruleId={42} onApplyDraft={vi.fn()} />)
    const suggest = await clickSuggest()

    await waitFor(() => expect(fetchCount).toBe(1))
    await waitFor(() => expect(suggest).toBeDisabled())

    await act(async () => {
      fireEvent.click(suggest)
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fetchCount).toBe(1)
  })

  it('surfaces an HTTP error in the output panel when the stream route returns non-2xx', async () => {
    enableTuning()
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(<AIAlertTuningSuggestions ruleId={42} onApplyDraft={vi.fn()} />)
    await clickSuggest()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
    // No proposal was captured on the failure path.
    expect(screen.queryByTestId(PREVIEW_TESTID)).not.toBeInTheDocument()
  })
})

describe('AIAlertTuningSuggestions — typed proposal capture + Apply hand-off', () => {
  it('renders the proposal preview in an aria-live region and forwards the typed patch to onApplyDraft', async () => {
    enableTuning()
    const captured: AlertRuleDraftPatch[] = []
    const onApplyDraft = vi.fn((p: AlertRuleDraftPatch) => {
      captured.push(p)
    })
    installStreamingFetch(
      proposalBody({
        value_num: 15,
        cooldown_min: 30,
        severity: 'warn',
        trigger_mode: 'repeat',
        op: '<',
      }),
    )

    render(<AIAlertTuningSuggestions ruleId={42} onApplyDraft={onApplyDraft} />)

    // No proposal + no Apply button until a tool_result lands.
    expect(screen.queryByTestId(PREVIEW_TESTID)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Apply to form/i }),
    ).not.toBeInTheDocument()

    await clickSuggest()

    // Preview shows up as a status live region carrying the scalars.
    const preview = await screen.findByTestId(PREVIEW_TESTID)
    expect(preview).toHaveAttribute('role', 'status')
    expect(preview).toHaveTextContent(/value_num: 15/)
    expect(preview).toHaveTextContent(/cooldown_min: 30/)

    const apply = screen.getByRole('button', { name: /Apply to form/i })
    await waitFor(() => expect(apply).toBeEnabled())
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
    expect(captured[0]).toEqual({
      value_num: 15,
      cooldown_min: 30,
      severity: 'warn',
      trigger_mode: 'repeat',
      op: '<',
    })
  })

  it('drops fields that fail type validation and keeps only the valid scalars', async () => {
    enableTuning()
    const onApplyDraft = vi.fn()
    installStreamingFetch(
      proposalBody({
        value_min: 10,
        value_max: 90,
        cooldown_min: 'not-a-number', // rejected (non-number)
        severity: '', // rejected (empty string)
        trigger_mode: 'once',
        op: '>',
        value_num: null, // rejected (not a number)
      }),
    )

    render(<AIAlertTuningSuggestions ruleId={42} onApplyDraft={onApplyDraft} />)
    await clickSuggest()

    const preview = await screen.findByTestId(PREVIEW_TESTID)
    expect(preview).toHaveTextContent(/value_min: 10/)
    expect(preview).toHaveTextContent(/value_max: 90/)
    expect(preview).not.toHaveTextContent(/severity/)
    expect(preview).not.toHaveTextContent(/cooldown_min/)
    expect(preview).not.toHaveTextContent(/value_num/)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply to form/i }))
    })
    expect(onApplyDraft).toHaveBeenCalledWith({
      value_min: 10,
      value_max: 90,
      trigger_mode: 'once',
      op: '>',
    })
  })

  it('captures value_num: 0 (falsy but valid) instead of dropping it', async () => {
    enableTuning()
    const onApplyDraft = vi.fn()
    installStreamingFetch(proposalBody({ value_num: 0 }))

    render(<AIAlertTuningSuggestions ruleId={42} onApplyDraft={onApplyDraft} />)
    await clickSuggest()

    const preview = await screen.findByTestId(PREVIEW_TESTID)
    expect(preview).toHaveTextContent(/value_num: 0/)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply to form/i }))
    })
    expect(onApplyDraft).toHaveBeenCalledWith({ value_num: 0 })
  })

  it('does not surface a proposal when every proposed field is invalid (empty-patch guard)', async () => {
    enableTuning()
    installStreamingFetch(
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_alert_rule_patch',
        ok: true,
        data: {
          status: 'ok',
          proposed: {
            value_num: 'nope', // string
            severity: '', // empty
            cooldown_min: null, // null
          },
        },
      }) +
        sseFrame('delta', { text: 'No safe tuning change recommended.' }) +
        sseFrame('done', { finish_reason: 'stop', usage: { in: 5, out: 2 } }),
    )

    render(<AIAlertTuningSuggestions ruleId={42} onApplyDraft={vi.fn()} />)
    await clickSuggest()

    // The stream still rendered its narrative...
    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /No safe tuning change recommended/,
      ),
    )
    // ...but no empty preview panel / no-op Apply button leaked in.
    expect(screen.queryByTestId(PREVIEW_TESTID)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Apply to form/i }),
    ).not.toBeInTheDocument()
  })

  it.each([
    [
      'wrong tool name',
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'some_other_tool',
        ok: true,
        data: { status: 'ok', proposed: { value_num: 15 } },
      }),
    ],
    [
      'ok=false',
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_alert_rule_patch',
        ok: false,
        data: { status: 'ok', proposed: { value_num: 15 } },
      }),
    ],
    [
      'status != ok',
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_alert_rule_patch',
        ok: true,
        data: { status: 'skipped', proposed: { value_num: 15 } },
      }),
    ],
  ])('ignores a tool_result frame with %s', async (_label, frame) => {
    enableTuning()
    installStreamingFetch(
      frame + sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    )

    render(<AIAlertTuningSuggestions ruleId={42} onApplyDraft={vi.fn()} />)
    await clickSuggest()

    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId(PREVIEW_TESTID)).not.toBeInTheDocument()
  })
})

describe('AIAlertTuningSuggestions — ruleId change resets captured state', () => {
  it('clears a captured proposal when the ruleId prop changes', async () => {
    enableTuning()
    const onApplyDraft = vi.fn()
    installStreamingFetch(proposalBody({ value_num: 15, cooldown_min: 30 }))

    const { rerender } = render(
      <AIAlertTuningSuggestions ruleId={42} onApplyDraft={onApplyDraft} />,
    )
    await clickSuggest()
    await screen.findByTestId(PREVIEW_TESTID)

    // Selecting a different rule must not carry the old proposal over.
    rerender(<AIAlertTuningSuggestions ruleId={99} onApplyDraft={onApplyDraft} />)

    expect(screen.queryByTestId(PREVIEW_TESTID)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Apply to form/i }),
    ).not.toBeInTheDocument()
  })
})
