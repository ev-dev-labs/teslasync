import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', async () =>
  await vi.importActual<typeof import('./useSettings')>('./useSettings'),
)

vi.mock('@/api/client', () => ({
  request: vi.fn(),
}))

import { request } from '@/api/client'
import { useSettings } from './useSettings'
import { getGlobalLocale, getGlobalPrecision } from '@/lib/numberFormat'

const clients: QueryClient[] = []
const aborts = vi.fn()
let pending: {
  signal: AbortSignal | null | undefined
  resolve: (settings: AppSettings) => void
}[]

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  })
  clients.push(client)
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, Wrapper }
}

function settingsSignal(index = 0): AbortSignal {
  const signal = pending[index]?.signal
  expect(signal).toBeInstanceOf(AbortSignal)
  if (!signal) throw new Error('Settings request did not receive the Query AbortSignal')
  return signal
}

beforeEach(() => {
  pending = []
  aborts.mockClear()
  vi.mocked(request).mockReset()
  vi.mocked(request).mockImplementation((_path, options) =>
    new Promise<AppSettings>((resolve, reject) => {
      const signal = options?.signal
      pending.push({ signal, resolve })
      signal?.addEventListener('abort', () => {
        aborts()
        reject(new DOMException('Settings read cancelled', 'AbortError'))
      }, { once: true })
    }),
  )
})

afterEach(() => {
  cleanup()
  for (const client of clients.splice(0)) client.clear()
})

describe('app settings Query cancellation', () => {
  it('threads the actual Query signal through getSettings while preserving the query policy and defaults', () => {
    const { client, Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })
    const signal = settingsSignal()

    expect(request).toHaveBeenCalledExactlyOnceWith('/settings', { signal })
    expect(signal.aborted).toBe(false)
    expect(client.getQueryCache().getAll()).toHaveLength(1)
    expect(client.getQueryCache().find({ queryKey: ['settings'], exact: true })?.options)
      .toMatchObject({
        queryKey: ['settings'],
        staleTime: 300000,
        refetchOnMount: 'always',
        retry: 1,
      })
    expect(result.current.settingsUnavailable).toBe(true)
    expect(result.current.settingsState.hasData).toBe(false)
    expect(result.current.settings).toMatchObject({
      unit_of_length: 'km',
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      language: 'en',
      base_cost_per_kwh: 0.12,
      api_suspended: false,
      theme: 'neon-cyan',
      mode: 'dark',
      gas_unit: 'gallon',
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
      time_format_default: 'relative',
      chart_palette: 'cb_safe',
      ai_mode: 'off',
      ai_features: {},
      ai_provider_config: {},
      ai_cost_cap_cents: 0,
    })
    expect(getGlobalLocale()).toBe('en-US')
    expect(getGlobalPrecision()).toBe(2)
  })

  it('aborts a pending settings read when its final observer unmounts without retrying or caching defaults', async () => {
    const { client, Wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useSettings(), { wrapper: Wrapper })
    const signal = settingsSignal()

    unmount()
    await act(async () => { await Promise.resolve() })

    expect(signal.aborted).toBe(true)
    expect(aborts).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(['settings'])).toBeUndefined()
    expect(client.getQueryState(['settings'])?.fetchStatus).toBe('idle')
    expect(client.getQueryState(['settings'])?.error).toBeNull()
  })

  it('deduplicates shared reads and waits for the final settings observer before aborting', () => {
    const { Wrapper } = makeWrapper()
    const first = renderHook(() => useSettings(), { wrapper: Wrapper })
    const second = renderHook(() => useSettings(), { wrapper: Wrapper })
    const signal = settingsSignal()

    expect(request).toHaveBeenCalledTimes(1)
    first.unmount()
    expect(signal.aborted).toBe(false)
    expect(aborts).not.toHaveBeenCalled()
    second.unmount()
    expect(signal.aborted).toBe(true)
    expect(aborts).toHaveBeenCalledTimes(1)
  })

  it('retains cached preferences and formatter globals when an explicit Query cancellation interrupts revalidation', async () => {
    const { client, Wrapper } = makeWrapper()
    const retained: AppSettings = {
      unit_of_length: 'mi',
      unit_of_temp: 'F',
      unit_of_pressure: 'psi',
      preferred_range: 'ideal',
      language: 'fr',
      base_cost_per_kwh: 0.25,
      api_suspended: true,
      theme: 'matrix-green',
      mode: 'auto',
      custom_primary: '#123456',
      custom_accent: '#654321',
      gas_price_per_unit: 4,
      gas_unit: 'liter',
      gas_efficiency_mpg: 30,
      decimal_precision: 4,
      quiet_hours_enabled: true,
      quiet_hours_start: '21:00',
      quiet_hours_end: '08:00',
      alert_digest_mode: 'daily',
      locale: 'fr-FR',
      currency_symbol: '€',
      timezone_user: 'Europe/Paris',
      ui_density: 'compact',
    }
    client.setQueryData(['settings'], retained)
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })
    const signal = settingsSignal()
    expect(result.current.settings).toBe(retained)
    expect(result.current.settingsUnavailable).toBe(false)

    await act(async () => {
      await client.cancelQueries({ queryKey: ['settings'], exact: true })
    })

    expect(signal.aborted).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(['settings'])).toBe(retained)
    expect(result.current.settings).toBe(retained)
    expect(result.current.settingsUnavailable).toBe(false)
    expect(result.current.settingsState.fatalError).toBeNull()
    expect(result.current.settingsState.refreshError).toBeNull()
    expect(result.current).toMatchObject({
      isMiles: true,
      isFahrenheit: true,
      isPSI: true,
      density: 'compact',
      rangeType: 'ideal',
      decimals: 4,
      locale: 'fr-FR',
    })
    expect(getGlobalLocale()).toBe('fr-FR')
    expect(getGlobalPrecision()).toBe(4)
  })

  it('uses a fresh signal after cancellation and ignores a late result from the old read', async () => {
    const { client, Wrapper } = makeWrapper()
    const first = renderHook(() => useSettings(), { wrapper: Wrapper })
    const oldSignal = settingsSignal()
    first.unmount()
    expect(oldSignal.aborted).toBe(true)

    const second = renderHook(() => useSettings(), { wrapper: Wrapper })
    const newSignal = settingsSignal(1)
    expect(newSignal).not.toBe(oldSignal)
    expect(newSignal.aborted).toBe(false)
    expect(request).toHaveBeenCalledTimes(2)

    const current = { ...second.result.current.settings, language: 'de', locale: 'de-DE' }
    const obsolete = { ...current, language: 'ja', locale: 'ja-JP' }
    await act(async () => {
      pending[1].resolve(current)
      pending[0].resolve(obsolete)
    })

    await waitFor(() => expect(second.result.current.locale).toBe('de-DE'))
    expect(client.getQueryData(['settings'])).toEqual(current)
    expect(getGlobalLocale()).toBe('de-DE')
    expect(newSignal.aborted).toBe(false)
  })
})
