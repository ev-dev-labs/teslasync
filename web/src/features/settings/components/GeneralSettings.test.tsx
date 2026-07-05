/**
 * GeneralSettings contract.
 *
 * The panel is the "Application" units / language / cost surface. It reads the
 * server snapshot via `useSettings()`, hydrates a `useFormDraft`-backed form,
 * offers a "Sync from Car" affordance driven by `useCarPreferences()`, and
 * persists edits via `useSaveSettings()` (PUT /settings). These tests pin the
 * behaviour that matters:
 *
 *   1. Loading      — skeletons render while the settings query is pending;
 *                     the form fields only appear once data arrives.
 *   2. Rendering    — every unit/preference control is bound to the loaded
 *                     snapshot (distance, temp, pressure, currency, ...).
 *   3. Precision    — the live "Preview" reflects the stored precision AND,
 *                     crucially, an out-of-`toFixed`-range value (e.g. 150,
 *                     which would throw a RangeError) is clamped instead of
 *                     crashing the panel. The input itself clamps edits to
 *                     [0, 20].
 *   4. Interaction  — changing a select updates the bound value.
 *   5. Save         — clicking Save issues PUT /settings with the current form
 *                     and shows the inline confirmation; a rejected save is
 *                     surfaced as an error without crashing or "confirming".
 *   6. Sync from Car— when the vehicle reports unit preferences the banner +
 *                     read-only clock format render, and "Sync from Car"
 *                     writes the translated units back through PUT /settings.
 *   7. Draft        — a restored localStorage draft wins over the server
 *                     snapshot, surfaces the recovery banner, and "Discard
 *                     draft" reverts the form to the server values.
 *
 * The shared `request` client is mocked and routed by path/method so the real
 * hook layer runs end-to-end without a network. `react-i18next` is stubbed to
 * return each call site's default string (with {{var}} interpolation).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { AppSettings } from '@/api/types'

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

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { GeneralSettings } from './GeneralSettings'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    preferred_range: 'rated',
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark',
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 3.5,
    gas_unit: 'gallon',
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant',
    currency_symbol: '$',
    locale: 'en-US',
    tz_display_default: 'vehicle',
    timezone_user: '',
    tab_badge_enabled: true,
    critical_flash_enabled: true,
    ui_density: 'comfortable',
    ...overrides,
  }
}

interface CarPrefs {
  setting_distance_unit?: string
  setting_temperature_unit?: string
  setting_tire_pressure_unit?: string
  setting_24hr_time?: boolean
}

const state: {
  settings: AppSettings
  vehicles: unknown[]
  carPrefs: CarPrefs | null
  failPut: boolean
  hangSettings: boolean
} = {
  settings: makeSettings(),
  vehicles: [],
  carPrefs: null,
  failPut: false,
  hangSettings: false,
}

const DRAFT_KEY = 'teslasync:draft:v1:settings:general'

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <GeneralSettings />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  state.settings = makeSettings()
  state.vehicles = []
  state.carPrefs = null
  state.failPut = false
  state.hangSettings = false

  mockedRequest.mockReset()
  mockedRequest.mockImplementation((path: string, opts?: { method?: string }) => {
    if (opts?.method === 'PUT') {
      return state.failPut
        ? Promise.reject(new Error('save failed'))
        : Promise.resolve(state.settings)
    }
    if (path === '/settings') {
      return state.hangSettings ? new Promise(() => {}) : Promise.resolve(state.settings)
    }
    if (path === '/vehicles') return Promise.resolve(state.vehicles)
    if (path.startsWith('/user-preferences/latest')) return Promise.resolve(state.carPrefs)
    return Promise.resolve({})
  })
})

describe('GeneralSettings — loading', () => {
  it('shows skeleton loaders and no form fields while settings are pending', () => {
    state.hangSettings = true
    renderPanel()

    // Header always renders; the Save button lives outside the loading branch.
    expect(screen.getByText('Application')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument()
    // Form fields are gated behind the loaded branch.
    expect(screen.queryByLabelText('Distance Unit')).toBeNull()
  })
})

describe('GeneralSettings — rendering', () => {
  it('binds every unit/preference control to the loaded snapshot', async () => {
    state.settings = makeSettings({
      unit_of_length: 'mi',
      unit_of_temp: 'F',
      unit_of_pressure: 'psi',
      currency_symbol: '€',
      locale: 'de-DE',
    })
    renderPanel()

    const distance = (await screen.findByLabelText('Distance Unit')) as HTMLSelectElement
    expect(distance.value).toBe('mi')
    expect((screen.getByLabelText('Temperature Unit') as HTMLSelectElement).value).toBe('F')
    expect((screen.getByLabelText('Pressure Unit') as HTMLSelectElement).value).toBe('psi')
    expect((screen.getByLabelText('Currency') as HTMLSelectElement).value).toBe('€')
    expect((screen.getByLabelText('Number & Date Locale') as HTMLSelectElement).value).toBe('de-DE')
    // The currency-aware cost field renders with its accessible label.
    expect(screen.getByLabelText('Electricity Cost (per kWh)')).toBeInTheDocument()
  })

  it('does not render the sync banner when the fleet reports no vehicles', async () => {
    renderPanel()
    await screen.findByLabelText('Distance Unit')
    expect(screen.queryByRole('button', { name: /sync from car/i })).toBeNull()
    expect(screen.queryByText(/Car uses/)).toBeNull()
  })
})

describe('GeneralSettings — decimal precision', () => {
  it('renders the live preview using the stored precision', async () => {
    state.settings = makeSettings({ decimal_precision: 3 })
    renderPanel()

    const input = (await screen.findByLabelText('Decimal Precision')) as HTMLInputElement
    expect(input.value).toBe('3')
    // (14.248539).toFixed(3) === '14.249'
    expect(screen.getByText(/14\.249/)).toBeInTheDocument()
  })

  it('clamps an out-of-toFixed-range precision instead of crashing (regression)', async () => {
    // 150 is outside toFixed's legal [0, 100] domain — the un-hardened
    // component threw a RangeError here and blanked the whole panel.
    state.settings = makeSettings({ decimal_precision: 150 })
    renderPanel()

    const input = (await screen.findByLabelText('Decimal Precision')) as HTMLInputElement
    expect(input.value).toBe('150')
    // Panel survived render and the clamped preview (toFixed(20)) is shown.
    expect(screen.getByText('Application')).toBeInTheDocument()
    expect(screen.getByText(/14\.2485/)).toBeInTheDocument()
  })

  it('updates the preview on edit and clamps typed values above 20', async () => {
    renderPanel()
    const input = (await screen.findByLabelText('Decimal Precision')) as HTMLInputElement
    // Default precision 2 → '14.25'.
    expect(screen.getByText(/14\.25/)).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '4' } })
    expect(input.value).toBe('4')
    expect(screen.getByText(/14\.2485/)).toBeInTheDocument()

    // Typing past the ceiling is clamped to 20.
    fireEvent.change(input, { target: { value: '99' } })
    expect(input.value).toBe('20')
  })
})

describe('GeneralSettings — interaction', () => {
  it('updates the bound value when a select changes', async () => {
    renderPanel()
    const distance = (await screen.findByLabelText('Distance Unit')) as HTMLSelectElement
    expect(distance.value).toBe('km')

    fireEvent.change(distance, { target: { value: 'mi' } })
    expect(distance.value).toBe('mi')

    const temp = screen.getByLabelText('Temperature Unit') as HTMLSelectElement
    fireEvent.change(temp, { target: { value: 'F' } })
    expect(temp.value).toBe('F')
  })
})

describe('GeneralSettings — save', () => {
  it('issues PUT /settings with the current form and shows confirmation', async () => {
    renderPanel()
    const distance = (await screen.findByLabelText('Distance Unit')) as HTMLSelectElement
    fireEvent.change(distance, { target: { value: 'mi' } })

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/settings',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
    const putCall = mockedRequest.mock.calls.find(
      (c) => typeof c[1] === 'object' && (c[1] as { method?: string }).method === 'PUT',
    )
    expect(putCall).toBeDefined()
    const body = JSON.parse((putCall?.[1] as { body: string }).body) as AppSettings
    expect(body.unit_of_length).toBe('mi')

    // Inline "Settings saved" confirmation (and/or toast) appears.
    const confirmations = await screen.findAllByText('Settings saved')
    expect(confirmations.length).toBeGreaterThanOrEqual(1)
  })

  it('surfaces a save failure without showing a false confirmation', async () => {
    state.failPut = true
    renderPanel()
    await screen.findByLabelText('Distance Unit')

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/settings',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
    // Error is surfaced; the success confirmation must NOT appear.
    expect(await screen.findByText('Failed to save')).toBeInTheDocument()
    expect(screen.queryByText('Settings saved')).toBeNull()
    // The panel is still interactive (no crash).
    expect(screen.getByText('Application')).toBeInTheDocument()
  })
})

describe('GeneralSettings — sync from car', () => {
  beforeEach(() => {
    state.vehicles = [{ id: 1, name: 'Model 3', vin: '5YJ' }]
    state.carPrefs = {
      setting_distance_unit: 'DistanceUnitMiles',
      setting_temperature_unit: 'TemperatureUnitFahrenheit',
      setting_tire_pressure_unit: 'PressureUnitPsi',
      setting_24hr_time: true,
    }
  })

  it('shows the sync banner and the read-only car clock format', async () => {
    renderPanel()
    expect(await screen.findByRole('button', { name: /sync from car/i })).toBeInTheDocument()
    expect(screen.getByText(/Miles \/ Fahrenheit \/ PSI/)).toBeInTheDocument()
    // setting_24hr_time: true → "24-hour" read-only chip.
    expect(screen.getByText('24-hour')).toBeInTheDocument()
  })

  it('writes the translated car units back through PUT /settings', async () => {
    renderPanel()
    const syncBtn = await screen.findByRole('button', { name: /sync from car/i })
    fireEvent.click(syncBtn)

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/settings',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
    const putCall = mockedRequest.mock.calls.find(
      (c) => typeof c[1] === 'object' && (c[1] as { method?: string }).method === 'PUT',
    )
    const body = JSON.parse((putCall?.[1] as { body: string }).body) as AppSettings
    expect(body.unit_of_length).toBe('mi')
    expect(body.unit_of_temp).toBe('F')
    expect(body.unit_of_pressure).toBe('psi')

    // The distance select reflects the synced value.
    expect((screen.getByLabelText('Distance Unit') as HTMLSelectElement).value).toBe('mi')
  })
})

describe('GeneralSettings — draft recovery', () => {
  it('prefers a restored draft over the server snapshot and reverts on discard', async () => {
    // Server says km; a persisted draft says mi. The draft must win.
    state.settings = makeSettings({ unit_of_length: 'km' })
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        value: makeSettings({ unit_of_length: 'mi' }),
      }),
    )

    renderPanel()

    const distance = (await screen.findByLabelText('Distance Unit')) as HTMLSelectElement
    expect(distance.value).toBe('mi')
    // Recovery banner is shown for the restored draft.
    expect(screen.getByText(/draft restored from/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /discard draft/i }))

    // Discarding reverts to the server snapshot and dismisses the banner.
    await waitFor(() => {
      expect((screen.getByLabelText('Distance Unit') as HTMLSelectElement).value).toBe('km')
    })
    expect(screen.queryByText(/draft restored from/i)).toBeNull()
  })
})
