import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { EmptyState, QueryError } from '@/components/feedback';
import { Icons } from '@/lib/icons';
import { formatDistance, formatDuration, formatEnergy } from '@/lib/unitConversion';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { DataStatus } from '@/api/dataState';
import type { DayLogResponse } from '@/api/types';

interface DayLogOperationalSummaryProps {
  data: DayLogResponse | null;
  date: string;
  timezone: string;
  isLoading: boolean;
  error: unknown;
  status: DataStatus;
  onRetry: () => void;
}

export function DayLogOperationalSummary({
  data, date, timezone, isLoading, error, status, onRetry,
}: DayLogOperationalSummaryProps) {
  const { t } = useTranslation();
  const summary = data?.summary ?? null;
  const hasSessions = (summary?.drive_count ?? 0) + (summary?.charge_count ?? 0) > 0;
  const scope = t('dayLog.brief.scope', '{{date}} · {{timezone}}', {
    date: data?.date ?? date, timezone: data?.timezone ?? timezone,
  });
  const period = t('dayLog.summary.period', 'Selected vehicle day');
  const metricContext = <>{period} · {scope}</>;
  const sourceMetrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'drives', label: t('dayLog.summary.drives', 'Drives'),
      rawValue: summary?.drive_count ?? null, context: metricContext,
      description: t('dayLog.brief.drivesBasis', 'Recorded drive count for the selected vehicle day, before timeline filters.') },
    { metricId: 'count', occurrenceId: 'charges', label: t('dayLog.summary.charges', 'Charges'),
      rawValue: summary?.charge_count ?? null, context: metricContext,
      description: t('dayLog.brief.chargesBasis', 'Recorded charging-session count for the selected vehicle day, before timeline filters.') },
    { metricId: 'duration', occurrenceId: 'drive-time', label: t('dayLog.summary.driveTime', 'Drive time'),
      rawValue: summary?.drive_duration_s ?? null, context: metricContext,
      description: t('dayLog.brief.durationBasis', 'Recorded driving duration in seconds, converted only for display; missing duration is not zero.'),
      display: { formatter: (raw, preferences) => ({ value: formatDuration(raw, preferences.units), unit: '' }) } },
    { metricId: 'distance', occurrenceId: 'distance', label: t('dayLog.summary.distance', 'Distance'),
      rawValue: summary?.drive_distance_m ?? null, context: metricContext,
      description: t('dayLog.brief.distanceBasis', 'Recorded driving distance in meters, displayed using your saved unit and precision preferences.'),
      display: { formatter: (raw, preferences) => ({ value: formatDistance(raw, preferences.units), unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'energy-added', label: t('dayLog.summary.energyAdded', 'Energy added'),
      rawValue: summary?.energy_added_wh ?? null, context: metricContext,
      description: t('dayLog.brief.energyAddedBasis', 'Recorded charging energy in watt-hours; missing energy remains unknown.'),
      display: { formatter: (raw, preferences) => ({ value: formatEnergy(raw, preferences.units), unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'energy-used', label: t('dayLog.summary.energyUsed', 'Energy used'),
      rawValue: summary?.energy_used_wh ?? null, context: metricContext,
      description: t('dayLog.brief.energyUsedBasis', 'Recorded driving energy in watt-hours; missing energy remains unknown.'),
      display: { formatter: (raw, preferences) => ({ value: formatEnergy(raw, preferences.units), unit: '' }) } },
  ];
  const metrics = useOperationalMetrics(sourceMetrics);
  const hasUnavailableSources = data?.sources?.some((source) => source.status === 'unavailable') ?? false;
  const statusLabel = isLoading
    ? t('dayLog.brief.status.loading', 'Loading recorded history')
    : error
      ? t('dayLog.brief.status.failed', 'History request failed')
      : status === 'stale'
        ? t('dayLog.brief.status.stale', 'Retained recorded history')
        : summary === null
          ? t('dayLog.brief.status.unknown', 'Day summary unavailable')
          : hasUnavailableSources
            ? t('dayLog.brief.status.partial', 'Some sources unavailable')
            : t('dayLog.brief.status.ready', 'Recorded day summary');

  return (
    <div className="space-y-3" data-testid="daylog-summary">
      <OperationalBrief
        compact
        testId="day-log-summary"
        eyebrow={t('dayLog.brief.eyebrow', 'Vehicle day history')}
        title={t('dayLog.summary.title', 'Day summary')}
        description={t('dayLog.brief.description', 'Recorded totals for this vehicle day, independent of timeline search and category filters. Missing measurements are not zero; source availability is listed below.')}
        statusLabel={statusLabel}
        statusTone={error || status === 'stale' || hasUnavailableSources ? 'warning' : 'neutral'}
        metrics={metrics}
        loading={isLoading}
        scope={<Text as="span" variant="caption">{period} · {scope}</Text>}
        freshness={<Text as="span" variant="caption">
          {data?.day_start && data?.day_end
            ? t('dayLog.brief.bounds', '[{{start}}, {{end}}) · end exclusive', { start: data.day_start, end: data.day_end })
            : t('dayLog.brief.boundsUnknown', 'Recorded day bounds unavailable')}
        </Text>}
        provenance={[
          t('dayLog.brief.provenance', 'Recorded drives and charging sessions for the selected vehicle day. Signal transitions and per-source availability remain in Timeline and Sources.'),
          scope,
          data?.day_start && data?.day_end
            ? t('dayLog.brief.bounds', '[{{start}}, {{end}}) · end exclusive', { start: data.day_start, end: data.day_end })
            : t('dayLog.brief.boundsUnknown', 'Recorded day bounds unavailable'),
        ].join(' · ')}
      />
      {!isLoading && error ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('dayLog.summary.title', 'Day summary')} />
      ) : !isLoading && summary != null && !hasSessions ? (
        <EmptyState
          className="py-6"
          icon={<Icons.activity className="h-8 w-8" />}
          message={t('dayLog.summary.empty', 'No drives or charging sessions this day.')}
          description={t('dayLog.summary.emptyHint', 'Locks, sentry, and state changes below still tell the story when the car stayed put.')}
          actionTo={{ label: t('dayLog.summary.drivesCta', 'Open drives'), to: '/drives' }}
        />
      ) : null}
    </div>
  );
}
