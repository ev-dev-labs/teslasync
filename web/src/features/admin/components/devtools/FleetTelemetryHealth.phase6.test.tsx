import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: vi.fn(),
}))

vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? name))
        : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/components/feedback/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
  useOptionalToast: () => null,
  ToastProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

import { request } from '@/api/client'
import type { FleetTelemetryError, FleetTelemetryErrorVIN } from '@/api/hooks/useTelemetry'
import { FleetTelemetryHealth } from './FleetTelemetryHealth'

const VINS_URL = '/tesla/fleet-telemetry/error-vins'
const ERRORS_URL = '/tesla/fleet-telemetry/errors'
const VINS_KEY = ['fleet-telemetry-error-vins']
const ERRORS_KEY = ['fleet-telemetry-errors', undefined]
const VIN = 'TESTVIN00000000001'
const NOW = '2026-10-14T12:00:00.000Z'
const vin: FleetTelemetryErrorVIN = {
  id: 1, vin: VIN, active: true, first_seen_at: NOW, last_seen_at: NOW, resolved_at: null,
}
const error: FleetTelemetryError = {
  id: 2, vin: VIN, error_code: 'TEST_ERROR', error_message: 'Synthetic diagnostic',
  reported_at: NOW, tesla_updated_at: null, fetched_at: NOW,
}
const mockedRequest = vi.mocked(request)
const clients: QueryClient[] = []

function wire(
  vins: () => Promise<FleetTelemetryErrorVIN[]> = () => Promise.resolve([vin]),
  errors: (path: string) => Promise<FleetTelemetryError[]> = () => Promise.resolve([error]),
) {
  mockedRequest.mockImplementation(<T,>(path: string) => {
    if (path === VINS_URL) return vins() as Promise<T>
    if (path === ERRORS_URL || path.startsWith(`${ERRORS_URL}?`)) return errors(path) as Promise<T>
    return Promise.reject(new Error(`Unexpected request: ${path}`))
  })
}

function mount(seed?: { vins: FleetTelemetryErrorVIN[]; errors: FleetTelemetryError[] }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  clients.push(client)
  if (seed) {
    client.setQueryData(VINS_KEY, seed.vins)
    client.setQueryData(ERRORS_KEY, seed.errors)
  }
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <FleetTelemetryHealth />
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return { client, ...view }
}

function section(title: string) {
  const panel = screen.getByText(title).closest('[data-print-card]')
  if (!panel) throw new Error(`Missing section: ${title}`)
  return within(panel)
}

function calls(path: string) {
  return mockedRequest.mock.calls.filter(([url]) => url === path).length
}

function affectedBadge() {
  return screen.getByText(/affected$/)
}

async function refresh(client: QueryClient, queryKey: unknown[]) {
  await act(async () => {
    await client.refetchQueries({ queryKey, exact: true })
  })
}

beforeEach(() => {
  onlineManager.setOnline(true)
  mockedRequest.mockReset()
})

afterEach(() => {
  cleanup()
  clients.splice(0).forEach(client => client.clear())
  onlineManager.setOnline(true)
})

