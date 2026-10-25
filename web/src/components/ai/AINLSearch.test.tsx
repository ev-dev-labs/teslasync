import { appSettingsPayload } from '@/test/fixtures/appSettings'
import { makeReadableStream, sseFrame } from '@/test/fixtures/aiPayloads'
// Behaviour + hardening coverage for the natural-language search
// surface (AINLSearch).
//
// The only export is the withAiFeature-wrapped component. Its
// behaviour has four distinct facets, all exercised here:
//
//   1. Render gate (ADR-015 AI-Off Contract). Off mode OR a
//      per-feature toggle of false OR an unresolved ai_features map
//      hides the surface entirely; the positive control proves the
//      gate is not trivially always-off.
//
//   2. Input guard. The Search button derives its disabled state from
//      `canStart = prompt.trim().length > 0`. This covers the empty /
//      whitespace-only / non-empty prompt branches, matching the
//      backend which trims and rejects an empty prompt with a 400
//      (internal/api/aisearch/handler.go).
//
//   3. Textarea a11y + control. The prompt textarea carries a visible
//      associated label, a placeholder, and a maxLength
//      matching the backend's maxPromptChars cap, and is a controlled
//      input that reflects typed text.
//
//   4. Stream wiring. Typing a prompt then clicking POSTs exactly once
//      to /api/v1/ai/search/query with ONLY a prompt field (the
//      handler deliberately does NOT accept a vehicle_id), renders the
//      accumulated delta text, guards against double-submit while
//      streaming, and surfaces a non-2xx response as an inline Helix
//      error (the off-mode-at-the-backend fallback).
//
// react-i18next returns the English fallback (2nd arg to t()) when no
// provider is mounted, so button/label assertions match the default
// copy. getApiBase() returns '' under jsdom, so the fetch URL is the
// bare /api/v1 path. Network is fully mocked — no real requests.
// Existing SSE wiring cases use fireEvent. The visible-label cases use
// userEvent to exercise native label focus and keyboard interaction.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import * as aiStream from '@/hooks/useAiStream'

// File-level mock wins over the global useSettings stub registered in
// src/test-setup.ts (which defaults ai_mode='off'). Each test drives
// the render gate explicitly via mockUseSettings.mockReturnValue.



vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AINLSearch } from '@/components/ai/AINLSearch'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const FEATURE_ID = 'nl-search'
const ROOT_TESTID = 'ai-feature-nl-search-root'
const QUERY_URL = '/api/v1/ai/search/query'

// A complete AppSettings with realistic non-AI defaults. Individual
// tests override ai_mode / ai_features to walk the gate branches.
// enableFeature flips the gate on (ai_mode='cloud' + the per-feature
// toggle) so the always-on inner card renders.
function enableFeature(extra: Partial<AppSettings> = {}) {
  mockUseSettings.mockReturnValue(
    appSettingsPayload({
      ai_mode: 'cloud',
      ai_features: { [FEATURE_ID]: true },
      ...extra,
    }),
  )
}

