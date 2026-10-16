import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { RepairCase, RepairQuarantine } from '@/api/hooks/useDataRepair';
import { ToastProvider } from '@/components/feedback/Toast';
import { RepairCaseWorkspace } from './RepairCaseWorkspace';

const mockRequest = vi.hoisted(() => vi.fn());

vi.mock('@/api/client', () => ({
  request: mockRequest,
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (template: string, values?: Record<string, unknown>) =>
    values
      ? template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => String(values[key] ?? `{{${key}}}`))
      : template;
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: unknown, values?: unknown) => {
        if (typeof fallback === 'string') {
          return interpolate(
            fallback,
            values && typeof values === 'object' ? values as Record<string, unknown> : undefined,
          );
        }
        if (fallback && typeof fallback === 'object') {
          const options = fallback as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') {
            return interpolate(options.defaultValue, options);
          }
        }
        return String(_key);
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

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
  suggested_ended_at: '2026-08-25T10:00:00Z',
  evidence_started_at: '2026-08-25T09:00:00Z',
  evidence_contradiction_ts: '2026-08-25T10:00:00Z',
  evidence_contradiction_src: 'charging_sessions',
  evidence_contradiction_field: 'started_at',
  evidence_contradiction_value: '2026-08-25T10:00:00Z',
  evidence_last_in_session_ts: '2026-08-25T09:58:00Z',
  evidence_last_in_session_src: 'signal_log',
  evidence_last_in_session_field: 'gear',
  evidence_last_in_session_value: 'D',
  evidence_gap_s: 120,
  first_seen_at: '2026-08-25T10:01:00Z',
  last_seen_at: '2026-08-25T10:02:00Z',
  created_at: '2026-08-25T10:01:00Z',
  updated_at: '2026-08-25T10:02:00Z',
};

const quarantine: RepairQuarantine = {
  id: 9,
  case_id: 7,
  kind: 'drive',
  session_id: 42,
  vehicle_id: 3,
  schema_version: 1,
  checksum: 'sha256:fixture',
  reason: 'Duplicate recovery artifact',
  quarantined_by: 'operator@example.com',
  quarantined_at: '2026-08-25T10:03:00Z',
};

function renderWorkspace() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RepairCaseWorkspace vehicleId={3} canWrite />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

