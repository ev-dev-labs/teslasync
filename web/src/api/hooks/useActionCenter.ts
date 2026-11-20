import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { isApiError, request } from '../client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';
import type {
  ActionCenterActionResult,
  ActionCenterFilter,
  ActionCenterHistoryPage,
  ActionCenterResponse,
  ActionCenterState,
  ApplyActionCenterActionInput,
} from '@/types/actionCenter';

export const actionCenterKeys = {
  all: ['action-center'] as const,
  lists: ['action-center', 'list'] as const,
  list: (filter: ActionCenterFilter = {}, scope?: PersonalScope | null) =>
    scope === undefined ? ['action-center', 'list', filter] as const
      : ['action-center', 'list', filter, scope] as const,
  history: (recommendationId: string | undefined) =>
    ['action-center', 'history', recommendationId ?? null] as const,
  historyPage: (
    recommendationId: string | undefined,
    paging: Pick<ActionCenterFilter, 'limit' | 'offset'> = {},
    scope?: PersonalScope,
  ) => scope === undefined
    ? [...actionCenterKeys.history(recommendationId), boundedHistoryPaging(paging)] as const
    : [...actionCenterKeys.history(recommendationId), boundedHistoryPaging(paging), scope] as const,
};

function boundedHistoryPaging(paging: Pick<ActionCenterFilter, 'limit' | 'offset'>) {
  return {
    limit: Number.isFinite(paging.limit)
      ? Math.max(1, Math.min(100, Math.floor(paging.limit!))) : 25,
    offset: Number.isFinite(paging.offset)
      ? Math.max(0, Math.min(100000, Math.floor(paging.offset!))) : 0,
  };
}

function actionCenterQueryString(filter: ActionCenterFilter): string {
  const params = new URLSearchParams();
  if (filter.vehicle_id != null) params.set('vehicle_id', String(filter.vehicle_id));
  if (filter.priority) params.set('priority', filter.priority);
  if (filter.source_feature) params.set('source_feature', filter.source_feature);
  if (filter.state) params.set('state', filter.state);
  if (filter.limit != null) params.set('limit', String(filter.limit));
  if (filter.offset != null) params.set('offset', String(filter.offset));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useActionCenter(filter: ActionCenterFilter = {}, scope?: PersonalScope | null, enabled = true) {
  return useQuery({
    queryKey: actionCenterKeys.list(filter, scope),
    queryFn: ({ signal }) =>
      request<ActionCenterResponse>(`/action-center${actionCenterQueryString(filter)}`, {
        signal, cache: 'no-store', ...(scope ? { headers: expectedPrincipalHeader(scope) } : {}),
      }),
    enabled: enabled && scope !== null,
    gcTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

export function useActionCenterHistory(
  recommendationId: string | undefined,
  enabled = true,
  paging: Pick<ActionCenterFilter, 'limit' | 'offset'> = {},
  scope?: PersonalScope,
) {
  const { limit, offset } = boundedHistoryPaging(paging);
  return useQuery({
    queryKey: actionCenterKeys.historyPage(recommendationId, { limit, offset }, scope),
    queryFn: ({ signal }) =>
      request<ActionCenterHistoryPage>(
        `/action-center/${encodeURIComponent(recommendationId ?? '')}/history?limit=${limit}&offset=${offset}`,
        { signal, cache: 'no-store', ...(scope ? { headers: expectedPrincipalHeader(scope) } : {}) },
      ),
    enabled: enabled && !!recommendationId,
    // Retain only another page of this recommendation, never another ID.
    placeholderData: (previousData, previousQuery) =>
      previousQuery != null && previousQuery.queryKey[2] === recommendationId &&
      JSON.stringify(previousQuery.queryKey[4]) === JSON.stringify(scope) ? previousData : undefined,
  });
}

type ActionCenterSnapshot = [QueryKey, ActionCenterResponse | undefined];

function stateForAction(
  action: ApplyActionCenterActionInput['action'],
): ActionCenterState {
  switch (action) {
    case 'acknowledge':
      return 'acknowledged';
    case 'snooze':
      return 'snoozed';
    case 'dismiss':
      return 'dismissed';
    case 'restore':
      return 'open';
  }
}

export function useApplyActionCenterAction(scope?: PersonalScope | null) {
  const queryClient = useQueryClient();
  const listsForScope = {
    queryKey: actionCenterKeys.lists,
    predicate: (query: { queryKey: QueryKey }) =>
      scope === undefined || JSON.stringify(query.queryKey[3]) === JSON.stringify(scope),
  };
  return useMutation({
    mutationFn: (input: ApplyActionCenterActionInput) =>
      request<ActionCenterActionResult>(
        `/action-center/${encodeURIComponent(input.recommendation_id)}/actions`,
        {
          method: 'POST',
          requiresLiveMode: true,
          ...(scope ? { headers: expectedPrincipalHeader(scope) } : {}),
          body: JSON.stringify({
            fingerprint: input.fingerprint,
            action: input.action,
            expected_version: input.expected_version,
            confirmed: input.confirmed,
            snoozed_until: input.snoozed_until,
          }),
        },
      ),
    networkMode: 'always',
    onMutate: async (input) => {
      await queryClient.cancelQueries(listsForScope);
      const snapshots = queryClient.getQueriesData<ActionCenterResponse>(listsForScope) as ActionCenterSnapshot[];
      queryClient.setQueriesData<ActionCenterResponse>(
        listsForScope,
        (current) => {
          if (!current) return current;
          return {
            ...current,
            items: current.items.map((item) =>
              item.id === input.recommendation_id
                ? {
                    ...item,
                    current_state: {
                      status: stateForAction(input.action),
                      version: item.current_state.version + 1,
                      snoozed_until: input.action === 'snooze' ? input.snoozed_until : null,
                      updated_at: new Date().toISOString(),
                    },
                  }
                : item,
            ),
          };
        },
      );
      return { snapshots };
    },
    onError: (error, _input, context) => {
      context?.snapshots.forEach(([key, value]) => queryClient.setQueryData(key, value));
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void queryClient.invalidateQueries({ queryKey: personalIdentityKey });
      }
    },
    onSuccess: (result) => {
      queryClient.setQueriesData<ActionCenterResponse>(
        listsForScope,
        (current) => {
          if (!current) return current;
          return {
            ...current,
            items: current.items.map((item) =>
              item.id === result.recommendation.id ? result.recommendation : item,
            ),
          };
        },
      );
    },
    onSettled: (_data, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: actionCenterKeys.all });
      void queryClient.invalidateQueries({
        queryKey: actionCenterKeys.history(input.recommendation_id),
      });
    },
  });
}
