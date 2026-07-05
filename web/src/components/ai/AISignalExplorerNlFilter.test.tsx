// Co-located unit + wiring test for AISignalExplorerNlFilter.
//
// The module exports the gated
// `withAiFeature('signal-explorer-nl-filter', InnerSection)` component
// plus the pure `parseSignalFilterDraft` envelope narrower (exported
// for direct testing, mirroring `parseDashboardLayoutDraft` /
// `parseSSEFrame`). This suite covers every observable facet so the
// file can be marked production-grade:
//
//   1. parseSignalFilterDraft (pure): the well-formed happy path, the
//      strict null branches (non-object data / non-'ok' status /
//      missing·wrong-typed draft, vehicle_id, signals, range_preset,
//      per_page), and the non-finite-number guard (NaN / Infinity) for
//      the two numeric fields that flow into the page's form state.
//
//   2. Render gate (ADR-015 §I5/§I6): the surface is entirely absent
//      when ai_mode='off' OR the per-feature toggle is off OR the
//      ai_features map is absent OR settings are unresolved, and present
//      (with the registered `ai-feature-signal-explorer-nl-filter-root`
//      test id) only when the mode is a non-off mode AND the toggle is
//      true. The positive controls prove the negatives are not trivially
//      true. Both non-off modes ('cloud' and 'local') are exercised.
//
//   3. Enabled surface + a11y: the card renders the Helix heading, the
//      propose-only description, the "Helix" badge, and a LABELLED
//      prompt textarea. The Draft button is a COMPUTED-disabled control
//      (never a literal `disabled`) that stays disabled until a
//      non-empty trimmed prompt AND a positive vehicleId are present,
//      and no output panel or Apply affordance shows before a draft has
//      run.
//
//   4. On-mode SSE wiring: clicking Draft POSTs exactly once to the
//      registered route /api/v1/ai/signals/filter/draft with the typed
//      `{vehicle_id, prompt}` body (trimmed) + SSE headers, shows the
//      thinking indicator, coalesces a double-submit, and surfaces a
//      stream error on a non-2xx response.
//
//   5. Draft capture + apply (propose-only contract, ADR-015 §I8): a
//      successful draft_signal_filter tool_result enables "Apply to
//      filters", and clicking it invokes the `onApply` prop with the
//      parsed draft — the component never writes page state itself. A
//      FAILED tool_result (ok=false), a status:'invalid' envelope, or
//      one for a different tool name is ignored; and starting a fresh
//      draft clears the previous one.
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
  AISignalExplorerNlFilter,
  parseSignalFilterDraft,
  type SignalFilterDraft,
} from '@/components/ai/AISignalExplorerNlFilter'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

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
    ai_features: { 'signal-explorer-nl-filter': true },
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

const ROOT_TESTID = 'ai-feature-signal-explorer-nl-filter-root'
const FEATURE_ID = 'signal-explorer-nl-filter'
const ROUTE = '/api/v1/ai/signals/filter/draft'
const DRAFT_BUTTON = /Draft filter/i
const APPLY_BUTTON = /^Apply to filters$/i
const TITLE = /Helix natural-language filter/i
const DESCRIPTION = /Describe the filter in plain English/i
const PROMPT_LABEL = /Filter request/i

// A well-formed tool_result.data envelope the backend
// draft_signal_filter tool emits ({draft, status:'ok', source}).
const VALID_DRAFT_DATA = {
  draft: {
    vehicle_id: 7,
    signals: ['battery_level', 'charge_state'],
    range_preset: 'yesterday',
    per_page: 50,
  },
  status: 'ok',
  source: 'tools.draft_signal_filter',
}