// makeReadableStream builds a ReadableStream<Uint8Array> out of text
// chunks, mirroring the helper useAiStream's own tests use so the SSE
// parser receives byte-for-byte equivalent input.
// sseFrame formats one SSE event the way internal/ai/stream/writer.go
// emits it (`event: <name>\ndata: <json>\n\n`).
// installStreamingFetch records every request and returns the given
// SSE body as a 200 text/event-stream response.
function installStreamingFetch(body: string) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(makeReadableStream([body]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as unknown as typeof globalThis.fetch
  return calls
}

function searchButton() {
  return screen.getByRole('button', { name: /Search with Helix/i })
}

function promptInput() {
  return screen.getByRole('textbox', { name: /Search query/i })
}

// renderReady mounts the enabled surface and types a prompt so the
// Search button is enabled and ready to fire.
function renderReady(
  promptText = 'drives last weekend over 200 km with phantom drain',
) {
  const utils = render(<AINLSearch />)
  fireEvent.change(promptInput(), { target: { value: promptText } })
  return { ...utils, promptText }
}

beforeEach(() => {
  mockUseSettings.mockReset()
  // Fail loudly if a test forgets to install its own fetch instead of
  // silently timing out on a real network call.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AINLSearch — render gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the feature toggle on', () => {
    // The toggle is intentionally true to defeat the "hidden because
    // nothing is enabled" shortcut — mode=off must trump it.
    mockUseSettings.mockReturnValue(
      appSettingsPayload({ ai_mode: 'off', ai_features: { [FEATURE_ID]: true } }),
    )

    const { container } = render(<AINLSearch />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is false even with mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      appSettingsPayload({ ai_mode: 'cloud', ai_features: { [FEATURE_ID]: false } }),
    )

    const { container } = render(<AINLSearch />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_features is undefined (settings not yet resolved)', () => {
    mockUseSettings.mockReturnValue(appSettingsPayload({ ai_mode: 'cloud' }))

    const { container } = render(<AINLSearch />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section with the registered marker + copy when fully enabled (positive control)', () => {
    enableFeature()

    render(<AINLSearch />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    // Title + description framing so the user understands what the
    // search surface does.
    expect(screen.getByText('Search with natural language')).toBeInTheDocument()
    expect(root).toHaveTextContent(/surface drives, charging sessions, and alerts/)
    // The Helix badge rides in the header.
    expect(root).toHaveTextContent(/Helix/)
  })
})

describe('AINLSearch — prompt input guard', () => {
  it('disables the Search button and shows the empty hint when the prompt is empty', () => {
    enableFeature()

    render(<AINLSearch />)

    const button = searchButton()
    expect(button).toBeDisabled()
    // The disabled state is a COMPUTED expression mirrored into
    // aria-disabled for screen-reader parity (never a literal
    // disabled={true}).
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // Empty-state affordance guides the user on what is missing.
    expect(
      screen.getByText(/Type a question above to search/i),
    ).toBeInTheDocument()
  })

  it('disables the Search button when the prompt is only whitespace (trim branch)', () => {
    enableFeature()

    render(<AINLSearch />)
    fireEvent.change(promptInput(), { target: { value: '   \n\t ' } })

    expect(searchButton()).toBeDisabled()
    expect(searchButton()).toHaveAttribute('aria-disabled', 'true')
  })

  it('enables the Search button and hides the empty hint once a prompt is present', () => {
    enableFeature()

    render(<AINLSearch />)
    fireEvent.change(promptInput(), { target: { value: 'charging sessions over 50 kWh' } })

    const button = searchButton()
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    expect(
      screen.queryByText(/Type a question above to search/i),
    ).not.toBeInTheDocument()
  })
})

describe('AINLSearch — prompt textarea a11y + control', () => {
  it('exposes an accessible name, placeholder, and the backend prompt cap on the textarea', () => {
    enableFeature()

    render(<AINLSearch />)

    const textarea = promptInput()
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveAttribute(
      'placeholder',
      expect.stringMatching(/phantom drain/i),
    )
    // maxLength mirrors maxPromptChars (4096) so an oversized paste
    // cannot produce a guaranteed backend 400.
    expect(textarea).toHaveAttribute('maxlength', '4096')
  })

  it('reflects typed text as a controlled input', () => {
    enableFeature()

    render(<AINLSearch />)

    const textarea = promptInput() as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'alerts from last Tuesday' } })
    expect(textarea.value).toBe('alerts from last Tuesday')
  })
})

