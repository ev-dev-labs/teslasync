import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import { Popover } from '../Popover';

function Harness({
  onClose = vi.fn(),
}: {
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid="trigger"
      >
        Open
      </button>
      <Popover
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        anchorRef={ref}
        ariaLabel="test popover"
      >
        <div data-testid="popover-body">Hello</div>
        <button type="button" data-testid="inner-button">
          Inner
        </button>
      </Popover>
      <button type="button" data-testid="outside">
        Outside
      </button>
    </div>
  );
}

describe('<Popover />', () => {
  it('renders nothing when open is false', () => {
    render(<Harness />);
    expect(screen.queryByTestId('popover-body')).not.toBeInTheDocument();
  });

  it('portals content into document.body when open is true', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    const body = screen.getByTestId('popover-body');
    expect(body).toBeInTheDocument();
    // Portaled outside the harness root.
    expect(body.closest('[data-testid="trigger"]')).toBeNull();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on pointer-down outside the popover', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on pointer-down inside the popover', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.pointerDown(screen.getByTestId('inner-button'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on pointer-down on the trigger itself', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByTestId('trigger'));
    // Pointer-down on trigger should be handled by the trigger's own onClick.
    fireEvent.pointerDown(screen.getByTestId('trigger'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
