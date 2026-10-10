import { type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DataStateSource } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { LayoutCard, SourceContent } from '@/components/layout';
import { Icon } from '@/components/ui';
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
  const independentEditor = editing && !dataState.hasData;
  const retainedMessage = dataState.refreshError
    ? t('dataState.stale.message', 'The latest values are temporarily unavailable. Previously loaded data remains visible.')
    : dataState.isRefreshBlocked
      ? dataState.hasData
        ? t('shareCard.states.cachedPaused', 'Cached evidence remains visible while its refresh is paused.')
        : t('shareCard.states.paused', 'The initial query is paused while the network is unavailable; no empty response is inferred.')
      : undefined;
  const state = !source || !sourceEnabled
    ? empty ? 'empty' : 'ready'
    // An unsaved editor does not depend on the register's first successful read.
    : independentEditor ? 'ready'
      : dataState.fatalError ? 'error'
      : dataState.isRefreshBlocked ? 'retained'
        : !dataState.hasData ? 'loading'
        : dataState.status === 'stale' ? 'retained'
          : empty && !editing ? 'empty' : 'ready';
  const emptyContent = <>
    <EmptyState /* no-action: callers own domain prerequisites; source retry is supplied separately. */
      icon={<Icon icon={Info} size="xl" />} message={message} />
    {preserveSummary && children}
  </>;
  const content = (
    <SourceContent
      state={state}
      label={title}
      emptyMessage={message}
      errorMessage={t('ownership.source.error', 'This source could not be loaded.')}
      error={dataState.fatalError}
      errorRecovery={!independentEditor && dataState.retry ? { onRetry: dataState.retry } : undefined}
      retainedMessage={retainedMessage}
      emptyContent={emptyContent}
      loadingContent={preserveSummary ? children : undefined}
    >
      {source && sourceEnabled && !dataState.hasData && !editing
        ? preserveSummary ? children : null
        : empty && !editing ? emptyContent : children}
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
