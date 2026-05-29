// Inbox auto-categorization AI-off contract test.
//
// `TestInboxCategorizationAIOffNoAutoLabels` is the React-side companion
// to the Go test of the same name. It mounts the
// AIInboxAutoCategorization component with ai_mode='off' (plus
// the per-feature toggle on, to defeat the obvious "off because
// nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND inbox-auto-categorization=true,
//      the section IS present + carries the expected test ID.
//      This is the positive control that proves the gate
//      actually works (otherwise the "absent in off mode"
//      assertion is trivially true).
//
// Also asserts the on-mode wiring contract:
//   - clicking "Suggest categories" POSTs exactly one request to
//     `/api/v1/ai/alerts/inbox/categorize`.
//   - the first delta event's text renders inside the gated
//     wrapper.
//   - a second click while streaming is a no-op (double-submit
//     guard).
//   - the proposal preview renders after a tool_result frame and
//     the "Apply categories as filter" button calls
//     onApplyCategories with the deduplicated rule_id list (proves
//     the typed draft → baseline filter copy path; the AI panel
//     never persists state directly).
//
// The HTTP /api/v1/ai/alerts/inbox/categorize 404-in-off-mode
// invariant is proven by the Go-side
// TestInboxCategorizationAIOffNoAutoLabels in
// internal/api/ai_inbox_categorization_handler_test.go — the
// network layer does not exist in the React unit-test scope.
//
// File name MUST stay
// `TestInboxCategorizationAIOffNoAutoLabels.test.tsx` because
// `vitest --run TestInboxCategorizationAIOffNoAutoLabels` matches the
// positional pattern against the file path.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIInboxAutoCategorization } from '@/components/ai/AIInboxAutoCategorization'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

// baseSettings is a complete AppSettings with realistic non-AI
// defaults. Per-test cases override `ai_mode` + `ai_features` to
// exercise the off-mode (negative) and on-mode (positive
// control) paths.
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

// makeReadableStream constructs a ReadableStream<Uint8Array>
// from arbitrarily-sized text chunks. Mirrors the helper used
// by useAiStream.test.ts so the parser receives byte-for-byte
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

// sseFrame formats a single SSE event the way
// internal/ai/stream/writer.go emits it (`event: <name>\ndata:
// <json>\n\n`).
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

beforeEach(() => {
  mockUseSettings.mockReset()
  // Default fetch mock yells if a test forgets to install its
  // own — surfaces miswiring as a clear failure rather than a
  // silent timeout.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TestInboxCategorizationAIOffNoAutoLabels (inbox-auto-categorization AI-off contract)', () => {
  it('TestInboxCategorizationAIOffNoAutoLabels: renders nothing when ai_mode=off even with the inbox-auto-categorization toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle (ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'inbox-auto-categorization': true },
      }),
    )

    const { container } = render(
      <AIInboxAutoCategorization onApplyCategories={vi.fn()} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByTestId('ai-feature-inbox-auto-categorization-root'),
    ).not.toBeInTheDocument()
  })

  it('TestInboxCategorizationAIOffNoAutoLabels: renders nothing when ai_mode is non-off but the inbox-auto-categorization toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'inbox-auto-categorization': false },
      }),
    )

    const { container } = render(
      <AIInboxAutoCategorization onApplyCategories={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByTestId('ai-feature-inbox-auto-categorization-root'),
    ).not.toBeInTheDocument()
  })

  it('TestInboxCategorizationAIOffNoAutoLabels: renders the section when ai_mode=cloud AND inbox-auto-categorization toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'inbox-auto-categorization': true },
      }),
    )

    render(<AIInboxAutoCategorization onApplyCategories={vi.fn()} />)
    const root = screen.getByTestId(
      'ai-feature-inbox-auto-categorization-root',
    )
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'inbox-auto-categorization',
    )
  })
})

