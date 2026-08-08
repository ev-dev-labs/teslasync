import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { request } from '../client';
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
  list: (filter: ActionCenterFilter = {}) => ['action-center', 'list', filter] as const,
  history: (recommendationId: string | undefined) =>
    ['action-center', 'history', recommendationId ?? null] as const,
};

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

export function useActionCenter(filter: ActionCenterFilter = {}) {
  return useQuery({
    queryKey: actionCenterKeys.list(filter),
    queryFn: ({ signal }) =>
      request<ActionCenterResponse>(`/action-center${actionCenterQueryString(filter)}`, { signal }),
  });
}

export function useActionCenterHistory(
  recommendationId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: actionCenterKeys.history(recommendationId),
    queryFn: ({ signal }) =>
      request<ActionCenterHistoryPage>(
        `/action-center/${encodeURIComponent(recommendationId ?? '')}/history?limit=25&offset=0`,
        { signal },
      ),
    enabled: enabled && !!recommendationId,
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

export function useApplyActionCenterAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ApplyActionCenterActionInput) =>
      request<ActionCenterActionResult>(
        `/action-center/${encodeURIComponent(input.recommendation_id)}/actions`,
        {
          method: 'POST',
          body: JSON.stringify({
            fingerprint: input.fingerprint,
            action: input.action,
            expected_version: input.expected_version,
            confirmed: input.confirmed,
            snoozed_until: input.snoozed_until,
          }),
        },
      ),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: actionCenterKeys.lists });
      const snapshots = queryClient.getQueriesData<ActionCenterResponse>({
        queryKey: actionCenterKeys.lists,
      }) as ActionCenterSnapshot[];
      queryClient.setQueriesData<ActionCenterResponse>(
        { queryKey: actionCenterKeys.lists },
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
    onError: (_error, _input, context) => {
      context?.snapshots.forEach(([key, value]) => queryClient.setQueryData(key, value));
    },
    onSuccess: (result) => {
      queryClient.setQueriesData<ActionCenterResponse>(
        { queryKey: actionCenterKeys.lists },
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
