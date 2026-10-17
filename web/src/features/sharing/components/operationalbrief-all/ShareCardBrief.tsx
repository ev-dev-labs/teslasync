import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { ShareCardSectionProps } from '../share-card/types';

interface Props extends ShareCardSectionProps {
  title: string;
  description: string;
  metrics: readonly StatMetric[];
}

export function ShareCardBrief({ analysis, state, title, description, metrics }: Props) {
  const { t } = useTranslation();
  const values = useOperationalMetrics(metrics);
  const status = !state.enabled
    ? t('shareCard.states.noVehicle', 'Select a vehicle to load this selected-window evidence.')
    : !state.hasData && state.initialError
      ? t('shareCard.states.error', 'Selected-window drive evidence is unavailable.')
      : state.isInitialLoading
        ? t('shareCard.states.loadingLabel', 'Loading share card evidence')
        : state.isInitialPaused
          ? t('shareCard.states.paused', 'The initial query is paused while the network is unavailable; no empty response is inferred.')
          : state.cachedRefreshError
            ? t('shareCard.source.cached', 'Cached')
            : state.cachedRefreshPaused
              ? t('shareCard.brief.paused', 'Cached evidence; refresh paused')
              : state.isRefreshing
                ? t('shareCard.brief.refreshing', 'Refreshing cached evidence')
                : state.hasData
                  ? t('shareCard.source.resolved', 'Resolved')
                  : t('shareCard.states.pending', 'Source availability has not resolved yet.');
  return (
    <OperationalBrief
      compact
      loading={state.isInitialLoading}
      eyebrow={t('shareCard.brief.eyebrow', 'Share card evidence')}
      title={title}
      description={description}
      metrics={values}
      statusLabel={status}
      statusTone={state.initialError || state.cachedRefreshError ? 'warning' : 'neutral'}
      scope={t('shareCard.source.calendarRange', '{{start}} through {{end}} in {{timezone}}', {
        start: analysis.window.startLabel,
        end: analysis.window.endLabel,
        timezone: analysis.window.resolvedTimezone,
      })}
      freshness={t('shareCard.brief.freshness', 'Drive timestamps describe the evidence window, not query freshness.')}
      provenance={t('shareCard.source.contract', 'One request, vehicle_id scoped, limit {{limit}}; the API can return at most {{limit}} rows.', { limit: 1_000 })}
    />
  );
}
