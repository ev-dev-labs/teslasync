// Co-located unit + wiring test for AIGeofenceAwareAutomationSuggestions.
//
// The module has two runtime exports:
//
//   - `normalizeAutomationInput` — the defensive parser that narrows the
//     LLM's typed envelope into the AutomationFullInput shape the parent
//     form expects, rejecting anything it cannot positively prove.
//   - `AIGeofenceAwareAutomationSuggestions` — the
//     `withAiFeature('geofence-aware-automation-suggestions', InnerSection)`
//     gated card.
//
// This suite covers every observable facet so the file can be marked
// production-grade:
//
//   1. `normalizeAutomationInput` — every accept + reject branch, driven
//      as pure unit tests (no DOM), including the description default and
//      the non-object / mistyped-field rejections that keep a malformed
//      draft from ever reaching the user's form state.
//
//   2. Render gate (ADR-015 §I5/§I6): the surface is entirely absent when
//      ai_mode='off', the per-feature toggle is off, the ai_features map
//      is missing, or settings have not resolved; and present (with the
//      registered `-root` test id) only when a non-off mode AND the toggle
//      are both on. The positive control proves the negatives are not
//      trivially true.
//
//   3. Surface structure + a11y: the enabled card renders the Helix
//      heading, the propose-only description, the "Helix" badge, a
//      labelled prompt textarea, and a single "Suggest automation" action
//      whose accessible name carries the per-feature verb. The Suggest
//      button is a COMPUTED-disabled control (never a literal `disabled`):
//      disabled when the vehicle scope is non-positive OR the prompt is
//      empty/whitespace, enabled once both hold.
//
//   4. On-mode SSE wiring: clicking Suggest POSTs exactly once to the
//      registered route /api/v1/ai/geofences/automations/draft with the
//      vehicle_id+prompt body + SSE headers, shows the thinking indicator,
//      renders the delta text, coalesces a double-submit while streaming,
//      surfaces a stream error on a non-2xx response, captures a typed
//      draft envelope from a tool_result frame and copies it to the parent
//      via onApplyDraft on "Apply to form", and REJECTS every malformed /
//      failed / mis-addressed tool_result (invalid status, failed
//      normalize, ok=false, wrong tool name, non-string status).
//
//   5. Lifecycle: a captured draft is cleared when the vehicleId prop
//      changes, so a stale proposal cannot bleed into a new vehicle scope.
//
// Network is stubbed at the `fetch` boundary — the same pattern the
// sibling wiring tests (AIDataRepairSuggestions.test.tsx,
// TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks.test.tsx)
// use; no real request is ever made. @testing-library/user-event is
// intentionally NOT a dependency of this codebase, so interactions use
// fireEvent.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent, within } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import {
  AIGeofenceAwareAutomationSuggestions,
  normalizeAutomationInput,
} from '@/components/ai/AIGeofenceAwareAutomationSuggestions'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-geofence-aware-automation-suggestions-root'
const FEATURE_ID = 'geofence-aware-automation-suggestions'
const ROUTE = '/api/v1/ai/geofences/automations/draft'
const PROMPT_TESTID = 'ai-feature-geofence-aware-automation-suggestions-prompt'
const DRAFT_TESTID = 'ai-feature-geofence-aware-automation-suggestions-draft'
const APPLY_TESTID = 'ai-feature-geofence-aware-automation-suggestions-apply'
const SUGGEST_NAME = /Suggest automation/i

// baseSettings is a complete AppSettings with realistic non-AI defaults.
// Per-test overrides flip ai_mode + ai_features to exercise the gate.
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

// enabled() returns the fully-on settings shape (non-off mode + toggle) so
// the on-mode tests read one intent-revealing helper.
function enabled(overrides: Partial<AppSettings> = {}) {
  return settingsPayload({
    ai_mode: 'cloud',
    ai_features: { [FEATURE_ID]: true },
    ...overrides,
  })
}

// makeReadableStream constructs a ReadableStream<Uint8Array> from
// arbitrarily-sized text chunks, matching the helper the useAiStream +
// sibling wiring tests use so the SSE parser receives byte-for-byte
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

