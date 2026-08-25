/**
 * @module api/hooks/useRbacMatrix
 *
 * RBAC matrix admin hooks. AUTH_MODE_OPEN is returned as `{ mode: 'open' }`
 * so the page can render the forward-auth requirement without treating it as
 * a query failure.
 *
 * The PUT route is RequireSudo-gated; the request client handles reauth before
 * the mutation fires and keeps the sudo token cached for follow-up edits.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, isApiError, request } from '../client'
import { useMutationToast } from './_toastHelpers'
import { invalidateAndBroadcast } from '@/lib/queryBroadcast'
import type {
  RbacMatrixOpenModeResponse,
  RbacMatrixResponse,
  RbacMatrixSessionResponse,
  RbacUpsertCell,
  RbacUpsertRequest,
} from '@/api/types'

export type {
  RbacMatrixOpenModeResponse,
  RbacMatrixResponse,
  RbacMatrixSessionResponse,
  RbacPermission,
  RbacRole,
  RbacUpsertCell,
  RbacUpsertRequest,
} from '@/api/types'

/** Backend sentinel for "feature unavailable" in open-auth mode. */
const AUTH_MODE_OPEN_CODE = 'AUTH_MODE_OPEN'

export const rbacMatrixKeys = {
  all: ['admin', 'rbac'] as const,
  matrix: () => [...rbacMatrixKeys.all, 'matrix'] as const,
}

/**
 * Fetches the RBAC matrix or `{ mode: 'open' }` when forward-auth is disabled.
 * Polling stays off because the matrix only changes through explicit edits.
 */
export function useRbacMatrix(options?: { enabled?: boolean }) {
  return useQuery<RbacMatrixResponse, ApiError>({
    queryKey: rbacMatrixKeys.matrix(),
    queryFn: async ({ signal }) => {
      try {
        return await request<RbacMatrixSessionResponse>('/admin/rbac/matrix', { signal })
      } catch (err) {
        if (isApiError(err) && err.code === AUTH_MODE_OPEN_CODE) {
          const open: RbacMatrixOpenModeResponse = { mode: 'open' }
          return open
        }
        throw err
      }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: options?.enabled ?? true,
  })
}

/**
 * Persists changed (role, permission, allowed) cells and invalidates the matrix.
 * Accepts the array directly; the backend treats an empty batch as a no-op.
 */
export function useUpsertRbacCells() {
  const qc = useQueryClient()
  const toast = useMutationToast()
  return useMutation<void, ApiError, RbacUpsertCell[]>({
    mutationFn: (cells: RbacUpsertCell[]) => {
      const body: RbacUpsertRequest = { cells }
      return request<void>('/admin/rbac/matrix', {
        method: 'PUT',
        requiresLiveMode: true,
        body: JSON.stringify(body),
      })
    },
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: rbacMatrixKeys.matrix() })
      toast.success('rbac.toasts.saved', 'RBAC matrix updated.')
    },
    onError: (err) =>
      toast.error(err, 'rbac.errors.save', 'Failed to save RBAC matrix'),
  })
}

/** Narrows the synthetic `{ mode: 'open' }` response from useRbacMatrix. */
export function isRbacOpenMode(
  data: RbacMatrixResponse | undefined,
): data is RbacMatrixOpenModeResponse {
  return data?.mode === 'open'
}

/**
 * Returns cells whose allowed value changed between two matrix snapshots.
 *
 * Tolerates a missing/`undefined` snapshot on either side (open-mode or a
 * still-loading draft) by treating it as an empty matrix, so callers can diff
 * before the first snapshot lands without a `TypeError` from `Object.keys`.
 */
export function diffMatrices(
  base: Record<string, Record<string, boolean>> | null | undefined,
  draft: Record<string, Record<string, boolean>> | null | undefined,
): RbacUpsertCell[] {
  const baseMatrix = base ?? {}
  const draftMatrix = draft ?? {}
  const cells: RbacUpsertCell[] = []
  const roleIDs = new Set<string>([...Object.keys(baseMatrix), ...Object.keys(draftMatrix)])
  for (const roleID of roleIDs) {
    const baseRow = baseMatrix[roleID] ?? {}
    const draftRow = draftMatrix[roleID] ?? {}
    const permIDs = new Set<string>([...Object.keys(baseRow), ...Object.keys(draftRow)])
    for (const permID of permIDs) {
      const baseAllowed = baseRow[permID] ?? false
      const draftAllowed = draftRow[permID] ?? false
      if (baseAllowed !== draftAllowed) {
        cells.push({ role_id: roleID, permission_id: permID, allowed: draftAllowed })
      }
    }
  }
  return cells
}
