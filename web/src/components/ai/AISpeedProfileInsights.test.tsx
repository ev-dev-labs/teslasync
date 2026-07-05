// Comprehensive unit + wiring coverage for AISpeedProfileInsights.
//
// This file elevates the per-drive speed-profile AI surface. It covers
// BOTH exports of the source module:
//
//   1. normalizeDriveId — the pure predicate that both the request URL
//      and the button's enabled state are gated on. Proves the bug fix:
//      `undefined`, empty/whitespace, and the "0" route placeholder all
//      collapse to '' (so no insights request can fire for a non-drive),
//      while a real id is trimmed but preserved verbatim.
//
//   2. AISpeedProfileInsights — the withAiFeature-gated component:
//        • AI-off contract (off mode / per-feature-off / missing flag /
//          unresolved settings all render nothing — fail-closed; the
//          cloud + toggle-on positive control proves the negatives are
//          not trivially true).
//        • canStart guarding (button disabled for undefined/0/whitespace
//          ids, enabled for a real id) with aria-disabled parity, and no
//          network fire while disabled — the regression the source's old
//          `canStart={!!driveId}` allowed.
//        • stream wiring (clicking POSTs once to the SI-clean insights
//          route with an empty body + SSE Accept header; the id is
//          trimmed and path-encoded; the first delta renders in the
//          shared output panel).
//        • double-submit guard + failure path (non-2xx → Helix error).
//        • accessible name / tooltip the shared card composes.
//        • exported displayName metadata.
//
// react-i18next's useTranslation returns the second argument (English
// fallback) when no provider is mounted, so no i18n setup is needed —
// the same convention the sibling AI tests rely on. A file-level
// vi.mock('@/hooks/useSettings') takes precedence over the global stub
// in src/test-setup.ts, letting each test drive ai_mode / ai_features.
// `@testing-library/user-event` is not a dependency of this codebase
// (web/package.json), so interactions go through fireEvent — consistent
// with every other AI SSE-wiring suite.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AISpeedProfileInsights, normalizeDriveId } from './AISpeedProfileInsights'

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

function settingsPayload(overrides: Partial<AppSettings>): { settings: AppSettings } {
  return { settings: { ...baseSettings, ...overrides } }
}

// enabled() is the common "feature fully on" settings state used by the
// interaction tests.
function enabled(mode: 'local' | 'cloud' = 'cloud'): { settings: AppSettings } {
  return settingsPayload({
    ai_mode: mode,
    ai_features: { 'speed-profile-insights': true },
  })
}

// makeReadableStream turns text chunks into the byte-stream shape
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

const DONE_ONLY = sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } })

// The action button's accessible name is the universal Helix CTA plus
// the per-feature label ("Ask Helix · Generate insights"), so this regex
// locates it whether idle or streaming (aria-label is static).
const INSIGHTS_BUTTON = { name: /Generate insights/i }
const ROOT_TESTID = 'ai-feature-speed-profile-insights-root'
const INSIGHTS_ROUTE = '/api/v1/ai/drives/42/speed-profile/insights'

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

describe('normalizeDriveId', () => {
  it('collapses every "no real drive" input to an empty string', () => {
    expect(normalizeDriveId(undefined)).toBe('')
    expect(normalizeDriveId('')).toBe('')
    expect(normalizeDriveId('   ')).toBe('')
    expect(normalizeDriveId('0')).toBe('')
    expect(normalizeDriveId('  0  ')).toBe('')
  })

  it('trims surrounding whitespace off an otherwise valid id', () => {
    expect(normalizeDriveId('42')).toBe('42')
    expect(normalizeDriveId('  42  ')).toBe('42')
    expect(normalizeDriveId('\t7\n')).toBe('7')
  })

  it('preserves non-placeholder ids verbatim (encoding happens at the URL boundary)', () => {
    expect(normalizeDriveId('10')).toBe('10')
    expect(normalizeDriveId('12/34')).toBe('12/34')
    expect(normalizeDriveId('abc')).toBe('abc')
    // "0" is a placeholder, but "00"/"01" are real ids and must survive.
    expect(normalizeDriveId('00')).toBe('00')
    expect(normalizeDriveId('01')).toBe('01')
  })
})

