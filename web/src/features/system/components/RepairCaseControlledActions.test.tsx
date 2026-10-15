import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplyRepairInput, RepairCase, RepairImpactPreview, RepairQuarantine } from '@/api/hooks/useDataRepair';
import { RepairCaseControlledActions } from './RepairCaseControlledActions';

const H = vi.hoisted(() => ({
  preview: vi.fn(), reset: vi.fn(), drive: vi.fn(), charging: vi.fn(),
  transition: vi.fn(), quarantine: vi.fn(), restore: vi.fn(),
  previewError: null as Error | null,
  pending: false,
  confirm: undefined as (() => void) | undefined,
}));

vi.mock('@/api/hooks/useDataRepair', () => ({
  useRepairImpactPreview: () => ({
    mutate: H.preview, reset: H.reset, isPending: false, error: H.previewError,
  }),
  useApplyDriveRepair: () => ({ mutate: H.drive, isPending: H.pending }),
  useApplyChargingRepair: () => ({ mutate: H.charging, isPending: H.pending }),
  useTransitionRepairCase: () => ({ mutate: H.transition, isPending: H.pending }),
  useQuarantineRepairCase: () => ({ mutate: H.quarantine, isPending: H.pending }),
  useRestoreQuarantine: () => ({ mutate: H.restore, isPending: H.pending }),
}));

vi.mock('@/components/ui', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui')>('@/components/ui');
  return {
    ...actual,
    ConfirmDialog: (props: Parameters<typeof actual.ConfirmDialog>[0]) => {
      H.confirm = props.onConfirm;
      return <actual.ConfirmDialog {...props} />;
    },
  };
});

function buildCase(overrides: Partial<RepairCase> = {}): RepairCase {
  return {
    id: 7, fingerprint: 'drive:42:drive_open_charging_started', kind: 'drive',
    session_id: 42, vehicle_id: 3, rule: 'drive_open_charging_started',
    confidence: 'high', status: 'open', applicable: true,
    suggested_ended_at: '2026-08-25T10:00:00.123456Z',
    evidence_started_at: '2026-08-25T09:00:00Z',
    evidence_stored_ended_at: '2026-08-25T11:00:00.654321Z',
    evidence_contradiction_ts: '2026-08-25T10:01:00Z',
    evidence_contradiction_src: 'signal_log',
    evidence_contradiction_field: 'gear', evidence_contradiction_value: 'P',
    evidence_gap_s: 60.123456,
    first_seen_at: '2026-08-25T10:01:00Z', last_seen_at: '2026-08-25T10:02:00Z',
    created_at: '2026-08-25T10:01:00Z', updated_at: '2026-08-25T10:02:00Z',
    ...overrides,
  };
}

function buildPreview(input: ApplyRepairInput): RepairImpactPreview {
  return {
    kind: input.rule.startsWith('drive_') ? 'drive' : 'charging',
    session_id: input.id, rule: input.rule, source: 'suggestion', status: 'ready',
    started_at: '2026-08-25T09:00:00Z',
    current_ended_at: input.expected_stored_ended_at || null,
    proposed_ended_at: input.ended_at,
    current_duration_s: 7200.654321, proposed_duration_s: 3600.123456,
    fields_changed: [], fields_preserved: [], warnings: ['Original case impact'],
  };
}

const quarantine: RepairQuarantine = {
  id: 91, case_id: 7, kind: 'drive', session_id: 42, vehicle_id: 3,
  schema_version: 1, checksum: 'reviewed-checksum', reason: 'Original quarantine note',
  quarantined_by: 'operator', quarantined_at: '2026-08-25T12:00:00Z',
};

beforeEach(() => {
  for (const mock of [H.preview, H.reset, H.drive, H.charging, H.transition, H.quarantine, H.restore]) {
    mock.mockReset();
  }
  H.previewError = null;
  H.pending = false;
  H.confirm = undefined;
  H.preview.mockImplementation(
    (input: ApplyRepairInput, options: { onSuccess: (impact: RepairImpactPreview) => void }) =>
      options.onSuccess(buildPreview(input)),
  );
});

