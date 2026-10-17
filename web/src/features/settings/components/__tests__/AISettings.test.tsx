/**
 * Settings UI contract for Helix.
 *
 * Behaviour contract for the AISettings panel.
 *
 * What this asserts:
 *   Default-off      : a fresh load with `ai_mode='off'` shows the
 *                      OFF radio selected and hides the provider /
 *                      feature / usage sections.
 *   Per-feature      : (a) feature toggles are generated from
 *                      AI_FEATURE_IDS, never hand-listed; flipping
 *                      a registry entry would surface here.
 *                      (b) the restore panel offers Confirm /
 *                      Decline with NO auto-restore.
 *                      (c) flipping mode→off clears local feature
 *                      state in the rendered DOM.
 *   Key redaction    : the API-key input is `type="password"`
 *                      with NO defaultValue when ai_mode='off'.
 *                      The validate-config call is exercised
 *                      end-to-end (mocked) against the server
 *                      route `/settings/ai/validate-config`.
 *
 * The shared `request` helper is mocked so the real hooks run end-
 * to-end without a network. i18n falls back to the defaultValue
 * supplied at every call site.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', () => ({
  // The real ApiError is imported for the 422 test below.
  request: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number
    code?: string
    constructor(message: string, status: number, code?: string) {
      super(message)
      this.name = 'ApiError'
      this.status = status
      this.code = code
    }
  },
  isApiError: (e: unknown) => e instanceof Error && e.name === 'ApiError',
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>(
    'react-i18next',
  )
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request, ApiError } from '@/api/client'
import { aiUsageKeys } from '@/api/hooks/useAiUsage'
import { ToastProvider } from '@/components/feedback/Toast'
import { AISettings } from '../AISettings'
import { AI_FEATURE_IDS } from '@/ai/features'
import type { AppSettings } from '@/api/types'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

const baseSettings: Partial<AppSettings> = {
  ai_mode: 'off',
  ai_features: {},
  ai_provider_config: undefined,
  ai_cost_cap_cents: 0,
  ai_features_archived: undefined,
}

function renderPanel(initial: Partial<AppSettings> | null = baseSettings) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  // Seed the cache so the AISettings component sees data on first
  // render — avoids a flaky "wait for query to resolve" loop.
  if (initial) qc.setQueryData(['settings'], initial)
  // Usage hooks are covered by their own tests; these settings tests
  // should not return undefined from unrelated usage queries.
  qc.setQueryData(aiUsageKeys.today(), {
    user_subject: 'settings-test', call_count: 0, input_tokens: 0,
    output_tokens: 0, cost_micro_cents: 0, error_count: 0, avg_latency_ms: 0,
  })
  qc.setQueryData(aiUsageKeys.byFeature(), { since: '2026-09-18T00:00:00Z', rows: [] })
  qc.setQueryData(aiUsageKeys.recent(50), { limit: 50, rows: [] })
  const rendered = render(
    <MemoryRouter>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <AISettings />
      </ToastProvider>
    </QueryClientProvider>
    </MemoryRouter>,
  )
  return { ...rendered, client: qc }
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('AISettings — §I1 default-off rendering', () => {
  it('locks writes during active initial loading and unlocks successful empty/zero settings', async () => {
    let resolveRead!: (value: Partial<AppSettings>) => void
    mockedRequest.mockImplementation(() => new Promise<Partial<AppSettings>>(resolve => { resolveRead = resolve }))
    renderPanel(null)
    expect(screen.getByTestId('ai-settings-save')).toBeDisabled()
    expect(screen.getByTestId('ai-mode-cloud')).toBeDisabled()
    expect(screen.getByTestId('helix-status-strip')).not.toHaveTextContent('Off (default)')
    await act(async () => { resolveRead({ ...baseSettings, ai_features_archived: {} }) })
    await waitFor(() => expect(screen.getByTestId('ai-settings-save')).toBeEnabled())
    expect(screen.getByTestId('ai-mode-off')).toBeChecked()
    expect(screen.getByTestId('helix-status-strip')).toHaveTextContent('0')
    expect(screen.queryByTestId('ai-restore-panel')).toBeNull()
  })

  it('keeps paused-without-data distinct from loading and prevents writes until recovery', async () => {
    onlineManager.setOnline(false)
    try {
      mockedRequest.mockResolvedValue(baseSettings)
      renderPanel(null)
      expect(await screen.findByText('Refresh paused')).toBeInTheDocument()
      expect(screen.getByTestId('ai-settings-save')).toBeDisabled()
      expect(screen.getByTestId('ai-mode-local')).toBeDisabled()
      expect(mockedRequest).not.toHaveBeenCalled()
      await act(async () => { onlineManager.setOnline(true) })
      await waitFor(() => expect(screen.getByTestId('ai-settings-save')).toBeEnabled())
      expect(screen.queryByText('Refresh paused')).toBeNull()
    } finally {
      onlineManager.setOnline(true)
    }
  })

  it('keeps the opt-in surface mounted on a failed first read without exposing credentials or making writes', async () => {
    mockedRequest.mockRejectedValue(new ApiError('Read unavailable', 500))
    renderPanel(null)
    expect(await screen.findByText('Server error')).toBeInTheDocument()
    expect(screen.getByTestId('ai-mode-off')).toBeChecked()
    expect(screen.queryByTestId('ai-provider-api-key')).toBeNull()
    expect(screen.queryByTestId('ai-feature-toggle-list')).toBeNull()
    expect(mockedRequest.mock.calls.some(call => ['POST', 'PUT', 'DELETE'].includes(
      (call[1] as RequestInit | undefined)?.method ?? 'GET',
    ))).toBe(false)
  })

  it('retains a configured provider form after a settings refresh failure without auto-saving', async () => {
    const { client } = renderPanel({
      ...baseSettings,
      ai_mode: 'cloud',
      ai_provider_config: {
        default: 'openai',
        openai: { base_url: 'https://api.example.test', model: 'fixture-model', api_key: 'fixture-key' },
      },
    })
    await waitFor(() => expect(screen.getByTestId('ai-provider-api-key')).toHaveValue('fixture-key'))
    fireEvent.change(screen.getByTestId('ai-provider-model'), { target: { value: 'unsaved-model' } })
    mockedRequest.mockRejectedValue(new ApiError('Refresh unavailable', 500))
    await act(async () => { await client.refetchQueries({ queryKey: ['settings'], exact: true }) })
    await waitFor(() => expect(client.getQueryState(['settings'])?.status).toBe('error'))
    expect(await screen.findByText('Data may be stale')).toBeInTheDocument()
    expect(screen.getByTestId('ai-mode-cloud')).toBeChecked()
    expect(screen.getByTestId('ai-provider-api-key')).toHaveAttribute('type', 'password')
    expect(screen.getByTestId('ai-provider-api-key')).toHaveValue('fixture-key')
    expect(screen.getByTestId('ai-settings-save')).toBeEnabled()
    expect(mockedRequest.mock.calls.some(call => ['POST', 'PUT', 'DELETE'].includes(
      (call[1] as RequestInit | undefined)?.method ?? 'GET',
    ))).toBe(false)
    mockedRequest.mockResolvedValue({
      ...baseSettings, ai_mode: 'cloud',
      ai_provider_config: {
        default: 'openai',
        openai: { base_url: 'https://api.example.test', model: 'refreshed-model', api_key: 'fixture-key' },
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByText('Data may be stale')).toBeNull())
    expect(screen.getByTestId('ai-provider-model')).toHaveValue('unsaved-model')
  })
  it('does not query usage or mount the cap bar before an off-mode user saves the opt-in', async () => {
    renderPanel({ ...baseSettings, ai_cost_cap_cents: 1000 })
    fireEvent.click(screen.getByTestId('ai-mode-cloud'))
    expect(screen.getByTestId('ai-feature-spend-panel')).toHaveTextContent('Save an enabled Helix mode')
    expect(screen.queryByTestId('ai-cost-cap-spend-bar')).toBeNull()
    await waitFor(() => {
      expect(mockedRequest.mock.calls.filter(([path]: [string]) => path.startsWith('/ai/usage/'))).toHaveLength(0)
    })
  })

  it('renders OFF radio selected and hides AI sub-sections by default', () => {
    renderPanel()
    const offRadio = screen.getByTestId('ai-mode-off') as HTMLInputElement
    expect(offRadio.checked).toBe(true)

    const local = screen.getByTestId('ai-mode-local') as HTMLInputElement
    const cloud = screen.getByTestId('ai-mode-cloud') as HTMLInputElement
    expect(local.checked).toBe(false)
    expect(cloud.checked).toBe(false)

    // The provider section, feature toggle list, and usage card are
    // collapsed in OFF mode — nothing AI-functional renders. The
    // mode picker and the "OFF banner" are still visible because
    // they are the opt-in surface itself.
    expect(screen.queryByTestId('ai-provider-section')).toBeNull()
    expect(screen.queryByTestId('ai-feature-toggle-list')).toBeNull()
    expect(screen.queryByTestId('ai-usage-card')).toBeNull()
  })

  it('marks the panel with data-ai-mode for downstream selectors', () => {
    renderPanel()
    const panel = screen.getByTestId('ai-settings-panel')
    expect(panel.getAttribute('data-ai-mode')).toBe('off')
  })
})

describe('AISettings — §I9 API key never displayed in off mode', () => {
  it('does not pre-populate the API key field when mode flips to cloud', () => {
    // The server redacts ai_provider_config to
    // null when ai_mode='off'. The component must respect that:
    // even when the user picks "cloud", the API key input starts
    // empty, type="password", and the placeholder hints "leave
    // blank to keep current".
    renderPanel({ ...baseSettings, ai_mode: 'off' })
    fireEvent.click(screen.getByTestId('ai-mode-cloud'))
    const apiKey = screen.getByTestId('ai-provider-api-key') as HTMLInputElement
    expect(apiKey.type).toBe('password')
    expect(apiKey.value).toBe('')
  })
})

describe('AISettings — saved enforcement and unsaved preview', () => {
  it('keeps a reached saved cap until a successful save updates the settings', async () => {
    // Mode-compatible provider: the save guard pins inconsistent
    // configurations as unsavable, and this test exercises the save flow.
    const saved = {
      ...baseSettings,
      ai_mode: 'cloud' as const,
      ai_cost_cap_cents: 1000,
      ai_provider_config: { default: 'openai', openai: { model: 'saved-model', api_key: 'saved-key' } },
    }
    const { client } = renderPanel(saved)
    act(() => {
      client.setQueryData(aiUsageKeys.today(), {
        user_subject: 'settings-test', call_count: 3, input_tokens: 10,
        output_tokens: 20, cost_micro_cents: 10_000_000, error_count: 0, avg_latency_ms: 10,
      })
    })
    await waitFor(() => expect(screen.getByTestId('ai-cost-cap-spend-bar')).toHaveAttribute('data-spend-level', 'critical'))
    fireEvent.change(screen.getByTestId('ai-provider-cost-cap'), { target: { value: '20' } })
    expect(screen.getByTestId('ai-provider-cost-cap')).toHaveValue(20)
    expect(screen.getByTestId('ai-settings-unsaved')).toHaveTextContent('You have unsaved settings.')
    expect(screen.getByTestId('ai-cost-cap-spend-bar')).toHaveAttribute('data-spend-level', 'critical')
    expect(screen.getByTestId('ai-feature-spend-panel')).toHaveTextContent('The daily cap applies')

    fireEvent.change(screen.getByTestId('ai-provider-cost-cap'), { target: { value: '0' } })
    expect(screen.getByTestId('ai-cost-cap-spend-bar')).toHaveAttribute('data-spend-level', 'critical')
    expect(screen.getByTestId('ai-feature-spend-panel')).not.toHaveTextContent('No daily spend cap is set')

    fireEvent.change(screen.getByTestId('ai-provider-cost-cap'), { target: { value: '20' } })
    mockedRequest.mockImplementation(async (path, init) => {
      if (path === '/settings' && init?.method === 'PUT') {
        return { ...saved, ...JSON.parse(String(init.body)) }
      }
      if (path === '/settings') return { ...saved, ai_cost_cap_cents: 2000 }
      throw new Error(`Unexpected request: ${path}`)
    })
    fireEvent.click(screen.getByTestId('ai-settings-save'))
    await waitFor(() => expect(screen.getByTestId('ai-cost-cap-spend-bar')).toHaveAttribute('data-spend-level', 'ok'))
    expect(screen.queryByTestId('ai-settings-unsaved')).toBeNull()
  })

  it.each(['local', 'off'] as const)('retains saved cloud enforcement when the unsaved mode is %s', (draftMode) => {
    renderPanel({ ...baseSettings, ai_mode: 'cloud', ai_cost_cap_cents: 1000 })
    fireEvent.click(screen.getByTestId(`ai-mode-${draftMode}`))
    expect(screen.getByTestId('ai-settings-panel')).toHaveAttribute('data-ai-mode', draftMode)
    expect(screen.getByTestId('helix-status-strip')).toHaveTextContent('Cloud')
    expect(screen.getByTestId('ai-settings-unsaved')).toBeInTheDocument()
    expect(screen.getByTestId('ai-cost-cap-spend-bar')).toBeInTheDocument()
    expect(screen.getByTestId('ai-feature-spend-panel')).toHaveTextContent('The daily cap applies')
    expect(screen.queryByText('Helix is off. Your app works fully without it. Enable a mode above to opt in.')).toBeNull()
  })

  it('does not present an unsaved cloud cap as active for saved local mode', () => {
    renderPanel({ ...baseSettings, ai_mode: 'local', ai_cost_cap_cents: 0 })
    fireEvent.click(screen.getByTestId('ai-mode-cloud'))
    fireEvent.change(screen.getByTestId('ai-provider-cost-cap'), { target: { value: '10' } })
    expect(screen.getByTestId('helix-status-strip')).toHaveTextContent('Local-only')
    expect(screen.getByTestId('ai-settings-unsaved')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-cost-cap-spend-bar')).toBeNull()
    expect(screen.getByTestId('ai-feature-spend-panel')).toHaveTextContent('No daily spend cap is set')
  })

  it('preserves populated audited feature spend while the cap preview changes', async () => {
    const { client } = renderPanel({ ...baseSettings, ai_mode: 'cloud', ai_cost_cap_cents: 1000 })
    act(() => {
      client.setQueryData(aiUsageKeys.byFeature(), {
        since: '2026-09-18T00:00:00Z',
        rows: [{
          feature_id: 'chatbot-llm', call_count: 3, input_tokens: 100,
          output_tokens: 200, cost_micro_cents: 2_000_000,
          last_call_at: '2026-09-18T12:00:00Z',
        }],
      })
    })
    const spendPanel = screen.getByTestId('ai-feature-spend-panel')
    await waitFor(() => expect(within(spendPanel).getAllByRole('listitem')).toHaveLength(1))
    const populatedRow = within(spendPanel).getByRole('listitem').textContent
    fireEvent.change(screen.getByTestId('ai-provider-cost-cap'), { target: { value: '0' } })
    expect(within(spendPanel).getByRole('listitem').textContent).toBe(populatedRow)
    expect(screen.getByTestId('ai-feature-spend-panel')).toHaveTextContent('The daily cap applies')
    expect(screen.queryByText('No audited Helix calls in the last 7 days.')).toBeNull()
  })
})

describe('AISettings — §I7 per-feature toggles generated from registry', () => {
  it('renders one toggle row per AI_FEATURE_IDS entry', () => {
    renderPanel({ ...baseSettings, ai_mode: 'local' })
    for (const id of AI_FEATURE_IDS) {
      expect(screen.getByTestId(`ai-feature-row-${id}`)).toBeTruthy()
      expect(screen.getByTestId(`ai-feature-toggle-${id}`)).toBeTruthy()
    }
  })

  it('clears feature toggles in DOM when user flips mode to OFF', () => {
    renderPanel({
      ...baseSettings,
      ai_mode: 'local',
      ai_features: { 'chatbot-llm': true } as Record<string, boolean>,
    })
    // Sanity: provider section is visible while in local mode.
    expect(screen.getByTestId('ai-provider-section')).toBeTruthy()
    // Flip to off — the feature toggle list collapses and the
    // OFF banner appears.
    fireEvent.click(screen.getByTestId('ai-mode-off'))
    expect(screen.queryByTestId('ai-feature-toggle-list')).toBeNull()
    expect(screen.queryByTestId('ai-provider-section')).toBeNull()
  })
})

describe('AISettings — §I7 archive restore is explicit, never silent', () => {
  it('keeps confirmation pending, retains the archive and draft on failure, and dismisses only after retry succeeds', async () => {
    const initial = {
      ...baseSettings,
      ai_mode: 'local' as const,
      ai_features_archived: { 'chatbot-llm': true },
    }
    let rejectSave!: (error: Error) => void
    let resolveSave!: (value: Partial<AppSettings>) => void
    let attempts = 0
    mockedRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/settings' && init?.method === 'PUT') {
        attempts++
        return new Promise<Partial<AppSettings>>((resolve, reject) => {
          resolveSave = resolve
          rejectSave = reject
        })
      }
      if (path === '/settings') return Promise.resolve(initial)
      throw new Error(`Unexpected request: ${path}`)
    })
    const { client } = renderPanel(initial)
    fireEvent.change(screen.getByTestId('ai-provider-model'), { target: { value: 'draft-model' } })
    fireEvent.click(screen.getByTestId('ai-restore-confirm'))
    await waitFor(() => expect(attempts).toBe(1))
    expect(screen.getByTestId('ai-restore-panel')).toBeInTheDocument()
    expect(screen.getByTestId('ai-restore-confirm')).toBeDisabled()
    expect(screen.getByTestId('ai-restore-decline')).toBeDisabled()
    expect(screen.getByTestId('ai-settings-save')).toBeDisabled()
    expect(screen.getByTestId('ai-mode-off')).toBeDisabled()
    expect(screen.getByTestId('ai-restore-pending')).toHaveTextContent('Saving')
    fireEvent.click(screen.getByTestId('ai-restore-confirm'))
    expect(attempts).toBe(1)

    await act(async () => { rejectSave(new ApiError('Save unavailable', 500)) })
    await waitFor(() => expect(screen.getByTestId('ai-restore-confirm')).toBeEnabled())
    expect(screen.getByTestId('ai-restore-panel')).toBeInTheDocument()
    expect(screen.getByTestId('ai-provider-model')).toHaveValue('draft-model')
    expect(within(screen.getByTestId('ai-feature-row-chatbot-llm')).getByRole('switch')).toBeChecked()
    expect(client.getQueryData(['settings'])).toMatchObject({ ai_features_archived: { 'chatbot-llm': true } })
    expect(screen.getByText('Server error')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('ai-restore-confirm'))
    await waitFor(() => expect(attempts).toBe(2))
    const saved = { ...initial, ai_features: { 'chatbot-llm': true }, ai_features_archived: {} }
    mockedRequest.mockResolvedValue(saved)
    await act(async () => { resolveSave(saved) })
    await waitFor(() => expect(screen.queryByTestId('ai-restore-panel')).toBeNull())
    expect(screen.getByTestId('ai-provider-model')).toHaveValue('draft-model')
    expect(screen.queryByText('Server error')).toBeNull()
    expect(screen.getByTestId('ai-settings-save')).toBeEnabled()
  })

  it('shows the restore panel when archive is present and mode is non-off', () => {
    renderPanel({
      ...baseSettings,
      ai_mode: 'local',
      ai_features_archived: { 'chatbot-llm': true } as Record<string, boolean>,
    })
    const panel = screen.getByTestId('ai-restore-panel')
    expect(panel).toBeTruthy()
    // Both Confirm AND Decline are rendered — the user must
    // explicitly pick. There is no auto-restore.
    expect(screen.getByTestId('ai-restore-confirm')).toBeTruthy()
    expect(screen.getByTestId('ai-restore-decline')).toBeTruthy()
  })

  it('hides the restore panel once the user declines', () => {
    renderPanel({
      ...baseSettings,
      ai_mode: 'local',
      ai_features_archived: { 'chatbot-llm': true } as Record<string, boolean>,
    })
    fireEvent.click(screen.getByTestId('ai-restore-decline'))
    expect(screen.queryByTestId('ai-restore-panel')).toBeNull()
  })

  it('does not render the restore panel when archive is empty', () => {
    renderPanel({
      ...baseSettings,
      ai_mode: 'local',
      ai_features_archived: {} as Record<string, boolean>,
    })
    expect(screen.queryByTestId('ai-restore-panel')).toBeNull()
  })

  it('does not render the restore panel when mode is OFF', () => {
    renderPanel({
      ...baseSettings,
      ai_mode: 'off',
      ai_features_archived: { 'chatbot-llm': true } as Record<string, boolean>,
    })
    expect(screen.queryByTestId('ai-restore-panel')).toBeNull()
  })
})

describe('AISettings — validate endpoint exercised end-to-end', () => {
  it('POSTs to /settings/ai/validate-config and shows the OK banner on success', async () => {
    // Route by URL so the AIUsageCard's /ai/usage/today probe doesn't
    // steal the queued validate response. mockResolvedValueOnce is
    // fragile when sibling components fire their own first-load
    // requests on the same shared mock.
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/ai/usage/today') {
        return {
          call_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          cost_micro_cents: 0,
          error_count: 0,
          avg_latency_ms: 0,
        }
      }
      if (path === '/settings/ai/validate-config') {
        return {
          ok: true,
          mode: 'local',
          base_url: 'http://localhost:11434',
          pinned_ip: '127.0.0.1',
        }
      }
      return undefined
    })
    renderPanel({ ...baseSettings, ai_mode: 'local' })
    const baseUrl = screen.getByTestId('ai-provider-base-url') as HTMLInputElement
    fireEvent.change(baseUrl, { target: { value: 'http://localhost:11434' } })
    fireEvent.click(screen.getByTestId('ai-provider-validate'))
    await waitFor(() => {
      expect(screen.getByTestId('ai-provider-validate-banner').getAttribute(
        'data-validate-kind',
      )).toBe('ok')
    })
    // Confirm the validate call shape — there may be earlier /ai/usage
    // calls so we grep for the validate one explicitly.
    const validateCall = mockedRequest.mock.calls.find(
      (c) => c[0] === '/settings/ai/validate-config',
    )
    expect(validateCall).toBeDefined()
    const init = validateCall?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({
      mode: 'local',
      base_url: 'http://localhost:11434',
    })
  })

  it('renders a failure banner when the server returns 422 not_local', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/ai/usage/today') {
        return {
          call_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          cost_micro_cents: 0,
          error_count: 0,
          avg_latency_ms: 0,
        }
      }
      if (path === '/settings/ai/validate-config') {
        throw new ApiError('public IP rejected', 422, 'not_local')
      }
      return undefined
    })
    renderPanel({ ...baseSettings, ai_mode: 'local' })
    const baseUrl = screen.getByTestId('ai-provider-base-url') as HTMLInputElement
    fireEvent.change(baseUrl, { target: { value: 'http://1.2.3.4:11434' } })
    fireEvent.click(screen.getByTestId('ai-provider-validate'))
    await waitFor(() => {
      const banner = screen.getByTestId('ai-provider-validate-banner')
      expect(banner.getAttribute('data-validate-kind')).toBe('fail')
      expect(banner.textContent).toMatch(/public IP/)
    })
  })
})

describe('AISettings — F1↔F2 provider config schema (namespaced shape)', () => {
  it('selects a saved mode-compatible provider for review and preserves edits to both providers', async () => {
    let saved: Partial<AppSettings> | undefined
    mockedRequest.mockImplementation(async (path, init) => {
      if (path === '/settings' && init?.method === 'PUT') {
        saved = JSON.parse(String(init.body))
        return saved
      }
      if (path === '/settings') return saved
      throw new Error(`Unexpected request: ${path}`)
    })
    const openai = { model: 'cloud-model', api_key: 'saved-key', extra: 'preserved' }
    const ollama = { base_url: 'http://localhost:11434', model: 'local-model' }
    renderPanel({
      ...baseSettings,
      ai_mode: 'local',
      ai_provider_config: { default: 'ollama', ollama, openai },
    })
    fireEvent.change(screen.getByTestId('ai-provider-model'), { target: { value: 'edited-local' } })
    fireEvent.click(screen.getByTestId('ai-mode-cloud'))
    expect(screen.getByTestId('ai-provider-select')).toHaveValue('openai')
    expect(screen.getByTestId('ai-provider-model')).toHaveValue('cloud-model')
    expect(screen.getByTestId('ai-provider-api-key')).toHaveValue('')
    fireEvent.change(screen.getByTestId('ai-provider-model'), { target: { value: 'edited-cloud' } })
    fireEvent.change(screen.getByTestId('ai-provider-api-key'), { target: { value: 'typed-key' } })
    fireEvent.click(screen.getByTestId('ai-mode-local'))
    expect(screen.getByTestId('ai-provider-select')).toHaveValue('ollama')
    expect(screen.getByTestId('ai-provider-model')).toHaveValue('edited-local')
    fireEvent.click(screen.getByTestId('ai-mode-cloud'))
    expect(screen.getByTestId('ai-provider-model')).toHaveValue('edited-cloud')
    expect(screen.getByTestId('ai-provider-api-key')).toHaveValue('typed-key')
    expect(mockedRequest).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('ai-settings-save'))
    await waitFor(() => expect(saved?.ai_provider_config).toEqual({
      default: 'openai',
      ollama: { ...ollama, model: 'edited-local' },
      openai: { ...openai, base_url: '', model: 'edited-cloud', api_key: 'typed-key' },
    }))
  })

  it('selects a compatible default on opt-in without saving automatically', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('ai-mode-cloud'))
    expect(screen.getByTestId('ai-provider-select')).toHaveValue('openai')
    expect(screen.getByTestId('ai-provider-model')).toHaveValue('')
    expect(screen.getByTestId('ai-provider-api-key')).toHaveValue('')
    expect(mockedRequest).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('ai-mode-local'))
    expect(screen.getByTestId('ai-provider-select')).toHaveValue('ollama')
  })

  it('restores archived features with the reviewed compatible provider when changing mode', async () => {
    let saved: Partial<AppSettings> | undefined
    mockedRequest.mockImplementation(async (path, init) => {
      if (path === '/settings' && init?.method === 'PUT') {
        saved = JSON.parse(String(init.body))
        return saved
      }
      if (path === '/settings') return saved
      throw new Error(`Unexpected request: ${path}`)
    })
    const ollama = { model: 'local-model', base_url: 'http://localhost:11434' }
    const google = { model: 'cloud-model', api_key: 'saved-key' }
    renderPanel({
      ...baseSettings,
      ai_mode: 'local',
      ai_features_archived: { 'chatbot-llm': true },
      ai_provider_config: { default: 'ollama', ollama, google },
    })
    fireEvent.click(screen.getByTestId('ai-mode-cloud'))
    expect(screen.getByTestId('ai-provider-select')).toHaveValue('google')
    fireEvent.click(screen.getByTestId('ai-restore-confirm'))
    await waitFor(() => expect(saved).toMatchObject({
      ai_mode: 'cloud',
      ai_features: { 'chatbot-llm': true },
      ai_provider_config: { default: 'google', ollama, google },
    }))
  })

  it('requires a compatible selection before saving an inconsistent loaded configuration', () => {
    renderPanel({
      ...baseSettings,
      ai_mode: 'local',
      ai_provider_config: { default: 'openai', openai: { model: 'cloud-model' } },
      ai_features_archived: { 'chatbot-llm': true },
    })
    expect(screen.getByTestId('ai-settings-save')).toBeDisabled()
    expect(screen.getByTestId('ai-restore-confirm')).toBeDisabled()
    expect(screen.getByTestId('ai-provider-incompatible')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ai-settings-save'))
    expect(mockedRequest).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('ai-provider-select'), { target: { value: 'ollama' } })
    expect(screen.getByTestId('ai-settings-save')).toBeEnabled()
    expect(screen.getByTestId('ai-restore-confirm')).toBeEnabled()
    fireEvent.click(screen.getByTestId('ai-mode-off'))
    expect(screen.getByTestId('ai-settings-save')).toBeEnabled()
  })

  it.each([
    { oldFlavor: 'openai', effectiveModel: 'old-deployment' },
    { oldFlavor: 'foundry', effectiveModel: 'visible-model' },
  ])('migrates $oldFlavor identity, then validates and saves only Foundry settings', async ({ oldFlavor, effectiveModel }) => {
    let savedSettings: unknown
    mockedRequest.mockImplementation(async (path, init) => {
      if (path === '/settings/ai/validate-config') {
        return { ok: true, mode: 'cloud', probed_model: 'edited-deployment' }
      }
      if (path === '/settings' && init?.method === 'PUT') {
        savedSettings = JSON.parse(String(init.body))
        return savedSettings
      }
      if (path === '/settings') return savedSettings ?? baseSettings
      throw new Error(`Unexpected request: ${path}`)
    })
    renderPanel({
      ...baseSettings,
      ai_mode: 'cloud',
      ai_provider_config: {
        default: 'azure',
        azure: {
          base_url: 'https://example.openai.azure.com/openai/v1',
          model: 'visible-model',
          deployment: 'old-deployment',
          flavor: oldFlavor,
          api_version: '2024-10-21',
          embedding_deployment: 'embedding-deployment',
        },
      },
    })
    expect(screen.getByTestId('ai-provider-model')).toHaveValue(effectiveModel)
    expect(screen.getByTestId('ai-provider-azure-embedding-model')).toHaveValue('embedding-deployment')
    fireEvent.change(screen.getByTestId('ai-provider-model'), {
      target: { value: 'edited-deployment' },
    })
    fireEvent.change(screen.getByTestId('ai-provider-azure-protocol'), { target: { value: 'responses' } })
    fireEvent.click(screen.getByTestId('ai-provider-validate-cloud'))
    await waitFor(() => {
      expect(screen.getByTestId('ai-provider-validate-banner')).toHaveAttribute('data-validate-kind', 'ok')
    })
    const probe = mockedRequest.mock.calls.find((call) => call[0] === '/settings/ai/validate-config')
    expect(JSON.parse(String(probe![1].body))).toMatchObject({
      model: 'edited-deployment', api_protocol: 'responses',
    })
    fireEvent.click(screen.getByTestId('ai-settings-save'))
    await waitFor(() => {
      const save = mockedRequest.mock.calls.find((call) => call[0] === '/settings' && call[1]?.method === 'PUT')
      expect(save).toBeDefined()
      const saved = JSON.parse(String(save![1].body)).ai_provider_config.azure
      expect(saved).toMatchObject({
        model: 'edited-deployment', api_protocol: 'responses', embedding_model: 'embedding-deployment',
      })
      for (const key of ['flavor', 'api_version', 'deployment', 'embedding_deployment']) {
        expect(saved).not.toHaveProperty(key)
      }
    })
  })

  // The backend parser (ParseProviderConfig in
  // internal/ai/provider/config.go) expects ai_provider_config in
  // the namespaced shape:
  //
  //   { default: 'ollama', ollama: { base_url, model, api_key }, ... }
  //
  // A flat shape causes every AI
  // call to fall back to DefaultLocalBaseURL = http://localhost:11434
  // (unreachable from inside the API container). These tests pin
  // the canonical contract end-to-end.

  it('reads the namespaced shape: form fields populate from cfg[default]', () => {
    renderPanel({
      ...baseSettings,
      ai_mode: 'local',
      ai_provider_config: {
        default: 'ollama',
        ollama: {
          base_url: 'http://192.168.1.10:11434',
          model: 'qwen2.5:7b',
        },
      } as Record<string, unknown>,
    })
    const baseUrl = screen.getByTestId('ai-provider-base-url') as HTMLInputElement
    const model = screen.getByTestId('ai-provider-model') as HTMLInputElement
    expect(baseUrl.value).toBe('http://192.168.1.10:11434')
    expect(model.value).toBe('qwen2.5:7b')
  })

  it('reads the legacy flat shape as a backward-compat fallback', () => {
    // Defensive: if a row somehow escapes the 000208 migration
    // (e.g. an unmigrated export bundle re-imported), the UI must
    // still render so the user can re-save and renest.
    renderPanel({
      ...baseSettings,
      ai_mode: 'local',
      ai_provider_config: {
        provider: 'ollama',
        base_url: 'http://legacy.example:11434',
        model: 'legacy-model',
      } as Record<string, unknown>,
    })
    const baseUrl = screen.getByTestId('ai-provider-base-url') as HTMLInputElement
    const model = screen.getByTestId('ai-provider-model') as HTMLInputElement
    expect(baseUrl.value).toBe('http://legacy.example:11434')
    expect(model.value).toBe('legacy-model')
  })

  it('writes the namespaced shape on Save and preserves other providers', async () => {
    mockedRequest.mockImplementation(async (_path, init) => {
      // The PUT /settings call returns the merged document; the
      // happy-path response just echoes the body.
      const body = JSON.parse(String((init as RequestInit).body))
      return body
    })
    renderPanel({
      ...baseSettings,
      ai_mode: 'local',
      ai_provider_config: {
        default: 'openai',
        // Pre-existing OpenAI config from a prior session — must
        // survive a save that targets Ollama.
        openai: {
          base_url: 'https://api.openai.com',
          model: 'gpt-4o-mini',
          api_key: 'sk-preserved',
        },
      } as Record<string, unknown>,
    })

    // User switches to Ollama and enters new fields.
    const providerSelect = screen.getByTestId(
      'ai-provider-select',
    ) as HTMLSelectElement
    fireEvent.change(providerSelect, { target: { value: 'ollama' } })
    fireEvent.change(screen.getByTestId('ai-provider-base-url'), {
      target: { value: 'http://192.168.68.218:11434' },
    })
    fireEvent.change(screen.getByTestId('ai-provider-model'), {
      target: { value: 'qwen2.5:7b' },
    })

    fireEvent.click(screen.getByTestId('ai-settings-save'))

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalled()
    })

    // Find the /settings PUT (the validate call is a different path).
    const putCall = mockedRequest.mock.calls.find(
      (c) => c[0] === '/settings' && (c[1] as RequestInit | undefined)?.method === 'PUT',
    )
    expect(putCall).toBeTruthy()
    const sentBody = JSON.parse(String((putCall![1] as RequestInit).body))

    // 1. Namespaced shape — no top-level provider/base_url/model.
    expect(sentBody.ai_provider_config.provider).toBeUndefined()
    expect(sentBody.ai_provider_config.base_url).toBeUndefined()
    expect(sentBody.ai_provider_config.model).toBeUndefined()

    // 2. `default` names the selected provider.
    expect(sentBody.ai_provider_config.default).toBe('ollama')

    // 3. The selected provider's sub-object carries the form fields.
    expect(sentBody.ai_provider_config.ollama).toEqual({
      base_url: 'http://192.168.68.218:11434',
      model: 'qwen2.5:7b',
    })

    // 4. Other providers' configs survive the save (multi-provider
    //    preservation). The user can swap back to OpenAI without
    //    re-entering the key.
    expect(sentBody.ai_provider_config.openai).toEqual({
      base_url: 'https://api.openai.com',
      model: 'gpt-4o-mini',
      api_key: 'sk-preserved',
    })
  })

  it('strips legacy top-level keys when re-saving a legacy snapshot', async () => {
    mockedRequest.mockImplementation(async (_path, init) => {
      const body = JSON.parse(String((init as RequestInit).body))
      return body
    })
    renderPanel({
      ...baseSettings,
      ai_mode: 'local',
      ai_provider_config: {
        // Pre-fix legacy snapshot still in the cache.
        provider: 'ollama',
        base_url: 'http://legacy:11434',
        model: 'legacy-model',
      } as Record<string, unknown>,
    })

    fireEvent.click(screen.getByTestId('ai-settings-save'))

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalled()
    })

    const putCall = mockedRequest.mock.calls.find(
      (c) => c[0] === '/settings' && (c[1] as RequestInit | undefined)?.method === 'PUT',
    )
    const sent = JSON.parse(String((putCall![1] as RequestInit).body))
    expect(sent.ai_provider_config.provider).toBeUndefined()
    expect(sent.ai_provider_config.base_url).toBeUndefined()
    expect(sent.ai_provider_config.model).toBeUndefined()
    expect(sent.ai_provider_config.default).toBe('ollama')
    expect(sent.ai_provider_config.ollama).toBeDefined()
    expect(
      (sent.ai_provider_config.ollama as Record<string, unknown>).base_url,
    ).toBe('http://legacy:11434')
  })
})
