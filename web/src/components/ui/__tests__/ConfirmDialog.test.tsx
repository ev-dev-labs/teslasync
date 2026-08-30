/**
 * `<ConfirmDialog>` silenceKey behavior.
 *
 * Validates the "Don't ask again" checkbox and the safety gates that
 * suppress it for destructive variants. Pairs with the broader keyboard /
 * focus-trap coverage in `focusTrap.test.tsx` and the promise-flow
 * coverage in `useConfirm.test.tsx`.
 */
import '@/i18n';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';
import { isSilenced } from '@/lib/confirmSilence';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  cleanup();
});

describe('ConfirmDialog — silenceKey', () => {
  it('honors caller-owned validation before enabling confirmation', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open
        title="Resolve case?"
        message="An operator note is required."
        confirmLabel="Resolve"
        confirmDisabled
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Resolve' })).toBeDisabled();

    rerender(
      <ConfirmDialog
        open
        title="Resolve case?"
        message="An operator note is required."
        confirmLabel="Resolve"
        confirmDisabled={false}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders the checkbox when silenceKey is provided on a non-destructive prompt', () => {
    render(
      <ConfirmDialog
        open
        title="Discard draft?"
        message="You have unsaved changes."
        variant="warning"
        silenceKey="discard-draft"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox).toBeInTheDocument();
    expect(checkbox.checked).toBe(false);
  });

  it('does not render the checkbox when silenceKey is omitted', () => {
    render(
      <ConfirmDialog
        open
        title="Discard draft?"
        message="You have unsaved changes."
        variant="warning"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('suppresses the checkbox for the danger variant even with silenceKey', () => {
    render(
      <ConfirmDialog
        open
        title="Delete vehicle?"
        message="This is destructive."
        variant="danger"
        silenceKey="delete-vehicle"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('suppresses the checkbox when requireTypedConfirmation is set', () => {
    render(
      <ConfirmDialog
        open
        title="Reset?"
        message="Type to confirm."
        variant="warning"
        requireTypedConfirmation="reset"
        silenceKey="reset"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // Typed confirmation input is rendered; the silence checkbox is not.
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('persists silence and resolves on confirm when checkbox is ticked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Discard draft?"
        message="You have unsaved changes."
        variant="warning"
        silenceKey="discard-draft"
        confirmLabel="Discard"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(isSilenced('discard-draft')).toBe(true);
  });

  it('does not silence when the user confirms without ticking the checkbox', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Discard draft?"
        message="You have unsaved changes."
        variant="warning"
        silenceKey="discard-draft"
        confirmLabel="Discard"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(isSilenced('discard-draft')).toBe(false);
  });

  it('does not silence when the user cancels with the checkbox ticked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Discard draft?"
        message="You have unsaved changes."
        variant="warning"
        silenceKey="discard-draft"
        cancelLabel="Cancel"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(isSilenced('discard-draft')).toBe(false);
  });

  it('auto-resolves immediately when silenceKey is already silenced', async () => {
    // Pre-silence the key so the dialog should never display.
    localStorage.setItem('teslasync:confirm-silence:v1', JSON.stringify(['discard-draft']));

    const onConfirm = vi.fn();
    await act(async () => {
      render(
        <ConfirmDialog
          open
          title="Discard draft?"
          message="You have unsaved changes."
          variant="warning"
          silenceKey="discard-draft"
          onConfirm={onConfirm}
          onCancel={() => {}}
        />,
      );
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Modal is suppressed entirely so no dialog renders.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('still renders normally when silenced flag exists for a danger variant', async () => {
    // Pre-silence "delete-vehicle" — but danger variant must override.
    localStorage.setItem('teslasync:confirm-silence:v1', JSON.stringify(['delete-vehicle']));

    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete vehicle?"
        message="This is destructive."
        variant="danger"
        silenceKey="delete-vehicle"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    // onConfirm did NOT auto-fire — the dialog is shown for confirmation.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('resets the checkbox between successive opens of the same dialog instance', () => {
    const { rerender } = render(
      <ConfirmDialog
        open
        title="Discard draft?"
        message="You have unsaved changes."
        variant="warning"
        silenceKey="discard-draft"
        confirmLabel="Discard"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const firstCheckbox = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(firstCheckbox);
    expect(firstCheckbox.checked).toBe(true);

    // Close & reopen — checkbox state must reset to unchecked.
    rerender(
      <ConfirmDialog
        open={false}
        title="Discard draft?"
        message="You have unsaved changes."
        variant="warning"
        silenceKey="discard-draft"
        confirmLabel="Discard"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    rerender(
      <ConfirmDialog
        open
        title="Discard draft?"
        message="You have unsaved changes."
        variant="warning"
        silenceKey="discard-draft"
        confirmLabel="Discard"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const reopenedCheckbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(reopenedCheckbox.checked).toBe(false);
  });
});
