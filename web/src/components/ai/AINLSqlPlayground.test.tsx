// Comprehensive unit + behaviour coverage for AINLSqlPlayground —
// the co-located Project Apex elevation test.
//
// The module's runtime surface is a single export
// (`AINLSqlPlayground`, an InnerSection wrapped with withAiFeature)
// plus the exported `ReadonlySQLDraft` / `AINLSqlPlaygroundProps`
// types. Like the sibling capture features it turns a free-text prompt
// into a POST /api/v1/ai/power/sql/draft SSE stream and captures the
// typed `draft_readonly_sql` tool_result into a propose-only "Apply to
// editor" hand-off, so the facets worth exercising are:
//
//   - the ADR-015 AI-off visibility gate (off-mode, per-feature toggle
//     off, and the positive control that proves the gate is real);
//   - the input gate: the Draft button's `disabled` is a COMPUTED
//     expression (`!canDraft`), never a literal `disabled`, proved
//     across empty / whitespace-only / non-empty prompts plus the
//     no-request-on-disabled-click guard;
//   - the SSE wiring contract (exactly one POST to the registered
//     `/api/v1/ai/power/sql/draft` route with the correct method /
//     headers and the `{ prompt }` body, including the whitespace-trim
//     path);
//   - the streaming lifecycle (thinking indicator + disabled button
//     while in flight, double-submit guard, HTTP-error + error-frame
//     fallbacks rendered in AiOutputPanel);
//   - the typed-draft capture path (a full valid draft surfacing the
//     "Apply to editor" button and forwarding the exact typed payload
//     via onApply, the referenced_tables string-filter, and every
//     rejection branch: wrong tool name, ok=false, status!='ok',
//     malformed field, missing draft);
//   - the stale-draft invalidation fix (editing the prompt after a
//     draft is captured clears the proposal so it can never be
//     applied against a mismatched prompt); and
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
import {
  AINLSqlPlayground,
  type ReadonlySQLDraft,
} from '@/components/ai/AINLSqlPlayground'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-nl-sql-playground-root'
const DRAFT_ROUTE = '/api/v1/ai/power/sql/draft'

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
      ai_features: { 'nl-sql-playground': true },
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

const doneFrame = sseFrame('done', {
  finish_reason: 'stop',
  usage: { in: 10, out: 5 },
})

// draftFrame mirrors the ReadonlySQLDraft envelope the draft_readonly_sql
// tool emits (internal/ai/tools/nl_sql_playground.go). The component
// requires `data.status === 'ok'` AND a well-typed `data.draft`.
function draftFrame(
  draft: unknown,
  opts: { name?: string; ok?: boolean; status?: string } = {},
): string {
  return sseFrame('tool_result', {
    id: 'tc1',
    name: opts.name ?? 'draft_readonly_sql',
    ok: opts.ok ?? true,
    data: {
      status: opts.status ?? 'ok',
      draft,
    },
  })
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
  // per-feature verb ("Draft SQL") lives in the aria-label, so the
  // accessible name reads "Ask Helix · Draft SQL".
  return screen.getByRole('button', { name: /Draft SQL/i })
}

function promptBox(): HTMLElement {
  return screen.getByLabelText(/SQL request/i)
}

function queryApplyButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: /Apply to editor/i })
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

// A fully-populated, well-typed draft — exercises the ReadonlySQLDraft
// type surface and the whole parse path at once.
const validDraft: ReadonlySQLDraft = {
  prompt: 'how many drives did I take last week',
  sql: "SELECT count(*) FROM drives WHERE started_at > now() - interval '7 days'",
  rationale: 'Counts rows in the drives table started within the last 7 days.',
  referenced_tables: ['drives'],
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

describe('AINLSqlPlayground — AI-off visibility gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the per-feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'nl-sql-playground': true },
      }),
    )

    const { container } = render(<AINLSqlPlayground onApply={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Draft SQL/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/SQL request/i)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode!=off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'nl-sql-playground': false },
      }),
    )

    const { container } = render(<AINLSqlPlayground onApply={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) with title, badge, prompt box and a disabled Draft button when both mode and toggle are on', () => {
    enableFeature()

    render(<AINLSqlPlayground onApply={vi.fn()} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'nl-sql-playground')

    // The deterministic title + badge copy renders.
    expect(
      screen.getByText('Helix natural-language SQL drafter'),
    ).toBeInTheDocument()
    expect(screen.getByText('Helix')).toBeInTheDocument()

    // The prompt Textarea renders with its accessible label + placeholder.
    const box = promptBox()
    expect(box.tagName).toBe('TEXTAREA')
    expect(box).toHaveAttribute(
      'placeholder',
      expect.stringContaining('how many drives'),
    )

    // Empty prompt → Draft button disabled (computed, not literal) with
    // screen-reader parity, and the per-feature verb survives in the
    // accessible name.
    const button = draftButton()
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button.getAttribute('aria-label') ?? '').toContain('Ask Helix')

    // Idle: no output panel and no Apply button yet.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    expect(queryApplyButton()).not.toBeInTheDocument()
  })
})

