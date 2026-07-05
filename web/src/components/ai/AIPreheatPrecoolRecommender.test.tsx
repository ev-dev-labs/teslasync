// Comprehensive unit + behaviour coverage for
// AIPreheatPrecoolRecommender — the co-located Project Apex elevation
// test.
//
// The component has a single runtime export:
// `AIPreheatPrecoolRecommender` (an InnerSection wrapped with
// withAiFeature). It is a propose-only surface: the Draft button opens
// an SSE stream against the registered `/api/v1/ai/climate/schedule/draft`
// route and accumulates the narration into the shared AiOutputPanel —
// it never persists a schedule. So the facets worth exercising are:
//
//   - the ADR-015 AI-off visibility gate (off-mode, per-feature toggle
//     off, the fail-closed unresolved-settings branch, and the positive
//     control that proves the gate is real);
//   - the FOUR-way input gate: the Draft button's `disabled` is a
//     COMPUTED expression derived from
//     `haveInputs = haveVehicle && haveDepart && haveCabin && haveOutside`,
//     never a literal `disabled`. This is proved across a matrix of
//     absent / zero / negative / NaN / non-numeric-string ids, absent /
//     empty / null depart timestamps, and absent / null / NaN cabin +
//     outside temperatures, plus the empty-state hint that explains the
//     disabled button;
//   - the SSE wiring contract (exactly one POST to the registered route
//     with the correct method / headers and the full
//     `{ vehicle_id, depart_by, current_cabin_temp_c, outside_temp_c,
//     target_cabin_temp_c }` body, the numeric-string coercion path, the
//     21°C target default, and the falsy-but-valid 0°C temperature edge);
//   - the streaming lifecycle (thinking indicator + disabled button
//     while in flight, double-submit guard, HTTP-error + error-frame
//     fallbacks rendered in AiOutputPanel); and
//   - the stable public surface (displayName).
//
// Network is mocked with a hand-rolled ReadableStream emitting the SSE
// frames internal/ai/stream/writer.go produces — the same convention
// the sibling feature tests use. No real network is touched.
// @testing-library/user-event is intentionally NOT a dependency of this
// codebase (see web/package.json), so interactions use fireEvent.click,
// consistent with every other AI feature test. react-i18next returns
// the English fallback (2nd arg) with no provider mounted, so
// assertions read the defaults.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIPreheatPrecoolRecommender } from '@/components/ai/AIPreheatPrecoolRecommender'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-preheat-precool-recommender-root'
const DRAFT_ROUTE = '/api/v1/ai/climate/schedule/draft'
const EMPTY_HINT =
  'Select a vehicle and confirm the cabin temperature, outside temperature, and departure time to draft a schedule.'
const DEPART_BY = '2099-01-02T07:30:00Z'

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

// enableFeature flips the gate fully on: ai_mode != off AND the
// per-feature toggle true. Most on-mode tests below start here.
function enableFeature() {
  mockUseSettings.mockReturnValue(
    settingsPayload({
      ai_mode: 'cloud',
      ai_features: { 'preheat-precool-recommender': true },
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

// installNeverClosingFetch keeps every stream open (never enqueues,
// never closes) so the component stays in `state='streaming'` and
// counts how many times fetch was invoked.
function installNeverClosingFetch(): { count: () => number } {
  let fetchCount = 0
  globalThis.fetch = vi.fn(async () => {
    fetchCount += 1
    return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as unknown as typeof globalThis.fetch
  return { count: () => fetchCount }
}

function draftButton(): HTMLElement {
  return screen.getByRole('button', { name: /Draft schedule/i })
}

async function clickDraft(): Promise<HTMLElement> {
  const btn = draftButton()
  await act(async () => {
    fireEvent.click(btn)
  })
  return btn
}

// A complete, valid set of props: a positive vehicle id, both
// temperatures, a target, and a departure timestamp — the state in
// which the Draft button is enabled.
const fullProps = {
  vehicleId: 42,
  currentCabinTempC: 4,
  outsideTempC: -2,
  targetCabinTempC: 21,
  departBy: DEPART_BY,
} as const

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

describe('AIPreheatPrecoolRecommender — AI-off visibility gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the per-feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'preheat-precool-recommender': true },
      }),
    )

    const { container } = render(<AIPreheatPrecoolRecommender {...fullProps} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Draft schedule/i }),
    ).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode!=off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'preheat-precool-recommender': false },
      }),
    )

    const { container } = render(<AIPreheatPrecoolRecommender {...fullProps} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing (fail-closed) when the settings query has not resolved', () => {
    // useAiEnabled returns false for an unresolved settings object; the
    // gate must fail closed rather than briefly flashing the AI surface.
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(<AIPreheatPrecoolRecommender {...fullProps} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) with title, badge and an enabled button when both mode and toggle are on', () => {
    enableFeature()

    render(<AIPreheatPrecoolRecommender {...fullProps} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'preheat-precool-recommender')

    // The deterministic title + badge copy renders.
    expect(
      screen.getByText('Suggest a preheat or precool schedule'),
    ).toBeInTheDocument()
    expect(screen.getByText('Helix')).toBeInTheDocument()

    // The Draft button is enabled (all inputs in scope, idle stream) and
    // exposes the per-feature verb through its accessible name.
    const button = draftButton()
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    const ariaLabel = button.getAttribute('aria-label') ?? ''
    expect(ariaLabel).toContain('Ask Helix')
    expect(ariaLabel).toContain('Draft schedule')

    // Idle: no output panel yet, and no empty hint (all inputs ARE in
    // scope) — proves both conditional branches.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument()
  })
})

