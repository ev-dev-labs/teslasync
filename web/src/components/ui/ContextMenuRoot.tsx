import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react';
import { closeContextMenu, getSnapshot, subscribe } from './contextMenuStore';

const ContextMenuView = lazy(() => import('./ContextMenuView'));

function PendingMenuDismiss() {
  useEffect(() => {
    const controller = new AbortController();
    const dismiss = (event: Event) => {
      if (event.type === 'pointerdown' || (event as KeyboardEvent).key === 'Escape') closeContextMenu();
    };
    const options = { capture: true, signal: controller.signal };
    document.addEventListener('keydown', dismiss, options);
    document.addEventListener('pointerdown', dismiss, options);
    return () => controller.abort();
  }, []);
  return null;
}

export function ContextMenuRoot() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!snapshot || typeof document === 'undefined') return null;
  return <Suspense fallback={<PendingMenuDismiss />}><ContextMenuView state={snapshot} /></Suspense>;
}
