import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { AlertBanner, EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button } from '@/components/ui';

interface Props {
  state: DataState<unknown>;
  label: string;
  emptyMessage: string;
  loading?: boolean;
  empty?: boolean;
  children: ReactNode;
}

/** Every caller owns a permanent shell; only this source's body may be replaced. */
export function SourceBoundary({ state, label, emptyMessage, loading, empty, children }: Props) {
  const { t } = useTranslation();
  return <>
    <StaleRefreshWarning state={state} label={label} />
    {state.fatalError ? (
      <QueryError error={state.fatalError} onRetry={state.retry ?? undefined} resourceName={label} />
    ) : !state.hasData && (state.isRefreshBlocked || (state.status === 'initial' && !loading)) ? (
      <AlertBanner variant="info" role="status" aria-live="polite"
        title={state.isRefreshBlocked
          ? t('dataSources.status.paused', 'Refresh paused')
          : t('dataSources.status.pending', 'Pending')}>
        {t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
        {state.isRefreshBlocked && state.retry ? (
          <Button variant="ghost" size="sm" onClick={state.retry}>
            {t('common.refresh', 'Refresh')}
          </Button>
        ) : null}
      </AlertBanner>
    ) : loading && !state.hasData ? (
      <Skeleton lines={4} />
    ) : empty ? (
      <EmptyState
        message={emptyMessage}
        action={state.retry ? { label: t('common.refresh', 'Refresh'), onClick: state.retry } : undefined}
      />
    ) : children}
  </>;
}
