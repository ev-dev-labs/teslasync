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
import { typography } from '@/lib/tokens';
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
 * Scope selectors form their own zone and may wrap onto a row of their own.
 * The freshness dot and every command form ONE right-aligned, non-wrapping
 * group (dot -> secondary -> destructive -> overflow -> primary), so the dot
 * never separates from the icons on narrow screens. Rare destructive actions
 * should normally live inside the overflow control.
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
  const hasContext = hasActionContent(visibleContext);
  const hasCommands = [
    visibleSecondary,
    visibleDestructive,
    visibleOverflow,
    visiblePrimary,
  ].some(
    hasActionContent,
  );


  const hasControls = hasActionContent(visibleMetadata) || hasCommands;
  if (!hasContext && !hasControls) return null;

  return (
    <div
      role="group"
      aria-label={t('common.actions', 'Actions')}
      className={cn(
        'flex w-full min-w-0 max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-shape-lg border border-[var(--border-subtle)] bg-surface-2 p-2 sm:w-fit',
        scopeFirst && 'rounded-none border-0 bg-transparent p-0 sm:w-full xl:w-fit',
        className,
      )}
      data-role="page-actions"
      data-action-order="context-secondary-destructive-overflow-primary"
    >
      {/* Scope selectors (vehicle, range, layout) may take their own row. */}
      {hasActionContent(visibleContext) && (
        <div
          className={cn('flex min-w-0 max-w-full flex-wrap items-center gap-2', scopeFirst ? 'w-full sm:me-auto sm:w-auto' : 'me-auto')}
          data-action-zone="context"
          data-action-group="context"
        >
          {visibleContext}
        </div>
      )}

      {/* One inline group that never splits: freshness dot and metadata
          first, then secondary -> destructive -> overflow -> primary. */}
      {hasControls && (
        <div
          className="ms-auto flex min-w-0 shrink-0 flex-nowrap items-center justify-end gap-1.5"
          data-action-zone="commands"
        >
          {hasActionContent(visibleMetadata) && (
            <div className={cn('flex shrink-0 flex-nowrap items-center gap-1.5', typography.color.secondary)} data-action-group="metadata">
              {visibleMetadata}
            </div>
          )}
          {hasActionContent(visibleSecondary) && (
            <div className="flex shrink-0 flex-nowrap items-center gap-1.5" data-action-group="secondary">
              {visibleSecondary}
            </div>
          )}
          {hasActionContent(visibleDestructive) && (
            <div
              className={cn(
                'flex shrink-0 flex-nowrap items-center gap-1.5',
                hasActionContent(visibleSecondary) &&
                  'border-s border-[var(--border-default)] ps-1.5',
              )}
              data-action-group="destructive"
            >
              {visibleDestructive}
            </div>
          )}
          {hasActionContent(visibleOverflow) && (
            <div className="flex shrink-0 flex-nowrap items-center gap-1.5" data-action-group="overflow">
              {visibleOverflow}
            </div>
          )}
          {hasActionContent(visiblePrimary) && (
            <div className="flex shrink-0 flex-nowrap items-center gap-1.5" data-action-group="primary">
              {visiblePrimary}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
