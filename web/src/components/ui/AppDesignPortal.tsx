import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  appDesignPortalScope, captureAppDesignOrigin,
  type AppDesignOriginSnapshot, type AppDesignPortalScope,
} from './appDesignOrigin';

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface AppDesignPortalProps {
  children: ReactNode;
  anchorRef?: RefObject<HTMLElement | null>;
  origin?: HTMLElement | null;
  originSnapshot?: AppDesignOriginSnapshot;
  /** Preserve the command palette's existing inline shell/focus engine. */
  inline?: boolean;
}

/**
 * Keep the existing body portal, with an inert logical-origin marker for
 * unanchored/programmatically opened dialogs. A layout-free boundary inherits
 * only a complete, verified preview profile, never a new theme/token snapshot.
 * Register the existing foundation's selector ownership for every descendant,
 * including vendor content, without relying on native CSS scope support.
 */
export function AppDesignPortal({ children, anchorRef, origin, originSnapshot, inline = false }: AppDesignPortalProps) {
  const originRef = useRef<HTMLTemplateElement>(null);
  const boundaryRef = useRef<HTMLDivElement>(null);
  const inferredInvokerRef = useRef<HTMLElement | null>(null);
  const scopeRef = useRef<AppDesignPortalScope>({
    preview: null,
    releaseOwner: null,
    retained: {
      snapshot: originSnapshot,
      profile: originSnapshot?.profile ?? null,
      locale: originSnapshot?.locale ?? { dir: null, lang: null },
    },
  });

  useClientLayoutEffect(() => {
    const logicalOrigin = originRef.current;
    const active = document.activeElement;
    const inlineInvoker = inferredInvokerRef.current ?? (inline && !logicalOrigin?.closest('[data-app-design-preview]') &&
      active instanceof HTMLElement && active.closest('[data-app-design-preview]')
      ? active : null);
    const explicitInvoker = anchorRef?.current ?? origin;
    inferredInvokerRef.current = explicitInvoker ?? inlineInvoker;
    const source = explicitInvoker ?? inlineInvoker ?? logicalOrigin;
    const boundary = boundaryRef.current;
    if (!source || !boundary) return;
    if (appDesignPortalScope.connect) {
      return appDesignPortalScope.connect(source, boundary, originSnapshot, scopeRef.current);
    }

    // Complete designs install their binding when the existing bridge/preview
    // loads. Neutral portals must not fetch that module or start an observer.
    const snapshot = originSnapshot ?? captureAppDesignOrigin(source);
    if (originSnapshot || snapshot.preview) boundary.setAttribute('data-app-design-preview', '');
    for (const name of ['dir', 'lang'] as const) {
      const value = snapshot.locale[name];
      if (value === null) boundary.removeAttribute(name);
      else boundary.setAttribute(name, value);
    }
  });

  useClientLayoutEffect(() => () => {
    scopeRef.current.releaseOwner?.();
    scopeRef.current.releaseOwner = null;
  }, []);

  if (!inline && typeof document === 'undefined') return null;

  return (
    <>
      <template ref={originRef} data-app-portal-origin="" />
      {inline ? (
        <div ref={boundaryRef} data-app-design-portal="" data-app-design-preview={originSnapshot ? '' : undefined}
          style={{ display: 'contents' }}>{children}</div>
      ) : createPortal(
          <div ref={boundaryRef} data-app-design-portal="" data-app-design-preview={originSnapshot ? '' : undefined}
            style={{ display: 'contents' }}>{children}</div>,
          document.body,
        )}
    </>
  );
}
