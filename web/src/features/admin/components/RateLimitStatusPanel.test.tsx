/**
 * RateLimitStatusPanel contract tests.
 *
 * Covers:
 *  1. Loading state spinner.
 *  2. Three rows render with severity labels.
 *  3. Severity colour class applied per row.
 *  4. Empty state when backend returns zero scopes.
 *  5. Error state when fetch rejects.
 *  6. Refresh button refetches.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', () => ({
  request: vi.fn(),
}))

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        // t(key, defaultStr, opts) signature
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        // t(key, opts) signature
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

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { RateLimitStatusPanel } from './RateLimitStatusPanel'
import type {
  RateLimitStatusResponse,
  ScopeBudget,
  RateLimitSeverity,
} from '@/api/types'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function makeScope(
  id: string,
  current: number,
  limit: number,
  severity: RateLimitSeverity,
  windowSeconds = 60,
  unit?: 'usd',
): ScopeBudget {
  return {
    id,
    name: id,
    current,
    limit,
    window_seconds: windowSeconds,
    severity,
    unit,
    detail: `${id} detail`,
  }
}

function buildResponse(
  overrides?: Partial<RateLimitStatusResponse>,
): RateLimitStatusResponse {
  return {
    generated_at: '2026-05-05T12:00:00Z',
    scopes: [
      makeScope('tesla.fleet_api.burst', 1, 5, 'ok', 0),
      makeScope('api.internal.minute', 350, 600, 'warn', 60),
      makeScope('api.write.minute', 110, 120, 'critical', 60),
    ],
    ...overrides,
  }
}

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <RateLimitStatusPanel />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RateLimitStatusPanel — Phase-46 / Prompt 40', () => {
  it('renders a loading state on first mount', () => {
    let resolve: (v: RateLimitStatusResponse) => void = () => {}
    mockedRequest.mockImplementationOnce(
      () =>
        new Promise<RateLimitStatusResponse>((r) => {
          resolve = r
        }),
    )
    renderPanel()
    expect(screen.getByTestId('rate-limit-loading')).toBeInTheDocument()
    // Resolve the promise so the test's QueryClient doesn't leak a
    // pending in-flight query into the next test.
    resolve(buildResponse())
  })

  it('renders one row per scope with severity labels', async () => {
    mockedRequest.mockResolvedValueOnce(buildResponse())
    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('rate-limit-rows')).toBeInTheDocument()
    })

    expect(
      screen.getByTestId('rate-limit-row-tesla.fleet_api.burst'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('rate-limit-row-api.internal.minute'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('rate-limit-row-api.write.minute'),
    ).toBeInTheDocument()

    expect(mockedRequest).toHaveBeenCalledWith(
      '/system/rate-limits',
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it('applies severity tone class per row', async () => {
    mockedRequest.mockResolvedValueOnce(buildResponse())
    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('rate-limit-rows')).toBeInTheDocument()
    })

    const okSeverity = screen.getByTestId(
      'rate-limit-severity-tesla.fleet_api.burst',
    )
    expect(okSeverity.className).toMatch(/text-emerald-300/)

    const warnSeverity = screen.getByTestId(
      'rate-limit-severity-api.internal.minute',
    )
    expect(warnSeverity.className).toMatch(/text-amber-300/)

    const critSeverity = screen.getByTestId(
      'rate-limit-severity-api.write.minute',
    )
    expect(critSeverity.className).toMatch(/text-rose-300/)
  })

  it('formats Fleet API spend scopes as USD with sub-cent precision', async () => {
    const resetAt = new Date(Date.now() + 60_000).toISOString()
    mockedRequest.mockResolvedValueOnce(
      buildResponse({
        scopes: [
          {
            ...makeScope(
              'tesla.fleet_api.daily_spend',
              0.002,
              0.3,
              'ok',
              86_400,
              'usd',
            ),
            reset_at: resetAt,
          },
        ],
      }),
    )
    renderPanel()

    await waitFor(() => {
      expect(
        screen.getByTestId('rate-limit-row-tesla.fleet_api.daily_spend'),
      ).toBeInTheDocument()
    })
    expect(screen.getByText('$0.002 / $0.300')).toBeInTheDocument()
    expect(screen.getByText('UTC day')).toBeInTheDocument()
    expect(screen.getByText(/Resets in/)).toBeInTheDocument()
  })

  it('shows partial-evidence warnings without hiding healthy scopes', async () => {
    mockedRequest.mockResolvedValueOnce(
      buildResponse({
        warnings: ['Fleet API spend evidence is unavailable.'],
      }),
    )
    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('rate-limit-warning')).toBeInTheDocument()
    })
    expect(
      screen.getByText('Fleet API spend evidence is unavailable.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('rate-limit-rows')).toBeInTheDocument()
  })

  it('shows the empty state when the backend returns zero scopes', async () => {
    mockedRequest.mockResolvedValueOnce(buildResponse({ scopes: [] }))
    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('rate-limit-empty')).toBeInTheDocument()
    })
  })

  it('shows the error state when the request rejects', async () => {
    // Hook explicitly sets `retry: 1`, so the error must persist for at
    // least two attempts before the query transitions to `error`.
    mockedRequest.mockRejectedValue(new Error('boom'))
    renderPanel()

    await waitFor(
      () => {
        expect(screen.getByTestId('rate-limit-error')).toBeInTheDocument()
      },
      { timeout: 3000 },
    )
  })

  it('refetches when the Refresh button is clicked', async () => {
    mockedRequest.mockResolvedValueOnce(buildResponse())
    renderPanel()

    await waitFor(() => {
      expect(screen.getByTestId('rate-limit-rows')).toBeInTheDocument()
    })
    expect(mockedRequest).toHaveBeenCalledTimes(1)

    mockedRequest.mockResolvedValueOnce(buildResponse())
    fireEvent.click(screen.getByTestId('rate-limit-refresh-button'))

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledTimes(2)
    })
  })
})
