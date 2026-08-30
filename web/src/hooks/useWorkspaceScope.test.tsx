// Contract tests for the workspace-scope context.
//
// This is the shared "who owns the global vehicle / date controls on this
// route" signal. The shell publishes it once (from `getWorkspaceRouteScope`)
// and page-level controls read it through `useWorkspaceScope` so a page never
// renders a second copy of a control the shell already owns.

import type { ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { WorkspaceScopeProvider, useWorkspaceScope } from './useWorkspaceScope';
import { getWorkspaceRouteScope } from '@/lib/workspaceScope';

function wrapperFor(scope: { range: boolean; vehicle: boolean }) {
  return ({ children }: { children: ReactNode }) => (
    <WorkspaceScopeProvider scope={scope}>{children}</WorkspaceScopeProvider>
  );
}

describe('useWorkspaceScope', () => {
  it('reports an unmanaged, permissive scope outside the app shell', () => {
    const { result } = renderHook(() => useWorkspaceScope());
    expect(result.current).toEqual({ managed: false, range: true, vehicle: true });
  });

  it('marks the scope managed inside the shell and forwards ownership flags', () => {
    const { result } = renderHook(() => useWorkspaceScope(), {
      wrapper: wrapperFor({ range: true, vehicle: false }),
    });
    expect(result.current).toEqual({ managed: true, range: true, vehicle: false });
  });

  it('keeps a stable identity across re-renders with unchanged flags', () => {
    const { result, rerender } = renderHook(() => useWorkspaceScope(), {
      wrapper: wrapperFor({ range: true, vehicle: true }),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('publishes exactly what the route resolver decided (single source of truth)', () => {
    for (const pathname of ['/drives', '/battery', '/settings', '/vehicles/42']) {
      const routeScope = getWorkspaceRouteScope(pathname);
      const { result } = renderHook(() => useWorkspaceScope(), {
        wrapper: wrapperFor(routeScope),
      });
      expect(result.current.range, pathname).toBe(routeScope.range);
      expect(result.current.vehicle, pathname).toBe(routeScope.vehicle);
      expect(result.current.managed, pathname).toBe(true);
    }
  });

  it('never reports ownership for both the shell and an unmanaged consumer', () => {
    // A managed scope with a control disabled means the shell is NOT rendering
    // it, so the page may. A managed scope with a control enabled means the
    // shell owns it and the page must defer — the two are mutually exclusive
    // by construction, which is what prevents duplicate context controls.
    const { result } = renderHook(() => useWorkspaceScope(), {
      wrapper: wrapperFor({ range: false, vehicle: true }),
    });
    const shellOwnsRange = result.current.managed && result.current.range;
    const pageMayOwnRange = !result.current.managed || !result.current.range;
    expect(shellOwnsRange).toBe(false);
    expect(pageMayOwnRange).toBe(true);
  });
});
