/**
 * Behaviour contract for AIProviderSection.
 *
 * This section is a controlled form: the parent owns the draft and passes
 * it back through `onChange`. The tests drive it through a small stateful
 * harness so typing actually round-trips (value → onChange → re-render),
 * mirroring how AISettings composes it in production.
 *
 * What this asserts:
 *   Local mode      : provider options, base-URL editing, the Validate
 *                     enable/disable guard, and the four validate outcomes
 *                     — OK, pinned-IP OK, 422 rejection, and (the
 *                     regression this file is guarding) a non-422 network
 *                     failure that used to be swallowed as an unhandled
 *                     promise with no banner.
 *   Cloud mode      : masked API key, dollars↔cents cost-cap conversion,
 *                     api_key omitted-when-blank payload rule, the
 *                     probed-model success message, and the Azure surface
 *                     (flavor switch hiding deployment inputs).
 *   Accessibility   : the panel's aria-label, the banner's role="status",
 *                     and the in-flight "Validating…" loading state.
 *
 * The shared `request` client is mocked so the real useValidateAiProvider
 * hook runs end-to-end without a network. i18n falls back to the
 * defaultValue supplied at every call site and interpolates {{var}}.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/api/client', () => ({
  request: vi.fn(),
  // A minimal stand-in for the real ApiError so the hook's `isApiError`
  // + `status === 422` narrowing exercises the same code paths.
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
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback =
          typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        let result = fallback ?? key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
          }
        }
        return result
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request, ApiError } from '@/api/client'
import { AIProviderSection, type AIProviderDraft } from './AIProviderSection'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

const VALIDATE_PATH = '/settings/ai/validate-config'

function makeDraft(overrides: Partial<AIProviderDraft> = {}): AIProviderDraft {
  return {
    provider: 'ollama',
    base_url: '',
    model: '',
    api_key: '',
    cost_cap_cents: 0,
    api_version: '',
    flavor: '',
    deployment: '',
    embedding_model: '',
    embedding_deployment: '',
    ...overrides,
  }
}

/**
 * Stateful wrapper so onChange actually updates the value the section
 * renders with — this is what the real parent (AISettings) does. The
 * optional spy lets a test assert the exact draft handed up on change.
 */
function Harness({
  initial,
  isCloud,
  onChangeSpy,
}: {
  initial: AIProviderDraft
  isCloud: boolean
  onChangeSpy?: (next: AIProviderDraft) => void
}) {
  const [draft, setDraft] = useState<AIProviderDraft>(initial)
  return (
    <AIProviderSection
      value={draft}
      isCloud={isCloud}
      onChange={(next) => {
        onChangeSpy?.(next)
        setDraft(next)
      }}
    />
  )
}

function renderSection(
  opts: {
    initial?: AIProviderDraft
    isCloud?: boolean
    onChangeSpy?: (next: AIProviderDraft) => void
  } = {},
) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <Harness
        initial={opts.initial ?? makeDraft()}
        isCloud={opts.isCloud ?? false}
        onChangeSpy={opts.onChangeSpy}
      />
    </QueryClientProvider>,
  )
}

function validateBody(): Record<string, unknown> {
  const call = mockedRequest.mock.calls.find(
    (c: unknown[]) => c[0] === VALIDATE_PATH,
  )
  expect(call).toBeDefined()
  const init = call![1] as RequestInit
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('AIProviderSection — local mode structure', () => {
  it('renders the local provider options and hides all cloud-only fields', () => {
    renderSection({ isCloud: false })

    const select = screen.getByTestId('ai-provider-select') as HTMLSelectElement
    expect(select.value).toBe('ollama')
    expect(screen.getByRole('option', { name: 'Ollama' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'LM Studio' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'llama.cpp' })).toBeInTheDocument()

    expect(screen.getByTestId('ai-provider-base-url')).toBeInTheDocument()
    expect(screen.getByTestId('ai-provider-validate')).toBeInTheDocument()

    // Cloud-only controls must not leak into local mode.
    expect(screen.queryByTestId('ai-provider-api-key')).toBeNull()
    expect(screen.queryByTestId('ai-provider-cost-cap')).toBeNull()
    expect(screen.queryByTestId('ai-provider-azure-flavor')).toBeNull()
    expect(screen.queryByTestId('ai-provider-validate-cloud')).toBeNull()
  })

  it('propagates base-URL edits and provider switches through onChange', () => {
    const onChangeSpy = vi.fn()
    renderSection({ isCloud: false, onChangeSpy })

    fireEvent.change(screen.getByTestId('ai-provider-base-url'), {
      target: { value: 'http://localhost:11434' },
    })
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ base_url: 'http://localhost:11434' }),
    )

    fireEvent.change(screen.getByTestId('ai-provider-select'), {
      target: { value: 'lmstudio' },
    })
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'lmstudio' }),
    )
  })

  it('disables Validate while the base URL is blank and enables it once filled', () => {
    renderSection({ isCloud: false, initial: makeDraft({ base_url: '   ' }) })
    // A whitespace-only URL still counts as empty (trim().length === 0).
    expect(screen.getByTestId('ai-provider-validate')).toBeDisabled()

    fireEvent.change(screen.getByTestId('ai-provider-base-url'), {
      target: { value: 'http://localhost:11434' },
    })
    expect(screen.getByTestId('ai-provider-validate')).not.toBeDisabled()
  })

  it('renders the local-only explainer and an accessible panel label', () => {
    renderSection({ isCloud: false })
    expect(
      screen.getByText(/Local-only mode never sends data outside your network/),
    ).toBeInTheDocument()
    expect(screen.getByTestId('ai-provider-section')).toHaveAttribute(
      'aria-label',
      'Provider configuration',
    )
  })
})

