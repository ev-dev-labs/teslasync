import { type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { CausalExperiment, CreateCausalExperimentRequest } from '@/types/advancedIntelligence';
import {
  OPERATIONAL_MODE_READ_ONLY_CODE,
  OperationalModeWriteError,
  readOperationalModeFromEnvironment,
} from '@/lib/operationalMode';
import {
  ApiError,
  __resetSudoStateForTests,
  registerSudoChallengeProvider,
  setCachedSudoToken,
  SudoCanceledError,
} from '../client';
import { advancedIntelligenceKeys, useCreateCausalExperiment } from './useAdvancedIntelligence';

// Keep request, operationalMode and resilience real; only the HTTP/feedback boundaries are mocked.
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('./_toastHelpers', () => ({ useMutationToast: () => toast }));

const endpoint = '/api/v1/advanced-intelligence/causal-experiments';
const payload: CreateCausalExperimentRequest = Object.freeze({
  vehicle_id: 42,
  intervention_kind: 'charging_schedule',
  metric: 'drive_energy_wh_per_m',
  baseline_start: '2026-01-01T00:00:00Z',
  baseline_end: '2026-01-02T00:00:00Z',
  treatment_start: '2026-01-03T00:00:00Z',
  treatment_end: '2026-01-04T00:00:00Z',
  confirmed: true,
});
const estimate: CausalExperiment = {
  id: 9,
  vehicle_id: payload.vehicle_id,
  intervention_kind: payload.intervention_kind,
  metric: payload.metric,
  baseline_start: payload.baseline_start,
  baseline_end: payload.baseline_end,
  treatment_start: payload.treatment_start,
  treatment_end: payload.treatment_end,
  state: 'estimated',
  version: 1,
  baseline_sample_count: 12,
  treatment_sample_count: 11,
  confounder_coverage_pct: 0,
  baseline_energy_wh_per_m: 0.18,
  treatment_energy_wh_per_m: 0.16,
  effect_energy_wh_per_m: -0.02,
  baseline_success_pct: null,
  treatment_success_pct: null,
  effect_success_pct: null,
  baseline_speed_mps: 22.125,
  treatment_speed_mps: 22.125,
  effect_speed_mps: 0,
  created_at: '2026-01-05T00:00:00Z',
  updated_at: '2026-01-05T00:00:00Z',
  data_quality: {
    status: 'limited', sample_count: 23, coverage_pct: 0,
    window_start: payload.baseline_start, window_end: payload.treatment_end,
    reasons: ['Synthetic fixture'],
  },
  evidence: [],
  limitations: ['Observational estimate'],
};

let fetchMock: MockInstance<typeof fetch>;
const clients: QueryClient[] = [];
const originalOnline = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
const originalLocation = window.location.href;

function setMode(online: boolean, asOf: string | null = null) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true, get: () => online,
  });
  window.history.replaceState({}, '', asOf
    ? `/intelligence/causal-lab?as_of=${encodeURIComponent(asOf)}`
    : '/intelligence/causal-lab');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const key = advancedIntelligenceKeys.causalExperiments(42, 25, 0);
  const otherPageKey = advancedIntelligenceKeys.causalExperiments(7, 10, 10);
  const federatedKey = advancedIntelligenceKeys.federatedStatus(42, 25, 0);
  const retained = { items: [estimate], total: 1, limit: 25, offset: 0 };
  client.setQueryData(key, retained);
  client.setQueryData(otherPageKey, { items: [], total: 0, limit: 10, offset: 10 });
  client.setQueryData(federatedKey, { items: [], total: 0, limit: 25, offset: 0 });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const hook = renderHook(() => useCreateCausalExperiment(), { wrapper: Wrapper });
  return { ...hook, client, key, otherPageKey, federatedKey, retained, invalidate };
}

type Fixture = ReturnType<typeof setup>;

function expectPost(index: number, body: CreateCausalExperimentRequest = payload) {
  const [url, options] = fetchMock.mock.calls[index] as [string, RequestInit];
  expect(url).toBe(endpoint);
  expect(options.method).toBe('POST');
  expect(options.body).toBe(JSON.stringify(body));
  expect(JSON.parse(options.body as string)).toEqual(body);
  expect(new Headers(options.headers).get('Content-Type')).toBe('application/json');
  // The policy is consumed by request; it must not leak into HTTP RequestInit.
  expect(options).not.toHaveProperty('requiresLiveMode');
}