describe('AINLSqlPlayground — input gate (computed disabled + trim)', () => {
  it('keeps the Draft button disabled for an empty prompt', () => {
    enableFeature()

    render(<AINLSqlPlayground onApply={vi.fn()} />)

    expect(draftButton()).toBeDisabled()
    expect(draftButton()).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps the Draft button disabled for a whitespace-only prompt (trim path)', async () => {
    enableFeature()

    render(<AINLSqlPlayground onApply={vi.fn()} />)
    await typePrompt('   \t \n  ')

    // trim() collapses whitespace to '' → hasPrompt false → the button
    // stays disabled.
    expect(draftButton()).toBeDisabled()
  })

  it('enables the Draft button once a non-empty prompt is typed', async () => {
    enableFeature()

    render(<AINLSqlPlayground onApply={vi.fn()} />)
    expect(draftButton()).toBeDisabled()

    await typePrompt('count my charging sessions this month')

    expect(draftButton()).toBeEnabled()
    expect(draftButton()).toHaveAttribute('aria-disabled', 'false')
  })

  it('does not open a stream when the (disabled) Draft button is clicked without a prompt', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(<AINLSqlPlayground onApply={vi.fn()} />)

    await act(async () => {
      fireEvent.click(draftButton())
    })
    // Give any rogue fetch a macrotask to land.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(0)
  })
})

describe('AINLSqlPlayground — SSE wiring contract', () => {
  it('POSTs exactly once to the registered route with the { prompt } body and correct headers and renders the first delta', async () => {
    enableFeature()
    const sseBody =
      sseFrame('delta', { text: 'Drafting a read-only SELECT for you…' }) +
      doneFrame
    const calls = installStreamingFetch(sseBody)

    render(<AINLSqlPlayground onApply={vi.fn()} />)
    await typePrompt('how many drives did I take last week')
    await clickDraft()

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(DRAFT_ROUTE)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      prompt: 'how many drives did I take last week',
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // The streamed narration renders inside the gated wrapper's panel.
    const root = screen.getByTestId(ROOT_TESTID)
    await waitFor(() => {
      expect(root).toHaveTextContent(/Drafting a read-only SELECT/)
    })
    expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
      /read-only SELECT/,
    )
  })

  it('sends the trimmed prompt in the request body', async () => {
    enableFeature()
    const calls = installStreamingFetch(doneFrame)

    render(<AINLSqlPlayground onApply={vi.fn()} />)
    // Leading / trailing whitespace must be stripped before it reaches
    // the handler-side parser.
    await typePrompt('   drives per weekday   ')
    await clickDraft()

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe(DRAFT_ROUTE)
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      prompt: 'drives per weekday',
    })
  })
})

describe('AINLSqlPlayground — streaming lifecycle', () => {
  it('shows the thinking indicator and disables the button while streaming', async () => {
    enableFeature()
    installNeverClosingFetch()

    render(<AINLSqlPlayground onApply={vi.fn()} />)
    await typePrompt('total energy used last month')
    const button = await clickDraft()

    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByTestId('ai-thinking-indicator')).toBeInTheDocument()
    expect(button).toHaveTextContent(/Helix is thinking/)
  })

  it('guards against double-submit: a second click while streaming issues no new request', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(<AINLSqlPlayground onApply={vi.fn()} />)
    await typePrompt('average trip distance')
    const button = await clickDraft()

    await waitFor(() => expect(tracker.count()).toBe(1))
    await waitFor(() => expect(button).toBeDisabled())

    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(1)
  })

  it('surfaces an HTTP error in the output panel when the stream route returns non-2xx and captures no draft', async () => {
    enableFeature()
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(<AINLSqlPlayground onApply={vi.fn()} />)
    await typePrompt('rows per table')
    await clickDraft()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
    expect(queryApplyButton()).not.toBeInTheDocument()
  })

  it('surfaces a terminal SSE error frame in the output panel', async () => {
    enableFeature()
    installStreamingFetch(sseFrame('error', { message: 'provider_unavailable' }))

    render(<AINLSqlPlayground onApply={vi.fn()} />)
    await typePrompt('longest drive this year')
    await clickDraft()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/provider_unavailable/)
    })
  })
})

