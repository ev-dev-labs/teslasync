// Co-located unit + wiring test for AIQuietHoursSuggestion.
//
// The module has one runtime export — the
// `withAiFeature('quiet-hours-suggestion', InnerSection)` gated card —
// plus two type-only exports (`QuietHoursDraftProposal`,
// `AIQuietHoursSuggestionProps`) that are exercised at compile time by
// typing the fixtures below against them.
//
// This suite covers every observable facet so the file can be marked
// production-grade:
//
//   1. Render gate (ADR-015 §I5/§I6): the surface is entirely absent
//      when ai_mode='off', the per-feature toggle is off, the
//      ai_features map is missing, or settings have not resolved; and
//      present (with the registered `-root` test id) only when a non-off
//      mode AND the toggle are both on. The positive control proves the
//      negatives are not trivially true.
//
//   2. Surface structure + a11y: the enabled card renders the Helix
//      heading, the propose-only description, the "Helix" badge, and a
//      single "Suggest quiet hours" action whose accessible name carries
//      the per-feature verb (aria-label = "Ask Helix · Suggest quiet
//      hours"). The action is a COMPUTED-disabled control (never a
//      literal `disabled`): idle-enabled with aria-disabled='false', and
//      it exposes no output panel + no proposal card until a stream has
//      run.
//
//   3. On-mode SSE wiring: clicking Suggest POSTs exactly once to the
//      registered route /api/v1/ai/settings/quiet-hours/draft with an
//      empty `{}` JSON body + SSE headers, shows the thinking indicator
//      while awaiting the first delta, renders the delta text, coalesces
//      a double-submit while streaming, and surfaces a stream error on a
//      non-2xx response.
//
//   4. Proposal capture + apply: a typed QuietHoursWindowProposal from a
//      tool_result frame is captured into the preview card (window /
//      weekday bitmask / bypass severities), the `insufficient_history`
//      and `existing_windows_count` notes render on their branches,
//      non-string severities are filtered out, and clicking "Apply to
//      form" copies the typed scalars to the parent via onApplyDraft
//      exactly once. The Apply control is computed-disabled while the
//      stream is still open (mid-stream capture) and never a literal
//      `disabled`.
//
//   5. Proposal rejects: every malformed / mis-addressed tool_result
//      (missing/mistyped field, non-array severities, non-number
//      weekdays, ok=false, wrong tool name) is dropped so a bad envelope
//      never seeds the user's form.
//
//   6. Lifecycle: re-suggesting clears the previously-captured proposal
//      so a stale window cannot linger across runs.
//
// Network is stubbed at the `fetch` boundary — the same pattern the
// sibling wiring tests (AIDataRepairSuggestions.test.tsx,
// AIGeofenceAwareAutomationSuggestions.test.tsx) use; no real request is
// ever made. @testing-library/user-event is intentionally NOT a
// dependency of this codebase (see web/package.json), so interactions
// use fireEvent.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings, QuietHoursWindowInput } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

// react-i18next stub: echo each call site's English default (2nd arg)
// and honour `{{var}}` interpolation from the options (3rd arg) — the
// repo-wide convention for asserting rendered copy without booting the
// full i18n runtime (see WhyEndedPanel / SummaryHeroCards / CommandInput
// tests). The proposal preview interpolates the window scalars, so the
// interpolating stub is required to assert the values render.
vi.mock('react-i18next', () => {
  const interpolate = (template: string, vars?: Record<string, unknown>) =>
    vars
      ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
          String(vars[name] ?? `{{${name}}}`),
        )
      : template
  const t = (
    key: string,
    defaultOrOpts?: string | Record<string, unknown>,
    maybeOpts?: Record<string, unknown>,
  ): string => {
    if (typeof defaultOrOpts === 'string') return interpolate(defaultOrOpts, maybeOpts)
    return interpolate(key, defaultOrOpts)
  }
  return {
    useTranslation: () => ({
      t,
      i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
    }),
    initReactI18next: { type: '3rdParty', init: () => undefined },
    Trans: ({ children }: { children?: unknown }) => children ?? null,
  }
})

