// Phase-50 / 0039 — G3 Geofence-aware automation suggestions.
//
// `TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks` (the
// Vitest sibling to the Go test of the same name) is the slice's
// load-bearing AI-OFF contract proof on the React side. It mounts
// the AIGeofenceAwareAutomationSuggestions component with
// ai_mode='off' (plus the per-feature toggle on, to defeat the
// obvious "off because nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND
//      geofence-aware-automation-suggestions=true, the section IS
//      present + carries the expected test ID. This is the positive
//      control that proves the gate actually works (otherwise the
//      "absent in off mode" assertion is trivially true).
//
// W1 inline wiring — also asserts the on-mode wiring contract:
//   - clicking "Suggest automation" POSTs exactly one request to
//     `/api/v1/ai/geofences/automations/draft` with
//     `{"vehicle_id": 7, "prompt": "..."}`.
//   - the first delta event's text renders inside the gated wrapper.
//   - the suggest button is disabled (computed) when vehicleId is
//     non-positive OR the prompt is empty.
//   - a second click while streaming is a no-op (double-submit
//     guard).
//   - the proposal card renders after a tool_result frame and
//     clicking "Apply to form" calls onApplyDraft with the proposed
//     typed Automation envelope (proves the typed envelope →
//     baseline form copy path; the AI panel never persists state
//     directly).
//
// The HTTP /api/v1/ai/geofences/automations/draft 404-in-off-mode
// invariant is proven by the Go-side
// TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks in
// internal/api/ai_geofence_aware_automation_handler_test.go — the
// network layer does not exist in the React unit-test scope.
//
// File name MUST stay
// `TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks.test.tsx`
// — the slice prompt's verification command runs
// `vitest --run TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIGeofenceAwareAutomationSuggestions } from '@/components/ai/AIGeofenceAwareAutomationSuggestions'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

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

beforeEach(() => {
  mockUseSettings.mockReset()
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks (geofence-aware-automation-suggestions AI-off contract)', () => {
  it('TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks: renders nothing when ai_mode=off even with the geofence-aware-automation-suggestions toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'geofence-aware-automation-suggestions': true },
      }),
    )

    const { container } = render(
      <AIGeofenceAwareAutomationSuggestions
        vehicleId={7}
        onApplyDraft={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByTestId('ai-feature-geofence-aware-automation-suggestions-root'),
    ).not.toBeInTheDocument()
  })

  it('TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks: renders nothing when ai_mode is non-off but the geofence-aware-automation-suggestions toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'geofence-aware-automation-suggestions': false },
      }),
    )

    const { container } = render(
      <AIGeofenceAwareAutomationSuggestions
        vehicleId={7}
        onApplyDraft={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByTestId('ai-feature-geofence-aware-automation-suggestions-root'),
    ).not.toBeInTheDocument()
  })

  it('TestGeofenceAutomationSuggestionsAIOffManualAutomationWorks: renders the section when ai_mode=cloud AND geofence-aware-automation-suggestions toggle is on (positive control)', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'geofence-aware-automation-suggestions': true },
      }),
    )

    render(
      <AIGeofenceAwareAutomationSuggestions
        vehicleId={7}
        onApplyDraft={vi.fn()}
      />,
    )
    const root = screen.getByTestId(
      'ai-feature-geofence-aware-automation-suggestions-root',
    )
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'geofence-aware-automation-suggestions',
    )
  })
})