describe('AIProviderSection — local validate outcomes', () => {
  it('POSTs mode=local + base_url and shows an OK banner on success', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === VALIDATE_PATH) {
        return { ok: true, mode: 'local', base_url: 'http://localhost:11434' }
      }
      return undefined
    })
    renderSection({
      isCloud: false,
      initial: makeDraft({ base_url: 'http://localhost:11434' }),
    })

    fireEvent.click(screen.getByTestId('ai-provider-validate'))

    await waitFor(() => {
      expect(
        screen
          .getByTestId('ai-provider-validate-banner')
          .getAttribute('data-validate-kind'),
      ).toBe('ok')
    })
    expect(screen.getByTestId('ai-provider-validate-banner')).toHaveTextContent(
      'OK — provider reachable',
    )
    expect(validateBody()).toMatchObject({
      mode: 'local',
      base_url: 'http://localhost:11434',
    })
  })

  it('renders the pinned-IP success message when the validator resolves a host', async () => {
    mockedRequest.mockImplementation(async () => ({
      ok: true,
      mode: 'local',
      base_url: 'http://ollama.local:11434',
      pinned_ip: '127.0.0.1',
    }))
    renderSection({
      isCloud: false,
      initial: makeDraft({ base_url: 'http://ollama.local:11434' }),
    })

    fireEvent.click(screen.getByTestId('ai-provider-validate'))

    await waitFor(() => {
      const banner = screen.getByTestId('ai-provider-validate-banner')
      expect(banner.getAttribute('data-validate-kind')).toBe('ok')
      expect(banner).toHaveTextContent('OK — pinned to 127.0.0.1')
    })
  })

  it('renders a failure banner when the server returns a 422 rejection', async () => {
    mockedRequest.mockImplementation(async () => {
      throw new ApiError('public IP rejected', 422, 'not_local')
    })
    renderSection({
      isCloud: false,
      initial: makeDraft({ base_url: 'http://1.2.3.4:11434' }),
    })

    fireEvent.click(screen.getByTestId('ai-provider-validate'))

    await waitFor(() => {
      const banner = screen.getByTestId('ai-provider-validate-banner')
      expect(banner.getAttribute('data-validate-kind')).toBe('fail')
      expect(banner).toHaveTextContent('public IP rejected')
    })
  })

  it('surfaces a failure banner (not a silent swallow) when the network is unreachable', async () => {
    // Regression guard: the hook only reshapes the backend's 422 into the
    // failure variant. A plain fetch rejection (network down) re-throws out
    // of mutateAsync. Before the try/catch fix this produced an unhandled
    // promise and NO banner — the button just silently re-enabled.
    mockedRequest.mockImplementation(async () => {
      throw new Error('Failed to fetch')
    })
    renderSection({
      isCloud: false,
      initial: makeDraft({ base_url: 'http://localhost:11434' }),
    })

    fireEvent.click(screen.getByTestId('ai-provider-validate'))

    await waitFor(() => {
      const banner = screen.getByTestId('ai-provider-validate-banner')
      expect(banner.getAttribute('data-validate-kind')).toBe('fail')
      expect(banner).toHaveTextContent(/could not reach the server/)
    })
    // The button must recover, not stay stuck in the pending state.
    expect(screen.getByTestId('ai-provider-validate')).not.toBeDisabled()
  })

  it('also surfaces a failure banner for a non-422 ApiError (5xx)', async () => {
    mockedRequest.mockImplementation(async () => {
      throw new ApiError('internal error', 500)
    })
    renderSection({
      isCloud: false,
      initial: makeDraft({ base_url: 'http://localhost:11434' }),
    })

    fireEvent.click(screen.getByTestId('ai-provider-validate'))

    await waitFor(() => {
      expect(
        screen
          .getByTestId('ai-provider-validate-banner')
          .getAttribute('data-validate-kind'),
      ).toBe('fail')
    })
    expect(screen.getByTestId('ai-provider-validate-banner')).toHaveAttribute(
      'role',
      'status',
    )
  })

  it('clears the validation banner as soon as the user edits an input', async () => {
    mockedRequest.mockImplementation(async () => ({
      ok: true,
      mode: 'local',
      base_url: 'http://localhost:11434',
    }))
    renderSection({
      isCloud: false,
      initial: makeDraft({ base_url: 'http://localhost:11434' }),
    })

    fireEvent.click(screen.getByTestId('ai-provider-validate'))
    await waitFor(() => {
      expect(screen.getByTestId('ai-provider-validate-banner')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('ai-provider-base-url'), {
      target: { value: 'http://localhost:11500' },
    })
    expect(screen.queryByTestId('ai-provider-validate-banner')).toBeNull()
  })

  it('shows an in-flight "Validating…" loading state while the probe runs', async () => {
    const gate = deferred<{ ok: true; mode: 'local'; base_url: string }>()
    mockedRequest.mockImplementation(() => gate.promise)
    renderSection({
      isCloud: false,
      initial: makeDraft({ base_url: 'http://localhost:11434' }),
    })

    fireEvent.click(screen.getByTestId('ai-provider-validate'))

    await waitFor(() => {
      expect(screen.getByTestId('ai-provider-validate')).toHaveTextContent(
        'Validating…',
      )
    })
    expect(screen.getByTestId('ai-provider-validate')).toBeDisabled()

    // Resolve so the component settles and no state update leaks past the test.
    gate.resolve({ ok: true, mode: 'local', base_url: 'http://localhost:11434' })
    await waitFor(() => {
      expect(
        screen
          .getByTestId('ai-provider-validate-banner')
          .getAttribute('data-validate-kind'),
      ).toBe('ok')
    })
  })
})

