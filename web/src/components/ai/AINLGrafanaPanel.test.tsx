// Comprehensive unit tests for AINLGrafanaPanel.
//
// This file elevates the Helix natural-language Grafana panel drafter.
// It covers BOTH runtime exports of the source module:
//
//   1. parseGrafanaPanelDraft — the strict narrowing predicate that
//      turns an untyped `draft_grafana_panel` tool-result payload into a
//      typed GrafanaPanelDraft (or null). Every rejection branch is
//      exercised (bad status, missing/typed-wrong fields at each nesting
//      level, malformed targets, missing grid_pos) plus the happy path
//      and the optional-field permutations (postgres raw_sql target vs a
//      prometheus expr target, and the referenced_tables filter).
//
//   2. AINLGrafanaPanel — the withAiFeature-gated component:
//        • AI-off contract (off mode / per-feature-off / missing flag /
//          unresolved settings all render nothing — fail-closed; a
//          fully-enabled positive control proves the negatives aren't
//          trivially true).
//        • canStart/canDraft guarding (Draft CTA disabled until the
//          prompt is non-empty) with aria-disabled parity, and no
//          network fire while disabled.
//        • stream wiring (typing + Draft POSTs exactly once to the
//          registered SI-clean route with the trimmed prompt body + SSE
//          Accept header; the first delta renders in the output panel).
//        • tool_result capture → the reviewable draft preview + Apply
//          button surface; clicking Apply forwards the typed draft to
//          onApply verbatim (propose-only handoff — the component never
//          writes editor state itself).
//        • parse-reject + wrong-tool-name paths keep the preview hidden
//          and never call onApply.
//        • double-submit guard + failure path (non-2xx → Helix error,
//          no Apply button).
//        • exported displayName metadata.
//
// Convention notes (match the sibling AI tests):
//   - react-i18next's useTranslation returns the English fallback when
//     no provider is mounted, so no i18n setup is needed.
//   - @testing-library/user-event is NOT installed in this repo, so user
//     interactions are driven via fireEvent (typing = fireEvent.change).
//   - A file-level vi.mock('@/hooks/useSettings') takes precedence over
//     the global stub in src/test-setup.ts, letting each test drive
//     ai_mode / ai_features.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AINLGrafanaPanel, parseGrafanaPanelDraft } from './AINLGrafanaPanel'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

// A complete AppSettings with realistic non-AI defaults. Per-test cases
// override `ai_mode` + `ai_features` to exercise the gate.
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