import { useSettings } from '@/hooks/useSettings'
import {
  AIQuietHoursSuggestion,
  type QuietHoursDraftProposal,
  type AIQuietHoursSuggestionProps,
} from '@/components/ai/AIQuietHoursSuggestion'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-quiet-hours-suggestion-root'
const FEATURE_ID = 'quiet-hours-suggestion'
const ROUTE = '/api/v1/ai/settings/quiet-hours/draft'
const SUGGEST_TESTID = 'ai-feature-quiet-hours-suggestion-suggest'
const APPLY_TESTID = 'ai-feature-quiet-hours-suggestion-apply'
const SUGGEST_NAME = /Suggest quiet hours/i
const TITLE = /Suggest a quiet-hours window from your notification history/i
const DESCRIPTION = /Ask Helix to recommend ONE quiet-hours window/i
const TOOL_NAME = 'draft_quiet_hours_window'

// baseSettings is a complete AppSettings with realistic non-AI defaults.
// Per-test overrides flip ai_mode + ai_features to exercise the gate's
// off (negative) and on (positive) paths.
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

// enabled() returns the fully-on settings shape (non-off mode + toggle)
// so the on-mode tests read one intent-revealing helper.
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

// emitThenHang enqueues the given frames once and then holds the
// connection open (never closes), keeping the hook at state='streaming'.
// Used to observe a proposal captured MID-stream (Apply computed-disabled
// while busy).
function emitThenHang(frames: Array<string>): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(encoder.encode(f))
        // Deliberately never close.
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

// A fully-valid typed proposal envelope — exactly the seven fields the
// tool_result handler positively proves. Typed against the exported
// QuietHoursDraftProposal so a field rename in the source breaks this
// fixture at compile time.
const validProposal: QuietHoursDraftProposal = {
  start_local: '23:00',
  end_local: '07:30',
  timezone: 'America/Los_Angeles',
  weekdays: 127,
  bypass_severities: ['critical'],
  status: 'ok',
  existing_windows_count: 0,
}

// The scalars the Apply button forwards to the parent form. Typed against
// QuietHoursWindowInput so the onApplyDraft contract is compile-checked.
const expectedApplyPatch: QuietHoursWindowInput = {
  enabled: true,
  start_local: '23:00',
  end_local: '07:30',
  timezone: 'America/Los_Angeles',
  weekdays: 127,
  bypass_severities: ['critical'],
}

function draftSse(data: unknown, deltaText = 'Recommended a quiet-hours window.') {
  return (
    sseFrame('tool_result', { id: 'tc1', name: TOOL_NAME, ok: true, data }) +
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

// clickSuggest locates + fires the primary "Ask Helix · Suggest quiet
// hours" action, wrapped in act() so the resulting stream-state updates
// flush before assertions.
async function clickSuggest() {
  const suggest = screen.getByRole('button', { name: SUGGEST_NAME })
  await act(async () => {
    fireEvent.click(suggest)
  })
  return suggest
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

// ── Type-only exports (compile-time contract) ─────────────────────────────
describe('AIQuietHoursSuggestion — exported type contracts', () => {
  it('types a QuietHoursDraftProposal fixture and an onApplyDraft prop against the public shapes', () => {
    // Exercising the two type-only exports at the value level: if either
    // interface drifts (a renamed/removed field), these fixtures stop
    // compiling, so tsc in the gate catches the regression.
    const proposal: QuietHoursDraftProposal = validProposal
    const props: AIQuietHoursSuggestionProps = {
      onApplyDraft: (patch: QuietHoursWindowInput) => void patch,
    }
    expect(proposal.timezone).toBe('America/Los_Angeles')
    expect(proposal.bypass_severities).toEqual(['critical'])
    expect(typeof props.onApplyDraft).toBe('function')
  })
})

// ── 1. Render gate (ADR-015 AI-off contract) ──────────────────────────────
describe('AIQuietHoursSuggestion — AI-off render gate', () => {
  it('renders nothing when ai_mode=off even with the feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { [FEATURE_ID]: true } }),
    )
    const { container } = render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SUGGEST_NAME })).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is off even with ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { [FEATURE_ID]: false } }),
    )
    const { container } = render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the ai_features map is entirely absent (fail-closed)', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: undefined }),
    )
    const { container } = render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing while settings are still unresolved (settings undefined)', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })
    const { container } = render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) when ai_mode=cloud AND the toggle is on', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    // The title heading + Suggest button prove the InnerSection body
    // actually mounted (not just the gate wrapper).
    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: SUGGEST_NAME })).toBeInTheDocument()
  })

  it('also renders under ai_mode=local (local mode is a non-off mode)', () => {
    mockUseSettings.mockReturnValue(enabled({ ai_mode: 'local' }))
    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    expect(screen.getByTestId(ROOT_TESTID)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: SUGGEST_NAME })).toBeInTheDocument()
  })
})

