import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';
import type { ActivityKind, ActivityListParams, ActivityListResponse } from '@/types/activity';

/**
 * TanStack Query hook for the unified vehicle operations-intelligence
 * activity timeline (`GET /api/v1/activity`).
 *
 * Wire contract: `internal/api/activity` (handler) + `internal/database/activity`
 * (repository, one UNION ALL query over drives, charging_sessions,
 * notification_logs, software_updates, and chart_annotations).
 *
 * Distinct from:
 *   - `useMyRecentActivity` (`useUser.ts`) — the signed-in user's own
 *     audit-log actions, not vehicle domain events.
 *   - FSM state-transition timeline data backing `/timeline`.
 */

export const activityKeys = {
  all: ['activity'] as const,
  list: (params: ActivityListParams) =>
    [
      'activity',
      params.vehicle_id ?? 'all',
      params.start ?? '',
      params.end ?? '',
      [...(params.kind ?? [])].sort().join(','),
      params.limit ?? 50,
      params.offset ?? 0,
    ] as const,
};

function buildActivityQuery(params: ActivityListParams): string {
  const usp = new URLSearchParams();
  if (params.vehicle_id != null) usp.set('vehicle_id', String(params.vehicle_id));
  if (params.start) usp.set('start', params.start);
  if (params.end) usp.set('end', params.end);
  for (const kind of params.kind ?? []) usp.append('kind', kind);
  if (params.limit != null) usp.set('limit', String(params.limit));
  if (params.offset != null) usp.set('offset', String(params.offset));
  return usp.toString();
}

/**
 * Rejects a missing/malformed envelope instead of presenting transport or
 * server corruption as a successful empty timeline.
 */
function assertActivityResponse(data: ActivityListResponse | null | undefined): ActivityListResponse {
  if (
    !data
    || !Array.isArray(data.items)
    || !Number.isFinite(data.total)
    || !Number.isFinite(data.limit)
    || !Number.isFinite(data.offset)
    || typeof data.generated_at !== 'string'
  ) {
    throw new Error('Invalid activity response');
  }
  return data;
}

export interface UseActivityOptions extends ActivityListParams {
  enabled?: boolean;
}

/**
 * Fetches a page of the unified activity timeline. `select` validates the
 * envelope so malformed responses surface through the normal query error UI.
 */
export function useActivity(params: UseActivityOptions = {}) {
  const { enabled = true, ...query } = params;
  const queryString = buildActivityQuery(query);
  return useQuery({
    queryKey: activityKeys.list(query),
    queryFn: ({ signal }) =>
      request<ActivityListResponse>(
        queryString ? `/activity?${queryString}` : '/activity',
        { signal },
      ),
    select: assertActivityResponse,
    staleTime: STALE_TIMES.STANDARD,
    enabled,
  });
}

export type { ActivityKind, ActivityListParams, ActivityListResponse };
