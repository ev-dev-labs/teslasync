import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataRepairKeys, type RepairCase, type RepairCaseDetailResponse } from '@/api/hooks/useDataRepair';
import { ToastProvider } from '@/components/feedback/Toast';
import english from '@/i18n/en.json';
import { RepairCaseDrawer } from './RepairCaseDrawer';

const transport = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ request: transport }));
vi.mock('react-i18next', async (importActual) =>
  await importActual<typeof import('react-i18next')>());

const repairCase: RepairCase = {
  id: 7,
  fingerprint: 'drive:42:drive_open_charging_started',
  kind: 'drive',
  session_id: 42,
  vehicle_id: 3,
  rule: 'drive_open_charging_started',
  confidence: 'high',
  status: 'open',
  applicable: true,
  assigned_to: 'Review operator',
  suggested_ended_at: '2026-08-25T10:00:00Z',
  evidence_started_at: '2026-08-25T09:00:00Z',
  evidence_contradiction_ts: '2026-08-25T10:00:00Z',
  evidence_contradiction_src: 'charging_sessions',
  evidence_contradiction_field: 'energy_used_wh',
  evidence_contradiction_value: '-1.00123456789',
  evidence_last_in_session_ts: '2026-08-25T09:58:00Z',
  evidence_last_in_session_src: 'signal_log',
  evidence_last_in_session_field: 'gear',
  evidence_last_in_session_value: 'D',
  evidence_gap_s: 120.125,
  first_seen_at: '2026-08-25T10:01:00Z',
  last_seen_at: '2026-08-25T10:02:00Z',
  created_at: '2026-08-25T10:01:00Z',
  updated_at: '2026-08-25T10:02:00Z',
};

function renderDrawer(confidence: RepairCase['confidence'], canWrite = true, localizedLabel?: string) {
  const i18n = createInstance();
  void i18n.init({
    lng: localizedLabel ? 'ar' : 'en',
    fallbackLng: 'en',
    initAsync: false,
    resources: {
      en: { translation: { dataRepair: english.dataRepair } },
      ...(localizedLabel ? {
        ar: { translation: { dataRepair: { confidence: { [confidence]: localizedLabel } } } },
      } : {}),
    },
    interpolation: { escapeValue: false },
  });
  const detail: RepairCaseDetailResponse = {
    case: { ...repairCase, confidence },
    comments: [{
      id: 11, case_id: 7, actor: 'Evidence reviewer',
      body: 'Original full note\nSecond line retained',
      created_at: '2026-08-25T10:04:00Z',
    }],
    quarantine: null,
  };
  transport.mockImplementation((path: string, options?: RequestInit) => {
    if (path === '/data-repair/cases/7' && !options?.method) return Promise.resolve(detail);
    return Promise.reject(new Error(`Unexpected test transport: ${path}`));
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <RepairCaseDrawer caseId={7} onClose={onClose} canWrite={canWrite} writeBlockReason="Read-only scope" />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { client, detail, onClose };
}

beforeEach(() => {
  transport.mockReset();
});

describe('RepairCaseDrawer confidence semantics', () => {
  it.each(['high', 'medium'] as const)('renders the canonical %s confidence badge once with neutral roles', async (confidence) => {
    const { detail } = renderDrawer(confidence);
    const dialog = await screen.findByRole('dialog', { name: 'Case #7' });
    await within(dialog).findByRole('heading', { name: english.dataRepair.cases.findingTitle });
    const label = english.dataRepair.confidence[confidence];
    const badge = within(dialog).getAllByText(label).find((element) => element.classList.contains('rounded-full'));
    expect(badge).toBeDefined();
    expect(badge).toHaveTextContent(label);
    expect(badge?.textContent).toBe(label);
    expect(badge).toHaveClass('bg-[var(--surface-2)]', 'text-[var(--text-secondary)]');
    expect(badge?.className).not.toMatch(/semantic-(success|danger|warning)/);
    expect(within(dialog).queryByText(`${label} confidence`)).not.toBeInTheDocument();
    expect(within(dialog).getByText(english.dataRepair.cases.status.open)).toHaveClass('text-[var(--semantic-danger)]');
    expect(within(dialog).getByText(english.dataRepair.cases.actionable)).toHaveClass('text-[var(--semantic-success)]');
    expect(within(dialog).getByText('charging_sessions · energy_used_wh · -1.00123456789')).toBeInTheDocument();
    expect(within(dialog).getByText('signal_log · gear · D')).toBeInTheDocument();
    for (const key of ['findingTitle', 'evidenceTitle', 'assignmentTitle', 'activityTitle', 'controlledActions'] as const) {
      expect(within(dialog).getByRole('heading', { name: english.dataRepair.cases[key] })).toBeInTheDocument();
    }
    for (const name of [
      english.dataRepair.cases.beginReview, english.dataRepair.cases.resolve,
      english.dataRepair.action.reviewApply, english.dataRepair.cases.dismiss,
      english.dataRepair.cases.quarantineAction, english.dataRepair.cases.saveAssignment,
    ]) {
      expect(within(dialog).getByRole('button', { name })).toBeEnabled();
    }
    expect(within(dialog).getByRole('textbox', { name: english.dataRepair.cases.assignee })).toHaveValue('Review operator');
    expect(detail.case).toEqual({ ...repairCase, confidence });
    expect(transport.mock.calls.every(([, options]) => !(options as RequestInit | undefined)?.method)).toBe(true);
  });

  it('renders a complete translated confidence label without adding English words', async () => {
    const label = 'ثقة عالية';
    renderDrawer('high', true, label);
    await screen.findByText('Evidence reviewer');
    const badge = screen.getAllByText(label).find((element) => element.classList.contains('rounded-full'));
    expect(badge?.textContent).toBe(label);
    expect(badge).toHaveClass('text-[var(--text-secondary)]');
    expect(screen.queryByText(`${label} confidence`)).not.toBeInTheDocument();
  });

  it('retains neutral confidence, severity, full evidence and read-only actions after a refresh failure', async () => {
    const { client } = renderDrawer('high', false);
    await screen.findByText('Evidence reviewer');
    transport.mockRejectedValue(new Error('detail refresh unavailable'));
    await act(async () => {
      await client.refetchQueries({ queryKey: dataRepairKeys.case(7) });
    });
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument();
    const badge = screen.getAllByText(english.dataRepair.confidence.high).find((element) => element.classList.contains('rounded-full'));
    expect(badge).toHaveClass('text-[var(--text-secondary)]');
    expect(screen.getByText('charging_sessions · energy_used_wh · -1.00123456789')).toBeInTheDocument();
    expect(screen.getByText('Original full note Second line retained').textContent).toBe('Original full note\nSecond line retained');
    for (const name of [
      english.dataRepair.cases.beginReview, english.dataRepair.cases.resolve,
      english.dataRepair.action.reviewApply, english.dataRepair.cases.dismiss,
      english.dataRepair.cases.quarantineAction, english.dataRepair.cases.saveAssignment,
      english.dataRepair.cases.addComment,
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole('button', { name: english.dataRepair.cases.resolve }));
    expect(screen.queryByRole('dialog', { name: english.dataRepair.cases.confirmResolve })).not.toBeInTheDocument();
    expect(transport.mock.calls.every(([, options]) => !(options as RequestInit | undefined)?.method)).toBe(true);
  });
});
