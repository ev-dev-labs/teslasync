import { useMutation, useQueryClient } from '@tanstack/react-query'
import { request } from '@/api/client'
import { invalidateAndBroadcast } from '@/lib/queryBroadcast'
import { notificationKeys } from './useNotifications'
import { useMutationToast } from './_toastHelpers'

export function useBulkDeleteAlertRules() {
  const client = useQueryClient()
  const { success, error } = useMutationToast()
  return useMutation({
    mutationFn: async (ids: number[]) => {
      const unique = [...new Set(ids)]
      const deleted: number[] = []
      for (let offset = 0; offset < unique.length; offset += 500) {
        const result = await request<{ deleted_ids: number[] }>('/alerts/rules/bulk/delete', {
          method: 'POST', body: JSON.stringify({ ids: unique.slice(offset, offset + 500) }),
        })
        deleted.push(...result.deleted_ids)
      }
      return deleted
    },
    onSuccess: deleted => success('alertPacks.bulkDeleted', '{{count}} rules deleted', { count: deleted.length }),
    onError: e => error(e, 'alertPacks.bulkDeleteFailed', 'Deletion did not finish. Refresh the list to review remaining rules before retrying.'),
    onSettled: () => {
      invalidateAndBroadcast(client, { queryKey: notificationKeys.alertRules })
      invalidateAndBroadcast(client, { queryKey: notificationKeys.packInstallations })
    },
  })
}
