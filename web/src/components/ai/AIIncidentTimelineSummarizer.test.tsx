// Comprehensive unit tests for AIIncidentTimelineSummarizer.
//
// The module has a single public export — the withAiFeature-gated
// `AIIncidentTimelineSummarizer` component — so this suite drives every
// observable facet of it:
//
//   • AI-off contract gate (ADR-015): off mode / per-feature-off / a
//     missing flag / an unresolved settings query all render nothing
//     (fail-closed). Positive controls in both `local` and `cloud` mode
//     prove the negatives aren't trivially true.
//   • canSummarize guarding: the Summarize button's `disabled` is a
//     COMPUTED expression. It is enabled only for a positive-integer
//     incident id (number OR numeric string) and disabled for
//     undefined / 0 / negative / fractional / non-numeric — with
//     aria-disabled parity — and never fires the network while disabled.
//   • Stream wiring: clicking POSTs exactly once to the registered SI
//     route with an empty JSON body + the SSE Accept header, and the
//     first `delta` frame renders inside the gated wrapper.
//   • Empty/loading state: while streaming with no text yet, the panel
//     shows the animated thinking indicator (never a blank panel).
//   • Double-submit guard + failure path (non-2xx → Helix error).
//   • Exported displayName metadata.
//
// react-i18next's useTranslation returns the second argument (English
// fallback) when no provider is mounted, so no i18n setup is needed —
// the same convention the sibling AI tests rely on. A file-level
// vi.mock('@/hooks/useSettings') takes precedence over the global stub
// in src/test-setup.ts, letting each test drive ai_mode / ai_features.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIIncidentTimelineSummarizer } from './AIIncidentTimelineSummarizer'

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
    ai_features: { 'incident-timeline-summarizer': true },
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
// the per-feature label ("Ask Helix · Summarize"), so this regex locates
// it whether idle or streaming (aria-label is static).
const SUMMARIZE_BUTTON = { name: /Summarize/i }
const ROOT_TESTID = 'ai-feature-incident-timeline-summarizer-root'

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

describe('AIIncidentTimelineSummarizer — AI-off contract gate', () => {
  it('renders nothing when ai_mode=off even with the incident-timeline-summarizer toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'incident-timeline-summarizer': true },
      }),
    )

    const { container } = render(<AIIncidentTimelineSummarizer incidentId={7} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode is non-off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'incident-timeline-summarizer': false },
      }),
    )

    const { container } = render(<AIIncidentTimelineSummarizer incidentId={7} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the incident-timeline-summarizer flag is entirely absent from ai_features', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'local', ai_features: {} }),
    )

    const { container } = render(<AIIncidentTimelineSummarizer incidentId={7} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing (fail-closed) when the settings query has not resolved yet', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(<AIIncidentTimelineSummarizer incidentId={7} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section with title, description, badge and CTA when fully enabled in cloud mode (positive control)', () => {
    mockUseSettings.mockReturnValue(enabled('cloud'))

    render(<AIIncidentTimelineSummarizer incidentId={7} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'incident-timeline-summarizer',
    )
    // Heading + description prove the card is fully wired, not a stub.
    expect(
      screen.getByRole('heading', { name: /Helix timeline summary/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/3-6 sentence factual summary/i),
    ).toBeInTheDocument()
    // Helix badge text renders inside the gated root.
    expect(root).toHaveTextContent(/Helix/)
    expect(screen.getByRole('button', SUMMARIZE_BUTTON)).toBeInTheDocument()
  })

  it('also renders the gated section in local mode (positive control across modes)', () => {
    mockUseSettings.mockReturnValue(enabled('local'))

    render(<AIIncidentTimelineSummarizer incidentId={7} />)

    expect(screen.getByTestId(ROOT_TESTID)).toBeInTheDocument()
    expect(screen.getByRole('button', SUMMARIZE_BUTTON)).toBeInTheDocument()
  })
})

