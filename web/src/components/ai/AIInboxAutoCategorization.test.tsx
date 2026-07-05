// Comprehensive unit + wiring coverage for AIInboxAutoCategorization.
//
// AIInboxAutoCategorization is the inbox auto-categorization AI panel.
// `withAiFeature('inbox-auto-categorization', …)` gates its visibility
// per the ADR-015 AI-Off Contract, and the inner card wires a "Suggest
// categories" button to POST /api/v1/ai/alerts/inbox/categorize via
// useAiStream. tool_result frames carrying the typed
// draft_alert_categories envelope are captured in local state and
// rendered as preview chips; clicking "Apply categories as filter"
// hands the deduplicated rule_id list to the parent — the AI panel
// never persists state directly.
//
// The file exports three symbols — the CategoryBucket interface, the
// AIInboxAutoCategorizationProps interface, and the wrapped
// AIInboxAutoCategorization component — so this suite exercises every
// branch reachable through them:
//
//   - the ADR-015 visibility gate (off / per-feature-off / enabled),
//   - the optional-field request-body construction (vehicle_id /
//     window_days / severities / rule_ids emitted only when present,
//     matching the backend handler's optional-field contract),
//   - the wired SSE POST (route, method, headers, credentials, body,
//     delta render),
//   - typed tool_result envelope capture + preview chips,
//   - the rule_id dedup/sort → onApplyCategories hand-off,
//   - the Apply-disabled-without-rule_ids branch,
//   - the malformed-envelope reject path,
//   - the invalid-bucket filter (empty category / negative count),
//   - the double-submit guard,
//   - the terminal-error render path, and
//   - the scope-change cleanup: a proposal survives a same-content
//     parent re-render (stable content key) but is cleared when the
//     scope content actually changes.
//
// Network is stubbed with a deterministic SSE byte stream — the same
// pattern the sibling AIChargingDiagnosis / cross-rule tests use.
// `@testing-library/user-event` is not a dependency of this codebase
// (web/package.json), so interactions go through fireEvent, consistent
// with the other AI SSE-wiring suites.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import {
  AIInboxAutoCategorization,
  type CategoryBucket,
  type AIInboxAutoCategorizationProps,
} from './AIInboxAutoCategorization'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

// A complete AppSettings with realistic non-AI defaults. Per-test
// overrides flip ai_mode + the per-feature toggle to walk the gate.
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

// enableFeature turns the gate fully on so the inner card renders.
function enableFeature() {
  mockUseSettings.mockReturnValue(
    settingsPayload({
      ai_mode: 'cloud',
      ai_features: { 'inbox-auto-categorization': true },
    }),
  )
}

// makeReadableStream turns text chunks into the byte stream shape
// useAiStream's reader consumes.
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

// sseFrame formats one SSE event exactly like internal/ai/stream/writer.go.
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// installSSEFetch installs a fetch stub that returns a single SSE body
// and records every call so the wiring assertions can inspect the URL,
// method, headers, and body.
function installSSEFetch(sseBody: string) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  ) as unknown as typeof globalThis.fetch
  return calls
}

// categorizeStream builds the SSE body the backend emits for a
// categorize call: a tool_call, a tool_result carrying the typed
// draft_alert_categories envelope, an optional narration delta, and a
// terminal done frame.
function categorizeStream(
  categories: unknown[],
  extra?: { status?: string; delta?: string },
): string {
  const status = extra?.status ?? 'ok'
  return (
    sseFrame('tool_call', {
      id: 'tc1',
      name: 'draft_alert_categories',
      arguments: { window_days: 7 },
    }) +
    sseFrame('tool_result', {
      id: 'tc1',
      name: 'draft_alert_categories',
      ok: true,
      data: { window_days: 7, total: 31, status, categories },
    }) +
    (extra?.delta ? sseFrame('delta', { text: extra.delta }) : '') +
    sseFrame('done', { finish_reason: 'stop', usage: { in: 100, out: 30 } })
  )
}

