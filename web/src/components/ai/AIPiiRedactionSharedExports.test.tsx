// Comprehensive unit tests for AIPiiRedactionSharedExports.
//
// This file elevates the shared-export PII-redaction advisor surface.
// The module has a single export — the withAiFeature-gated
// `AIPiiRedactionSharedExports` component — so every facet of that one
// export is exercised here:
//
//   • AI-off contract gate (ADR-015): off mode / per-feature toggle off /
//     flag entirely absent / unresolved settings all render NOTHING
//     (fail-closed). A fully-enabled positive control proves the negatives
//     aren't trivially true.
//   • Enabled surface structure + a11y: title, description, Helix badge,
//     the export_type Select (combobox) with the full canonical option
//     set + placeholder, the empty-state hint, and the CTA's per-feature
//     accessible name.
//   • canStart guarding: the CTA is disabled (with aria-disabled parity)
//     until a real export_type is picked, re-disables when the placeholder
//     is re-selected, and never fires the network while disabled.
//   • Stream wiring: clicking POSTs exactly once to the registered SI-clean
//     route with the CHOSEN export_type in the body + the SSE Accept
//     header, and the first delta renders in the shared output panel. A
//     second selection proves the body is dynamic, not hardcoded.
//   • Double-submit guard + failure path (non-2xx → Helix error).
//   • Exported displayName metadata.
//
// Conventions mirrored from the sibling AI tests:
//   - react-i18next's useTranslation returns the English fallback (the 2nd
//     arg) when no provider is mounted, so no i18n setup is needed.
//   - A file-level vi.mock('@/hooks/useSettings') takes precedence over the
//     global stub in src/test-setup.ts, letting each test drive
//     ai_mode / ai_features straight into the withAiFeature gate.
//   - @testing-library/user-event is intentionally NOT a dependency of this
//     codebase (see web/package.json), so DOM interactions use fireEvent —
//     the same choice the existing wiring tests document.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  act,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIPiiRedactionSharedExports } from './AIPiiRedactionSharedExports'

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
// structure + interaction tests.
function enabled(mode: 'local' | 'cloud' = 'cloud') {
  return settingsPayload({
    ai_mode: mode,
    ai_features: { 'pii-redaction-shared-exports': true },
  })
}

// makeReadableStream constructs a ReadableStream<Uint8Array> from text
// chunks — byte-for-byte the same input useAiStream's SSE parser consumes
// in production.
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

// The action button's accessible name is the universal Helix CTA plus the
// per-feature label ("Ask Helix · Suggest redactions"), so this UNANCHORED
// regex locates it whether idle or streaming (aria-label is static).
const CTA = { name: /Suggest redactions/i }
const ROOT_TESTID = 'ai-feature-pii-redaction-shared-exports-root'
const NO_TYPE_HINT = 'Pick an export type to enable Helix.'
const ROUTE = '/api/v1/ai/exports/redaction/draft'

// pickType selects an export_type through the inputSlot <select>, flushing
// the resulting state update inside act().
async function pickType(value: string) {
  const select = screen.getByRole('combobox', { name: /Export type/i })
  await act(async () => {
    fireEvent.change(select, { target: { value } })
  })
  return select
}

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

describe('AIPiiRedactionSharedExports — AI-off contract gate', () => {
  it('renders nothing when ai_mode=off even with the pii-redaction-shared-exports toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'pii-redaction-shared-exports': true },
      }),
    )

    const { container } = render(<AIPiiRedactionSharedExports />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode is non-off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'pii-redaction-shared-exports': false },
      }),
    )

    const { container } = render(<AIPiiRedactionSharedExports />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the flag is entirely absent from ai_features', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'local', ai_features: {} }),
    )

    const { container } = render(<AIPiiRedactionSharedExports />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing (fail-closed) when the settings query has not resolved yet', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(<AIPiiRedactionSharedExports />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section with the registry markers when fully enabled (positive control)', () => {
    mockUseSettings.mockReturnValue(enabled('local'))

    render(<AIPiiRedactionSharedExports />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'pii-redaction-shared-exports',
    )
    expect(
      screen.getByRole('heading', { name: /Plan PII redactions before sharing/i }),
    ).toBeInTheDocument()
  })
})

