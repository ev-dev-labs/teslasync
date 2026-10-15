import { useTranslation } from 'react-i18next';
import type { DataStateSource } from '@/api/dataState';
import type { StormguardEvent } from '@/api/hooks/useStormguard';
import { SourceContent } from '@/components/layout';
import { Badge, Caption, Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { stormLevelLabel, stormLevelVariant } from './stormguardPresentation';

export function StormGuardActivity({ query }: { query: DataStateSource<StormguardEvent[]> }) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const state = useDataState(query);
  const events = query.data ?? [];

  return (
    <section aria-label={t('stormguard.recent', 'Recent activity')} className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
      <Text as="h3" variant="label">{t('stormguard.recent', 'Recent activity')}</Text>
      <SourceContent
        state={state.fatalError ? 'error'
          : state.hasData ? state.status === 'stale' ? 'retained' : events.length > 0 ? 'ready' : 'empty'
          : query.isLoading || query.fetchStatus === 'fetching' ? 'loading' : 'empty'}
        label={t('stormguard.recent', 'Recent activity')}
        emptyMessage={t('stormguard.events.empty', 'No recent storm activity was returned.')}
        errorMessage={t('stormguard.events.error', 'Recent storm activity could not be loaded.')}
        error={state.fatalError}
        errorRecovery={{ onRetry: state.retry ?? undefined }}
        emptyContent={!state.hasData
          ? <Text as="p" variant="bodySm" role="status">
            {t('stormguard.events.unresolved', 'Recent storm activity has not resolved yet; no empty result is inferred.')}
          </Text>
          : undefined}
      >
        {events.length === 0 ? (
          <Text as="p" variant="bodySm">
            {t('stormguard.events.empty', 'No recent storm activity was returned.')}
          </Text>
        ) : (
          <ul className="space-y-1.5">
            {events.slice(0, 5).map(event => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Badge variant={stormLevelVariant(event.level)} size="sm">
                    {stormLevelLabel(t, event.level)}
                  </Badge>
                  <Caption className="min-w-0 break-words">{event.reason}</Caption>
                </span>
                <Caption className="shrink-0 tabular-nums">
                  {formatDateTime(event.created_at)}
                  {event.acted && ` · ${t('stormguard.acted', 'acted')}`}
                </Caption>
              </li>
            ))}
          </ul>
        )}
      </SourceContent>
    </section>
  );
}
