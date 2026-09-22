import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope';
import {
  WORKSPACE_SCOPED_CONTROL,
  type WorkspaceScopedComponent,
  type WorkspaceScopedControlKind,
} from '@/lib/workspaceScope';

export interface PageActionsProps {
  /** Unboxed scope row above a shared metadata/commands row on small screens. */
  layout?: 'rail' | 'scope-first';
  metadata?: ReactNode;
  context?: ReactNode;
  secondary?: ReactNode;
  destructive?: ReactNode;
  overflow?: ReactNode;
  primary?: ReactNode;
  className?: string;
}

function scopedControlKind(
  element: ReactElement,
): WorkspaceScopedControlKind | undefined {
  if (typeof element.type === 'string') return undefined;
  return (element.type as WorkspaceScopedComponent)[WORKSPACE_SCOPED_CONTROL];
}

function pruneManagedControls(
  node: ReactNode,
  hiddenKinds: ReadonlySet<WorkspaceScopedControlKind>,
): ReactNode {
  return Children.map(node, (child) => {
    if (!isValidElement(child)) return child;
    const kind = scopedControlKind(child);
    if (kind && hiddenKinds.has(kind)) return null;

    if (child.type !== Fragment && typeof child.type !== 'string') {
      return child;
    }

    const props = child.props as { children?: ReactNode };
    if (!Object.prototype.hasOwnProperty.call(props, 'children')) return child;
    const children = pruneManagedControls(props.children, hiddenKinds);
    if (Children.toArray(children).length === 0) return null;
    return cloneElement(child, undefined, children);
  });
}

function hasActionContent(node: ReactNode): boolean {
  return Children.toArray(node).length > 0;
}

/**
 * Canonical page-level action rail.
 *
 * Context and freshness controls stay left; commands stay right in the
 * stable order secondary -> destructive -> overflow -> primary. Rare
 * destructive actions should normally live inside the overflow control.
 */
export function PageActions({
  metadata,
  context,
  secondary,
  destructive,
  overflow,
  primary,
  className,
  layout = 'rail',
}: PageActionsProps) {
  const scopeFirst = layout === 'scope-first';
  const { t } = useTranslation();
  const workspaceScope = useWorkspaceScope();
  const hiddenKinds = new Set<WorkspaceScopedControlKind>();
  if (workspaceScope.managed && workspaceScope.range) hiddenKinds.add('range');
  if (workspaceScope.managed && workspaceScope.vehicle) hiddenKinds.add('vehicle');

  const visibleMetadata = pruneManagedControls(metadata, hiddenKinds);
  const visibleContext = pruneManagedControls(context, hiddenKinds);
  const visibleSecondary = pruneManagedControls(secondary, hiddenKinds);
  const visibleDestructive = pruneManagedControls(destructive, hiddenKinds);
  const visibleOverflow = pruneManagedControls(overflow, hiddenKinds);
  const visiblePrimary = pruneManagedControls(primary, hiddenKinds);
  const hasContext =
    hasActionContent(visibleMetadata) || hasActionContent(visibleContext);
  const hasCommands = [
    visibleSecondary,
    visibleDestructive,
    visibleOverflow,
    visiblePrimary,
  ].some(
    hasActionContent,
  );

  if (!hasContext && !hasCommands) return null;

  return (
    <div
      role="group"
      aria-label={t('common.actions', 'Actions')}
      className={cn(
        'flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 rounded-shape-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-1.5 sm:w-fit xl:justify-end',
        scopeFirst && 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-none border-0 bg-transparent p-0 sm:w-full xl:flex xl:w-fit xl:gap-3',
        className,
      )}
      data-role="page-actions"
      data-action-order="context-secondary-destructive-overflow-primary"
    >
      {hasContext && (
        <div
          className={cn('flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-initial', scopeFirst && 'contents')}
          data-action-zone="context"
        >
          {hasActionContent(visibleMetadata) && (
            <div className={cn('flex items-center gap-2', scopeFirst && 'order-2 min-w-0 flex-wrap xl:order-1')} data-action-group="metadata">
              {visibleMetadata}
            </div>
          )}
          {hasActionContent(visibleContext) && (
            <div className={cn('flex min-w-0 flex-wrap items-center gap-2', scopeFirst && 'order-1 col-span-2 xl:order-2')} data-action-group="context">
              {visibleContext}
            </div>
          )}
        </div>
      )}

      {hasCommands && (
        <div
          className={cn('ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2', scopeFirst && 'order-3')}
          data-action-zone="commands"
        >
          {hasActionContent(visibleSecondary) && (
            <div className="flex flex-wrap items-center gap-2" data-action-group="secondary">
              {visibleSecondary}
            </div>
          )}
          {hasActionContent(visibleDestructive) && (
            <div
              className={cn(
                'flex flex-wrap items-center gap-2',
                hasActionContent(visibleSecondary) &&
                  'border-s border-[var(--border-default)] ps-2',
              )}
              data-action-group="destructive"
            >
              {visibleDestructive}
            </div>
          )}
          {hasActionContent(visibleOverflow) && (
            <div className="flex flex-wrap items-center gap-2" data-action-group="overflow">
              {visibleOverflow}
            </div>
          )}
          {hasActionContent(visiblePrimary) && (
            <div className="flex flex-wrap items-center gap-2 sm:ms-1" data-action-group="primary">
              {visiblePrimary}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
