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
