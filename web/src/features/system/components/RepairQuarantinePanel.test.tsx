import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { RepairQuarantine, RepairQuarantineFilters } from '@/api/hooks/useDataRepair';
import { RepairQuarantinePanel } from './RepairQuarantinePanel';

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
    error: null as Error | null,
    fetchStatus: 'idle',
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  },
  mutation: { mutate: vi.fn(), isPending: false },
  filters: undefined as RepairQuarantineFilters | undefined,
  confirm: undefined as ComponentProps<typeof import('@/components/ui')['ConfirmDialog']> | undefined,
}));

vi.mock('@/api/hooks/useDataRepair', () => ({
  useRepairQuarantines: (filters: RepairQuarantineFilters) => {
    mocks.filters = filters;
    return mocks.query;
  },
  useRestoreQuarantine: () => mocks.mutation,
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
  mocks.mutation.isPending = false;
});

describe('RepairQuarantinePanel scope and write authority', () => {
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

  it('preserves the exact same-scope draft and original record across retained refresh failure', () => {
    const view = render(<RepairQuarantinePanel vehicleId={7} canWrite />);
    openDraft();
    mocks.query.data = { quarantines: [record({ id: 302, reason: 'New ledger row' })], has_more: false };
    mocks.query.isFetching = true;
    mocks.query.error = new Error('Synthetic refresh failure');
    mocks.query.isError = true;
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toHaveValue('  Reviewed recovery note  ');
    expect(screen.getByTestId('repair-quarantine-refresh-warning')).toBeInTheDocument();
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
    const expand = screen.getByRole('button', { name: 'Expand row' });
    fireEvent.click(expand);
    expect(screen.getByRole('button', { name: 'Collapse row' })).toHaveAttribute('aria-expanded', 'true');
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
    view.rerender(<RepairQuarantinePanel vehicleId={7} canWrite />);
    expect(screen.getByText('No quarantine records match this filter.')).toBeInTheDocument();
    expect(screen.getByText('Quarantine ledger')).toBeInTheDocument();
  });
});
