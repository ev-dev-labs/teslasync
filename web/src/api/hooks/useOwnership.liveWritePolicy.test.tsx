import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPERATIONAL_MODE_READ_ONLY_CODE } from '@/lib/operationalMode';
import {
  ownershipKeys, useCreateDispute, useCreateInvoice, useCreateSubscription,
  useDeleteInsurancePolicy, useDeleteInvoice, useDeleteRetentionPolicy,
  useDeleteSubscription, useSimulateGovernance, useUpsertInsurancePolicy,
  useUpsertRetentionPolicy,
} from './useOwnership';

const { success, error, resilientFetch } = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), resilientFetch: vi.fn(),
}));
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success, error }),
}));
vi.mock('@/lib/resilience', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/resilience')>(),
  resilientFetch,
}));

const insurance = {
  vehicle_id: 7, insurer: 'Test insurer', policy_ref: 'policy-7', currency: 'USD',
  annual_premium_minor: 120000, deductible_minor: 50000,
  coverage_start: '2026-01-01', coverage_end: null, telematics_program: true,
  max_discount_pct: 10,
};
const invoice = {
  vehicle_id: 7, provider: 'Test provider', invoice_ref: 'invoice-7', currency: 'USD',
  period_start: '2026-01-01', period_end: '2026-02-01', billed_total_minor: 1200, lines: [],
};
const dispute = { claimed_minor: 200, reasons: ['duplicate'], note: 'Reviewed', confirmed: true };
const policy = {
  dataset: 'signal_log', retention_s: 86400, downsample_after_s: null,
  downsample_bucket_s: null, legal_hold: false, enabled: true,
};
const plan = { datasets: ['signal_log'], confirmed: true };
const subscription = {
  vehicle_id: 7, name: 'Connectivity', kind: 'subscription' as const,
  billing_period: 'monthly' as const, price_minor: 1000, currency: 'USD',
  usage_metric: 'connectivity_time' as const, benchmark_minor_per_unit: 1,
  started_at: '2026-01-01', ended_at: null,
};

interface WriteCase {
  name: string;
  path: string;
  method: string;
  body?: object;
  key: readonly unknown[];
  useSubmit: () => () => Promise<unknown>;
}

const writes: WriteCase[] = [
  { name: 'insurance PUT', path: '/insurance-telematics/policy', method: 'PUT',
    body: insurance, key: ownershipKeys.all,
    useSubmit: () => { const mutation = useUpsertInsurancePolicy(); return () => mutation.mutateAsync(insurance); } },
  { name: 'insurance DELETE', path: '/insurance-telematics/policy/7', method: 'DELETE',
    key: ownershipKeys.all,
    useSubmit: () => { const mutation = useDeleteInsurancePolicy(); return () => mutation.mutateAsync(7); } },
  { name: 'invoice POST', path: '/charging-reconciliation/invoices', method: 'POST',
    body: invoice, key: ownershipKeys.all,
    useSubmit: () => { const mutation = useCreateInvoice(); return () => mutation.mutateAsync(invoice); } },
  { name: 'invoice DELETE', path: '/charging-reconciliation/invoices/7', method: 'DELETE',
    key: ownershipKeys.all,
    useSubmit: () => { const mutation = useDeleteInvoice(); return () => mutation.mutateAsync(7); } },
  { name: 'dispute POST', path: '/charging-reconciliation/invoices/7/disputes', method: 'POST',
    body: dispute, key: ownershipKeys.all,
    useSubmit: () => { const mutation = useCreateDispute(7); return () => mutation.mutateAsync(dispute); } },
  { name: 'governance PUT', path: '/data-governance/policies', method: 'PUT',
    body: policy, key: ownershipKeys.all,
    useSubmit: () => { const mutation = useUpsertRetentionPolicy(); return () => mutation.mutateAsync(policy); } },
  { name: 'governance DELETE', path: '/data-governance/policies/7', method: 'DELETE',
    key: ownershipKeys.all,
    useSubmit: () => { const mutation = useDeleteRetentionPolicy(); return () => mutation.mutateAsync(7); } },
  { name: 'recorded plan POST', path: '/data-governance/simulate', method: 'POST',
    body: plan, key: ownershipKeys.governanceRunsAll(),
    useSubmit: () => { const mutation = useSimulateGovernance(); return () => mutation.mutateAsync(plan); } },
  { name: 'subscription POST', path: '/subscription-roi/subscriptions', method: 'POST',
    body: subscription, key: ownershipKeys.all,
    useSubmit: () => { const mutation = useCreateSubscription(); return () => mutation.mutateAsync(subscription); } },
  { name: 'subscription DELETE', path: '/subscription-roi/subscriptions/7', method: 'DELETE',
    key: ownershipKeys.all,
    useSubmit: () => { const mutation = useDeleteSubscription(); return () => mutation.mutateAsync(7); } },
];

