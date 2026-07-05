// Comprehensive unit tests for AISoftwareUpdateChangelogSummarizer.
//
// The module has a single public export — the withAiFeature-gated
// `AISoftwareUpdateChangelogSummarizer` component — so this suite drives
// every observable facet of it:
//
//   • AI-off contract gate (ADR-015): off mode / per-feature-off / a
//     missing flag / an unresolved settings query all render nothing
//     (fail-closed). Positive controls in both `local` and `cloud` mode
//     prove the negatives aren't trivially true.
//   • haveInputs guarding: the "Summarize updates" button's `disabled`
//     is a COMPUTED expression. It is enabled only for a positive-INTEGER
//     vehicleId and disabled for undefined / 0 / negative / fractional /
//     NaN — with aria-disabled parity — and never fires the network while
//     disabled. The fractional case is a regression guard: the backend
//     decodes vehicle_id into an int64 and 400s on `{vehicle_id: 42.5}`.
//   • Empty-state hint: when no vehicle is in scope the card shows the
//     "Pick a vehicle above to enable Helix." affordance instead of a
//     blank panel; the hint is absent once a vehicle resolves.
//   • Stream wiring: clicking POSTs exactly once to the registered SI
//     route with the in-scope vehicle_id JSON body + the SSE Accept
//     header, and the first `delta` frame renders inside the gated
//     wrapper.
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
import { AISoftwareUpdateChangelogSummarizer } from './AISoftwareUpdateChangelogSummarizer'

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
    ai_features: { 'software-update-changelog-summarizer': true },
  })
}

// makeReadableStream constructs a ReadableStream<Uint8Array> from
// arbitrarily-sized text chunks. Mirrors the helper used by
// useAiStream.test.ts so the parser receives byte-for-byte equivalent
// input.
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
// internal/ai/stream/writer.go emits it (`event: <name>\ndata: <json>\n\n`).
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// The action button's accessible name is the universal Helix CTA plus
// the per-feature label ("Ask Helix · Summarize updates"), so this
// unanchored regex locates it whether idle or streaming (aria-label is
// static).
const SUMMARIZE_BUTTON = { name: /Summarize updates/i }
const ROOT_TESTID = 'ai-feature-software-update-changelog-summarizer-root'
const NO_VEHICLE_HINT = /Pick a vehicle above to enable Helix/i

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

describe('AISoftwareUpdateChangelogSummarizer — AI-off contract gate', () => {
  it('renders nothing when ai_mode=off even with the software-update-changelog-summarizer toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'software-update-changelog-summarizer': true },
      }),
    )

    const { container } = render(
      <AISoftwareUpdateChangelogSummarizer vehicleId={42} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode is non-off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'software-update-changelog-summarizer': false },
      }),
    )

    const { container } = render(
      <AISoftwareUpdateChangelogSummarizer vehicleId={42} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the software-update-changelog-summarizer flag is entirely absent from ai_features', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'local', ai_features: {} }),
    )

    const { container } = render(
      <AISoftwareUpdateChangelogSummarizer vehicleId={42} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing (fail-closed) when the settings query has not resolved yet', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(
      <AISoftwareUpdateChangelogSummarizer vehicleId={42} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section with title, description, badge and CTA when fully enabled in cloud mode (positive control)', () => {
    mockUseSettings.mockReturnValue(enabled('cloud'))

    render(<AISoftwareUpdateChangelogSummarizer vehicleId={42} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'software-update-changelog-summarizer',
    )
    // Heading + description prove the card is fully wired, not a stub.
    expect(
      screen.getByRole('heading', {
        name: /Summarize my software update history/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/walk through your firmware update history/i),
    ).toBeInTheDocument()
    // Helix badge text renders inside the gated root.
    expect(root).toHaveTextContent(/Helix/)
    expect(screen.getByRole('button', SUMMARIZE_BUTTON)).toBeInTheDocument()
  })

  it('also renders the gated section in local mode (positive control across modes)', () => {
    mockUseSettings.mockReturnValue(enabled('local'))

    render(<AISoftwareUpdateChangelogSummarizer vehicleId={42} />)

    expect(screen.getByTestId(ROOT_TESTID)).toBeInTheDocument()
    expect(screen.getByRole('button', SUMMARIZE_BUTTON)).toBeInTheDocument()
  })
})

