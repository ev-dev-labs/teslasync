import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

vi.mock('./helpers', async () => {
  const actual = await vi.importActual<typeof import('./helpers')>('./helpers')
  return {
    ...actual,
    useVehicleOptions: () => ({
      vehicles: [{ vin: 'TEST-A' }, { vin: 'TEST-B' }],
      options: [{ value: 'TEST-A', label: 'Test vehicle A' }, { value: 'TEST-B', label: 'Test vehicle B' }],
    }),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOptions?: unknown, options?: Record<string, unknown>) => {
        const fallback = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key
        const translated = key.match(/^devtools\.onboarding\.\w+\.(label|desc)$/)
          ? `Translated: ${fallback}` : fallback
        return Object.entries(options ?? {}).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), translated)
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { FleetApiSection } from './FleetApiSection'

const requestMock = vi.mocked(request)
const fleetInfo = {
  base_url: 'https://fleet.example.test',
  client_id: 'synthetic-client',
  has_valid_token: true,
  regions: { na: 'https://na.example.test', eu: 'https://eu.example.test' },
}
let keyStatus: Record<string, unknown>
let info: Record<string, unknown>
let handler: (path: string, options?: RequestInit & { requiresLiveMode?: boolean }) => unknown

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider><FleetApiSection /></ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return client
}

async function card(name: string) {
  const heading = await screen.findByRole('heading', { level: 3, name })
  const element = heading.closest<HTMLElement>('[data-print-card]')
  if (!element) throw new Error(`Missing card: ${name}`)
  return element
}

function select(element: HTMLElement, value: string) {
  fireEvent.change(within(element).getByRole('combobox'), { target: { value } })
}

function calls(path: string) {
  return requestMock.mock.calls.filter(([endpoint]) => endpoint === path)
}

function deferred() {
  let resolve!: (data: Record<string, unknown>) => void
  const promise = new Promise<Record<string, unknown>>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear()
  onlineManager.setOnline(true)
  requestMock.mockReset()
  keyStatus = { configured: false, well_known_path: '/.well-known/appspecific/com.tesla.3p.public-key.pem' }
  info = fleetInfo
  handler = () => ({})
  requestMock.mockImplementation(async (path, options) => {
    if (path === '/dev-tools/fleet-api-info') return info as never
    if (path === '/dev-tools/public-key-status') return keyStatus as never
    return await handler(path, options) as never
  })
})