describe('RepairCaseWorkspace', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockRequest.mockImplementation((url: string) => {
      if (url.startsWith('/data-repair/cases?')) {
        return Promise.resolve({ cases: [repairCase], has_more: false });
      }
      if (url === '/data-repair/cases/stats?vehicle_id=3') {
        return Promise.resolve({
          total: 1,
          open: 1,
          in_review: 0,
          applied: 0,
          dismissed: 0,
          quarantined: 0,
          restored: 0,
          resolved: 0,
          drive: 1,
          charging: 0,
          last_scan_at: '2026-08-25T10:02:00Z',
        });
      }
      if (url === '/data-repair/cases/7') {
        return Promise.resolve({ case: repairCase, comments: [], quarantine: null });
      }
      if (url === '/data-repair/cases/scan') {
        return Promise.resolve({ discovered: 1, refreshed: 0, truncated: false });
      }
      if (url === '/data-repair/cases/bulk-transition') {
        return Promise.resolve({ updated: 1, skipped: 0 });
      }
      if (url.startsWith('/data-repair/quarantine?')) {
        return Promise.resolve({ quarantines: [quarantine], has_more: false });
      }
      if (url === '/data-repair/drive/42/preview') {
        return Promise.resolve({
          kind: 'drive',
          session_id: 42,
          rule: 'drive_open_charging_started',
          source: 'suggestion',
          status: 'ready',
          started_at: '2026-08-25T09:00:00Z',
          current_ended_at: null,
          proposed_ended_at: '2026-08-25T10:00:00Z',
          current_duration_s: null,
          proposed_duration_s: 3600,
          fields_changed: [],
          fields_preserved: [],
          warnings: [],
        });
      }
      if (url === '/data-repair/drive/42/close') {
        return Promise.resolve({
          status: 'closed',
          session_id: 42,
          ended_at: '2026-08-25T10:00:00Z',
          duration_s: 3600,
        });
      }
      return Promise.resolve({});
    });
  });

  it('renders a durable case and opens its evidence-first review drawer', async () => {
    renderWorkspace();

    expect(await screen.findByText('Case #7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review case 7' }));

    expect(await screen.findByRole('dialog', { name: 'Case #7' })).toBeInTheDocument();
    expect(screen.getByText('Integrity finding')).toBeInTheDocument();
    expect(screen.getByText('Contradicting observation')).toBeInTheDocument();
    expect(screen.getByText('charging_sessions · started_at · 2026-08-25T10:00:00Z')).toBeInTheDocument();
  });

  it('runs discovery explicitly without applying any repair', async () => {
    renderWorkspace();

    fireEvent.click(await screen.findByRole('button', { name: 'Run integrity scan' }));

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith(
        '/data-repair/cases/scan',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ vehicle_id: 3 }),
        }),
      );
    });
    expect(mockRequest).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/close$/),
      expect.anything(),
    );
  });

  it('keeps the current page visible while the next page is loading', async () => {
    mockRequest.mockImplementation((url: string) => {
      if (url.includes('cursor_last_seen_at=')) {
        return new Promise<never>(() => {});
      }
      if (url.startsWith('/data-repair/cases?')) {
        return Promise.resolve({
          cases: [repairCase],
          has_more: true,
          next_cursor: { last_seen_at: '2026-08-25T10:02:00Z', id: 7 },
        });
      }
      if (url === '/data-repair/cases/stats?vehicle_id=3') {
        return Promise.resolve({ open: 1, in_review: 0, quarantined: 0 });
      }
      return Promise.resolve({});
    });
    renderWorkspace();

    expect(await screen.findByText('Case #7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Case #7')).toBeInTheDocument();
    expect(await screen.findByText('Updating')).toBeInTheDocument();
  });

  it('keeps cached cases visible and offers retry after a background refresh fails', async () => {
    const { client } = renderWorkspace();
    expect(await screen.findByText('Case #7')).toBeInTheDocument();

    mockRequest.mockImplementation((url: string) => {
      if (url.startsWith('/data-repair/cases?')) {
        return Promise.reject(new Error('temporary case refresh failure'));
      }
      if (url === '/data-repair/cases/stats?vehicle_id=3') {
        return Promise.resolve({ open: 1, in_review: 0, quarantined: 0 });
      }
      return Promise.resolve({});
    });

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['data-repair', 'cases'] });
    });

    expect(screen.getByText('Case #7')).toBeInTheDocument();
    const warning = await screen.findByTestId('stale-refresh-warning');
    expect(warning).toHaveTextContent(
      'Repair cases could not refresh',
    );
    expect(within(warning).getByRole('button', { name: 'Refresh' })).toBeEnabled();
    mockRequest.mockResolvedValue({ cases: [repairCase], has_more: false });
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument());
    expect(screen.getByText('Case #7')).toBeInTheDocument();
  });

  it('retains case statistics independently when their background refresh fails', async () => {
    const { client } = renderWorkspace();
    await screen.findByText('Case #7');
    const metrics = screen.getByRole('region', { name: 'Repair case metrics' });
    expect(within(metrics).getByText('Open cases')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(metrics).getAllByText(/^[01]$/).map((value) => value.textContent)).toEqual(['1', '0', '0', '1']);
    });
    const initialValues = within(metrics).getAllByText(/^[01]$/).map((value) => value.textContent);
    mockRequest.mockImplementation((url: string) => {
      if (url === '/data-repair/cases/stats?vehicle_id=3') return Promise.reject(new Error('statistics refresh'));
      if (url.startsWith('/data-repair/cases?')) return Promise.resolve({ cases: [repairCase], has_more: false });
      return Promise.resolve({});
    });
    await act(async () => { await client.invalidateQueries({ queryKey: ['data-repair', 'cases', 'stats'] }); });
    expect(await screen.findByText('Retained metrics')).toBeInTheDocument();
    expect(screen.getByText('Case #7')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Repair case metrics' })).getAllByText(/^[01]$/).map((value) => value.textContent)).toEqual(initialValues);
  });

  it('keeps cached quarantine rows visible after a background refresh fails', async () => {
    const { client } = renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: 'Quarantine ledger' }));
    expect(await screen.findByText('Drive #42')).toBeInTheDocument();

    mockRequest.mockImplementation((url: string) => {
      if (url.startsWith('/data-repair/quarantine?')) {
        return Promise.reject(new Error('temporary quarantine refresh failure'));
      }
      return Promise.resolve({});
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['data-repair', 'quarantine'] });
    });

    expect(screen.getByText('Drive #42')).toBeInTheDocument();
    expect(await screen.findByTestId('stale-refresh-warning')).toHaveTextContent(
      'Quarantine records could not refresh',
    );
  });

  it('does not infer empty cases or zero metrics while initial queries are paused', async () => {
    onlineManager.setOnline(false);
    try {
      const { client } = renderWorkspace();
      expect(screen.getByText('Refresh paused')).toBeInTheDocument();
      expect(screen.getByText('The initial query is paused while the network is unavailable; no empty response is inferred.')).toBeInTheDocument();
      expect(screen.queryByText('No repair cases match these filters.')).not.toBeInTheDocument();
      expect(screen.queryByText('0 cases on this page')).not.toBeInTheDocument();
      expect(screen.queryByTestId('repair-case-queue-skeleton')).not.toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: 'Repair case metrics' })).getByText('No metric values are available yet.')).toBeInTheDocument();
      await act(async () => { onlineManager.setOnline(true); });
      expect(await screen.findByText('Case #7')).toBeInTheDocument();
      client.clear();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('shows active initial loading without asserting an empty response', () => {
    mockRequest.mockImplementation(() => new Promise<never>(() => {}));
    const { client } = renderWorkspace();
    expect(screen.getByTestId('repair-case-queue-skeleton')).toBeInTheDocument();
    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(screen.queryByText('No repair cases match these filters.')).not.toBeInTheDocument();
    client.clear();
  });

  it('preserves confirmed empty cases through a paused refresh and independent recovery', async () => {
    mockRequest.mockImplementation((url: string) => Promise.resolve(
      url.startsWith('/data-repair/cases?')
        ? { cases: [], has_more: false }
        : { open: 0, in_review: 0, quarantined: 0, last_scan_at: null },
    ));
    const { client } = renderWorkspace();
    expect(await screen.findByText('No repair cases match these filters.')).toBeInTheDocument();
    onlineManager.setOnline(false);
    try {
      act(() => { void client.invalidateQueries({ queryKey: ['data-repair', 'cases'] }); });
      await waitFor(() => expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2));
      for (const warning of screen.getAllByTestId('stale-refresh-warning')) {
        expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
      }
      expect(screen.getByText('0 cases on this page')).toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: 'Repair case metrics' })).getAllByText('0')).toHaveLength(4);
      await act(async () => { onlineManager.setOnline(true); });
      await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument());
      expect(screen.getByText('0 cases on this page')).toBeInTheDocument();
      client.clear();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('reports skipped bulk cases and keeps the selection for operator review', async () => {
    const resolvedCase: RepairCase = {
      ...repairCase,
      id: 8,
      fingerprint: 'drive:43:resolved',
      session_id: 43,
      status: 'resolved',
    };
    mockRequest.mockImplementation((url: string) => {
      if (url.startsWith('/data-repair/cases?')) {
        return Promise.resolve({ cases: [repairCase, resolvedCase], has_more: false });
      }
      if (url === '/data-repair/cases/stats?vehicle_id=3') {
        return Promise.resolve({ open: 1, in_review: 0, quarantined: 0 });
      }
      if (url === '/data-repair/cases/bulk-transition') {
        return Promise.resolve({ updated: 1, skipped: 1 });
      }
      return Promise.resolve({});
    });
    renderWorkspace();

    expect(await screen.findByText('Case #8')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    fireEvent.click(screen.getByRole('button', { name: 'Begin review' }));

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith(
        '/data-repair/cases/bulk-transition',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ case_ids: [7, 8], status: 'in_review' }),
        }),
      );
    });
    expect(await screen.findByText('Updated 1 repair cases; 1 skipped')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Deselect all rows' })).toBeChecked();
  });

  it('disables bulk transitions when every selected case is terminal', async () => {
    mockRequest.mockImplementation((url: string) => {
      if (url.startsWith('/data-repair/cases?')) {
        return Promise.resolve({
          cases: [{ ...repairCase, status: 'resolved' }],
          has_more: false,
        });
      }
      if (url === '/data-repair/cases/stats?vehicle_id=3') {
        return Promise.resolve({ open: 0, in_review: 0, quarantined: 0 });
      }
      return Promise.resolve({});
    });
    renderWorkspace();

    expect(await screen.findByText('Case #7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));

    expect(screen.getByRole('button', { name: 'Begin review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dismiss selected' })).toBeDisabled();
  });

  it('previews and explicitly applies an actionable case from the review drawer', async () => {
    renderWorkspace();

    fireEvent.click(await screen.findByRole('button', { name: 'Review case 7' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review & apply' }));

    const confirmation = await screen.findByRole('dialog', { name: 'Apply this repair?' });
    expect(mockRequest).toHaveBeenCalledWith(
      '/data-repair/drive/42/preview',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          case_id: 7,
          ended_at: '2026-08-25T10:00:00Z',
          rule: 'drive_open_charging_started',
          expected_stored_ended_at: '',
        }),
      }),
    );

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Apply repair' }));

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith(
        '/data-repair/drive/42/close',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            case_id: 7,
            ended_at: '2026-08-25T10:00:00Z',
            rule: 'drive_open_charging_started',
            expected_stored_ended_at: '',
          }),
        }),
      );
    });
  });
});

