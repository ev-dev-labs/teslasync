import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { RepairQuarantine, RepairQuarantineFilters, RepairSuggestionsResponse } from '@/api/hooks/useDataRepair';
import { RepairQuarantinePanel } from './RepairQuarantinePanel';
import { RepairDiagnosticsWorkspace } from './RepairDiagnosticsWorkspace';

const mocks = vi.hoisted(() => ({
  query: {
    data: undefined as {
      quarantines: RepairQuarantine[];
      has_more: boolean;
      next_cursor?: { quarantined_at: string; id: number };
    } | undefined,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    isPlaceholderData: false,
    isPreviousScope: false,
    canWriteCurrentScope: true,
    sourceScope: '/data-repair/quarantine?vehicle_id=7&limit=50',
    error: null as Error | null,
    fetchStatus: 'idle',
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  },
  mutation: { mutate: vi.fn(), isPending: false },
  suggestions: {
    data: undefined as RepairSuggestionsResponse | undefined,
    isLoading: false,
    isPending: true,
    isFetching: false,
    isError: false,
    error: null as Error | null,
    fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
    refetch: vi.fn(),
  },
  stale: {
    data: undefined as { stale_charging: []; stale_drives: [] } | undefined,
    isLoading: false,
    isPending: true,
    isFetching: false,
    isError: false,
    error: null as Error | null,
    fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
    refetch: vi.fn(),
  },
  filters: undefined as RepairQuarantineFilters | undefined,
  confirm: undefined as ComponentProps<typeof import('@/components/ui')['ConfirmDialog']> | undefined,
}));

vi.mock('@/api/hooks/useDataRepair', () => ({
  useRepairQuarantines: (filters: RepairQuarantineFilters) => {
    mocks.filters = filters;
    return mocks.query;
  },
  useRestoreQuarantine: () => mocks.mutation,
  useRepairSuggestions: () => mocks.suggestions,
  useStaleSessions: () => mocks.stale,
  useApplyDriveRepair: () => mocks.mutation,
  useApplyChargingRepair: () => mocks.mutation,
}));

vi.mock('@/components/ai', () => ({
  AIDataRepairSuggestions: () => <div>Independent AI suggestions panel</div>,
}));

vi.mock('./RepairDiagnosisOverview', () => ({
  RepairDiagnosisOverview: ({ totalSuggestions }: { totalSuggestions: number | null }) => (
    <div aria-label="Diagnosis count">{totalSuggestions == null ? 'Unknown' : totalSuggestions}</div>
  ),
}));

vi.mock('@/components/ui', async (importActual) => {
  const actual = await importActual<typeof import('@/components/ui')>();
  return {
    ...actual,
    ConfirmDialog: (props: ComponentProps<typeof actual.ConfirmDialog>) => {
      mocks.confirm = props;
      return <actual.ConfirmDialog {...props} />;
    },
  };
});

function record(overrides: Partial<RepairQuarantine> = {}): RepairQuarantine {
  return {
    id: 301,
    case_id: 41,
    kind: 'drive',
    session_id: 91,
    vehicle_id: 7,
    schema_version: 1,
    checksum: 'synthetic-checksum',
    reason: 'Original recovery reason',
    quarantined_by: 'Synthetic operator',
    quarantined_at: '2026-10-01T12:00:00Z',
    restored_at: null,
    ...overrides,
  };
}

function openDraft(note = '  Reviewed recovery note  '): () => void {
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Operator note' }), {
    target: { value: note },
  });
  return mocks.confirm!.onConfirm;
}

function callbacks(): { onSuccess: () => void; onSettled: () => void } {
  return mocks.mutation.mutate.mock.calls[0][1];
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mocks.query.data = { quarantines: [record()], has_more: false };
  mocks.query.isLoading = false;
  mocks.query.isPending = false;
  mocks.query.isFetching = false;
  mocks.query.isError = false;
  mocks.query.error = null;
  mocks.query.isPlaceholderData = false;
  mocks.query.isPreviousScope = false;
  mocks.query.canWriteCurrentScope = true;
  mocks.query.fetchStatus = 'idle';
  mocks.mutation.isPending = false;
  for (const source of [mocks.suggestions, mocks.stale]) {
    source.data = undefined;
    source.isLoading = false;
    source.isPending = true;
    source.isFetching = false;
    source.isError = false;
    source.error = null;
    source.fetchStatus = 'idle';
  }
});

