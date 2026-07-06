// Comprehensive unit + behaviour coverage for
// AICrossRuleConflictDetection — the co-located Project Apex elevation
// test.
//
// The module's runtime surface is a single export
// (`AICrossRuleConflictDetection`, an InnerSection wrapped with
// withAiFeature) plus the exported `RuleConflict` / props types. Unlike
// the pure-narration siblings this feature captures a TYPED envelope
// from `detect_rule_conflicts` tool_result frames and renders a
// per-conflict review list, so the facets worth exercising are:
//
//   - the ADR-015 AI-off visibility gate (off-mode, per-feature toggle
//     off, and the positive control that proves the gate is real);
//   - the input gate: the Detect button's `disabled` is a COMPUTED
//     expression derived from `ruleIds.length >= 2` (you can't have a
//     conflict with one rule), proved across absent / one / two ids
//     plus the null-safety guard for an undefined ruleIds array;
//   - the SSE wiring contract (exactly one POST to the registered
//     `/api/v1/ai/alerts/rules/conflicts` route with the correct
//     method / headers and the `{ rule_ids }` body, plus the optional
//     `vehicle_id` branch);
//   - the streaming lifecycle (thinking indicator + disabled button
//     while in flight, double-submit guard, HTTP-error + error-frame
//     fallbacks rendered in AiOutputPanel);
//   - the typed-envelope capture path (full conflict with every flag,
//     the optional name/signal/reason branches, the localised kind
//     label + unknown-kind fallback, the empty "no conflicts" state,
//     and the malformed-entry filter) plus the tool_result rejection
//     branches (wrong tool name, ok=false, non-array conflicts);
//   - the "Review rule" hand-off (the AI panel never persists — it only
//     forwards the offending rule id to the parent via onSelectRule);
//   - the ruleIds-change reset + re-detect reset that prevent a stale
//     conflict set from bleeding across scopes; and
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
import {
  AICrossRuleConflictDetection,
  type RuleConflict,
} from '@/components/ai/AICrossRuleConflictDetection'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-cross-rule-conflict-detection-root'
const DETECT_TESTID = 'ai-feature-cross-rule-conflict-detection-detect'
const CONFLICTS_TESTID = 'ai-feature-cross-rule-conflict-detection-conflicts'
const CONFLICTS_ROUTE = '/api/v1/ai/alerts/rules/conflicts'

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
      ai_features: { 'cross-rule-conflict-detection': true },
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

const doneFrame = sseFrame('done', {
  finish_reason: 'stop',
  usage: { in: 10, out: 5 },
})

// conflictsFrame mirrors the RuleConflictEnvelope the detect_rule_conflicts
// tool emits (internal/ai/tools/diagnostic/cross_rule.go). The component
// keys off `data.conflicts`; status is echoed for realism.
function conflictsFrame(
  conflicts: unknown[],
  opts: { name?: string; ok?: boolean; status?: string } = {},
): string {
  return sseFrame('tool_result', {
    id: 'tc1',
    name: opts.name ?? 'detect_rule_conflicts',
    ok: opts.ok ?? true,
    data: {
      conflicts,
      total: Array.isArray(conflicts) ? conflicts.length : 0,
      status: opts.status ?? 'ok',
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

function detectButton(): HTMLElement {
  return screen.getByTestId(DETECT_TESTID)
}

async function clickDetect(): Promise<HTMLElement> {
  const btn = detectButton()
  await act(async () => {
    fireEvent.click(btn)
  })
  return btn
}

// A fully-populated conflict — exercises the RuleConflict type surface
// and every optional/flag branch in the renderer at once.
const fullConflict: RuleConflict = {
  kind: 'overlapping_threshold',
  rule_a_id: 12,
  rule_b_id: 34,
  rule_a_name: 'Low battery',
  rule_b_name: 'Critical battery',
  signal_name: 'battery_level',
  reason: 'thresholds overlap on battery_level',
  severity_mismatch: true,
  cooldown_mismatch: true,
  trigger_mode_mismatch: true,
  subsumes: true,
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

describe('AICrossRuleConflictDetection — AI-off visibility gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the per-feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'cross-rule-conflict-detection': true },
      }),
    )

    const { container } = render(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByTestId(DETECT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode!=off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'cross-rule-conflict-detection': false },
      }),
    )

    const { container } = render(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) with title, badge and an enabled button when both mode and toggle are on', () => {
    enableFeature()

    render(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'cross-rule-conflict-detection',
    )
    expect(screen.getByText('Detect cross-rule conflicts')).toBeInTheDocument()
    expect(screen.getByText('Helix')).toBeInTheDocument()

    const button = detectButton()
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    // The per-feature verb survives as the accessible name so the button
    // is discoverable by screen readers and by name-regex queries.
    expect(button.getAttribute('aria-label') ?? '').toContain('Detect conflicts')

    // Idle: no output panel and no conflicts list yet.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId(CONFLICTS_TESTID)).not.toBeInTheDocument()
  })
})

