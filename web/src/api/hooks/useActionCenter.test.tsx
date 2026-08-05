import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ActionCenterActionResult,
  ActionCenterRecommendation,
  ActionCenterResponse,
} from '@/types/actionCenter';

const requestMock = vi.fn();
vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import {
  actionCenterKeys,
  useActionCenter,
  useActionCenterHistory,
  useApplyActionCenterAction,
} from './useActionCenter';

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { Wrapper, client };
}

const recommendation: ActionCenterRecommendation = {
  id: 'ac_0123456789abcdef01234567',
  fingerprint: 'a'.repeat(64),
  source_feature: 'active_alerts',
  related_sources: ['active_alerts'],
  vehicle: { id: 7, display_name: 'Orion' },
  title: 'Review alert',
  summary: 'Alert remains active.',
  rationale: 'Persisted evidence.',
  priority: 'high',
  severity: 'warning',
  rank: { score: 410, basis: ['priority high +300'] },
  confidence: { score: 0.8, label: 'high', basis: ['Direct record'] },
  evidence: [],
  projected_impact: null,
  safe_actions: ['acknowledge', 'snooze', 'dismiss', 'restore', 'navigate'],
  navigation_path: '/alerts',
  expires_at: '2026-03-01T00:00:00Z',
  freshness: { status: 'fresh', observed_at: '2026-02-20T00:00:00Z', age_s: 60 },
  limitations: [],
  current_state: { status: 'open', version: 0, snoozed_until: null, updated_at: null },
  action_history: [],
};

const response: ActionCenterResponse = {
  items: [recommendation],
  total: 1,
  limit: 25,
  offset: 0,
  generated_at: '2026-02-20T00:00:00Z',
  summary: { open: 1, acknowledged: 0, snoozed: 0, dismissed: 0, critical: 0, high: 1 },
  provider_status: [],
};

beforeEach(() => requestMock.mockReset());

describe('Action Center queries', () => {
  it('uses the mounted route with snake_case filters and no API prefix', async () => {
    requestMock.mockResolvedValueOnce(response);
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () =>
        useActionCenter({
          vehicle_id: 7,
          source_feature: 'active_alerts',
          priority: 'high',
          state: 'open',
          limit: 25,
          offset: 0,
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, options] = requestMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      '/action-center?vehicle_id=7&priority=high&source_feature=active_alerts&state=open&limit=25&offset=0',
    );
    expect(url).not.toContain('/api/v1/');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('guards history requests until a recommendation ID exists', () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useActionCenterHistory(undefined), {
      wrapper: Wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('Action Center actions', () => {
  it('optimistically updates state and sends the confirmation contract', async () => {
    let resolveRequest: (value: ActionCenterActionResult) => void = () => undefined;
    requestMock.mockImplementationOnce(
      () =>
        new Promise<ActionCenterActionResult>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const { Wrapper, client } = wrapper();
    const listKey = actionCenterKeys.list({ limit: 25 });
    client.setQueryData(listKey, response);
    const { result } = renderHook(() => useApplyActionCenterAction(), { wrapper: Wrapper });
    const input = {
      recommendation_id: recommendation.id,
      fingerprint: recommendation.fingerprint,
      action: 'dismiss' as const,
      expected_version: 0,
      confirmed: true as const,
      snoozed_until: null,
    };

    act(() => result.current.mutate(input));
    await waitFor(() => {
      const cached = client.getQueryData<ActionCenterResponse>(listKey);
      expect(cached?.items[0]?.current_state).toMatchObject({
        status: 'dismissed',
        version: 1,
      });
    });
    const [url, options] = requestMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/action-center/${recommendation.id}/actions`);
    expect(JSON.parse(String(options.body))).toEqual({
      fingerprint: recommendation.fingerprint,
      action: 'dismiss',
      expected_version: 0,
      confirmed: true,
      snoozed_until: null,
    });

    await act(async () => {
      resolveRequest({
        recommendation: {
          ...recommendation,
          current_state: {
            status: 'dismissed',
            version: 1,
            snoozed_until: null,
            updated_at: '2026-02-20T00:01:00Z',
          },
        },
        event: {
          id: 1,
          recommendation_id: recommendation.id,
          fingerprint: recommendation.fingerprint,
          action: 'dismiss',
          from_state: 'open',
          to_state: 'dismissed',
          outcome: 'applied',
          state_version: 1,
          occurred_at: '2026-02-20T00:01:00Z',
        },
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