describe('AIPreheatPrecoolRecommender — input gate (computed disabled + empty state)', () => {
  it.each([
    ['vehicleId', { vehicleId: undefined }],
    ['departBy', { departBy: undefined }],
    ['currentCabinTempC', { currentCabinTempC: undefined }],
    ['outsideTempC', { outsideTempC: undefined }],
  ])(
    'disables the Draft button and shows the empty-state hint when %s is missing',
    (_label, override) => {
      enableFeature()

      render(<AIPreheatPrecoolRecommender {...fullProps} {...override} />)

      const button = draftButton()
      expect(button).toBeDisabled()
      // The disabled attribute is mirrored by aria-disabled (W1 Rule A:
      // computed, screen-reader-visible disabled state).
      expect(button).toHaveAttribute('aria-disabled', 'true')
      // The empty hint explains WHY the button is disabled instead of
      // leaving a bare, unexplained control.
      expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
    },
  )

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
    ['non-numeric string', 'not-a-vehicle'],
    ['empty string', ''],
  ])(
    'keeps the Draft button disabled for an invalid vehicleId (%s)',
    (_label, id) => {
      enableFeature()

      render(<AIPreheatPrecoolRecommender {...fullProps} vehicleId={id} />)

      expect(draftButton()).toBeDisabled()
      expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
    },
  )

  it.each([
    ['empty string', ''],
    ['null', null],
  ])(
    'keeps the Draft button disabled for an invalid departBy (%s)',
    (_label, depart) => {
      enableFeature()

      render(<AIPreheatPrecoolRecommender {...fullProps} departBy={depart} />)

      expect(draftButton()).toBeDisabled()
    },
  )

  it.each([
    ['cabin null', { currentCabinTempC: null }],
    ['cabin NaN', { currentCabinTempC: Number.NaN }],
    ['outside null', { outsideTempC: null }],
    ['outside NaN', { outsideTempC: Number.NaN }],
  ])(
    'keeps the Draft button disabled for a non-finite temperature (%s)',
    (_label, override) => {
      enableFeature()

      render(<AIPreheatPrecoolRecommender {...fullProps} {...override} />)

      expect(draftButton()).toBeDisabled()
    },
  )

  it('does not open a stream when the (disabled) button is clicked without inputs', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(<AIPreheatPrecoolRecommender />)

    await act(async () => {
      fireEvent.click(draftButton())
    })
    // Give any rogue fetch a macrotask to land.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(0)
  })

  it('enables the Draft button once all inputs resolve via rerender', () => {
    enableFeature()

    const { rerender } = render(<AIPreheatPrecoolRecommender vehicleId={7} />)
    expect(draftButton()).toBeDisabled()
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()

    rerender(<AIPreheatPrecoolRecommender {...fullProps} vehicleId={7} />)
    expect(draftButton()).toBeEnabled()
    expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument()
  })
})

