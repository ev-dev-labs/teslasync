/**
 * Phase-50 / 0003 — F2 Settings UI for AI.
 *
 * Behaviour contract for the AISettings panel.
 *
 * What this asserts (mapping to ADR-015 invariants):
 *   §I1 default-off  : a fresh load with `ai_mode='off'` shows the
 *                      OFF radio selected and hides the provider /
 *                      feature / usage sections.
 *   §I7 per-feature  : (a) feature toggles are generated from
 *                      AI_FEATURE_IDS, never hand-listed; flipping
 *                      a registry entry would surface here.
 *                      (b) the restore panel offers Confirm /
 *                      Decline with NO auto-restore.
 *                      (c) flipping mode→off clears local feature
 *                      state in the rendered DOM.
 *   §I9 key redaction: the API-key input is `type="password"`
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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

function renderPanel(initial: Partial<AppSettings> = baseSettings) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  // Seed the cache so the AISettings component sees data on first
  // render — avoids a flaky "wait for query to resolve" loop.
  qc.setQueryData(['settings'], initial)
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <AISettings />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('AISettings — §I1 default-off rendering', () => {
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
    // The server (per ADR-015 §I9) redacts ai_provider_config to
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
    // The validate hook resolves the URL through the standard
    // request() client; we just need to confirm it hits the right
    // path with the right body.
    mockedRequest.mockResolvedValueOnce({
      ok: true,
      mode: 'local',
      base_url: 'http://localhost:11434',
      pinned_ip: '127.0.0.1',
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
    // Confirm the call shape.
    const lastCall = mockedRequest.mock.calls.at(-1)
    expect(lastCall?.[0]).toBe('/settings/ai/validate-config')
    const init = lastCall?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({
      mode: 'local',
      base_url: 'http://localhost:11434',
    })
  })

  it('renders a failure banner when the server returns 422 not_local', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError('public IP rejected', 422, 'not_local'),
    )
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
  // Phase-50 fix: the F1 backend (ParseProviderConfig in
  // internal/ai/provider/config.go) expects ai_provider_config in
  // the namespaced shape:
  //
  //   { default: 'ollama', ollama: { base_url, model, api_key }, ... }
  //
  // The pre-fix F2 UI wrote a flat shape which caused every AI
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