describe('AICrossRuleConflictDetection — input gate (computed disabled, needs ≥2 rules)', () => {
  it('disables the Detect button when fewer than two rules are in scope', () => {
    enableFeature()

    render(
      <AICrossRuleConflictDetection ruleIds={[1]} onSelectRule={vi.fn()} />,
    )

    const button = detectButton()
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables the Detect button when the rule set is empty', () => {
    enableFeature()

    render(<AICrossRuleConflictDetection ruleIds={[]} onSelectRule={vi.fn()} />)

    expect(detectButton()).toBeDisabled()
  })

  it('stays resilient (button disabled, no crash) when ruleIds is undefined', () => {
    enableFeature()

    render(
      // @ts-expect-error — exercising the runtime null-safety guard that
      // backs up the `number[]` compile contract.
      <AICrossRuleConflictDetection ruleIds={undefined} onSelectRule={vi.fn()} />,
    )

    expect(screen.getByTestId(ROOT_TESTID)).toBeInTheDocument()
    expect(detectButton()).toBeDisabled()
  })

  it('enables the Detect button once two rules resolve via rerender', () => {
    enableFeature()

    const { rerender } = render(
      <AICrossRuleConflictDetection ruleIds={[1]} onSelectRule={vi.fn()} />,
    )
    expect(detectButton()).toBeDisabled()

    rerender(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )
    expect(detectButton()).toBeEnabled()
  })

  it('does not open a stream when the (disabled) button is clicked with one rule', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(
      <AICrossRuleConflictDetection ruleIds={[1]} onSelectRule={vi.fn()} />,
    )

    await act(async () => {
      fireEvent.click(detectButton())
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(0)
  })
})

describe('AICrossRuleConflictDetection — SSE wiring contract', () => {
  it('POSTs exactly once to the registered route with the rule_ids body and correct headers', async () => {
    enableFeature()
    const calls = installStreamingFetch(conflictsFrame([]) + doneFrame)

    render(
      <AICrossRuleConflictDetection
        ruleIds={[12, 34]}
        onSelectRule={vi.fn()}
      />,
    )

    await clickDetect()

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(CONFLICTS_ROUTE)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ rule_ids: [12, 34] })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('includes vehicle_id in the body when the vehicleId prop is supplied', async () => {
    enableFeature()
    const calls = installStreamingFetch(conflictsFrame([]) + doneFrame)

    render(
      <AICrossRuleConflictDetection
        ruleIds={[1, 2]}
        vehicleId={7}
        onSelectRule={vi.fn()}
      />,
    )

    await clickDetect()

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      rule_ids: [1, 2],
      vehicle_id: 7,
    })
  })

  it('omits vehicle_id from the body when vehicleId is null', async () => {
    enableFeature()
    const calls = installStreamingFetch(conflictsFrame([]) + doneFrame)

    render(
      <AICrossRuleConflictDetection
        ruleIds={[1, 2]}
        vehicleId={null}
        onSelectRule={vi.fn()}
      />,
    )

    await clickDetect()

    await waitFor(() => expect(calls).toHaveLength(1))
    const parsed = JSON.parse(calls[0].init?.body as string)
    expect(parsed).toEqual({ rule_ids: [1, 2] })
    expect(parsed).not.toHaveProperty('vehicle_id')
  })
})

describe('AICrossRuleConflictDetection — streaming lifecycle', () => {
  it('shows the thinking indicator and disables the button while streaming', async () => {
    enableFeature()
    installNeverClosingFetch()

    render(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )
    const button = await clickDetect()

    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByTestId('ai-thinking-indicator')).toBeInTheDocument()
    expect(button).toHaveTextContent(/Helix is thinking/)
  })

  it('guards against double-submit: a second click while streaming issues no new request', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )
    const button = await clickDetect()

    await waitFor(() => expect(tracker.count()).toBe(1))
    await waitFor(() => expect(button).toBeDisabled())

    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(1)
  })

  it('surfaces an HTTP error in the output panel and captures no conflicts', async () => {
    enableFeature()
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )
    await clickDetect()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
    expect(screen.queryByTestId(CONFLICTS_TESTID)).not.toBeInTheDocument()
  })

  it('surfaces a terminal SSE error frame in the output panel', async () => {
    enableFeature()
    installStreamingFetch(sseFrame('error', { message: 'provider_unavailable' }))

    render(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )
    await clickDetect()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/provider_unavailable/)
    })
  })
})