describe('AIPreheatPrecoolRecommender — SSE wiring + streaming lifecycle', () => {
  it('POSTs exactly once to the registered route with the full climate body and renders the first delta', async () => {
    enableFeature()
    const sseBody =
      sseFrame('delta', {
        text:
          'Proposed preheat for vehicle Roadie: a 30-minute warm-up window targeting 21\u00b0C ahead of your 7:30am departure.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } })
    const calls = installStreamingFetch(sseBody)

    render(<AIPreheatPrecoolRecommender {...fullProps} />)

    await clickDraft()

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(DRAFT_ROUTE)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      vehicle_id: 42,
      depart_by: DEPART_BY,
      current_cabin_temp_c: 4,
      outside_temp_c: -2,
      target_cabin_temp_c: 21,
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // The streamed narrative renders inside the gated wrapper's panel.
    const root = screen.getByTestId(ROOT_TESTID)
    await waitFor(() => {
      expect(root).toHaveTextContent(
        /30-minute warm-up window targeting 21\u00b0C ahead of your 7:30am departure\./,
      )
    })
    expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
      /Proposed preheat for vehicle Roadie/,
    )
  })

  it('coerces a numeric-string vehicleId into a numeric vehicle_id body field', async () => {
    enableFeature()
    const calls = installStreamingFetch(
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    )

    render(<AIPreheatPrecoolRecommender {...fullProps} vehicleId="7" />)

    await clickDraft()

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe(DRAFT_ROUTE)
    // '7' (string) must become the number 7 in the request body — the
    // handler-side parser validates vehicle_id > 0 as a number.
    const parsed = JSON.parse(calls[0].init?.body as string)
    expect(parsed.vehicle_id).toBe(7)
    expect(typeof parsed.vehicle_id).toBe('number')
  })

  it.each([
    ['omitted', undefined],
    ['null', null],
    ['NaN', Number.NaN],
  ])(
    'defaults target_cabin_temp_c to 21 when the target is %s',
    async (_label, target) => {
      enableFeature()
      const calls = installStreamingFetch(
        sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
      )

      render(
        <AIPreheatPrecoolRecommender {...fullProps} targetCabinTempC={target} />,
      )

      await clickDraft()

      await waitFor(() => expect(calls).toHaveLength(1))
      expect(JSON.parse(calls[0].init?.body as string).target_cabin_temp_c).toBe(
        21,
      )
    },
  )

  it('forwards a caller-supplied in-range target temperature verbatim', async () => {
    enableFeature()
    const calls = installStreamingFetch(
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    )

    render(<AIPreheatPrecoolRecommender {...fullProps} targetCabinTempC={18} />)

    await clickDraft()

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(JSON.parse(calls[0].init?.body as string).target_cabin_temp_c).toBe(18)
  })

  it('treats a falsy-but-valid 0\u00b0C cabin/outside temperature as present and forwards the zeros', async () => {
    enableFeature()
    const calls = installStreamingFetch(
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    )

    render(
      <AIPreheatPrecoolRecommender
        {...fullProps}
        currentCabinTempC={0}
        outsideTempC={0}
      />,
    )

    // 0°C is a legitimate temperature — it must NOT be treated as
    // "missing" and disable the button.
    const button = draftButton()
    expect(button).toBeEnabled()

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(calls).toHaveLength(1))
    const parsed = JSON.parse(calls[0].init?.body as string)
    expect(parsed.current_cabin_temp_c).toBe(0)
    expect(parsed.outside_temp_c).toBe(0)
  })

  it('shows the thinking indicator and disables the button while streaming', async () => {
    enableFeature()
    installNeverClosingFetch()

    render(<AIPreheatPrecoolRecommender {...fullProps} />)
    const button = await clickDraft()

    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByTestId('ai-thinking-indicator')).toBeInTheDocument()
    expect(button).toHaveTextContent(/Helix is thinking/)
  })

  it('guards against double-submit: a second click while streaming issues no new request', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(<AIPreheatPrecoolRecommender {...fullProps} />)
    const button = await clickDraft()

    await waitFor(() => expect(tracker.count()).toBe(1))
    await waitFor(() => expect(button).toBeDisabled())

    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(1)
  })

  it('surfaces an HTTP error in the output panel when the stream route returns non-2xx', async () => {
    enableFeature()
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(<AIPreheatPrecoolRecommender {...fullProps} />)
    await clickDraft()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
  })

  it('surfaces a terminal SSE error frame in the output panel', async () => {
    enableFeature()
    installStreamingFetch(sseFrame('error', { message: 'provider_unavailable' }))

    render(<AIPreheatPrecoolRecommender {...fullProps} />)
    await clickDraft()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/provider_unavailable/)
    })
  })
})

describe('AIPreheatPrecoolRecommender — public surface', () => {
  it('exposes a stable displayName for the gated component', () => {
    expect(AIPreheatPrecoolRecommender.displayName).toBe(
      'AIPreheatPrecoolRecommender',
    )
  })
})