// EXPECTED_DRAFT is the typed SignalFilterDraft parseSignalFilterDraft
// yields from VALID_DRAFT_DATA — the exact object handed to onApply.
const EXPECTED_DRAFT: SignalFilterDraft = {
  vehicle_id: 7,
  signals: ['battery_level', 'charge_state'],
  range_preset: 'yesterday',
  per_page: 50,
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

describe('parseSignalFilterDraft (pure envelope narrower)', () => {
  it('parses a well-formed status:ok envelope into a typed draft', () => {
    const parsed = parseSignalFilterDraft(VALID_DRAFT_DATA)
    expect(parsed).toEqual(EXPECTED_DRAFT)
    // The parsed signals array is a fresh reference typed as string[].
    expect(parsed?.signals).toEqual(['battery_level', 'charge_state'])
    expect(parsed?.per_page).toBe(50)
  })

  it('returns null for non-object data (null / undefined / string / number)', () => {
    expect(parseSignalFilterDraft(null)).toBeNull()
    expect(parseSignalFilterDraft(undefined)).toBeNull()
    expect(parseSignalFilterDraft('nope')).toBeNull()
    expect(parseSignalFilterDraft(42)).toBeNull()
  })

  it('returns null when status is not exactly "ok" (e.g. an invalid draft)', () => {
    expect(
      parseSignalFilterDraft({ ...VALID_DRAFT_DATA, status: 'invalid' }),
    ).toBeNull()
    // Missing status entirely is also rejected.
    expect(parseSignalFilterDraft({ draft: VALID_DRAFT_DATA.draft })).toBeNull()
  })

  it('returns null when the draft field is missing or not an object', () => {
    expect(parseSignalFilterDraft({ status: 'ok' })).toBeNull()
    expect(parseSignalFilterDraft({ status: 'ok', draft: null })).toBeNull()
    expect(parseSignalFilterDraft({ status: 'ok', draft: 'x' })).toBeNull()
  })

  it('returns null when vehicle_id is not a finite number (missing / string / NaN / Infinity)', () => {
    const base = VALID_DRAFT_DATA.draft
    expect(
      parseSignalFilterDraft({ status: 'ok', draft: { ...base, vehicle_id: '7' } }),
    ).toBeNull()
    expect(
      parseSignalFilterDraft({ status: 'ok', draft: { ...base, vehicle_id: NaN } }),
    ).toBeNull()
    expect(
      parseSignalFilterDraft({
        status: 'ok',
        draft: { ...base, vehicle_id: Infinity },
      }),
    ).toBeNull()
  })

  it('returns null when signals is not an array or contains a non-string element', () => {
    const base = VALID_DRAFT_DATA.draft
    expect(
      parseSignalFilterDraft({ status: 'ok', draft: { ...base, signals: 'battery' } }),
    ).toBeNull()
    expect(
      parseSignalFilterDraft({
        status: 'ok',
        draft: { ...base, signals: ['battery_level', 3] },
      }),
    ).toBeNull()
  })

  it('returns null when range_preset is not a string', () => {
    const base = VALID_DRAFT_DATA.draft
    expect(
      parseSignalFilterDraft({
        status: 'ok',
        draft: { ...base, range_preset: 7 },
      }),
    ).toBeNull()
  })

  it('returns null when per_page is not a finite number (string / NaN / Infinity)', () => {
    const base = VALID_DRAFT_DATA.draft
    expect(
      parseSignalFilterDraft({ status: 'ok', draft: { ...base, per_page: '50' } }),
    ).toBeNull()
    expect(
      parseSignalFilterDraft({ status: 'ok', draft: { ...base, per_page: NaN } }),
    ).toBeNull()
    expect(
      parseSignalFilterDraft({
        status: 'ok',
        draft: { ...base, per_page: Infinity },
      }),
    ).toBeNull()
  })

  it('accepts an empty signals array (the status:ok gate already implies backend validation passed)', () => {
    const parsed = parseSignalFilterDraft({
      status: 'ok',
      draft: { ...VALID_DRAFT_DATA.draft, signals: [] },
    })
    expect(parsed?.signals).toEqual([])
  })
})

describe('AISignalExplorerNlFilter — AI-off render gate', () => {
  it('renders nothing when ai_mode=off even with the signal-explorer-nl-filter toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'signal-explorer-nl-filter': true },
      }),
    )

    const { container } = render(
      <AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: DRAFT_BUTTON })).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is off even with ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'signal-explorer-nl-filter': false },
      }),
    )

    const { container } = render(
      <AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_features is entirely absent (undefined map)', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: undefined }),
    )

    const { container } = render(
      <AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing while settings are still unresolved (settings undefined)', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(
      <AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) when ai_mode=cloud AND the toggle is on', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: DRAFT_BUTTON })).toBeInTheDocument()
  })

  it('also renders under ai_mode=local (local mode is a non-off mode)', () => {
    mockUseSettings.mockReturnValue(enabled({ ai_mode: 'local' }))

    render(<AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />)

    expect(screen.getByTestId(ROOT_TESTID)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: DRAFT_BUTTON })).toBeInTheDocument()
  })
})