describe('AISpeedProfileInsights — AI-off contract gate', () => {
  it('renders nothing when ai_mode=off even with the speed-profile-insights toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'speed-profile-insights': true },
      }),
    )

    const { container } = render(<AISpeedProfileInsights driveId="42" />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode is non-off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'speed-profile-insights': false },
      }),
    )

    const { container } = render(<AISpeedProfileInsights driveId="42" />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the speed-profile-insights flag is entirely absent from ai_features', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'local', ai_features: {} }),
    )

    const { container } = render(<AISpeedProfileInsights driveId="42" />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing (fail-closed) when the settings query has not resolved yet', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(<AISpeedProfileInsights driveId="42" />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section with title, description, badge and CTA when fully enabled (positive control)', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AISpeedProfileInsights driveId="42" />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'speed-profile-insights')
    // Heading + description prove the card is fully wired, not a stub.
    expect(
      screen.getByRole('heading', { name: /Speed-profile insights/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/speed regime distribution/i),
    ).toBeInTheDocument()
    // Helix badge text renders inside the gated root.
    expect(root).toHaveTextContent(/Helix/)
    expect(screen.getByRole('button', INSIGHTS_BUTTON)).toBeInTheDocument()
    // The output panel is absent until a stream has run at least once.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
  })
})

describe('AISpeedProfileInsights — canStart guarding', () => {
  it('enables the CTA for a real drive id and mirrors aria-disabled=false', () => {
    render(<AISpeedProfileInsights driveId="42" />)

    const button = screen.getByRole('button', INSIGHTS_BUTTON)
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
  })

  it('disables the CTA when driveId is undefined', () => {
    render(<AISpeedProfileInsights />)

    const button = screen.getByRole('button', INSIGHTS_BUTTON)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables the CTA for the "0" route placeholder (bug fix — would POST /ai/drives/0/…)', () => {
    render(<AISpeedProfileInsights driveId="0" />)

    expect(screen.getByRole('button', INSIGHTS_BUTTON)).toBeDisabled()
  })

  it('disables the CTA for a whitespace-only id (bug fix — would encode to a padded path)', () => {
    render(<AISpeedProfileInsights driveId="   " />)

    expect(screen.getByRole('button', INSIGHTS_BUTTON)).toBeDisabled()
  })

  it('does not fire the network when the CTA is disabled', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('should not be called')
    })
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch

    render(<AISpeedProfileInsights driveId="0" />)
    const button = screen.getByRole('button', INSIGHTS_BUTTON)
    await act(async () => {
      fireEvent.click(button)
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('AISpeedProfileInsights — accessibility', () => {
  it('exposes the per-feature verb as the button accessible name and its tooltip', () => {
    render(<AISpeedProfileInsights driveId="42" />)

    // The shared card composes the accessible name as
    // "Ask Helix · Generate insights" (aria-label) and uses the
    // per-feature verb as the hover tooltip.
    const button = screen.getByRole('button', {
      name: /Ask Helix · Generate insights/i,
    })
    expect(button).toHaveAttribute('title', 'Generate insights')
    expect(button).toHaveAttribute('aria-disabled', 'false')
  })
})

describe('AISpeedProfileInsights — stream wiring', () => {
  it('POSTs once to the SI-clean insights route with an empty body + SSE Accept header and renders the first delta', async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const narrative =
      'This drive skewed suburban: most time in the 30–50 mph band with two brief highway bursts.'
    const sseBody =
      sseFrame('delta', { text: narrative }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 60, out: 24 } })
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init })
        return new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
    ) as unknown as typeof globalThis.fetch

    render(<AISpeedProfileInsights driveId="42" />)
    const button = screen.getByRole('button', INSIGHTS_BUTTON)
    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    // useAiStream prepends `${getApiBase()}/api/v1`; getApiBase() is '' in jsdom.
    expect(url).toBe(INSIGHTS_ROUTE)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({})
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(narrative)
    })
  })

  it('trims a padded id before building the request URL', async () => {
    const fetchCalls: Array<string> = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      return new Response(makeReadableStream([DONE_ONLY]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(<AISpeedProfileInsights driveId="  42  " />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', INSIGHTS_BUTTON))
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    expect(fetchCalls[0]).toBe(INSIGHTS_ROUTE)
  })

  it('path-encodes an id containing reserved characters (defense against path injection)', async () => {
    const fetchCalls: Array<string> = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      return new Response(makeReadableStream([DONE_ONLY]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(<AISpeedProfileInsights driveId="12/34" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', INSIGHTS_BUTTON))
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    expect(fetchCalls[0]).toBe('/api/v1/ai/drives/12%2F34/speed-profile/insights')
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

    render(<AISpeedProfileInsights driveId="42" />)
    const button = screen.getByRole('button', INSIGHTS_BUTTON)

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

  it('surfaces a Helix error in the output panel when the stream responds non-2xx', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(<AISpeedProfileInsights driveId="42" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', INSIGHTS_BUTTON))
    })

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error/i)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
  })
})

describe('AISpeedProfileInsights — metadata', () => {
  it('exposes a stable displayName for React DevTools and the lazy loader', () => {
    expect(AISpeedProfileInsights.displayName).toBe('AISpeedProfileInsights')
  })
})
