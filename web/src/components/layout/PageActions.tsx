import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export interface PageActionsProps {
  metadata?: ReactNode;
  context?: ReactNode;
  secondary?: ReactNode;
  destructive?: ReactNode;
  overflow?: ReactNode;
  primary?: ReactNode;
  className?: string;
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
}: PageActionsProps) {
  const { t } = useTranslation();
  const hasContext = Boolean(metadata || context);
  const hasCommands = Boolean(secondary || destructive || overflow || primary);

  if (!hasContext && !hasCommands) return null;

  return (
    <div
      role="group"
      aria-label={t('common.actions', 'Actions')}
      className={cn(
        'flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 rounded-shape-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-1.5 sm:w-fit xl:justify-end',
        className,
      )}
      data-role="page-actions"
      data-action-order="context-secondary-destructive-overflow-primary"
    >
      {hasContext && (
        <div
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-initial"
          data-action-zone="context"
        >
          {metadata && (
            <div className="flex items-center gap-2" data-action-group="metadata">
              {metadata}
            </div>
          )}
          {context && (
            <div className="flex min-w-0 flex-wrap items-center gap-2" data-action-group="context">
              {context}
            </div>
          )}
        </div>
      )}

      {hasCommands && (
        <div
          className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2"
          data-action-zone="commands"
        >
          {secondary && (
            <div className="flex flex-wrap items-center gap-2" data-action-group="secondary">
              {secondary}
            </div>
          )}
          {destructive && (
            <div
              className={cn(
                'flex flex-wrap items-center gap-2',
                secondary && 'border-s border-[var(--border-default)] ps-2',
              )}
              data-action-group="destructive"
            >
              {destructive}
            </div>
          )}
          {overflow && (
            <div className="flex flex-wrap items-center gap-2" data-action-group="overflow">
              {overflow}
            </div>
          )}
          {primary && (
            <div className="flex flex-wrap items-center gap-2 sm:ms-1" data-action-group="primary">
              {primary}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
