import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Text } from '@/components/ui';
import { QueryError } from '@/components/feedback';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { StatPeriod } from '@/lib/metric-reference';
import type { FSMTransition } from '@/types/fsm';
import { computeFlapIds } from '../FSMHealthPanel';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

export function fsmMetrics(
  transitions: FSMTransition[] | undefined, total: number | undefined,
  currentState: string | null, t: TFunction,
): StatMetric[] {
  return [
    {
      metricId: 'count', occurrenceId: 'page', rawValue: transitions?.length ?? null,
      label: t('fsm.totalOnPage', 'Transitions (Page)'),
      description: t('fsm.statstrip.pageDescription', 'Transition rows loaded on this server page, not all transitions in the selected range.'),
      context: transitions && total != null ? t('fsm.statstrip.pageTotal', '{{page}} / {{total}}', { page: transitions.length, total })
        : t('fsm.statstrip.pageUnknown', 'Page or total count not supplied'),
    },
    {
      metricId: 'count', occurrenceId: 'total', rawValue: total ?? null,
      label: t('fsm.totalTransitions', 'Total transitions'),
      description: t('fsm.statstrip.totalDescription', 'Server-reported matching transitions across all pages for this vehicle, FSM filter and transition window.'),
    },
    {
      metricId: 'count', occurrenceId: 'flaps', rawValue: transitions ? computeFlapIds(transitions).size : null,
      label: t('fsm.flapCount', 'Flap warnings'),
      description: t('fsm.statstrip.flapsDescription', 'Transition IDs flagged by the existing flap detector on the loaded page only.'),
      context: t('fsm.statstrip.pageOnly', 'Loaded transition page only'),
    },
    {
      metricId: 'status', occurrenceId: 'state', rawValue: currentState,
      label: t('fsm.currentState', 'Current state'),
      description: t('fsm.statstrip.stateDescription', 'Textual current state from the separate live-state query, not historical state in the transition window.'),
      context: t('fsm.statstrip.liveContext', 'Live-state snapshot; independent of the transition range and timeline freeze'),
    },
  ];
}

export function FSMOperationalBrief({ transitions, stateQuery, currentState, period, onRetry }: {
  transitions: DataStateSource<{ data?: FSMTransition[]; total?: number }>;
  stateQuery: DataStateSource<unknown>;
  currentState: string | null;
  period: StatPeriod;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const history = deriveDataState(transitions);
  const live = deriveDataState(stateQuery);
  const fatal = history.fatalError ?? live.fatalError;
  const briefMetrics = useOperationalMetrics(fsmMetrics(transitions.data?.data, transitions.data?.total, currentState, t));
  const retained = (history.hasData && (history.status === 'stale' || history.isRefreshing))
    || (live.hasData && (live.status === 'stale' || live.isRefreshing));
  const error = fatal ?? history.refreshError ?? live.refreshError;
  const stateLabel = (source: Pick<typeof history, 'status'>) => t(`operationalSource.status.${source.status}`, {
    defaultValue: {
      initial: 'Loading source', ok: 'Snapshot loaded', stale: 'Retained source data',
      partial: 'Partial source data', unavailable: 'No source data', initialFailure: 'Source unavailable',
    }[source.status],
  });
  const fetchedAt = (updatedAt: number | null) => updatedAt != null
    ? t('operationalSource.fetchedAt', 'Fetched {{time}}', { time: new Date(updatedAt).toLocaleString() })
    : t('operationalSource.unknownFreshness', 'Fetch time not supplied');
  const scope = period.kind === 'analysis'
    ? t('fsm.brief.bounds', '{{label}} · [{{start}}, {{end}}) · {{timezone}}', {
      label: period.label, start: period.start, end: period.endExclusive, timezone: period.timezone,
    }) : `${period.label}${period.kind === 'unknown' && period.reason ? ` · ${period.reason}` : ''}`;
  const provenance = period.kind === 'unknown' ? period.reason : period.provenance;
  return <section aria-label={t('fsm.kpis', 'FSM summary metrics')} data-retained={retained}>
    {retained && <Text role="status">{t('operationalSource.retained', 'Showing retained measurements')}</Text>}
    {error && <Text role="alert">{error.message}</Text>}
    <OperationalBrief testId="fsm-summary" compact metrics={briefMetrics}
      loading={history.status === 'initial' && live.status === 'initial'}
      eyebrow={t('fsm.brief.eyebrow', 'State-machine observability')}
      title={t('fsm.brief.title', 'Transition and live-state evidence')}
      description={t('fsm.brief.description', 'Inspect page-scoped transitions and flap evidence alongside the matching server total and independently fetched current state.')}
      statusLabel={t('fsm.brief.sourceStatus', 'Transitions: {{history}} · Live state: {{live}}', {
        history: stateLabel(history), live: stateLabel(live),
      })}
      statusTone={error ? 'warning' : 'neutral'}
      scope={<Text as="span" variant="caption">{scope}</Text>}
      freshness={<Text as="span" variant="caption">{t('fsm.brief.freshness', 'Transitions: {{history}} · Live state: {{live}}', {
        history: fetchedAt(history.updatedAt), live: fetchedAt(live.updatedAt),
      })}</Text>}
      provenance={[scope, provenance].filter(Boolean).join(' · ')} />
    {provenance && <Text variant="caption">{provenance}</Text>}
    {fatal && <QueryError error={fatal} onRetry={onRetry} />}
  </section>;
}
