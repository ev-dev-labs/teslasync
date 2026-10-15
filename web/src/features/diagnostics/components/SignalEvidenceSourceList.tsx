import { useTranslation } from 'react-i18next';
import type { SignalEvidenceBundleSource } from '@/api/hooks/useTelemetry';
import { Badge, Button, Caption, Text } from '@/components/ui';
import { Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';

interface SignalEvidenceSourceListProps {
  sources: readonly SignalEvidenceBundleSource[];
  label: string;
}

/** Render the hook's complete source identities, never the flattened successful series. */
export function SignalEvidenceSourceList({ sources, label }: SignalEvidenceSourceListProps) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  if (sources.length === 0) return null;

  return (
    <ul aria-label={label} className="grid min-w-0 gap-3 sm:grid-cols-2">
      {sources.map(({ signal, state }) => {
        const points = state.data?.data;
        const observationTimes = (Array.isArray(points) ? points : [])
          .map((point) => point.ts)
          .filter((timestamp) => typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp)))
          .sort((a, b) => Date.parse(a) - Date.parse(b));
        const firstObservation = observationTimes[0];
        const lastObservation = observationTimes[observationTimes.length - 1];
        const emptyHistory = state.hasData && Array.isArray(points) && points.length === 0;
        const status = state.fatalError ? t('dataSources.status.failed', 'Failed')
          : state.refreshError ? t('dataSources.status.refreshFailed', 'Cached · refresh failed')
          : state.isRefreshBlocked ? t('dataSources.status.paused', 'Refresh paused')
          : state.status === 'initial' ? t('dataSources.status.pending', 'Pending')
          : state.status === 'unavailable' ? t('common.unavailable', 'Unavailable')
          : state.isRefreshing ? t('dataSources.status.refreshing', 'Refreshing')
          : state.status === 'stale' ? t('freshness.stale', 'Stale')
          : t('dataSources.status.ready', 'Ready');
        return (
          <li key={signal} data-signal-source={signal} data-source-status={state.status}
            className="min-w-0 space-y-2 rounded-lg border border-[var(--border-subtle)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Text variant="label" className="break-all">{signal}</Text>
              <Badge size="sm" variant={state.fatalError ? 'danger'
                : state.refreshError || state.isRefreshBlocked ? 'warning'
                : state.status === 'ok' ? 'success' : 'neutral'}>{status}</Badge>
            </div>
            {state.status === 'initial' && !state.isRefreshBlocked && (
              <div role="status" aria-label={t('developerReference.layout.source.loading', 'Loading {{label}}', { label: signal })}>
                <Skeleton className="h-6 w-full" />
              </div>
            )}
            {state.status === 'initial' && state.isRefreshBlocked && (
              <Text as="p" variant="bodySm" color="secondary" role="status">
                {t('chargingPlaces.workspace.initialPaused', '{{source}} loading is paused. No data has been loaded yet.', { source: signal })}
              </Text>
            )}
            {state.fatalError && <Text as="p" variant="bodySm" role="alert" className="break-words">{state.fatalError.message}</Text>}
            {state.status === 'unavailable' || emptyHistory ? (
              <Text as="p" variant="caption">{t('common.noDataForPeriod', 'No data available for this period')}</Text>
            ) : state.data && Array.isArray(state.data.data) ? (
              <Caption>{t('dashcam.reconstruction.pointCount', '{{count}} sample(s)', { count: state.data.data.length })}</Caption>
            ) : null}
            {state.data && (
              <>
                <Caption className="block break-words" title={`${state.data.from ?? '—'} → ${state.data.to ?? '—'}`}>
                  {t('teslaOnly.workbench.requested', 'Requested window')}: {formatDateTime(state.data.from)} → {formatDateTime(state.data.to)}
                </Caption>
                <Caption className="block break-words" title={`${firstObservation ?? '—'} → ${lastObservation ?? '—'}`}>
                  {t('teslaOnly.workbench.recorded', 'Actually recorded')}: {formatDateTime(firstObservation)} → {formatDateTime(lastObservation)}
                </Caption>
              </>
            )}
            {state.updatedAt != null && (
              <Caption className="block break-words" title={String(state.updatedAt)}>
                {t('operationalSource.fetchedAt', 'Fetched {{time}}', {
                  time: formatDateTime(new Date(state.updatedAt)),
                })}
              </Caption>
            )}
            {(state.status === 'stale' || state.status === 'partial') && (
              <StaleRefreshWarning state={state} label={signal} hideRetry
                message={state.isRefreshBlocked && !state.refreshError
                  ? t('chargingPlaces.workspace.pausedRetained', '{{source}} refresh is paused. Previously loaded data remains visible.', { source: signal })
                  : undefined} />
            )}
            {state.retry && (state.fatalError || state.refreshError || state.isRefreshBlocked || state.status === 'unavailable') && (
              <Button type="button" variant="secondary" size="sm" onClick={state.retry}
                wrapLabel className="max-md:min-h-11 max-md:min-w-11 md:min-h-9 md:min-w-0"
                disabled={state.isRefreshing}>
                {t('common.retry', 'Retry')}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