const ROOT_TESTID = 'ai-feature-inbox-auto-categorization-root'
const APPLY_TESTID = 'ai-feature-inbox-auto-categorization-apply'
const bucketTestId = (category: string) =>
  `ai-feature-inbox-auto-categorization-bucket-${category}`
// The card renders the universal "Ask Helix" CTA but exposes the
// per-feature verb as the button's accessible name, so we can locate it
// by /Suggest categories/ regardless of the visible label.
const SUGGEST = /Suggest categories/i
const APPLY = /Apply categories as filter/i

beforeEach(() => {
  mockUseSettings.mockReset()
  // Default fetch mock complains if a test forgets to install its own,
  // turning miswiring into a clear failure instead of a silent hang.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AIInboxAutoCategorization — ADR-015 visibility gate', () => {
  it('renders nothing when ai_mode=off even with the toggle on', () => {
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
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SUGGEST })).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is off despite ai_mode=cloud', () => {
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
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the card (title, description, Helix badge, Suggest button) when fully enabled', () => {
    enableFeature()

    render(<AIInboxAutoCategorization onApplyCategories={vi.fn()} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'inbox-auto-categorization')

    expect(
      screen.getByRole('heading', { name: /Suggest inbox categories/i }),
    ).toBeInTheDocument()
    expect(root).toHaveTextContent(/Bucket recent alerts into categories/i)
    // Badge label passed as "Helix"; its visible text is exactly "Helix".
    expect(screen.getByText('Helix')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: SUGGEST })).toBeInTheDocument()
    // No proposal + no stream yet → neither Apply nor the output panel exist.
    expect(screen.queryByRole('button', { name: APPLY })).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
  })
})

describe('AIInboxAutoCategorization — wired SSE POST + request body', () => {
  it('clicking Suggest POSTs once to /api/v1/ai/alerts/inbox/categorize with every scope field present', async () => {
    enableFeature()

    const calls = installSSEFetch(
      sseFrame('delta', {
        text: 'Inbox histogram for the last 7 days: 18 battery, 7 tire.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } }),
    )

    render(
      <AIInboxAutoCategorization
        vehicleId={7}
        windowDays={7}
        severities={['warn', 'critical']}
        ruleIds={[10, 20]}
        onApplyCategories={vi.fn()}
      />,
    )

    const button = screen.getByRole('button', { name: SUGGEST })
    expect(button).toBeEnabled()

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe('/api/v1/ai/alerts/inbox/categorize')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    expect(JSON.parse(init?.body as string)).toEqual({
      vehicle_id: 7,
      window_days: 7,
      severities: ['warn', 'critical'],
      rule_ids: [10, 20],
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // The first delta accumulates into the shared output panel.
    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /Inbox histogram for the last 7 days/,
      )
    })
  })

  it('omits null/undefined scope + empty arrays from the request body (backend optional-field contract)', async () => {
    enableFeature()

    const calls = installSSEFetch(
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    )

    render(
      <AIInboxAutoCategorization
        vehicleId={null}
        windowDays={null}
        severities={[]}
        ruleIds={[]}
        onApplyCategories={vi.fn()}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SUGGEST }))
    })

    await waitFor(() => expect(calls).toHaveLength(1))
    // Every field was null / empty, so none are forwarded — the body is
    // an empty object (still serialized, never `undefined`).
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({})
  })
})