// enabled() is the common "feature fully on" settings state used by the
// interaction tests.
function enabled(mode: 'local' | 'cloud' = 'cloud') {
  return settingsPayload({
    ai_mode: mode,
    ai_features: { 'nl-grafana-panel': true },
  })
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

// A realistic, fully-formed draft envelope mirroring the Go-side
// grafanaPanelOutput ({ draft, status, source }) from
// internal/ai/tools/nlq/grafana.go. Deep-cloned per call so a test that
// mutates one branch cannot bleed into another.
function validDraftData() {
  return {
    status: 'ok',
    source: 'llm',
    draft: {
      prompt: 'Show me a daily time series of how far I drove this month',
      panel: {
        title: 'Drives per day this month',
        type: 'timeseries',
        datasource: { type: 'postgres', uid: 'tesla-postgres' },
        targets: [
          {
            ref_id: 'A',
            raw_sql:
              "SELECT date_trunc('day', started_at) AS time, SUM(distance_m) AS value FROM drives GROUP BY 1 ORDER BY 1",
            format: 'time_series',
          },
        ],
        grid_pos: { x: 0, y: 0, w: 12, h: 8 },
      },
      rationale: 'Aggregates the drives table by day for a timeseries panel.',
      referenced_tables: ['drives'],
    },
  }
}

// The typed draft parseGrafanaPanelDraft(validDraftData()) is expected to
// yield — also the exact object onApply must receive.
const EXPECTED_DRAFT = {
  prompt: 'Show me a daily time series of how far I drove this month',
  panel: {
    title: 'Drives per day this month',
    type: 'timeseries',
    datasource: { type: 'postgres', uid: 'tesla-postgres' },
    targets: [
      {
        ref_id: 'A',
        raw_sql:
          "SELECT date_trunc('day', started_at) AS time, SUM(distance_m) AS value FROM drives GROUP BY 1 ORDER BY 1",
        format: 'time_series',
      },
    ],
    grid_pos: { x: 0, y: 0, w: 12, h: 8 },
  },
  rationale: 'Aggregates the drives table by day for a timeseries panel.',
  referenced_tables: ['drives'],
}

// The action button's accessible name is the universal Helix CTA plus
// the per-feature label ("Ask Helix · Draft panel"), so this UNANCHORED
// regex locates it whether idle or streaming.
const DRAFT_BUTTON = { name: /Draft panel/i }
const ROOT_TESTID = 'ai-feature-nl-grafana-panel-root'

beforeEach(() => {
  mockUseSettings.mockReset()
  mockUseSettings.mockReturnValue(enabled())
  // Fail loudly if a test triggers the network without arranging a mock.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseGrafanaPanelDraft', () => {
  it('narrows a fully-formed envelope into the typed draft verbatim', () => {
    expect(parseGrafanaPanelDraft(validDraftData())).toEqual(EXPECTED_DRAFT)
  })

  it('rejects non-object / null / status!=ok envelopes', () => {
    expect(parseGrafanaPanelDraft(null)).toBeNull()
    expect(parseGrafanaPanelDraft(undefined)).toBeNull()
    expect(parseGrafanaPanelDraft('nope')).toBeNull()
    expect(parseGrafanaPanelDraft(42)).toBeNull()
    // status must be exactly 'ok' — an error envelope is dropped whole.
    const errored = validDraftData()
    errored.status = 'error'
    expect(parseGrafanaPanelDraft(errored)).toBeNull()
  })

  it('rejects a missing or non-object draft body', () => {
    expect(parseGrafanaPanelDraft({ status: 'ok' })).toBeNull()
    expect(parseGrafanaPanelDraft({ status: 'ok', draft: 'x' })).toBeNull()
    expect(parseGrafanaPanelDraft({ status: 'ok', draft: null })).toBeNull()
  })

  it('rejects when prompt or rationale is not a string', () => {
    const noPrompt = validDraftData()
    // @ts-expect-error — exercising the runtime guard with a wrong type.
    noPrompt.draft.prompt = 123
    expect(parseGrafanaPanelDraft(noPrompt)).toBeNull()

    const noRationale = validDraftData()
    // @ts-expect-error — exercising the runtime guard with a wrong type.
    noRationale.draft.rationale = null
    expect(parseGrafanaPanelDraft(noRationale)).toBeNull()
  })

  it('rejects a malformed panel envelope (missing title/type)', () => {
    const noTitle = validDraftData()
    // @ts-expect-error — deleting a required field for the guard.
    delete noTitle.draft.panel.title
    expect(parseGrafanaPanelDraft(noTitle)).toBeNull()

    const noType = validDraftData()
    // @ts-expect-error — wrong type for the guard.
    noType.draft.panel.type = 7
    expect(parseGrafanaPanelDraft(noType)).toBeNull()
  })

  it('rejects a datasource missing type or uid', () => {
    const badDs = validDraftData()
    // @ts-expect-error — dropping a required field for the guard.
    delete badDs.draft.panel.datasource.uid
    expect(parseGrafanaPanelDraft(badDs)).toBeNull()
  })

  it('rejects a grid_pos whose coordinates are not all numbers, or is missing', () => {
    const badGrid = validDraftData()
    // @ts-expect-error — wrong type for the guard.
    badGrid.draft.panel.grid_pos.w = '12'
    expect(parseGrafanaPanelDraft(badGrid)).toBeNull()

    const noGrid = validDraftData()
    // @ts-expect-error — dropping the required grid_pos for the guard.
    delete noGrid.draft.panel.grid_pos
    expect(parseGrafanaPanelDraft(noGrid)).toBeNull()
  })

  it('drops malformed target entries but keeps valid ones (ref_id required)', () => {
    const mixed = validDraftData()
    mixed.draft.panel.targets = [
      { ref_id: 'A', raw_sql: 'SELECT 1', format: 'table' },
      // missing ref_id → dropped
      { raw_sql: 'SELECT 2' },
      // not an object → dropped
      'garbage',
      // prometheus-style expr-only target → kept, no raw_sql key
      { ref_id: 'B', expr: 'rate(x[5m])' },
    ] as unknown as typeof mixed.draft.panel.targets
    const out = parseGrafanaPanelDraft(mixed)
    expect(out).not.toBeNull()
    expect(out?.panel.targets).toEqual([
      { ref_id: 'A', raw_sql: 'SELECT 1', format: 'table' },
      { ref_id: 'B', expr: 'rate(x[5m])' },
    ])
  })

  it('defaults targets and referenced_tables to arrays and filters non-string tables', () => {
    const noArrays = validDraftData()
    // @ts-expect-error — omit targets entirely.
    delete noArrays.draft.panel.targets
    noArrays.draft.referenced_tables = ['drives', 42, 'charging_sessions', null] as unknown as string[]
    const out = parseGrafanaPanelDraft(noArrays)
    expect(out?.panel.targets).toEqual([])
    expect(out?.referenced_tables).toEqual(['drives', 'charging_sessions'])
  })
})

describe('AINLGrafanaPanel — AI-off contract gate', () => {
  it('renders nothing when ai_mode=off even with the nl-grafana-panel toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { 'nl-grafana-panel': true } }),
    )

    const { container } = render(<AINLGrafanaPanel onApply={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode is on but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { 'nl-grafana-panel': false } }),
    )

    const { container } = render(<AINLGrafanaPanel onApply={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the flag is entirely absent from ai_features', () => {
    mockUseSettings.mockReturnValue(settingsPayload({ ai_mode: 'local', ai_features: {} }))

    const { container } = render(<AINLGrafanaPanel onApply={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing (fail-closed) when the settings query has not resolved yet', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(<AINLGrafanaPanel onApply={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders the gated section with title, description, badge, prompt input and CTA when fully enabled (positive control)', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AINLGrafanaPanel onApply={vi.fn()} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'nl-grafana-panel')
    expect(
      screen.getByRole('heading', { name: /Grafana panel drafter/i }),
    ).toBeInTheDocument()
    expect(root).toHaveTextContent(/Helix/)
    // The prompt Textarea is exposed by its aria-label.
    expect(
      screen.getByRole('textbox', { name: /Grafana panel request/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', DRAFT_BUTTON)).toBeInTheDocument()
    // No draft captured yet → no Apply button / preview.
    expect(
      screen.queryByTestId('ai-feature-nl-grafana-panel-apply'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('ai-feature-nl-grafana-panel-draft'),
    ).not.toBeInTheDocument()
  })
})

describe('AINLGrafanaPanel — canDraft guarding', () => {
  it('disables the Draft CTA while the prompt is empty and enables it once non-empty (aria parity)', () => {
    render(<AINLGrafanaPanel onApply={vi.fn()} />)

    const button = screen.getByRole('button', DRAFT_BUTTON)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')

    fireEvent.change(
      screen.getByRole('textbox', { name: /Grafana panel request/i }),
      { target: { value: 'drives per day this month' } },
    )

    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
  })

  it('treats a whitespace-only prompt as empty (trimmed) — CTA stays disabled', () => {
    render(<AINLGrafanaPanel onApply={vi.fn()} />)

    fireEvent.change(
      screen.getByRole('textbox', { name: /Grafana panel request/i }),
      { target: { value: '    \t  ' } },
    )

    expect(screen.getByRole('button', DRAFT_BUTTON)).toBeDisabled()
  })

  it('does not fire the network while the Draft CTA is disabled', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('should not be called')
    })
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch

    render(<AINLGrafanaPanel onApply={vi.fn()} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', DRAFT_BUTTON))
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('AINLGrafanaPanel — stream wiring', () => {
  it('POSTs once to /api/v1/ai/power/grafana-panel/draft with the trimmed prompt body + SSE headers and renders the first delta', async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text: 'I drafted a timeseries panel against the postgres datasource.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 110, out: 92 } })
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init })
        return new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
    ) as unknown as typeof globalThis.fetch

    render(<AINLGrafanaPanel onApply={vi.fn()} />)

    fireEvent.change(
      screen.getByRole('textbox', { name: /Grafana panel request/i }),
      { target: { value: '  drives per day this month  ' } },
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', DRAFT_BUTTON))
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe('/api/v1/ai/power/grafana-panel/draft')
    expect(init?.method).toBe('POST')
    // Body carries the TRIMMED prompt — no leading/trailing whitespace.
    expect(JSON.parse(init?.body as string)).toEqual({
      prompt: 'drives per day this month',
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /timeseries panel against the postgres datasource/,
      )
    })
  })

  it('guards against double-submit while a stream is in flight', async () => {
    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      // Never enqueue, never close — keeps state='streaming'.
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            /* held open */
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AINLGrafanaPanel onApply={vi.fn()} />)
    fireEvent.change(
      screen.getByRole('textbox', { name: /Grafana panel request/i }),
      { target: { value: 'battery soc over time' } },
    )
    const button = screen.getByRole('button', DRAFT_BUTTON)

    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))
    // While streaming the CTA disables itself.
    await waitFor(() => expect(button).toBeDisabled())

    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })

  it('surfaces a Helix error in the output panel when the stream responds non-2xx (no Apply button)', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(<AINLGrafanaPanel onApply={vi.fn()} />)
    fireEvent.change(
      screen.getByRole('textbox', { name: /Grafana panel request/i }),
      { target: { value: 'sleep time per day' } },
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', DRAFT_BUTTON))
    })

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error/i)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
    expect(
      screen.queryByTestId('ai-feature-nl-grafana-panel-apply'),
    ).not.toBeInTheDocument()
  })
})

