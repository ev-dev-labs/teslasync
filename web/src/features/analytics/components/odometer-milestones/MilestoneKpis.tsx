import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatStrip, type StatMetric } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
import type { OdometerMilestoneResult } from '../../lib/odometerMilestones';
import type { MilestoneSectionState } from './types';
import { useOdometerMilestoneDisplay } from './useOdometerMilestoneDisplay';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface MilestoneKpisProps extends MilestoneSectionState {
  summary: OdometerMilestoneResult;
}

export function MilestoneKpis({ summary, isLoading, error, onRetry }: MilestoneKpisProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDateMs, formatDistanceKm } = useOdometerMilestoneDisplay();
  const next = summary.upcoming[0] ?? null;
  const pace = summary.primaryPace;
  const observedDays = pace.observedDays != null ? fmtNumber(pace.observedDays) : '—';
  const known = !isLoading && !error;
  const title = t('milestones.sections.kpis', 'Milestone summary metrics');
  const metrics: StatMetric[] = [
    {
      metricId: 'text', occurrenceId: 'milestone-odometer',
      label: t('milestones.kpi.odometer', 'Calibrated observed odometer'),
      rawValue: known ? formatDistanceKm(summary.currentOdometerKm) : null,
      context: known ? t('milestones.kpi.odometerEvidence', 'Calibration + {{count}} eligible returned drives', {
        count: summary.accounting.eligibleRows,
      }) : undefined,
    },
    {
      metricId: 'text', occurrenceId: 'milestone-pace',
      label: t('milestones.kpi.pace', 'Supported 90-day pace'),
      rawValue: known && pace.paceKmPerDay != null
        ? t('milestones.kpi.perDay', '{{distance}} / day', { distance: formatDistanceKm(pace.paceKmPerDay) })
        : null,
      context: known ? pace.supported
        ? t('milestones.kpi.paceEvidence', '{{count}} drives across {{days}} observed days', {
            count: pace.sampleCount, days: observedDays,
          })
        : t('milestones.kpi.paceUnsupported', 'Needs at least {{minimum}} eligible recent drives', {
            minimum: summary.method.minimumPaceDrives,
          }) : undefined,
    },
    {
      metricId: 'text', occurrenceId: 'milestone-next',
      label: t('milestones.kpi.next', 'Next round milestone'),
      rawValue: known && next ? formatDistanceKm(next.thresholdKm) : null,
      context: known && next ? t('milestones.kpi.remaining', '{{distance}} remaining', {
        distance: formatDistanceKm(next.remainingKm),
      }) : undefined,
    },
    {
      metricId: 'text', occurrenceId: 'milestone-eta',
      label: t('milestones.kpi.eta', 'Next projected ETA'),
      rawValue: known ? formatDateMs(next?.forecast?.etaMs) : null,
      context: known ? next?.forecast
        ? t('milestones.kpi.etaEvidence', 'Trailing-90-day projection, not a guarantee')
        : pace.supported
          ? t('milestones.kpi.etaOutOfRange', 'Supported pace, but beyond forecast horizon')
          : t('milestones.kpi.etaUnsupported', 'Unavailable without supported 90-day evidence')
        : undefined,
    },
  ];
  return (
    <StatStrip id="milestone-kpis" testId="milestone-kpis" title={title} metrics={metrics}
      period={{
        kind: 'unknown', label: t('milestones.sourcePeriod', 'Returned drive-history window'),
        reason: t('milestones.sourceCoverage', 'Bounded observations and calibration; lifetime completeness is unknown.'),
      }}
      loading={isLoading}
      footer={error ? (
        <SourceContent state="error" label={title} emptyMessage=""
          errorMessage={t('error.loadFailed', 'Failed to load data')} error={error}
          errorRecovery={{ onRetry }}>{null}</SourceContent>
      ) : known && summary.accounting.eligibleRows === 0 ? (
        <EmptyState className="py-5" icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
          message={t('milestones.kpi.empty', 'No eligible positive-distance drives are available in the returned history window.')}
          actionTo={{ label: t('milestones.actions.browseDrives', 'Browse drives'), to: '/drives' }} />
      ) : undefined}
    />
  );
}
