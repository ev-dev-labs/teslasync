import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContextMenuRoot, __resetContextMenuForTests, openContextMenu } from '../ContextMenu';
import { getSnapshot } from '../contextMenuStore';

const pending = vi.hoisted(() => ({
  resolve: null as ((module: { default: () => ReactNode }) => void) | null,
}));
vi.mock('../ContextMenuView', () => new Promise<{ default: () => ReactNode }>(resolve => { pending.resolve = resolve; }));

afterEach(() => {
  cleanup();
  __resetContextMenuForTests();
});

it('preserves Escape, outside-click and focus restoration while the first renderer is loading', async () => {
  const outsideClick = vi.fn();
  render(<><button>Trigger</button><button onClick={outsideClick}>Outside</button><ContextMenuRoot /></>);
  const trigger = screen.getByRole('button', { name: 'Trigger' });
  trigger.focus();
  const open = () => act(() => {
    openContextMenu([{ id: 'action', label: 'Action', onClick: vi.fn() }], 10, 10, trigger);
  });
  open();
  await waitFor(() => expect(pending.resolve).not.toBeNull());
  expect(getSnapshot()).not.toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(getSnapshot()).toBeNull();
  await Promise.resolve();
  expect(trigger).toHaveFocus();

  open();
  const outside = screen.getByRole('button', { name: 'Outside' });
  fireEvent.pointerDown(outside);
  fireEvent.click(outside);
  expect(getSnapshot()).toBeNull();
  expect(outsideClick).toHaveBeenCalledOnce();
  await act(async () => {
    pending.resolve!({ default: () => <div role="menu">Deferred menu</div> });
  });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});