describe('RepairQuarantinePanel scope and write authority', () => {
  it('labels old-scope populated rows and blocks restore while retaining same-scope pagination', () => {
    const view = render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    mocks.query.isPlaceholderData = true;
    mocks.query.isFetching = true;
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.getByRole('button', { name: 'Restore' })).toBeEnabled();
    expect(screen.getByText('Drive #91')).toBeInTheDocument();

    mocks.query.isPreviousScope = true;
    mocks.query.canWriteCurrentScope = false;
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.getByText(`Retained source: ${mocks.query.sourceScope}`)).toBeInTheDocument();
    expect(screen.getByText('Drive #91')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.mutation.mutate).not.toHaveBeenCalled();
  });

  it.each([
    { from: 7, to: 8, name: 'vehicle to vehicle' },
    { from: 7, to: undefined, name: 'vehicle to fleet' },
    { from: undefined, to: 7, name: 'fleet to vehicle' },
  ])('invalidates target and note on genuine $name scope change', ({ from, to }) => {
    const view = render(<RepairQuarantinePanel vehicleId={from} canWrite />);
    const obsoleteConfirm = openDraft();
    view.rerender(<RepairQuarantinePanel vehicleId={to} canWrite />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => obsoleteConfirm());
    expect(mocks.mutation.mutate).not.toHaveBeenCalled();
    expect(mocks.filters).toEqual({ vehicle_id: to, limit: 50 });
    mocks.query.data = { quarantines: [record({ vehicle_id: to ?? 7 })], has_more: false };
    view.rerender(<RepairQuarantinePanel vehicleId={to} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toHaveValue('');
  });

  describe('RepairDiagnosticsWorkspace response authority', () => {
    function resolveEmpty() {
      mocks.suggestions.data = {
        generated_at: '2026-10-01T12:00:00Z',
        lookback_days: 30,
        scanned_drives: 0,
        scanned_charging_sessions: 0,
        drive_suggestions: [],
        charging_suggestions: [],
        truncated: false,
      };
      mocks.stale.data = { stale_charging: [], stale_drives: [] };
      mocks.suggestions.isPending = false;
      mocks.stale.isPending = false;
    }

    it.each(['fetching', 'paused', 'idle'] as const)(
      'retains all worklist panels without asserting successful emptiness while %s',
      (fetchStatus) => {
        for (const source of [mocks.suggestions, mocks.stale]) {
          source.fetchStatus = fetchStatus;
          source.isFetching = fetchStatus === 'fetching';
          source.isLoading = fetchStatus === 'fetching';
        }
        render(<RepairDiagnosticsWorkspace vehicleId={7} canWrite />);
        for (const title of ['Drive boundaries', 'Charging boundaries', 'Drives', 'Charging sessions']) {
          expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
        }
        expect(screen.getByLabelText('Diagnosis count')).toHaveTextContent('Unknown');
        expect(screen.queryByText('No contradicted drive boundaries')).not.toBeInTheDocument();
        expect(screen.queryByText('No contradicted charging boundaries')).not.toBeInTheDocument();
        expect(screen.queryByText('All drives are complete')).not.toBeInTheDocument();
        expect(screen.queryByText('Ready')).not.toBeInTheDocument();
        if (fetchStatus === 'paused') {
          expect(screen.getByText('Refresh paused')).toBeInTheDocument();
          expect(screen.getAllByText('The initial query is paused while the network is unavailable; no empty response is inferred.')).toHaveLength(2);
        }
      },
    );

    it('shows confirmed empty worklists and measured zero, retains them on refresh failure and recovers', () => {
      resolveEmpty();
      const view = render(<RepairDiagnosticsWorkspace vehicleId={7} canWrite />);
      expect(screen.getByLabelText('Diagnosis count')).toHaveTextContent('0');
      expect(screen.getByText('No contradicted drive boundaries')).toBeInTheDocument();
      expect(screen.getByText('No contradicted charging boundaries')).toBeInTheDocument();
      expect(screen.getByText('All drives are complete')).toBeInTheDocument();
      expect(screen.getByText('Ready')).toBeInTheDocument();
      mocks.suggestions.isError = true;
      mocks.suggestions.error = new Error('Synthetic diagnosis refresh failure');
      view.rerender(<RepairDiagnosticsWorkspace vehicleId={7} canWrite />);
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      expect(screen.getByText('No contradicted drive boundaries')).toBeInTheDocument();
      expect(screen.getByLabelText('Diagnosis count')).toHaveTextContent('0');
      mocks.suggestions.isError = false;
      mocks.suggestions.error = null;
      view.rerender(<RepairDiagnosticsWorkspace vehicleId={7} canWrite />);
      expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
      expect(screen.getByText('Ready')).toBeInTheDocument();
    });
  });

  it('preserves the exact same-scope draft and original record across retained refresh failure', () => {
    const view = render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    openDraft();
    mocks.query.data = { quarantines: [record({ id: 302, reason: 'New ledger row' })], has_more: false };
    mocks.query.isFetching = true;
    mocks.query.error = new Error('Synthetic refresh failure');
    mocks.query.isError = true;
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toHaveValue('  Reviewed recovery note  ');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore session' }));
    expect(mocks.mutation.mutate.mock.calls[0][0]).toEqual({
      quarantine_id: 301, reason: 'Reviewed recovery note',
    });
  });

  it('disables open confirmation and fields using current write authority and explains the block', () => {
    const view = render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    const obsoleteConfirm = openDraft();
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite={false} writeBlockReason="Synthetic read-only mode" />);
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toBeDisabled();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore session' })).toBeDisabled();
    expect(screen.getByText('Synthetic read-only mode')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Operator note' }), { target: { value: 'Forbidden edit' } });
    act(() => obsoleteConfirm());
    expect(mocks.mutation.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toHaveValue('  Reviewed recovery note  ');
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite writeBlockReason={undefined} />);
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toBeEnabled();
    expect(screen.queryByText('Synthetic read-only mode')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('blocks read-only row opening and a retained row from a different vehicle', () => {
    const view = render(<RepairQuarantinePanel vehicleId={7} canWrite={false} writeBlockReason="Synthetic unavailable writes" />);
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore' })).toHaveAttribute('title', 'Synthetic unavailable writes');
    view.rerender(<RepairQuarantinePanel vehicleId={8} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.mutation.mutate).not.toHaveBeenCalled();
  });

  it('does not revive an obsolete confirmation after scope changes and returns', () => {
    const view = render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    const obsoleteConfirm = openDraft();
    view.rerender(<RepairQuarantinePanel vehicleId={8} canWrite />);
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    act(() => obsoleteConfirm());
    expect(mocks.mutation.mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cannot retarget an obsolete confirmation callback to a newly opened draft', () => {
    const view = render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    const obsoleteConfirm = openDraft();
    view.rerender(<RepairQuarantinePanel vehicleId={8} canWrite />);
    mocks.query.data = { quarantines: [record({ id: 302, vehicle_id: 8 })], has_more: false };
    view.rerender(<RepairQuarantinePanel vehicleId={8} canWrite />);
    openDraft('New scope note');
    act(() => obsoleteConfirm());
    expect(mocks.mutation.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toHaveValue('New scope note');
  });

  it('requires a trimmed reason, prevents duplicate dispatch and clears only on confirmed success', () => {
    render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    const confirm = openDraft('   ');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore session' })).toBeDisabled();
    act(() => confirm());
    expect(mocks.mutation.mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Operator note' }), { target: { value: '  Valid note  ' } });
    act(() => { confirm(); confirm(); });
    expect(mocks.mutation.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toHaveValue('  Valid note  ');
    act(() => { callbacks().onSuccess(); callbacks().onSettled(); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('retains the draft after unsuccessful settlement and disables pending editing', () => {
    const view = render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    const confirm = openDraft();
    act(() => confirm());
    mocks.mutation.isPending = true;
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toBeDisabled();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore session' })).toBeDisabled();
    act(() => callbacks().onSettled());
    mocks.mutation.isPending = false;
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toHaveValue('  Reviewed recovery note  ');
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toBeEnabled();
  });

  it('prevents an old success callback from discarding a newer scope draft', () => {
    const view = render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    const confirm = openDraft();
    act(() => confirm());
    const old = callbacks();
    view.rerender(<RepairQuarantinePanel vehicleId={8} canWrite />);
    act(() => old.onSettled());
    mocks.query.data = { quarantines: [record({ id: 302, vehicle_id: 8 })], has_more: false };
    view.rerender(<RepairQuarantinePanel vehicleId={8} canWrite />);
    openDraft('New scope note');
    act(() => old.onSuccess());
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toHaveValue('New scope note');
  });
});

describe('RepairQuarantinePanel complete ledger', () => {
  it('uses the existing row disclosure for reason, operator, quarantine time and status while retaining actions', () => {
    render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    const expand = screen.getByRole('button', { name: /^Expand row:/ });
    fireEvent.click(expand);
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    const details = document.querySelector('dl')!;
    expect(within(details).getByText('Reason')).toBeInTheDocument();
    expect(within(details).getByText('Original recovery reason')).toBeInTheDocument();
    expect(within(details).getByText('Operator')).toBeInTheDocument();
    expect(within(details).getByText('Synthetic operator')).toBeInTheDocument();
    expect(within(details).getByText('Quarantined')).toBeInTheDocument();
    expect(within(details).getByText('Held safely')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeEnabled();
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('retains status filtering and both cursor directions with the original server scope', () => {
    mocks.query.data = {
      quarantines: [record()],
      has_more: true,
      next_cursor: { quarantined_at: '2026-10-01T12:00:00Z', id: 301 },
    };
    render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(mocks.filters).toEqual({
      vehicle_id: 7, limit: 50, cursor_quarantined_at: '2026-10-01T12:00:00Z', cursor_id: 301,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(mocks.filters?.cursor_id).toBeUndefined();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter quarantine status' }), { target: { value: 'true' } });
    expect(mocks.filters).toEqual({ vehicle_id: 7, limit: 50, restored: true });
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('preserves loading, independent fatal retry and null-safe empty ledger shells', () => {
    mocks.query.data = undefined;
    mocks.query.isLoading = true;
    mocks.query.isPending = true;
    const view = render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.getByTestId('repair-quarantine-skeleton')).toBeInTheDocument();
    expect(screen.getByText('Quarantine ledger')).toBeInTheDocument();
    mocks.query.isLoading = false;
    mocks.query.isPending = false;
    mocks.query.isError = true;
    mocks.query.error = new Error('Synthetic unavailable ledger');
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mocks.query.refetch).toHaveBeenCalledOnce();
    mocks.query.isError = false;
    mocks.query.error = null;
    mocks.query.data = { quarantines: [], has_more: false };
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.getByText('No quarantine records match this filter.')).toBeInTheDocument();
    expect(screen.getByText('Quarantine ledger')).toBeInTheDocument();
  });

  it.each(['idle', 'paused'])('does not infer an empty ledger before a %s request responds', (fetchStatus) => {
    mocks.query.data = undefined;
    mocks.query.isPending = true;
    mocks.query.fetchStatus = fetchStatus;
    render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.getByText('Quarantine ledger')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter quarantine status' })).toBeEnabled();
    expect(screen.queryByText('No quarantine records match this filter.')).not.toBeInTheDocument();
    expect(screen.queryByText('0 records on this page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('repair-quarantine-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText(fetchStatus === 'paused'
      ? 'The initial query is paused while the network is unavailable; no empty response is inferred.'
      : 'No requested source has returned usable data yet.')).toBeInTheDocument();
  });

  it('does not treat a previous-filter empty placeholder as a current-scope response', () => {
    mocks.query.data = { quarantines: [], has_more: false };
    const view = render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.getByText('0 records on this page')).toBeInTheDocument();
    mocks.query.isPlaceholderData = true;
    mocks.query.isPreviousScope = true;
    mocks.query.canWriteCurrentScope = false;
    mocks.query.isFetching = true;
    mocks.query.fetchStatus = 'fetching';
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter quarantine status' }), {
      target: { value: 'true' },
    });
    expect(screen.queryByText('No quarantine records match this filter.')).not.toBeInTheDocument();
    expect(screen.getByText('0 records on this page')).toBeInTheDocument();
    expect(screen.queryByTestId('repair-quarantine-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText(`Retained source: ${mocks.query.sourceScope}`)).toBeInTheDocument();
    mocks.query.isPlaceholderData = false;
    mocks.query.isPreviousScope = false;
    mocks.query.canWriteCurrentScope = true;
    mocks.query.isFetching = false;
    mocks.query.fetchStatus = 'idle';
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.getByText('No quarantine records match this filter.')).toBeInTheDocument();
    expect(screen.getByText('0 records on this page')).toBeInTheDocument();
  });

  it('retains loaded rows through refresh failure and clears the warning after successful empty recovery', () => {
    const view = render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    mocks.query.isError = true;
    mocks.query.error = new Error('Synthetic refresh failure');
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeEnabled();
    expect(screen.getByText('1 records on this page')).toBeInTheDocument();
    expect(screen.queryByText('No quarantine records match this filter.')).not.toBeInTheDocument();
    mocks.query.isError = false;
    mocks.query.error = null;
    mocks.query.data = { quarantines: [], has_more: false };
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('No quarantine records match this filter.')).toBeInTheDocument();
    expect(screen.getByText('0 records on this page')).toBeInTheDocument();
  });

  it('retains an authoritative empty ledger during pause, retries only that source and recovers', () => {
    mocks.query.data = { quarantines: [], has_more: false };
    const view = render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    mocks.query.fetchStatus = 'paused';
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.getByText('0 records on this page')).toBeInTheDocument();
    expect(screen.getByText('No quarantine records match this filter.')).toBeInTheDocument();
    expect(screen.queryByText('Updating')).not.toBeInTheDocument();
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(mocks.query.refetch).toHaveBeenCalledOnce();
    expect(mocks.mutation.mutate).not.toHaveBeenCalled();
    mocks.query.fetchStatus = 'fetching';
    mocks.query.isFetching = true;
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('Updating')).toBeInTheDocument();
    expect(screen.getByText('0 records on this page')).toBeInTheDocument();
    mocks.query.fetchStatus = 'idle';
    mocks.query.isFetching = false;
    mocks.query.dataUpdatedAt = 2;
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.queryByText('Updating')).not.toBeInTheDocument();
    expect(screen.getByText('0 records on this page')).toBeInTheDocument();
  });
});