describe('AIProviderSection — cloud mode', () => {
  it('renders cloud provider options, a masked API key, and a cost cap; hides the local base URL', () => {
    renderSection({ isCloud: true, initial: makeDraft({ provider: 'openai' }) })

    expect(screen.getByRole('option', { name: 'OpenAI' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Anthropic' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Azure AI' })).toBeInTheDocument()

    const apiKey = screen.getByTestId('ai-provider-api-key') as HTMLInputElement
    expect(apiKey.type).toBe('password')
    expect(apiKey).toHaveAttribute('autocomplete', 'new-password')

    expect(screen.getByTestId('ai-provider-cost-cap')).toBeInTheDocument()
    expect(screen.getByTestId('ai-provider-validate-cloud')).toBeInTheDocument()
    // The local base-URL input + its Validate button do not appear for a
    // non-Azure cloud provider.
    expect(screen.queryByTestId('ai-provider-base-url')).toBeNull()
    expect(screen.queryByTestId('ai-provider-azure-base-url')).toBeNull()
  })

  it('converts the cost cap between dollars and cents across valid, invalid, and negative input', () => {
    const onChangeSpy = vi.fn()
    renderSection({
      isCloud: true,
      initial: makeDraft({ provider: 'openai', cost_cap_cents: 500 }),
      onChangeSpy,
    })

    const cap = screen.getByTestId('ai-provider-cost-cap') as HTMLInputElement
    expect(cap.value).not.toBe('')
    expect(Number(cap.value)).toBe(5)

    fireEvent.change(cap, { target: { value: '7.50' } })
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ cost_cap_cents: 750 }),
    )

    // Non-numeric input is sanitised to empty by the number field → 0 cents.
    fireEvent.change(cap, { target: { value: 'abc' } })
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ cost_cap_cents: 0 }),
    )

    // Negative dollars clamp to 0 rather than storing a negative cap.
    fireEvent.change(cap, { target: { value: '-3' } })
    expect(onChangeSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ cost_cap_cents: 0 }),
    )
  })

  it('shows an empty cost-cap field when the cap is unset (0 cents)', () => {
    renderSection({
      isCloud: true,
      initial: makeDraft({ provider: 'openai', cost_cap_cents: 0 }),
    })
    const cap = screen.getByTestId('ai-provider-cost-cap') as HTMLInputElement
    expect(cap.value).toBe('')
  })

  it('omits api_key from the cloud validate payload when the field is blank', async () => {
    mockedRequest.mockImplementation(async () => ({
      ok: true,
      mode: 'cloud',
      base_url: '',
    }))
    renderSection({
      isCloud: true,
      initial: makeDraft({ provider: 'openai', model: 'gpt-4o-mini', api_key: '' }),
    })

    fireEvent.click(screen.getByTestId('ai-provider-validate-cloud'))

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        VALIDATE_PATH,
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const body = validateBody()
    expect(body).toMatchObject({ mode: 'cloud', provider: 'openai' })
    expect(body).not.toHaveProperty('api_key')
  })

  it('includes a typed api_key and renders the probed-model success message', async () => {
    mockedRequest.mockImplementation(async () => ({
      ok: true,
      mode: 'cloud',
      base_url: '',
      probed_model: 'gpt-4o',
    }))
    renderSection({
      isCloud: true,
      initial: makeDraft({
        provider: 'openai',
        model: 'gpt-4o',
        api_key: 'sk-secret',
      }),
    })

    fireEvent.click(screen.getByTestId('ai-provider-validate-cloud'))

    await waitFor(() => {
      const banner = screen.getByTestId('ai-provider-validate-banner')
      expect(banner.getAttribute('data-validate-kind')).toBe('ok')
      expect(banner).toHaveTextContent('OK — gpt-4o reachable')
    })
    expect(validateBody()).toMatchObject({ api_key: 'sk-secret' })
  })

  it('keeps the cloud Validate button enabled even with an empty API key', () => {
    renderSection({
      isCloud: true,
      initial: makeDraft({ provider: 'openai', api_key: '' }),
    })
    expect(screen.getByTestId('ai-provider-validate-cloud')).not.toBeDisabled()
  })
})

