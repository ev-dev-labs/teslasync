// Auto-name unnamed locations AI-off contract test.
//
// `TestAutoNameLocationsAIOffManualNamingWorks` is the React-side
// AI-off contract proof. It mounts AIAutoNameUnnamedLocations with
// ai_mode='off' plus the per-feature toggle on, then asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND auto-name-unnamed-locations=true,
//      the section IS present + carries the expected test ID.
//      This is the positive control that proves the gate
//      actually works (otherwise the "absent in off mode"
//      assertion is trivially true).
//
// Also asserts the on-mode wiring contract:
//   - clicking "Suggest name" POSTs exactly one request to
//     `/api/v1/ai/locations/501/name/draft`.
//   - the first delta event's text renders inside the gated
//     wrapper.
//   - a second click while streaming is a no-op (double-submit
//     guard).
//   - the proposal card renders after a tool_result frame and
//     clicking "Apply to form" calls onApplyName with the
//     proposed string (proves the typed envelope → baseline form
//     copy path; the AI panel never persists state directly).
//
// The HTTP /api/v1/ai/locations/{locationID}/name/draft 404-in-off-
// mode invariant is proven by the Go-side
// TestAutoNameLocationsAIOffManualNamingWorks in
// internal/api/ai_auto_name_unnamed_locations_handler_test.go —
// the network layer does not exist in the React unit-test scope.
//
// File name MUST stay
// `TestAutoNameLocationsAIOffManualNamingWorks.test.tsx` because
// Vitest's positional pattern is matched against the file path.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIAutoNameUnnamedLocations } from '@/components/ai/AIAutoNameUnnamedLocations'

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

describe('TestAutoNameLocationsAIOffManualNamingWorks (auto-name-unnamed-locations AI-off contract)', () => {
  it('TestAutoNameLocationsAIOffManualNamingWorks: renders nothing when ai_mode=off even with the auto-name-unnamed-locations toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'auto-name-unnamed-locations': true },
      }),
    )

    const { container } = render(
      <AIAutoNameUnnamedLocations
        locationId={501}
        currentName="47.6062,-122.3321"
        onApplyName={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByTestId('ai-feature-auto-name-unnamed-locations-root'),
    ).not.toBeInTheDocument()
  })

  it('TestAutoNameLocationsAIOffManualNamingWorks: renders nothing when ai_mode is non-off but the auto-name-unnamed-locations toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'auto-name-unnamed-locations': false },
      }),
    )

    const { container } = render(
      <AIAutoNameUnnamedLocations
        locationId={501}
        currentName="47.6062,-122.3321"
        onApplyName={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByTestId('ai-feature-auto-name-unnamed-locations-root'),
    ).not.toBeInTheDocument()
  })

  it('TestAutoNameLocationsAIOffManualNamingWorks: renders the section when ai_mode=cloud AND auto-name-unnamed-locations toggle is on (positive control)', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'auto-name-unnamed-locations': true },
      }),
    )

    render(
      <AIAutoNameUnnamedLocations
        locationId={501}
        currentName="47.6062,-122.3321"
        onApplyName={vi.fn()}
      />,
    )
    const root = screen.getByTestId(
      'ai-feature-auto-name-unnamed-locations-root',
    )
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'auto-name-unnamed-locations',
    )
  })
})