describe('RepairCaseControlledActions reviewed authority', () => {
  it.each(['drive', 'charging'] as const)('confirms the exact original %s payload and concurrency pin', (kind) => {
    const repairCase = buildCase({
      kind, rule: kind === 'drive' ? 'drive_open_charging_started' : 'charging_open_drive_started',
    });
    render(<RepairCaseControlledActions repairCase={repairCase} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Review & apply' }));
    expect(H.drive).not.toHaveBeenCalled();
    expect(H.charging).not.toHaveBeenCalled();
    expect(screen.getByText('Original case impact')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply repair' }));
    const mutation = kind === 'drive' ? H.drive : H.charging;
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0][0]).toEqual({
      id: 42, case_id: 7, ended_at: repairCase.suggested_ended_at, rule: repairCase.rule,
      expected_stored_ended_at: repairCase.evidence_stored_ended_at,
    });
    expect(mutation.mock.calls[0][0]).toEqual(H.preview.mock.calls[0][0]);
  });

  it.each([
    ['boundary and stored pin', { suggested_ended_at: '2026-08-25T10:30:00Z', evidence_stored_ended_at: null }],
    ['case', { id: 8 }],
    ['vehicle', { vehicle_id: 4 }],
    ['session', { session_id: 43 }],
    ['kind', { kind: 'charging', rule: 'charging_open_drive_started' }],
    ['revision', { updated_at: '2026-08-25T10:03:00Z' }],
  ] satisfies [string, Partial<RepairCase>][])('rejects an obsolete reviewed %s without retargeting preview', (_label, change) => {
    const original = buildCase();
    const { rerender } = render(<RepairCaseControlledActions repairCase={original} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Review & apply' }));
    rerender(<RepairCaseControlledActions repairCase={{ ...original, ...change }} canWrite />);
    expect(screen.getByText('Original case impact')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply repair' })).toBeDisabled();
    act(() => H.confirm?.());
    expect(H.drive).not.toHaveBeenCalled();
    expect(H.charging).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not renew authority after a case scope change and return', () => {
    const original = buildCase();
    const { rerender } = render(<RepairCaseControlledActions repairCase={original} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Review & apply' }));
    rerender(<RepairCaseControlledActions repairCase={{ ...original, vehicle_id: 4 }} canWrite />);
    rerender(<RepairCaseControlledActions repairCase={original} canWrite />);
    act(() => H.confirm?.());
    expect(H.drive).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Apply repair' })).toBeDisabled();
  });

  it('retains authority through an unchanged cloned record refresh', () => {
    const original = buildCase();
    const { rerender } = render(<RepairCaseControlledActions repairCase={original} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Review & apply' }));
    rerender(<RepairCaseControlledActions repairCase={structuredClone(original)} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply repair' }));
    expect(H.drive).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale late preview and keeps later review notes intact', () => {
    let complete: ((impact: RepairImpactPreview) => void) | undefined;
    H.preview.mockImplementation((_input: ApplyRepairInput, options: { onSuccess: typeof complete }) => {
      complete = options.onSuccess;
    });
    render(<RepairCaseControlledActions repairCase={buildCase()} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Review & apply' }));
    const impact = buildPreview(H.preview.mock.calls[0][0]);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss finding' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Operator note' }), {
      target: { value: 'Retain this dismissal draft' },
    });
    act(() => complete?.(impact));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Dismiss this finding?');
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toHaveValue('Retain this dismissal draft');
    expect(screen.queryByText('Original case impact')).not.toBeInTheDocument();
  });

  it('ignores preview completion after an evidence revision change or unmount', () => {
    let complete: ((impact: RepairImpactPreview) => void) | undefined;
    H.preview.mockImplementation((_input: ApplyRepairInput, options: { onSuccess: typeof complete }) => {
      complete = options.onSuccess;
    });
    const original = buildCase();
    const { rerender, unmount } = render(<RepairCaseControlledActions repairCase={original} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Review & apply' }));
    const impact = buildPreview(H.preview.mock.calls[0][0]);
    rerender(<RepairCaseControlledActions repairCase={{ ...original, updated_at: 'new-revision' }} canWrite />);
    act(() => complete?.(impact));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();
    act(() => complete?.(impact));
    expect(H.drive).not.toHaveBeenCalled();
  });

  it('keeps the reviewed preview immutable when the response object changes', () => {
    const impact = buildPreview({
      id: 42, ended_at: '2026-08-25T10:00:00Z',
      expected_stored_ended_at: '', rule: 'drive_open_charging_started',
    });
    H.preview.mockImplementation((_input: ApplyRepairInput, options: { onSuccess: (data: RepairImpactPreview) => void }) => {
      options.onSuccess(impact);
    });
    const original = buildCase();
    const { rerender } = render(<RepairCaseControlledActions repairCase={original} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Review & apply' }));
    impact.warnings[0] = 'Unreviewed replacement impact';
    rerender(<RepairCaseControlledActions repairCase={structuredClone(original)} canWrite />);
    expect(screen.getByText('Original case impact')).toBeInTheDocument();
    expect(screen.queryByText('Unreviewed replacement impact')).not.toBeInTheDocument();
  });

  it.each(['dismiss', 'quarantine', 'restore'] as const)('preserves the %s action, required note and original target', (action) => {
    const original = buildCase({ status: action === 'restore' ? 'quarantined' : 'open' });
    render(<RepairCaseControlledActions repairCase={original} quarantine={quarantine} canWrite />);
    const label = action === 'dismiss' ? 'Dismiss finding'
      : action === 'quarantine' ? 'Move to quarantine' : 'Restore session';
    fireEvent.click(screen.getByRole('button', { name: label }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: label })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Operator note' }), {
      target: { value: '  Evidence reviewed  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: label }));
    const mutation = action === 'dismiss' ? H.transition : action === 'quarantine' ? H.quarantine : H.restore;
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0][0]).toEqual(action === 'dismiss'
      ? { case_id: 7, status: 'dismissed', expected_updated_at: original.updated_at, resolution_note: 'Evidence reviewed' }
      : action === 'quarantine' ? { case_id: 7, reason: 'Evidence reviewed' }
        : { quarantine_id: 91, reason: 'Evidence reviewed' });
  });

  it('guards a disabled confirmation and retains its note, reason and Cancel', () => {
    const original = buildCase();
    const { rerender } = render(<RepairCaseControlledActions repairCase={original} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss finding' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Operator note' }), {
      target: { value: 'Original operator note' },
    });
    rerender(<RepairCaseControlledActions repairCase={original} canWrite={false} writeBlockReason="Return to live mode" />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Dismiss finding' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toHaveValue('Original operator note');
    expect(screen.getByRole('note')).toHaveTextContent('Return to live mode');
    act(() => H.confirm?.());
    expect(H.transition).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('retains mutation loading, failed preview feedback and explicit retry', () => {
    const original = buildCase();
    H.previewError = new Error('Preview unavailable');
    const { rerender } = render(<RepairCaseControlledActions repairCase={original} canWrite />);
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review & apply' }));
    H.pending = true;
    rerender(<RepairCaseControlledActions repairCase={original} canWrite />);
    expect(screen.getByRole('button', { name: 'Apply repair' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    act(() => H.confirm?.());
    expect(H.drive).not.toHaveBeenCalled();
    H.pending = false;
    rerender(<RepairCaseControlledActions repairCase={original} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply repair' }));
    expect(H.drive).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
