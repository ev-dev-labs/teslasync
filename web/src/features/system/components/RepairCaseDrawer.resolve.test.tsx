import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import { dataRepairKeys, type RepairCase } from '@/api/hooks/useDataRepair';
import { RepairCaseDrawer } from './RepairCaseDrawer';

const transport = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ request: transport }));
vi.mock('react-i18next', async importActual => ({
  ...await importActual<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
    const text = typeof fallback === 'string' ? fallback : String(fallback?.defaultValue ?? key);
    const args = typeof fallback === 'object' ? fallback : values;
    return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(args?.[name] ?? ''));
  }, i18n: { language: 'en' } }),
}));
const initial: RepairCase = {
  id: 7, fingerprint: 'drive:42:duration_mismatch', kind: 'drive', session_id: 42, vehicle_id: 3,
  rule: 'duration_mismatch', confidence: 'high', status: 'open', applicable: false,
  blocked_reason: 'structural_anomaly_requires_manual_correction',
  evidence_started_at: '2026-08-25T09:00:00Z', evidence_contradiction_ts: '2026-08-25T10:00:00Z',
  evidence_contradiction_src: 'drives', evidence_contradiction_field: 'duration_s', evidence_contradiction_value: 'negative',
  evidence_gap_s: 0, first_seen_at: '2026-08-25T10:01:00Z', last_seen_at: '2026-08-25T10:02:00Z',
  created_at: '2026-08-25T10:01:00Z', updated_at: '2026-08-25T10:02:00Z',
};
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const notice = 'This structural anomaly requires a manual correction';
function setup() {
  let current = { ...initial };
  let read = () => Promise.resolve({ case: current, comments: [], quarantine: null });
  const request = deferred<RepairCase>();
  transport.mockImplementation((path: string, options?: RequestInit) => {
    if (path === '/data-repair/cases/7' && !options?.method) return read();
    if (path === '/data-repair/cases/7/transition') return request.promise.then(updated => { current = updated; return updated; });
    throw new Error(`Unexpected request: ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const openKey = dataRepairKeys.cases({ status: 'open' }); const allKey = dataRepairKeys.cases({});
  client.setQueryData(openKey, { cases: [current], has_more: false });
  client.setQueryData(allKey, { cases: [current], has_more: false });
  const ui = (caseId: number | null) => <QueryClientProvider client={client}><ToastProvider><MemoryRouter>
    <RepairCaseDrawer caseId={caseId} onClose={() => undefined} canWrite />
  </MemoryRouter></ToastProvider></QueryClientProvider>;
  const view = render(ui(7));
  return { client, request, openKey, allKey, view, ui, setRead: (next: typeof read) => { read = next; } };
}
async function confirmResolve() {
  fireEvent.click(await screen.findByRole('button', { name: 'Resolve case' }));
  const dialog = screen.getByRole('dialog', { name: 'Resolve this case?' });
  expect(within(dialog).getByRole('button', { name: 'Resolve case' })).toBeDisabled();
  expect(within(dialog).getByText(/Resolution records your review/)).toBeVisible();
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Operator note' }), { target: { value: 'Manual correction verified.' } });
  return within(dialog).getByRole('button', { name: 'Resolve case' });
}
beforeEach(() => { transport.mockReset(); });

describe('RepairCaseDrawer resolution', () => {
  it('sends the existing API contract once on double click, shows progress and updates detail and filtered lists', async () => {
    const { client, request, openKey, allKey } = setup();
    const confirm = await confirmResolve();
    fireEvent.click(confirm); fireEvent.click(confirm);
    await waitFor(() => expect(confirm).toHaveAttribute('aria-busy', 'true'));
    expect(confirm).toBeDisabled();
    const posts = transport.mock.calls.filter(([path]) => path.endsWith('/transition'));
    expect(posts).toHaveLength(1);
    expect(posts[0][1]).toMatchObject({ method: 'POST', requiresLiveMode: true, skipAuthRefresh: true });
    expect(JSON.parse(posts[0][1].body)).toEqual({ status: 'resolved', expected_updated_at: initial.updated_at, resolution_note: 'Manual correction verified.' });
    await act(async () => { request.resolve({ ...initial, status: 'resolved', blocked_reason: null, updated_at: '2026-08-25T10:05:00Z' }); });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Resolve this case?' })).toBeNull());
    expect(screen.getByText('Resolved', { exact: true })).toBeVisible();
    expect(client.getQueryData(openKey)).toMatchObject({ cases: [] });
    expect(client.getQueryData(allKey)).toMatchObject({ cases: [{ id: 7, status: 'resolved' }] });
    expect(screen.getByText(notice)).toBeVisible();
  });

  it('keeps the note and shows a persistent actionable failure without dropping the structural notice', async () => {
    const { request } = setup();
    fireEvent.click(await confirmResolve());
    await act(async () => { request.reject(new Error('repair case changed; reload and try again')); });
    const dialog = screen.getByRole('dialog', { name: 'Resolve this case?' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The case could not be updated. repair case changed; reload and try again');
    expect(within(dialog).getByRole('textbox', { name: 'Operator note' })).toHaveValue('Manual correction verified.');
    expect(within(dialog).getByRole('button', { name: 'Resolve case' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText(notice)).toBeVisible();
    expect(within(screen.getByRole('dialog', { name: 'Case #7' })).getByRole('alert')).toHaveTextContent('repair case changed; reload and try again');
  });

  it('retains the manual-correction notice on first load, pending refresh, refresh failure, metadata changes and reopen', async () => {
    const { client, view, ui, setRead } = setup();
    expect(await screen.findByText(notice)).toBeVisible();
    const refresh = deferred<{ case: RepairCase; comments: []; quarantine: null }>();
    setRead(() => refresh.promise);
    let fetching!: Promise<void>;
    act(() => { fetching = client.refetchQueries({ queryKey: dataRepairKeys.case(7) }); });
    expect(screen.getByText(notice)).toBeVisible();
    await act(async () => { refresh.reject(new Error('Refresh unavailable')); await fetching; });
    expect(screen.getByText(notice)).toBeVisible();
    act(() => { client.setQueryData(dataRepairKeys.case(7), { case: { ...initial, status: 'in_review', blocked_reason: null }, comments: [], quarantine: null }); });
    expect(screen.getByText(notice)).toBeVisible();
    view.rerender(ui(null));
    view.rerender(ui(7));
    expect(screen.getByText(notice)).toBeVisible();
  });
});