function expectRetainedWithoutSuccess(fixture: Fixture) {
  expect(fixture.invalidate).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(fixture.client.getQueryData(fixture.key)).toBe(fixture.retained);
  for (const key of [fixture.key, fixture.otherPageKey, fixture.federatedKey]) {
    expect(fixture.client.getQueryState(key)?.isInvalidated).toBe(false);
  }
}

function expectSuccess(fixture: Fixture) {
  expect(fixture.invalidate).toHaveBeenCalledExactlyOnceWith({
    queryKey: ['advanced-intelligence', 'causal-experiments'],
  });
  expect(fixture.client.getQueryState(fixture.key)?.isInvalidated).toBe(true);
  expect(fixture.client.getQueryState(fixture.otherPageKey)?.isInvalidated).toBe(true);
  expect(fixture.client.getQueryState(fixture.federatedKey)?.isInvalidated).toBe(false);
  expect(fixture.client.getQueryData(fixture.key)).toBe(fixture.retained);
  expect(toast.success).toHaveBeenCalledExactlyOnceWith(
    'advancedIntelligence.causal.toast', 'Experiment estimate created', { vehicle_id: 42 },
  );
  expect(toast.error).not.toHaveBeenCalled();
}

async function rejectMutation(fixture: Fixture, body = payload): Promise<unknown> {
  let error: unknown;
  await act(async () => {
    try {
      await fixture.result.current.mutateAsync(body);
    } catch (caught) {
      error = caught;
    }
  });
  await waitFor(() => expect(fixture.result.current.isError).toBe(true));
  expect(fixture.result.current.error).toBe(error);
  expect(fixture.result.current.variables).toBe(body);
  expect(fixture.result.current.data).toBeUndefined();
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(
    error, 'advancedIntelligence.toast.error', 'Advanced intelligence request failed',
  );
  expectRetainedWithoutSuccess(fixture);
  return error;
}

beforeEach(() => {
  __resetSudoStateForTests();
  toast.success.mockReset();
  toast.error.mockReset();
  setMode(true);
  // Every possible real-client network path ends here, never at actual HTTP.
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse(estimate));
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  __resetSudoStateForTests();
  vi.restoreAllMocks();
  if (originalOnline) Object.defineProperty(window.navigator, 'onLine', originalOnline);
  else Reflect.deleteProperty(window.navigator, 'onLine');
  window.history.replaceState({}, '', originalLocation);
});

