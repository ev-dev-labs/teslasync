import { appSettingsPayload } from '@/test/fixtures/appSettings'
import { makeReadableStream, sseFrame } from '@/test/fixtures/aiPayloads'
// Co-located unit + wiring test for AIAlertMessageTemplateSuggestion.
//
// Covers:
//   1. ADR-015 render gate (off / toggle-off / missing map / unresolved / on)
//   2. Surface structure + computed-disabled Suggest
//   3. SSE POST with selected dimensions
//   4. validate_alert_message_template capture + Apply
//   5. Reject malformed tool_result envelopes
//   6. Draft/save-state changes retire proposals and reject stale completion
//
// Network is stubbed at fetch. Interactions use fireEvent.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'





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

function enabled(overrides: Partial<AppSettings> = {}) {
  return appSettingsPayload({
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

function controlledStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  return {
    response,
    send(event: string, data: unknown) {
      controller.enqueue(new TextEncoder().encode(sseFrame(event, data)))
    },
    close() {
      controller.close()
    },
  }
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
      appSettingsPayload({ ai_mode: 'off', ai_features: { [FEATURE_ID]: true } }),
    )
    const { container } = render(
      <AIAlertMessageTemplateSuggestion draft={readyDraft} onApplyTemplate={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is off', () => {
    mockUseSettings.mockReturnValue(
      appSettingsPayload({ ai_mode: 'cloud', ai_features: { [FEATURE_ID]: false } }),
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
})

    describe('AIAlertMessageTemplateSuggestion — draft revision ownership', () => {
      const proposalEvent = {
        id: 'tc1',
        name: TOOL_NAME,
        ok: true,
        data: validProposal,
      }
      const doneEvent = { finish_reason: 'stop', usage: { in: 40, out: 12 } }

      it.each([
        { severity: 'warning' },
        { name: 'Changed alert' },
        { value_num: 42 },
        { value_text: 'changed' },
        { value_bool: false },
        { value_min: 1 },
        { value_max: 99 },
        { metric_window: '1h' },
        { metric_op: '>' },
        { metric_threshold: 10 },
        { signal_name: 'Speed' },
        { op: '>' },
        { kind: 'computed_metric', metric_id: 'efficiency' },
      ])('aborts pending work after draft change %j and ignores stale completion', async (change) => {
        mockUseSettings.mockReturnValue(enabled())
        const oldStream = controlledStream()
        const newStream = controlledStream()
        const fetchMock = vi.fn<typeof fetch>()
          .mockResolvedValueOnce(oldStream.response)
          .mockResolvedValueOnce(newStream.response)
        globalThis.fetch = fetchMock
        const onApply = vi.fn()
        const { rerender } = render(
          <AIAlertMessageTemplateSuggestion draft={readyDraft} onApplyTemplate={onApply} />,
        )
        await clickSuggest()
        const signal = fetchMock.mock.calls[0][1]?.signal
        rerender(
          <AIAlertMessageTemplateSuggestion
            draft={{ ...readyDraft, ...change }}
            onApplyTemplate={onApply}
          />,
        )
        expect(signal?.aborted).toBe(true)
        await clickSuggest()
        await act(async () => {
          oldStream.send('tool_result', proposalEvent)
          oldStream.send('done', doneEvent)
          oldStream.close()
        })
        expect(screen.queryByTestId(APPLY_TESTID)).not.toBeInTheDocument()
        expect(onApply).not.toHaveBeenCalled()
        await act(async () => {
          newStream.send('tool_result', proposalEvent)
          newStream.send('done', doneEvent)
          newStream.close()
        })
        const apply = await screen.findByTestId(APPLY_TESTID)
        expect(apply).toBeEnabled()
        expect(onApply).not.toHaveBeenCalled()
        fireEvent.click(apply)
        expect(onApply).toHaveBeenCalledExactlyOnceWith(validProposal.template)
      })

      it.each(['draft', 'readiness', 'disabled'] as const)(
        'retires completed proposals when %s changes, including change-back',
        async (change) => {
          mockUseSettings.mockReturnValue(enabled())
          stubStreamOnce(sseFrame('tool_result', proposalEvent) + sseFrame('done', doneEvent))
          const onApply = vi.fn()
          const { rerender } = render(
            <AIAlertMessageTemplateSuggestion draft={readyDraft} onApplyTemplate={onApply} />,
          )
          await clickSuggest()
          const oldApply = await screen.findByTestId(APPLY_TESTID)
          rerender(
            <AIAlertMessageTemplateSuggestion
              draft={change === 'draft' ? { ...readyDraft, severity: 'critical' }
                : change === 'readiness' ? { ...readyDraft, op: '' } : readyDraft}
              disabled={change === 'disabled'}
              onApplyTemplate={onApply}
            />,
          )
          expect(screen.queryByTestId(APPLY_TESTID)).not.toBeInTheDocument()
          fireEvent.click(oldApply)
          rerender(
            <AIAlertMessageTemplateSuggestion draft={readyDraft} onApplyTemplate={onApply} />,
          )
          expect(screen.queryByTestId(APPLY_TESTID)).not.toBeInTheDocument()
          expect(onApply).not.toHaveBeenCalled()
        },
      )

      it.each(['disabled', 'readiness'] as const)(
        'ignores pending completion after losing %s',
        async (change) => {
          mockUseSettings.mockReturnValue(enabled())
          let resolveResponse!: (response: Response) => void
          const fetchMock = vi.fn<typeof fetch>(() => new Promise((resolve) => {
            resolveResponse = resolve
          }))
          globalThis.fetch = fetchMock
          const onApply = vi.fn()
          const { rerender } = render(
            <AIAlertMessageTemplateSuggestion draft={readyDraft} onApplyTemplate={onApply} />,
          )
          await clickSuggest()
          rerender(
            <AIAlertMessageTemplateSuggestion
              draft={change === 'readiness' ? { ...readyDraft, signal_name: '' } : readyDraft}
              disabled={change === 'disabled'}
              onApplyTemplate={onApply}
            />,
          )
          expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
          await act(async () => {
            resolveResponse(new Response(makeReadableStream([
              sseFrame('tool_result', proposalEvent) + sseFrame('done', doneEvent),
            ]), { status: 200 }))
          })
          expect(screen.queryByTestId(APPLY_TESTID)).not.toBeInTheDocument()
          expect(screen.getByTestId(SUGGEST_TESTID)).toBeDisabled()
          expect(onApply).not.toHaveBeenCalled()
        },
      )

      it.each(['rejected', 'invalid', 'error', 'disconnect'] as const)(
        'does not apply a captured proposal after %s',
        async (outcome) => {
          mockUseSettings.mockReturnValue(enabled())
          const pending = controlledStream()
          globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(pending.response)
          const onApply = vi.fn()
          render(
            <AIAlertMessageTemplateSuggestion draft={readyDraft} onApplyTemplate={onApply} />,
          )
          await clickSuggest()
          await act(async () => pending.send('tool_result', proposalEvent))
          const apply = await screen.findByTestId(APPLY_TESTID)
          expect(apply).toBeDisabled()
          fireEvent.click(apply)
          expect(onApply).not.toHaveBeenCalled()
          await act(async () => {
            if (outcome === 'rejected' || outcome === 'invalid') {
              pending.send('tool_result', {
                ...proposalEvent,
                ok: outcome !== 'rejected',
                data: outcome === 'invalid' ? { ...validProposal, status: 'invalid' } : validProposal,
              })
              pending.send('done', doneEvent)
            } else if (outcome === 'error') {
              pending.send('error', { message: 'Provider rejected the request' })
            }
            pending.close()
          })
          const remainingApply = screen.queryByTestId(APPLY_TESTID)
          if (remainingApply) {
            expect(remainingApply).toBeDisabled()
            fireEvent.click(remainingApply)
          }
          expect(onApply).not.toHaveBeenCalled()
        },
      )
    })

describe('AIAlertMessageTemplateSuggestion — proposal rejection', () => {
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
