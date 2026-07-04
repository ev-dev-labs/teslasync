/**
 * FleetApiSection contract tests.
 *
 * FleetApiSection is the single export of this module; it composes an
 * onboarding wizard plus nine self-contained Fleet API tools. Each tool
 * fetches/mutates through the shared `apiFetch` helper (which wraps the
 * mocked `request()` client and, crucially, *swallows* failures into a
 * `{ error }` payload instead of rejecting). These tests drive the whole
 * section end-to-end against a routed `request()` mock so every branch a
 * user can reach is exercised:
 *
 *   - Section scaffolding: both headers + all nine tool cards + wizard.
 *   - FleetApiConfigTool: data / not-authenticated / loading / API-error.
 *   - PartnerRegistrationTool: POST body + result panel.
 *   - PartnerPublicKeyTool: disabled-until-domain, verify, key registered /
 *     not-found / local-mismatch branches, PEM rendering.
 *   - PublicKeySetupTool: configured vs not, generate keypair, API-error.
 *   - VehicleKeyPairingTool: pairing URL derived from the fleet hostname.
 *   - FleetTelemetrySubscribeTool: subscribe POST body + signal modal.
 *   - FleetTelemetryConfigTool: gated buttons + the four TelemetryErrorsPanel
 *     states (rows / healthy-empty / unknown-shape / upstream-error).
 *   - FleetStatusTool: enabled/disabled + POST body of every VIN.
 *   - VehicleDataTools: the "latest action wins" fix — a second action's
 *     result must replace the first, not be swallowed by `a ?? b ?? …`.
 *   - OnboardingWorkflow: auto-detect + persistence, step navigation,
 *     keyboard-operable step chips, and swallowed-error surfacing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
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
        const interpolate = (s: string) =>
          opts
            ? Object.keys(opts).reduce(
                (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
                s,
              )
            : s
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue)
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { FleetApiSection } from './FleetApiSection'
import type { Vehicle } from '@/api/types'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

const PENDING = Symbol('pending')
const REJECT = Symbol('reject')

function makeVehicle(vin: string, display_name: string): Vehicle {
  return {
    id: vin.length,
    vehicle_id: vin.length,
    vin,
    display_name,
    model: 'model3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

type MatchFn = (path: string, init?: RequestInit) => unknown

interface RouteConfig {
  vehicles?: unknown
  fleetInfo?: unknown
  publicKeyStatus?: unknown
  match?: MatchFn
}

function install(cfg: RouteConfig = {}) {
  const {
    vehicles = [makeVehicle('VIN1', 'Car One'), makeVehicle('VIN2', 'Car Two')],
    fleetInfo = {
      baseUrl: 'https://fleet.tesla.example',
      clientId: 'cid-123',
      authenticated: true,
      regions: ['na', 'eu'],
      hostname: 'app.example.com',
    },
    publicKeyStatus = {
      configured: true,
      fingerprint: 'AA:BB:CC:DD',
      wellKnownUrl: 'https://app.example.com/.well-known/pub.pem',
    },
    match,
  } = cfg

  const resolve = (v: unknown): Promise<unknown> => {
    if (v === PENDING) return new Promise<never>(() => {})
    if (v === REJECT) return Promise.reject(new Error('boom'))
    return Promise.resolve(v)
  }

  mockedRequest.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/vehicles') return resolve(vehicles)
    if (path === '/dev-tools/fleet-api-info') return resolve(fleetInfo)
    if (path === '/dev-tools/public-key-status') return resolve(publicKeyStatus)
    if (match) {
      const r = match(path, init)
      if (r !== undefined) return Promise.resolve(r)
    }
    return Promise.resolve({})
  })
}

let mounted = false

function renderSection() {
  mounted = true
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <FleetApiSection />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

async function findToolCard(title: string): Promise<HTMLElement> {
  // Auto-mount so per-tool tests can `install(...)` then jump straight to the
  // card they care about; screen-level tests call renderSection() explicitly.
  if (!mounted) renderSection()
  const heading = await screen.findByRole('heading', { level: 3, name: title })
  const card = heading.closest('[data-print-card]')
  if (!card) throw new Error(`no tool card container found for "${title}"`)
  return card as HTMLElement
}

/** Read the JSON body of the most-recent request() call to `path`. */
function callBody(path: string): unknown {
  const call = [...mockedRequest.mock.calls].reverse().find((c) => c[0] === path)
  if (!call) throw new Error(`request() was never called with ${path}`)
  const init = call[1] as RequestInit | undefined
  return init?.body ? JSON.parse(String(init.body)) : undefined
}