const clients: QueryClient[] = [];
function setup(useSubmit: WriteCase['useSubmit']) {
  // Hostile defaults prove the hook itself prevents offline queuing and retries.
  const client = new QueryClient({
    defaultOptions: { mutations: { networkMode: 'online', retry: 2, retryDelay: 0 } },
  });
  clients.push(client);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { ...renderHook(useSubmit, { wrapper: Wrapper }), client, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  onlineManager.setOnline(true);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ id: 7 }), { headers: { 'Content-Type': 'application/json' } }),
  );
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
  onlineManager.setOnline(true);
});

describe.each(writes)('$name live-only request policy', (write) => {
  it('preserves live request scope/body and invalidates only after success', async () => {
    const { result, invalidate } = setup(write.useSubmit);
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => { await result.current(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1${write.path}`),
      expect.objectContaining({
        method: write.method,
        ...(write.body ? { body: JSON.stringify(write.body) } : {}),
      }),
    );
    if (!write.body) expect(vi.mocked(fetch).mock.calls[0]?.[1]?.body).toBeUndefined();
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: write.key });
    expect(success).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    { mode: 'replay', asOf: '2026-01-01T00:00:00Z', online: true, connected: true, expected: 'as_of' },
    { mode: 'cached', asOf: null, online: false, connected: true, expected: 'cached' },
    { mode: 'offline', asOf: null, online: false, connected: false, expected: 'cached' },
  ])('rejects $mode immediately and never executes after reconnect', async (mode) => {
    window.history.replaceState(null, '', mode.asOf ? `/?as_of=${mode.asOf}` : '/');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(mode.online);
    onlineManager.setOnline(mode.connected);
    const { result, client, invalidate } = setup(write.useSubmit);
    await act(async () => {
      await expect(result.current()).rejects.toMatchObject({
        code: OPERATIONAL_MODE_READ_ONLY_CODE, mode: mode.expected,
      });
    });
    expect(client.getMutationCache().getAll()[0]?.state).toMatchObject({
      status: 'error', isPaused: false, failureCount: 1,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(resilientFetch).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.history.replaceState(null, '', '/');
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      onlineManager.setOnline(true);
      window.dispatchEvent(new Event('online'));
      await client.resumePausedMutations();
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(resilientFetch).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not retry or invalidate a cancelled request', async () => {
    vi.mocked(fetch).mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    const { result, invalidate } = setup(write.useSubmit);
    await act(async () => {
      await expect(result.current()).rejects.toMatchObject({ name: 'AbortError' });
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(resilientFetch).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

it.each([null, 0, -1])('preserves dispute invoice validation for %s', async (invoiceId) => {
  const { result, invalidate } = setup(() => {
    const mutation = useCreateDispute(invoiceId);
    return () => mutation.mutateAsync(dispute);
  });
  await act(async () => {
    await expect(result.current()).rejects.toThrow('invoice id must be a positive integer');
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
});
