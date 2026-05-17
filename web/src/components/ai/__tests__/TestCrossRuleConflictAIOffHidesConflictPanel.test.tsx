// Phase-50 / 0036 — A3 Cross-rule conflict detection.
//
// `TestCrossRuleConflictAIOffHidesConflictPanel` (the Vitest sibling
// to the Go test of the same name) is the slice's load-bearing
// AI-OFF contract proof on the React side. It mounts the
// AICrossRuleConflictDetection component with ai_mode='off' (plus
// the per-feature toggle on, to defeat the obvious "off because
// nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND cross-rule-conflict-detection=true,
//      the section IS present + carries the expected test ID.
//      This is the positive control that proves the gate
//      actually works (otherwise the "absent in off mode"
//      assertion is trivially true).
//
// W1 inline wiring — also asserts the on-mode wiring contract:
//   - clicking "Detect conflicts" POSTs exactly one request to
//     `/api/v1/ai/alerts/rules/conflicts`.
//   - the first delta event's text renders inside the gated
//     wrapper.
//   - a second click while streaming is a no-op (double-submit
//     guard).
//   - the conflict cards render after a tool_result frame and
//     clicking a "Review rule {id}" button calls onSelectRule
//     with the offending rule_id (proves the typed envelope →
//     baseline editor selection copy path; the AI panel never
//     persists state directly).
//
// The HTTP /api/v1/ai/alerts/rules/conflicts 404-in-off-mode
// invariant is proven by the Go-side
// TestCrossRuleConflictAIOffHidesConflictPanel in
// internal/api/ai_cross_rule_conflict_handler_test.go — the
// network layer does not exist in the React unit-test scope.
//
// File name MUST stay
// `TestCrossRuleConflictAIOffHidesConflictPanel.test.tsx` — the
// slice prompt's verification command runs
// `vitest --run TestCrossRuleConflictAIOffHidesConflictPanel`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AICrossRuleConflictDetection } from '@/components/ai/AICrossRuleConflictDetection'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

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

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

beforeEach(() => {
  mockUseSettings.mockReset()
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TestCrossRuleConflictAIOffHidesConflictPanel (cross-rule-conflict-detection AI-off contract)', () => {
  it('TestCrossRuleConflictAIOffHidesConflictPanel: renders nothing when ai_mode=off even with the cross-rule-conflict-detection toggle on', () => {
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
    expect(
      screen.queryByTestId('ai-feature-cross-rule-conflict-detection-root'),
    ).not.toBeInTheDocument()
  })

  it('TestCrossRuleConflictAIOffHidesConflictPanel: renders nothing when ai_mode is non-off but the cross-rule-conflict-detection toggle is false', () => {
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
    expect(
      screen.queryByTestId('ai-feature-cross-rule-conflict-detection-root'),
    ).not.toBeInTheDocument()
  })

  it('TestCrossRuleConflictAIOffHidesConflictPanel: renders the section when ai_mode=cloud AND cross-rule-conflict-detection toggle is on (positive control)', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'cross-rule-conflict-detection': true },
      }),
    )

    render(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )
    const root = screen.getByTestId(
      'ai-feature-cross-rule-conflict-detection-root',
    )
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'cross-rule-conflict-detection',
    )
  })
})