describe('AIPiiRedactionSharedExports — enabled surface structure & a11y', () => {
  beforeEach(() => {
    mockUseSettings.mockReturnValue(enabled())
  })

  it('renders the catalog-based privacy description (read-only narration contract)', () => {
    render(<AIPiiRedactionSharedExports />)

    expect(
      screen.getByText(/Helix never reads the rows of your export/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/deterministic per-export-type PII catalog/i),
    ).toBeInTheDocument()
  })

  it('renders the Helix badge inside the gated root', () => {
    render(<AIPiiRedactionSharedExports />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toHaveTextContent(/Helix/)
  })

  it('exposes the export_type combobox with the placeholder + all six canonical options', () => {
    render(<AIPiiRedactionSharedExports />)

    const select = screen.getByRole('combobox', { name: /Export type/i })
    const options = within(select).getAllByRole('option')
    // placeholder + the six SHARED_EXPORT_TYPES slugs.
    expect(options).toHaveLength(7)
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      '',
      'drives',
      'charging',
      'trips',
      'analytics',
      'backup',
      'account',
    ])
    // The canonical slug is capitalised for the visible (fallback) label.
    expect(screen.getByRole('option', { name: 'Drives' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Account' })).toBeInTheDocument()
  })

  it('surfaces the placeholder copy on the combobox until a type is chosen', () => {
    render(<AIPiiRedactionSharedExports />)

    expect(
      screen.getByRole('option', { name: 'Select an export type…' }),
    ).toBeInTheDocument()
  })

  it('shows the empty-state hint while no type is picked, then hides it once one is', async () => {
    render(<AIPiiRedactionSharedExports />)

    expect(screen.getByText(NO_TYPE_HINT)).toBeInTheDocument()

    await pickType('drives')

    await waitFor(() =>
      expect(screen.queryByText(NO_TYPE_HINT)).not.toBeInTheDocument(),
    )
  })

  it('gives the CTA a Helix-branded per-feature accessible name via aria-label', () => {
    render(<AIPiiRedactionSharedExports />)

    const button = screen.getByRole('button', CTA)
    expect(button).toHaveAttribute(
      'aria-label',
      'Ask Helix · Suggest redactions',
    )
  })
})

describe('AIPiiRedactionSharedExports — canStart guarding', () => {
  beforeEach(() => {
    mockUseSettings.mockReturnValue(enabled())
  })

  it('disables the CTA (aria-disabled=true) before any export_type is picked', () => {
    render(<AIPiiRedactionSharedExports />)

    const button = screen.getByRole('button', CTA)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('enables the CTA (aria-disabled=false) once a real export_type is picked', async () => {
    render(<AIPiiRedactionSharedExports />)

    const button = screen.getByRole('button', CTA)
    await pickType('analytics')

    await waitFor(() => expect(button).toBeEnabled())
    expect(button).toHaveAttribute('aria-disabled', 'false')
  })

  it('re-disables the CTA when the user re-selects the placeholder (empty value)', async () => {
    render(<AIPiiRedactionSharedExports />)

    const button = screen.getByRole('button', CTA)
    await pickType('backup')
    await waitFor(() => expect(button).toBeEnabled())

    await pickType('')
    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByText(NO_TYPE_HINT)).toBeInTheDocument()
  })

  it('does not fire the network when the CTA is clicked while disabled', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('should not be called')
    })
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch

    render(<AIPiiRedactionSharedExports />)
    const button = screen.getByRole('button', CTA)
    await act(async () => {
      fireEvent.click(button)
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('AIPiiRedactionSharedExports — stream wiring', () => {
  beforeEach(() => {
    mockUseSettings.mockReturnValue(enabled())
  })

  it('POSTs once to the registered route with the chosen export_type + SSE headers and renders the first delta', async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const narration =
      'For the account export, redact email and phone (highly recommended).'
    const sseBody =
      sseFrame('delta', { text: narration }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 90, out: 28 } })
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init })
        return new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
    ) as unknown as typeof globalThis.fetch

    render(<AIPiiRedactionSharedExports />)
    const button = screen.getByRole('button', CTA)
    await pickType('account')
    await waitFor(() => expect(button).toBeEnabled())

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    // useAiStream prepends `${getApiBase()}/api/v1`; getApiBase() is '' in
    // tests, so the final URL is the bare registered path.
    expect(url).toBe(ROUTE)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ export_type: 'account' })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        narration,
      ),
    )
  })

  it('feeds the CURRENTLY-selected export_type into the body (dynamic, not hardcoded)', async () => {
    const bodies: Array<unknown> = []
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string))
      return new Response(
        makeReadableStream([
          sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
        ]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AIPiiRedactionSharedExports />)
    const button = screen.getByRole('button', CTA)
    await pickType('trips')
    await waitFor(() => expect(button).toBeEnabled())

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ export_type: 'trips' })
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

    render(<AIPiiRedactionSharedExports />)
    const button = screen.getByRole('button', CTA)
    await pickType('drives')
    await waitFor(() => expect(button).toBeEnabled())

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

    render(<AIPiiRedactionSharedExports />)
    const button = screen.getByRole('button', CTA)
    await pickType('backup')
    await waitFor(() => expect(button).toBeEnabled())

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error/i)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
  })
})

describe('AIPiiRedactionSharedExports — metadata', () => {
  it('exposes a stable displayName for React DevTools and the lazy loader', () => {
    expect(AIPiiRedactionSharedExports.displayName).toBe(
      'AIPiiRedactionSharedExports',
    )
  })
})
