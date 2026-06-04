/**
 * `<ContextMenu>` primitive contract tests.
 *
 * Covers the core behaviour contract:
 *
 *   1. Right-click triggers the menu (via openContextMenu / hook trigger).
 *   2. ArrowDown focuses the first enabled item; Enter activates it.
 *   3. Escape closes the menu and restores focus to the trigger.
 *   4. Off-screen positioning flips the anchor edge.
 *   5. Outside-click closes the menu.
 *   6. Disabled items are skipped by arrow-key navigation.
 *
 * The `<ContextMenuRoot/>` is the only consumer of the module-level
 * store, so the tests render it inline and drive the store either
 * imperatively (via `openContextMenu`) or through the `useContextMenu`
 * hook on a small fixture trigger element.
 */

import '@/i18n';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import {
  ContextMenuRoot,
  useContextMenu,
  openContextMenu,
  closeContextMenu,
  __resetContextMenuForTests,
  type ContextMenuItem,
} from '../ContextMenu';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeItems(overrides: Partial<Record<string, Partial<ContextMenuItem>>> = {}): ContextMenuItem[] {
  const base: ContextMenuItem[] = [
    { id: 'a', label: 'Mark as read', onClick: vi.fn() },
    { id: 'b', label: 'Archive', onClick: vi.fn() },
    { id: 'c', label: 'Delete', destructive: true, onClick: vi.fn() },
  ];
  return base.map((it) => ({ ...it, ...overrides[it.id] }));
}

function Trigger({ items }: { items: ContextMenuItem[] }) {
  const { contextMenuProps } = useContextMenu(items);
  const ref = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={ref} type="button" data-testid="trigger" {...contextMenuProps}>
        Right-click me
      </button>
      <button type="button" data-testid="other">
        Other
      </button>
    </>
  );
}

function openMenuByRightClick(testId: string, x = 100, y = 100): void {
  act(() => {
    fireEvent.contextMenu(screen.getByTestId(testId), { clientX: x, clientY: y });
  });
}

function renderWithRoot(ui: React.ReactNode) {
  return render(
    <>
      {ui}
      <ContextMenuRoot />
    </>,
  );
}

beforeEach(() => {
  __resetContextMenuForTests();
  // Ensure window is a known size so the flip test is deterministic.
  Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 768, writable: true, configurable: true });
});

