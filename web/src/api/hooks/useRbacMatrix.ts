/**
 * @module api/hooks/useRbacMatrix
 *
 * Phase-46 / Prompt 44 — RBAC matrix admin hooks.
 *
 * Mirrors the layered fetch pattern used by useSessions / useTOTP: a
 * single useQuery for the matrix payload + one useMutation for batch
 * cell upserts. The query tolerates the 501 AUTH_MODE_OPEN response
 * by surfacing it as a discriminated-union value (`{ mode: 'open' }`)
 * so the page can render a "feature requires forward-auth" placeholder
 * without throwing or showing an error toast.
 *
 * The PUT route is RequireSudo-gated upstream — the SPA's request()
 * interceptor will pop the reauth dialog before the mutation actually
 * fires. On success the cached sudo token is intentionally NOT
 * cleared so the operator can chain a second batch (e.g. publish
 * another set of edits) without re-authenticating.
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

/**
 * Sentinel code mirrored from rbac_handler.AuthModeOpenCode. Treated
 * as a "feature unavailable" signal, NOT an error. The matrix hook
 * normalises to `{ mode: 'open' }` so consumers branch on the union
 * tag instead of inspecting error strings.
 */
const AUTH_MODE_OPEN_CODE = 'AUTH_MODE_OPEN'

export const rbacMatrixKeys = {
  all: ['admin', 'rbac'] as const,
  matrix: () => [...rbacMatrixKeys.all, 'matrix'] as const,
}

/**
 * RBAC matrix query. Returns:
 *   • `{ mode: 'open' }` when the backend reports AUTH_MODE_OPEN.
 *   • The full matrix envelope otherwise.
 *
 * Treats the 501 AUTH_MODE_OPEN response as a successful query so
 * useQuery's `isError` stays clean and the consumer can render
 * directly off `data`. Other errors propagate as ApiError.
 *
 * Polling is intentionally disabled — the matrix only changes on
 * explicit edits, and a stale 30s window would race the PUT mutation's
 * invalidation step on a busy installation.
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
 * Persist a batch of (role, perm, allowed) cells. RequireSudo-gated
 * upstream. On success the matrix query is invalidated so the page
 * re-fetches and the operator can confirm the edits landed.
 *
 * The mutation accepts the array directly (not the wrapper envelope)
 * so the SPA can call `mutate(cells)` after diffing the draft against
 * the snapshot. Empty arrays are still accepted — the backend treats
 * them as a no-op 204.
 */
export function useUpsertRbacCells() {
  const qc = useQueryClient()
  const toast = useMutationToast()
  return useMutation<void, ApiError, RbacUpsertCell[]>({
    mutationFn: (cells: RbacUpsertCell[]) => {
      const body: RbacUpsertRequest = { cells }
      return request<void>('/admin/rbac/matrix', {
        method: 'PUT',
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

/**
 * Discriminator helper — returns true when the response is the
 * synthetic `{ mode: 'open' }` envelope produced by useRbacMatrix on
 * a 501 AUTH_MODE_OPEN. Encapsulates the union narrowing so consumers
 * don't have to repeat `data?.mode === 'open'` inline.
 */
export function isRbacOpenMode(
  data: RbacMatrixResponse | undefined,
): data is RbacMatrixOpenModeResponse {
  return data?.mode === 'open'
}

/**
 * Diff two matrix snapshots and return the cells that changed. Used
 * by the page to build a minimal PUT payload after the operator hits
 * Save. A cell is "changed" when its allowed value differs OR when
 * it's been newly toggled on (the original side has no entry).
 */
export function diffMatrices(
  base: Record<string, Record<string, boolean>>,
  draft: Record<string, Record<string, boolean>>,
): RbacUpsertCell[] {
  const cells: RbacUpsertCell[] = []
  const roleIDs = new Set<string>([...Object.keys(base), ...Object.keys(draft)])
  for (const roleID of roleIDs) {
    const baseRow = base[roleID] ?? {}
    const draftRow = draft[roleID] ?? {}
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