describe('FleetTelemetryHealth independent source trust (real query/data-state contracts)', () => {
  it('keeps the affected count unknown and neutral before either source resolves', () => {
    wire(() => new Promise(() => {}), () => new Promise(() => {}))
    const { container } = mount()
    expect(affectedBadge()).toHaveTextContent('Unknown affected')
    expect(affectedBadge()).toHaveClass('bg-[var(--surface-2)]')
    expect(screen.getByText('Error VINs')).toBeInTheDocument()
    expect(screen.getByText('Error log')).toBeInTheDocument()
    expect(container.querySelectorAll('[class~="bg-[var(--skeleton-bg)]"]')).toHaveLength(2)
    expect(screen.queryByText('0 affected')).not.toBeInTheDocument()
    expect(screen.queryByText('No vehicles with telemetry errors')).not.toBeInTheDocument()
    expect(screen.queryByText('No fleet telemetry errors recorded')).not.toBeInTheDocument()
  })

  it('keeps an initial VIN failure unknown while the error log remains usable and retries only VINs', async () => {
    let fail = true
    wire(() => fail ? Promise.reject(new Error('VIN read failed')) : Promise.resolve([vin]))
    mount()
    await screen.findByText('TEST_ERROR')
    expect(await section('Error VINs').findByRole('alert')).toBeInTheDocument()
    expect(affectedBadge()).toHaveTextContent('Unknown affected')
    expect(affectedBadge()).not.toHaveClass('bg-[var(--semantic-success-bg)]')
    expect(section('Error log').queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('No vehicles with telemetry errors')).not.toBeInTheDocument()
    const before = calls(ERRORS_URL)
    fail = false
    fireEvent.click(section('Error VINs').getByRole('button', { name: 'Retry' }))
    await screen.findByRole('button', { name: VIN })
    expect(calls(VINS_URL)).toBe(2)
    expect(calls(ERRORS_URL)).toBe(before)
    expect(affectedBadge()).toHaveTextContent('1 affected')
  })

  it('contains an initial log failure without replacing the VIN source and retries only the log', async () => {
    let fail = true
    wire(undefined, () => fail ? Promise.reject(new Error('Log read failed')) : Promise.resolve([error]))
    mount()
    await screen.findByRole('button', { name: VIN })
    expect(await section('Error log').findByRole('alert')).toBeInTheDocument()
    expect(section('Error VINs').queryByRole('alert')).not.toBeInTheDocument()
    expect(affectedBadge()).toHaveTextContent('1 affected')
    const before = calls(VINS_URL)
    fail = false
    fireEvent.click(section('Error log').getByRole('button', { name: 'Retry' }))
    await screen.findByText('TEST_ERROR')
    expect(calls(ERRORS_URL)).toBe(2)
    expect(calls(VINS_URL)).toBe(before)
  })

  it('preserves the authoritative empty zero and both distinct empty sections', async () => {
    wire(() => Promise.resolve([]), () => Promise.resolve([]))
    mount()
    await screen.findByText('No vehicles with telemetry errors')
    expect(await screen.findByText('No fleet telemetry errors recorded')).toBeInTheDocument()
    expect(affectedBadge()).toHaveTextContent('0 affected')
    expect(affectedBadge()).toHaveClass('bg-[var(--semantic-success-bg)]')
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument()
  })

  it.each(['vins', 'errors'] as const)('retains both tables when %s refresh fails and recovery retries only that source', async (source) => {
    let fail = true
    wire(
      () => source === 'vins' && fail ? Promise.reject(new Error('VIN refresh failed')) : Promise.resolve([vin]),
      () => source === 'errors' && fail ? Promise.reject(new Error('Log refresh failed')) : Promise.resolve([error]),
    )
    const { client } = mount({ vins: [vin], errors: [error] })
    await refresh(client, source === 'vins' ? VINS_KEY : ERRORS_KEY)
    const affected = section(source === 'vins' ? 'Error VINs' : 'Error log')
    const unaffected = section(source === 'vins' ? 'Error log' : 'Error VINs')
    expect(await affected.findByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(unaffected.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: VIN })).toBeInTheDocument()
    expect(screen.getByText('TEST_ERROR')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(affectedBadge()).toHaveTextContent('1 affected')
    const vinsBefore = calls(VINS_URL)
    const errorsBefore = calls(ERRORS_URL)
    fail = false
    fireEvent.click(affected.getByRole('button', { name: 'Refresh', exact: true }))
    await waitFor(() => expect(affected.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument())
    expect(calls(VINS_URL)).toBe(vinsBefore + (source === 'vins' ? 1 : 0))
    expect(calls(ERRORS_URL)).toBe(errorsBefore + (source === 'errors' ? 1 : 0))
  })

  it('keeps simultaneous refresh failures separate when only VINs recover', async () => {
    let vinsFail = true
    wire(
      () => vinsFail ? Promise.reject(new Error('VIN refresh failed')) : Promise.resolve([vin]),
      () => Promise.reject(new Error('Log refresh failed')),
    )
    const { client } = mount({ vins: [vin], errors: [error] })
    await refresh(client, VINS_KEY)
    await refresh(client, ERRORS_KEY)
    expect(await screen.findAllByTestId('stale-refresh-warning')).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    vinsFail = false
    const logCalls = calls(ERRORS_URL)
    fireEvent.click(section('Error VINs').getByRole('button', { name: 'Refresh', exact: true }))
    await waitFor(() => expect(section('Error VINs').queryByTestId('stale-refresh-warning')).not.toBeInTheDocument())
    expect(section('Error log').getByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(screen.getByText('TEST_ERROR')).toBeInTheDocument()
    expect(calls(ERRORS_URL)).toBe(logCalls)
  })

  it('retains authoritative zero after a failed refresh without presenting it as fresh healthy success', async () => {
    wire(() => Promise.reject(new Error('VIN refresh failed')))
    const { client } = mount({ vins: [], errors: [error] })
    await refresh(client, VINS_KEY)
    expect(await section('Error VINs').findByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(affectedBadge()).toHaveTextContent('0 affected')
    expect(affectedBadge()).toHaveClass('bg-[var(--semantic-warning-bg)]')
    expect(affectedBadge()).not.toHaveClass('bg-[var(--semantic-success-bg)]')
    expect(screen.getByText('No vehicles with telemetry errors')).toBeInTheDocument()
    expect(screen.getByText('TEST_ERROR')).toBeInTheDocument()
  })

  it('keeps retained tables and count visible while both refreshes are pending', async () => {
    wire(() => new Promise(() => {}), () => new Promise(() => {}))
    const { client, container } = mount({ vins: [vin], errors: [error] })
    act(() => {
      void client.refetchQueries({ queryKey: VINS_KEY, exact: true })
      void client.refetchQueries({ queryKey: ERRORS_KEY, exact: true })
    })
    await waitFor(() => expect(screen.getAllByText('Refreshing')).toHaveLength(2))
    expect(screen.getByRole('button', { name: VIN })).toBeInTheDocument()
    expect(screen.getByText('TEST_ERROR')).toBeInTheDocument()
    expect(affectedBadge()).toHaveTextContent('1 affected')
    expect(container.querySelectorAll('[class~="bg-[var(--skeleton-bg)]"]')).toHaveLength(0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('exposes initial paused reads as unknown, not empty zero or an invented failure', async () => {
    onlineManager.setOnline(false)
    wire()
    mount()
    expect(await screen.findAllByText('Refresh paused')).toHaveLength(2)
    expect(affectedBadge()).toHaveTextContent('Unknown affected')
    expect(screen.queryByText('0 affected')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(calls(VINS_URL)).toBe(0)
    expect(calls(ERRORS_URL)).toBe(0)
    fireEvent.click(section('Error VINs').getByRole('button', { name: 'Retry' }))
    expect(calls(VINS_URL)).toBe(0)
    expect(section('Error log').getByText('Refresh paused')).toBeInTheDocument()
  })

  it('marks retained paused sources stale and blocked without erasing either table', async () => {
    wire()
    const { client } = mount({ vins: [vin], errors: [error] })
    onlineManager.setOnline(false)
    act(() => {
      void client.refetchQueries({ queryKey: VINS_KEY, exact: true })
      void client.refetchQueries({ queryKey: ERRORS_KEY, exact: true })
    })
    const warnings = await screen.findAllByTestId('stale-refresh-warning')
    expect(warnings).toHaveLength(2)
    warnings.forEach(warning => {
      expect(warning).toHaveAttribute('data-refresh-blocked', 'true')
      expect(warning).toHaveAttribute('data-data-state', 'stale')
      expect(within(warning).getByText('Refresh paused')).toBeInTheDocument()
      expect(within(warning).getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
    })
    expect(screen.getByRole('button', { name: VIN })).toBeInTheDocument()
    expect(screen.getByText('TEST_ERROR')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(calls(VINS_URL)).toBe(0)
    expect(calls(ERRORS_URL)).toBe(0)
  })

  it('does not leak unfiltered retained log rows into a newly selected VIN scope', async () => {
    wire(undefined, path => path.includes('?vin=') ? new Promise(() => {}) : Promise.resolve([error]))
    mount({ vins: [vin], errors: [error] })
    fireEvent.click(screen.getByRole('button', { name: VIN }))
    await waitFor(() => expect(calls(`${ERRORS_URL}?vin=${VIN}`)).toBe(1))
    expect(screen.getByText(/Filtered/)).toHaveTextContent(VIN)
    expect(screen.queryByText('TEST_ERROR')).not.toBeInTheDocument()
    expect(screen.queryByText('No fleet telemetry errors recorded')).not.toBeInTheDocument()
    expect(affectedBadge()).toHaveTextContent('1 affected')
    fireEvent.click(screen.getByRole('button', { name: 'Clear VIN filter' }))
    expect(await screen.findByText('TEST_ERROR')).toBeInTheDocument()
    expect(screen.queryByText(/Filtered/)).not.toBeInTheDocument()
  })
})