describe('RepairCaseWorkspace dismiss scope', () => {
  const otherVehicleCase: RepairCase = {
    ...repairCase,
    id: 17,
    fingerprint: 'drive:142:drive_open_charging_started',
    session_id: 142,
    vehicle_id: 4,
  };

  function renderScopedWorkspace(vehicleId?: number) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
    const view = render(<RepairCaseWorkspace vehicleId={vehicleId} canWrite />, { wrapper });
    return { ...view, client };
  }

  beforeEach(() => {
    mockRequest.mockReset();
    mockRequest.mockImplementation((url: string) => {
      if (url.startsWith('/data-repair/cases?')) {
        const vehicleId = new URLSearchParams(url.split('?')[1]).get('vehicle_id');
        const cases = vehicleId === '3'
          ? [repairCase]
          : vehicleId === '4'
            ? [otherVehicleCase]
            : [repairCase, otherVehicleCase];
        return Promise.resolve({ cases, has_more: false });
      }
      if (url.startsWith('/data-repair/cases/stats')) {
        return Promise.resolve({ open: 1, in_review: 0, quarantined: 0 });
      }
      if (url === '/data-repair/cases/bulk-transition') {
        return Promise.resolve({ updated: 1, skipped: 0 });
      }
      return Promise.resolve({});
    });
  });

  it('labels old-scope rows and metrics and blocks row writes while the new vehicle loads', async () => {
    const { rerender } = renderScopedWorkspace(3);
    await screen.findByText('Case #7');
    mockRequest.mockImplementation(() => new Promise<never>(() => {}));

    rerender(<RepairCaseWorkspace vehicleId={4} canWrite />);

    expect(await screen.findByText(
      'Retained source: /data-repair/cases?vehicle_id=3&status=open&limit=50',
    )).toBeInTheDocument();
    expect(screen.getByText('Retained source: /data-repair/cases/stats?vehicle_id=3'))
      .toBeInTheDocument();
    expect(screen.getByText('Case #7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review case 7' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    expect(screen.getByRole('button', { name: 'Begin review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dismiss selected' })).toBeDisabled();
    expect(mockRequest.mock.calls.every(([, options]) => !options.method)).toBe(true);
  });

  it('clears a populated dismiss confirmation and cannot submit old cases after a vehicle switch', async () => {
    const { rerender } = renderScopedWorkspace(3);
    expect(await screen.findByText('Case #7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss selected' }));
    const previousConfirmation = await screen.findByRole('dialog', {
      name: 'Dismiss selected findings?',
    });
    fireEvent.change(within(previousConfirmation).getByRole('textbox', { name: 'Operator note' }), {
      target: { value: 'Previous vehicle false positive' },
    });
    expect(within(previousConfirmation).getByRole('button', { name: 'Dismiss selected' }))
      .toBeEnabled();

    rerender(<RepairCaseWorkspace vehicleId={4} canWrite />);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Dismiss selected findings?' }))
        .not.toBeInTheDocument();
    });
    expect(await screen.findByText('Case #17')).toBeInTheDocument();
    expect(screen.queryByText('Case #7')).not.toBeInTheDocument();
    expect(mockRequest).not.toHaveBeenCalledWith(
      '/data-repair/cases/bulk-transition',
      expect.anything(),
    );
    expect(screen.getByRole('checkbox', { name: 'Select all rows' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss selected' }));
    const currentConfirmation = await screen.findByRole('dialog', {
      name: 'Dismiss selected findings?',
    });
    const currentReason = within(currentConfirmation).getByRole('textbox', { name: 'Operator note' });
    expect(currentReason).toHaveValue('');
    const confirm = within(currentConfirmation).getByRole('button', { name: 'Dismiss selected' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(mockRequest).not.toHaveBeenCalledWith(
      '/data-repair/cases/bulk-transition',
      expect.anything(),
    );

    fireEvent.change(currentReason, { target: { value: '  Current vehicle false positive  ' } });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith(
        '/data-repair/cases/bulk-transition',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            case_ids: [17],
            status: 'dismissed',
            resolution_note: 'Current vehicle false positive',
          }),
        }),
      );
    });
    expect(mockRequest.mock.calls.filter(([url]) => url === '/data-repair/cases/bulk-transition'))
      .toHaveLength(1);
  });

  it('clears pending dismiss targets and reason in both directions between vehicle and fleet scope', async () => {
    const { rerender } = renderScopedWorkspace(3);
    await screen.findByText('Case #7');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss selected' }));
    const vehicleConfirmation = await screen.findByRole('dialog', {
      name: 'Dismiss selected findings?',
    });
    fireEvent.change(within(vehicleConfirmation).getByRole('textbox', { name: 'Operator note' }), {
      target: { value: 'Vehicle-only false positive' },
    });

    rerender(<RepairCaseWorkspace canWrite />);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Dismiss selected findings?' }))
        .not.toBeInTheDocument();
    });
    await screen.findByText('Case #17');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss selected' }));
    const fleetConfirmation = await screen.findByRole('dialog', {
      name: 'Dismiss selected findings?',
    });
    const fleetReason = within(fleetConfirmation).getByRole('textbox', { name: 'Operator note' });
    expect(fleetReason).toHaveValue('');
    expect(within(fleetConfirmation).getByRole('button', { name: 'Dismiss selected' }))
      .toBeDisabled();
    fireEvent.change(fleetReason, { target: { value: 'Fleet-only false positive' } });

    rerender(<RepairCaseWorkspace vehicleId={3} canWrite />);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Dismiss selected findings?' }))
        .not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText('Case #17')).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss selected' }));
    const returnedConfirmation = await screen.findByRole('dialog', {
      name: 'Dismiss selected findings?',
    });
    expect(within(returnedConfirmation).getByRole('textbox', { name: 'Operator note' }))
      .toHaveValue('');
    expect(within(returnedConfirmation).getByRole('button', { name: 'Dismiss selected' }))
      .toBeDisabled();
    expect(mockRequest).not.toHaveBeenCalledWith(
      '/data-repair/cases/bulk-transition',
      expect.anything(),
    );
  });

  it('retains a genuine same-vehicle dismiss through rerender and refresh until explicit confirmation', async () => {
    const { client, rerender } = renderScopedWorkspace(3);
    await screen.findByText('Case #7');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss selected' }));
    const confirmation = await screen.findByRole('dialog', {
      name: 'Dismiss selected findings?',
    });
    fireEvent.change(within(confirmation).getByRole('textbox', { name: 'Operator note' }), {
      target: { value: '  Same vehicle false positive  ' },
    });

    rerender(<RepairCaseWorkspace vehicleId={3} canWrite />);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['data-repair', 'cases'] });
    });

    const retainedConfirmation = screen.getByRole('dialog', { name: 'Dismiss selected findings?' });
    expect(within(retainedConfirmation).getByRole('textbox', { name: 'Operator note' }))
      .toHaveValue('  Same vehicle false positive  ');
    expect(mockRequest).not.toHaveBeenCalledWith(
      '/data-repair/cases/bulk-transition',
      expect.anything(),
    );
    const confirm = within(retainedConfirmation).getByRole('button', { name: 'Dismiss selected' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith(
        '/data-repair/cases/bulk-transition',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            case_ids: [7],
            status: 'dismissed',
            resolution_note: 'Same vehicle false positive',
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Dismiss selected findings?' }))
        .not.toBeInTheDocument();
    });
    expect(screen.getByRole('checkbox', { name: 'Select all rows' })).not.toBeChecked();
    expect(mockRequest.mock.calls.filter(([url]) => url === '/data-repair/cases/bulk-transition'))
      .toHaveLength(1);
  });
});