describe('TestInboxCategorizationAIOnWiredCallsRoute (inbox-auto-categorization on-mode SPA wiring)', () => {
  it('TestInboxCategorizationAIOnWiredCallsRoute: clicking Suggest POSTs once to /api/v1/ai/alerts/inbox/categorize and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'inbox-auto-categorization': true },
      }),
    )

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text:
          'Inbox histogram for the last 7 days: 18 battery alerts, 7 tire alerts, 4 charging alerts — descriptive replay only.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(
      <AIInboxAutoCategorization
        vehicleId={7}
        windowDays={7}
        severities={['warn', 'critical']}
        onApplyCategories={vi.fn()}
      />,
    )

    // 1) The gated wrapper renders with the registered test ID.
    const root = screen.getByTestId(
      'ai-feature-inbox-auto-categorization-root',
    )
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'inbox-auto-categorization',
    )

    // 2) Suggest button is enabled (not streaming).
    const button = screen.getByRole('button', { name: /Suggest categories/i })
    expect(button).toBeInTheDocument()
    expect(button).not.toBeDisabled()

    // 3) Click — fires the SSE stream against the registered route.
    await act(async () => {
      fireEvent.click(button)
    })

    // 4) Exactly one fetch must have been enqueued, against the
    // registered backend path. useAiStream prepends
    // `${getApiBase()}/api/v1`; getApiBase returns '' in the test
    // environment, so the final URL is
    // `/api/v1/ai/alerts/inbox/categorize`.
    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe('/api/v1/ai/alerts/inbox/categorize')
    expect(init?.method).toBe('POST')
    expect(typeof init?.body).toBe('string')
    const parsedBody = JSON.parse(init?.body as string)
    expect(parsedBody).toEqual({
      vehicle_id: 7,
      window_days: 7,
      severities: ['warn', 'critical'],
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // 5) The first delta's text renders inside the gated wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(/Inbox histogram for the last 7 days/)
    })
  })

  it('TestInboxCategorizationAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'inbox-auto-categorization': true },
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

    render(<AIInboxAutoCategorization onApplyCategories={vi.fn()} />)

    const button = screen.getByRole('button', { name: /Suggest categories/i })

    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))

    // While streaming the button's disabled is COMPUTED from
    // `isBusy`. The hook's `runningRef` also coalesces duplicate
    // start() calls, so the second click is a defence-in-depth
    // no-op even if a future refactor accidentally drops the
    // visual disabled.
    await waitFor(() => expect(button).toBeDisabled())
    await act(async () => {
      fireEvent.click(button)
    })

    // Give any rogue fetch a microtask to land.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })

  it('TestInboxCategorizationAIOnWiredCallsRoute: tool_result proposal renders preview chips and Apply copies deduped rule_ids to onApplyCategories', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'inbox-auto-categorization': true },
      }),
    )

    const onApplyCategories = vi.fn()

    // SSE stream: tool_call, tool_result with typed proposal,
    // then a final delta + done. The tool_result envelope shape
    // mirrors the draft_alert_categories Go tool. Note rule_id 7
    // appears in both buckets — the SPA dedupes before calling
    // onApplyCategories.
    const proposalEnvelope = {
      window_days: 7,
      total: 31,
      status: 'ok',
      categories: [
        {
          category: 'battery',
          count: 18,
          rule_ids: [3, 7],
          sample_titles: ['Battery low', 'Battery degraded'],
        },
        {
          category: 'tire',
          count: 7,
          rule_ids: [5, 7],
          sample_titles: ['Tire pressure low'],
        },
      ],
    }

    const sseBody =
      sseFrame('tool_call', {
        id: 'tc1',
        name: 'draft_alert_categories',
        arguments: { window_days: 7 },
      }) +
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_alert_categories',
        ok: true,
        data: proposalEnvelope,
      }) +
      sseFrame('delta', {
        text: 'Battery and tire categories dominate the 7-day window — review before applying.',
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
      <AIInboxAutoCategorization onApplyCategories={onApplyCategories} />,
    )

    const suggest = screen.getByRole('button', { name: /Suggest categories/i })
    await act(async () => {
      fireEvent.click(suggest)
    })

    // The proposal chips render once tool_result lands.
    await waitFor(() => {
      expect(
        screen.getByTestId(
          'ai-feature-inbox-auto-categorization-bucket-battery',
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByTestId(
          'ai-feature-inbox-auto-categorization-bucket-tire',
        ),
      ).toBeInTheDocument()
    })

    // Apply is enabled now and pushes the deduped rule_id list
    // up to the parent. The AI panel never persists state
    // directly — onApplyCategories is the canonical hand-off into
    // the baseline NotificationFilterBar URL state, which writes
    // through GET /api/v1/notifications/logs (the unguarded
    // baseline path).
    const apply = screen.getByRole('button', {
      name: /Apply categories as filter/i,
    })
    await waitFor(() => expect(apply).not.toBeDisabled())
    await act(async () => {
      fireEvent.click(apply)
    })

    expect(onApplyCategories).toHaveBeenCalledTimes(1)
    // Sorted, deduplicated.
    expect(onApplyCategories).toHaveBeenCalledWith([3, 5, 7])
  })
})
