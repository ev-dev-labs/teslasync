// Co-located unit + wiring test for AISuggestNewGeofences.
//
// The module exports three symbols:
//   - the `parseGeofenceDraft(data)` pure helper that narrows the
//     untyped `tool_result.data` wire payload into a typed
//     GeofenceDraft (or null on anything malformed),
//   - the `GeofenceDraft` / `AISuggestNewGeofencesProps` interfaces
//     (type-only — exercised through the component below), and
//   - the `withAiFeature('suggest-new-geofences', InnerSection)` gated
//     component that renders the Helix "suggest a geofence" panel.
//
// This suite covers every observable facet so the file can be marked
// production-grade:
//
//   1. parseGeofenceDraft — every branch: a fully-typed ok/invalid
//      envelope round-trips, and every malformed shape (null, non-
//      object, missing draft, wrong-typed field, absent status) yields
//      null so a bad provider frame can never corrupt the panel.
//
//   2. Render gate (ADR-015): the surface is entirely absent when
//      ai_mode='off', the per-feature toggle is off, ai_features is
//      undefined, or settings are unresolved; present (with the
//      registered `-root` test id) only when the mode is on AND the
//      toggle is true. Both 'cloud' and 'local' non-off modes render.
//
//   3. Surface structure + a11y: heading, propose-only description,
//      "Helix" badge, optional current-label context, and a single
//      Suggest control whose disabled state is a COMPUTED expression
//      (enabled at idle when locationId > 0, disabled when non-
//      positive) mirrored by aria-disabled — never a literal disabled.
//
//   4. On-mode SSE wiring: clicking Suggest POSTs exactly once to the
//      registered route /api/v1/ai/geofences/draft with a
//      {"location_id": N} JSON body + SSE headers, shows the thinking
//      indicator, renders the delta text, coalesces a double submit,
//      surfaces a stream error, and re-runs after completion. A
//      tool_result draft_geofence envelope is captured into an
//      aria-labelledby proposal group; "Apply to form" hands the typed
//      envelope back through onApplyDraft (never persisting directly);
//      an invalid envelope disables Apply; frames for other tools or a
//      failed tool_result never populate the panel.
//
// Network is stubbed at the `fetch` boundary — the same pattern the
// sibling wiring tests use; no real request is ever made.
// @testing-library/user-event is intentionally NOT a dependency of this
// codebase (see web/package.json), so interactions use fireEvent.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import {
  AISuggestNewGeofences,
  parseGeofenceDraft,
} from '@/components/ai/AISuggestNewGeofences'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-suggest-new-geofences-root'
const DRAFT_TESTID = 'ai-feature-suggest-new-geofences-draft'
const APPLY_TESTID = 'ai-feature-suggest-new-geofences-apply'
const SUGGEST_TESTID = 'ai-feature-suggest-new-geofences-suggest'
const FEATURE_ID = 'suggest-new-geofences'
const ROUTE = '/api/v1/ai/geofences/draft'
const SUGGEST_NAME = /Suggest geofence/i
const TITLE = /Suggest a geofence for this location/i
const DESCRIPTION = /Propose a typed geofence draft/i

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
    ai_features: { [FEATURE_ID]: true },
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

// A canonical valid on-the-wire draft envelope (the *geofenceDraftOutput
// shape). Tests spread + override individual fields.
function draftEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    draft: {
      location_id: 501,
      vehicle_id: 7,
      proposed_name: 'Frequent Stop — South Lake Union',
      radius_m: 150,
      centroid_lat: 47.6062,
      centroid_lon: -122.3321,
    },
    status: 'ok',
    ...overrides,
  }
}

// mountEnabled renders the fully-enabled surface with sane defaults.
function mountEnabled(
  props: Partial<{
    locationId: number
    currentName?: string
    onApplyDraft: (d: {
      name: string
      latitude: number
      longitude: number
      radius: number
    }) => void
  }> = {},
) {
  const onApplyDraft = props.onApplyDraft ?? vi.fn()
  const utils = render(
    <AISuggestNewGeofences
      locationId={props.locationId ?? 501}
      currentName={props.currentName}
      onApplyDraft={onApplyDraft}
    />,
  )
  return { ...utils, onApplyDraft }
}

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

