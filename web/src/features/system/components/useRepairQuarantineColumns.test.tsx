import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RepairQuarantine } from '@/api/hooks/useDataRepair';
import { formatDateTime } from '@/lib/dateFormat';
import { useRepairQuarantineColumns } from './useRepairQuarantineColumns';

const record: RepairQuarantine = {
  id: 301, case_id: 41, kind: 'drive', session_id: 91, vehicle_id: 7,
  schema_version: 1, checksum: 'synthetic-checksum',
  reason: 'Synthetic original reason', quarantined_by: 'Synthetic operator',
  quarantined_at: '2026-10-01T12:00:00Z', restored_at: null,
};

describe('useRepairQuarantineColumns retained ledger identities', () => {
  it('retains all original column keys, headers and session/vehicle identity', () => {
    const { result } = renderHook(() => useRepairQuarantineColumns(true, undefined, vi.fn()));
    expect(result.current.map((column) => column.key)).toEqual([
      'session', 'status', 'reason', 'quarantined_at', 'actor', 'actions',
    ]);
    expect(result.current.map((column) => column.header)).toEqual([
      'Session', 'Status', 'Reason', 'Quarantined', 'Operator', 'Actions',
    ]);
    render(<>{result.current[0].render(record)}</>);
    expect(screen.getByText('Drive #91')).toBeInTheDocument();
    expect(screen.getByText('Vehicle #7')).toBeInTheDocument();
    expect(screen.getByText('Held safely')).toBeInTheDocument();
  });

  it('preserves original reason, operator and quarantine timestamp without recasing values', () => {
    const { result } = renderHook(() => useRepairQuarantineColumns(true, undefined, vi.fn()));
    render(<>{result.current.slice(2, 5).map((column) => <div key={column.key}>{column.render(record)}</div>)}</>);
    expect(screen.getByText(record.reason)).toBeInTheDocument();
    expect(screen.getByText(record.quarantined_by)).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(record.quarantined_at))).toBeInTheDocument();
  });

  it('passes the exact quarantined record only for an allowed restore action', () => {
    const onRestore = vi.fn();
    const { result } = renderHook(() => useRepairQuarantineColumns(true, undefined, onRestore));
    render(<>{result.current[5].render(record)}</>);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onRestore).toHaveBeenCalledExactlyOnceWith(record);
  });

  it('guards the actual read-only row callback in addition to disabling and explaining the button', () => {
    const onRestore = vi.fn();
    const { result } = renderHook(() => useRepairQuarantineColumns(false, 'Synthetic block reason', onRestore));
    const action = result.current[5].render(record);
    render(<>{action}</>);
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore' })).toHaveAttribute('title', 'Synthetic block reason');
    expect(isValidElement<{ onClick: () => void }>(action)).toBe(true);
    if (isValidElement<{ onClick: () => void }>(action)) action.props.onClick();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('retains restored status and restoration time without offering another restore', () => {
    const restored = { ...record, kind: 'charging' as const, restored_at: '2026-10-02T13:00:00Z' };
    const { result } = renderHook(() => useRepairQuarantineColumns(true, undefined, vi.fn()));
    render(<>{result.current[0].render(restored)}{result.current[5].render(restored)}</>);
    expect(screen.getByText('Charging #91')).toBeInTheDocument();
    expect(screen.getByText('Restored')).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(restored.restored_at))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('renders unknown metadata safely and wraps long unmodified reason and operator values', () => {
    const { result } = renderHook(() => useRepairQuarantineColumns(true, undefined, vi.fn()));
    const nullMetadata = { ...record, reason: null, quarantined_by: null } as unknown as RepairQuarantine;
    const view = render(<>{result.current[2].render(nullMetadata)}{result.current[4].render(nullMetadata)}</>);
    expect(screen.getAllByText('—')).toHaveLength(2);
    const long = { ...record, reason: '理由'.repeat(100), quarantined_by: 'Operator_identifier_'.repeat(30) };
    view.rerender(<>{result.current[2].render(long)}{result.current[4].render(long)}</>);
    expect(screen.getByText(long.reason)).toHaveClass('break-words');
    expect(screen.getByText(long.quarantined_by)).toHaveClass('break-words');
  });
});
