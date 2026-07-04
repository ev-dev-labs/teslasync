/**
 * VehicleDetailPage — orchestration, derivation, branch + failure coverage.
 *
 * VehicleDetailPage is a thin orchestrator: it fans ten `useQuery` reads and a
 * wake `useMutation` out into 14 presentational sections + a settings tab + the
 * Helix paint preview. The surface under test here is the page's OWN behaviour:
 *
 *   1. Loading short-circuit → the full-page skeleton while the vehicle record
 *      is still pending (no sections leak through early).
 *   2. Happy path → every section + settings + AI preview mounts, and the page's
 *      derived props are wired correctly: the nickname-override title, the
 *      model+trim subtitle, the `deriveStatus(state)` result ('charging'), the
 *      `software_version` pass-through, and the drives/sessions/motor fan-out.
 *   3. Nickname fallback → with no override row the title falls back to
 *      `vehicles.display_name`.
 *   4. Wake success → POST /vehicles/{id}/wake fires and a success toast shows.
 *   5. Wake failure → the error message is surfaced via an error toast.
 *   6. Live-state failure (the regression this file also fixes) → a failed
 *      `/state` read renders <QueryError> with a working Retry instead of an
 *      infinite skeleton, and the state-gated sections stay unmounted.
 *   7. Invalid route id → every query is disabled (no network), title falls back.
 *
 * Strategy (mirrors web/src/features/driving/pages/DrivetrainHealthPage.test.tsx):
 *   - `request` from @/api/client is mocked with a hoisted URL-router so the
 *     network is never touched; the REAL ApiError / isApiError are kept (via
 *     importActual) so <QueryError>'s status branching runs for real.
 *   - useVehicleSettings is mocked, but the REAL `findEffectiveSetting` runs so
 *     the nickname derivation is genuinely exercised.
 *   - useToast + useLiveConnection are stubbed (no provider / no SSE singleton).
 *   - The 14 sections + settings tab + paint preview are stubbed so orchestration
 *     assertions capture the exact props the page computed. PageContainer,
 *     GlassPanel, FadeIn, SectionErrorBoundary, QueryError, Skeleton and the real
 *     `deriveStatus` helper all render/run for real.
 *   - react-i18next resolves the developer fallback string, interpolating vars.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * page tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'

// jsdom lacks matchMedia; framer-motion (<FadeIn>) reads it at module load for
// the reduced-motion preference. Install a no-op before any import runs.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false
      },
    })) as unknown as typeof window.matchMedia
  }
})

// Shared, hoisted test doubles reachable from both the mock factories and specs.
const H = vi.hoisted(() => {
  const tImpl = (key: string, second?: unknown, third?: unknown): string => {
    const template = typeof second === 'string' ? second : key
    const vars =
      third && typeof third === 'object'
        ? (third as Record<string, unknown>)
        : second && typeof second === 'object'
          ? (second as Record<string, unknown>)
          : undefined
    if (!vars) return template
    return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
      name in vars ? String(vars[name]) : `{{${name}}}`,
    )
  }
  return {
    tImpl,
    requestMock: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    settingsRef: { current: undefined as unknown },
    liveState: {
      status: 'connected' as const,
      lastMessageAt: '2024-01-01T00:00:00.000Z',
      channels: { sse: 'open' as const },
    },
    captured: {} as Record<string, Record<string, unknown>>,
  }
})

// i18n → return the developer fallback string, interpolating `{{vars}}`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: H.tImpl,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// Network: keep the real ApiError / isApiError, route `request` through the mock.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: (...args: unknown[]) => H.requestMock(...args) }
})

// Per-vehicle settings hook is mocked; the REAL findEffectiveSetting runs.
vi.mock('@/api/hooks/useVehicleSettings', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useVehicleSettings')>(
      '@/api/hooks/useVehicleSettings',
    )
  return { ...actual, useVehicleSettings: () => ({ data: H.settingsRef.current }) }
})

vi.mock('@/components/feedback/Toast', async () => {
  const actual =
    await vi.importActual<typeof import('@/components/feedback/Toast')>(
      '@/components/feedback/Toast',
    )
  return {
    ...actual,
    useToast: () => ({ success: H.toastSuccess, error: H.toastError }),
  }
})

vi.mock('@/hooks/useLiveConnection', () => ({ useLiveConnection: () => H.liveState }))

// Stub the 14 sections so we can capture the exact props the page computed.
// VehicleHeader is a clickable button so the wake path can be driven.
vi.mock('../components/vehicle-detail', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const stub = (key: string, testid: string) =>
    function Stub(props: Record<string, unknown>) {
      H.captured[key] = props
      return React.createElement('div', { 'data-testid': testid })
    }
  return {
    VehicleHeader: function VehicleHeaderStub(props: Record<string, unknown>) {
      H.captured.VehicleHeader = props
      return React.createElement(
        'button',
        {
          'data-testid': 'wake-btn',
          'data-waking': String(props.waking),
          onClick: props.onWake as () => void,
        },
        'wake',
      )
    },
    BatteryRangePanel: stub('BatteryRangePanel', 'sec-battery-range-panel'),
    LiveStateIndicators: stub('LiveStateIndicators', 'sec-live-state'),
    QuickStatsGrid: stub('QuickStatsGrid', 'sec-quick-stats'),
    MotorSection: stub('MotorSection', 'sec-motor'),
    ClimateSection: stub('ClimateSection', 'sec-climate'),
    SecuritySection: stub('SecuritySection', 'sec-security'),
    TirePressureSection: stub('TirePressureSection', 'sec-tire'),
    ChargingTelemetrySection: stub('ChargingTelemetrySection', 'sec-charging-telem'),
    BatteryRangeCharts: stub('BatteryRangeCharts', 'sec-battery-charts'),
    RecentDrivesSection: stub('RecentDrivesSection', 'sec-recent-drives'),
    RecentChargesSection: stub('RecentChargesSection', 'sec-recent-charges'),
    VehicleConfigSection: stub('VehicleConfigSection', 'sec-vehicle-config'),
    QuickLinksSection: stub('QuickLinksSection', 'sec-quick-links'),
  }
})

vi.mock('../components/VehicleSettingsTab', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    default: function VehicleSettingsTabStub(props: Record<string, unknown>) {
      H.captured.VehicleSettingsTab = props
      return React.createElement('div', { 'data-testid': 'sec-settings' })
    },
  }
})

vi.mock('@/components/ai/AIVehiclePaintPreview', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    AIVehiclePaintPreview: function PaintPreviewStub(props: Record<string, unknown>) {
      H.captured.AIVehiclePaintPreview = props
      return React.createElement('div', { 'data-testid': 'sec-ai-paint' })
    },
  }
})

import { ApiError } from '@/api/client'
import VehicleDetailPage from './VehicleDetailPage'

/* ── Fixtures ─────────────────────────────────────────────────────── */