describe('AIInboxAutoCategorization — typed proposal capture + Apply hand-off', () => {
  it('renders preview chips from a tool_result and Apply copies the deduped, sorted rule_ids', async () => {
    enableFeature()

    const onApplyCategories = vi.fn()

    // rule_id 7 appears in both buckets — the panel dedupes + sorts
    // before handing off. Typed as CategoryBucket[] to exercise the
    // exported envelope-element shape.
    const categories: CategoryBucket[] = [
      {
        category: 'battery',
        count: 18,
        rule_ids: [3, 7],
        sample_titles: ['Battery low', 'Battery degraded'],
      },
      { category: 'tire', count: 7, rule_ids: [5, 7] },
    ]

    installSSEFetch(
      categorizeStream(categories, {
        delta: 'Battery and tire dominate the 7-day window.',
      }),
    )

    render(
      <AIInboxAutoCategorization onApplyCategories={onApplyCategories} />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SUGGEST }))
    })

    await waitFor(() => {
      expect(screen.getByTestId(bucketTestId('battery'))).toBeInTheDocument()
      expect(screen.getByTestId(bucketTestId('tire'))).toBeInTheDocument()
    })
    // The chip surfaces both the category label and its descriptive count.
    expect(screen.getByTestId(bucketTestId('battery'))).toHaveTextContent('battery')
    expect(screen.getByTestId(bucketTestId('battery'))).toHaveTextContent('18')

    const apply = screen.getByRole('button', { name: APPLY })
    await waitFor(() => expect(apply).toBeEnabled())

    await act(async () => {
      fireEvent.click(apply)
    })

    expect(onApplyCategories).toHaveBeenCalledTimes(1)
    expect(onApplyCategories).toHaveBeenCalledWith([3, 5, 7])
  })

  it('keeps Apply disabled and inert when no bucket carries rule_ids', async () => {
    enableFeature()

    const onApplyCategories = vi.fn()

    installSSEFetch(
      categorizeStream([
        { category: 'noise', count: 9 },
        { category: 'other', count: 4 },
      ]),
    )

    render(<AIInboxAutoCategorization onApplyCategories={onApplyCategories} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SUGGEST }))
    })

    // Chips render even though nothing is applicable — the section is
    // never hidden, it shows the descriptive buckets.
    await waitFor(() => {
      expect(screen.getByTestId(bucketTestId('noise'))).toBeInTheDocument()
    })
    expect(screen.getByTestId(bucketTestId('other'))).toBeInTheDocument()

    const apply = screen.getByTestId(APPLY_TESTID)
    expect(apply).toBeDisabled()
    expect(apply).toHaveAttribute('aria-disabled', 'true')

    // Clicking the disabled control is a no-op — no rule_ids to apply.
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApplyCategories).not.toHaveBeenCalled()
  })

  it('rejects a malformed envelope (status != "ok") without rendering chips, still showing narration', async () => {
    enableFeature()

    installSSEFetch(
      categorizeStream(
        [{ category: 'battery', count: 18, rule_ids: [3] }],
        { status: 'error', delta: 'The categorizer could not complete.' },
      ),
    )

    render(<AIInboxAutoCategorization onApplyCategories={vi.fn()} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SUGGEST }))
    })

    // The stream completed (narration rendered) but the guard dropped
    // the non-ok envelope, so no proposal chips and no Apply button.
    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /could not complete/i,
      )
    })
    expect(screen.queryByTestId(bucketTestId('battery'))).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: APPLY })).not.toBeInTheDocument()
  })

  it('filters invalid buckets (empty category / negative count) while keeping the valid one', async () => {
    enableFeature()

    const onApplyCategories = vi.fn()

    installSSEFetch(
      categorizeStream([
        { category: '', count: 5, rule_ids: [1] }, // empty category → dropped
        { category: 'tire', count: -1, rule_ids: [2] }, // negative count → dropped
        { category: 'battery', count: 18, rule_ids: [3, 3, 7] }, // valid; in-bucket dupes
      ]),
    )

    render(<AIInboxAutoCategorization onApplyCategories={onApplyCategories} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SUGGEST }))
    })

    await waitFor(() => {
      expect(screen.getByTestId(bucketTestId('battery'))).toBeInTheDocument()
    })
    // The two invalid buckets never render.
    expect(screen.queryByTestId(bucketTestId('tire'))).not.toBeInTheDocument()
    expect(screen.queryByTestId(bucketTestId(''))).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: APPLY }))
    })
    // In-bucket duplicate 3 is collapsed to a single entry.
    expect(onApplyCategories).toHaveBeenCalledWith([3, 7])
  })
})

