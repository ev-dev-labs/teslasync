import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Zap } from 'lucide-react';
import type { DataState } from '@/api/dataState';
import { Button } from '@/components/ui';
import {
  DataStateNotice, EmptyState, QueryError, Skeleton, StaleRefreshWarning,
} from '@/components/feedback';

/** Source-local trust boundary. A refresh never replaces retained measurements
 * or any neighboring source; the enclosing card is always mounted. */
export function SectionState({
  noVehicle, state, loading, empty, noVehicleMessage, emptyMessage,
  onRetry, skeletonHeight = 220, children,
}: {
  noVehicle: boolean;
  state: DataState<unknown>;
  loading: boolean;
  empty: boolean;
  noVehicleMessage: string;
  emptyMessage: string;
  onRetry?: () => void;
  skeletonHeight?: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (noVehicle) {
    return <EmptyState
      icon={<Car className="h-8 w-8" aria-hidden="true" />}
      message={noVehicleMessage}
      actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
    />;
  }
  if (state.fatalError) return <QueryError error={state.fatalError} onRetry={onRetry} />;
  if (!state.hasData && state.isRefreshBlocked) {
    return <DataStateNotice state="unavailable" role="status"
      title={t('energyFlow.state.pausedTitle', 'Source paused')}>
      <p>{t('energyFlow.state.initialPaused', 'This source is paused. No measurements have been received yet.')}</p>
      {onRetry && <Button variant="ghost" onClick={onRetry}>{t('common.refresh', 'Refresh')}</Button>}
    </DataStateNotice>;
  }
  if (!state.hasData && loading) return <Skeleton height={skeletonHeight} rounded />;
  return <>
    <StaleRefreshWarning state={state} />
    {empty ? <EmptyState
      // no-action: without a retry callback, this source must await vehicle telemetry; no manual backfill is available.
      icon={<Zap className="h-8 w-8" aria-hidden="true" />}
      message={emptyMessage}
      action={onRetry ? { label: t('common.refresh', 'Refresh'), onClick: onRetry } : undefined}
    /> : children}
  </>;
}