describe('AINLGrafanaPanel — typed draft capture + Apply handoff', () => {
  it('captures a draft_grafana_panel tool_result, renders the reviewable preview, and forwards the typed draft to onApply on Apply', async () => {
    const sseBody =
      sseFrame('delta', { text: 'Proposing a panel…' }) +
      sseFrame('tool_call', {
        id: 'c1',
        name: 'draft_grafana_panel',
        arguments: {},
      }) +
      sseFrame('tool_result', {
        id: 'c1',
        name: 'draft_grafana_panel',
        ok: true,
        data: validDraftData(),
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 110, out: 96 } })
    globalThis.fetch = vi.fn(async () => {
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    const onApply = vi.fn()
    render(<AINLGrafanaPanel onApply={onApply} />)

    fireEvent.change(
      screen.getByRole('textbox', { name: /Grafana panel request/i }),
      { target: { value: 'drives per day' } },
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', DRAFT_BUTTON))
    })

    // The typed preview surfaces the panel facts the user reviews.
    const preview = await screen.findByTestId('ai-feature-nl-grafana-panel-draft')
    expect(preview).toHaveTextContent('Drives per day this month')
    expect(preview).toHaveTextContent(/Panel type: timeseries/i)
    expect(preview).toHaveTextContent(/Datasource: postgres \(tesla-postgres\)/i)
    expect(preview).toHaveTextContent(/Referenced tables: drives/i)
    // The preview is an accessibly-labelled group.
    expect(preview).toHaveAttribute('role', 'group')

    const applyButton = screen.getByTestId('ai-feature-nl-grafana-panel-apply')
    expect(applyButton).toBeInTheDocument()
    expect(applyButton).toBeEnabled()

    await act(async () => {
      fireEvent.click(applyButton)
    })
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(EXPECTED_DRAFT)
  })

  it('ignores a tool_result whose data.status is not ok (no preview, onApply never called)', async () => {
    const rejected = validDraftData()
    rejected.status = 'invalid'
    const sseBody =
      sseFrame('tool_result', {
        id: 'c1',
        name: 'draft_grafana_panel',
        ok: true,
        data: rejected,
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } })
    globalThis.fetch = vi.fn(async () => {
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    const onApply = vi.fn()
    render(<AINLGrafanaPanel onApply={onApply} />)
    fireEvent.change(
      screen.getByRole('textbox', { name: /Grafana panel request/i }),
      { target: { value: 'drives per day' } },
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', DRAFT_BUTTON))
    })

    // Stream completed (done) — output panel present — but no draft captured.
    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument(),
    )
    expect(
      screen.queryByTestId('ai-feature-nl-grafana-panel-apply'),
    ).not.toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('ignores tool_result frames for a different tool name', async () => {
    const sseBody =
      sseFrame('tool_result', {
        id: 'c1',
        name: 'validate_grafana_panel',
        ok: true,
        data: validDraftData(),
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } })
    globalThis.fetch = vi.fn(async () => {
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    const onApply = vi.fn()
    render(<AINLGrafanaPanel onApply={onApply} />)
    fireEvent.change(
      screen.getByRole('textbox', { name: /Grafana panel request/i }),
      { target: { value: 'drives per day' } },
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', DRAFT_BUTTON))
    })

    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument(),
    )
    expect(
      screen.queryByTestId('ai-feature-nl-grafana-panel-apply'),
    ).not.toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })
})

describe('AINLGrafanaPanel — metadata', () => {
  it('exposes a stable displayName for React DevTools and the lazy loader', () => {
    expect(AINLGrafanaPanel.displayName).toBe('AINLGrafanaPanel')
  })
})
