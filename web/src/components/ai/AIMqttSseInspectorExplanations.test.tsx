// Comprehensive co-located unit tests for AIMqttSseInspectorExplanations.
//
// This file elevates the MQTT/SSE inspector AI explainer surface. The
// module has a single public export — the withAiFeature-gated
// AIMqttSseInspectorExplanations component — so the suite exercises it
// end-to-end across every facet that matters for production:
//
//   • AI-off contract gate (ADR-015): off mode, per-feature-off, and an
//     unresolved settings query all render nothing; a fully-enabled
//     (cloud OR local) settings state renders the gated section — the
//     positive control that keeps the negative assertions honest.
//   • Window validation / canStart guarding: a valid (from_unix,
//     to_unix) tuple enables the CTA; undefined / partial / zero /
//     negative / reversed / equal / non-finite windows disable it, with
//     aria-disabled parity and the empty-state hint.
//   • Stream wiring: clicking POSTs exactly once to the registered
//     backend route with the in-scope tuple as the body (the LLM cannot
//     widen it), the SSE Accept + JSON Content-Type headers are set, and
//     accumulated delta text renders in the output panel.
//   • Double-submit guard + failure path (non-2xx → Helix error).
//   • Exported displayName metadata.
//
// react-i18next's useTranslation returns the second argument (the
// English fallback) when no provider is mounted, so no i18n setup is
// needed — the same convention every sibling AI test relies on. The
// file-level vi.mock of useSettings takes precedence over the global
// src/test-setup.ts registration (which defaults ai_mode='off').

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIMqttSseInspectorExplanations } from './AIMqttSseInspectorExplanations'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

// A complete-enough AppSettings with realistic non-AI defaults. Per-test
// cases override `ai_mode` + `ai_features` to exercise the gate.
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
// interaction tests. `mode` defaults to 'cloud' but is overridable so a
// single helper covers both non-off modes.
function enabled(mode: 'cloud' | 'local' = 'cloud') {
  return settingsPayload({
    ai_mode: mode,
    ai_features: { 'mqtt-sse-inspector-explanations': true },
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

// The action button's accessible name is the universal Helix CTA plus
// the per-feature label ("Ask Helix · Explain streams"), so this
// unanchored regex locates it whether idle or streaming (aria-label is
// static across states).
const EXPLAIN_BUTTON = { name: /Explain streams/i }

const FROM_UNIX = 1700000000
const TO_UNIX = 1700001800

const ROOT_TESTID = 'ai-feature-mqtt-sse-inspector-explanations-root'

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

describe('AIMqttSseInspectorExplanations — AI-off contract gate', () => {
  it('renders nothing when ai_mode=off even with the mqtt-sse-inspector-explanations toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'mqtt-sse-inspector-explanations': true },
      }),
    )

    const { container } = render(
      <AIMqttSseInspectorExplanations fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', EXPLAIN_BUTTON),
    ).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode is non-off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'mqtt-sse-inspector-explanations': false },
      }),
    )

    const { container } = render(
      <AIMqttSseInspectorExplanations fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing (fail-closed) while the settings query is still unresolved', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(
      <AIMqttSseInspectorExplanations fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section with title, description, badge and CTA when fully enabled in cloud mode (positive control)', () => {
    mockUseSettings.mockReturnValue(enabled('cloud'))

    render(
      <AIMqttSseInspectorExplanations fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'mqtt-sse-inspector-explanations',
    )
    // Heading + description prove the card is fully wired, not a stub.
    expect(
      screen.getByRole('heading', { name: /Helix stream explainer/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/3-6 sentence factual explanation/i),
    ).toBeInTheDocument()
    // Helix badge text renders inside the gated root.
    expect(root).toHaveTextContent(/Helix/)
    expect(screen.getByRole('button', EXPLAIN_BUTTON)).toBeInTheDocument()
  })

  it('also renders the gated section in local mode (mode gate is off-vs-non-off, not cloud-only)', () => {
    mockUseSettings.mockReturnValue(enabled('local'))

    render(
      <AIMqttSseInspectorExplanations fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )

    expect(screen.getByTestId(ROOT_TESTID)).toBeInTheDocument()
    expect(screen.getByRole('button', EXPLAIN_BUTTON)).toBeInTheDocument()
  })
})

