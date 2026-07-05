// Co-located unit + wiring test for AINLDashboardComposer.
//
// The module exports the gated
// `withAiFeature('nl-dashboard-composer', InnerSection)` component plus
// the pure `parseDashboardLayoutDraft` envelope narrower (exported for
// direct testing, mirroring `parseSSEFrame` in useAiStream). This suite
// covers every observable facet so the file can be marked
// production-grade:
//
//   1. parseDashboardLayoutDraft (pure): the well-formed happy path, the
//      strict top-level null branches (non-object / wrong status /
//      missing prompt·rationale·title), per-slot drop-on-invalid, the
//      non-finite-coordinate guard (NaN / Infinity), and the
//      slots/referenced_panels defaulting + string filtering.
//
//   2. Render gate (ADR-015 §I5/§I6): the surface is entirely absent
//      when ai_mode='off' OR the per-feature toggle is off OR the
//      ai_features map is absent OR settings are unresolved, and present
//      (with the registered `ai-feature-nl-dashboard-composer-root` test
//      id) only when the mode is a non-off mode AND the toggle is true.
//      The positive controls prove the negatives are not trivially true.
//
//   3. Enabled surface + a11y: the card renders the Helix heading, the
//      propose-only description, the "Helix" badge, and a LABELLED
//      prompt textarea. The Draft button is a COMPUTED-disabled control
//      (never a literal `disabled`) that stays disabled until a
//      non-empty, trimmed prompt is entered, and no output panel or
//      Apply affordance shows before a draft has run.
//
//   4. On-mode SSE wiring: clicking Draft POSTs exactly once to the
//      registered route /api/v1/ai/power/dashboard/draft with the typed
//      `{prompt}` body (trimmed) + SSE headers, shows the thinking
//      indicator, coalesces a double-submit, and surfaces a stream error
//      on a non-2xx response.
//
//   5. Draft capture + apply (propose-only contract, ADR-015 §I8): a
//      successful draft_dashboard_layout tool_result enables "Apply to
//      editor", and clicking it invokes the `onApply` prop with the
//      parsed draft — the component never writes editor state itself. A
//      FAILED tool_result (ok=false), or one for a different tool name,
//      is ignored; and starting a fresh draft clears the previous one.
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
  AINLDashboardComposer,
  parseDashboardLayoutDraft,
  type DashboardLayoutDraft,
} from '@/components/ai/AINLDashboardComposer'

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
    ai_features: { 'nl-dashboard-composer': true },
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

const ROOT_TESTID = 'ai-feature-nl-dashboard-composer-root'
const FEATURE_ID = 'nl-dashboard-composer'
const ROUTE = '/api/v1/ai/power/dashboard/draft'
const DRAFT_BUTTON = /Draft dashboard/i
const APPLY_BUTTON = /Apply to editor/i
const TITLE = /Helix natural-language dashboard composer/i
const DESCRIPTION = /Describe the dashboard you want/i

// A canonical successful tool envelope + its expected parsed draft.
// `source` is an extra field the tool emits that the parser ignores.
const VALID_DRAFT_DATA = {
  status: 'ok',
  source: 'tools.draft_dashboard_layout',
  draft: {
    prompt: 'give me an overview dashboard',
    dashboard: {
      title: 'Fleet overview',
      slots: [
        { panel_name: 'drives_per_day_timeseries', grid_pos: { x: 0, y: 0, w: 24, h: 8 } },
        { panel_name: 'battery_soc_stat', grid_pos: { x: 0, y: 8, w: 12, h: 6 } },
      ],
    },
    rationale: 'stacks daily drives over current battery',
    referenced_panels: ['drives_per_day_timeseries', 'battery_soc_stat'],
  },
}