describe('TestAutoNameUnnamedLocationsAIOnWiredCallsRoute (auto-name-unnamed-locations on-mode SPA wiring)', () => {
  it('TestAutoNameUnnamedLocationsAIOnWiredCallsRoute: clicking Suggest POSTs once to /api/v1/ai/locations/501/name/draft and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'auto-name-unnamed-locations': true },
      }),
    )

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text: 'I drafted "Frequent Stop — South Lake Union" based on the visit pattern.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(
      <AIAutoNameUnnamedLocations
        locationId={501}
        currentName="47.6062,-122.3321"
        onApplyName={vi.fn()}
      />,
    )

    const root = screen.getByTestId(
      'ai-feature-auto-name-unnamed-locations-root',
    )
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'auto-name-unnamed-locations',
    )

    const button = screen.getByRole('button', { name: /Suggest name/i })
    expect(button).toBeInTheDocument()
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe('/api/v1/ai/locations/501/name/draft')
    expect(init?.method).toBe('POST')
    expect(typeof init?.body).toBe('string')
    const parsedBody = JSON.parse(init?.body as string)
    expect(parsedBody).toEqual({})
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => {
      expect(root).toHaveTextContent(
        /I drafted "Frequent Stop — South Lake Union"/,
      )
    })
  })

  it('TestAutoNameUnnamedLocationsAIOnWiredCallsRoute: suggest button is disabled when locationId is non-positive (computed disabled, never literal)', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'auto-name-unnamed-locations': true },
      }),
    )

    render(
      <AIAutoNameUnnamedLocations
        locationId={0}
        onApplyName={vi.fn()}
      />,
    )
    const button = screen.getByRole('button', { name: /Suggest name/i })
    expect(button).toBeDisabled()
  })

  it('TestAutoNameUnnamedLocationsAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'auto-name-unnamed-locations': true },
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
      <AIAutoNameUnnamedLocations
        locationId={501}
        onApplyName={vi.fn()}
      />,
    )

    const button = screen.getByRole('button', { name: /Suggest name/i })

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

  it('TestAutoNameUnnamedLocationsAIOnWiredCallsRoute: tool_result draft envelope renders the proposal card and Apply calls onApplyName with the proposed name', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'auto-name-unnamed-locations': true },
      }),
    )

    const onApplyName = vi.fn()

    const draftEnvelope = {
      location_id: 501,
      proposed_name: 'Frequent Stop — South Lake Union',
      status: 'ok',
      reason: 'High visit_count and stable dwell pattern at this coordinate.',
    }

    const sseBody =
      sseFrame('tool_call', {
        id: 'tc1',
        name: 'draft_location_name',
        arguments: {
          location_id: 501,
          proposed_name: 'Frequent Stop — South Lake Union',
        },
      }) +
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_location_name',
        ok: true,
        data: draftEnvelope,
      }) +
      sseFrame('delta', {
        text: 'Drafted "Frequent Stop — South Lake Union".',
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
      <AIAutoNameUnnamedLocations
        locationId={501}
        currentName="47.6062,-122.3321"
        onApplyName={onApplyName}
      />,
    )

    const suggest = screen.getByRole('button', { name: /Suggest name/i })
    await act(async () => {
      fireEvent.click(suggest)
    })

    await waitFor(() => {
      expect(
        screen.getByTestId('ai-feature-auto-name-unnamed-locations-draft'),
      ).toBeInTheDocument()
    })

    // Proposal text should render inside the draft card.
    expect(
      screen.getByTestId('ai-feature-auto-name-unnamed-locations-draft'),
    ).toHaveTextContent(/Frequent Stop — South Lake Union/)

    // Apply to form should hand the proposed name back to the
    // baseline form via the onApplyName callback. The AI panel
    // never persists state itself.
    const apply = screen.getByTestId(
      'ai-feature-auto-name-unnamed-locations-apply',
    )
    expect(apply).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyName).toHaveBeenCalledWith('Frequent Stop — South Lake Union')
    expect(onApplyName).toHaveBeenCalledTimes(1)
  })

  it('TestAutoNameUnnamedLocationsAIOnWiredCallsRoute: rejected envelope shows the rejected label, disables Apply, and never invokes onApplyName', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'auto-name-unnamed-locations': true },
      }),
    )

    const onApplyName = vi.fn()
    const rejectedEnvelope = {
      location_id: 501,
      proposed_name: '',
      status: 'rejected',
      reason: 'location name must not be empty',
    }
    const sseBody =
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_location_name',
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
      <AIAutoNameUnnamedLocations
        locationId={501}
        onApplyName={onApplyName}
      />,
    )
    const suggest = screen.getByRole('button', { name: /Suggest name/i })
    await act(async () => {
      fireEvent.click(suggest)
    })

    await waitFor(() => {
      expect(
        screen.getByTestId('ai-feature-auto-name-unnamed-locations-draft'),
      ).toBeInTheDocument()
    })
    const apply = screen.getByTestId(
      'ai-feature-auto-name-unnamed-locations-apply',
    )
    expect(apply).toBeDisabled()
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyName).not.toHaveBeenCalled()
  })
})
