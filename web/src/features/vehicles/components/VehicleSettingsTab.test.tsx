/**
 * VehicleSettingsTab unit tests.
 *
 * Co-located alongside the component because path-scoped checks match
 * 'features/vehicles/components/VehicleSettingsTab' as a contiguous substring.
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
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
import { vehicleSettingsKeys } from '@/api/hooks/useVehicleSettings'
import VehicleSettingsTab from './VehicleSettingsTab'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderTab(vehicleId = 42) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  const tree = (id: number) => (
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <VehicleSettingsTab vehicleId={id} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
  const view = render(tree(vehicleId))
  return { ...view, qc, rerenderVehicle: (id: number) => view.rerender(tree(id)) }
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
    expect(screen.queryByTestId('vehicle-settings-rows')).not.toBeInTheDocument()
  })

  it('keeps unresolved paused queries distinct from successful empty settings', async () => {
    onlineManager.setOnline(false)
    mockedRequest.mockResolvedValue(DEFAULT_PAYLOAD)
    try {
      renderTab()
      expect(await screen.findByText('Refresh paused')).toBeInTheDocument()
      expect(screen.getByTestId('vehicle-settings-loading')).toBeInTheDocument()
      expect(screen.queryByTestId('vehicle-settings-rows')).not.toBeInTheDocument()
      expect(screen.queryByTestId('vehicle-settings-error')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(screen.queryByText(/offline/i)).not.toBeInTheDocument()
      expect(mockedRequest).not.toHaveBeenCalled()
      act(() => onlineManager.setOnline(true))
      expect(await screen.findByTestId('vehicle-settings-rows')).toBeInTheDocument()
    } finally {
      onlineManager.setOnline(true)
    }
  })

  it('keeps drafts but blocks mutations during a paused refresh and restores actions on recovery', async () => {
    mockedRequest.mockResolvedValue(DEFAULT_PAYLOAD)
    const { qc } = renderTab()
    const input = await screen.findByTestId('vehicle-settings-input-nickname')
    fireEvent.change(input, { target: { value: 'Paused draft' } })
    onlineManager.setOnline(false)
    try {
      act(() => { void qc.refetchQueries({ queryKey: vehicleSettingsKeys.detail(42) }) })
      await waitFor(() => expect(screen.getByTestId('stale-refresh-warning'))
        .toHaveAttribute('data-refresh-blocked', 'true'))
      const save = screen.getByTestId('vehicle-settings-save-nickname')
      const reset = screen.getByTestId('vehicle-settings-reset-nickname')
      expect(save).toBeDisabled()
      expect(reset).toBeDisabled()
      fireEvent.click(save)
      fireEvent.click(reset)
      expect(mockedRequest).toHaveBeenCalledTimes(1)
      expect(input).toHaveValue('Paused draft')
      expect(screen.queryByText(/offline/i)).not.toBeInTheDocument()
      act(() => onlineManager.setOnline(true))
      await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument())
      expect(screen.getByTestId('vehicle-settings-input-nickname')).toBe(input)
      expect(input).toHaveValue('Paused draft')
      expect(save).toBeEnabled()
      expect(reset).toBeEnabled()
    } finally {
      onlineManager.setOnline(true)
    }
  })

  it('retains edited rows through refresh failure, retry and recovery', async () => {
    let recover!: (value: typeof DEFAULT_PAYLOAD) => void
    mockedRequest
      .mockResolvedValueOnce(DEFAULT_PAYLOAD)
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockImplementationOnce(() => new Promise((resolve) => { recover = resolve }))
    const { qc } = renderTab()
    const input = await screen.findByTestId('vehicle-settings-input-nickname')
    fireEvent.change(input, { target: { value: 'Unsaved nickname' } })
    await act(async () => {
      await qc.refetchQueries({ queryKey: vehicleSettingsKeys.detail(42) })
    })
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(screen.queryByTestId('vehicle-settings-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('vehicle-settings-input-nickname')).toBe(input)
    expect(input).toHaveValue('Unsaved nickname')
    expect(screen.getByTestId('vehicle-settings-save-nickname')).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(3))
    expect(input).toHaveValue('Unsaved nickname')
    expect(screen.queryByTestId('vehicle-settings-loading')).not.toBeInTheDocument()
    await act(async () => { recover(DEFAULT_PAYLOAD) })
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument())
    expect(screen.getByTestId('vehicle-settings-input-nickname')).toBe(input)
    expect(input).toHaveValue('Unsaved nickname')
  })
})

describe('VehicleSettingsTab — row rendering', () => {
  it('renders all editable default rows after a successful empty response', async () => {
    mockedRequest.mockResolvedValue(makePayload([]))
    renderTab()
    expect(await screen.findByTestId('vehicle-settings-rows')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getAllByTestId('vehicle-settings-source-default')).toHaveLength(6)
    expect(screen.getByTestId('vehicle-settings-input-nickname')).toHaveValue('')
    expect(screen.queryByTestId('vehicle-settings-loading')).not.toBeInTheDocument()
  })

  it('preserves a successful zero value instead of treating it as missing', async () => {
    mockedRequest.mockResolvedValue(makePayload([
      { key: 'charge_cost_tariff_id', value: 0, source: 'override' },
    ]))
    renderTab()
    expect(await screen.findByTestId('vehicle-settings-input-charge_cost_tariff_id')).toHaveValue('0')
    expect(screen.getByTestId('vehicle-settings-reset-charge_cost_tariff_id')).toBeEnabled()
  })

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

describe('VehicleSettingsTab — draft and settlement identity', () => {
  function pendingMutation(method: 'PUT' | 'DELETE') {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const completion = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    let payload = DEFAULT_PAYLOAD
    mockedRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/vehicles/42/settings/nickname' && init?.method === method) {
        return completion
      }
      if (path === '/vehicles/42/settings') return Promise.resolve(payload)
      if (path === '/vehicles/43/settings') return Promise.resolve(DEFAULT_PAYLOAD)
      throw new Error(`unexpected ${path} ${init?.method}`)
    })
    return {
      resolve: (value: string) => {
        payload = makePayload([
          { key: 'nickname', value, source: method === 'PUT' ? 'override' : 'vehicle' },
        ])
        resolve()
      },
      reject,
    }
  }

  function editNickname(value: string) {
    fireEvent.change(screen.getByTestId('vehicle-settings-input-nickname'), {
      target: { value },
    })
  }

  function submit(method: 'PUT' | 'DELETE') {
    fireEvent.click(screen.getByTestId(
      `vehicle-settings-${method === 'PUT' ? 'save' : 'reset'}-nickname`,
    ))
  }

  it('discards drafts and validation on a vehicle change even when effective values match', async () => {
    mockedRequest.mockResolvedValue(DEFAULT_PAYLOAD)
    const { qc, rerenderVehicle } = renderTab()
    await screen.findByTestId('vehicle-settings-input-nickname')
    editNickname('')
    submit('PUT')
    expect(screen.getByTestId('vehicle-settings-error-nickname')).toBeInTheDocument()
    qc.setQueryData(vehicleSettingsKeys.detail(43), DEFAULT_PAYLOAD)
    rerenderVehicle(43)
    expect(screen.getByTestId('vehicle-settings-input-nickname')).toHaveValue('Snowball')
    expect(screen.queryByTestId('vehicle-settings-error-nickname')).not.toBeInTheDocument()
    expect(screen.getByTestId('vehicle-settings-save-nickname')).toBeDisabled()
    rerenderVehicle(42)
    expect(screen.getByTestId('vehicle-settings-input-nickname')).toHaveValue('Snowball')
  })

  it.each(['PUT', 'DELETE'] as const)(
    '%s completion after switching away and back cannot settle the new row draft',
    async (method) => {
      const mutation = pendingMutation(method)
      const { qc, rerenderVehicle } = renderTab()
      const original = await screen.findByTestId('vehicle-settings-input-nickname')
      editNickname('First vehicle draft')
      submit(method)
      await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(
        '/vehicles/42/settings/nickname',
        expect.objectContaining({ method }),
      ))
      expect(screen.getByTestId('vehicle-settings-save-nickname')).toBeDisabled()
      expect(screen.getByTestId('vehicle-settings-reset-nickname')).toBeDisabled()
      qc.setQueryData(vehicleSettingsKeys.detail(43), DEFAULT_PAYLOAD)
      rerenderVehicle(43)
      expect(screen.getByTestId('vehicle-settings-input-nickname')).not.toBe(original)
      expect(screen.getByTestId('vehicle-settings-input-nickname')).toHaveValue('Snowball')
      editNickname('Other vehicle draft')
      expect(screen.getByTestId('vehicle-settings-save-nickname')).toBeEnabled()
      expect(screen.getByTestId('vehicle-settings-reset-nickname')).toBeEnabled()
      rerenderVehicle(42)
      editNickname('New visit draft')
      await act(async () => { mutation.resolve('Settled old request') })
      await waitFor(() => expect(qc.getQueryData(vehicleSettingsKeys.detail(42))).toEqual(
        makePayload([
          {
            key: 'nickname',
            value: 'Settled old request',
            source: method === 'PUT' ? 'override' : 'vehicle',
          },
        ]),
      ))
      expect(screen.getByTestId('vehicle-settings-input-nickname')).toHaveValue('New visit draft')
      expect(screen.getByTestId('vehicle-settings-save-nickname')).toBeEnabled()
      expect(qc.getQueryData(vehicleSettingsKeys.detail(43))).toEqual(DEFAULT_PAYLOAD)
    },
  )

  it.each(['PUT', 'DELETE'] as const)('%s rejection retains the draft for retry', async (method) => {
    const mutation = pendingMutation(method)
    renderTab()
    await screen.findByTestId('vehicle-settings-input-nickname')
    editNickname('Retained draft')
    submit(method)
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2))
    await act(async () => { mutation.reject(new Error('Mutation rejected')) })
    await waitFor(() => expect(screen.getByTestId('vehicle-settings-save-nickname')).toBeEnabled())
    expect(screen.getByTestId('vehicle-settings-input-nickname')).toHaveValue('Retained draft')
    expect(await screen.findByText('Mutation rejected')).toBeInTheDocument()
  })

  it.each(['PUT', 'DELETE'] as const)(
    '%s matching success clears the submitted draft and follows the effective value',
    async (method) => {
      const mutation = pendingMutation(method)
      const { qc } = renderTab()
      await screen.findByTestId('vehicle-settings-input-nickname')
      editNickname('Submitted draft')
      submit(method)
      await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2))
      await act(async () => { mutation.resolve('Server value') })
      await waitFor(() => expect(screen.getByTestId('vehicle-settings-input-nickname'))
        .toHaveValue('Server value'))
      expect(screen.getByTestId('vehicle-settings-save-nickname')).toBeDisabled()
      act(() => {
        qc.setQueryData(vehicleSettingsKeys.detail(42), makePayload([
          { key: 'nickname', value: 'Later server value', source: 'vehicle' },
        ]))
      })
      await waitFor(() => expect(screen.getByTestId('vehicle-settings-input-nickname'))
        .toHaveValue('Later server value'))
    },
  )

  it.each(['PUT', 'DELETE'] as const)(
    '%s success preserves edits made during the pending request',
    async (method) => {
      const mutation = pendingMutation(method)
      renderTab()
      await screen.findByTestId('vehicle-settings-input-nickname')
      editNickname('Submitted draft')
      submit(method)
      await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2))
      editNickname('Newer edit')
      await act(async () => { mutation.resolve('Server value') })
      await waitFor(() => expect(screen.getByTestId('vehicle-settings-save-nickname')).toBeEnabled())
      expect(screen.getByTestId('vehicle-settings-input-nickname')).toHaveValue('Newer edit')
    },
  )

  it('retains an unsaved draft when a refresh changes its effective value', async () => {
    mockedRequest.mockResolvedValue(DEFAULT_PAYLOAD)
    const { qc } = renderTab()
    await screen.findByTestId('vehicle-settings-input-nickname')
    editNickname('Unsaved edit')
    act(() => {
      qc.setQueryData(vehicleSettingsKeys.detail(42), makePayload([
        { key: 'nickname', value: 'External update', source: 'override' },
      ]))
    })
    await waitFor(() => expect(screen.getByTestId('vehicle-settings-input-nickname'))
      .toHaveValue('Unsaved edit'))
    expect(screen.getByTestId('vehicle-settings-save-nickname')).toBeEnabled()
  })

  it('does not clear a newer draft revision even when its text matches the submitted draft', async () => {
    const mutation = pendingMutation('PUT')
    renderTab()
    await screen.findByTestId('vehicle-settings-input-nickname')
    editNickname('Submitted draft')
    submit('PUT')
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2))
    editNickname('Intermediate edit')
    editNickname('Submitted draft')
    await act(async () => { mutation.resolve('Server-normalized value') })
    await waitFor(() => expect(screen.getByTestId('vehicle-settings-save-nickname')).toBeEnabled())
    expect(screen.getByTestId('vehicle-settings-input-nickname')).toHaveValue('Submitted draft')
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