describe('AISoftwareUpdateChangelogSummarizer — haveInputs guarding', () => {
  it('enables the CTA for a real positive-integer vehicleId and mirrors aria-disabled=false', () => {
    render(<AISoftwareUpdateChangelogSummarizer vehicleId={7} />)

    const button = screen.getByRole('button', SUMMARIZE_BUTTON)
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
  })

  it('disables the CTA when vehicleId is undefined and shows the pick-a-vehicle empty hint (never a blank action)', () => {
    render(<AISoftwareUpdateChangelogSummarizer />)

    const button = screen.getByRole('button', SUMMARIZE_BUTTON)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(NO_VEHICLE_HINT)).toBeInTheDocument()
  })

  it('disables the CTA for id 0 and negative ids (backend rejects vehicle_id <= 0)', () => {
    const { rerender } = render(
      <AISoftwareUpdateChangelogSummarizer vehicleId={0} />,
    )
    expect(screen.getByRole('button', SUMMARIZE_BUTTON)).toBeDisabled()

    rerender(<AISoftwareUpdateChangelogSummarizer vehicleId={-1} />)
    expect(screen.getByRole('button', SUMMARIZE_BUTTON)).toBeDisabled()
  })

  it('disables the CTA for a fractional id (bug fix — {vehicle_id: 42.5} fails json.Decode into int64 → 400)', () => {
    render(<AISoftwareUpdateChangelogSummarizer vehicleId={42.5} />)

    const button = screen.getByRole('button', SUMMARIZE_BUTTON)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(NO_VEHICLE_HINT)).toBeInTheDocument()
  })

  it('disables the CTA for NaN / Infinity vehicleIds (Number.isInteger rejects both)', () => {
    const { rerender } = render(
      <AISoftwareUpdateChangelogSummarizer vehicleId={Number.NaN} />,
    )
    expect(screen.getByRole('button', SUMMARIZE_BUTTON)).toBeDisabled()

    rerender(
      <AISoftwareUpdateChangelogSummarizer vehicleId={Number.POSITIVE_INFINITY} />,
    )
    expect(screen.getByRole('button', SUMMARIZE_BUTTON)).toBeDisabled()
  })

  it('hides the empty hint once a real vehicle is in scope', () => {
    render(<AISoftwareUpdateChangelogSummarizer vehicleId={42} />)

    expect(screen.queryByText(NO_VEHICLE_HINT)).not.toBeInTheDocument()
  })

  it('does not fire the network when the CTA is disabled (fractional id)', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('should not be called')
    })
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch

    render(<AISoftwareUpdateChangelogSummarizer vehicleId={42.5} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', SUMMARIZE_BUTTON))
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('AISoftwareUpdateChangelogSummarizer — stream wiring', () => {
  it('POSTs once to /api/v1/ai/software-updates/summarize with the vehicle_id body + SSE Accept header and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(enabled('cloud'))

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text: 'Your vehicle is on firmware 2024.20.7 — 8 updates installed over the past 6 months.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 60, out: 12 } })
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init })
        return new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
    ) as unknown as typeof globalThis.fetch

    render(<AISoftwareUpdateChangelogSummarizer vehicleId={42} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', SUMMARIZE_BUTTON))
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    // useAiStream prepends `${getApiBase()}/api/v1`; getApiBase returns
    // '' in the test environment, so the final URL is the registered
    // route verbatim.
    expect(url).toBe('/api/v1/ai/software-updates/summarize')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ vehicle_id: 42 })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /firmware 2024\.20\.7/,
      )
    })
  })

  it('feeds the in-scope vehicle_id (not a hardcoded id) into the POST body', async () => {
    mockUseSettings.mockReturnValue(enabled('cloud'))

    const bodies: Array<string> = []
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(init?.body as string)
        return new Response(
          makeReadableStream([
            sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
          ]),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      },
    ) as unknown as typeof globalThis.fetch

    render(<AISoftwareUpdateChangelogSummarizer vehicleId={9001} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', SUMMARIZE_BUTTON))
    })

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(JSON.parse(bodies[0])).toEqual({ vehicle_id: 9001 })
  })

  it('shows the animated thinking indicator (never a blank panel) while streaming before the first delta', async () => {
    mockUseSettings.mockReturnValue(enabled('cloud'))

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

    render(<AISoftwareUpdateChangelogSummarizer vehicleId={42} />)
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
    mockUseSettings.mockReturnValue(enabled('cloud'))

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

    render(<AISoftwareUpdateChangelogSummarizer vehicleId={42} />)
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
    mockUseSettings.mockReturnValue(enabled('cloud'))

    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(<AISoftwareUpdateChangelogSummarizer vehicleId={42} />)
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

describe('AISoftwareUpdateChangelogSummarizer — metadata', () => {
  it('exposes a stable displayName for React DevTools and the lazy loader', () => {
    expect(AISoftwareUpdateChangelogSummarizer.displayName).toBe(
      'AISoftwareUpdateChangelogSummarizer',
    )
  })
})