describe('AICrossRuleConflictDetection — typed conflict capture + rendering', () => {
  it('renders a captured conflict with kind label, rule-pair line, reason, and every metadata flag', async () => {
    enableFeature()
    installStreamingFetch(conflictsFrame([fullConflict]) + doneFrame)

    render(
      <AICrossRuleConflictDetection ruleIds={[12, 34]} onSelectRule={vi.fn()} />,
    )
    await clickDetect()

    const list = await screen.findByTestId(CONFLICTS_TESTID)
    // The list is exposed to assistive tech with a descriptive label.
    expect(list).toHaveAttribute('aria-label', 'Detected rule conflicts')

    // Localised kind label (overlapping_threshold → "Overlapping threshold").
    expect(list).toHaveTextContent('Overlapping threshold')
    // Rule-pair line with both ids, both names, and the signal.
    expect(list).toHaveTextContent(/Rule 12 \(Low battery\)/)
    expect(list).toHaveTextContent(/Rule 34 \(Critical battery\)/)
    expect(list).toHaveTextContent('battery_level')
    expect(list).toHaveTextContent('thresholds overlap on battery_level')
    // All four metadata chips render.
    expect(list).toHaveTextContent('subsumes')
    expect(list).toHaveTextContent('severity mismatch')
    expect(list).toHaveTextContent('cooldown mismatch')
    expect(list).toHaveTextContent('trigger mode mismatch')
  })

  it('omits optional name/signal/reason text and metadata chips when a conflict carries none', async () => {
    enableFeature()
    installStreamingFetch(
      conflictsFrame([
        { kind: 'redundant_duplicate', rule_a_id: 5, rule_b_id: 9 },
      ]) + doneFrame,
    )

    render(
      <AICrossRuleConflictDetection ruleIds={[5, 9]} onSelectRule={vi.fn()} />,
    )
    await clickDetect()

    const list = await screen.findByTestId(CONFLICTS_TESTID)
    // redundant_duplicate → localised label; bare "Rule 5 ↔ Rule 9" pair.
    expect(list).toHaveTextContent('Redundant duplicate')
    expect(list).toHaveTextContent(/Rule 5/)
    expect(list).toHaveTextContent(/Rule 9/)
    // No parenthesised names and none of the metadata chips.
    expect(list).not.toHaveTextContent('(')
    expect(list).not.toHaveTextContent('subsumes')
    expect(list).not.toHaveTextContent('severity mismatch')
  })

  it('falls back to the raw kind string for a kind outside the closed taxonomy', async () => {
    enableFeature()
    installStreamingFetch(
      conflictsFrame([
        { kind: 'future_unknown_kind', rule_a_id: 1, rule_b_id: 2 },
      ]) + doneFrame,
    )

    render(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )
    await clickDetect()

    const list = await screen.findByTestId(CONFLICTS_TESTID)
    expect(list).toHaveTextContent('future_unknown_kind')
  })

  it('renders the empty-state message (role=status) when the tool reports zero conflicts', async () => {
    enableFeature()
    installStreamingFetch(
      conflictsFrame([], { status: 'no_conflicts' }) + doneFrame,
    )

    render(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )
    await clickDetect()

    const empty = await screen.findByText(
      'No structural conflicts found in the current rule set.',
    )
    expect(empty).toBeInTheDocument()
    expect(empty).toHaveAttribute('role', 'status')
    // No conflicts list is rendered for an empty envelope.
    expect(screen.queryByTestId(CONFLICTS_TESTID)).not.toBeInTheDocument()
  })

  it('filters out malformed conflict entries and keeps only well-typed ones', async () => {
    enableFeature()
    installStreamingFetch(
      conflictsFrame([
        null, // not an object
        'nope', // not an object
        { kind: 'overlapping_threshold', rule_a_id: 'x', rule_b_id: 2 }, // bad id
        { kind: 42, rule_a_id: 1, rule_b_id: 2 }, // kind not a string
        { rule_a_id: 1, rule_b_id: 2 }, // missing kind
        { kind: 'redundant_duplicate', rule_a_id: 7, rule_b_id: 8 }, // valid
      ]) + doneFrame,
    )

    render(
      <AICrossRuleConflictDetection ruleIds={[7, 8]} onSelectRule={vi.fn()} />,
    )
    await clickDetect()

    const list = await screen.findByTestId(CONFLICTS_TESTID)
    // Exactly one <li> survived the filter.
    expect(list.querySelectorAll('li')).toHaveLength(1)
    expect(list).toHaveTextContent(/Rule 7/)
    expect(list).toHaveTextContent(/Rule 8/)
  })
})

