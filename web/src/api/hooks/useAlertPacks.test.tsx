import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { request } from '@/api/client'
import { createQueryClient } from '@/api/queryClient'
import { invalidateAndBroadcast } from '@/lib/queryBroadcast'
import { packKeys, useAlertPacks, usePackInstallations, useInstallAlertPack, useRemoveAlertPack } from './useAlertPacks'

vi.mock('@/api/client', () => ({ request: vi.fn() }))
vi.mock('@/lib/queryBroadcast', () => ({ invalidateAndBroadcast: vi.fn() }))
vi.mock('@/api/queryPolicy', () => ({ queryPolicy: () => ({ retry: false }) }))

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(request).mockReset()
})
afterEach(() => onlineManager.setOnline(true))

it('normalizes nullable catalog and member arrays', async () => {
  vi.mocked(request).mockResolvedValueOnce([{ id: 'x', rules: null }]).mockResolvedValueOnce([{ id: 1, members: null }])
  const catalog = renderHook(() => useAlertPacks(), { wrapper })
  await waitFor(() => expect(catalog.result.current.data?.[0].rules).toEqual([]))
  expect(request).toHaveBeenCalledWith('/alerts/packs', { signal: expect.any(AbortSignal) })
  const installed = renderHook(() => usePackInstallations(2), { wrapper })
  await waitFor(() => expect(installed.result.current.data?.[0].members).toEqual([]))
  expect(request).toHaveBeenCalledWith('/alerts/pack-installations?limit=20&offset=40', expect.objectContaining({ signal: expect.any(AbortSignal) }))
})

it('installs only in live mode, preserving the encoded ID, full body and invalidation', async () => {
  vi.mocked(request).mockResolvedValue({ id: 1, members: [] })
  const install = renderHook(() => useInstallAlertPack(), { wrapper })
  const body = {
    name: 'Weekend',
    version: 1,
    enabled: false,
    all_vehicles: false,
    vehicle_ids: [2, 3],
    cooldown_s: 60,
    trigger_mode: 'repeat' as const,
    include_title: false,
    rules: [{
      template_id: 'battery-low',
      op: 'lt',
      channel_ids: [4],
      value_num: 20,
      message: 'Low battery',
      cooldown_s: 120,
      trigger_mode: 'once' as const,
      include_title: true,
    }],
  }
  await act(async () => {
    await install.result.current.mutateAsync({ pack_id: 'custom/pack', ...body })
  })
  expect(request).toHaveBeenCalledExactlyOnceWith('/alerts/packs/custom%2Fpack/install', {
    method: 'POST', body: JSON.stringify(body), requiresLiveMode: true,
  })
  expect(invalidateAndBroadcast).toHaveBeenCalledTimes(2)
  expect(invalidateAndBroadcast).toHaveBeenCalledWith(expect.anything(), { queryKey: ['alert-rules'] })
  expect(invalidateAndBroadcast).toHaveBeenCalledWith(expect.anything(), { queryKey: packKeys.installations })
})

it.each([{ delete_rule_ids: [] }, { delete_rule_ids: [7, 8] }])('removes only in live mode, preserving rule IDs $delete_rule_ids and invalidation', async ({ delete_rule_ids }) => {
  vi.mocked(request).mockResolvedValue({ status: 'ok' })
  const remove = renderHook(() => useRemoveAlertPack(), { wrapper })
  await act(async () => { await remove.result.current.mutateAsync({ id: 11, delete_rule_ids }) })
  expect(request).toHaveBeenCalledExactlyOnceWith('/alerts/pack-installations/11/remove', {
    method: 'POST', body: JSON.stringify({ delete_rule_ids }), requiresLiveMode: true,
  })
  expect(invalidateAndBroadcast).toHaveBeenCalledTimes(2)
  expect(invalidateAndBroadcast).toHaveBeenCalledWith(expect.anything(), { queryKey: ['alert-rules'] })
  expect(invalidateAndBroadcast).toHaveBeenCalledWith(expect.anything(), { queryKey: packKeys.installations })
})

it.each(['install', 'remove'] as const)('surfaces offline %s failures without retry, replay or invalidation', async (action) => {
  const error = new Error('Offline writes are not allowed')
  vi.mocked(request).mockRejectedValue(error)
  onlineManager.setOnline(false)
  const hooks = renderHook(() => ({
    install: useInstallAlertPack(),
    remove: useRemoveAlertPack(),
  }), { wrapper })
  await act(async () => {
    const mutation = action === 'install'
      ? hooks.result.current.install.mutateAsync({
        pack_id: 'custom', version: 1, enabled: false, all_vehicles: true, vehicle_ids: [], rules: [],
      })
      : hooks.result.current.remove.mutateAsync({ id: 11, delete_rule_ids: [7] })
    await expect(mutation).rejects.toBe(error)
  })
  await waitFor(() => expect(hooks.result.current[action].isError).toBe(true))
  expect(hooks.result.current[action].error).toBe(error)
  await act(async () => { onlineManager.setOnline(true) })
  expect(request).toHaveBeenCalledTimes(1)
  expect(invalidateAndBroadcast).not.toHaveBeenCalled()
})