describe('AINLSearch — stream wiring', () => {
  it('POSTs once to the search route with ONLY a prompt (no vehicle_id) and renders the delta', async () => {
    enableFeature()

    const sseBody =
      sseFrame('delta', {
        text: 'Found 3 drives last weekend over 200 km, including "Coastal loop" with notable phantom drain overnight.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 80, out: 30 } })
    const calls = installStreamingFetch(sseBody)

    const { promptText } = renderReady()

    const button = searchButton()
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })

    // Exactly one request, against the bare /api/v1 path, POST with the
    // streaming Accept header and a prompt-only body.
    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(QUERY_URL)
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')
    const parsed = JSON.parse(init?.body as string)
    // The backend handler deliberately accepts ONLY a prompt field —
    // asserting deep equality guards against a vehicle_id (or any
    // other key) leaking back into the request shape.
    expect(parsed).toEqual({ prompt: promptText })
    expect(parsed.vehicle_id).toBeUndefined()

    // The accumulated delta renders inside the gated wrapper.
    await waitFor(() => {
      expect(screen.getByText(/Found 3 drives last weekend/)).toBeInTheDocument()
    })
  })

  describe('AINLSearch — visible prompt label (SS09)', () => {
    it('keeps a visible native label after typing and supports label focus, multiline entry, and keyboard search', async () => {
      enableFeature()
      const start = vi.fn()
      const hook = vi.spyOn(aiStream, 'useAiStream').mockReturnValue({
        start,
        cancel: vi.fn(),
        state: 'idle',
        text: '',
        error: null,
        limit: null,
        activity: [],
        usage: null,
        finishReason: null,
      })
      const user = userEvent.setup()
      render(<AINLSearch />)

      const textarea = screen.getByLabelText('Search query') as HTMLTextAreaElement
      const label = screen.getByText('Search query', { selector: 'label' }) as HTMLLabelElement
      expect(label).toBeVisible()
      expect(label).toHaveAttribute('for', textarea.id)
      expect(label.control).toBe(textarea)
      expect(Array.from(textarea.labels ?? [])).toContain(label)
      expect(label.closest('[hidden], [aria-hidden="true"], .sr-only')).toBeNull()
      expect(searchButton()).toBeDisabled()

      await user.click(label)
      expect(textarea).toHaveFocus()
      await user.type(textarea, 'charging sessions')
      await user.keyboard('{Enter}')
      await user.type(textarea, 'with alerts')
      expect(textarea).toHaveValue('charging sessions\nwith alerts')
      expect(label).toBeVisible()
      expect(textarea).toHaveAccessibleName('Search query')
      expect(start).not.toHaveBeenCalled()
      expect(hook).toHaveBeenLastCalledWith({
        url: '/ai/search/query',
        body: { prompt: 'charging sessions\nwith alerts' },
        onEvent: expect.any(Function),
      })

      await user.tab()
      expect(searchButton()).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(start).toHaveBeenCalledTimes(1)
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    it('preserves the visible label and keyboard-disabled action while showing streaming feedback', async () => {
      enableFeature()
      const start = vi.fn()
      vi.spyOn(aiStream, 'useAiStream').mockReturnValue({
        start,
        cancel: vi.fn(),
        state: 'streaming',
        text: '',
        error: null,
        limit: null,
        activity: [],
        usage: null,
        finishReason: null,
      })
      const user = userEvent.setup()
      render(<AINLSearch />)

      const label = screen.getByText('Search query', { selector: 'label' })
      await user.click(label)
      await user.type(promptInput(), 'drives with alerts')
      await user.keyboard('{Enter}')
      await user.tab()
      await user.keyboard('{Enter}')
      await user.click(searchButton())

      expect(label).toBeVisible()
      expect(screen.getByLabelText('Search query')).toBe(promptInput())
      expect(searchButton()).toBeDisabled()
      expect(searchButton()).toHaveAttribute('aria-disabled', 'true')
      expect(searchButton()).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByTestId('ai-output-panel')).toBeVisible()
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(/Helix is thinking/i)
      expect(start).not.toHaveBeenCalled()
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    it('keeps the visible label, editable prompt, retained results, and keyboard retry alongside an error', async () => {
      enableFeature()
      const start = vi.fn()
      vi.spyOn(aiStream, 'useAiStream').mockReturnValue({
        start,
        cancel: vi.fn(),
        state: 'error',
        text: 'Partial synthetic search results',
        error: 'stream_http_404',
        limit: null,
        activity: [],
        usage: null,
        finishReason: null,
      })
      const user = userEvent.setup()
      render(<AINLSearch />)

      const label = screen.getByText('Search query', { selector: 'label' })
      expect(label).toBeVisible()
      expect(screen.getByRole('alert')).toHaveTextContent(/Helix error.*stream_http_404/i)
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent('Partial synthetic search results')
      await user.click(label)
      expect(promptInput()).toHaveFocus()
      await user.type(promptInput(), 'alerts from last Tuesday')
      expect(label).toBeVisible()
      expect(promptInput()).toHaveValue('alerts from last Tuesday')
      expect(searchButton()).not.toBeDisabled()
      await user.tab()
      expect(searchButton()).toHaveFocus()
      await user.keyboard(' ')
      expect(start).toHaveBeenCalledTimes(1)
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })

  it('ignores a second click while streaming (double-submit guard)', async () => {
    enableFeature()

    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      // A stream that never enqueues/closes keeps state='streaming'.
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    renderReady()

    const button = searchButton()
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))

    // While streaming the button reports disabled (computed from
    // isStreaming) and the hook's runningRef coalesces the second call.
    await waitFor(() => expect(button).toBeDisabled())
    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(fetchCount).toBe(1)
  })

  it('surfaces a non-2xx response as an inline Helix error', async () => {
    enableFeature()

    // 404 is exactly the AI-off-at-the-backend / feature-guard path.
    globalThis.fetch = vi.fn(async () =>
      new Response('not found', { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    renderReady()

    await act(async () => {
      fireEvent.click(searchButton())
    })

    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent(/stream_http_404/)
  })
})
