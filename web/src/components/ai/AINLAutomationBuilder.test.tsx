// Comprehensive unit + behaviour coverage for AINLAutomationBuilder —
// the co-located Project Apex elevation test.
//
// The file has a single runtime export: `AINLAutomationBuilder` (an
// InnerSection wrapped with withAiFeature). Like AILifetimeStatsQA it
// carries a prompt input (a description Textarea) AND a two-part input
// gate (`haveVehicle && havePrompt`), so the facets worth exercising
// are:
//
//   - the ADR-015 AI-off visibility gate (off-mode, per-feature toggle
//     off, and the positive control that proves the gate is real);
//   - the two-part input gate: the Draft button's `disabled` is a
//     COMPUTED expression (`!canStart`), never a literal `disabled`.
//     This is proved across a matrix of absent / zero / negative / NaN
//     ids and empty / whitespace-only prompts, plus the
//     context-sensitive empty-state hint that explains WHICH
//     precondition is missing (vehicle first, then prompt). The
//     zero/negative/NaN cases are the regression guard for the bug this
//     elevation fixes — the backend rejects vehicle_id <= 0 with a 400,
//     so the button MUST stay disabled for those ids;
//   - the SSE wiring contract (exactly one POST to the registered
//     `/api/v1/ai/automations/draft` route with the correct method /
//     headers and the `{ vehicle_id, prompt }` body, including the
//     whitespace-trim path and the maxLength cap that mirrors the
//     backend's builderMaxPromptChars);
//   - the streaming lifecycle (thinking indicator + disabled button
//     while in flight, double-submit guard, HTTP-error + error-frame
//     fallbacks rendered in AiOutputPanel); and
//   - the stable public surface (displayName).
//
// Network is mocked with a hand-rolled ReadableStream emitting the SSE
// frames internal/ai/stream/writer.go produces — the same convention
// the sibling feature tests use. No real network is touched.
// @testing-library/user-event is intentionally NOT a dependency of this
// codebase (see web/package.json), so interactions use fireEvent,
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
import { AINLAutomationBuilder } from '@/components/ai/AINLAutomationBuilder'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-nl-automation-builder-root'
const DRAFT_ROUTE = '/api/v1/ai/automations/draft'
const NO_VEHICLE_HINT = 'Pick a vehicle above to let Helix draft an automation for it.'
const NO_PROMPT_HINT = 'Describe the automation you want Helix to draft.'
// Mirrors builderMaxPromptChars in internal/api/aiautomation/handler.go.
const MAX_PROMPT_CHARS = 4096

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
      ai_features: { 'nl-automation-builder': true },
    }),
  )
}

// makeReadableStream constructs a ReadableStream<Uint8Array> from text
// chunks — byte-for-byte what useAiStream's parser consumes.
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

function draftButton(): HTMLElement {
  // AIFeatureCard's visible CTA is the universal "Ask Helix"; the
  // per-feature verb ("Draft automation") lives in the aria-label, so
  // the accessible name reads "Ask Helix · Draft automation".
  return screen.getByRole('button', { name: /Draft automation/i })
}

function promptBox(): HTMLElement {
  return screen.getByLabelText(/Automation description/i)
}

async function typePrompt(value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(promptBox(), { target: { value } })
  })
}