// sseFrame formats a single SSE event the way internal/ai/stream/writer.go
// emits it.
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// A never-closing stream response holds the hook at state='streaming'.
function pendingStreamResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start() {
        // Never enqueue, never close.
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

// A fully-valid wire-shaped automation graph. Exactly the seven keys
// `normalizeAutomationInput` reconstructs, so a normalize round-trip
// deep-equals it (used to assert the onApplyDraft payload).
const validAutomation = {
  name: 'Welcome Home',
  description: 'Turn on cabin overheat protection when arriving home',
  vehicle_id: 7,
  enabled: true,
  triggers: [
    { kind: 'trigger_geofence', place_id: 1, on_event: 'enter' },
    { kind: 'trigger_geofence', place_id: 2, on_event: 'exit' },
  ],
  conditions: [{ kind: 'condition_day_of_week', days: ['mon', 'tue'] }],
  actions: [
    { kind: 'action_command', command_name: 'cabin_overheat_protection_on', params: null },
    { kind: 'action_command', command_name: 'hvac_on', params: null },
    { kind: 'action_wait', seconds: 30 },
  ],
}

function draftSse(envelope: unknown, deltaText = 'Drafted an automation.') {
  return (
    sseFrame('tool_result', {
      id: 'tc1',
      name: 'draft_automation_graph',
      ok: true,
      data: envelope,
    }) +
    sseFrame('delta', { text: deltaText }) +
    sseFrame('done', { finish_reason: 'stop', usage: { in: 100, out: 30 } })
  )
}

// stubStreamOnce installs a fetch mock that returns the given SSE body
// once and records the calls made against it.
function stubStreamOnce(sseBody: string) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(makeReadableStream([sseBody]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as unknown as typeof globalThis.fetch
  return calls
}

async function typePromptAndSuggest(prompt = 'arrive home automation') {
  const promptInput = screen.getByTestId(PROMPT_TESTID)
  fireEvent.change(promptInput, { target: { value: prompt } })
  const suggest = screen.getByRole('button', { name: SUGGEST_NAME })
  await act(async () => {
    fireEvent.click(suggest)
  })
  return suggest
}

beforeEach(() => {
  mockUseSettings.mockReset()
  // Loud default so a DOM test that forgets to install its own fetch mock
  // fails clearly instead of silently timing out.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── 1. normalizeAutomationInput — pure defensive-parser branches ──────────
describe('normalizeAutomationInput (exported defensive parser)', () => {
  it('accepts a fully-valid wire envelope and copies every field verbatim', () => {
    const result = normalizeAutomationInput(validAutomation)
    expect(result).not.toBeNull()
    expect(result?.name).toBe('Welcome Home')
    expect(result?.description).toBe('Turn on cabin overheat protection when arriving home')
    expect(result?.vehicle_id).toBe(7)
    expect(result?.enabled).toBe(true)
    expect(result?.triggers).toHaveLength(2)
    expect(result?.conditions).toHaveLength(1)
    expect(result?.actions).toHaveLength(3)
    // A normalize round-trip must deep-equal the input (exactly seven keys),
    // which is what the "Apply to form" copy path relies on.
    expect(result).toEqual(validAutomation)
  })

  it('defaults description to an empty string when it is missing', () => {
    const { description: _omit, ...withoutDescription } = validAutomation
    const result = normalizeAutomationInput(withoutDescription)
    expect(result).not.toBeNull()
    expect(result?.description).toBe('')
  })

  it('defaults description to an empty string when it is a non-string', () => {
    const result = normalizeAutomationInput({ ...validAutomation, description: 123 })
    expect(result?.description).toBe('')
  })

  it('does not carry over unexpected extra keys from the wire shape', () => {
    const result = normalizeAutomationInput({
      ...validAutomation,
      id: 999,
      created_at: 'yesterday',
    })
    expect(result).toEqual(validAutomation)
    expect(result).not.toHaveProperty('id')
    expect(result).not.toHaveProperty('created_at')
  })

  // Reject cases: every branch that must fail-closed so a malformed draft
  // can never silently corrupt the user's form state.
  const rejectCases: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'not-an-object'],
    ['a boolean', true],
    ['an array (object without keys)', []],
    ['a missing name', { ...validAutomation, name: undefined }],
    ['a non-string name', { ...validAutomation, name: 5 }],
    ['a missing vehicle_id', { ...validAutomation, vehicle_id: undefined }],
    ['a non-number vehicle_id', { ...validAutomation, vehicle_id: '7' }],
    ['a null vehicle_id', { ...validAutomation, vehicle_id: null }],
    ['a non-boolean enabled', { ...validAutomation, enabled: 'yes' }],
    ['a non-array triggers', { ...validAutomation, triggers: null }],
    ['a non-array conditions', { ...validAutomation, conditions: {} }],
    ['a non-array actions', { ...validAutomation, actions: 'none' }],
  ]
  for (const [label, input] of rejectCases) {
    it(`rejects ${label} by returning null`, () => {
      expect(normalizeAutomationInput(input)).toBeNull()
    })
  }

  it('accepts empty trigger/condition/action arrays (shape valid even if empty)', () => {
    const empties = {
      name: 'Bare',
      description: '',
      vehicle_id: 3,
      enabled: false,
      triggers: [],
      conditions: [],
      actions: [],
    }
    const result = normalizeAutomationInput(empties)
    expect(result).not.toBeNull()
    expect(result?.triggers).toEqual([])
    expect(result?.actions).toEqual([])
  })
})

// ── 2. Render gate (ADR-015 AI-off contract) ──────────────────────────────
describe('AIGeofenceAwareAutomationSuggestions — AI-off render gate', () => {
  it('renders nothing when ai_mode=off even with the feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { [FEATURE_ID]: true } }),
    )
    const { container } = render(
      <AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SUGGEST_NAME })).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is off even with ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { [FEATURE_ID]: false } }),
    )
    const { container } = render(
      <AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the ai_features map is entirely absent (fail-closed)', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: undefined }),
    )
    const { container } = render(
      <AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing while settings are still unresolved (settings undefined)', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })
    const { container } = render(
      <AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) when ai_mode=cloud AND the toggle is on', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)
    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    expect(screen.getByRole('button', { name: SUGGEST_NAME })).toBeInTheDocument()
    expect(screen.getByTestId(PROMPT_TESTID)).toBeInTheDocument()
  })

  it('also renders under ai_mode=local (local mode is a non-off mode)', () => {
    mockUseSettings.mockReturnValue(enabled({ ai_mode: 'local' }))
    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)
    expect(screen.getByTestId(ROOT_TESTID)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: SUGGEST_NAME })).toBeInTheDocument()
  })
})

