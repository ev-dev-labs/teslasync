import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorDisplay, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import type { DataState } from '@/api/dataState';

export interface EfficiencySourceProps {
  state: DataState<unknown>;
  loading: boolean;
  malformed: boolean;
  available: boolean;
  label: string;
  emptyMessage: string;
  emptyContent?: ReactNode;
  children: ReactNode;
}

/** The section owns the shell; a failure can replace only this source's body. */
export function EfficiencySource({
  state, loading, malformed, available, label, emptyMessage, emptyContent, children,
}: EfficiencySourceProps) {
  const { t } = useTranslation();
  if (state.fatalError) return <ErrorDisplay compact error={state.fatalError}
    message={t('efficiency.state.failed', 'Unable to load {{label}}', { label })}
    onRetry={state.retry ?? undefined} />;
  if (!state.hasData && loading) return <Skeleton height={220} />;
  if (malformed) return <ErrorDisplay compact
    error={new Error(t('efficiency.state.malformed', 'The source response is malformed; measurements are unavailable.'))}
    message={t('efficiency.state.malformed', 'The source response is malformed; measurements are unavailable.')}
    onRetry={state.retry ?? undefined} />;
  return <>
    <StaleRefreshWarning state={state} label={label}
      title={state.status === 'partial' ? t('efficiency.state.partialTitle', 'Incomplete measurements') : undefined}
      message={state.status === 'partial' ? t('efficiency.state.partial', 'Some measurements are missing or invalid. Available measurements remain visible.') : undefined} />
    {!state.hasData && !loading
      ? <EmptyState message={t('efficiency.state.unknown', 'The source has not supplied measurements for this vehicle.')}
          action={state.retry ? { label: t('common.retry', 'Retry'), onClick: state.retry } : undefined} />
      : available ? children : emptyContent ?? <EmptyState message={emptyMessage}
          action={state.retry ? { label: t('common.retry', 'Retry'), onClick: state.retry } : undefined} />}
  </>;
}