describe('AIInboxAutoCategorization — lifecycle guards', () => {
  it('a second click while streaming does not open a second stream (double-submit guard)', async () => {
    enableFeature()

    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      return new Response(
        // Never enqueue, never close — keeps state === 'streaming'.
        new ReadableStream<Uint8Array>({ start() {} }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AIInboxAutoCategorization onApplyCategories={vi.fn()} />)

    const button = screen.getByRole('button', { name: SUGGEST })

    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))

    // Streaming disables the button (computed from stream.state), and
    // useAiStream's runningRef coalesces duplicate start() calls.
    await waitFor(() => expect(button).toBeDisabled())
    await act(async () => {
      fireEvent.click(button)
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })

  it('surfaces a terminal Helix error in the output panel when the stream responds non-2xx', async () => {
    enableFeature()

    globalThis.fetch = vi.fn(
      async () => new Response('bad request', { status: 400 }),
    ) as unknown as typeof globalThis.fetch

    render(<AIInboxAutoCategorization onApplyCategories={vi.fn()} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SUGGEST }))
    })

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error/i)
      expect(panel).toHaveTextContent('stream_http_400')
    })
  })

  it('preserves a captured proposal across a same-content parent re-render (stable scope key)', async () => {
    // Regression net for the scope-change cleanup: the effect keys off
    // the CONTENT of severities/ruleIds, not the array reference. A
    // parent that rebuilds `severities={['warn']}` on every render must
    // NOT abort the stream or wipe the proposal chips.
    enableFeature()

    const onApply = vi.fn()
    installSSEFetch(
      categorizeStream([{ category: 'battery', count: 18, rule_ids: [3] }]),
    )

    const { rerender } = render(
      <AIInboxAutoCategorization
        severities={['warn']}
        onApplyCategories={onApply}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SUGGEST }))
    })
    await waitFor(() => {
      expect(screen.getByTestId(bucketTestId('battery'))).toBeInTheDocument()
    })

    // New array reference, identical content — must be inert.
    rerender(
      <AIInboxAutoCategorization
        severities={['warn']}
        onApplyCategories={onApply}
      />,
    )

    expect(screen.getByTestId(bucketTestId('battery'))).toBeInTheDocument()
  })

  it('clears the captured proposal when the scope content actually changes', async () => {
    enableFeature()

    const onApply = vi.fn()
    installSSEFetch(
      categorizeStream([{ category: 'battery', count: 18, rule_ids: [3] }]),
    )

    const { rerender } = render(
      <AIInboxAutoCategorization
        severities={['warn']}
        onApplyCategories={onApply}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SUGGEST }))
    })
    await waitFor(() => {
      expect(screen.getByTestId(bucketTestId('battery'))).toBeInTheDocument()
    })

    // Different content → the scope changed → cleanup clears the proposal.
    await act(async () => {
      rerender(
        <AIInboxAutoCategorization
          severities={['critical']}
          onApplyCategories={onApply}
        />,
      )
    })

    await waitFor(() => {
      expect(
        screen.queryByTestId(bucketTestId('battery')),
      ).not.toBeInTheDocument()
    })
  })
})

describe('AIInboxAutoCategorization — exported type contracts', () => {
  it('CategoryBucket captures the narrow draft_alert_categories bucket shape', () => {
    const bucket: CategoryBucket = {
      category: 'battery',
      count: 18,
      rule_ids: [3, 7],
      sample_titles: ['Battery low'],
    }
    expect(bucket.category).toBe('battery')
    expect(bucket.count).toBe(18)
    expect(bucket.rule_ids).toEqual([3, 7])
    expect(bucket.sample_titles).toContain('Battery low')

    // rule_ids / sample_titles are optional — a minimal bucket is valid.
    const minimal: CategoryBucket = { category: 'other', count: 0 }
    expect(minimal.rule_ids).toBeUndefined()
    expect(minimal.sample_titles).toBeUndefined()
  })

  it('AIInboxAutoCategorizationProps.onApplyCategories forwards the rule_id list', () => {
    const spy = vi.fn()
    const onApply: AIInboxAutoCategorizationProps['onApplyCategories'] = spy
    onApply([3, 5, 7])
    expect(spy).toHaveBeenCalledWith([3, 5, 7])
  })
})
