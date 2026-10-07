import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';
import { Popover } from './Popover';

function HandoffHarness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <Button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        First
      </Button>
      <Button type="button" onClick={() => setOpen(false)}>
        Second
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        ariaLabel="First menu"
      >
        <Button type="button">Inside</Button>
      </Popover>
    </>
  );
}

describe('Popover focus restoration', () => {
  it('does not steal focus from another control during a popover handoff', () => {
    render(<HandoffHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    screen.getByRole('button', { name: 'Inside' }).focus();
    const second = screen.getByRole('button', { name: 'Second' });
    second.focus();
    fireEvent.click(second);

    expect(second).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: 'First menu' })).toBeNull();
  });

  it('still restores focus to the trigger after Escape', () => {
    render(<HandoffHarness />);

    const first = screen.getByRole('button', { name: 'First' });
    fireEvent.click(first);
    screen.getByRole('button', { name: 'Inside' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(first).toHaveFocus();
  });
});