// ── 2. Surface structure + a11y ───────────────────────────────────────────
describe('AIQuietHoursSuggestion — surface structure + a11y', () => {
  it('renders the heading, propose-only description, Helix badge, and an idle-enabled Suggest button', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)

    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument()
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument()
    // "Helix" brand badge sits in the header.
    expect(screen.getAllByText('Helix').length).toBeGreaterThan(0)

    // The action button is enabled at idle (no stream open) and its
    // disabled state is a COMPUTED expression mirrored by aria-disabled
    // — never a literal `disabled` (W1 Rule A).
    const button = screen.getByRole('button', { name: SUGGEST_NAME })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    // The visible label is the universal Helix CTA; the per-feature verb
    // lives in the tooltip + accessible name.
    expect(button).toHaveTextContent(/Ask Helix/i)
    expect(button).toHaveAttribute('title', expect.stringMatching(SUGGEST_NAME))
    expect(button).toHaveAttribute('data-testid', SUGGEST_TESTID)
  })

  it('shows no output panel and no proposal card before any suggestion has run', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)

    // AiOutputPanel returns null while idle with no accumulated text, and
    // the proposal preview + Apply button only appear after a captured
    // tool_result. This proves the surface renders no empty box.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-thinking-indicator')).not.toBeInTheDocument()
    expect(screen.queryByTestId(APPLY_TESTID)).not.toBeInTheDocument()
  })
})

// ── 3. On-mode SSE wiring ─────────────────────────────────────────────────
describe('AIQuietHoursSuggestion — on-mode SSE wiring', () => {
  it('POSTs once to the registered route with an empty {} body + SSE headers and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const delta = 'Your notification cadence is sparsest overnight — I recommend 23:00–07:30.'
    const sseBody =
      sseFrame('delta', { text: delta }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 200, out: 60 } })
    const calls = stubStreamOnce(sseBody)

    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    const root = screen.getByTestId(ROOT_TESTID)
    await clickSuggest()

    // Exactly one POST against the registered backend route. The hook
    // prepends `${getApiBase()}/api/v1`; getApiBase() is '' in tests, so
    // the final URL is the bare route.
    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(ROUTE)
    expect(init?.method).toBe('POST')
    // The body is intentionally `{}` — the backend reads the user's
    // identity from ForwardAuth and applies deterministic defaults; the
    // SPA passes no params, but the POST body must be valid JSON.
    expect(typeof init?.body).toBe('string')
    expect(JSON.parse(init?.body as string)).toEqual({})

    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => expect(root).toHaveTextContent(delta))
  })

  it('shows the thinking indicator and disables the Suggest button while the stream is open', async () => {
    mockUseSettings.mockReturnValue(enabled())
    globalThis.fetch = vi.fn(
      async () => pendingStreamResponse(),
    ) as unknown as typeof globalThis.fetch

    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    const button = await clickSuggest()

    const indicator = await screen.findByTestId('ai-thinking-indicator')
    expect(indicator).toBeInTheDocument()
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

    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    const button = await clickSuggest()
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
      async () => new Response(null, { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof globalThis.fetch

    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    await clickSuggest()

    // useAiStream maps a non-ok response to `stream_http_<status>` and
    // flips to state='error'; AiOutputPanel renders the Helix error
    // affordance rather than any proposal preview.
    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent('stream_http_404')
    expect(screen.queryByTestId(APPLY_TESTID)).not.toBeInTheDocument()
  })

  it('re-enables the Suggest button after a completed run so a fresh POST can fire', async () => {
    mockUseSettings.mockReturnValue(enabled())
    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      const text = fetchCount === 1 ? 'First recommendation.' : 'Second recommendation.'
      return new Response(
        makeReadableStream([
          sseFrame('delta', { text }) +
            sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 5 } }),
        ]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    const root = screen.getByTestId(ROOT_TESTID)
    const button = await clickSuggest()
    await waitFor(() => expect(fetchCount).toBe(1))
    await waitFor(() => expect(root).toHaveTextContent('First recommendation.'))

    // After `done`, canStart recovers (state !== 'paused-confirm', not
    // streaming) so the button is enabled again for a follow-up run.
    await waitFor(() => expect(button).not.toBeDisabled())
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(2))
    await waitFor(() => expect(root).toHaveTextContent('Second recommendation.'))
    expect(root).not.toHaveTextContent('First recommendation.')
  })
})

