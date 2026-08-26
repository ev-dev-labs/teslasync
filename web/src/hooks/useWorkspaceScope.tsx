import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import type { WorkspaceRouteScope } from '@/lib/workspaceScope';

export interface WorkspaceScopeContextValue extends WorkspaceRouteScope {
  /** False outside the application shell so isolated components keep rendering. */
  managed: boolean;
}

const UNMANAGED_SCOPE: WorkspaceScopeContextValue = {
  managed: false,
  range: true,
  vehicle: true,
};

const WorkspaceScopeContext =
  createContext<WorkspaceScopeContextValue>(UNMANAGED_SCOPE);

export function WorkspaceScopeProvider({
  children,
  scope,
}: {
  children: ReactNode;
  scope: WorkspaceRouteScope;
}) {
  const value = useMemo<WorkspaceScopeContextValue>(
    () => ({ managed: true, ...scope }),
    [scope.range, scope.vehicle],
  );

  return (
    <WorkspaceScopeContext.Provider value={value}>
      {children}
    </WorkspaceScopeContext.Provider>
  );
}

export function useWorkspaceScope(): WorkspaceScopeContextValue {
  return useContext(WorkspaceScopeContext);
}
