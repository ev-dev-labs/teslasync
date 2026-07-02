import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import { Popover } from '../Popover';

/**
 * Radix's `DismissableLayer` (which now powers outside-pointerdown detection
 * under the hood) has two timing quirks that a bare synchronous
 * `fireEvent.pointerDown(...)` doesn't satisfy on its own:
 *
 *  1. It deliberately defers attaching its native document `pointerdown`
 *     listener by one tick via `setTimeout(..., 0)` — this stops the very
 *     pointerdown that *opened* the popover from being immediately treated
 *     as an "outside" dismissal. `flushOutsidePointerDownListener` awaits
 *     that tick.
 *  2. Radix's `Popover.Content` hardcodes `deferPointerDownOutside: true`,
 *     so a `pointerdown` outside merely arms a one-time `click` listener —
 *     the actual dismiss only fires once a matching `click` completes the
 *     gesture (mirroring a real mouse click, which always fires both).
 *     `fireFullClick` fires that full `pointerdown` + `click` pair.
 *
 * Without both, every pointerdown assertion below would either miss the
 * listener entirely or pass vacuously (dismiss never actually attempted)
 * rather than exercising the real guard logic.
 */
async function flushOutsidePointerDownListener() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function fireFullClick(element: Element) {
  // Floating-UI's position tracking (inside Radix's PopperContent) settles
  // via a microtask, outside of `fireEvent`'s own synchronous `act()` wrap —
  // flushing through `act(async () => ...)` lets that settle before the
  // assertion runs instead of leaking an "not wrapped in act(...)" warning.
  await act(async () => {
    fireEvent.pointerDown(element);
    fireEvent.click(element);
  });
}

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

  it('closes on pointer-down outside the popover', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByTestId('trigger'));
    await flushOutsidePointerDownListener();
    await fireFullClick(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on pointer-down inside the popover', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByTestId('trigger'));
    await flushOutsidePointerDownListener();
    await fireFullClick(screen.getByTestId('inner-button'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on pointer-down on the trigger itself', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByTestId('trigger'));
    await flushOutsidePointerDownListener();
    // Pointer-down (+ the click that completes the gesture) on the trigger
    // should be treated as the anchor, not as an "outside" dismissal — it's
    // the trigger's own onClick that's responsible for toggling closed.
    await fireFullClick(screen.getByTestId('trigger'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