describe('useCreateCausalExperiment real causal live write guard', () => {
  it('live confirmed canonical POST preserves immutable input raw SI response and success-only causal invalidation', async () => {
    const fixture = setup();
    expect(readOperationalModeFromEnvironment()).toMatchObject({ mode: 'live', isReadOnly: false });
    let response: CausalExperiment | undefined;
    await act(async () => { response = await fixture.result.current.mutateAsync(payload); });
    await waitFor(() => expect(fixture.result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectPost(0);
    expect(Object.isFrozen(payload)).toBe(true);
    expect(fixture.result.current.variables).toBe(payload);
    expect(response).toMatchObject(estimate);
    expect(fixture.result.current.data).toBe(response);
    expect(response).toMatchObject({
      baseline_energy_wh_per_m: 0.18, treatment_energy_wh_per_m: 0.16,
      effect_energy_wh_per_m: -0.02, baseline_speed_mps: 22.125,
      effect_speed_mps: 0, baseline_success_pct: null, confounder_coverage_pct: 0,
    });
    expectSuccess(fixture);
  });

  it.each([
    { caseName: 'energy SI metric', metric: 'drive_energy_wh_per_m' },
    { caseName: 'charging percentage metric', metric: 'charging_success_pct' },
    { caseName: 'speed SI metric', metric: 'average_speed_mps' },
  ] as const)('live accepts $caseName without rewriting canonical request fields', async ({ metric }) => {
    const fixture = setup();
    const body = Object.freeze({ ...payload, metric, intervention_kind: 'synthetic intervention' });
    await act(async () => { await fixture.result.current.mutateAsync(body); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectPost(0, body);
    expect(fixture.result.current.variables).toBe(body);
    expectSuccess(fixture);
  });

  it.each([
    { caseName: 'online historical as_of', online: true, asOf: '2026-01-05T00:00:00Z', mode: 'as_of' },
    { caseName: 'offline cached', online: false, asOf: null, mode: 'cached' },
    { caseName: 'offline historical as_of', online: false, asOf: '2026-01-05T00:00:00Z', mode: 'as_of' },
  ] as const)('$caseName rejects before POST or SUDO and retains cache and exact guard error', async ({ online, asOf, mode }) => {
    setMode(online, asOf);
    setCachedSudoToken({ token: 'synthetic-cached-sudo', expiresAtMs: Date.now() + 60_000 });
    const challenge = vi.fn();
    registerSudoChallengeProvider(challenge);
    const fixture = setup();
    expect(readOperationalModeFromEnvironment()).toMatchObject({ mode, online, isReadOnly: true });
    const error = await rejectMutation(fixture);
    expect(error).toBeInstanceOf(OperationalModeWriteError);
    expect(error).toMatchObject({ name: 'OperationalModeWriteError', code: OPERATIONAL_MODE_READ_ONLY_CODE, mode });
    expect((error as Error).message).toBe(mode === 'as_of'
      ? 'Changes are unavailable while viewing historical data. Return to live mode first.'
      : 'Changes are unavailable while offline. Reconnect before trying again.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(challenge).not.toHaveBeenCalled();
  });

  it('offline rejection does not replay on reconnect and only explicit live retry succeeds', async () => {
    setMode(false);
    const fixture = setup();
    const error = await rejectMutation(fixture);
    setMode(true);
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.result.current.error).toBe(error);
    expectRetainedWithoutSuccess(fixture);
    toast.error.mockClear();
    await act(async () => { await fixture.result.current.mutateAsync(payload); });
    await waitFor(() => expect(fixture.result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectPost(0);
    expectSuccess(fixture);
  });

  it('live unconfirmed input reaches normal server validation unchanged and failed mutation retains reads', async () => {
    const fixture = setup();
    const body = Object.freeze({ ...payload, confirmed: false });
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'Confirmation required', code: 'CONFIRMATION_REQUIRED' }, 422));
    const error = await rejectMutation(fixture, body);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: 'CONFIRMATION_REQUIRED', message: 'Confirmation required' });
    // Preserve the existing direct request followed by normal resilient fallback.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectPost(0, body);
    expectPost(1, body);
    expect(body.confirmed).toBe(false);
  });

  it('live AbortError propagates unchanged without fallback POST or success invalidation', async () => {
    const fixture = setup();
    const aborted = new DOMException('Synthetic cancellation', 'AbortError');
    fetchMock.mockRejectedValue(aborted);
    expect(await rejectMutation(fixture)).toBe(aborted);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectPost(0);
  });

  it('live SUDO challenge replays identical POST body with token and invalidates only after success', async () => {
    const fixture = setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Step-up required', code: 'SUDO_REQUIRED' }, 401));
    const challenge = vi.fn(async () => {
      expectRetainedWithoutSuccess(fixture);
      return { mode: 'session' as const, token: 'synthetic-sudo', expiresAt: new Date(Date.now() + 60_000).toISOString() };
    });
    registerSudoChallengeProvider(challenge);
    await act(async () => { await fixture.result.current.mutateAsync(payload); });
    expect(challenge).toHaveBeenCalledExactlyOnceWith('/advanced-intelligence/causal-experiments');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectPost(0);
    expectPost(1);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('X-Sudo-Token')).toBe(false);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('X-Sudo-Token')).toBe('synthetic-sudo');
    expectSuccess(fixture);
  });

  it('live cached SUDO token is preserved without challenge or request body changes', async () => {
    setCachedSudoToken({ token: 'synthetic-cached-sudo', expiresAtMs: Date.now() + 60_000 });
    const challenge = vi.fn();
    registerSudoChallengeProvider(challenge);
    const fixture = setup();
    await act(async () => { await fixture.result.current.mutateAsync(payload); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectPost(0);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('X-Sudo-Token')).toBe('synthetic-cached-sudo');
    expect(challenge).not.toHaveBeenCalled();
    expectSuccess(fixture);
  });

  it('live canceled SUDO retains original error without replay POST or success invalidation', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Step-up required', code: 'SUDO_REQUIRED' }, 401));
    const canceled = new SudoCanceledError('Synthetic cancellation');
    const challenge = vi.fn(async () => { throw canceled; });
    registerSudoChallengeProvider(challenge);
    const fixture = setup();
    expect(await rejectMutation(fixture)).toBe(canceled);
    expect(challenge).toHaveBeenCalledExactlyOnceWith('/advanced-intelligence/causal-experiments');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectPost(0);
  });
});