const VEHICLE = {
  id: 1,
  vehicle_id: 1,
  vin: '5YJ3E1EA0KF000001',
  display_name: 'Model 3',
  model: 'Model 3',
  trim_badging: 'Performance',
  exterior_color: 'red',
  wheel_type: 'stiletto',
  state: 'online',
  healthy: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const STATE = {
  vehicle_id: 1,
  state: 'online',
  latitude: 0,
  longitude: 0,
  speed: 0,
  power: 0,
  battery_level: 72,
  rated_range: 300,
  ideal_range: 320,
  odometer: 12345,
  inside_temp: 21,
  outside_temp: 15,
  is_climate_on: false,
  is_charging: true,
  charger_power: 11,
  charge_rate: 30,
  time_to_full_charge: 1.5,
  is_locked: true,
  sentry_mode: false,
  software_version: '2024.20.1',
}

const STATE_RESPONSE = { state: STATE, live: true }
const MOTOR = { ts: 'm', created_at: 'm', motor_temp_c_front: 40 }
const CLIMATE = { ts: 'c', inside_temp: 21 }
const SECURITY = { ts: 's', is_locked: true }
const TIRE = { vehicle_id: 1, front_left: 250000 }
const CHARGING_TELEM = { ts: 'ct', charger_power: 11 }
const DRIVES = [{ id: 1 }, { id: 2 }]
const SESSIONS = [{ id: 9 }]
const CONFIG = { id: 1, vehicle_id: 1, car_type: 'model3', created_at: 'x' }

function defaultRequest(path: string, _options?: unknown): Promise<unknown> {
  if (path === '/vehicles/1/wake') return Promise.resolve({ status: 'ok' })
  if (path === '/vehicles/1') return Promise.resolve(VEHICLE)
  if (path === '/vehicles/1/state') return Promise.resolve(STATE_RESPONSE)
  if (path.startsWith('/motor/latest')) return Promise.resolve(MOTOR)
  if (path.startsWith('/climate/latest')) return Promise.resolve(CLIMATE)
  if (path.startsWith('/security/latest')) return Promise.resolve(SECURITY)
  if (path.startsWith('/tire-pressure/latest')) return Promise.resolve(TIRE)
  if (path.startsWith('/charging-telemetry/latest')) return Promise.resolve(CHARGING_TELEM)
  if (path.startsWith('/drives')) return Promise.resolve(DRIVES)
  if (path.startsWith('/charging')) return Promise.resolve(SESSIONS)
  if (path.startsWith('/vehicle-config/latest')) return Promise.resolve(CONFIG)
  return Promise.resolve(null)
}

function renderPage(route = '/vehicles/1') {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const ALL_SECTION_IDS = [
  'sec-battery-range-panel',
  'sec-live-state',
  'sec-quick-stats',
  'sec-motor',
  'sec-climate',
  'sec-security',
  'sec-tire',
  'sec-charging-telem',
  'sec-battery-charts',
  'sec-recent-drives',
  'sec-recent-charges',
  'sec-vehicle-config',
  'sec-quick-links',
  'sec-settings',
  'sec-ai-paint',
]

beforeEach(() => {
  H.requestMock.mockReset()
  H.toastSuccess.mockReset()
  H.toastError.mockReset()
  H.captured = {}
  // Default: a nickname override is present so the title-override path runs.
  H.settingsRef.current = {
    settings: [{ key: 'nickname', value: 'My Roadster', source: 'override' }],
  }
  H.requestMock.mockImplementation(defaultRequest)
})

/* ── Specs ────────────────────────────────────────────────────────── */

describe('VehicleDetailPage', () => {
  it('renders the full-page skeleton while the vehicle record is pending', async () => {
    H.requestMock.mockImplementation((path: string) => {
      if (path === '/vehicles/1') return new Promise<never>(() => {})
      return defaultRequest(path)
    })

    renderPage()

    expect(await screen.findByTestId('vehicle-detail-skeleton')).toBeInTheDocument()
    // No live sections should leak through while the record loads.
    expect(screen.queryByTestId('sec-battery-range-panel')).not.toBeInTheDocument()
  })

  it('mounts every section and wires the derived props once state resolves', async () => {
    renderPage()

    // Title uses the nickname override; subtitle uses model + trim badging.
    expect(await screen.findByRole('heading', { name: 'My Roadster' })).toBeInTheDocument()
    expect(screen.getByText('Model 3 Performance')).toBeInTheDocument()

    // Every section + the settings tab + the paint preview must mount — no
    // gutted / hidden panels.
    for (const id of ALL_SECTION_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }

    // deriveStatus(state): is_charging === true → 'charging'.
    expect(H.captured.QuickStatsGrid?.status).toBe('charging')
    expect(H.captured.VehicleHeader?.status).toBe('charging')

    // Live objects flow through by reference; software_version passes through.
    expect(H.captured.BatteryRangePanel?.state).toBe(STATE)
    expect(H.captured.VehicleConfigSection?.softwareVersion).toBe('2024.20.1')
    expect(H.captured.MotorSection?.motorData).toBe(MOTOR)
    expect(H.captured.RecentDrivesSection?.drives).toBe(DRIVES)
    expect(H.captured.RecentChargesSection?.sessions).toBe(SESSIONS)

    // Both vehicle-scoped children get the numeric id parsed from the route.
    expect(H.captured.VehicleSettingsTab?.vehicleId).toBe(1)
    expect(H.captured.AIVehiclePaintPreview?.vehicleId).toBe(1)
  })

  it('falls back to the display name when no nickname override exists', async () => {
    H.settingsRef.current = { settings: [] }

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Model 3' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'My Roadster' })).not.toBeInTheDocument()
  })

  it('sends the wake command and shows a success toast', async () => {
    renderPage()

    const btn = await screen.findByTestId('wake-btn')
    expect(btn).toHaveAttribute('data-waking', 'false')

    fireEvent.click(btn)

    await waitFor(() => expect(H.toastSuccess).toHaveBeenCalledTimes(1))
    expect(H.requestMock).toHaveBeenCalledWith('/vehicles/1/wake', { method: 'POST' })
    expect(H.toastError).not.toHaveBeenCalled()
  })

  it('surfaces the error message via a toast when the wake command fails', async () => {
    H.requestMock.mockImplementation((path: string, options?: unknown) => {
      if (path === '/vehicles/1/wake') return Promise.reject(new Error('boom'))
      return defaultRequest(path, options)
    })

    renderPage()

    fireEvent.click(await screen.findByTestId('wake-btn'))

    await waitFor(() => expect(H.toastError).toHaveBeenCalledTimes(1))
    expect(H.toastError).toHaveBeenCalledWith('boom')
    expect(H.toastSuccess).not.toHaveBeenCalled()
  })

  it('shows an error with a working Retry when the live-state read fails', async () => {
    H.requestMock.mockImplementation((path: string, options?: unknown) => {
      if (path === '/vehicles/1/state') return Promise.reject(new ApiError('Server error', 500))
      return defaultRequest(path, options)
    })

    renderPage()

    // The header still renders (wake button present) but the state-gated
    // sections must NOT — the failed read renders <QueryError>, not a skeleton
    // that hangs forever.
    expect(await screen.findByTestId('wake-btn')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Server error')).toBeInTheDocument())
    expect(screen.queryByTestId('sec-battery-range-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sec-quick-stats')).not.toBeInTheDocument()

    // Retry re-issues the /state read.
    const stateCalls = () =>
      H.requestMock.mock.calls.filter((c) => c[0] === '/vehicles/1/state').length
    const before = stateCalls()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(stateCalls()).toBeGreaterThan(before))
  })

  it('disables every query when the route id is not a positive number', async () => {
    H.settingsRef.current = { settings: [] }

    renderPage('/vehicles/not-a-number')

    // Title falls back and no vehicle-scoped fetch fires.
    expect(await screen.findByRole('heading', { name: 'Vehicle Detail' })).toBeInTheDocument()
    expect(H.requestMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('sec-battery-range-panel')).not.toBeInTheDocument()
  })
})
