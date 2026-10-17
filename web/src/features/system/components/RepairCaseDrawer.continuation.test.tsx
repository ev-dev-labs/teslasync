import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import { dataRepairKeys, type RepairCase, type RepairCaseDetailResponse } from '@/api/hooks/useDataRepair';
import { RepairCaseDrawer } from './RepairCaseDrawer';

const transport = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ request: transport }));
vi.mock('react-i18next', async (importActual) => ({
  ...await importActual<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en' },
  }),
}));

const repairCase: RepairCase = {
  id: 7, fingerprint: 'drive:42:drive_open_charging_started', kind: 'drive',
  session_id: 42, vehicle_id: 3, rule: 'drive_open_charging_started',
  confidence: 'high', status: 'open', applicable: true, assigned_to: 'Review operator',
  suggested_ended_at: '2026-08-25T10:00:00Z',
  evidence_started_at: '2026-08-25T09:00:00Z',
  evidence_contradiction_ts: '2026-08-25T10:00:00Z',
  evidence_contradiction_src: 'charging_sessions',
  evidence_contradiction_field: 'started_at',
  evidence_contradiction_value: '2026-08-25T10:00:00Z',
  evidence_last_in_session_ts: '2026-08-25T09:58:00Z',
  evidence_last_in_session_src: 'signal_log',
  evidence_last_in_session_field: 'gear', evidence_last_in_session_value: 'D',
  evidence_gap_s: 120,
  first_seen_at: '2026-08-25T10:01:00Z', last_seen_at: '2026-08-25T10:02:00Z',
  created_at: '2026-08-25T10:01:00Z', updated_at: '2026-08-25T10:02:00Z',
};
const detail: RepairCaseDetailResponse = {
  case: repairCase,
  comments: [{
    id: 11, case_id: 7, actor: 'Evidence reviewer',
    body: 'Original full note\nSecond line retained',
    created_at: '2026-08-25T10:04:00Z',
  }],
  quarantine: null,
};

function renderDrawer(canWrite = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const ui = (write: boolean) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <RepairCaseDrawer caseId={7} onClose={onClose} canWrite={write} writeBlockReason="Return to live mode" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ...render(ui(canWrite)), client, ui, onClose };
}

function writes() {
  return transport.mock.calls.filter(([, options]) => (options as RequestInit | undefined)?.method === 'POST');
}

beforeEach(() => {
  transport.mockReset();
  transport.mockImplementation(() => Promise.resolve(detail));
});

describe('RepairCaseDrawer continuation preservation', () => {
  it('retains case evidence, complete comments, assignment and action affordances after detail refresh failure', async () => {
    const { client } = renderDrawer();
    await screen.findByText('Evidence reviewer');
    transport.mockRejectedValue(new Error('detail refresh unavailable'));
    await act(async () => {
      await client.refetchQueries({ queryKey: dataRepairKeys.case(7) });
    });
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Case #7' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Integrity finding' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence chain' })).toBeInTheDocument();
    expect(screen.getByText('Original full note Second line retained').textContent).toBe('Original full note\nSecond line retained');
    expect(screen.getByRole('textbox', { name: 'Assignee' })).toHaveValue('Review operator');
    expect(screen.getByRole('button', { name: 'Review & apply' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Resolve case' })).toBeEnabled();
    expect(writes()).toHaveLength(0);
  });

  it('keeps retained evidence readable with all write affordances disabled in read-only mode', async () => {
    renderDrawer(false);
    await screen.findByText('Evidence reviewer');
    for (const name of ['Begin review', 'Resolve case', 'Review & apply', 'Dismiss finding', 'Move to quarantine', 'Save assignment', 'Add note']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByRole('textbox', { name: 'Assignee' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Add review note' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Evidence chain' })).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('disables an already-open resolution confirmation if write permission is lost without dropping its note', async () => {
    const { rerender, ui } = renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve case' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resolve this case?' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Operator note' }), { target: { value: 'Reviewed durable evidence' } });
    expect(within(dialog).getByRole('button', { name: 'Resolve case' })).toBeEnabled();
    rerender(ui(false));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Resolve case' })).toBeDisabled());
    expect(within(dialog).getByRole('textbox', { name: 'Operator note' })).toBeDisabled();
    expect(within(dialog).getByRole('textbox', { name: 'Operator note' })).toHaveValue('Reviewed durable evidence');
    expect(within(dialog).getByRole('note')).toHaveTextContent('Return to live mode');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve case' }));
    expect(writes()).toHaveLength(0);
  });

  it('disables an already-open controlled-action confirmation if write permission is lost', async () => {
    const { rerender, ui } = renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss finding' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dismiss this finding?' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Operator note' }), { target: { value: 'Source finding reviewed' } });
    expect(within(dialog).getByRole('button', { name: 'Dismiss finding' })).toBeEnabled();
    rerender(ui(false));
    expect(within(dialog).getByRole('button', { name: 'Dismiss finding' })).toBeDisabled();
    expect(within(dialog).getByRole('textbox', { name: 'Operator note' })).toHaveValue('Source finding reviewed');
    expect(within(dialog).getByRole('note')).toHaveTextContent('Return to live mode');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss finding' }));
    expect(writes()).toHaveLength(0);
  });
});