describe('parseGeofenceDraft — defensive wire-shape narrowing', () => {
  it('returns a typed draft for a well-formed ok envelope (validation_error omitted → undefined)', () => {
    const result = parseGeofenceDraft(draftEnvelope())

    expect(result).toEqual({
      location_id: 501,
      vehicle_id: 7,
      proposed_name: 'Frequent Stop — South Lake Union',
      radius_m: 150,
      centroid_lat: 47.6062,
      centroid_lon: -122.3321,
      status: 'ok',
      validation_error: undefined,
    })
  })

  it('preserves the status and validation_error for a rejected envelope', () => {
    const result = parseGeofenceDraft(
      draftEnvelope({
        status: 'invalid',
        validation_error: 'geofence name must not be empty',
      }),
    )

    expect(result?.status).toBe('invalid')
    expect(result?.validation_error).toBe('geofence name must not be empty')
  })

  it('ignores a non-string validation_error (falls back to undefined)', () => {
    const result = parseGeofenceDraft(draftEnvelope({ validation_error: 42 }))

    expect(result).not.toBeNull()
    expect(result?.validation_error).toBeUndefined()
  })

  it('returns null for null, undefined, and non-object payloads', () => {
    expect(parseGeofenceDraft(null)).toBeNull()
    expect(parseGeofenceDraft(undefined)).toBeNull()
    expect(parseGeofenceDraft('draft')).toBeNull()
    expect(parseGeofenceDraft(150)).toBeNull()
  })

  it('returns null when the inner draft envelope is missing', () => {
    expect(parseGeofenceDraft({ status: 'ok' })).toBeNull()
  })

  it('returns null when a required numeric field has the wrong type', () => {
    expect(
      parseGeofenceDraft(
        draftEnvelope({ draft: { ...draftEnvelope().draft, radius_m: '150' } }),
      ),
    ).toBeNull()
    expect(
      parseGeofenceDraft(
        draftEnvelope({
          draft: { ...draftEnvelope().draft, centroid_lat: null },
        }),
      ),
    ).toBeNull()
  })

  it('returns null when proposed_name is not a string', () => {
    expect(
      parseGeofenceDraft(
        draftEnvelope({
          draft: { ...draftEnvelope().draft, proposed_name: 123 },
        }),
      ),
    ).toBeNull()
  })

  it('returns null when status is absent or not a string', () => {
    const { draft } = draftEnvelope()
    expect(parseGeofenceDraft({ draft })).toBeNull()
    expect(parseGeofenceDraft({ draft, status: 7 })).toBeNull()
  })
})

describe('AISuggestNewGeofences — AI-off render gate', () => {
  it('renders nothing when ai_mode=off even with the suggest-new-geofences toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { [FEATURE_ID]: true } }),
    )

    const { container } = mountEnabled({ currentName: '47.6062,-122.3321' })

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: SUGGEST_NAME }),
    ).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is off even with ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { [FEATURE_ID]: false },
      }),
    )

    const { container } = mountEnabled()

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_features is entirely absent (undefined map)', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: undefined }),
    )

    const { container } = mountEnabled()

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing while settings are still unresolved (settings undefined)', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = mountEnabled()

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) when ai_mode=cloud AND the toggle is on', () => {
    mockUseSettings.mockReturnValue(enabled())

    mountEnabled({ currentName: '47.6062,-122.3321' })

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: SUGGEST_NAME }),
    ).toBeInTheDocument()
  })

  it('also renders under ai_mode=local (local mode is a non-off mode)', () => {
    mockUseSettings.mockReturnValue(enabled({ ai_mode: 'local' }))

    mountEnabled()

    expect(screen.getByTestId(ROOT_TESTID)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: SUGGEST_NAME }),
    ).toBeInTheDocument()
  })
})