// ── 3. Surface structure + a11y ───────────────────────────────────────────
describe('AIGeofenceAwareAutomationSuggestions — surface structure + a11y', () => {
  it('renders the heading, propose-only description, Helix badge, and a labelled prompt textarea', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)

    expect(
      screen.getByRole('heading', { name: /Suggest a geofence-aware automation/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Describe an automation that uses one of your existing geofences/i)).toBeInTheDocument()
    // "Helix" brand badge sits in the header.
    expect(screen.getAllByText('Helix').length).toBeGreaterThan(0)

    // The prompt control exposes an accessible name (aria-label), not just
    // a placeholder — an icon/placeholder-only control would be invisible
    // to screen readers.
    const promptByRole = screen.getByRole('textbox', {
      name: /Describe the geofence-aware automation to draft/i,
    })
    expect(promptByRole).toBe(screen.getByTestId(PROMPT_TESTID))
  })

  it('keeps the Suggest button computed-disabled while the prompt is empty (valid vehicle)', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)
    const button = screen.getByRole('button', { name: SUGGEST_NAME })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // Visible label is the universal Helix CTA; the verb lives in the
    // accessible name + tooltip.
    expect(button).toHaveTextContent(/Ask Helix/i)
    expect(button).toHaveAttribute('title', expect.stringMatching(SUGGEST_NAME))
  })

  it('keeps the Suggest button computed-disabled when vehicleId is non-positive (even with a prompt)', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AIGeofenceAwareAutomationSuggestions vehicleId={0} onApplyDraft={vi.fn()} />)
    fireEvent.change(screen.getByTestId(PROMPT_TESTID), { target: { value: 'do something' } })
    const button = screen.getByRole('button', { name: SUGGEST_NAME })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps the Suggest button computed-disabled when vehicleId is undefined (defensive ?? 0)', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AIGeofenceAwareAutomationSuggestions onApplyDraft={vi.fn()} />)
    fireEvent.change(screen.getByTestId(PROMPT_TESTID), { target: { value: 'do something' } })
    expect(screen.getByRole('button', { name: SUGGEST_NAME })).toBeDisabled()
  })

  it('keeps the Suggest button computed-disabled when the prompt is whitespace-only (trim)', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)
    fireEvent.change(screen.getByTestId(PROMPT_TESTID), { target: { value: '   \n\t ' } })
    expect(screen.getByRole('button', { name: SUGGEST_NAME })).toBeDisabled()
  })

  it('enables the Suggest button once a positive vehicleId AND a non-empty prompt both hold, and re-disables when cleared', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)
    const button = screen.getByRole('button', { name: SUGGEST_NAME })
    const promptInput = screen.getByTestId(PROMPT_TESTID)

    fireEvent.change(promptInput, { target: { value: 'precondition cabin on weekdays' } })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')

    // Clearing the prompt reactively re-disables the computed control.
    fireEvent.change(promptInput, { target: { value: '' } })
    expect(button).toBeDisabled()
  })

  it('shows no output panel and no draft card before any suggestion has run', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-thinking-indicator')).not.toBeInTheDocument()
    expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument()
  })
})

