/**
 * Extra `useDialogFocus` cases that need their own harness (A11Y-04).
 *
 * Kept separate from `useDialogFocus.test.tsx` so the main file stays a
 * straight read of the happy path.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useDialogFocus } from '@/hooks/useDialogFocus';

/** Dialog opened programmatically — nothing was focused beforehand. */
function ProgrammaticHarness() {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus({ open, containerRef: ref, onClose: () => setOpen(false) });
  return (
    <div>
      <main id="main-content" tabIndex={-1} data-testid="main" />
      {open && (
        <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
          <button type="button">only</button>
        </div>
      )}
    </div>
  );
}

/** Closing this dialog immediately focuses something else. */
function ClaimingHarness() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus({
    open,
    containerRef: ref,
    onClose: () => {
      setOpen(false);
      // Model a "confirm → detail" flow, where closing one surface hands
      // focus straight to another.
      document.getElementById('next-surface')?.focus();
    },
  });
  return (
    <div>
      <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
        open
      </button>
      <button type="button" id="next-surface" data-testid="next">
        next
      </button>
      {open && (
        <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
          <button type="button">inside</button>
        </div>
      )}
    </div>
  );
}

describe('useDialogFocus — edge cases', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('sends focus to the main landmark when there was no trigger', () => {
    render(<ProgrammaticHarness />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    // Leaving focus on <body> would restart the next Tab at the top of
    // the document — the exact failure the trap exists to prevent.
    expect(document.activeElement).toBe(screen.getByTestId('main'));
  });

  it('does not override a deliberate focus claim made while closing', () => {
    render(<ClaimingHarness />);
    screen.getByTestId('trigger').focus();
    fireEvent.click(screen.getByTestId('trigger'));

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(document.activeElement).toBe(screen.getByTestId('next'));
  });
});
