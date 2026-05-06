/**
 * Phase-46 / Prompt 43 — VehicleSettingsTab unit tests.
 *
 * Co-located alongside the component (NOT under __tests__/) because
 * the gate's allowed-files regex matches the substring
 * 'features/vehicles/components/VehicleSettingsTab' — moving the
 * test into __tests__/VehicleSettingsTab.test.tsx would push the
 * file out of scope.
 *
 * Coverage:
 *   1. Loading skeleton renders while the GET is in flight.
 *   2. Error fallback renders when the GET rejects.
 *   3. The 6-row whitelist renders with the correct source pill.
 *   4. Save button is disabled until the draft differs from the
 *      effective value, then PUTs the new value.
 *   5. Reset button is disabled when source != 'override'; enabled
 *      and DELETEs when source == 'override'.
 *   6. Mute_until round-trips between RFC3339 and the local input.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
        if (opts && typeof opts.defaultValue === 'string') return opts.defaultValue as string
        if (fallback != null) return fallback
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import VehicleSettingsTab from './VehicleSettingsTab'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderTab(vehicleId = 42) {
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
          <VehicleSettingsTab vehicleId={vehicleId} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

interface SettingPayloadShape {
  key: string
  value: unknown
  source: 'override' | 'user' | 'vehicle' | 'default'
}

function makePayload(rows: SettingPayloadShape[]) {
  return { settings: rows }
}

const DEFAULT_PAYLOAD = makePayload([
  { key: 'nickname', value: 'Snowball', source: 'override' },
  { key: 'mute_until', value: null, source: 'default' },
  { key: 'charge_cost_tariff_id', value: '', source: 'default' },
  { key: 'units_distance', value: 'mi', source: 'user' },
  { key: 'units_temperature', value: 'F', source: 'user' },
  { key: 'units_energy', value: 'kWh', source: 'default' },
])

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('VehicleSettingsTab — loading + error states', () => {
  it('renders loading skeleton while the GET is in flight', async () => {
    let resolve!: (v: unknown) => void
    mockedRequest.mockImplementation(
      () => new Promise((r) => {
        resolve = r
      }),
    )
    renderTab()
    expect(await screen.findByTestId('vehicle-settings-loading')).toBeInTheDocument()
    // Resolve the pending request to clean up
    resolve(DEFAULT_PAYLOAD)
  })

  it('renders error fallback when the GET rejects', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'))
    renderTab()
    expect(await screen.findByTestId('vehicle-settings-error')).toBeInTheDocument()
  })
})

describe('VehicleSettingsTab — row rendering', () => {
  it('renders one row per supported key with the correct source pill', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/vehicles/42/settings') return DEFAULT_PAYLOAD
      throw new Error(`unexpected ${path}`)
    })
    renderTab()
    await waitFor(() => expect(screen.getByTestId('vehicle-settings-rows')).toBeInTheDocument())
    expect(screen.getByTestId('vehicle-settings-row-nickname')).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-settings-row-mute_until')).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-settings-row-charge_cost_tariff_id')).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-settings-row-units_distance')).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-settings-row-units_temperature')).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-settings-row-units_energy')).toBeInTheDocument()
    // Pills mirror the payload's `source` field.
    expect(screen.getAllByTestId('vehicle-settings-source-override')).toHaveLength(1)
    expect(screen.getAllByTestId('vehicle-settings-source-user')).toHaveLength(2)
    expect(screen.getAllByTestId('vehicle-settings-source-default')).toHaveLength(3)
  })
})

describe('VehicleSettingsTab — save flow', () => {
  it('Save is disabled until the draft differs, then PUTs the new value', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/vehicles/42/settings') return DEFAULT_PAYLOAD
      if (path === '/vehicles/42/settings/nickname') return undefined
      throw new Error(`unexpected ${path}`)
    })
    renderTab()

    const saveBtn = await screen.findByTestId('vehicle-settings-save-nickname')
    expect(saveBtn).toBeDisabled()

    const input = screen.getByTestId('vehicle-settings-input-nickname') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Stardust' } })
    expect(saveBtn).not.toBeDisabled()

    fireEvent.click(saveBtn)
    await waitFor(() => {
      // First call: GET; second: PUT
      const putCall = mockedRequest.mock.calls.find(
        (c) => typeof c[1] === 'object' && (c[1] as { method?: string })?.method === 'PUT',
      )
      expect(putCall).toBeTruthy()
      expect(putCall![0]).toBe('/vehicles/42/settings/nickname')
      expect((putCall![1] as { body?: string }).body).toBe(
        JSON.stringify({ value: 'Stardust' }),
      )
    })
  })

  it('Reset is enabled only when source==override and DELETEs', async () => {
    mockedRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/vehicles/42/settings' && (!init || !init.method)) return DEFAULT_PAYLOAD
      if (path === '/vehicles/42/settings/nickname' && init?.method === 'DELETE') return undefined
      throw new Error(`unexpected ${path} ${init?.method}`)
    })
    renderTab()

    const resetNickname = await screen.findByTestId('vehicle-settings-reset-nickname')
    expect(resetNickname).not.toBeDisabled()

    // mute_until source is 'default' -> reset disabled
    const resetMute = screen.getByTestId('vehicle-settings-reset-mute_until')
    expect(resetMute).toBeDisabled()

    fireEvent.click(resetNickname)
    await waitFor(() => {
      const delCall = mockedRequest.mock.calls.find(
        (c) => typeof c[1] === 'object' && (c[1] as { method?: string })?.method === 'DELETE',
      )
      expect(delCall).toBeTruthy()
      expect(delCall![0]).toBe('/vehicles/42/settings/nickname')
    })
  })
})

describe('VehicleSettingsTab — mute_until round-trip', () => {
  it('parses RFC3339 into datetime-local input and sends back ISO8601 on save', async () => {
    const fixedISO = '2025-12-31T23:59:00.000Z'
    const payload = makePayload([
      { key: 'nickname', value: 'Snowball', source: 'override' },
      { key: 'mute_until', value: fixedISO, source: 'override' },
      { key: 'charge_cost_tariff_id', value: '', source: 'default' },
      { key: 'units_distance', value: 'mi', source: 'user' },
      { key: 'units_temperature', value: 'F', source: 'user' },
      { key: 'units_energy', value: 'kWh', source: 'default' },
    ])
    mockedRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/vehicles/42/settings' && (!init || !init.method)) return payload
      if (path === '/vehicles/42/settings/mute_until' && init?.method === 'PUT') return undefined
      throw new Error(`unexpected ${path} ${init?.method}`)
    })
    renderTab()

    const input = (await screen.findByTestId('vehicle-settings-input-mute_until')) as HTMLInputElement
    // The local input shows YYYY-MM-DDTHH:MM derived from the ISO above
    // (depends on the test runner's local timezone, so we just assert
    // the format matches and the value is non-empty).
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)

    // Edit and save
    fireEvent.change(input, { target: { value: '2025-06-15T12:30' } })
    fireEvent.click(screen.getByTestId('vehicle-settings-save-mute_until'))

    await waitFor(() => {
      const putCall = mockedRequest.mock.calls.find(
        (c) => typeof c[1] === 'object' && (c[1] as { method?: string })?.method === 'PUT',
      )
      expect(putCall).toBeTruthy()
      const body = JSON.parse((putCall![1] as { body: string }).body) as { value: string }
      // The body's value is an ISO8601 string parseable by Date
      expect(typeof body.value).toBe('string')
      expect(Number.isNaN(new Date(body.value).getTime())).toBe(false)
    })
  })

  it('rejects empty draft with inline validation error', async () => {
    // Start with an override value present, then clear it — saving
    // an empty string is a 'required' validation failure that
    // surfaces via the inline error testid.
    const payload = makePayload([
      { key: 'nickname', value: 'Snowball', source: 'override' },
      { key: 'mute_until', value: '2025-12-31T23:59:00.000Z', source: 'override' },
      { key: 'charge_cost_tariff_id', value: '', source: 'default' },
      { key: 'units_distance', value: 'mi', source: 'user' },
      { key: 'units_temperature', value: 'F', source: 'user' },
      { key: 'units_energy', value: 'kWh', source: 'default' },
    ])
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/vehicles/42/settings') return payload
      throw new Error(`unexpected ${path}`)
    })
    renderTab()

    const input = (await screen.findByTestId('vehicle-settings-input-mute_until')) as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByTestId('vehicle-settings-save-mute_until'))
    expect(await screen.findByTestId('vehicle-settings-error-mute_until')).toBeInTheDocument()
  })
})
