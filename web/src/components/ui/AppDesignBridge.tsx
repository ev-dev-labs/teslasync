import { useLayoutEffect } from 'react';
import { useWidgetDesignPack } from '@/hooks/useWidgetDesignPack';
import { getAppDesignAttributes, observeAppDesignScopes } from './app-designs/designs';
import './appDesignPacks.css';

/** Layout routes only; the root attribute also reaches body-portaled overlays. */
export function AppDesignBridge() {
  const { packId, appWide, isReady } = useWidgetDesignPack();
  useLayoutEffect(() => {
    const root = document.documentElement;
    const attributes = getAppDesignAttributes(packId);
    const clear = () => {
      for (const name of Object.keys(attributes)) root.removeAttribute(name);
      root.removeAttribute('data-app-design-owner');
    };
    clear();
    if (!isReady || !appWide) return clear;
    for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value);
    const releaseScopes = observeAppDesignScopes(root);
    return () => { clear(); releaseScopes(); };
  }, [packId, appWide, isReady]);
  return null;
}
