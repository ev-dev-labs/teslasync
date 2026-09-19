import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { request } from '@/api/client'
import { useBulkDeleteAlertRules } from './useBulkDeleteAlertRules'
import { notificationKeys } from './useNotifications'

vi.mock('@/api/client', () => ({ request: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('./_toastHelpers', () => ({ useMutationToast: () => toasts }))
beforeEach(() => { vi.mocked(request).mockReset(); vi.clearAllMocks() })

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  client.setQueryData(notificationKeys.alertRules, [])
  client.setQueryData(notificationKeys.packInstallations, [])
  const hook = renderHook(() => useBulkDeleteAlertRules(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
  return { ...hook, client }
}

it('deduplicates and chunks deletion at the server cap', async () => {
  vi.mocked(request).mockImplementation(async (_path, options) => ({ deleted_ids: JSON.parse(String(options?.body)).ids }))
  const { result, client } = setup()
  const ids = Array.from({ length: 601 }, (_, index) => index + 1)
  let deleted: number[] = []
  await act(async () => { deleted = await result.current.mutateAsync([...ids, 1]) })
  expect(deleted).toEqual(ids)
  expect(request).toHaveBeenCalledTimes(2)
  expect(JSON.parse(String(vi.mocked(request).mock.calls[0][1]?.body)).ids).toHaveLength(500)
  expect(JSON.parse(String(vi.mocked(request).mock.calls[1][1]?.body)).ids).toHaveLength(101)
  expect(client.getQueryState(notificationKeys.alertRules)?.isInvalidated).toBe(true)
  expect(client.getQueryState(notificationKeys.packInstallations)?.isInvalidated).toBe(true)
})

it('surfaces partial-batch failure and refreshes both rules and pack membership', async () => {
  vi.mocked(request).mockResolvedValueOnce({ deleted_ids: [1] }).mockRejectedValueOnce(new Error('Second batch failed'))
  const { result, client } = setup()
  await act(async () => {
    await expect(result.current.mutateAsync(Array.from({ length: 501 }, (_, index) => index + 1))).rejects.toThrow('Second batch failed')
  })
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(toasts.success).not.toHaveBeenCalled()
  expect(toasts.error).toHaveBeenCalledOnce()
  expect(client.getQueryState(notificationKeys.alertRules)?.isInvalidated).toBe(true)
  expect(client.getQueryState(notificationKeys.packInstallations)?.isInvalidated).toBe(true)
})