afterEach(() => {
  closeContextMenu();
  __resetContextMenuForTests();
  cleanup();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('ContextMenu — open / close lifecycle', () => {
  it('opens via right-click on a trigger bound through useContextMenu', () => {
    const items = makeItems();
    renderWithRoot(<Trigger items={items} />);
    expect(screen.queryByTestId('context-menu')).toBeNull();

    openMenuByRightClick('trigger');

    const menu = screen.getByTestId('context-menu');
    expect(menu).toBeInTheDocument();
    expect(menu).toHaveAttribute('role', 'menu');
    expect(screen.getByTestId('context-menu-item-a')).toHaveTextContent('Mark as read');
    expect(screen.getByTestId('context-menu-item-c')).toHaveAttribute('data-destructive', 'true');
  });

  it('opens via the imperative openContextMenu API', () => {
    renderWithRoot(<div data-testid="canvas" />);
    act(() => {
      openContextMenu(makeItems(), 50, 50, null);
    });
    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
  });

  it('does nothing when called with an empty item list', () => {
    renderWithRoot(<div />);
    act(() => {
      openContextMenu([], 0, 0, null);
    });
    expect(screen.queryByTestId('context-menu')).toBeNull();
  });

  it('closes on Escape and restores focus to the trigger', () => {
    const items = makeItems();
    renderWithRoot(<Trigger items={items} />);
    const trigger = screen.getByTestId('trigger') as HTMLButtonElement;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    act(() => { fireEvent.contextMenu(trigger, { clientX: 100, clientY: 100 }); });
    expect(screen.getByTestId('context-menu')).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByTestId('context-menu')).toBeNull();

    // queueMicrotask defers the focus restore — flush microtasks.
    return Promise.resolve().then(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('closes on outside pointer-down', () => {
    renderWithRoot(<Trigger items={makeItems()} />);
    openMenuByRightClick('trigger');
    expect(screen.getByTestId('context-menu')).toBeInTheDocument();

    act(() => {
      fireEvent.pointerDown(screen.getByTestId('other'));
    });
    expect(screen.queryByTestId('context-menu')).toBeNull();
  });

  it('keeps the menu open when pointer-down lands inside it', () => {
    renderWithRoot(<Trigger items={makeItems()} />);
    openMenuByRightClick('trigger');
    fireEvent.pointerDown(screen.getByTestId('context-menu-item-a'));
    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
  });
});

describe('ContextMenu — keyboard navigation', () => {
  it('ArrowDown on the menu container focuses the first enabled item', () => {
    renderWithRoot(<Trigger items={makeItems()} />);
    openMenuByRightClick('trigger');
    const menu = screen.getByTestId('context-menu');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('context-menu-item-a'));
  });

  it('ArrowDown wraps around at the last item', () => {
    renderWithRoot(<Trigger items={makeItems()} />);
    openMenuByRightClick('trigger');
    const a = screen.getByTestId('context-menu-item-a');
    const b = screen.getByTestId('context-menu-item-b');
    const c = screen.getByTestId('context-menu-item-c');
    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(c);
    fireEvent.keyDown(c, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(a);
  });

  it('ArrowUp on the menu container focuses the last enabled item', () => {
    renderWithRoot(<Trigger items={makeItems()} />);
    openMenuByRightClick('trigger');
    const menu = screen.getByTestId('context-menu');

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByTestId('context-menu-item-c'));
  });

  it('Home / End jump to first / last enabled item', () => {
    renderWithRoot(<Trigger items={makeItems()} />);
    openMenuByRightClick('trigger');
    const menu = screen.getByTestId('context-menu');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('context-menu-item-c'));
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByTestId('context-menu-item-a'));
  });

  it('skips disabled items during arrow navigation', () => {
    const items = makeItems({ b: { disabled: true } });
    renderWithRoot(<Trigger items={items} />);
    openMenuByRightClick('trigger');
    const a = screen.getByTestId('context-menu-item-a');
    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('context-menu-item-c'));
  });

  it('Tab closes the menu (focus leaves)', () => {
    renderWithRoot(<Trigger items={makeItems()} />);
    openMenuByRightClick('trigger');
    const menu = screen.getByTestId('context-menu');
    fireEvent.keyDown(menu, { key: 'Tab' });
    expect(screen.queryByTestId('context-menu')).toBeNull();
  });
});