async function clickDraft(): Promise<HTMLElement> {
  const btn = draftButton()
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

describe('AINLAutomationBuilder — AI-off visibility gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the per-feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'nl-automation-builder': true },
      }),
    )

    const { container } = render(<AINLAutomationBuilder vehicleId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Draft automation/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Automation description/i)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode!=off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'nl-automation-builder': false },
      }),
    )

    const { container } = render(<AINLAutomationBuilder vehicleId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) with title, badge, description box and a disabled Draft button when both mode and toggle are on', () => {
    enableFeature()

    render(<AINLAutomationBuilder vehicleId={42} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'nl-automation-builder')

    // The deterministic title + badge copy renders.
    expect(screen.getByText('Draft from natural language')).toBeInTheDocument()
    expect(screen.getByText('Helix')).toBeInTheDocument()

    // The prompt Textarea renders with its accessible label + the
    // backend-mirroring maxLength cap and placeholder.
    const box = promptBox()
    expect(box.tagName).toBe('TEXTAREA')
    expect(box).toHaveAttribute('maxLength', String(MAX_PROMPT_CHARS))
    expect(box).toHaveAttribute(
      'placeholder',
      expect.stringContaining('precondition the cabin'),
    )

    // A vehicle IS in scope but the prompt is empty, so the Draft
    // button is disabled and the prompt hint (not the vehicle hint)
    // explains why — proves the context-sensitive branch.
    const button = draftButton()
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    const ariaLabel = button.getAttribute('aria-label') ?? ''
    expect(ariaLabel).toContain('Ask Helix')
    expect(screen.getByText(NO_PROMPT_HINT)).toBeInTheDocument()
    expect(screen.queryByText(NO_VEHICLE_HINT)).not.toBeInTheDocument()

    // Idle: no output panel yet.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
  })
})

describe('AINLAutomationBuilder — input gate (computed disabled + empty-state hints)', () => {
  it('disables the Draft button and shows the vehicle hint when no vehicleId is available', () => {
    enableFeature()

    render(<AINLAutomationBuilder />)

    const button = draftButton()
    expect(button).toBeDisabled()
    // Computed, screen-reader-visible disabled state (W1 Rule A).
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // The vehicle precondition is the coarser one and is reported first.
    expect(screen.getByText(NO_VEHICLE_HINT)).toBeInTheDocument()
    expect(screen.queryByText(NO_PROMPT_HINT)).not.toBeInTheDocument()
  })

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
  ])(
    'keeps the Draft button disabled + shows the vehicle hint for an invalid vehicleId (%s) even with a prompt typed',
    async (_label, id) => {
      enableFeature()

      render(<AINLAutomationBuilder vehicleId={id} />)
      // Type a valid prompt to isolate the vehicle gate: the button must
      // STILL be disabled because vehicle_id <= 0 (or NaN) is rejected
      // by the backend — this is the regression guard for the bug fix.
      await typePrompt('precondition the cabin when I leave work')

      expect(draftButton()).toBeDisabled()
      expect(screen.getByText(NO_VEHICLE_HINT)).toBeInTheDocument()
      expect(screen.queryByText(NO_PROMPT_HINT)).not.toBeInTheDocument()
    },
  )

  it('keeps the Draft button disabled for a valid vehicle but an empty prompt and shows the prompt hint', () => {
    enableFeature()

    render(<AINLAutomationBuilder vehicleId={42} />)

    expect(draftButton()).toBeDisabled()
    expect(screen.getByText(NO_PROMPT_HINT)).toBeInTheDocument()
    expect(screen.queryByText(NO_VEHICLE_HINT)).not.toBeInTheDocument()
  })

  it('keeps the Draft button disabled for a whitespace-only prompt (trim path)', async () => {
    enableFeature()

    render(<AINLAutomationBuilder vehicleId={42} />)
    await typePrompt('   \t \n  ')

    // trim() collapses whitespace to '' → havePrompt false → the prompt
    // hint stays and the button stays disabled.
    expect(draftButton()).toBeDisabled()
    expect(screen.getByText(NO_PROMPT_HINT)).toBeInTheDocument()
  })

  it('enables the Draft button and clears both hints once a valid vehicle AND a non-empty prompt are present', async () => {
    enableFeature()

    render(<AINLAutomationBuilder vehicleId={7} />)
    expect(draftButton()).toBeDisabled()

    await typePrompt('turn on sentry mode when I park downtown')

    expect(draftButton()).toBeEnabled()
    expect(draftButton()).toHaveAttribute('aria-disabled', 'false')
    expect(screen.queryByText(NO_VEHICLE_HINT)).not.toBeInTheDocument()
    expect(screen.queryByText(NO_PROMPT_HINT)).not.toBeInTheDocument()
  })

  it('walks the hint from vehicle → prompt → gone as preconditions resolve', async () => {
    enableFeature()

    const { rerender } = render(<AINLAutomationBuilder />)
    // No vehicle → vehicle hint.
    expect(screen.getByText(NO_VEHICLE_HINT)).toBeInTheDocument()

    // Vehicle resolves via the active-vehicle context → prompt hint.
    rerender(<AINLAutomationBuilder vehicleId={9} />)
    expect(screen.getByText(NO_PROMPT_HINT)).toBeInTheDocument()
    expect(screen.queryByText(NO_VEHICLE_HINT)).not.toBeInTheDocument()

    // Prompt typed → both hints gone, button enabled.
    await typePrompt('precondition the cabin on weekday mornings')
    expect(screen.queryByText(NO_PROMPT_HINT)).not.toBeInTheDocument()
    expect(draftButton()).toBeEnabled()
  })

  it('does not open a stream when the (disabled) Draft button is clicked without preconditions', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(<AINLAutomationBuilder />)

    await act(async () => {
      fireEvent.click(draftButton())
    })
    // Give any rogue fetch a macrotask to land.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(0)
  })
})