describe('AIProviderSection — Azure surface', () => {
  it('reveals Azure fields and uses the Azure-specific model label', () => {
    renderSection({
      isCloud: true,
      initial: makeDraft({ provider: 'azure', flavor: 'openai' }),
    })

    expect(screen.getByTestId('ai-provider-azure-flavor')).toBeInTheDocument()
    expect(screen.getByTestId('ai-provider-azure-api-version')).toBeInTheDocument()
    expect(screen.getByTestId('ai-provider-azure-deployment')).toBeInTheDocument()
    expect(
      screen.getByTestId('ai-provider-azure-embedding-deployment'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('ai-provider-azure-base-url')).toBeInTheDocument()

    // Model label switches to the Azure-specific identifier copy.
    expect(
      screen.getByText('Model identifier (e.g. gpt-4o-mini)'),
    ).toBeInTheDocument()
  })

  it('hides the deployment inputs when the Foundry flavor is selected', () => {
    renderSection({
      isCloud: true,
      initial: makeDraft({ provider: 'azure', flavor: 'openai' }),
    })
    // Precondition: deployment inputs visible for the OpenAI-Service flavor.
    expect(screen.getByTestId('ai-provider-azure-deployment')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('ai-provider-azure-flavor'), {
      target: { value: 'foundry' },
    })

    // Foundry routes the model in the body, so the deployment-name inputs
    // collapse while api-version + endpoint stay.
    expect(screen.queryByTestId('ai-provider-azure-deployment')).toBeNull()
    expect(
      screen.queryByTestId('ai-provider-azure-embedding-deployment'),
    ).toBeNull()
    expect(screen.getByTestId('ai-provider-azure-api-version')).toBeInTheDocument()
    expect(screen.getByTestId('ai-provider-azure-base-url')).toBeInTheDocument()
  })

  it('uses the plain "Model" label for a non-Azure cloud provider', () => {
    renderSection({ isCloud: true, initial: makeDraft({ provider: 'openai' }) })
    expect(
      screen.queryByText('Model identifier (e.g. gpt-4o-mini)'),
    ).toBeNull()
    expect(screen.getByText('Model')).toBeInTheDocument()
  })
})
