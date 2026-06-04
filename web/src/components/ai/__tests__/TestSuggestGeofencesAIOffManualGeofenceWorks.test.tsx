// Suggest new geofences.
//
// `TestSuggestGeofencesAIOffManualGeofenceWorks` (the Vitest sibling
// to the Go test of the same name) is the React-side AI-OFF contract
// proof. It mounts the
// AISuggestNewGeofences component with ai_mode='off' (plus the
// per-feature toggle on, to defeat the obvious "off because
// nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND suggest-new-geofences=true, the
//      section IS present + carries the expected test ID. This is
//      the positive control that proves the gate actually works
//      (otherwise the "absent in off mode" assertion is trivially
//      true).
//
// Also asserts the on-mode wiring contract:
//   - clicking "Suggest geofence" POSTs exactly one request to
//     `/api/v1/ai/geofences/draft` with `{"location_id": 501}`.
//   - the first delta event's text renders inside the gated
//     wrapper.
//   - the suggest button is disabled (computed) when locationId
//     is non-positive.
//   - a second click while streaming is a no-op (double-submit
//     guard).
//   - the proposal card renders after a tool_result frame and
//     clicking "Apply to form" calls onApplyDraft with the
//     proposed name + radius + centroid (proves the typed
//     envelope → baseline form copy path; the AI panel never
//     persists state directly).
//
// The HTTP /api/v1/ai/geofences/draft 404-in-off-mode invariant
// is proven by the Go-side TestSuggestGeofencesAIOffManualGeofenceWorks
// in internal/api/ai_suggest_new_geofences_handler_test.go — the
// network layer does not exist in the React unit-test scope.
//
// File name MUST stay
// `TestSuggestGeofencesAIOffManualGeofenceWorks.test.tsx` — the
// verification command runs
// `vitest --run TestSuggestGeofencesAIOffManualGeofenceWorks`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AISuggestNewGeofences } from '@/components/ai/AISuggestNewGeofences'

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

describe('TestSuggestGeofencesAIOffManualGeofenceWorks (suggest-new-geofences AI-off contract)', () => {
  it('TestSuggestGeofencesAIOffManualGeofenceWorks: renders nothing when ai_mode=off even with the suggest-new-geofences toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'suggest-new-geofences': true },
      }),
    )

    const { container } = render(
      <AISuggestNewGeofences
        locationId={501}
        currentName="47.6062,-122.3321"
        onApplyDraft={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByTestId('ai-feature-suggest-new-geofences-root'),
    ).not.toBeInTheDocument()
  })

  it('TestSuggestGeofencesAIOffManualGeofenceWorks: renders nothing when ai_mode is non-off but the suggest-new-geofences toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'suggest-new-geofences': false },
      }),
    )

    const { container } = render(
      <AISuggestNewGeofences
        locationId={501}
        currentName="47.6062,-122.3321"
        onApplyDraft={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByTestId('ai-feature-suggest-new-geofences-root'),
    ).not.toBeInTheDocument()
  })

  it('TestSuggestGeofencesAIOffManualGeofenceWorks: renders the section when ai_mode=cloud AND suggest-new-geofences toggle is on (positive control)', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'suggest-new-geofences': true },
      }),
    )

    render(
      <AISuggestNewGeofences
        locationId={501}
        currentName="47.6062,-122.3321"
        onApplyDraft={vi.fn()}
      />,
    )
    const root = screen.getByTestId('ai-feature-suggest-new-geofences-root')
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'suggest-new-geofences')
  })
})