describe('TestGeofenceAwareAutomationSuggestionsAIOnWiredCallsRoute (geofence-aware-automation-suggestions on-mode SPA wiring)', () => {
  it('TestGeofenceAwareAutomationSuggestionsAIOnWiredCallsRoute: clicking Suggest POSTs once to /api/v1/ai/geofences/automations/draft with the vehicle_id+prompt and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'geofence-aware-automation-suggestions': true },
      }),
    )

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text: 'I drafted "Welcome Home" using your Home geofence.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(
      <AIGeofenceAwareAutomationSuggestions
        vehicleId={7}
        onApplyDraft={vi.fn()}
      />,
    )

    const root = screen.getByTestId(
      'ai-feature-geofence-aware-automation-suggestions-root',
    )
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'geofence-aware-automation-suggestions',
    )

    // Type a prompt so the computed-disabled gate opens.
    const promptInput = screen.getByTestId(
      'ai-feature-geofence-aware-automation-suggestions-prompt',
    )
    fireEvent.change(promptInput, {
      target: { value: 'precondition cabin when I leave home on weekdays' },
    })

    const button = screen.getByRole('button', { name: /Suggest automation/i })
    expect(button).toBeInTheDocument()
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe('/api/v1/ai/geofences/automations/draft')
    expect(init?.method).toBe('POST')
    expect(typeof init?.body).toBe('string')
    const parsedBody = JSON.parse(init?.body as string)
    expect(parsedBody).toEqual({
      vehicle_id: 7,
      prompt: 'precondition cabin when I leave home on weekdays',
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => {
      expect(root).toHaveTextContent(/I drafted "Welcome Home"/)
    })
  })

  it('TestGeofenceAwareAutomationSuggestionsAIOnWiredCallsRoute: suggest button is disabled when vehicleId is non-positive (computed disabled, never literal)', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'geofence-aware-automation-suggestions': true },
      }),
    )

    render(
      <AIGeofenceAwareAutomationSuggestions vehicleId={0} onApplyDraft={vi.fn()} />,
    )
    // Even with a non-empty prompt, vehicleId<=0 keeps disabled.
    const promptInput = screen.getByTestId(
      'ai-feature-geofence-aware-automation-suggestions-prompt',
    )
    fireEvent.change(promptInput, { target: { value: 'do something' } })
    const button = screen.getByRole('button', { name: /Suggest automation/i })
    expect(button).toBeDisabled()
  })

  it('TestGeofenceAwareAutomationSuggestionsAIOnWiredCallsRoute: suggest button is disabled when prompt is empty (computed disabled, never literal)', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'geofence-aware-automation-suggestions': true },
      }),
    )

    render(
      <AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />,
    )
    // No prompt typed → button should stay disabled even with a
    // valid vehicleId.
    const button = screen.getByRole('button', { name: /Suggest automation/i })
    expect(button).toBeDisabled()
  })

  it('TestGeofenceAwareAutomationSuggestionsAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'geofence-aware-automation-suggestions': true },
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
      <AIGeofenceAwareAutomationSuggestions vehicleId={7} onApplyDraft={vi.fn()} />,
    )

    const promptInput = screen.getByTestId(
      'ai-feature-geofence-aware-automation-suggestions-prompt',
    )
    fireEvent.change(promptInput, { target: { value: 'do thing' } })

    const button = screen.getByRole('button', { name: /Suggest automation/i })

    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))

    await waitFor(() => expect(button).toBeDisabled())
    await act(async () => {
      fireEvent.click(button)
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })

  it('TestGeofenceAwareAutomationSuggestionsAIOnWiredCallsRoute: tool_result draft envelope renders the proposal card and Apply calls onApplyDraft with the typed envelope', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'geofence-aware-automation-suggestions': true },
      }),
    )

    const onApplyDraft = vi.fn()

    const automationDraft = {
      name: 'Welcome Home',
      description: 'Turn on cabin overheat protection when arriving home',
      vehicle_id: 7,
      enabled: true,
      triggers: [
        {
          kind: 'trigger_geofence' as const,
          place_id: 1,
          on_event: 'enter' as const,
        },
      ],
      conditions: [],
      actions: [
        {
          kind: 'action_command' as const,
          command_name: 'cabin_overheat_protection_on',
          params: null,
        },
      ],
    }

    const draftEnvelope = {
      draft: automationDraft,
      status: 'ok',
      source: 'validator: AutomationFullInputDecoder',
    }

    const sseBody =
      sseFrame('tool_call', {
        id: 'tc1',
        name: 'draft_automation_graph',
        arguments: {
          vehicle_id: 7,
          name: 'Welcome Home',
        },
      }) +
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_automation_graph',
        ok: true,
        data: draftEnvelope,
      }) +
      sseFrame('delta', {
        text: 'Drafted "Welcome Home" anchored to your Home geofence.',
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
      <AIGeofenceAwareAutomationSuggestions
        vehicleId={7}
        onApplyDraft={onApplyDraft}
      />,
    )

    const promptInput = screen.getByTestId(
      'ai-feature-geofence-aware-automation-suggestions-prompt',
    )
    fireEvent.change(promptInput, { target: { value: 'arrive home automation' } })

    const suggest = screen.getByRole('button', { name: /Suggest automation/i })
    await act(async () => {
      fireEvent.click(suggest)
    })

    await waitFor(() => {
      expect(
        screen.getByTestId('ai-feature-geofence-aware-automation-suggestions-draft'),
      ).toBeInTheDocument()
    })

    // Proposal text + counts should render inside the draft card.
    const draftCard = screen.getByTestId(
      'ai-feature-geofence-aware-automation-suggestions-draft',
    )
    expect(draftCard).toHaveTextContent(/Welcome Home/)
    expect(draftCard).toHaveTextContent(/Turn on cabin overheat protection/)

    // Apply to form should hand the typed envelope back to the
    // baseline form via the onApplyDraft callback. The AI panel
    // never persists state itself.
    const apply = screen.getByTestId(
      'ai-feature-geofence-aware-automation-suggestions-apply',
    )
    expect(apply).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyDraft).toHaveBeenCalledWith(automationDraft)
    expect(onApplyDraft).toHaveBeenCalledTimes(1)
  })

  it('TestGeofenceAwareAutomationSuggestionsAIOnWiredCallsRoute: invalid envelope shows the rejected label, disables Apply, and never invokes onApplyDraft', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'geofence-aware-automation-suggestions': true },
      }),
    )

    const onApplyDraft = vi.fn()
    const rejectedEnvelope = {
      draft: {
        name: '',
        description: '',
        vehicle_id: 7,
        enabled: true,
        triggers: [],
        conditions: [],
        actions: [],
      },
      status: 'invalid',
      validation_error: 'automation must have at least one action',
      source: 'validator: AutomationFullInputDecoder',
    }
    const sseBody =
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_automation_graph',
        ok: true,
        data: rejectedEnvelope,
      }) +
      sseFrame('delta', {
        text: 'The proposal failed validation.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 80, out: 20 } })

    globalThis.fetch = vi.fn(
      async () =>
        new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ) as unknown as typeof globalThis.fetch

    render(
      <AIGeofenceAwareAutomationSuggestions
        vehicleId={7}
        onApplyDraft={onApplyDraft}
      />,
    )
    const promptInput = screen.getByTestId(
      'ai-feature-geofence-aware-automation-suggestions-prompt',
    )
    fireEvent.change(promptInput, { target: { value: 'incomplete request' } })

    const suggest = screen.getByRole('button', { name: /Suggest automation/i })
    await act(async () => {
      fireEvent.click(suggest)
    })

    await waitFor(() => {
      expect(
        screen.getByTestId('ai-feature-geofence-aware-automation-suggestions-draft'),
      ).toBeInTheDocument()
    })
    const apply = screen.getByTestId(
      'ai-feature-geofence-aware-automation-suggestions-apply',
    )
    expect(apply).toBeDisabled()
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyDraft).not.toHaveBeenCalled()
  })
})
