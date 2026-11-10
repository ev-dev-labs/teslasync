import { useLayoutEffect } from 'react';
import { useWidgetDesignPack } from '@/hooks/useWidgetDesignPack';

/** Layout routes only; the root attribute also reaches body-portaled overlays. */
export function AppDesignBridge() {
  const { packId, appWide, isReady } = useWidgetDesignPack();
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!isReady || !appWide || packId === 'classic') {
      root.removeAttribute('data-app-design-pack');
      return;
    }
    root.setAttribute('data-app-design-pack', packId);
    return () => { root.removeAttribute('data-app-design-pack'); };
  }, [packId, appWide, isReady]);
  return null;
}