describe('AIMqttSseInspectorExplanations — window validation / canStart guarding', () => {
  it('enables the CTA for a valid window, mirrors aria-disabled=false, and hides the empty hint', () => {
    render(
      <AIMqttSseInspectorExplanations fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )

    const button = screen.getByRole('button', EXPLAIN_BUTTON)
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    expect(
      screen.queryByText(/A valid time window is required/i),
    ).not.toBeInTheDocument()
  })

  it('disables the CTA and shows the empty hint when no window is supplied', () => {
    render(<AIMqttSseInspectorExplanations />)

    const button = screen.getByRole('button', EXPLAIN_BUTTON)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByText(/A valid time window is required/i),
    ).toBeInTheDocument()
  })

  it('disables the CTA when only one bound of the window is supplied', () => {
    const { rerender } = render(
      <AIMqttSseInspectorExplanations fromUnix={FROM_UNIX} />,
    )
    expect(screen.getByRole('button', EXPLAIN_BUTTON)).toBeDisabled()

    rerender(<AIMqttSseInspectorExplanations toUnix={TO_UNIX} />)
    expect(screen.getByRole('button', EXPLAIN_BUTTON)).toBeDisabled()
  })

  it('disables the CTA for zero, negative, reversed, equal, and non-finite windows', () => {
    // Zero from_unix — backend rejects from_unix <= 0.
    const { rerender } = render(
      <AIMqttSseInspectorExplanations fromUnix={0} toUnix={TO_UNIX} />,
    )
    expect(screen.getByRole('button', EXPLAIN_BUTTON)).toBeDisabled()

    // Negative from_unix.
    rerender(
      <AIMqttSseInspectorExplanations fromUnix={-1} toUnix={TO_UNIX} />,
    )
    expect(screen.getByRole('button', EXPLAIN_BUTTON)).toBeDisabled()

    // Reversed window (to_unix < from_unix).
    rerender(
      <AIMqttSseInspectorExplanations fromUnix={TO_UNIX} toUnix={FROM_UNIX} />,
    )
    expect(screen.getByRole('button', EXPLAIN_BUTTON)).toBeDisabled()

    // Zero-width window (to_unix === from_unix) — backend rejects
    // to_unix <= from_unix, so the strict `>` guard must disable it.
    rerender(
      <AIMqttSseInspectorExplanations fromUnix={FROM_UNIX} toUnix={FROM_UNIX} />,
    )
    expect(screen.getByRole('button', EXPLAIN_BUTTON)).toBeDisabled()

    // Non-finite bounds must never satisfy the window guard.
    rerender(
      <AIMqttSseInspectorExplanations fromUnix={Number.NaN} toUnix={TO_UNIX} />,
    )
    expect(screen.getByRole('button', EXPLAIN_BUTTON)).toBeDisabled()

    rerender(
      <AIMqttSseInspectorExplanations
        fromUnix={FROM_UNIX}
        toUnix={Number.POSITIVE_INFINITY}
      />,
    )
    expect(screen.getByRole('button', EXPLAIN_BUTTON)).toBeDisabled()
  })

  it('does not fire the network when the CTA is disabled (no window)', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('should not be called')
    })
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch

    render(<AIMqttSseInspectorExplanations />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', EXPLAIN_BUTTON))
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('AIMqttSseInspectorExplanations — stream wiring', () => {
  it('POSTs once to /api/v1/ai/system/streams/explain with the in-scope tuple + SSE headers and renders the first delta', async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const narrative =
      'The MQTT broker is connected and serving the live signal pipeline cleanly.'
    const sseBody =
      sseFrame('delta', { text: narrative }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 220, out: 90 } })
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init })
        return new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
    ) as unknown as typeof globalThis.fetch

    render(
      <AIMqttSseInspectorExplanations fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', EXPLAIN_BUTTON))
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe('/api/v1/ai/system/streams/explain')
    expect(init?.method).toBe('POST')
    // The body MUST carry ONLY the in-scope (from_unix, to_unix) tuple so
    // a compromised LLM cannot widen the window it is allowed to read.
    expect(JSON.parse(init?.body as string)).toEqual({
      from_unix: FROM_UNIX,
      to_unix: TO_UNIX,
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        narrative,
      )
    })
  })

  it('accumulates multiple delta frames in arrival order in the output panel', async () => {
    const sseBody =
      sseFrame('delta', { text: 'Broker healthy. ' }) +
      sseFrame('delta', { text: 'Zero stale streams.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 4 } })
    globalThis.fetch = vi.fn(async () => {
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(
      <AIMqttSseInspectorExplanations fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', EXPLAIN_BUTTON))
    })

    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        'Broker healthy. Zero stale streams.',
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

    render(
      <AIMqttSseInspectorExplanations fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )
    const button = screen.getByRole('button', EXPLAIN_BUTTON)

    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))
    // While streaming the CTA disables itself (computed from state).
    await waitFor(() => expect(button).toBeDisabled())

    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })

  it('surfaces a Helix error in the output panel when the stream responds non-2xx', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(
      <AIMqttSseInspectorExplanations fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', EXPLAIN_BUTTON))
    })

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error/i)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
  })
})

describe('AIMqttSseInspectorExplanations — metadata', () => {
  it('exposes a stable displayName for React DevTools and the lazy loader', () => {
    expect(AIMqttSseInspectorExplanations.displayName).toBe(
      'AIMqttSseInspectorExplanations',
    )
  })
})
