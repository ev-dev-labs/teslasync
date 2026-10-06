/**
 * FleetSetupPage — guided Settings surface for Tesla Fleet connect → subscribe → stream.
 *
 * Existing /tesla-account and /dev-tools pages are not mounted here; this
 * page must still render TeslaAccountSection plus subscribe / stream / domain
 * panels even when data is empty.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    request: vi.fn(),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        const interpolate = (s: string) => {
          if (!opts) return s
          return Object.keys(opts).reduce(
            (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
            s,
          )
        }
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue)
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (v: unknown) => `fmt:${String(v)}`,
    formatTime: (v: unknown) => `time:${String(v)}`,
    formatDate: (v: unknown) => `date:${String(v)}`,
  }),
}))

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }))

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import FleetSetupPage from './FleetSetupPage'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function pathOf(args: unknown[]): string {
  const first = args[0]
  return typeof first === 'string' ? first : ''
}

beforeEach(() => {
  mockedRequest.mockReset()
  mockedRequest.mockImplementation(async (...args: unknown[]) => {
    const path = pathOf(args)
    if (path.startsWith('/auth/status')) {
      return { authenticated: true, expires_at: '2099-01-01T00:00:00Z' }
    }
    if (path.startsWith('/dev-tools/fleet-api-info')) {
      return {
        base_url: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
        client_id: 'cid',
        has_valid_token: true,
        public_key_url: 'https://example/.well-known/appspecific/com.tesla.3p.public-key.pem',
      }
    }
    if (path.startsWith('/dev-tools/public-key-status')) {
      return {
        configured: true,
        fingerprint: 'aa:bb:cc',
        well_known_path: '/.well-known/appspecific/com.tesla.3p.public-key.pem',
      }
    }
    if (path.startsWith('/onboarding/status')) {
      return {
        tesla_connected: true,
        vehicle_count: 1,
        data_flowing: true,
        last_telemetry_at: '2026-04-01T12:00:00Z',
        telemetry_health: 'healthy',
        setup_complete: true,
        is_complete: true,
      }
    }
    if (path === '/vehicles') {
      return [{ id: 1, vin: '5YJ3E1EA7KF000001', display_name: 'Model Y' }]
    }
    if (path.startsWith('/dev-tools/fleet-telemetry-config')) {
      return { response: { config: { hostname: 'telemetry.example.com', port: 4443, fields: { Soc: {} } } } }
    }
    return {}
  })
})

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const rendered = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <FleetSetupPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...rendered, client: qc }
}

describe('FleetSetupPage', () => {
  it('renders KPI, Tesla connect, subscribe, stream, and domain panels', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Fleet setup' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Auto-refresh on')).toBeInTheDocument()
    })
    expect(screen.getByText('Refresh token')).toBeInTheDocument()
    expect(screen.getAllByText('Subscribe telemetry').length).toBeGreaterThan(0)
    expect(screen.getByText('How fleet setup works')).toBeInTheDocument()
    expect(screen.getByText('Domain & certificates')).toBeInTheDocument()
    expect(screen.getAllByText('Streaming').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Open Fleet API tools/i })).toHaveAttribute(
      'href',
      '/dev-tools?tab=fleet-api',
    )
    expect(screen.getByRole('button', { name: /Configure signals/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Wake vehicle/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remove config/i })).toBeInTheDocument()
  })

  it('opens the Fleet Telemetry Signal Configuration picker', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Configure signals/i }))
    expect(
      await screen.findByRole('heading', { name: 'Fleet Telemetry Signal Configuration' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Balanced/i)).toBeInTheDocument()
  })

  it('keeps resolved sources visible while partner-key status is still loading', async () => {
    const original = mockedRequest.getMockImplementation()!
    mockedRequest.mockImplementation((...args: unknown[]) => {
      if (pathOf(args).startsWith('/dev-tools/public-key-status')) return new Promise(() => {})
      return original(...args)
    })
    renderPage()
    expect(await screen.findByText('Auto-refresh on')).toBeInTheDocument()
    expect(screen.getAllByText('Streaming').length).toBeGreaterThan(0)
    expect(screen.getByText('How fleet setup works')).toBeInTheDocument()
    expect(screen.queryByText('Not published')).toBeNull()
    expect(screen.queryByText('Public key not stored')).toBeNull()
  })

  it('distinguishes independent initial failures from missing keys, tokens and a waiting stream', async () => {
    const original = mockedRequest.getMockImplementation()!
    mockedRequest.mockImplementation((...args: unknown[]) => {
      const path = pathOf(args)
      if (path.startsWith('/dev-tools/public-key-status') ||
          path.startsWith('/dev-tools/fleet-api-info') ||
          path.startsWith('/onboarding/status')) return Promise.reject(new Error('Read unavailable'))
      return original(...args)
    })
    renderPage()
    expect(await screen.findByText('Partner public-key status unavailable.')).toBeInTheDocument()
    expect(await screen.findByText('Telemetry status unavailable.')).toBeInTheDocument()
    expect(await screen.findByText('Fleet access-token status unavailable.')).toBeInTheDocument()
    expect(screen.queryByText('Missing')).toBeNull()
    expect(screen.queryByText('Not published')).toBeNull()
    expect(screen.queryByText('Public key not stored')).toBeNull()
    expect(screen.queryByText(/No stream yet/)).toBeNull()
    expect(screen.getByText('How fleet setup works')).toBeInTheDocument()
    expect(screen.getByText('Refresh token')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open Fleet API tools/i })).toBeInTheDocument()
  })

  it('does not describe failed VIN config and error reads as empty successful responses', async () => {
    const original = mockedRequest.getMockImplementation()!
    mockedRequest.mockImplementation((...args: unknown[]) => {
      const path = pathOf(args)
      if (path.startsWith('/dev-tools/fleet-telemetry-config') ||
          path.startsWith('/dev-tools/fleet-telemetry-errors')) return Promise.reject(new Error('VIN read unavailable'))
      return original(...args)
    })
    renderPage()
    fireEvent.change(await screen.findByRole('combobox', { name: 'Vehicle' }), {
      target: { value: '5YJ3E1EA7KF000001' },
    })
    expect(await screen.findByText('Telemetry configuration unavailable.')).toBeInTheDocument()
    expect(await screen.findByText('Tesla telemetry error status unavailable.')).toBeInTheDocument()
    expect(screen.queryByText('No fleet_telemetry_config on this VIN yet.')).toBeNull()
    expect(screen.queryByText('No Tesla-side telemetry errors for this VIN.')).toBeNull()
    expect(screen.getByRole('button', { name: /Wake vehicle/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Configure signals/i })).toBeEnabled()
    expect(mockedRequest.mock.calls.some(call => ['POST', 'PUT', 'DELETE'].includes(
      (call[1] as RequestInit | undefined)?.method ?? 'GET',
    ))).toBe(false)
  })

  it('retains measured readiness and streaming details after background source failures', async () => {
    const { client } = renderPage()
    await screen.findByText('Auto-refresh on')
    await screen.findAllByText('aa:bb:cc')
    await screen.findByText('fmt:2026-04-01T12:00:00Z')
    mockedRequest.mockRejectedValue(new Error('Refresh unavailable'))
    await act(async () => { await client.refetchQueries() })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(screen.getByText('Auto-refresh on')).toBeInTheDocument()
    expect(screen.getAllByText('aa:bb:cc').length).toBeGreaterThan(0)
    expect(screen.getByText('fmt:2026-04-01T12:00:00Z')).toBeInTheDocument()
    expect(screen.getAllByText('Previously loaded data remains visible while affected sources recover.').length).toBeGreaterThan(0)
    expect(screen.queryByText('Public key not stored')).toBeNull()
    expect(screen.queryByText('Not connected')).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh token' })).toBeEnabled()
  })

  it('still shows every section when Tesla is disconnected', async () => {
    mockedRequest.mockImplementation(async (...args: unknown[]) => {
      const path = pathOf(args)
      if (path.startsWith('/auth/status')) return { authenticated: false }
      if (path.startsWith('/dev-tools/fleet-api-info')) {
        return { base_url: '', client_id: '', has_valid_token: false, public_key_url: '' }
      }
      if (path.startsWith('/dev-tools/public-key-status')) {
        return { configured: false, well_known_path: '/.well-known/appspecific/com.tesla.3p.public-key.pem' }
      }
      if (path.startsWith('/onboarding/status')) {
        return {
          tesla_connected: false,
          vehicle_count: 0,
          data_flowing: false,
          last_telemetry_at: null,
          telemetry_health: 'unknown',
          setup_complete: false,
          is_complete: false,
        }
      }
      if (path === '/vehicles') return []
      return {}
    })
    renderPage()
    expect(await screen.findByText('Not connected')).toBeInTheDocument()
    expect(screen.getByText('Connect Tesla first. Subscribe uses the stored Fleet token.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No stream yet. After subscribe, Tesla delivers the first batch when the vehicle next wakes.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('How fleet setup works')).toBeInTheDocument()
    expect(screen.getByText('Domain & certificates')).toBeInTheDocument()
  })
})