describe('TestSuggestNewGeofencesAIOnWiredCallsRoute (suggest-new-geofences on-mode SPA wiring)', () => {
  it('TestSuggestNewGeofencesAIOnWiredCallsRoute: clicking Suggest POSTs once to /api/v1/ai/geofences/draft with the location_id and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'suggest-new-geofences': true },
      }),
    )

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text: 'I drafted "Frequent Stop — South Lake Union" with a 150-meter radius based on the visit pattern.',
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
      <AISuggestNewGeofences
        locationId={501}
        currentName="47.6062,-122.3321"
        onApplyDraft={vi.fn()}
      />,
    )

    const root = screen.getByTestId('ai-feature-suggest-new-geofences-root')
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'suggest-new-geofences')

    const button = screen.getByRole('button', { name: /Suggest geofence/i })
    expect(button).toBeInTheDocument()
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe('/api/v1/ai/geofences/draft')
    expect(init?.method).toBe('POST')
    expect(typeof init?.body).toBe('string')
    const parsedBody = JSON.parse(init?.body as string)
    expect(parsedBody).toEqual({ location_id: 501 })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => {
      expect(root).toHaveTextContent(
        /I drafted "Frequent Stop — South Lake Union"/,
      )
    })
  })

  it('TestSuggestNewGeofencesAIOnWiredCallsRoute: suggest button is disabled when locationId is non-positive (computed disabled, never literal)', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'suggest-new-geofences': true },
      }),
    )

    render(
      <AISuggestNewGeofences locationId={0} onApplyDraft={vi.fn()} />,
    )
    const button = screen.getByRole('button', { name: /Suggest geofence/i })
    expect(button).toBeDisabled()
  })

  it('TestSuggestNewGeofencesAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'suggest-new-geofences': true },
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
      <AISuggestNewGeofences locationId={501} onApplyDraft={vi.fn()} />,
    )

    const button = screen.getByRole('button', { name: /Suggest geofence/i })

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

  it('TestSuggestNewGeofencesAIOnWiredCallsRoute: tool_result draft envelope renders the proposal card and Apply calls onApplyDraft with the typed envelope', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'suggest-new-geofences': true },
      }),
    )

    const onApplyDraft = vi.fn()

    const draftEnvelope = {
      draft: {
        location_id: 501,
        vehicle_id: 7,
        proposed_name: 'Frequent Stop — South Lake Union',
        radius_m: 150,
        centroid_lat: 47.6062,
        centroid_lon: -122.3321,
        evidence: {
          current_address_name: '47.6062, -122.3321',
          visit_count: 12,
          total_duration_s: 129600,
          last_visited_at: '2024-10-14T18:30:00Z',
          first_visited_at: '2024-07-15T09:00:00Z',
        },
      },
      status: 'ok',
      source: 'validator: AISuggestGeofenceValidator',
    }

    const sseBody =
      sseFrame('tool_call', {
        id: 'tc1',
        name: 'draft_geofence',
        arguments: {
          location_id: 501,
          proposed_name: 'Frequent Stop — South Lake Union',
          radius_m: 150,
        },
      }) +
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_geofence',
        ok: true,
        data: draftEnvelope,
      }) +
      sseFrame('delta', {
        text: 'Drafted "Frequent Stop — South Lake Union" at 150 m.',
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
      <AISuggestNewGeofences
        locationId={501}
        currentName="47.6062,-122.3321"
        onApplyDraft={onApplyDraft}
      />,
    )

    const suggest = screen.getByRole('button', { name: /Suggest geofence/i })
    await act(async () => {
      fireEvent.click(suggest)
    })

    await waitFor(() => {
      expect(
        screen.getByTestId('ai-feature-suggest-new-geofences-draft'),
      ).toBeInTheDocument()
    })

    // Proposal text + radius should render inside the draft card.
    const draftCard = screen.getByTestId(
      'ai-feature-suggest-new-geofences-draft',
    )
    expect(draftCard).toHaveTextContent(/Frequent Stop — South Lake Union/)
    expect(draftCard).toHaveTextContent(/150 m/)

    // Apply to form should hand the typed envelope back to the
    // baseline form via the onApplyDraft callback. The AI panel
    // never persists state itself.
    const apply = screen.getByTestId('ai-feature-suggest-new-geofences-apply')
    expect(apply).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyDraft).toHaveBeenCalledWith({
      name: 'Frequent Stop — South Lake Union',
      latitude: 47.6062,
      longitude: -122.3321,
      radius: 150,
    })
    expect(onApplyDraft).toHaveBeenCalledTimes(1)
  })

  it('TestSuggestNewGeofencesAIOnWiredCallsRoute: invalid envelope shows the rejected label, disables Apply, and never invokes onApplyDraft', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'suggest-new-geofences': true },
      }),
    )

    const onApplyDraft = vi.fn()
    const rejectedEnvelope = {
      draft: {
        location_id: 501,
        vehicle_id: 7,
        proposed_name: '',
        radius_m: 150,
        centroid_lat: 0,
        centroid_lon: 0,
        evidence: {
          current_address_name: '',
          visit_count: 0,
          total_duration_s: 0,
        },
      },
      status: 'invalid',
      validation_error: 'geofence name must not be empty',
      source: 'validator: AISuggestGeofenceValidator',
    }
    const sseBody =
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_geofence',
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
      <AISuggestNewGeofences locationId={501} onApplyDraft={onApplyDraft} />,
    )
    const suggest = screen.getByRole('button', { name: /Suggest geofence/i })
    await act(async () => {
      fireEvent.click(suggest)
    })

    await waitFor(() => {
      expect(
        screen.getByTestId('ai-feature-suggest-new-geofences-draft'),
      ).toBeInTheDocument()
    })
    const apply = screen.getByTestId('ai-feature-suggest-new-geofences-apply')
    expect(apply).toBeDisabled()
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyDraft).not.toHaveBeenCalled()
  })
})