describe('AICrossRuleConflictDetection — tool_result rejection branches', () => {
  it('ignores a tool_result frame from a different tool (query_alert_rules)', async () => {
    enableFeature()
    installStreamingFetch(
      conflictsFrame([fullConflict], { name: 'query_alert_rules' }) + doneFrame,
    )

    render(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )
    await clickDetect()

    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId(CONFLICTS_TESTID)).not.toBeInTheDocument()
  })

  it('ignores a detect_rule_conflicts frame with ok=false', async () => {
    enableFeature()
    installStreamingFetch(
      conflictsFrame([fullConflict], { ok: false }) + doneFrame,
    )

    render(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )
    await clickDetect()

    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId(CONFLICTS_TESTID)).not.toBeInTheDocument()
    // Not even the empty-state message shows — the frame was dropped whole.
    expect(
      screen.queryByText(
        'No structural conflicts found in the current rule set.',
      ),
    ).not.toBeInTheDocument()
  })

  it('ignores a frame whose data.conflicts is not an array', async () => {
    enableFeature()
    installStreamingFetch(
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'detect_rule_conflicts',
        ok: true,
        data: { conflicts: 'not-an-array', status: 'ok' },
      }) + doneFrame,
    )

    render(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )
    await clickDetect()

    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId(CONFLICTS_TESTID)).not.toBeInTheDocument()
  })
})

describe('AICrossRuleConflictDetection — Review rule hand-off', () => {
  it('forwards rule_a_id then rule_b_id to onSelectRule when the Review buttons are clicked', async () => {
    enableFeature()
    const onSelectRule = vi.fn()
    installStreamingFetch(conflictsFrame([fullConflict]) + doneFrame)

    render(
      <AICrossRuleConflictDetection
        ruleIds={[12, 34]}
        onSelectRule={onSelectRule}
      />,
    )
    await clickDetect()
    await screen.findByTestId(CONFLICTS_TESTID)

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(
          'ai-feature-cross-rule-conflict-detection-review-12',
        ),
      )
    })
    expect(onSelectRule).toHaveBeenCalledTimes(1)
    expect(onSelectRule).toHaveBeenCalledWith(12)

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(
          'ai-feature-cross-rule-conflict-detection-review-34',
        ),
      )
    })
    expect(onSelectRule).toHaveBeenCalledTimes(2)
    expect(onSelectRule).toHaveBeenLastCalledWith(34)
  })

  it('never opens a write request — the hand-off only fires the callback', async () => {
    enableFeature()
    const onSelectRule = vi.fn()
    const calls = installStreamingFetch(conflictsFrame([fullConflict]) + doneFrame)

    render(
      <AICrossRuleConflictDetection
        ruleIds={[12, 34]}
        onSelectRule={onSelectRule}
      />,
    )
    await clickDetect()
    await screen.findByTestId(CONFLICTS_TESTID)

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(
          'ai-feature-cross-rule-conflict-detection-review-12',
        ),
      )
    })
    // Only the single detect POST happened — no extra fetch on review.
    expect(calls).toHaveLength(1)
    expect(onSelectRule).toHaveBeenCalledWith(12)
  })
})

describe('AICrossRuleConflictDetection — stale-state resets', () => {
  it('clears a captured conflict set when the ruleIds prop changes scope', async () => {
    enableFeature()
    installStreamingFetch(conflictsFrame([fullConflict]) + doneFrame)

    const { rerender } = render(
      <AICrossRuleConflictDetection ruleIds={[12, 34]} onSelectRule={vi.fn()} />,
    )
    await clickDetect()
    await screen.findByTestId(CONFLICTS_TESTID)

    // Selecting a different rule set must not carry the old conflicts over.
    rerender(
      <AICrossRuleConflictDetection ruleIds={[55, 66]} onSelectRule={vi.fn()} />,
    )

    expect(screen.queryByTestId(CONFLICTS_TESTID)).not.toBeInTheDocument()
  })

  it('clears the previous conflict set at the start of a fresh detect run', async () => {
    enableFeature()
    installStreamingFetch(conflictsFrame([fullConflict]) + doneFrame)

    render(
      <AICrossRuleConflictDetection ruleIds={[12, 34]} onSelectRule={vi.fn()} />,
    )
    await clickDetect()
    await screen.findByTestId(CONFLICTS_TESTID)

    // Re-run with a never-closing stream: handleDetect resets conflicts to
    // null before starting, so the previous list disappears immediately.
    installNeverClosingFetch()
    await clickDetect()

    await waitFor(() =>
      expect(screen.queryByTestId(CONFLICTS_TESTID)).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId('ai-thinking-indicator')).toBeInTheDocument()
  })
})

describe('AICrossRuleConflictDetection — public surface', () => {
  it('exposes a stable displayName for the gated component', () => {
    expect(AICrossRuleConflictDetection.displayName).toBe(
      'AICrossRuleConflictDetection',
    )
  })
})