/** Wait for a card's vehicle <select> to be populated, then pick a VIN. */
async function selectVehicle(card: HTMLElement, optionLabel: string, vin: string) {
  await within(card).findByRole('option', { name: optionLabel })
  fireEvent.change(within(card).getByRole('combobox'), { target: { value: vin } })
}

beforeEach(() => {
  mockedRequest.mockReset()
  localStorage.clear()
  mounted = false
})

describe('FleetApiSection — scaffolding', () => {
  it('renders both section headers and every Fleet API tool card', async () => {
    install()
    renderSection()

    // Sync on a query-gated card so the mount fetches have resolved.
    await findToolCard('Config')

    expect(screen.getByRole('heading', { name: 'Setup Wizard' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Fleet API Tools' })).toBeInTheDocument()

    const toolTitles = [
      'Config',
      'Partner Reg',
      'Public Key Verification',
      'Public Key',
      'Key Pairing',
      'Telemetry Sub',
      'Telemetry Config',
      'Fleet Status',
      'Vehicle Data',
    ]
    for (const title of toolTitles) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeInTheDocument()
    }
  })
})

describe('FleetApiConfigTool', () => {
  it('renders config values, the authenticated badge and region chips', async () => {
    install()
    const card = await findToolCard('Config')

    expect(within(card).getByText('https://fleet.tesla.example')).toBeInTheDocument()
    expect(within(card).getByText('cid-123')).toBeInTheDocument()
    expect(within(card).getByText('Authenticated')).toBeInTheDocument()
    expect(within(card).getByText('na')).toBeInTheDocument()
    expect(within(card).getByText('eu')).toBeInTheDocument()
  })

  it('shows the not-authenticated badge and an em dash when regions are empty', async () => {
    install({ fleetInfo: { authenticated: false, regions: [] } })
    const card = await findToolCard('Config')

    expect(within(card).getByText('Not Authenticated')).toBeInTheDocument()
    // baseUrl, clientId and regions all fall back to the em-dash placeholder.
    expect(within(card).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('renders a skeleton (no Config heading) while the info query is loading', async () => {
    install({ fleetInfo: PENDING })
    renderSection()

    // A non-gated tool still mounts, proving the section rendered…
    expect(await screen.findByRole('heading', { level: 3, name: 'Fleet Status' })).toBeInTheDocument()
    // …but the config card is still in its loading branch.
    expect(screen.queryByRole('heading', { level: 3, name: 'Config' })).toBeNull()
  })

  it('surfaces a swallowed apiFetch error instead of rendering blank fields', async () => {
    install({ fleetInfo: { error: 'fleet info upstream 503' } })
    renderSection()

    expect((await screen.findAllByText(/fleet info upstream 503/)).length).toBeGreaterThan(0)
    // The tool renders the alert *instead* of its ToolCard.
    expect(screen.queryByRole('heading', { level: 3, name: 'Config' })).toBeNull()
  })
})

describe('PartnerRegistrationTool', () => {
  it('registers the entered domain and shows the result', async () => {
    install({
      match: (path, init) =>
        path === '/dev-tools/register-partner' && init?.method === 'POST'
          ? { ok: true, marker: 'REG_OK' }
          : undefined,
    })
    const card = await findToolCard('Partner Reg')

    fireEvent.change(within(card).getByRole('textbox'), {
      target: { value: 'reg.example.com' },
    })
    fireEvent.click(within(card).getByRole('button', { name: 'Register' }))

    expect(await within(card).findByText(/REG_OK/)).toBeInTheDocument()
    expect(callBody('/dev-tools/register-partner')).toEqual({ domain: 'reg.example.com' })
  })
})

describe('PartnerPublicKeyTool', () => {
  it('is disabled until a domain is entered, then verifies a registered + matching key', async () => {
    install({
      match: (path) =>
        path.startsWith('/dev-tools/partner-public-key')
          ? {
              verification: {
                remote_key_found: true,
                matches_local: true,
                local_key_configured: true,
              },
              response: { public_key: 'PEM-CONTENT-BLOCK' },
            }
          : undefined,
    })
    const card = await findToolCard('Public Key Verification')

    const verifyBtn = within(card).getByRole('button', { name: 'Verify' })
    expect(verifyBtn).toBeDisabled()

    fireEvent.change(within(card).getByRole('textbox'), {
      target: { value: 'myapp.example.com' },
    })
    expect(verifyBtn).toBeEnabled()

    fireEvent.click(verifyBtn)

    expect(await within(card).findByText('Key Registered')).toBeInTheDocument()
    expect(within(card).getByText('Matches Local Key')).toBeInTheDocument()
    expect(within(card).getByText('PEM-CONTENT-BLOCK')).toBeInTheDocument()
    expect(mockedRequest).toHaveBeenCalledWith(
      '/dev-tools/partner-public-key?domain=myapp.example.com',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('flags a remote key that does not match the local key', async () => {
    install({
      match: (path) =>
        path.startsWith('/dev-tools/partner-public-key')
          ? {
              verification: {
                remote_key_found: true,
                matches_local: false,
                local_key_configured: true,
              },
              response: {},
            }
          : undefined,
    })
    const card = await findToolCard('Public Key Verification')

    fireEvent.change(within(card).getByRole('textbox'), {
      target: { value: 'mismatch.example.com' },
    })
    fireEvent.click(within(card).getByRole('button', { name: 'Verify' }))

    expect(await within(card).findByText('Does Not Match Local Key')).toBeInTheDocument()
  })

  it('flags when no key is registered with Tesla', async () => {
    install({
      match: (path) =>
        path.startsWith('/dev-tools/partner-public-key')
          ? { verification: { remote_key_found: false }, response: {} }
          : undefined,
    })
    const card = await findToolCard('Public Key Verification')

    fireEvent.change(within(card).getByRole('textbox'), {
      target: { value: 'none.example.com' },
    })
    fireEvent.click(within(card).getByRole('button', { name: 'Verify' }))

    expect(await within(card).findByText('Key Not Found')).toBeInTheDocument()
  })
})

describe('PublicKeySetupTool', () => {
  it('renders the fingerprint, well-known URL and generates a keypair', async () => {
    install({
      publicKeyStatus: {
        configured: true,
        fingerprint: 'AB:CD:EF:99',
        wellKnownUrl: 'https://app.example.com/.well-known/pub.pem',
      },
      match: (path, init) =>
        path === '/dev-tools/generate-keypair' && init?.method === 'POST'
          ? { ok: true, generated: true }
          : undefined,
    })
    const card = await findToolCard('Public Key')

    expect(within(card).getByText('AB:CD:EF:99')).toBeInTheDocument()
    expect(within(card).getByText('https://app.example.com/.well-known/pub.pem')).toBeInTheDocument()
    expect(within(card).getByText('Configured')).toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Generate Keypair' }))

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/dev-tools/generate-keypair',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('shows the not-configured badge when no keypair exists', async () => {
    install({ publicKeyStatus: { configured: false } })
    const card = await findToolCard('Public Key')

    expect(within(card).getByText('Not Configured')).toBeInTheDocument()
  })
})

describe('VehicleKeyPairingTool', () => {
  it('builds the pairing URL from the fleet hostname', async () => {
    install({ fleetInfo: { authenticated: true, hostname: 'myfleet.example.com' } })
    const card = await findToolCard('Key Pairing')

    expect(
      await within(card).findByText('https://tesla.com/_ak/myfleet.example.com'),
    ).toBeInTheDocument()
  })
})

describe('FleetTelemetrySubscribeTool', () => {
  it('subscribes with the selected VIN, hostname and default port', async () => {
    install({
      match: (path) => (path === '/dev-tools/fleet-telemetry-subscribe' ? { ok: true } : undefined),
    })
    const card = await findToolCard('Telemetry Sub')

    await selectVehicle(card, 'Car One', 'VIN1')
    fireEvent.change(within(card).getByPlaceholderText('telemetry.example.com'), {
      target: { value: 'telemetry.example.com' },
    })
    fireEvent.click(within(card).getByRole('button', { name: 'Subscribe' }))

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/dev-tools/fleet-telemetry-subscribe',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    expect(callBody('/dev-tools/fleet-telemetry-subscribe')).toMatchObject({
      vins: ['VIN1'],
      hostname: 'telemetry.example.com',
      port: 443,
    })
  })

  it('opens the signal configuration modal', async () => {
    install()
    const card = await findToolCard('Telemetry Sub')

    fireEvent.click(within(card).getByRole('button', { name: /Configure Signals/ }))

    expect(
      await screen.findByRole('dialog', { name: 'Fleet Telemetry Signal Configuration' }),
    ).toBeInTheDocument()
  })
})

describe('FleetTelemetryConfigTool', () => {
  it('gates the config button until a vehicle is chosen, then fetches config', async () => {
    install({
      match: (path) =>
        path.startsWith('/dev-tools/fleet-telemetry-config')
          ? { config: { fields: ['Soc'] }, marker: 'CFG_OK' }
          : undefined,
    })
    const card = await findToolCard('Telemetry Config')

    const getBtn = within(card).getByRole('button', { name: 'Get Config' })
    expect(getBtn).toBeDisabled()

    await selectVehicle(card, 'Car One', 'VIN1')
    expect(getBtn).toBeEnabled()

    fireEvent.click(getBtn)
    expect(await within(card).findByText(/CFG_OK/)).toBeInTheDocument()
  })

  it('renders a Fleet Telemetry errors table when Tesla returns errors', async () => {
    install({
      match: (path) =>
        path.startsWith('/dev-tools/fleet-telemetry-errors')
          ? {
              errors: [
                {
                  reported_at: '2026-01-01T00:00:00Z',
                  error_code: 'ERR_STREAM',
                  error_message: 'stream disconnected',
                },
              ],
            }
          : undefined,
    })
    const card = await findToolCard('Telemetry Config')

    await selectVehicle(card, 'Car One', 'VIN1')
    fireEvent.click(within(card).getByRole('button', { name: 'View Errors' }))

    expect(await within(card).findByText('ERR_STREAM')).toBeInTheDocument()
    expect(within(card).getByText('stream disconnected')).toBeInTheDocument()
  })

  it('shows a healthy empty state when there are zero telemetry errors', async () => {
    install({
      match: (path) =>
        path.startsWith('/dev-tools/fleet-telemetry-errors') ? { errors: [] } : undefined,
    })
    const card = await findToolCard('Telemetry Config')

    await selectVehicle(card, 'Car One', 'VIN1')
    fireEvent.click(within(card).getByRole('button', { name: 'View Errors' }))

    expect(
      await within(card).findByText(/No Fleet Telemetry errors reported/),
    ).toBeInTheDocument()
  })

  it('exposes the raw Tesla payload when the errors shape is unrecognised', async () => {
    install({
      match: (path) =>
        path.startsWith('/dev-tools/fleet-telemetry-errors') ? { unexpected: 'shape' } : undefined,
    })
    const card = await findToolCard('Telemetry Config')

    await selectVehicle(card, 'Car One', 'VIN1')
    fireEvent.click(within(card).getByRole('button', { name: 'View Errors' }))

    expect(await within(card).findByText(/Show raw Tesla response/)).toBeInTheDocument()
  })

  it('shows the upstream error when the errors request fails', async () => {
    install({
      match: (path) =>
        path.startsWith('/dev-tools/fleet-telemetry-errors')
          ? Promise.reject(new Error('errors upstream 500'))
          : undefined,
    })
    const card = await findToolCard('Telemetry Config')

    await selectVehicle(card, 'Car One', 'VIN1')
    fireEvent.click(within(card).getByRole('button', { name: 'View Errors' }))

    expect(await within(card).findByText('errors upstream 500')).toBeInTheDocument()
  })
})

describe('FleetStatusTool', () => {
  it('checks fleet status for every vehicle VIN', async () => {
    install({ match: (path) => (path === '/dev-tools/fleet-status' ? { ok: true } : undefined) })
    const card = await findToolCard('Fleet Status')

    const btn = within(card).getByRole('button', { name: 'Check Fleet Status' })
    await waitFor(() => expect(btn).toBeEnabled())
    fireEvent.click(btn)

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/dev-tools/fleet-status',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    expect(callBody('/dev-tools/fleet-status')).toEqual({ vins: ['VIN1', 'VIN2'] })
  })

  it('disables the fleet status action when there are no vehicles', async () => {
    install({ vehicles: [] })
    const card = await findToolCard('Fleet Status')

    expect(within(card).getByRole('button', { name: 'Check Fleet Status' })).toBeDisabled()
  })
})

describe('VehicleDataTools', () => {
  it('starts with an idle result panel before any action runs', async () => {
    install()
    const card = await findToolCard('Vehicle Data')

    expect(
      within(card).getByText('Choose a vehicle and an action to see results.'),
    ).toBeInTheDocument()
  })

  it('replaces the first action result with the most recent action (no stale ??-chain)', async () => {
    install({
      match: (path) => {
        if (path.startsWith('/dev-tools/nearby-charging')) return { marker: 'CHG_RESULT' }
        if (path.startsWith('/dev-tools/recent-alerts')) return { marker: 'ALERT_RESULT' }
        return undefined
      },
    })
    const card = await findToolCard('Vehicle Data')
    await selectVehicle(card, 'Car One', 'VIN1')

    fireEvent.click(within(card).getByRole('button', { name: 'Nearby Charging' }))
    expect(await within(card).findByText(/CHG_RESULT/)).toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Recent Alerts' }))
    expect(await within(card).findByText(/ALERT_RESULT/)).toBeInTheDocument()
    // The regression: the charging result must no longer be displayed.
    expect(within(card).queryByText(/CHG_RESULT/)).toBeNull()
  })
})

describe('OnboardingWorkflow', () => {
  it('auto-detects completed steps from key + auth status and persists them', async () => {
    install({
      publicKeyStatus: { configured: true },
      fleetInfo: { authenticated: true, hostname: 'app.example.com' },
    })
    renderSection()

    expect(await screen.findByText(/2 \/ 7/)).toBeInTheDocument()
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('devtools-onboarding') ?? '{}')).toMatchObject({
        keypair: true,
        auth: true,
      }),
    )
  })

  it('marks the current step complete and advances the wizard', async () => {
    install({
      publicKeyStatus: { configured: false },
      fleetInfo: { authenticated: false, hostname: 'app.example.com' },
    })
    renderSection()

    expect(
      await screen.findByRole('heading', { level: 3, name: /Step 1: Tesla Developer Account/ }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mark Complete' }))

    expect(
      await screen.findByRole('heading', { level: 3, name: /Step 2: Create Application/ }),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 \/ 7/)).toBeInTheDocument()
  })

  it('lets keyboard users jump to a step via the step chips', async () => {
    install({
      publicKeyStatus: { configured: false },
      fleetInfo: { authenticated: false, hostname: 'app.example.com' },
    })
    renderSection()

    const chip = await screen.findByRole('button', { name: /Go to step 3: Generate Key Pair/ })
    chip.focus()
    fireEvent.keyDown(chip, { key: 'Enter' })

    expect(
      await screen.findByRole('heading', { level: 3, name: /Step 3: Generate Key Pair/ }),
    ).toBeInTheDocument()
  })

  it('surfaces a swallowed status error in the wizard banner', async () => {
    install({ publicKeyStatus: { error: 'key status upstream 500' } })
    renderSection()

    expect((await screen.findAllByText(/key status upstream 500/)).length).toBeGreaterThan(0)
  })
})
