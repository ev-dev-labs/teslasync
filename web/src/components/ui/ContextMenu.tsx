import { useCallback, useRef, type MouseEventHandler } from 'react';
import { closeContextMenu, openContextMenu, type ContextMenuItem } from './contextMenuStore';

export {
  openContextMenu, closeContextMenu, __resetContextMenuForTests,
  type ContextMenuItem,
} from './contextMenuStore';
export { ContextMenuRoot } from './ContextMenuRoot';

export interface UseContextMenuReturn {
  contextMenuProps: { onContextMenu: MouseEventHandler<HTMLElement> };
  openMenu: (items: ContextMenuItem[], x: number, y: number) => void;
  close: () => void;
}

export function useContextMenu(
  itemsOrGetter?: ContextMenuItem[] | (() => ContextMenuItem[]),
): UseContextMenuReturn {
  const itemsRef = useRef(itemsOrGetter);
  itemsRef.current = itemsOrGetter;

  const onContextMenu = useCallback<MouseEventHandler<HTMLElement>>((event) => {
    const source = itemsRef.current;
    if (!source) return;
    const items = typeof source === 'function' ? source() : source;
    if (!items || items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    openContextMenu(items, event.clientX, event.clientY, trigger);
  }, []);

  const openMenu = useCallback((items: ContextMenuItem[], x: number, y: number) => {
    const active = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    openContextMenu(items, x, y, active);
  }, []);

  return { contextMenuProps: { onContextMenu }, openMenu, close: closeContextMenu };
}