// ── 4. Proposal capture + apply ───────────────────────────────────────────
describe('AIQuietHoursSuggestion — proposal capture + apply', () => {
  it('captures a valid tool_result proposal, renders the preview, and copies the typed patch on Apply', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const onApplyDraft = vi.fn()
    stubStreamOnce(draftSse(validProposal))

    render(<AIQuietHoursSuggestion onApplyDraft={onApplyDraft} />)
    await clickSuggest()

    // The preview lists the proposed window, weekday bitmask, and bypass
    // severities derived from the typed envelope.
    const apply = await screen.findByTestId(APPLY_TESTID)
    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toHaveTextContent('23:00')
    expect(root).toHaveTextContent('07:30')
    expect(root).toHaveTextContent('America/Los_Angeles')
    expect(root).toHaveTextContent(/Weekday bitmask:\s*127/)
    expect(root).toHaveTextContent(/Bypass severities:\s*critical/)

    // Apply is enabled once the stream has completed (isBusy false) and
    // forwards the exact scalar patch — enabled:true + the five window
    // fields — to the parent form, never persisting directly.
    expect(apply).not.toBeDisabled()
    expect(apply).toHaveAttribute('aria-disabled', 'false')
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyDraft).toHaveBeenCalledTimes(1)
    expect(onApplyDraft).toHaveBeenCalledWith(expectedApplyPatch)
  })

  it('renders the insufficient-history note when status=insufficient_history', async () => {
    mockUseSettings.mockReturnValue(enabled())
    stubStreamOnce(
      draftSse({ ...validProposal, status: 'insufficient_history' }, 'Conservative default.'),
    )

    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    await clickSuggest()

    await screen.findByTestId(APPLY_TESTID)
    expect(screen.getByText(/insufficient notification history/i)).toBeInTheDocument()
  })

  it('renders the existing-windows note only when existing_windows_count > 0', async () => {
    mockUseSettings.mockReturnValue(enabled())
    stubStreamOnce(draftSse({ ...validProposal, existing_windows_count: 3 }))

    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    await clickSuggest()

    const root = screen.getByTestId(ROOT_TESTID)
    await screen.findByTestId(APPLY_TESTID)
    await waitFor(() => expect(root).toHaveTextContent(/already have 3 quiet-hours window/i))
  })

  it('omits the existing-windows note when existing_windows_count is 0', async () => {
    mockUseSettings.mockReturnValue(enabled())
    stubStreamOnce(draftSse(validProposal))

    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    await clickSuggest()

    await screen.findByTestId(APPLY_TESTID)
    expect(screen.queryByText(/already have .* quiet-hours window/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/insufficient notification history/i)).not.toBeInTheDocument()
  })

  it('filters non-string bypass severities out of the applied patch (defensive narrowing)', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const onApplyDraft = vi.fn()
    // Wire in a dirty severities array with numbers/null mixed in.
    stubStreamOnce(
      draftSse({
        ...validProposal,
        bypass_severities: ['critical', 5, null, 'warn'],
      }),
    )

    render(<AIQuietHoursSuggestion onApplyDraft={onApplyDraft} />)
    await clickSuggest()

    const apply = await screen.findByTestId(APPLY_TESTID)
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyDraft).toHaveBeenCalledTimes(1)
    const patch = onApplyDraft.mock.calls[0][0] as QuietHoursWindowInput
    expect(patch.bypass_severities).toEqual(['critical', 'warn'])
  })

  it('defaults a missing status/existing_windows_count without dropping the proposal', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const onApplyDraft = vi.fn()
    // start/end/tz/weekdays/severities present, but status + count omitted
    // → the handler defaults status='ok', count=0 and still captures.
    stubStreamOnce(
      draftSse({
        start_local: '22:15',
        end_local: '06:45',
        timezone: 'UTC',
        weekdays: 62,
        bypass_severities: ['critical'],
      }),
    )

    render(<AIQuietHoursSuggestion onApplyDraft={onApplyDraft} />)
    await clickSuggest()

    const apply = await screen.findByTestId(APPLY_TESTID)
    // No insufficient-history / existing-windows notes on the defaults.
    expect(screen.queryByText(/insufficient notification history/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/already have .* quiet-hours window/i)).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyDraft).toHaveBeenCalledWith({
      enabled: true,
      start_local: '22:15',
      end_local: '06:45',
      timezone: 'UTC',
      weekdays: 62,
      bypass_severities: ['critical'],
    })
  })

  it('keeps Apply computed-disabled while a proposal is captured mid-stream (isBusy branch)', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const onApplyDraft = vi.fn()
    // Emit the tool_result then hold the connection open: the proposal is
    // captured but state stays 'streaming', so Apply must be disabled.
    globalThis.fetch = vi.fn(
      async () =>
        emitThenHang([sseFrame('tool_result', { id: 'tc1', name: TOOL_NAME, ok: true, data: validProposal })]),
    ) as unknown as typeof globalThis.fetch

    render(<AIQuietHoursSuggestion onApplyDraft={onApplyDraft} />)
    await clickSuggest()

    const apply = await screen.findByTestId(APPLY_TESTID)
    await waitFor(() => expect(apply).toBeDisabled())
    expect(apply).toHaveAttribute('aria-disabled', 'true')
    // Clicking a computed-disabled Apply mid-stream must not seed the form.
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyDraft).not.toHaveBeenCalled()
  })
})

