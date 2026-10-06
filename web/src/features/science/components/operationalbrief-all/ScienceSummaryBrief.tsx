import type { ScienceWindow } from '@/api/hooks/useScience';
import type { DataState } from '@/api/dataState';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { Caption } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { formatDateTime } from '@/lib/dateFormat';

import { useT } from '../helpers';

interface ScienceSummaryBriefProps {
  title: string;
  description: string;
  metrics: readonly StatMetric[];
  states: readonly DataState<unknown>[];
  window: ScienceWindow;
  report?: { start: string; end: string; vehicle_id: number };
  limited: boolean;
  testId: string;
}

export function ScienceSummaryBrief({
  title, description, metrics, states, window, report, limited, testId,
}: ScienceSummaryBriefProps) {
  const t = useT();
  const operationalMetrics = useOperationalMetrics(metrics);
  const loading = states.every((state) => state.status === 'initial');
  const retained = states.some((state) => state.hasData);
  const failed = states.some((state) => state.fatalError != null);
  const pending = states.some((state) => state.status === 'initial');
  const refreshFailed = states.some((state) => state.refreshError != null);
  const offline = states.some((state) => state.isRefreshBlocked);
  const stale = states.some((state) => state.status === 'stale');
  const statusLabel = loading
    ? t('science.overview.loading', 'Loading')
    : failed
      ? retained
        ? t('science.brief.partial', 'Some reports unavailable')
        : t('science.overview.failed', 'Unavailable')
      : refreshFailed
        ? t('science.overview.cached', 'Cached · refresh failed')
        : offline
          ? t('science.brief.offline', 'Cached · refresh paused')
          : stale
            ? t('science.brief.stale', 'Retained report')
            : pending
              ? t('science.brief.pending', 'Some reports loading')
              : limited || !retained
                ? t('science.overview.limited', 'Limited evidence')
                : t('science.overview.available', 'Evidence available');
  const updatedAt = states.length === 1 ? states[0].updatedAt : null;
  const start = report?.start ?? window.start;
  const end = report?.end ?? window.end;
  const scope = t('science.brief.scope', 'Vehicle {{vehicle}} · {{start}} → {{end}}', {
    vehicle: report?.vehicle_id ?? window.vehicleId ?? t('science.unknown', 'unknown'),
    start: start ? formatDateTime(start) : t('science.unknown', 'unknown'),
    end: end ? formatDateTime(end) : t('science.unknown', 'unknown'),
  });

  return (
    <OperationalBrief
      compact
      eyebrow={t('science.title', 'Science lab')}
      title={title}
      description={description}
      statusLabel={statusLabel}
      statusTone={loading || failed || pending || refreshFailed || offline || stale || limited || !retained ? 'warning' : 'info'}
      metrics={operationalMetrics}
      loading={loading}
      scope={<Caption>{scope}</Caption>}
      freshness={<Caption>{states.length > 1
        ? t('science.brief.independent', 'Independent reports; inspect each source state below.')
        : updatedAt != null
          ? t('science.brief.loaded', 'Report loaded {{at}}', { at: formatDateTime(new Date(updatedAt)) })
          : t('science.overview.noCount', 'Awaiting a successful report')}</Caption>}
      provenance={t('science.brief.provenance', 'Historical inputs and derived fits; source eligibility, assumptions and uncertainty apply. Counts are not a health grade.')}
      testId={testId}
    />
  );
}