describe('AISignalExplorerNlFilter — enabled surface structure + a11y', () => {
  it('renders the heading, propose-only description, Helix badge, and a labelled prompt textarea', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />)

    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument()
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument()
    expect(screen.getAllByText('Helix').length).toBeGreaterThan(0)

    // The prompt input is a real, accessibly-labelled textbox.
    const textarea = screen.getByRole('textbox', { name: PROMPT_LABEL })
    expect(textarea).toBeInTheDocument()
    expect(textarea.tagName).toBe('TEXTAREA')
  })

  it('keeps the Draft button computed-disabled (aria-disabled mirror) until a non-empty prompt is entered', async () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />)

    const button = screen.getByRole('button', { name: DRAFT_BUTTON })
    // Idle with no prompt: disabled, mirrored by aria-disabled, and the
    // per-feature verb lives in the tooltip + accessible name (the
    // visible label is the universal Helix CTA).
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveTextContent(/Ask Helix/i)
    expect(button).toHaveAttribute('title', expect.stringMatching(DRAFT_BUTTON))

    // A whitespace-only prompt still trims to empty → stays disabled.
    const textarea = screen.getByRole('textbox', { name: PROMPT_LABEL })
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '   ' } })
    })
    expect(button).toBeDisabled()

    // A real prompt enables it.
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'battery level' } })
    })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
  })

  it('keeps the Draft button disabled when no vehicle is selected (vehicleId <= 0) even with a prompt', async () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AISignalExplorerNlFilter vehicleId={0} onApply={() => {}} />)

    const button = screen.getByRole('button', { name: DRAFT_BUTTON })
    const textarea = screen.getByRole('textbox', { name: PROMPT_LABEL })
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'battery level for yesterday' } })
    })

    // hasVehicle is false, so canStart never becomes true.
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('shows no output panel or Apply affordance before any draft has run', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />)

    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-thinking-indicator')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: APPLY_BUTTON })).not.toBeInTheDocument()
  })
})

describe('AISignalExplorerNlFilter — on-mode SSE wiring', () => {
  async function typeAndDraft(prompt: string) {
    const textarea = screen.getByRole('textbox', { name: PROMPT_LABEL })
    await act(async () => {
      fireEvent.change(textarea, { target: { value: prompt } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: DRAFT_BUTTON }))
    })
  }

  it('POSTs once to the registered route with the trimmed {vehicle_id, prompt} body + SSE headers and renders the delta', async () => {
    mockUseSettings.mockReturnValue(enabled())

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const delta = 'Drafting a filter for "battery level for yesterday".'
    const sseBody =
      sseFrame('delta', { text: delta }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 200, out: 60 } })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(<AISignalExplorerNlFilter vehicleId={3} onApply={() => {}} />)
    const root = screen.getByTestId(ROOT_TESTID)

    // Leading/trailing whitespace must be trimmed out of the POST body.
    await typeAndDraft('   battery level for yesterday   ')

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe(ROUTE)
    expect(init?.method).toBe('POST')
    expect(typeof init?.body).toBe('string')
    expect(JSON.parse(init?.body as string)).toEqual({
      vehicle_id: 3,
      prompt: 'battery level for yesterday',
    })

    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => expect(root).toHaveTextContent(delta))
  })

  it('shows the thinking indicator and disables the button while the stream is open', async () => {
    mockUseSettings.mockReturnValue(enabled())

    // A stream that never enqueues/closes holds state === 'streaming'.
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // Never enqueue, never close.
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />)
    await typeAndDraft('battery level')

    const indicator = await screen.findByTestId('ai-thinking-indicator')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveAttribute('role', 'status')

    const button = screen.getByRole('button', { name: DRAFT_BUTTON })
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

    render(<AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />)
    await typeAndDraft('battery level')
    await waitFor(() => expect(fetchCount).toBe(1))

    const button = screen.getByRole('button', { name: DRAFT_BUTTON })
    await waitFor(() => expect(button).toBeDisabled())
    await act(async () => {
      // fireEvent bypasses the disabled attribute, exercising the
      // hook's runningRef coalescer directly (defence in depth).
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

    render(<AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />)
    await typeAndDraft('battery level')

    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent('stream_http_404')
    // No draft was captured, so the Apply affordance stays absent.
    expect(screen.queryByRole('button', { name: APPLY_BUTTON })).not.toBeInTheDocument()
  })
})