const EXPECTED_DRAFT: DashboardLayoutDraft = {
  prompt: 'give me an overview dashboard',
  dashboard: {
    title: 'Fleet overview',
    slots: [
      { panel_name: 'drives_per_day_timeseries', grid_pos: { x: 0, y: 0, w: 24, h: 8 } },
      { panel_name: 'battery_soc_stat', grid_pos: { x: 0, y: 8, w: 12, h: 6 } },
    ],
  },
  rationale: 'stacks daily drives over current battery',
  referenced_panels: ['drives_per_day_timeseries', 'battery_soc_stat'],
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

describe('parseDashboardLayoutDraft — envelope narrowing (pure)', () => {
  it('narrows a well-formed payload into a fully typed draft, keeping valid slots + referenced_panels', () => {
    const result = parseDashboardLayoutDraft(VALID_DRAFT_DATA)

    expect(result).not.toBeNull()
    expect(result).toEqual(EXPECTED_DRAFT)
    // Spot-check the nested typed shape (exercises the exported
    // DashboardSlot / DashboardSlotGrid interfaces).
    expect(result?.dashboard.slots).toHaveLength(2)
    expect(result?.dashboard.slots[0].panel_name).toBe('drives_per_day_timeseries')
    expect(result?.dashboard.slots[0].grid_pos.w).toBe(24)
    expect(result?.referenced_panels).toContain('battery_soc_stat')
  })

  it('returns null for non-object payloads and for a missing/wrong tool status', () => {
    expect(parseDashboardLayoutDraft(null)).toBeNull()
    expect(parseDashboardLayoutDraft(undefined)).toBeNull()
    expect(parseDashboardLayoutDraft('not-an-object')).toBeNull()
    expect(parseDashboardLayoutDraft(42)).toBeNull()
    // status must be exactly 'ok'
    expect(parseDashboardLayoutDraft({ status: 'error', draft: VALID_DRAFT_DATA.draft })).toBeNull()
    expect(parseDashboardLayoutDraft({ draft: VALID_DRAFT_DATA.draft })).toBeNull()
    // draft envelope missing entirely
    expect(parseDashboardLayoutDraft({ status: 'ok' })).toBeNull()
  })

  it('returns null when a required top-level field (prompt / rationale / title) is missing or wrong-typed', () => {
    const base = VALID_DRAFT_DATA.draft

    expect(
      parseDashboardLayoutDraft({ status: 'ok', draft: { ...base, prompt: 123 } }),
    ).toBeNull()
    expect(
      parseDashboardLayoutDraft({ status: 'ok', draft: { ...base, rationale: undefined } }),
    ).toBeNull()
    expect(
      parseDashboardLayoutDraft({
        status: 'ok',
        draft: { ...base, dashboard: { ...base.dashboard, title: 99 } },
      }),
    ).toBeNull()
    // dashboard not an object at all
    expect(
      parseDashboardLayoutDraft({ status: 'ok', draft: { ...base, dashboard: 'nope' } }),
    ).toBeNull()
  })

  it('drops individually-invalid slots but keeps the valid ones', () => {
    const data = {
      status: 'ok',
      draft: {
        prompt: 'p',
        rationale: 'r',
        dashboard: {
          title: 'Mixed',
          slots: [
            { panel_name: 'good', grid_pos: { x: 1, y: 2, w: 3, h: 4 } }, // valid
            { panel_name: 123, grid_pos: { x: 0, y: 0, w: 1, h: 1 } }, // bad name
            { panel_name: 'no-grid' }, // missing grid_pos
            { panel_name: 'string-coord', grid_pos: { x: '0', y: 0, w: 1, h: 1 } }, // non-number
            'not-an-object',
            null,
          ],
        },
        referenced_panels: [],
      },
    }

    const result = parseDashboardLayoutDraft(data)

    expect(result?.dashboard.slots).toHaveLength(1)
    expect(result?.dashboard.slots[0]).toEqual({
      panel_name: 'good',
      grid_pos: { x: 1, y: 2, w: 3, h: 4 },
    })
  })

  it('rejects slots whose grid coordinates are non-finite (NaN / Infinity)', () => {
    const data = {
      status: 'ok',
      draft: {
        prompt: 'p',
        rationale: 'r',
        dashboard: {
          title: 'Non-finite',
          slots: [
            { panel_name: 'nan-x', grid_pos: { x: NaN, y: 0, w: 1, h: 1 } },
            { panel_name: 'inf-w', grid_pos: { x: 0, y: 0, w: Infinity, h: 1 } },
            { panel_name: 'ok', grid_pos: { x: 0, y: 0, w: 6, h: 4 } },
          ],
        },
        referenced_panels: [],
      },
    }

    const result = parseDashboardLayoutDraft(data)

    // Only the finite slot survives — the NaN/Infinity ones are dropped.
    expect(result?.dashboard.slots).toHaveLength(1)
    expect(result?.dashboard.slots[0].panel_name).toBe('ok')
  })

  it('defaults slots / referenced_panels to [] and filters non-string panel refs', () => {
    // slots not an array + referenced_panels absent -> both default to []
    const missing = parseDashboardLayoutDraft({
      status: 'ok',
      draft: { prompt: 'p', rationale: 'r', dashboard: { title: 'T', slots: 'nope' } },
    })
    expect(missing?.dashboard.slots).toEqual([])
    expect(missing?.referenced_panels).toEqual([])

    // referenced_panels with mixed types -> only strings survive
    const mixed = parseDashboardLayoutDraft({
      status: 'ok',
      draft: {
        prompt: 'p',
        rationale: 'r',
        dashboard: { title: 'T', slots: [] },
        referenced_panels: ['a', 1, 'b', null, {}, 'c'],
      },
    })
    expect(mixed?.referenced_panels).toEqual(['a', 'b', 'c'])
  })
})

describe('AINLDashboardComposer — AI-off render gate', () => {
  it('renders nothing when ai_mode=off even with the nl-dashboard-composer toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { 'nl-dashboard-composer': true } }),
    )

    const { container } = render(<AINLDashboardComposer onApply={() => {}} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: DRAFT_BUTTON })).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is off even with ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { 'nl-dashboard-composer': false } }),
    )

    const { container } = render(<AINLDashboardComposer onApply={() => {}} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the ai_features map is entirely absent (fail-closed)', () => {
    mockUseSettings.mockReturnValue(settingsPayload({ ai_mode: 'cloud', ai_features: undefined }))

    const { container } = render(<AINLDashboardComposer onApply={() => {}} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing while settings are still unresolved (settings undefined)', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(<AINLDashboardComposer onApply={() => {}} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) when ai_mode=cloud AND the toggle is on', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AINLDashboardComposer onApply={() => {}} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: DRAFT_BUTTON })).toBeInTheDocument()
  })

  it('also renders under ai_mode=local (local is a non-off mode)', () => {
    mockUseSettings.mockReturnValue(enabled({ ai_mode: 'local' }))

    render(<AINLDashboardComposer onApply={() => {}} />)

    expect(screen.getByTestId(ROOT_TESTID)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: DRAFT_BUTTON })).toBeInTheDocument()
  })
})