describe('AISuggestNewGeofences — enabled surface structure + a11y', () => {
  it('renders the heading, description, Helix badge, and an idle-enabled Suggest button', () => {
    mockUseSettings.mockReturnValue(enabled())

    mountEnabled()

    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument()
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument()
    expect(screen.getAllByText('Helix').length).toBeGreaterThan(0)

    // The action button is enabled at idle (locationId > 0, no stream)
    // and its disabled state is a COMPUTED expression mirrored by
    // aria-disabled — never a literal `disabled` (W1 Rule A).
    const button = screen.getByRole('button', { name: SUGGEST_NAME })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    expect(button).toHaveAttribute('data-testid', SUGGEST_TESTID)
    // Visible label is the universal Helix CTA; the per-feature verb
    // lives in the tooltip + accessible name.
    expect(button).toHaveTextContent(/Ask Helix/i)
    expect(button).toHaveAttribute('title', expect.stringMatching(SUGGEST_NAME))
  })

  it('disables the Suggest button (computed) when locationId is non-positive', () => {
    mockUseSettings.mockReturnValue(enabled())

    mountEnabled({ locationId: 0 })

    const button = screen.getByRole('button', { name: SUGGEST_NAME })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('surfaces the current label context when currentName is supplied', () => {
    mockUseSettings.mockReturnValue(enabled())

    mountEnabled({ currentName: '47.6062,-122.3321' })

    expect(screen.getByText(/Current label/i)).toBeInTheDocument()
    expect(screen.getByText('47.6062,-122.3321')).toBeInTheDocument()
  })

  it('omits the current label context when currentName is not provided', () => {
    mockUseSettings.mockReturnValue(enabled())

    mountEnabled()

    expect(screen.queryByText(/Current label/i)).not.toBeInTheDocument()
  })

  it('shows neither an output panel nor a proposal card before any run', () => {
    mockUseSettings.mockReturnValue(enabled())

    mountEnabled()

    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument()
  })
})

describe('AISuggestNewGeofences — on-mode SSE wiring', () => {
  it('POSTs once to the registered route with a {location_id} body + SSE headers and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(enabled())

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const proposalText =
      'I drafted "Frequent Stop — South Lake Union" with a 150-meter radius.'
    const sseBody =
      sseFrame('delta', { text: proposalText }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } })
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init })
        return new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
    ) as unknown as typeof globalThis.fetch

    mountEnabled({ locationId: 501 })

    const root = screen.getByTestId(ROOT_TESTID)
    const button = screen.getByRole('button', { name: SUGGEST_NAME })
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe(ROUTE)
    expect(init?.method).toBe('POST')
    expect(typeof init?.body).toBe('string')
    // The location_id rides the JSON body, not the URL — the backend
    // route has no path parameter (snake_case key, matching Go).
    expect(JSON.parse(init?.body as string)).toEqual({ location_id: 501 })

    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => expect(root).toHaveTextContent(proposalText))
  })

  it('shows the thinking indicator and disables the button while the stream is open', async () => {
    mockUseSettings.mockReturnValue(enabled())

    globalThis.fetch = vi.fn(async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // Never enqueue, never close — keeps state='streaming'.
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    mountEnabled()

    const button = screen.getByRole('button', { name: SUGGEST_NAME })
    await act(async () => {
      fireEvent.click(button)
    })

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
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // Never enqueue, never close — keeps state='streaming'.
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    mountEnabled()

    const button = screen.getByRole('button', { name: SUGGEST_NAME })
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))
    await waitFor(() => expect(button).toBeDisabled())

    await act(async () => {
      // fireEvent bypasses the disabled attribute, exercising the
      // component's isBusy guard + the hook's runningRef coalescer.
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

    mountEnabled()

    const button = screen.getByRole('button', { name: SUGGEST_NAME })
    await act(async () => {
      fireEvent.click(button)
    })

    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent('stream_http_404')
    // The error must not fabricate a proposal card.
    expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument()
  })

  it('captures a tool_result draft into an aria-labelledby group; Apply hands the typed envelope to onApplyDraft', async () => {
    mockUseSettings.mockReturnValue(enabled())

    const sseBody =
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_geofence',
        ok: true,
        data: draftEnvelope(),
      }) +
      sseFrame('delta', { text: 'Drafted the proposal at 150 m.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 100, out: 30 } })

    globalThis.fetch = vi.fn(
      async () =>
        new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ) as unknown as typeof globalThis.fetch

    const { onApplyDraft } = mountEnabled({ locationId: 501 })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SUGGEST_NAME }))
    })

    const card = await screen.findByTestId(DRAFT_TESTID)
    expect(card).toHaveTextContent(/Frequent Stop — South Lake Union/)
    expect(card).toHaveTextContent(/150 m/)
    // The card is an a11y group labelled by its "Proposed geofence"
    // heading so screen readers announce the async proposal region.
    expect(card).toHaveAttribute('role', 'group')
    expect(
      screen.getByRole('group', { name: /Proposed geofence/i }),
    ).toBe(card)

    const apply = screen.getByTestId(APPLY_TESTID)
    expect(apply).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(apply)
    })

    // The centroid + radius are mapped into the baseline form shape;
    // the AI panel never writes to the API itself.
    expect(onApplyDraft).toHaveBeenCalledTimes(1)
    expect(onApplyDraft).toHaveBeenCalledWith({
      name: 'Frequent Stop — South Lake Union',
      latitude: 47.6062,
      longitude: -122.3321,
      radius: 150,
    })
  })

  it('shows the rejected label, disables Apply, and never invokes onApplyDraft for an invalid envelope', async () => {
    mockUseSettings.mockReturnValue(enabled())

    const sseBody =
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_geofence',
        ok: true,
        data: draftEnvelope({
          draft: { ...draftEnvelope().draft, proposed_name: '' },
          status: 'invalid',
          validation_error: 'geofence name must not be empty',
        }),
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 80, out: 20 } })

    globalThis.fetch = vi.fn(
      async () =>
        new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ) as unknown as typeof globalThis.fetch

    const { onApplyDraft } = mountEnabled({ locationId: 501 })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SUGGEST_NAME }))
    })

    const card = await screen.findByTestId(DRAFT_TESTID)
    expect(card).toHaveTextContent(/Proposal rejected by validator/i)
    expect(card).toHaveTextContent(/geofence name must not be empty/)
    // Empty proposed_name falls back to a placeholder rather than a
    // blank line.
    expect(card).toHaveTextContent(/\(unnamed\)/)

    const apply = screen.getByTestId(APPLY_TESTID)
    expect(apply).toBeDisabled()
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyDraft).not.toHaveBeenCalled()
  })

  it('ignores a tool_result for a different tool and a failed tool_result (no proposal card)', async () => {
    mockUseSettings.mockReturnValue(enabled())

    const sseBody =
      // Wrong tool name — must be dropped.
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'validate_geofence',
        ok: true,
        data: draftEnvelope(),
      }) +
      // Correct tool but ok=false — must be dropped.
      sseFrame('tool_result', {
        id: 'tc2',
        name: 'draft_geofence',
        ok: false,
        error: 'tool failed',
      }) +
      sseFrame('delta', { text: 'No usable proposal was produced.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 5 } })

    globalThis.fetch = vi.fn(
      async () =>
        new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ) as unknown as typeof globalThis.fetch

    mountEnabled({ locationId: 501 })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SUGGEST_NAME }))
    })

    // The stream still renders its delta text, but no proposal card is
    // captured from either dropped frame.
    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent('No usable proposal was produced.')
    expect(screen.queryByTestId(DRAFT_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByTestId(APPLY_TESTID)).not.toBeInTheDocument()
  })

  it('resets a captured proposal and replaces it when the user suggests again', async () => {
    mockUseSettings.mockReturnValue(enabled())

    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      const name = fetchCount === 1 ? 'First Draft Place' : 'Second Draft Place'
      const sseBody =
        sseFrame('tool_result', {
          id: `tc${fetchCount}`,
          name: 'draft_geofence',
          ok: true,
          data: draftEnvelope({
            draft: { ...draftEnvelope().draft, proposed_name: name },
          }),
        }) +
        sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 5 } })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    mountEnabled({ locationId: 501 })
    const button = screen.getByRole('button', { name: SUGGEST_NAME })

    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() =>
      expect(screen.getByTestId(DRAFT_TESTID)).toHaveTextContent(
        'First Draft Place',
      ),
    )

    // After `done`, the button re-enables so a follow-up suggest fires
    // a fresh POST and the previous proposal is cleared before the new
    // one arrives.
    await waitFor(() => expect(button).not.toBeDisabled())
    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(fetchCount).toBe(2))
    await waitFor(() =>
      expect(screen.getByTestId(DRAFT_TESTID)).toHaveTextContent(
        'Second Draft Place',
      ),
    )
    expect(screen.getByTestId(DRAFT_TESTID)).not.toHaveTextContent(
      'First Draft Place',
    )
  })
})
