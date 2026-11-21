import { createElement, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from '@/api/client'
import { personalIdentityKey } from './usePersonalIdentity'
import { useSharedChargerChange, useSharedChargerPlanning, type SharedChargerScope } from './useSharedChargerPlanning'

vi.mock('@/api/client', () => ({ request: vi.fn(), isApiError: () => false }))

const alice: SharedChargerScope = { mode: 'forward_auth', subject: 'Alice+test' }
const bob: SharedChargerScope = { mode: 'forward_auth', subject: 'Bob' }
const ref = { id: 8, revision: 3 }

function harness() {
  const client = new QueryClient()
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }
  return { client, wrapper: Wrapper }
}

describe('shared charger planning privacy', () => {
  beforeEach(() => vi.mocked(request).mockReset())

  it('does not carry an invitation to another signed-in subject', async () => {
    vi.mocked(request)
      .mockResolvedValueOnce({ data: { can_manage: false, owned: [], invitations: [{ ...ref, vehicle_id: 11 }] } })
      .mockResolvedValueOnce({ data: { can_manage: false, owned: [], invitations: [] } })
    const { wrapper } = harness()
    const { result, rerender } = renderHook(({ scope }) => useSharedChargerPlanning(scope, 0), {
      initialProps: { scope: alice }, wrapper,
    })
    await waitFor(() => expect(result.current.data?.invitations[0]?.vehicle_id).toBe(11))
    rerender({ scope: bob })
    expect(result.current.data?.invitations ?? []).toEqual([])
    await waitFor(() => expect(result.current.data?.invitations).toEqual([]))
    expect(request).toHaveBeenNthCalledWith(1, '/smart-charging/shared-chargers?limit=32&offset=0',
      expect.objectContaining({ cache: 'no-store', headers: { 'X-TeslaSync-Expected-Principal': 'subject:Alice%2Btest' } }))
    expect(request).toHaveBeenNthCalledWith(2, '/smart-charging/shared-chargers?limit=32&offset=0',
      expect.objectContaining({ cache: 'no-store', headers: { 'X-TeslaSync-Expected-Principal': 'subject:Bob' } }))
  })

  it('sends an exact-revision withdrawal only while the same browser identity is verified', async () => {
    vi.mocked(request).mockResolvedValue(undefined)
    const { client, wrapper } = harness()
    client.setQueryData(personalIdentityKey, alice)
    const { result } = renderHook(() => useSharedChargerChange(alice), { wrapper })
    const withdraw = { kind: 'withdraw', ref, vehicleId: 11 } as const
    await act(async () => { await result.current.mutateAsync(withdraw) })
    expect(request).toHaveBeenCalledWith('/smart-charging/shared-chargers/8/vehicles/11?revision=3',
      expect.objectContaining({
        method: 'DELETE', cache: 'no-store', requiresLiveMode: true,
        headers: { 'X-TeslaSync-Expected-Principal': 'subject:Alice%2Btest' },
      }))
    client.setQueryData(personalIdentityKey, bob)
    await act(async () => {
      await expect(result.current.mutateAsync(withdraw)).rejects.toThrow('Verified browser principal changed')
    })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