describe('AINLAutomationBuilder — SSE wiring + streaming lifecycle', () => {
  it('POSTs exactly once to the registered route with the in-scope vehicle_id + prompt and renders the first delta', async () => {
    enableFeature()
    const sseBody =
      sseFrame('delta', {
        text:
          'Drafted an automation: when you leave work on weekdays, precondition the cabin to 22°C.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 80, out: 20 } })
    const calls = installStreamingFetch(sseBody)

    render(<AINLAutomationBuilder vehicleId={42} />)
    await typePrompt('precondition the cabin to 22C when I leave work on weekdays')
    await clickDraft()

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(DRAFT_ROUTE)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      vehicle_id: 42,
      prompt: 'precondition the cabin to 22C when I leave work on weekdays',
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // The streamed draft renders inside the gated wrapper's panel.
    const root = screen.getByTestId(ROOT_TESTID)
    await waitFor(() => {
      expect(root).toHaveTextContent(/Drafted an automation/)
    })
    expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
      /precondition the cabin/,
    )
  })

  it('sends the trimmed prompt in the request body', async () => {
    enableFeature()
    const calls = installStreamingFetch(
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    )

    render(<AINLAutomationBuilder vehicleId={13} />)
    // Leading / trailing whitespace must be stripped before it reaches
    // the handler-side parser.
    await typePrompt('   charge to 80% overnight   ')
    await clickDraft()

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe(DRAFT_ROUTE)
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      vehicle_id: 13,
      prompt: 'charge to 80% overnight',
    })
  })

  it('shows the thinking indicator and disables the button while streaming', async () => {
    enableFeature()
    installNeverClosingFetch()

    render(<AINLAutomationBuilder vehicleId={42} />)
    await typePrompt('open the charge port when I arrive home')
    const button = await clickDraft()

    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByTestId('ai-thinking-indicator')).toBeInTheDocument()
    expect(button).toHaveTextContent(/Helix is thinking/)
  })

  it('guards against double-submit: a second click while streaming issues no new request', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(<AINLAutomationBuilder vehicleId={42} />)
    await typePrompt('flash the lights when I approach')
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

    render(<AINLAutomationBuilder vehicleId={42} />)
    await typePrompt('lock the doors when I walk away')
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

    render(<AINLAutomationBuilder vehicleId={42} />)
    await typePrompt('set climate before my commute')
    await clickDraft()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/provider_unavailable/)
    })
  })
})

describe('AINLAutomationBuilder — public surface', () => {
  it('exposes a stable displayName for the gated component', () => {
    expect(AINLAutomationBuilder.displayName).toBe('AINLAutomationBuilder')
  })
})
