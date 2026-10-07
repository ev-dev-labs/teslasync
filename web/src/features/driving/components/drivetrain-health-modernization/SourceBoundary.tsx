import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';

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
