// Comprehensive unit + behaviour coverage for
// AICabinTemperatureImpactNarrative — the co-located Project Apex
// elevation test.
//
// The component has a single runtime export:
// `AICabinTemperatureImpactNarrative` (an InnerSection wrapped with
// withAiFeature). It has no reducer, no captured typed proposal, and
// no Apply hand-off — it is a pure read-only narration surface. So the
// facets worth exercising are:
//
//   - the ADR-015 AI-off visibility gate (off-mode, per-feature toggle
//     off, and the positive control that proves the gate is real);
//   - the input gate: the Narrate button's `disabled` is a COMPUTED
//     expression derived from `haveInputs = isFinite(id) && id > 0`,
//     never a literal `disabled`. This is proved across a matrix of
//     absent / zero / negative / NaN / non-numeric-string ids, plus
//     the empty-state hint that explains the disabled button;
//   - the SSE wiring contract (exactly one POST to the registered
//     `/api/v1/ai/climate/temperature-impact/narrate` route with the
//     correct method / headers and the `{ vehicle_id }` body, including
//     the numeric-string coercion path);
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
import { AICabinTemperatureImpactNarrative } from '@/components/ai/AICabinTemperatureImpactNarrative'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-cabin-temperature-impact-narrative-root'
const NARRATE_ROUTE = '/api/v1/ai/climate/temperature-impact/narrate'
const EMPTY_HINT = 'Select a vehicle to narrate its temperature impact.'

// A complete AppSettings with realistic non-AI defaults. Per-test
// cases override `ai_mode` + `ai_features` to flip the gate.
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
      ai_features: { 'cabin-temperature-impact-narrative': true },
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
    return new Response(
      new ReadableStream<Uint8Array>({ start() {} }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }) as unknown as typeof globalThis.fetch
  return { count: () => fetchCount }
}

function narrateButton(): HTMLElement {
  return screen.getByRole('button', { name: /Narrate impact/i })
}

async function clickNarrate(): Promise<HTMLElement> {
  const btn = narrateButton()
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

describe('AICabinTemperatureImpactNarrative — AI-off visibility gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the per-feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'cabin-temperature-impact-narrative': true },
      }),
    )

    const { container } = render(
      <AICabinTemperatureImpactNarrative vehicleId={42} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Narrate impact/i }),
    ).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode!=off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'cabin-temperature-impact-narrative': false },
      }),
    )

    const { container } = render(
      <AICabinTemperatureImpactNarrative vehicleId={42} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) with title, badge and an enabled button when both mode and toggle are on', () => {
    enableFeature()

    render(<AICabinTemperatureImpactNarrative vehicleId={42} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'cabin-temperature-impact-narrative',
    )
    // The deterministic title + description copy renders.
    expect(
      screen.getByText('Narrate the cabin-temperature impact'),
    ).toBeInTheDocument()
    expect(screen.getByText('Helix')).toBeInTheDocument()

    // The Narrate button is enabled (vehicle in scope, idle stream) and
    // exposes the per-feature verb through its accessible name.
    const button = narrateButton()
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    const ariaLabel = button.getAttribute('aria-label') ?? ''
    expect(ariaLabel).toContain('Ask Helix')
    expect(ariaLabel).toContain('Narrate impact')

    // Idle: no output panel yet, and no empty hint (a vehicle IS in
    // scope) — proves both conditional branches.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument()
  })
})

describe('AICabinTemperatureImpactNarrative — input gate (computed disabled + empty state)', () => {
  it('disables the Narrate button and shows the empty-state hint when no vehicleId is available', () => {
    enableFeature()

    render(<AICabinTemperatureImpactNarrative />)

    const button = narrateButton()
    expect(button).toBeDisabled()
    // The disabled attribute is mirrored by aria-disabled (W1 Rule A:
    // computed, screen-reader-visible disabled state).
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // The empty hint explains WHY the button is disabled instead of
    // leaving a bare, unexplained control.
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
  })

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
    ['non-numeric string', 'not-a-vehicle'],
    ['empty string', ''],
  ])(
    'keeps the Narrate button disabled for an invalid vehicleId (%s)',
    (_label, id) => {
      enableFeature()

      render(<AICabinTemperatureImpactNarrative vehicleId={id} />)

      expect(narrateButton()).toBeDisabled()
      expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
    },
  )

  it('does not open a stream when the (disabled) button is clicked without a vehicle', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(<AICabinTemperatureImpactNarrative />)

    await act(async () => {
      fireEvent.click(narrateButton())
    })
    // Give any rogue fetch a macrotask to land.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(0)
  })

  it('enables the Narrate button once a valid vehicleId resolves via rerender', () => {
    enableFeature()

    const { rerender } = render(<AICabinTemperatureImpactNarrative />)
    expect(narrateButton()).toBeDisabled()

    rerender(<AICabinTemperatureImpactNarrative vehicleId={7} />)
    expect(narrateButton()).toBeEnabled()
    expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument()
  })
})

describe('AICabinTemperatureImpactNarrative — SSE wiring + streaming lifecycle', () => {
  it('POSTs exactly once to the registered route with the in-scope vehicle_id and renders the first delta', async () => {
    enableFeature()
    const sseBody =
      sseFrame('delta', {
        text:
          'Vehicle Roadie shows a clear cold-weather efficiency dip below 0\u00b0C with mild-weather buckets the most efficient.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } })
    const calls = installStreamingFetch(sseBody)

    render(<AICabinTemperatureImpactNarrative vehicleId={42} />)

    await clickNarrate()

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(NARRATE_ROUTE)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ vehicle_id: 42 })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // The streamed narrative renders inside the gated wrapper's panel.
    const root = screen.getByTestId(ROOT_TESTID)
    await waitFor(() => {
      expect(root).toHaveTextContent(
        /clear cold-weather efficiency dip below 0\u00b0C with mild-weather buckets the most efficient\./,
      )
    })
    expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
      /mild-weather buckets the most efficient/,
    )
  })

  it('coerces a numeric-string vehicleId into a numeric vehicle_id body field', async () => {
    enableFeature()
    const calls = installStreamingFetch(
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    )

    render(<AICabinTemperatureImpactNarrative vehicleId="7" />)

    await clickNarrate()

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe(NARRATE_ROUTE)
    // '7' (string) must become the number 7 in the request body — the
    // handler-side parser validates vehicle_id > 0 as a number.
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ vehicle_id: 7 })
  })

  it('shows the thinking indicator and disables the button while streaming', async () => {
    enableFeature()
    installNeverClosingFetch()

    render(<AICabinTemperatureImpactNarrative vehicleId={42} />)
    const button = await clickNarrate()

    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByTestId('ai-thinking-indicator')).toBeInTheDocument()
    expect(button).toHaveTextContent(/Helix is thinking/)
  })

  it('guards against double-submit: a second click while streaming issues no new request', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(<AICabinTemperatureImpactNarrative vehicleId={42} />)
    const button = await clickNarrate()

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

    render(<AICabinTemperatureImpactNarrative vehicleId={42} />)
    await clickNarrate()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
  })

  it('surfaces a terminal SSE error frame in the output panel', async () => {
    enableFeature()
    installStreamingFetch(sseFrame('error', { message: 'provider_unavailable' }))

    render(<AICabinTemperatureImpactNarrative vehicleId={42} />)
    await clickNarrate()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/provider_unavailable/)
    })
  })
})

describe('AICabinTemperatureImpactNarrative — public surface', () => {
  it('exposes a stable displayName for the gated component', () => {
    expect(AICabinTemperatureImpactNarrative.displayName).toBe(
      'AICabinTemperatureImpactNarrative',
    )
  })
})
