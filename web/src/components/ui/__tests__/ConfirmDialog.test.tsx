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
import { render, fireEvent, screen, cleanup, act, waitFor } from '@testing-library/react';
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

  describe('ConfirmDialog — primitive preservation', () => {
    it('uses semantic warning chrome and keeps long actions in the persistent footer', () => {
      const confirmLabel = 'Confirm this warning after reviewing all affected resources and consequences';
      const cancelLabel = 'Cancel and return without changing any resources';
      render(
        <ConfirmDialog open title="Review warning" message="A warning remains meaningful."
          variant="warning" confirmLabel={confirmLabel} cancelLabel={cancelLabel}
          details={<p>All affected resources are listed here.</p>}
          onConfirm={vi.fn()} onCancel={vi.fn()} />,
      );
      const confirm = screen.getByRole('button', { name: confirmLabel });
      const cancel = screen.getByRole('button', { name: cancelLabel });
      expect(confirm).toHaveClass('bg-[var(--semantic-warning-bg)]', 'text-[var(--semantic-warning)]');
      expect(confirm).not.toHaveClass('bg-amber-500');
      expect(confirm).toHaveClass('whitespace-normal', 'min-h-11');
      expect(cancel).toHaveClass('whitespace-normal', 'min-h-11');
      expect(confirm.closest('[data-modal-footer]')).toContainElement(cancel);
      expect(screen.getByText('All affected resources are listed here.')).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Review warning' })).toBeInTheDocument();
    });

    it('blocks loading confirmation, cancellation, close and Escape without changing silence', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      render(
        <ConfirmDialog open title="Discard?" message="Still processing." variant="warning"
          silenceKey="loading-discard" loading onConfirm={onConfirm} onCancel={onCancel} />,
      );
      const confirm = screen.getByRole('button', { name: 'Confirm' });
      const cancel = screen.getByRole('button', { name: 'Cancel' });
      expect(confirm).toBeDisabled();
      expect(confirm).toHaveAttribute('aria-busy', 'true');
      expect(cancel).toBeDisabled();
      expect(screen.getByRole('checkbox')).toBeDisabled();
      fireEvent.click(confirm);
      fireEvent.click(cancel);
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onConfirm).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      expect(isSilenced('loading-discard')).toBe(false);
    });

    it('requires exact typed text, retains caller validation and resets after reopening', () => {
      const onConfirm = vi.fn();
      const props = {
        title: 'Delete?', message: 'Cannot be undone.', requireTypedConfirmation: 'DELETE',
        typedConfirmationLabel: 'Enter the exact safety phrase', onConfirm, onCancel: vi.fn(),
      };
      const { rerender } = render(<ConfirmDialog {...props} open confirmDisabled />);
      const input = screen.getByRole('textbox', { name: props.typedConfirmationLabel });
      expect(input).toHaveAttribute('autocomplete', 'off');
      expect(input).toHaveAttribute('spellcheck', 'false');
      fireEvent.change(input, { target: { value: 'delete' } });
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
      fireEvent.change(input, { target: { value: 'DELETE' } });
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
      rerender(<ConfirmDialog {...props} open />);
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      rerender(<ConfirmDialog {...props} open={false} />);
      expect(screen.queryByRole('dialog')).toBeNull();
      rerender(<ConfirmDialog {...props} open />);
      expect(screen.getByRole('textbox', { name: props.typedConfirmationLabel })).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    });

    it('never auto-confirms a typed warning even when the action was silenced', () => {
      localStorage.setItem('teslasync:confirm-silence:v1', JSON.stringify(['reset']));
      const onConfirm = vi.fn();
      render(
        <ConfirmDialog open title="Reset?" message="Type to confirm." variant="warning"
          requireTypedConfirmation="reset" silenceKey="reset"
          onConfirm={onConfirm} onCancel={vi.fn()} />,
      );
      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    });

    it('preserves single Escape cancellation and restores the trigger after closing', async () => {
      const onCancel = vi.fn();
      const props = { title: 'Delete?', message: 'Cannot be undone.', onConfirm: vi.fn(), onCancel };
      const { rerender } = render(
        <><button type="button">Original trigger</button><ConfirmDialog {...props} open={false} /></>,
      );
      const trigger = screen.getByRole('button', { name: 'Original trigger' });
      trigger.focus();
      rerender(<><button type="button">Original trigger</button><ConfirmDialog {...props} open /></>);
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement);
      fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledTimes(1);
      rerender(<><button type="button">Original trigger</button><ConfirmDialog {...props} open={false} /></>);
      await waitFor(() => expect(trigger).toHaveFocus());
    });

    it('keeps confirmation and cancellation as non-submit actions inside a caller form', () => {
      const onSubmit = vi.fn();
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      render(
        <form onSubmit={onSubmit}>
          <ConfirmDialog open title="Review" message="Choose an action."
            onConfirm={onConfirm} onCancel={onCancel} />
        </form>,
      );
      const confirm = screen.getByRole('button', { name: 'Confirm' });
      const cancel = screen.getByRole('button', { name: 'Cancel' });
      expect(confirm).toHaveAttribute('type', 'button');
      expect(cancel).toHaveAttribute('type', 'button');
      fireEvent.click(confirm);
      fireEvent.click(cancel);
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });
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