describe('AINLDashboardComposer — enabled surface structure + a11y', () => {
  it('renders the heading, propose-only description, Helix badge, and a labelled prompt textarea', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AINLDashboardComposer onApply={() => {}} />)

    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument()
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument()
    // The "Helix" brand badge sits in the header.
    expect(screen.getAllByText('Helix').length).toBeGreaterThan(0)
    // The prompt input is an accessible textbox with an aria-label so
    // screen-reader users know what to type.
    const textarea = screen.getByRole('textbox', { name: /Dashboard request/i })
    expect(textarea).toBeInTheDocument()
    expect(textarea.tagName).toBe('TEXTAREA')
  })

  it('keeps the Draft button computed-disabled until a non-empty, trimmed prompt is entered', async () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AINLDashboardComposer onApply={() => {}} />)

    const button = screen.getByRole('button', { name: DRAFT_BUTTON })
    const textarea = screen.getByRole('textbox', { name: /Dashboard request/i })

    // Empty prompt -> disabled (computed) with aria-disabled mirror.
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // Visible label is the universal Helix CTA; the per-feature verb
    // lives in the tooltip + accessible name.
    expect(button).toHaveTextContent(/Ask Helix/i)
    expect(button).toHaveAttribute('title', expect.stringMatching(DRAFT_BUTTON))

    // Whitespace-only prompt is still empty after trim -> stays disabled.
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '    ' } })
    })
    expect(button).toBeDisabled()

    // A real prompt enables the button.
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'overview dashboard' } })
    })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
  })

  it('shows no output panel and no Apply button before any draft has run', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AINLDashboardComposer onApply={() => {}} />)

    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-thinking-indicator')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: APPLY_BUTTON })).not.toBeInTheDocument()
  })
})

