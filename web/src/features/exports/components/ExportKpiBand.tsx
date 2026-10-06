import { useTranslation } from 'react-i18next';

import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Caption } from '@/components/ui';
import type { DataState } from '@/api/dataState';
import type { ExportStats } from './exportStats';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { formatDateTime } from '@/lib/dateFormat';

interface ExportKpiBandProps {
  stats: ExportStats;
  isLoading: boolean;
  hasData?: boolean;
  retained?: boolean;
  sourceState?: Pick<DataState<unknown>, 'status' | 'updatedAt' | 'isRefreshing' | 'isRefreshBlocked'>;
}

export function ExportKpiBand({ stats, isLoading, hasData = true, retained = false, sourceState }: ExportKpiBandProps) {
  const { formatBytes } = useNumberFormatting();
  const { t } = useTranslation();
  const scope = t('exportsList.brief.scope', 'Loaded jobs before table filters and pagination; no date window is applied.');
  const description = t('exportsList.brief.description', 'Queue counts and known artifact sizes from the loaded export-job list. Table filters and selection do not change these totals.');
  const freshness = sourceState?.updatedAt != null
    ? t('exportsList.brief.updated', 'Last successful load: {{time}}', { time: formatDateTime(new Date(sourceState.updatedAt)) })
    : t('exportsList.brief.freshnessUnknown', 'Successful load time is unknown.');
  const provenance = t('exportsList.brief.provenance', 'Derived from the export/jobs response snapshot; list coverage is not an all-time or date-range guarantee.');
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'total', label: t('exportsList.kpi.total', 'Total exports'),
      rawValue: hasData ? stats.total : null,
      description: t('exportsList.brief.totalDetail', 'Every job in the returned list, including expired jobs and unrecognized statuses.') },
    { metricId: 'count', occurrenceId: 'ready', label: t('exportsList.kpi.ready', 'Ready'),
      rawValue: hasData ? stats.ready : null,
      description: t('exportsList.brief.readyDetail', 'Jobs marked ready in the returned list; their download actions remain in the jobs table.') },
    { metricId: 'count', occurrenceId: 'in-progress', label: t('exportsList.kpi.inProgress', 'In progress'),
      rawValue: hasData ? stats.inProgress : null,
      description: t('exportsList.brief.progressDetail', 'Queued and processing jobs combined; this is not a completion estimate.') },
    { metricId: 'count', occurrenceId: 'failed', label: t('exportsList.kpi.failed', 'Failed'),
      rawValue: hasData ? stats.failed : null,
      description: t('exportsList.brief.failedDetail', 'Jobs marked failed in the returned list, not a failure rate or a date-bounded total.') },
    { metricId: 'bytes', occurrenceId: 'storage', label: t('exportsList.kpi.storage', 'Total size'),
      rawValue: hasData ? stats.totalBytes : null,
      description: t('exportsList.brief.storageDetail', 'Sum of known positive finite file sizes in bytes across all returned jobs; missing or invalid sizes contribute nothing.'),
      context: t('exportsList.brief.storageDisplay', 'Binary byte units use saved precision and locale. A zero footprint displays as —, not as an unknown source.'),
      display: { formatter: (raw) => ({ value: formatBytes(raw, { zeroAsEmpty: true }), unit: '' }) } },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const status = sourceState?.status ?? (retained ? 'stale' : hasData ? 'ok' : 'initial');
  const statusLabel = isLoading
    ? t('exportsList.brief.loading', 'Loading export jobs')
    : status === 'initialFailure'
      ? t('exportsList.brief.failed', 'Export-job source failed')
      : status === 'stale'
        ? sourceState?.isRefreshBlocked
          ? t('exportsList.brief.pausedRetained', 'Retained jobs · refresh paused')
          : t('exportsList.brief.retained', 'Retained export jobs')
        : !hasData
          ? sourceState?.isRefreshBlocked
            ? t('exportsList.brief.paused', 'Export-job source paused')
            : t('exportsList.brief.unresolved', 'Export-job source unresolved')
          : sourceState?.isRefreshing
            ? t('exportsList.brief.refreshing', 'Refreshing export jobs')
            : status === 'partial'
              ? t('exportsList.brief.partial', 'Partial export-job source')
              : status === 'unavailable'
                ? t('exportsList.brief.unavailable', 'Export-job source unavailable')
                : t('exportsList.brief.snapshot', 'Export-job list snapshot');

  return (
    <OperationalBrief
      compact
      loading={isLoading}
      eyebrow={t('exportsList.brief.eyebrow', 'Export operations')}
      title={t('exportsList.kpi.label', 'Export summary')}
      description={description}
      statusLabel={statusLabel}
      statusTone={status === 'initialFailure' ? 'danger' : status === 'stale' || status === 'partial' ? 'warning' : 'neutral'}
      metrics={operationalMetrics}
      scope={<Caption>{scope}</Caption>}
      freshness={<Caption>{freshness}</Caption>}
      provenance={provenance}
      narrative={{
        whatChanged: description,
        whyItMatters: null,
        confidence: { label: 'not_scored', score: null, basis: [] },
        likelyCause: null,
        recommendedResponse: null,
        limitations: [scope],
        evidence: [],
        provenance: [{ source: provenance, method: freshness }],
      }}
    />
  );
}
