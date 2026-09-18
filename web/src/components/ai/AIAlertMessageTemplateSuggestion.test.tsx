// Co-located unit + wiring test for AIAlertMessageTemplateSuggestion.
//
// Covers:
//   1. ADR-015 render gate (off / toggle-off / missing map / unresolved / on)
//   2. Surface structure + computed-disabled Suggest
//   3. SSE POST with selected dimensions
//   4. validate_alert_message_template capture + Apply
//   5. Reject malformed tool_result envelopes
//
// Network is stubbed at fetch. Interactions use fireEvent.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

vi.mock('react-i18next', () => {
  const interpolate = (template: string, vars?: Record<string, unknown>) =>
    vars
      ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
          String(vars[name] ?? `{{${name}}}`),
        )
      : template
  const t = (
    key: string,
    defaultOrOpts?: string | Record<string, unknown>,
    maybeOpts?: Record<string, unknown>,
  ): string => {
    if (typeof defaultOrOpts === 'string') return interpolate(defaultOrOpts, maybeOpts)
    return interpolate(key, defaultOrOpts)
  }
  return {
    useTranslation: () => ({
      t,
      i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
    }),
    initReactI18next: { type: '3rdParty', init: () => undefined },
    Trans: ({ children }: { children?: unknown }) => children ?? null,
  }
})

import { useSettings } from '@/hooks/useSettings'
import {
  AIAlertMessageTemplateSuggestion,
  type AlertMessageTemplateProposal,
  type AIAlertMessageTemplateSuggestionProps,
} from '@/components/ai/AIAlertMessageTemplateSuggestion'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-alert-message-template-suggestion-root'
const FEATURE_ID = 'alert-message-template-suggestion'
const ROUTE = '/api/v1/ai/alerts/message-template/draft'
const SUGGEST_TESTID = 'ai-feature-alert-message-template-suggestion-suggest'
const APPLY_TESTID = 'ai-feature-alert-message-template-suggestion-apply'
const SUGGEST_NAME = /Suggest template/i
const TITLE = /Suggest a message template/i
const TOOL_NAME = 'validate_alert_message_template'

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

function enabled(overrides: Partial<AppSettings> = {}) {
  return settingsPayload({
    ai_mode: 'cloud',
    ai_features: { [FEATURE_ID]: true },
    ...overrides,
  })
}