// ── 5. Proposal rejects (fail-closed defensive parsing) ────────────────────
describe('AIQuietHoursSuggestion — rejects malformed tool_result frames', () => {
  const rejectCases: Array<[string, unknown]> = [
    ['a missing start_local', { ...validProposal, start_local: undefined }],
    ['a non-string end_local', { ...validProposal, end_local: 700 }],
    ['a missing timezone', { ...validProposal, timezone: undefined }],
    ['a non-number weekdays', { ...validProposal, weekdays: '127' }],
    ['a non-array bypass_severities', { ...validProposal, bypass_severities: 'critical' }],
    ['a null data payload', null],
  ]

  for (const [label, data] of rejectCases) {
    it(`drops ${label} (delta still renders, no proposal card)`, async () => {
      mockUseSettings.mockReturnValue(enabled())
      stubStreamOnce(draftSse(data, 'Attempted a recommendation.'))

      render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
      const root = screen.getByTestId(ROOT_TESTID)
      await clickSuggest()

      await waitFor(() => expect(root).toHaveTextContent('Attempted a recommendation.'))
      expect(screen.queryByTestId(APPLY_TESTID)).not.toBeInTheDocument()
    })
  }

  it('ignores a tool_result with ok=false (no proposal card)', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const sseBody =
      sseFrame('tool_result', {
        id: 'tc1',
        name: TOOL_NAME,
        ok: false,
        error: 'tool crashed',
      }) +
      sseFrame('delta', { text: 'Tool failed.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } })
    stubStreamOnce(sseBody)

    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    const root = screen.getByTestId(ROOT_TESTID)
    await clickSuggest()

    await waitFor(() => expect(root).toHaveTextContent('Tool failed.'))
    expect(screen.queryByTestId(APPLY_TESTID)).not.toBeInTheDocument()
  })

  it('ignores a tool_result addressed to a different tool name (no proposal card)', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const sseBody =
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'validate_quiet_hours_window',
        ok: true,
        data: validProposal,
      }) +
      sseFrame('delta', { text: 'Different tool ran.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } })
    stubStreamOnce(sseBody)

    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    const root = screen.getByTestId(ROOT_TESTID)
    await clickSuggest()

    await waitFor(() => expect(root).toHaveTextContent('Different tool ran.'))
    expect(screen.queryByTestId(APPLY_TESTID)).not.toBeInTheDocument()
  })
})

// ── 6. Lifecycle — re-suggest clears the stale proposal ────────────────────
describe('AIQuietHoursSuggestion — lifecycle', () => {
  it('clears a previously-captured proposal when the user suggests again', async () => {
    mockUseSettings.mockReturnValue(enabled())
    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      if (fetchCount === 1) {
        // First run captures a proposal, then completes.
        return new Response(makeReadableStream([draftSse(validProposal, 'First window.')]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      // Second run holds open with no tool_result — the old proposal must
      // have been cleared the instant Suggest was re-clicked.
      return pendingStreamResponse()
    }) as unknown as typeof globalThis.fetch

    render(<AIQuietHoursSuggestion onApplyDraft={vi.fn()} />)
    const button = await clickSuggest()
    await waitFor(() => expect(screen.getByTestId(APPLY_TESTID)).toBeInTheDocument())
    await waitFor(() => expect(button).not.toBeDisabled())

    // Re-suggest: handleSuggest calls setProposal(null) before start(), so
    // the stale preview + Apply button disappear immediately.
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(screen.queryByTestId(APPLY_TESTID)).not.toBeInTheDocument())
    expect(fetchCount).toBe(2)
  })
})
