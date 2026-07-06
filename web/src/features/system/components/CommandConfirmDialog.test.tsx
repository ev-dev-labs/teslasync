/**
 * CommandConfirmDialog tests.
 *
 * Exercises the destructive-command confirmation modal end-to-end:
 *   - Open/closed lifecycle + accessible name (labelled by the command).
 *   - Confirmation copy: explicit fallback, translated key, and the
 *     no-copy default ("Are you sure?").
 *   - onConfirm / onClose wiring for both the buttons and the keyboard
 *     (Enter to confirm, Escape to close).
 *   - Type-to-confirm gating: Confirm stays disabled until the exact word
 *     is typed (case-insensitive, whitespace-trimmed).
 *   - Countdown gating: Confirm shows a live seconds suffix and only
 *     unlocks once the timer elapses.
 *   - Loading state: Confirm is disabled + aria-busy and Enter is a no-op.
 *   - State reset when the dialog is reopened.
 *
 * Uses the real i18n instance (see AcknowledgeAlertDialog.test.tsx) so the
 * assertions match the shipped English copy. No network is touched — this
 * component is pure presentation over its props.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import '@/i18n';

import { CommandConfirmDialog } from './CommandConfirmDialog';
import { Icons } from '@/lib/icons';
import type { CommandDef } from '../commands';

function makeDef(overrides: Partial<CommandDef> = {}): CommandDef {
  return {
    id: 'wipe-data',
    command: 'wipe_data',
    labelKey: 'commands.test.wipe',
    labelFallback: 'Wipe Fleet Data',
    icon: Icons.vehicle,
    category: 'security',
    type: 'action',
    ...overrides,
  };
}

const getConfirm = () => screen.getByRole('button', { name: /confirm/i });
const getCancel = () => screen.getByRole('button', { name: /cancel/i });

describe('CommandConfirmDialog', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('renders nothing when open=false', () => {
    render(
      <CommandConfirmDialog open={false} onClose={() => {}} onConfirm={() => {}} def={makeDef()} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull();
  });

  it('renders an accessible dialog labelled by the command name', () => {
    render(
      <CommandConfirmDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        def={makeDef({ labelFallback: 'Wipe Fleet Data' })}
      />,
    );
    // The a11y contract: with no visible <title>, the Modal must expose an
    // aria-label so assistive tech can announce the dialog.
    const dialog = screen.getByRole('dialog', { name: /Wipe Fleet Data/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: /Wipe Fleet Data/i })).toBeInTheDocument();
  });

  it('shows the explicit confirmation copy, Cancel, and an enabled Confirm for a simple action', () => {
    render(
      <CommandConfirmDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        def={makeDef({ confirmFallback: 'Really wipe everything?' })}
      />,
    );
    expect(screen.getByText('Really wipe everything?')).toBeInTheDocument();
    expect(getCancel()).toBeInTheDocument();
    const confirm = getConfirm();
    expect(confirm).toBeEnabled();
    // No countdown → the label carries no seconds suffix.
    expect(confirm).toHaveTextContent(/^Confirm$/);
  });

  it('falls back to the default confirmation copy when no key or fallback is given', () => {
    render(
      <CommandConfirmDialog open onClose={() => {}} onConfirm={() => {}} def={makeDef()} />,
    );
    // Guards the empty-key hardening: t('') must not swallow the message.
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('renders confirmation copy from the confirmKey branch (with fallback)', () => {
    render(
      <CommandConfirmDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        def={makeDef({ confirmKey: 'commands.test.confirmMissing', confirmFallback: 'Custom warning text' })}
      />,
    );
    expect(screen.getByText('Custom warning text')).toBeInTheDocument();
    expect(screen.queryByText('Are you sure?')).toBeNull();
  });

  it('fires onConfirm exactly once when Confirm is clicked, without closing', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandConfirmDialog open onClose={onClose} onConfirm={onConfirm} def={makeDef()} />,
    );
    fireEvent.click(getConfirm());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('fires onClose when Cancel is clicked and never confirms', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandConfirmDialog open onClose={onClose} onConfirm={onConfirm} def={makeDef()} />,
    );
    fireEvent.click(getCancel());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <CommandConfirmDialog open onClose={onClose} onConfirm={() => {}} def={makeDef()} />,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('confirms on Enter when the command is confirmable', () => {
    const onConfirm = vi.fn();
    render(
      <CommandConfirmDialog open onClose={() => {}} onConfirm={onConfirm} def={makeDef()} />,
    );
    fireEvent.keyDown(getConfirm(), { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('gates Confirm behind an exact, case-insensitive, trimmed type-to-confirm word', () => {
    const onConfirm = vi.fn();
    render(
      <CommandConfirmDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        def={makeDef({ confirmInput: 'ERASE' })}
      />,
    );
    // Prompt + placeholder reflect the required word.
    expect(screen.getByText(/Type "ERASE" to confirm/i)).toBeInTheDocument();
    const input = screen.getByPlaceholderText('ERASE') as HTMLInputElement;
    expect(getConfirm()).toBeDisabled();

    fireEvent.change(input, { target: { value: 'WRONG' } });
    expect(getConfirm()).toBeDisabled();

    fireEvent.change(input, { target: { value: '  erase  ' } });
    expect(getConfirm()).toBeEnabled();

    fireEvent.click(getConfirm());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('ignores Enter until the type-to-confirm word matches', () => {
    const onConfirm = vi.fn();
    render(
      <CommandConfirmDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        def={makeDef({ confirmInput: 'ERASE' })}
      />,
    );
    const input = screen.getByPlaceholderText('ERASE') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'ERASE' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('resets the typed value when the dialog is reopened', () => {
    const { rerender } = render(
      <CommandConfirmDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        def={makeDef({ confirmInput: 'ERASE' })}
      />,
    );
    const input = () => screen.getByPlaceholderText('ERASE') as HTMLInputElement;
    fireEvent.change(input(), { target: { value: 'ERASE' } });
    expect(input().value).toBe('ERASE');

    rerender(
      <CommandConfirmDialog
        open={false}
        onClose={() => {}}
        onConfirm={() => {}}
        def={makeDef({ confirmInput: 'ERASE' })}
      />,
    );
    rerender(
      <CommandConfirmDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        def={makeDef({ confirmInput: 'ERASE' })}
      />,
    );
    expect(input().value).toBe('');
  });

  it('disables Confirm with aria-busy while loading and makes Enter a no-op', () => {
    const onConfirm = vi.fn();
    render(
      <CommandConfirmDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        def={makeDef()}
        loading
      />,
    );
    const confirm = getConfirm();
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    // Cancel remains operable so the user is never trapped mid-request.
    fireEvent.keyDown(getCancel(), { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  describe('countdown gating', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.useRealTimers();
      cleanup();
    });

    it('keeps Confirm disabled with a live seconds suffix until the timer elapses', () => {
      const onConfirm = vi.fn();
      render(
        <CommandConfirmDialog
          open
          onClose={() => {}}
          onConfirm={onConfirm}
          def={makeDef({ countdown: 3 })}
        />,
      );

      expect(getConfirm()).toBeDisabled();
      expect(getConfirm()).toHaveTextContent(/Confirm \(3s\)/);

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(getConfirm()).toHaveTextContent(/Confirm \(2s\)/);
      expect(getConfirm()).toBeDisabled();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      const confirm = getConfirm();
      expect(confirm).toBeEnabled();
      expect(confirm).toHaveTextContent(/^Confirm$/);

      fireEvent.click(confirm);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('ignores Enter while the countdown is still running', () => {
      const onConfirm = vi.fn();
      render(
        <CommandConfirmDialog
          open
          onClose={() => {}}
          onConfirm={onConfirm}
          def={makeDef({ countdown: 3 })}
        />,
      );
      // Cancel is enabled during the countdown; fire from it so the key event
      // reaches the dialog's onKeyDown handler.
      fireEvent.keyDown(getCancel(), { key: 'Enter' });
      expect(onConfirm).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      fireEvent.keyDown(getConfirm(), { key: 'Enter' });
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });
});
