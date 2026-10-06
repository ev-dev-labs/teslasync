import { type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DataStateSource } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { LayoutCard, SourceContent } from '@/components/layout';
import { useDataState } from '@/hooks/useDataState';

interface OwnershipPanelProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  empty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
  className?: string;
  source?: DataStateSource<unknown>;
  sourceEnabled?: boolean;
  editing?: boolean;
  preserveSummary?: boolean;
}

/** Domain adapter: callers retain policy, formatting and editor state. */
export function OwnershipPanel({
  title,
  description,
  actions,
  empty = false,
  emptyMessage,
  children,
  className,
  source,
  sourceEnabled = true,
  editing = false,
  preserveSummary = false,
}: OwnershipPanelProps) {
  const { t } = useTranslation();
  const dataState = useDataState(source ?? {});
  const message = emptyMessage ?? t('ownership.source.empty', 'No supported data is available yet.');
  const state = !source || !sourceEnabled
    ? empty ? 'empty' : 'ready'
    // An unsaved editor does not depend on the register's first successful read.
    : editing && !dataState.hasData ? 'ready'
      : dataState.fatalError ? 'error'
      : !dataState.hasData && source.isLoading ? 'loading'
        : dataState.status === 'stale' ? 'retained'
          : empty && !editing ? 'empty' : 'ready';
  const emptyContent = <>
    <EmptyState /* no-action: callers own domain prerequisites; source retry is supplied separately. */
      icon={<Info className="h-6 w-6" aria-hidden="true" />} message={message} />
    {preserveSummary && children}
  </>;
  const content = (
    <SourceContent
      state={state}
      label={title}
      emptyMessage={message}
      errorMessage={t('ownership.source.error', 'This source could not be loaded.')}
      error={dataState.fatalError}
      errorRecovery={dataState.retry ? { onRetry: dataState.retry } : undefined}
      emptyContent={emptyContent}
      loadingContent={preserveSummary ? children : undefined}
    >
      {empty && !editing ? emptyContent : children}
    </SourceContent>
  );
  return (
    <LayoutCard title={title} description={description} actions={actions}>
      <div className={className ?? 'min-w-0 space-y-4'}>
        {content}
        {preserveSummary && state === 'error' && children}
      </div>
    </LayoutCard>
  );
}
