import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { request } from '@/api/client'
import { invalidateAndBroadcast } from '@/lib/queryBroadcast'
import { packKeys, useAlertPacks, usePackInstallations, useInstallAlertPack, useRemoveAlertPack } from './useAlertPacks'

vi.mock('@/api/client', () => ({ request: vi.fn() }))
vi.mock('@/lib/queryBroadcast', () => ({ invalidateAndBroadcast: vi.fn() }))
vi.mock('@/api/queryPolicy', () => ({ queryPolicy: () => ({ retry: false }) }))

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
}
beforeEach(() => vi.clearAllMocks())

it('normalizes nullable catalog and member arrays', async () => {
  vi.mocked(request).mockResolvedValueOnce([{ id: 'x', rules: null }]).mockResolvedValueOnce([{ id: 1, members: null }])
  const catalog = renderHook(() => useAlertPacks(), { wrapper })
  await waitFor(() => expect(catalog.result.current.data?.[0].rules).toEqual([]))
  const installed = renderHook(() => usePackInstallations(2), { wrapper })
  await waitFor(() => expect(installed.result.current.data?.[0].members).toEqual([]))
  expect(request).toHaveBeenCalledWith('/alerts/pack-installations?limit=20&offset=40', expect.objectContaining({ signal: expect.any(AbortSignal) }))
})

it('invalidates both rule and pack caches after installing and removing', async () => {
  vi.mocked(request).mockResolvedValue({ id: 1, members: [] })
  const install = renderHook(() => useInstallAlertPack(), { wrapper })
  await act(async () => {
    await install.result.current.mutateAsync({ pack_id: 'custom', name: 'Weekend', version: 1, enabled: false, all_vehicles: true, vehicle_ids: [], rules: [{ template_id: 'battery-low' }] })
  })
  expect(invalidateAndBroadcast).toHaveBeenCalledWith(expect.anything(), { queryKey: ['alert-rules'] })
  expect(invalidateAndBroadcast).toHaveBeenCalledWith(expect.anything(), { queryKey: packKeys.installations })
  const remove = renderHook(() => useRemoveAlertPack(), { wrapper })
  await act(async () => { await remove.result.current.mutateAsync({ id: 1, delete_rule_ids: [] }) })
  expect(request).toHaveBeenLastCalledWith('/alerts/pack-installations/1/remove', { method: 'POST', body: '{"delete_rule_ids":[]}' })
})