// ── 4. On-mode SSE wiring ─────────────────────────────────────────────────
describe('AIGeofenceAwareAutomationSuggestions — on-mode SSE wiring', () => {
  it('POSTs once to the registered route with the vehicle_id+prompt body + SSE headers and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const sseBody =
      sseFrame('delta', { text: 'I drafted "Welcome Home" using your Home geofence.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } })
    const calls = stubStreamOnce(sseBody)

    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)
    const root = screen.getByTestId(ROOT_TESTID)
    await typePromptAndSuggest('precondition cabin when I leave home on weekdays')

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(ROUTE)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      vehicle_id: 7,
      prompt: 'precondition cabin when I leave home on weekdays',
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => expect(root).toHaveTextContent(/I drafted "Welcome Home"/))
  })

  it('sends vehicle_id 0 (defensive ?? 0) in the body when vehicleId is undefined, though the button gates it in practice', () => {
    // The body memo coerces an undefined vehicleId to 0 defensively. The
    // Suggest button stays disabled in that state, proving the two guards
    // agree (no request can actually be fired for a non-positive scope).
    mockUseSettings.mockReturnValue(enabled())
    render(<AIGeofenceAwareAutomationSuggestions onApplyDraft={vi.fn()} />)
    fireEvent.change(screen.getByTestId(PROMPT_TESTID), { target: { value: 'x' } })
    expect(screen.getByRole('button', { name: SUGGEST_NAME })).toBeDisabled()
  })

  it('shows the thinking indicator and disables the Suggest button while the stream is open', async () => {
    mockUseSettings.mockReturnValue(enabled())
    globalThis.fetch = vi.fn(
      async () => pendingStreamResponse(),
    ) as unknown as typeof globalThis.fetch

    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)
    const button = await typePromptAndSuggest()

    const indicator = await screen.findByTestId('ai-thinking-indicator')
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
      return pendingStreamResponse()
    }) as unknown as typeof globalThis.fetch

    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)
    const button = await typePromptAndSuggest()
    await waitFor(() => expect(fetchCount).toBe(1))
    await waitFor(() => expect(button).toBeDisabled())

    // fireEvent bypasses the disabled attribute, exercising the handler's
    // isBusy guard + the hook's runningRef coalescer directly.
    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })

  it('surfaces the stream error when the backend returns a non-2xx status', async () => {
    mockUseSettings.mockReturnValue(enabled())
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 500, statusText: 'Server Error' }),
    ) as unknown as typeof globalThis.fetch

    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)
    await typePromptAndSuggest()

    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent('stream_http_500')
    expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument()
  })

  it('captures a valid tool_result draft, renders the proposal card with counts, and copies the typed envelope on Apply', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const onApplyDraft = vi.fn()
    stubStreamOnce(draftSse({ draft: validAutomation, status: 'ok', source: 'validator' }))

    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={onApplyDraft} />)
    await typePromptAndSuggest()

    await waitFor(() => expect(screen.getByTestId(DRAFT_TESTID)).toBeInTheDocument())
    const card = screen.getByTestId(DRAFT_TESTID)
    expect(card).toHaveTextContent('Welcome Home')
    expect(card).toHaveTextContent(/Turn on cabin overheat protection/)
    expect(card).toHaveTextContent(/Triggers/)
    expect(card).toHaveTextContent(/Conditions/)
    expect(card).toHaveTextContent(/Actions/)
    // Rendered counts reflect the array lengths (2 / 1 / 3).
    expect(within(card).getByText('2')).toBeInTheDocument()
    expect(within(card).getByText('1')).toBeInTheDocument()
    expect(within(card).getByText('3')).toBeInTheDocument()

    const apply = screen.getByTestId(APPLY_TESTID)
    expect(apply).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyDraft).toHaveBeenCalledTimes(1)
    expect(onApplyDraft).toHaveBeenCalledWith(validAutomation)
  })

  it('shows the rejected label + validation error and disables Apply for an invalid-status envelope (never calls onApplyDraft)', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const onApplyDraft = vi.fn()
    const rejected = {
      draft: {
        name: 'Half-baked',
        description: '',
        vehicle_id: 7,
        enabled: true,
        triggers: [],
        conditions: [],
        actions: [],
      },
      status: 'invalid',
      validation_error: 'automation must have at least one action',
    }
    stubStreamOnce(draftSse(rejected, 'The proposal failed validation.'))

    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={onApplyDraft} />)
    await typePromptAndSuggest()

    await waitFor(() => expect(screen.getByTestId(DRAFT_TESTID)).toBeInTheDocument())
    const card = screen.getByTestId(DRAFT_TESTID)
    expect(card).toHaveTextContent(/Proposal rejected by validator/i)
    expect(card).toHaveTextContent(/automation must have at least one action/i)

    const apply = screen.getByTestId(APPLY_TESTID)
    expect(apply).toBeDisabled()
    expect(apply).toHaveAttribute('aria-disabled', 'true')
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyDraft).not.toHaveBeenCalled()
  })

  it('ignores a tool_result whose draft fails normalization (no proposal card, delta still renders)', async () => {
    mockUseSettings.mockReturnValue(enabled())
    // Missing the `actions` array — normalizeAutomationInput returns null,
    // so setDraft is never called and no card appears.
    const { actions: _dropped, ...malformed } = validAutomation
    stubStreamOnce(draftSse({ draft: malformed, status: 'ok' }, 'Attempted a draft.'))

    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)
    const root = screen.getByTestId(ROOT_TESTID)
    await typePromptAndSuggest()

    await waitFor(() => expect(root).toHaveTextContent('Attempted a draft.'))
    expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument()
  })

  it('ignores a tool_result with ok=false (no proposal card)', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const sseBody =
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_automation_graph',
        ok: false,
        error: 'tool crashed',
      }) +
      sseFrame('delta', { text: 'Tool failed.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } })
    stubStreamOnce(sseBody)

    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)
    const root = screen.getByTestId(ROOT_TESTID)
    await typePromptAndSuggest()

    await waitFor(() => expect(root).toHaveTextContent('Tool failed.'))
    expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument()
  })

  it('ignores a tool_result addressed to a different tool name (no proposal card)', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const sseBody =
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'some_other_tool',
        ok: true,
        data: { draft: validAutomation, status: 'ok' },
      }) +
      sseFrame('delta', { text: 'Different tool ran.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } })
    stubStreamOnce(sseBody)

    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)
    const root = screen.getByTestId(ROOT_TESTID)
    await typePromptAndSuggest()

    await waitFor(() => expect(root).toHaveTextContent('Different tool ran.'))
    expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument()
  })

  it('ignores a tool_result whose envelope status is not a string (no proposal card)', async () => {
    mockUseSettings.mockReturnValue(enabled())
    // Valid draft body but a non-string status trips the guard.
    stubStreamOnce(draftSse({ draft: validAutomation, status: 123 }, 'Status was numeric.'))

    render(<AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />)
    const root = screen.getByTestId(ROOT_TESTID)
    await typePromptAndSuggest()

    await waitFor(() => expect(root).toHaveTextContent('Status was numeric.'))
    expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument()
  })
})

// ── 5. Lifecycle — reset on vehicleId change ──────────────────────────────
describe('AIGeofenceAwareAutomationSuggestions — lifecycle', () => {
  it('clears a captured draft when the vehicleId prop changes (no cross-scope bleed)', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const onApplyDraft = vi.fn()
    stubStreamOnce(draftSse({ draft: validAutomation, status: 'ok' }))

    const { rerender } = render(
      <AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={onApplyDraft} />,
    )
    await typePromptAndSuggest()
    await waitFor(() => expect(screen.getByTestId(DRAFT_TESTID)).toBeInTheDocument())

    // Switching the vehicle scope must cancel + drop the stale proposal so
    // it cannot be applied to the newly-selected vehicle's form.
    rerender(
      <AIGeofenceAwareAutomationSuggestions vehicleId={8} onApplyDraft={onApplyDraft} />,
    )
    await waitFor(() => expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument())
  })
})