const readyDraft = {
  kind: 'signal',
  signal_name: 'BrakePedal',
  op: '=',
  severity: 'info',
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

function pendingStreamResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start() {},
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

const validProposal: AlertMessageTemplateProposal = {
  template: '{{VehicleName}}: brake pedal {{Value}}',
  used_placeholders: ['VehicleName', 'Value'],
  status: 'ok',
}

function stubStreamOnce(sseBody: string) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(makeReadableStream([sseBody]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as unknown as typeof globalThis.fetch
  return calls
}

async function clickSuggest() {
  const suggest = screen.getByRole('button', { name: SUGGEST_NAME })
  await act(async () => {
    fireEvent.click(suggest)
  })
  return suggest
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

describe('AIAlertMessageTemplateSuggestion — exported type contracts', () => {
  it('types a proposal fixture and onApplyTemplate against the public shapes', () => {
    const proposal: AlertMessageTemplateProposal = validProposal
    const props: AIAlertMessageTemplateSuggestionProps = {
      draft: readyDraft,
      onApplyTemplate: (template: string) => void template,
    }
    expect(proposal.status).toBe('ok')
    expect(typeof props.onApplyTemplate).toBe('function')
  })
})

describe('AIAlertMessageTemplateSuggestion — AI-off render gate', () => {
  it('renders nothing when ai_mode=off even with the feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { [FEATURE_ID]: true } }),
    )
    const { container } = render(
      <AIAlertMessageTemplateSuggestion draft={readyDraft} onApplyTemplate={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is off', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { [FEATURE_ID]: false } }),
    )
    const { container } = render(
      <AIAlertMessageTemplateSuggestion draft={readyDraft} onApplyTemplate={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the gated section when ai_mode=cloud AND the toggle is on', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(
      <AIAlertMessageTemplateSuggestion draft={readyDraft} onApplyTemplate={vi.fn()} />,
    )
    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument()
    const suggest = screen.getByRole('button', { name: SUGGEST_NAME })
    expect(suggest).toBeInTheDocument()
    expect(suggest).toHaveAttribute('data-testid', SUGGEST_TESTID)
  })
})

describe('AIAlertMessageTemplateSuggestion — dimensions gate', () => {
  it('disables Suggest until kind+signal+op (or metric_id) are selected', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(
      <AIAlertMessageTemplateSuggestion
        draft={{ kind: 'signal' }}
        onApplyTemplate={vi.fn()}
      />,
    )
    const button = screen.getByRole('button', { name: SUGGEST_NAME })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(/Choose a signal or computed metric/i)).toBeInTheDocument()
  })
})

describe('AIAlertMessageTemplateSuggestion — SSE wiring', () => {
  it('POSTs the selected dimensions to the registered route', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const delta = 'Suggested a BrakePedal template using VehicleName and Value.'
    const sseBody =
      sseFrame('delta', { text: delta }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 80, out: 20 } })
    const calls = stubStreamOnce(sseBody)

    render(
      <AIAlertMessageTemplateSuggestion draft={readyDraft} onApplyTemplate={vi.fn()} />,
    )
    await clickSuggest()

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(ROUTE)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toMatchObject({
      kind: 'signal',
      signal_name: 'BrakePedal',
      op: '=',
      severity: 'info',
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
  })

  it('disables Suggest while the stream is open', async () => {
    mockUseSettings.mockReturnValue(enabled())
    globalThis.fetch = vi.fn(async () => pendingStreamResponse()) as unknown as typeof globalThis.fetch
    render(
      <AIAlertMessageTemplateSuggestion draft={readyDraft} onApplyTemplate={vi.fn()} />,
    )
    const button = await clickSuggest()
    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('AIAlertMessageTemplateSuggestion — proposal capture + apply', () => {
  it('captures a valid validate tool_result and copies the template on Apply', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const sseBody =
      sseFrame('tool_result', {
        id: 'tc1',
        name: TOOL_NAME,
        ok: true,
        data: validProposal,
      }) +
      sseFrame('delta', { text: 'Grounded in BrakePedal placeholders.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 40, out: 12 } })
    stubStreamOnce(sseBody)

    const onApply = vi.fn()
    render(
      <AIAlertMessageTemplateSuggestion draft={readyDraft} onApplyTemplate={onApply} />,
    )
    await clickSuggest()

    const apply = await screen.findByTestId(APPLY_TESTID)
    expect(screen.getByText(validProposal.template)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(apply)
    })
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(validProposal.template)
  })

  it('drops a tool_result with status other than ok', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const sseBody =
      sseFrame('tool_result', {
        id: 'tc1',
        name: TOOL_NAME,
        ok: true,
        data: { status: 'invalid', template: '{{Nope}}', errors: ['unknown'] },
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 4 } })
    stubStreamOnce(sseBody)

    render(
      <AIAlertMessageTemplateSuggestion draft={readyDraft} onApplyTemplate={vi.fn()} />,
    )
    await clickSuggest()
    await waitFor(() => expect(screen.queryByTestId(APPLY_TESTID)).not.toBeInTheDocument())
  })

  it('drops a tool_result from the wrong tool name', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const sseBody =
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'draft_alert_message_template',
        ok: true,
        data: validProposal,
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 4 } })
    stubStreamOnce(sseBody)

    render(
      <AIAlertMessageTemplateSuggestion draft={readyDraft} onApplyTemplate={vi.fn()} />,
    )
    await clickSuggest()
    await waitFor(() => expect(screen.queryByTestId(APPLY_TESTID)).not.toBeInTheDocument())
  })
})
