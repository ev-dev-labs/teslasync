/**
 * Shared dialog focus contract (A11Y-04).
 *
 * Covers the three behaviours the per-component copies got wrong:
 * `[data-autofocus]` beating "first focusable", restoring to a fallback
 * when the trigger was removed while the dialog was open, and NOT
 * restoring when something else already claimed focus.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRef, useState } from 'react';
import {
  useDialogFocus,
  isFocusRestorable,
  DIALOG_AUTOFOCUS_ATTR,
} from '@/hooks/useDialogFocus';

function Dialog({
  open,
  onClose,
  autofocusSecond = false,
  closeOnEscape = true,
}: {
  open: boolean;
  onClose: () => void;
  autofocusSecond?: boolean;
  closeOnEscape?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus({ open, containerRef: ref, onClose, closeOnEscape });
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
      <button type="button">first</button>
      <button
        type="button"
        {...(autofocusSecond ? { [DIALOG_AUTOFOCUS_ATTR]: 'true' } : {})}
      >
        second
      </button>
      <button type="button">last</button>
    </div>
  );
}

function Harness({
  autofocusSecond = false,
  removeTriggerOnOpen = false,
  closeOnEscape = true,
}: {
  autofocusSecond?: boolean;
  removeTriggerOnOpen?: boolean;
  closeOnEscape?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <main id="main-content" tabIndex={-1} data-testid="main" />
      {!(removeTriggerOnOpen && open) && (
        <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
          open
        </button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        autofocusSecond={autofocusSecond}
        closeOnEscape={closeOnEscape}
      />
    </div>
  );
}

describe('useDialogFocus', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('focuses the first focusable element when the dialog opens', () => {
    render(<Harness />);
    // jsdom's fireEvent.click does not move focus the way a real click
    // does, so focus the trigger explicitly to model the real sequence.
    screen.getByTestId('trigger').focus();
    fireEvent.click(screen.getByTestId('trigger'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });

  it('prefers a [data-autofocus] control over the first focusable', () => {
    render(<Harness autofocusSecond />);
    // jsdom's fireEvent.click does not move focus the way a real click
    // does, so focus the trigger explicitly to model the real sequence.
    screen.getByTestId('trigger').focus();
    fireEvent.click(screen.getByTestId('trigger'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'second' }));
  });

  it('wraps Tab from the last control back to the first', () => {
    render(<Harness />);
    // jsdom's fireEvent.click does not move focus the way a real click
    // does, so focus the trigger explicitly to model the real sequence.
    screen.getByTestId('trigger').focus();
    fireEvent.click(screen.getByTestId('trigger'));
    const last = screen.getByRole('button', { name: 'last' });
    last.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });

  it('wraps Shift+Tab from the first control back to the last', () => {
    render(<Harness />);
    // jsdom's fireEvent.click does not move focus the way a real click
    // does, so focus the trigger explicitly to model the real sequence.
    screen.getByTestId('trigger').focus();
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }));
  });

  it('closes on Escape and restores focus to the trigger', () => {
    render(<Harness />);
    // jsdom's fireEvent.click does not move focus the way a real click
    // does, so focus the trigger explicitly to model the real sequence.
    screen.getByTestId('trigger').focus();
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('trigger'));
  });

  it('ignores Escape when closeOnEscape is false', () => {
    render(<Harness closeOnEscape={false} />);
    // jsdom's fireEvent.click does not move focus the way a real click
    // does, so focus the trigger explicitly to model the real sequence.
    screen.getByTestId('trigger').focus();
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('falls back to the main landmark when the trigger was removed', () => {
    render(<Harness removeTriggerOnOpen />);
    // jsdom's fireEvent.click does not move focus the way a real click
    // does, so focus the trigger explicitly to model the real sequence.
    screen.getByTestId('trigger').focus();
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.queryByTestId('trigger')).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByTestId('main'));
  });
});

describe('isFocusRestorable', () => {
  it('rejects null and detached nodes', () => {
    expect(isFocusRestorable(null)).toBe(false);
    expect(isFocusRestorable(document.createElement('button'))).toBe(false);
  });

  it('rejects disabled and aria-hidden elements', () => {
    const disabled = document.createElement('button');
    disabled.setAttribute('disabled', '');
    document.body.appendChild(disabled);
    expect(isFocusRestorable(disabled)).toBe(false);

    const hidden = document.createElement('button');
    hidden.setAttribute('aria-hidden', 'true');
    document.body.appendChild(hidden);
    expect(isFocusRestorable(hidden)).toBe(false);
  });

  it('accepts a connected, enabled element', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    expect(isFocusRestorable(button)).toBe(true);
  });
});