describe('AISignalExplorerNlFilter — draft capture + apply (propose-only contract)', () => {
  function draftStreamFetch(toolResult: Record<string, unknown>) {
    const sseBody =
      sseFrame('delta', { text: 'Drafting a filter.' }) +
      sseFrame('tool_result', toolResult) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 220, out: 80 } })
    return vi.fn(async () =>
      new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    ) as unknown as typeof globalThis.fetch
  }

  async function typeAndDraft() {
    const textarea = screen.getByRole('textbox', { name: PROMPT_LABEL })
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'battery level for yesterday' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: DRAFT_BUTTON }))
    })
  }

  it('captures a successful draft_signal_filter tool_result and applies the parsed draft on click', async () => {
    mockUseSettings.mockReturnValue(enabled())
    globalThis.fetch = draftStreamFetch({
      id: 'call-1',
      name: 'draft_signal_filter',
      ok: true,
      data: VALID_DRAFT_DATA,
    })

    const onApply = vi.fn<(draft: SignalFilterDraft) => void>()
    render(<AISignalExplorerNlFilter vehicleId={7} onApply={onApply} />)
    const root = screen.getByTestId(ROOT_TESTID)

    await typeAndDraft()

    // The streamed delta renders inside the gated wrapper.
    await waitFor(() => expect(root).toHaveTextContent('Drafting a filter.'))

    // After the tool_result lands the Apply button enables.
    const applyButton = await screen.findByRole('button', { name: APPLY_BUTTON })
    await waitFor(() => expect(applyButton).not.toBeDisabled())
    expect(applyButton).toHaveAttribute('aria-disabled', 'false')

    await act(async () => {
      fireEvent.click(applyButton)
    })

    // Propose-only: the component never writes page state; it hands the
    // parsed draft to the page via onApply.
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(EXPECTED_DRAFT)
  })

  it('ignores a FAILED tool_result (ok=false) even when its data is a valid-looking draft', async () => {
    mockUseSettings.mockReturnValue(enabled())
    globalThis.fetch = draftStreamFetch({
      id: 'call-1',
      name: 'draft_signal_filter',
      ok: false,
      error: 'signal not in catalog',
      data: VALID_DRAFT_DATA,
    })

    const onApply = vi.fn<(draft: SignalFilterDraft) => void>()
    render(<AISignalExplorerNlFilter vehicleId={7} onApply={onApply} />)
    const root = screen.getByTestId(ROOT_TESTID)

    await typeAndDraft()

    // The delta still renders (stream ran) but no draft was captured, so
    // the Apply affordance never appears and onApply is never called.
    await waitFor(() => expect(root).toHaveTextContent('Drafting a filter.'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: DRAFT_BUTTON })).not.toBeDisabled(),
    )
    expect(screen.queryByRole('button', { name: APPLY_BUTTON })).not.toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('ignores a tool_result whose data envelope reports status:invalid', async () => {
    mockUseSettings.mockReturnValue(enabled())
    globalThis.fetch = draftStreamFetch({
      id: 'call-1',
      name: 'draft_signal_filter',
      ok: true,
      data: {
        draft: VALID_DRAFT_DATA.draft,
        status: 'invalid',
        validation_error: 'per_page must be one of 25, 50, 100, 500',
      },
    })

    const onApply = vi.fn<(draft: SignalFilterDraft) => void>()
    render(<AISignalExplorerNlFilter vehicleId={7} onApply={onApply} />)

    await typeAndDraft()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: DRAFT_BUTTON })).not.toBeDisabled(),
    )
    expect(screen.queryByRole('button', { name: APPLY_BUTTON })).not.toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('ignores a tool_result for a different tool name', async () => {
    mockUseSettings.mockReturnValue(enabled())
    globalThis.fetch = draftStreamFetch({
      id: 'call-1',
      name: 'validate_signal_filter',
      ok: true,
      data: VALID_DRAFT_DATA,
    })

    const onApply = vi.fn<(draft: SignalFilterDraft) => void>()
    render(<AISignalExplorerNlFilter vehicleId={7} onApply={onApply} />)

    await typeAndDraft()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: DRAFT_BUTTON })).not.toBeDisabled(),
    )
    expect(screen.queryByRole('button', { name: APPLY_BUTTON })).not.toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('clears a previously captured draft when a new draft run starts', async () => {
    mockUseSettings.mockReturnValue(enabled())

    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      const sseBody =
        fetchCount === 1
          ? sseFrame('tool_result', {
              id: 'call-1',
              name: 'draft_signal_filter',
              ok: true,
              data: VALID_DRAFT_DATA,
            }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } })
          : // Second run: only a `done` frame — no tool_result, so no new draft.
            sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(<AISignalExplorerNlFilter vehicleId={7} onApply={() => {}} />)

    // First draft captures a draft -> Apply appears.
    await typeAndDraft()
    expect(await screen.findByRole('button', { name: APPLY_BUTTON })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: DRAFT_BUTTON })).not.toBeDisabled(),
    )

    // Second draft starts by clearing the prior draft; its stream carries
    // no tool_result, so the Apply affordance stays gone.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: DRAFT_BUTTON }))
    })
    await waitFor(() => expect(fetchCount).toBe(2))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: APPLY_BUTTON })).not.toBeInTheDocument(),
    )
  })
})
