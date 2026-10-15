import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepairBulkDismissDialog } from './RepairBulkDismissDialog';

const H = vi.hoisted(() => ({
  canWrite: true,
  confirm: undefined as (() => void) | undefined,
}));
vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => ({
    canWrite: H.canWrite,
    writeBlockReason: H.canWrite ? null : 'Reconnect before making operational changes.',
  }),
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

function props() {
  return {
    caseCount: 2, reason: 'Original operator note', loading: false,
    onReasonChange: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(),
  };
}

beforeEach(() => { H.canWrite = true; H.confirm = undefined; });

describe('RepairBulkDismissDialog current write eligibility', () => {
  it('requires a note and explicitly confirms the existing bulk action', () => {
    const input = props();
    const { rerender } = render(<RepairBulkDismissDialog {...input} reason=" " />);
    expect(screen.getByRole('button', { name: 'Dismiss selected' })).toBeDisabled();
    act(() => H.confirm?.());
    expect(input.onConfirm).not.toHaveBeenCalled();
    rerender(<RepairBulkDismissDialog {...input} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss selected' }));
    expect(input.onConfirm).toHaveBeenCalledTimes(1);
    expect(input.onCancel).not.toHaveBeenCalled();
  });

  it('uses the actual guard after opening, disabling confirmation and fields without dropping the note', () => {
    const input = props();
    const { rerender } = render(<RepairBulkDismissDialog {...input} />);
    H.canWrite = false;
    rerender(<RepairBulkDismissDialog {...input} />);
    expect(screen.getByRole('button', { name: 'Dismiss selected' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toHaveValue(input.reason);
    expect(screen.getByRole('note')).toHaveTextContent('Reconnect before making operational changes.');
    act(() => H.confirm?.());
    fireEvent.change(screen.getByRole('textbox', { name: 'Operator note' }), { target: { value: 'Unreviewed replacement' } });
    expect(input.onConfirm).not.toHaveBeenCalled();
    expect(input.onReasonChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(input.onCancel).toHaveBeenCalledTimes(1);
  });

  it('retains the draft and editing after live eligibility returns', () => {
    const input = props();
    H.canWrite = false;
    const { rerender } = render(<RepairBulkDismissDialog {...input} />);
    H.canWrite = true;
    rerender(<RepairBulkDismissDialog {...input} />);
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toHaveValue(input.reason);
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Dismiss selected' })).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Operator note' }), { target: { value: 'Edited note' } });
    expect(input.onReasonChange).toHaveBeenCalledExactlyOnceWith('Edited note');
  });

  it('preserves mutation loading and blocks direct duplicate confirmation or editing', () => {
    const input = props();
    render(<RepairBulkDismissDialog {...input} loading />);
    expect(screen.getByRole('button', { name: 'Dismiss selected' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Operator note' })).toBeDisabled();
    act(() => H.confirm?.());
    expect(input.onConfirm).not.toHaveBeenCalled();
  });

  it('does not render or invoke bulk confirmation after selection is cleared', () => {
    const input = props();
    render(<RepairBulkDismissDialog {...input} caseCount={0} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => H.confirm?.());
    expect(input.onConfirm).not.toHaveBeenCalled();
  });

  it('honors the existing caller write gate without relaxing the actual operational guard', () => {
    const input = props();
    const { rerender } = render(<RepairBulkDismissDialog {...input} canWrite={false} writeBlockReason="Caller source is not current" />);
    expect(screen.getByRole('note')).toHaveTextContent('Caller source is not current');
    expect(screen.getByRole('button', { name: 'Dismiss selected' })).toBeDisabled();
    act(() => H.confirm?.());
    expect(input.onConfirm).not.toHaveBeenCalled();
    H.canWrite = false;
    rerender(<RepairBulkDismissDialog {...input} canWrite />);
    expect(screen.getByRole('button', { name: 'Dismiss selected' })).toBeDisabled();
    act(() => H.confirm?.());
    expect(input.onConfirm).not.toHaveBeenCalled();
  });
});