describe('TestCrossRuleConflictDetectionAIOnWiredCallsRoute (cross-rule-conflict-detection on-mode SPA wiring)', () => {
  it('TestCrossRuleConflictDetectionAIOnWiredCallsRoute: clicking Detect POSTs once to /api/v1/ai/alerts/rules/conflicts and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'cross-rule-conflict-detection': true },
      }),
    )

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text:
          'Rules 1 and 2 have an overlapping_threshold conflict on battery_level — structural overlap analysis only.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(
      <AICrossRuleConflictDetection
        ruleIds={[1, 2]}
        vehicleId={7}
        onSelectRule={vi.fn()}
      />,
    )

    const root = screen.getByTestId(
      'ai-feature-cross-rule-conflict-detection-root',
    )
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'cross-rule-conflict-detection',
    )

    const button = screen.getByRole('button', { name: /Detect conflicts/i })
    expect(button).toBeInTheDocument()
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe('/api/v1/ai/alerts/rules/conflicts')
    expect(init?.method).toBe('POST')
    expect(typeof init?.body).toBe('string')
    const parsedBody = JSON.parse(init?.body as string)
    expect(parsedBody).toEqual({ rule_ids: [1, 2], vehicle_id: 7 })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => {
      expect(root).toHaveTextContent(
        /Rules 1 and 2 have an overlapping_threshold conflict/,
      )
    })
  })

  it('TestCrossRuleConflictDetectionAIOnWiredCallsRoute: detect button is disabled when fewer than 2 rules in scope (computed disabled, never literal)', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'cross-rule-conflict-detection': true },
      }),
    )

    render(
      <AICrossRuleConflictDetection ruleIds={[1]} onSelectRule={vi.fn()} />,
    )
    const button = screen.getByRole('button', { name: /Detect conflicts/i })
    expect(button).toBeDisabled()
  })

  it('TestCrossRuleConflictDetectionAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'cross-rule-conflict-detection': true },
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

    render(
      <AICrossRuleConflictDetection ruleIds={[1, 2]} onSelectRule={vi.fn()} />,
    )

    const button = screen.getByRole('button', { name: /Detect conflicts/i })

    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))

    await waitFor(() => expect(button).toBeDisabled())
    await act(async () => {
      fireEvent.click(button)
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })

  it('TestCrossRuleConflictDetectionAIOnWiredCallsRoute: tool_result conflict envelope renders cards and Review rule {id} calls onSelectRule with the offending rule_id', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'cross-rule-conflict-detection': true },
      }),
    )

    const onSelectRule = vi.fn()

    const conflictEnvelope = {
      total: 1,
      sample_size: 2,
      has_enough_rules: true,
      min_required_rules: 2,
      allowed_kinds: ['redundant_duplicate', 'overlapping_threshold'],
      status: 'ok',
      method: 'deterministic structural overlap analysis',
      source:
        'reader: internal/database/alert_repo.go AlertRuleRepo.GetAll (filtered by CrossRuleConflictSource adapter)',
      conflicts: [
        {
          kind: 'overlapping_threshold',
          rule_a_id: 1,
          rule_b_id: 2,
          rule_a_name: 'low-batt-broad',
          rule_b_name: 'low-batt-narrow',
          signal_name: 'battery_level',
          reason:
            'rule 1 (battery_level < 20) subsumes rule 2 (battery_level < 15)',
          severity_mismatch: true,
          cooldown_mismatch: false,
          trigger_mode_mismatch: false,
          subsumes: true,
        },
      ],
    }

    const sseBody =
      sseFrame('tool_call', {
        id: 'tc1',
        name: 'detect_rule_conflicts',
        arguments: { rule_ids: [1, 2] },
      }) +
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'detect_rule_conflicts',
        ok: true,
        data: conflictEnvelope,
      }) +
      sseFrame('delta', {
        text:
          'Rule 1 subsumes rule 2 — structural overlap analysis of the current rule definitions.',
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
      <AICrossRuleConflictDetection
        ruleIds={[1, 2]}
        onSelectRule={onSelectRule}
      />,
    )

    const detect = screen.getByRole('button', { name: /Detect conflicts/i })
    await act(async () => {
      fireEvent.click(detect)
    })

    await waitFor(() => {
      expect(
        screen.getByTestId(
          'ai-feature-cross-rule-conflict-detection-conflicts',
        ),
      ).toBeInTheDocument()
    })

    // Review rule buttons surface for both sides of the
    // conflict pair. Clicking either invokes onSelectRule with
    // that rule_id — the AI panel never persists state, the
    // baseline AlertStudio editor's selection state is the
    // canonical hand-off.
    const reviewA = screen.getByTestId(
      'ai-feature-cross-rule-conflict-detection-review-1',
    )
    expect(reviewA).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(reviewA)
    })
    expect(onSelectRule).toHaveBeenCalledWith(1)

    const reviewB = screen.getByTestId(
      'ai-feature-cross-rule-conflict-detection-review-2',
    )
    await act(async () => {
      fireEvent.click(reviewB)
    })
    expect(onSelectRule).toHaveBeenCalledWith(2)
    expect(onSelectRule).toHaveBeenCalledTimes(2)
  })

  it('TestCrossRuleConflictDetectionAIOnWiredCallsRoute: empty conflict envelope surfaces the empty message and never invokes onSelectRule', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'cross-rule-conflict-detection': true },
      }),
    )

    const onSelectRule = vi.fn()
    const emptyEnvelope = {
      total: 0,
      sample_size: 2,
      has_enough_rules: true,
      min_required_rules: 2,
      allowed_kinds: ['redundant_duplicate', 'overlapping_threshold'],
      status: 'no_conflicts',
      method: 'deterministic structural overlap analysis',
      source: 'reader: AlertRuleRepo.GetAll',
      conflicts: [],
    }
    const sseBody =
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'detect_rule_conflicts',
        ok: true,
        data: emptyEnvelope,
      }) +
      sseFrame('delta', {
        text: 'No structural conflicts detected in the current rule set.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 80, out: 20 } })

    globalThis.fetch = vi.fn(
      async () =>
        new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ) as unknown as typeof globalThis.fetch

    render(
      <AICrossRuleConflictDetection
        ruleIds={[3, 4]}
        onSelectRule={onSelectRule}
      />,
    )
    const detect = screen.getByRole('button', { name: /Detect conflicts/i })
    await act(async () => {
      fireEvent.click(detect)
    })

    await waitFor(() => {
      expect(
        screen.getByText(/No structural conflicts found/i),
      ).toBeInTheDocument()
    })
    expect(
      screen.queryByTestId(
        'ai-feature-cross-rule-conflict-detection-conflicts',
      ),
    ).not.toBeInTheDocument()
    expect(onSelectRule).not.toHaveBeenCalled()
  })
})