afterEach(() => {
  cleanup()
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('phase6 Fleet API contracts and provenance', () => {
  it('preserves both sections, all nine tools, and reads the real auth/region contract', async () => {
    mount()
    const config = await card('Config')
    expect(within(config).getByText(fleetInfo.base_url)).toBeInTheDocument()
    expect(within(config).getByText(fleetInfo.client_id)).toBeInTheDocument()
    expect(within(config).getByText('Authenticated')).toBeInTheDocument()
    expect(within(config).getByText(fleetInfo.regions.eu)).toBeInTheDocument()
    for (const title of ['Partner reg', 'Public key verification', 'Public key', 'Key pairing', 'Telemetry sub', 'Telemetry config', 'Fleet status', 'Vehicle data']) {
      expect(await card(title)).toBeInTheDocument()
    }
    expect(screen.getByRole('heading', { name: 'Setup wizard' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Fleet API tools' })).toBeInTheDocument()
    await waitFor(() => expect(JSON.parse(localStorage.getItem('devtools-onboarding') ?? '{}')).toMatchObject({ auth: true }))
  })

  it('keeps unavailable authentication unknown instead of false', async () => {
    info = {}
    mount()
    const config = await card('Config')
    expect(within(config).getByText('Unknown')).toBeInTheDocument()
    expect(within(config).queryByText('Not authenticated')).not.toBeInTheDocument()
  })

  it('renders the real well-known path but never fabricates a configured pairing host', async () => {
    mount()
    expect(within(await card('Public key')).getByText(String(keyStatus.well_known_path))).toBeInTheDocument()
    const pairing = await card('Key pairing')
    expect(within(pairing).getByText(/configured application hostname is not provided/)).toBeInTheDocument()
    expect(within(pairing).queryByRole('button', { name: /copy/i })).not.toBeInTheDocument()
    expect(pairing.textContent).not.toContain('yourapp.example.com')
  })

  it('uses public_key_pem, retains rejected PEM, and does not invalidate status on failure', async () => {
    handler = (path) => {
      if (path === '/dev-tools/upload-public-key') throw new Error('Synthetic upload failed')
      return {}
    }
    mount()
    const key = await card('Public key')
    const textarea = within(key).getByRole('textbox', { name: 'Upload PEM' })
    fireEvent.change(textarea, { target: { value: 'SYNTHETIC-PUBLIC-PEM' } })
    const statusCalls = calls('/dev-tools/public-key-status').length
    fireEvent.click(within(key).getByRole('button', { name: 'Upload key' }))
    expect(await within(key).findByRole('alert')).toHaveTextContent('Synthetic upload failed')
    expect(textarea).toHaveValue('SYNTHETIC-PUBLIC-PEM')
    expect(calls('/dev-tools/public-key-status')).toHaveLength(statusCalls)
    const submitted = calls('/dev-tools/upload-public-key')[0][1]
    expect(JSON.parse(String(submitted?.body))).toEqual({ public_key_pem: 'SYNTHETIC-PUBLIC-PEM' })
    expect(submitted).toMatchObject({ requiresLiveMode: true })
  })

  it('clears only the successfully submitted PEM, not edits made in flight', async () => {
    const pending = deferred()
    handler = (path) => path === '/dev-tools/upload-public-key' ? pending.promise : {}
    mount()
    const key = await card('Public key')
    const textarea = within(key).getByRole('textbox', { name: 'Upload PEM' })
    fireEvent.change(textarea, { target: { value: 'FIRST-PUBLIC-PEM' } })
    fireEvent.click(within(key).getByRole('button', { name: 'Upload key' }))
    await waitFor(() => expect(calls('/dev-tools/upload-public-key')).toHaveLength(1))
    fireEvent.change(textarea, { target: { value: 'EDITED-PUBLIC-PEM' } })
    await act(async () => { pending.resolve({ configured: true }) })
    expect(textarea).toHaveValue('EDITED-PUBLIC-PEM')
  })

  it('preserves rejected mutation feedback for partner and vehicle actions', async () => {
    handler = () => { throw new Error('Synthetic rejected action') }
    mount()
    const partner = await card('Partner reg')
    fireEvent.change(within(partner).getByRole('textbox'), { target: { value: 'partner.example.test' } })
    fireEvent.click(within(partner).getByRole('button', { name: 'Register' }))
    expect(await within(partner).findByRole('alert')).toHaveTextContent('Synthetic rejected action')
    const data = await card('Vehicle data')
    select(data, 'TEST-A')
    fireEvent.click(within(data).getByRole('button', { name: 'Nearby charging' }))
    expect(await within(data).findByRole('alert')).toHaveTextContent('Synthetic rejected action')
    expect(within(data).getByText('TEST-A')).toBeInTheDocument()
  })

  it('keeps retained query fields after a rejected refresh', async () => {
    const client = mount()
    const config = await card('Config')
    requestMock.mockImplementation(async () => { throw new Error('Synthetic refresh failed') })
    await act(async () => { await client.invalidateQueries({ queryKey: ['devtools', 'fleet-api-info'] }) })
    expect(within(config).getByText(fleetInfo.base_url)).toBeInTheDocument()
    expect(within(config).getByText(/Synthetic refresh failed/)).toBeInTheDocument()
  })

  it('uses the actual rejection/live-only helper seam and does not pause a write offline', async () => {
    handler = (_path, options) => {
      if (options?.requiresLiveMode) throw new Error('Synthetic offline write rejected')
      return {}
    }
    mount()
    const key = await card('Public key')
    onlineManager.setOnline(false)
    fireEvent.click(within(key).getByRole('button', { name: 'Generate keypair' }))
    expect(await within(key).findByRole('alert')).toHaveTextContent('Synthetic offline write rejected')
    expect(calls('/dev-tools/generate-keypair')).toHaveLength(1)
    onlineManager.setOnline(true)
    expect(calls('/dev-tools/generate-keypair')).toHaveLength(1)
  })

  it('requires scope-aware key replacement/deletion confirmation and cancellation sends nothing', async () => {
    keyStatus = { ...keyStatus, configured: true, fingerprint: 'SYNTHETIC-FINGERPRINT' }
    mount()
    const key = await card('Public key')
    fireEvent.click(within(key).getByRole('button', { name: 'Generate keypair' }))
    let dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Replace the configured public key for this TeslaSync installation')
    expect(dialog).toHaveTextContent('SYNTHETIC-FINGERPRINT')
    expect(calls('/dev-tools/generate-keypair')).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(key).getByRole('button', { name: 'Delete keypair' }))
    dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Delete the configured public key')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls('/dev-tools/public-key')).toHaveLength(1))
    expect(calls('/dev-tools/public-key')[0][1]).toMatchObject({ method: 'DELETE', requiresLiveMode: true })
  })

  it('confirms telemetry deletion against the captured selected vehicle', async () => {
    mount()
    const config = await card('Telemetry config')
    select(config, 'TEST-A')
    fireEvent.click(within(config).getByRole('button', { name: 'Delete config' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('TEST-A')
    expect(calls('/dev-tools/fleet-telemetry-config?vin=TEST-A')).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls('/dev-tools/fleet-telemetry-config?vin=TEST-A')).toHaveLength(1))
    expect(calls('/dev-tools/fleet-telemetry-config?vin=TEST-A')[0][1]?.method).toBe('DELETE')
  })

  it('validates selection and exact port integers while preserving server defaults and CA naming', async () => {
    mount()
    const sub = await card('Telemetry sub')
    const subscribe = within(sub).getByRole('button', { name: 'Subscribe' })
    expect(subscribe).toBeDisabled()
    expect(within(sub).getByRole('textbox', { name: 'CA cert' })).toBeInTheDocument()
    const vehicleData = await card('Vehicle data')
    for (const name of ['Nearby charging', 'Release notes', 'Recent alerts', 'Service data']) {
      expect(within(vehicleData).getByRole('button', { name })).toBeDisabled()
    }
    select(sub, 'TEST-A')
    const port = within(sub).getByRole('textbox', { name: 'Port' })
    for (const invalid of ['443junk', '1.5', '-1', '65536']) {
      fireEvent.change(port, { target: { value: invalid } })
      expect(subscribe).toBeDisabled()
      expect(port).toHaveAttribute('aria-invalid', 'true')
    }
    fireEvent.change(port, { target: { value: '' } })
    expect(subscribe).toBeEnabled()
    fireEvent.click(subscribe)
    await waitFor(() => expect(calls('/dev-tools/fleet-telemetry-subscribe')).toHaveLength(1))
    expect(JSON.parse(String(calls('/dev-tools/fleet-telemetry-subscribe')[0][1]?.body))).toMatchObject({
      vins: ['TEST-A'], hostname: '', port: 0, interval_seconds: 30,
    })
  })

  it('retire completed and in-flight telemetry responses on vehicle selection changes', async () => {
    const pending = deferred()
    handler = (path) => path.includes('fleet-telemetry-errors') ? pending.promise : {}
    mount()
    const config = await card('Telemetry config')
    select(config, 'TEST-A')
    fireEvent.click(within(config).getByRole('button', { name: 'View errors' }))
    await waitFor(() => expect(calls('/dev-tools/fleet-telemetry-errors?vin=TEST-A')).toHaveLength(1))
    select(config, 'TEST-B')
    await act(async () => { pending.resolve({ errors: [{ message: 'Old A error' }] }) })
    expect(within(config).queryByText('Old A error')).not.toBeInTheDocument()
    expect(within(config).queryByRole('button', { name: 'Download errors' })).not.toBeInTheDocument()
    expect(within(config).getByText(/Click View Errors/)).toBeInTheDocument()
  })

  it('exports errors using the submitted identity and retires the loaded export on reselection', async () => {
    handler = (path) => path.includes('fleet-telemetry-errors') ? { errors: [{ message: 'A telemetry fault', code: 'TEST_FAULT' }] } : {}
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('telemetry-errors-TEST-A.json')
    })
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:synthetic'), revokeObjectURL: vi.fn() }))
    mount()
    const config = await card('Telemetry config')
    select(config, 'TEST-A')
    fireEvent.click(within(config).getByRole('button', { name: 'View errors' }))
    fireEvent.click(await within(config).findByRole('button', { name: 'Download errors' }))
    expect(download).toHaveBeenCalledOnce()
    select(config, 'TEST-B')
    expect(within(config).queryByRole('button', { name: 'Download errors' })).not.toBeInTheDocument()
    expect(within(config).queryByText('A telemetry fault')).not.toBeInTheDocument()
  })

  it('distinguishes unknown telemetry error shape, rejected requests, and authoritative zero', async () => {
    handler = () => ({ unrecognized: true })
    mount()
    const config = await card('Telemetry config')
    select(config, 'TEST-A')
    const view = within(config).getByRole('button', { name: 'View errors' })
    fireEvent.click(view)
    expect(await within(config).findByText(/error status is unknown/)).toBeInTheDocument()
    expect(within(config).queryByText(/No Fleet Telemetry errors reported/)).not.toBeInTheDocument()
    expect(within(config).getByText('Show raw Tesla response')).toBeInTheDocument()
    handler = () => { throw new Error('Synthetic errors failed') }
    fireEvent.click(view)
    expect(await within(config).findByText('Synthetic errors failed')).toBeInTheDocument()
    handler = () => ({ errors: [] })
    fireEvent.click(view)
    expect(await within(config).findByText('No Fleet Telemetry errors reported for this vehicle.')).toBeInTheDocument()
    expect(within(config).getByText('0')).toBeInTheDocument()
  })

  it('labels the selected action and retires old vehicle-data completions after reselection', async () => {
    const pending = deferred()
    handler = (path) => path.includes('nearby-charging') ? pending.promise : { marker: 'B_NOTES' }
    mount()
    const data = await card('Vehicle data')
    select(data, 'TEST-A')
    fireEvent.click(within(data).getByRole('button', { name: 'Nearby charging' }))
    await waitFor(() => expect(calls('/dev-tools/nearby-charging?vin=TEST-A')).toHaveLength(1))
    select(data, 'TEST-B')
    fireEvent.click(within(data).getByRole('button', { name: 'Release notes' }))
    expect(await within(data).findByText(/B_NOTES/)).toBeInTheDocument()
    await act(async () => { pending.resolve({ marker: 'A_CHARGERS' }) })
    expect(within(data).queryByText(/A_CHARGERS/)).not.toBeInTheDocument()
    expect(within(data).getByText('TEST-B')).toBeInTheDocument()
    expect(within(data).getAllByText('Release notes')).toHaveLength(2)
  })

  it('localizes onboarding labels, descriptions and accessible step names', async () => {
    mount()
    expect(await screen.findByRole('button', { name: 'Go to step 1: Translated: Tesla developer account' })).toBeInTheDocument()
    expect(screen.getByText('Translated: Create a Tesla Developer account at developer.tesla.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Go to step 2: Translated: Create application' }))
    expect(screen.getByText('Translated: Register a new application in the Tesla Developer Portal')).toBeInTheDocument()
  })
})