describe('AINLDashboardComposer — on-mode SSE wiring', () => {
  it('POSTs once to the registered route with the trimmed {prompt} body + SSE headers and shows the thinking indicator', async () => {
    mockUseSettings.mockReturnValue(enabled())

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      // A stream that never enqueues/closes holds state === 'streaming'.
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            /* never enqueue, never close */
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AINLDashboardComposer onApply={() => {}} />)

    const textarea = screen.getByRole('textbox', { name: /Dashboard request/i })
    await act(async () => {
      // Surrounding whitespace proves the body is trimmed end-to-end.
      fireEvent.change(textarea, { target: { value: '  overview dashboard  ' } })
    })

    const button = screen.getByRole('button', { name: DRAFT_BUTTON })
    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe(ROUTE)
    expect(init?.method).toBe('POST')
    expect(typeof init?.body).toBe('string')
    expect(JSON.parse(init?.body as string)).toEqual({ prompt: 'overview dashboard' })

    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // While streaming: thinking indicator (role=status) + computed-disabled button.
    const indicator = await screen.findByTestId('ai-thinking-indicator')
    expect(indicator).toHaveAttribute('role', 'status')
    await waitFor(() => expect(button).toBeDisabled())
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
            /* never enqueue, never close — keeps state='streaming' */
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AINLDashboardComposer onApply={() => {}} />)

    const textarea = screen.getByRole('textbox', { name: /Dashboard request/i })
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'a charging dashboard' } })
    })

    const button = screen.getByRole('button', { name: DRAFT_BUTTON })
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))
    await waitFor(() => expect(button).toBeDisabled())

    // fireEvent bypasses the disabled attribute, exercising the hook's
    // runningRef coalescer directly (defence in depth).
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

    render(<AINLDashboardComposer onApply={() => {}} />)

    const textarea = screen.getByRole('textbox', { name: /Dashboard request/i })
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'overview dashboard' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: DRAFT_BUTTON }))
    })

    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent('stream_http_404')
    // No draft was captured, so the Apply affordance stays absent.
    expect(screen.queryByRole('button', { name: APPLY_BUTTON })).not.toBeInTheDocument()
  })
})

describe('AINLDashboardComposer — draft capture + apply (propose-only contract)', () => {
  function draftStreamFetch(toolResult: Record<string, unknown>) {
    const sseBody =
      sseFrame('delta', { text: 'Drafting an overview dashboard.' }) +
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
    const textarea = screen.getByRole('textbox', { name: /Dashboard request/i })
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'give me an overview dashboard' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: DRAFT_BUTTON }))
    })
  }

  it('captures a successful draft_dashboard_layout tool_result and applies the parsed draft on click', async () => {
    mockUseSettings.mockReturnValue(enabled())
    globalThis.fetch = draftStreamFetch({
      id: 'call-1',
      name: 'draft_dashboard_layout',
      ok: true,
      data: VALID_DRAFT_DATA,
    })

    const onApply = vi.fn<(draft: DashboardLayoutDraft) => void>()
    render(<AINLDashboardComposer onApply={onApply} />)

    const root = screen.getByTestId(ROOT_TESTID)
    await typeAndDraft()

    // The streamed delta renders inside the gated wrapper.
    await waitFor(() => expect(root).toHaveTextContent('Drafting an overview dashboard.'))

    // After the tool_result lands the Apply button enables.
    const applyButton = await screen.findByRole('button', { name: APPLY_BUTTON })
    await waitFor(() => expect(applyButton).not.toBeDisabled())
    expect(applyButton).toHaveAttribute('aria-disabled', 'false')

    await act(async () => {
      fireEvent.click(applyButton)
    })

    // Propose-only: the component never writes editor state; it hands the
    // parsed draft to the page via onApply.
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(EXPECTED_DRAFT)
  })

  it('ignores a FAILED tool_result (ok=false) even when its data is a valid-looking draft', async () => {
    mockUseSettings.mockReturnValue(enabled())
    globalThis.fetch = draftStreamFetch({
      id: 'call-1',
      name: 'draft_dashboard_layout',
      ok: false,
      error: 'panel not in catalog',
      data: VALID_DRAFT_DATA,
    })

    const onApply = vi.fn<(draft: DashboardLayoutDraft) => void>()
    render(<AINLDashboardComposer onApply={onApply} />)

    const root = screen.getByTestId(ROOT_TESTID)
    await typeAndDraft()

    // The delta still renders (stream ran) but no draft was captured, so
    // the Apply affordance never appears and onApply is never called.
    await waitFor(() => expect(root).toHaveTextContent('Drafting an overview dashboard.'))
    // Button re-enables after `done`, proving the stream completed.
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
      name: 'validate_dashboard_layout',
      ok: true,
      data: VALID_DRAFT_DATA,
    })

    const onApply = vi.fn<(draft: DashboardLayoutDraft) => void>()
    render(<AINLDashboardComposer onApply={onApply} />)

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
              name: 'draft_dashboard_layout',
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

    render(<AINLDashboardComposer onApply={() => {}} />)

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