describe('ContextMenu — item activation', () => {
  it('Enter on a focused item invokes its onClick and closes the menu', async () => {
    const onClick = vi.fn();
    const items: ContextMenuItem[] = [{ id: 'a', label: 'Mark as read', onClick }];
    renderWithRoot(<Trigger items={items} />);
    openMenuByRightClick('trigger');
    const item = screen.getByTestId('context-menu-item-a');
    item.focus();
    fireEvent.keyDown(item, { key: 'Enter' });
    // Menu closes synchronously; handler runs in the next microtask.
    expect(screen.queryByTestId('context-menu')).toBeNull();
    await Promise.resolve();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('clicking an item invokes its onClick and closes the menu', async () => {
    const onClick = vi.fn();
    const items: ContextMenuItem[] = [{ id: 'a', label: 'Mark as read', onClick }];
    renderWithRoot(<Trigger items={items} />);
    openMenuByRightClick('trigger');
    fireEvent.click(screen.getByTestId('context-menu-item-a'));
    expect(screen.queryByTestId('context-menu')).toBeNull();
    await Promise.resolve();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onClick for disabled items', async () => {
    const onClick = vi.fn();
    const items: ContextMenuItem[] = [
      { id: 'a', label: 'Disabled', onClick, disabled: true },
    ];
    renderWithRoot(<Trigger items={items} />);
    openMenuByRightClick('trigger');
    const item = screen.getByTestId('context-menu-item-a');
    fireEvent.click(item);
    await Promise.resolve();
    expect(onClick).not.toHaveBeenCalled();
    // Menu is still open because the click was a no-op.
    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
  });
});

describe('ContextMenu — viewport overflow flip', () => {
  it('flips the menu to the left when right-edge would overflow', () => {
    // Force the menu to a known width via getBoundingClientRect mock.
    const origRect = HTMLDivElement.prototype.getBoundingClientRect;
    HTMLDivElement.prototype.getBoundingClientRect = function () {
      if (this.getAttribute('role') === 'menu') {
        return {
          width: 200,
          height: 120,
          top: 0,
          left: 0,
          right: 200,
          bottom: 120,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return origRect.call(this);
    };
    try {
      renderWithRoot(<div />);
      // Open near the right edge: 1024 - 50 = 974, plus 200 width + 8 margin overflows.
      act(() => {
        openContextMenu(makeItems(), 974, 100, null);
      });
      const menu = screen.getByTestId('context-menu') as HTMLElement;
      // Expected flip: left = 974 - 200 = 774
      expect(menu.style.left).toBe('774px');
      // Vertical did not need to flip.
      expect(menu.style.top).toBe('100px');
    } finally {
      HTMLDivElement.prototype.getBoundingClientRect = origRect;
    }
  });

  it('flips the menu upward when bottom-edge would overflow', () => {
    const origRect = HTMLDivElement.prototype.getBoundingClientRect;
    HTMLDivElement.prototype.getBoundingClientRect = function () {
      if (this.getAttribute('role') === 'menu') {
        return {
          width: 200,
          height: 200,
          top: 0,
          left: 0,
          right: 200,
          bottom: 200,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return origRect.call(this);
    };
    try {
      renderWithRoot(<div />);
      // Open near the bottom edge: 768 - 50 = 718, plus 200 height + 8 margin overflows.
      act(() => {
        openContextMenu(makeItems(), 100, 718, null);
      });
      const menu = screen.getByTestId('context-menu') as HTMLElement;
      // Expected flip: top = 718 - 200 = 518
      expect(menu.style.top).toBe('518px');
      expect(menu.style.left).toBe('100px');
    } finally {
      HTMLDivElement.prototype.getBoundingClientRect = origRect;
    }
  });
});

describe('ContextMenu — useContextMenu hook surface', () => {
  it('returns a stable openMenu and a no-op contextMenuProps when items not provided', () => {
    function Probe() {
      const { contextMenuProps, openMenu } = useContextMenu();
      return (
        <button
          type="button"
          data-testid="probe"
          {...contextMenuProps}
          onClick={() => openMenu(makeItems(), 10, 10)}
        >
          probe
        </button>
      );
    }
    renderWithRoot(<Probe />);
    // Right-click does nothing because items wasn't supplied.
    act(() => { fireEvent.contextMenu(screen.getByTestId('probe')); });
    expect(screen.queryByTestId('context-menu')).toBeNull();
    // Imperative openMenu still works.
    act(() => { fireEvent.click(screen.getByTestId('probe')); });
    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
  });

  it('accepts a function form so items can be computed lazily at click time', () => {
    let counter = 0;
    function Probe() {
      const { contextMenuProps } = useContextMenu(() => {
        counter += 1;
        return makeItems();
      });
      return <button type="button" data-testid="probe" {...contextMenuProps}>probe</button>;
    }
    renderWithRoot(<Probe />);
    expect(counter).toBe(0);
    act(() => { fireEvent.contextMenu(screen.getByTestId('probe')); });
    expect(counter).toBe(1);
    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
  });
});
