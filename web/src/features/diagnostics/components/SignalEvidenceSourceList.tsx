import { useTranslation } from 'react-i18next';
import type { SignalEvidenceBundleSource } from '@/api/hooks/useTelemetry';
import { Badge, Button, Caption, Text } from '@/components/ui';
import { Skeleton, StaleRefreshWarning } from '@/components/feedback';

interface SignalEvidenceSourceListProps {
  sources: readonly SignalEvidenceBundleSource[];
  label: string;
}

/** Render the hook's complete source identities, never the flattened successful series. */
export function SignalEvidenceSourceList({ sources, label }: SignalEvidenceSourceListProps) {
  const { t } = useTranslation();
  if (sources.length === 0) return null;

  return (
    <ul aria-label={label} className="grid min-w-0 gap-3 sm:grid-cols-2">
      {sources.map(({ signal, state }) => {
        const points = state.data?.data;
        const emptyHistory = state.hasData && Array.isArray(points) && points.length === 0;
        const status = state.fatalError ? t('dataSources.status.failed', 'Failed')
          : state.refreshError ? t('dataSources.status.refreshFailed', 'Cached · refresh failed')
          : state.isRefreshBlocked ? t('dataSources.status.paused', 'Paused offline')
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
            {state.status === 'initial' && (
              <div role="status" aria-label={t('developerReference.layout.source.loading', 'Loading {{label}}', { label: signal })}>
                <Skeleton className="h-6 w-full" />
              </div>
            )}
            {state.fatalError && <Text as="p" variant="bodySm" role="alert">{state.fatalError.message}</Text>}
            {state.status === 'unavailable' || emptyHistory ? (
              <Text as="p" variant="caption">{t('common.noDataForPeriod', 'No data available for this period')}</Text>
            ) : state.data && Array.isArray(state.data.data) ? (
              <Caption>{t('dashcam.reconstruction.pointCount', '{{count}} sample(s)', { count: state.data.data.length })}</Caption>
            ) : null}
            {state.updatedAt != null && (
              <Caption>
                {t('freshness.lastUpdated', 'Last updated: {{time}}', {
                  time: new Date(state.updatedAt).toLocaleString(),
                })}
              </Caption>
            )}
            {(state.status === 'stale' || state.status === 'partial') && (
              <StaleRefreshWarning state={state} label={signal} hideRetry />
            )}
            {state.retry && (state.fatalError || state.refreshError || state.isRefreshBlocked || state.status === 'unavailable') && (
              <Button type="button" variant="secondary" size="sm" onClick={state.retry}
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