describe('AINLSqlPlayground — typed draft capture + Apply hand-off', () => {
  it('captures a valid draft_readonly_sql tool_result, shows the Apply button, and forwards the exact typed payload via onApply', async () => {
    enableFeature()
    const onApply = vi.fn()
    installStreamingFetch(draftFrame(validDraft) + doneFrame)

    render(<AINLSqlPlayground onApply={onApply} />)
    await typePrompt('how many drives did I take last week')
    await clickDraft()

    const apply = await screen.findByRole('button', { name: /Apply to editor/i })
    expect(apply).toBeEnabled()
    expect(apply).toHaveAttribute('aria-disabled', 'false')
    // The tooltip advertises the propose-only, review-before-run contract.
    expect(apply.getAttribute('title') ?? '').toMatch(/before clicking Run/i)

    // onApply is called with the exact parsed ReadonlySQLDraft — nothing
    // is written until the user clicks (propose-only).
    expect(onApply).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(validDraft)
  })

  it('filters non-string entries out of referenced_tables before handing the draft to onApply', async () => {
    enableFeature()
    const onApply = vi.fn()
    installStreamingFetch(
      draftFrame({
        prompt: 'join drives and charging',
        sql: 'SELECT * FROM drives JOIN charging_sessions USING (vehicle_id)',
        rationale: 'Correlate drives with charging.',
        referenced_tables: ['drives', 42, null, { x: 1 }, 'charging_sessions'],
      }) + doneFrame,
    )

    render(<AINLSqlPlayground onApply={onApply} />)
    await typePrompt('join drives and charging')
    await clickDraft()
    const apply = await screen.findByRole('button', { name: /Apply to editor/i })
    await act(async () => {
      fireEvent.click(apply)
    })

    expect(onApply).toHaveBeenCalledTimes(1)
    const passed = onApply.mock.calls[0][0] as ReadonlySQLDraft
    expect(passed.referenced_tables).toEqual(['drives', 'charging_sessions'])
  })

  it('defaults referenced_tables to an empty array when the field is absent or not an array', async () => {
    enableFeature()
    const onApply = vi.fn()
    installStreamingFetch(
      draftFrame({
        prompt: 'row counts',
        sql: 'SELECT 1',
        rationale: 'Trivial.',
        // referenced_tables intentionally omitted.
      }) + doneFrame,
    )

    render(<AINLSqlPlayground onApply={onApply} />)
    await typePrompt('row counts')
    await clickDraft()
    const apply = await screen.findByRole('button', { name: /Apply to editor/i })
    await act(async () => {
      fireEvent.click(apply)
    })

    expect(onApply).toHaveBeenCalledTimes(1)
    expect((onApply.mock.calls[0][0] as ReadonlySQLDraft).referenced_tables).toEqual([])
  })

  it('ignores a tool_result frame from a different tool name', async () => {
    enableFeature()
    installStreamingFetch(
      draftFrame(validDraft, { name: 'query_catalog' }) + doneFrame,
    )

    render(<AINLSqlPlayground onApply={vi.fn()} />)
    await typePrompt('how many drives did I take last week')
    await clickDraft()

    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument(),
    )
    expect(queryApplyButton()).not.toBeInTheDocument()
  })

  it('rejects a failed (ok=false) draft_readonly_sql tool_result even if the payload looks valid', async () => {
    enableFeature()
    installStreamingFetch(
      draftFrame(validDraft, { ok: false }) + doneFrame,
    )

    render(<AINLSqlPlayground onApply={vi.fn()} />)
    await typePrompt('how many drives did I take last week')
    await clickDraft()

    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument(),
    )
    // ok=false means the tool errored — no proposal must be captured.
    expect(queryApplyButton()).not.toBeInTheDocument()
  })

  it('rejects an envelope whose status is not "ok"', async () => {
    enableFeature()
    installStreamingFetch(
      draftFrame(validDraft, { status: 'rejected' }) + doneFrame,
    )

    render(<AINLSqlPlayground onApply={vi.fn()} />)
    await typePrompt('how many drives did I take last week')
    await clickDraft()

    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument(),
    )
    expect(queryApplyButton()).not.toBeInTheDocument()
  })

  it('rejects a malformed draft (a non-string sql field)', async () => {
    enableFeature()
    installStreamingFetch(
      draftFrame({
        prompt: 'x',
        sql: 123, // not a string → parse must return null
        rationale: 'y',
        referenced_tables: [],
      }) + doneFrame,
    )

    render(<AINLSqlPlayground onApply={vi.fn()} />)
    await typePrompt('how many drives did I take last week')
    await clickDraft()

    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument(),
    )
    expect(queryApplyButton()).not.toBeInTheDocument()
  })

  it('rejects an envelope with a missing draft object', async () => {
    enableFeature()
    // status ok but no draft at all.
    installStreamingFetch(
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_readonly_sql',
        ok: true,
        data: { status: 'ok' },
      }) + doneFrame,
    )

    render(<AINLSqlPlayground onApply={vi.fn()} />)
    await typePrompt('how many drives did I take last week')
    await clickDraft()

    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument(),
    )
    expect(queryApplyButton()).not.toBeInTheDocument()
  })
})

describe('AINLSqlPlayground — stale-draft invalidation (regression guard)', () => {
  it('clears the captured draft when the prompt is edited so a mismatched proposal can never be applied', async () => {
    enableFeature()
    const onApply = vi.fn()
    installStreamingFetch(draftFrame(validDraft) + doneFrame)

    render(<AINLSqlPlayground onApply={onApply} />)
    await typePrompt('how many drives did I take last week')
    await clickDraft()

    // Draft captured → Apply button present.
    await screen.findByRole('button', { name: /Apply to editor/i })

    // Editing the request must invalidate the stale proposal.
    await typePrompt('how many charging sessions this month')

    expect(queryApplyButton()).not.toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })
})

describe('AINLSqlPlayground — public surface', () => {
  it('exposes a stable displayName for the gated component', () => {
    expect(AINLSqlPlayground.displayName).toBe('AINLSqlPlayground')
  })
})