describe('AIIncidentTimelineSummarizer — canSummarize guarding', () => {
  it('enables the CTA for a real integer incident id and mirrors aria-disabled=false', () => {
    render(<AIIncidentTimelineSummarizer incidentId={7} />)

    const button = screen.getByRole('button', SUMMARIZE_BUTTON)
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
  })

  it('enables the CTA for a positive-integer numeric STRING id (string→number coercion path)', () => {
    render(<AIIncidentTimelineSummarizer incidentId="7" />)

    expect(screen.getByRole('button', SUMMARIZE_BUTTON)).toBeEnabled()
  })

  it('disables the CTA when incidentId is undefined', () => {
    render(<AIIncidentTimelineSummarizer />)

    const button = screen.getByRole('button', SUMMARIZE_BUTTON)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables the CTA for id 0 and negative ids (backend rejects incident_id <= 0)', () => {
    const { rerender } = render(<AIIncidentTimelineSummarizer incidentId={0} />)
    expect(screen.getByRole('button', SUMMARIZE_BUTTON)).toBeDisabled()

    rerender(<AIIncidentTimelineSummarizer incidentId={-1} />)
    expect(screen.getByRole('button', SUMMARIZE_BUTTON)).toBeDisabled()
  })

  it('disables the CTA for a fractional id (bug fix — would build /incidents/7.5/summarize the backend 400s)', () => {
    render(<AIIncidentTimelineSummarizer incidentId={7.5} />)

    expect(screen.getByRole('button', SUMMARIZE_BUTTON)).toBeDisabled()
  })

  it('disables the CTA for a non-numeric string id (Number("abc") === NaN)', () => {
    render(<AIIncidentTimelineSummarizer incidentId="abc" />)

    expect(screen.getByRole('button', SUMMARIZE_BUTTON)).toBeDisabled()
  })

  it('does not fire the network when the CTA is disabled', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('should not be called')
    })
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch

    render(<AIIncidentTimelineSummarizer incidentId={0} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', SUMMARIZE_BUTTON))
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('AIIncidentTimelineSummarizer — stream wiring', () => {
  it('POSTs once to /api/v1/ai/system/incidents/7/summarize with an empty body + SSE Accept header and renders the first delta', async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text: 'API gateway saw bursty 502s from 14:05-14:35 UTC; a rolling edge-cache restart resolved it.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 120, out: 40 } })
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init })
        return new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
    ) as unknown as typeof globalThis.fetch

    render(<AIIncidentTimelineSummarizer incidentId={7} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', SUMMARIZE_BUTTON))
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe('/api/v1/ai/system/incidents/7/summarize')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({})
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /API gateway saw bursty 502s/,
      )
    })
  })

  it('interpolates a numeric string incident id into the same registered route', async () => {
    const fetchCalls: Array<string> = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      return new Response(
        makeReadableStream([
          sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
        ]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AIIncidentTimelineSummarizer incidentId="42" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', SUMMARIZE_BUTTON))
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    expect(fetchCalls[0]).toBe('/api/v1/ai/system/incidents/42/summarize')
  })

  it('shows the animated thinking indicator (never a blank panel) while streaming before the first delta', async () => {
    globalThis.fetch = vi.fn(async () => {
      // Never enqueue, never close — keeps state='streaming' with no text.
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            /* held open */
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AIIncidentTimelineSummarizer incidentId={7} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', SUMMARIZE_BUTTON))
    })

    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument()
    })
    // Loading affordance: the polite live-region thinking indicator.
    const indicator = screen.getByTestId('ai-thinking-indicator')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveAttribute('role', 'status')
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

    render(<AIIncidentTimelineSummarizer incidentId={7} />)
    const button = screen.getByRole('button', SUMMARIZE_BUTTON)

    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))
    // While streaming the CTA disables itself (computed, not literal).
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

    render(<AIIncidentTimelineSummarizer incidentId={7} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', SUMMARIZE_BUTTON))
    })

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error/i)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
  })
})

describe('AIIncidentTimelineSummarizer — metadata', () => {
  it('exposes a stable displayName for React DevTools and the lazy loader', () => {
    expect(AIIncidentTimelineSummarizer.displayName).toBe(
      'AIIncidentTimelineSummarizer',
    )
  })
})
