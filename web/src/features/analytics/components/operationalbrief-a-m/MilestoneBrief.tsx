import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { OdometerMilestoneResult } from '../../lib/odometerMilestones';
import type { MilestoneSectionState } from '../odometer-milestones/types';
import { useOdometerMilestoneDisplay } from '../odometer-milestones/useOdometerMilestoneDisplay';

export function MilestoneBrief({ summary, isLoading, error, onRetry, retained = false }: MilestoneSectionState & {
  summary: OdometerMilestoneResult; retained?: boolean;
}) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDateMs, formatDistanceKm } = useOdometerMilestoneDisplay();
  const next = summary.upcoming[0] ?? null;
  const pace = summary.primaryPace;
  const observedDays = pace.observedDays != null ? fmtNumber(pace.observedDays) : '—';
  const known = !isLoading && !error;
  const title = t('milestones.sections.kpis', 'Milestone summary metrics');
  const distanceDisplay = { formatter: (raw: number) => ({ value: formatDistanceKm(raw / 1000), unit: '' }) };
  const metrics: StatMetric[] = [
    {
      metricId: 'distance', occurrenceId: 'milestone-odometer',
      label: t('milestones.kpi.odometer', 'Calibrated observed odometer'),
      rawValue: known && summary.currentOdometerKm != null ? summary.currentOdometerKm * 1000 : null,
      display: distanceDisplay,
      context: known ? t('milestones.kpi.odometerEvidence', 'Calibration + {{count}} eligible returned drives', { count: summary.accounting.eligibleRows }) : undefined,
    },
    {
      metricId: 'rate', occurrenceId: 'milestone-pace',
      label: t('milestones.kpi.pace', 'Supported 90-day pace'),
      rawValue: known && pace.paceKmPerDay != null ? pace.paceKmPerDay * 1000 : null,
      description: t('milestones.brief.paceUnit', 'Observed distance pace in meters per day, converted to the saved distance preference.'),
      display: { formatter: raw => ({ value: t('milestones.kpi.perDay', '{{distance}} / day', { distance: formatDistanceKm(raw / 1000) }), unit: '' }) },
      context: known ? pace.supported
        ? t('milestones.kpi.paceEvidence', '{{count}} drives across {{days}} observed days', { count: pace.sampleCount, days: observedDays })
        : t('milestones.kpi.paceUnsupported', 'Needs at least {{minimum}} eligible recent drives', { minimum: summary.method.minimumPaceDrives }) : undefined,
    },
    {
      metricId: 'distance', occurrenceId: 'milestone-next', label: t('milestones.kpi.next', 'Next round milestone'),
      rawValue: known && next ? next.thresholdKm * 1000 : null, display: distanceDisplay,
      context: known && next ? t('milestones.kpi.remaining', '{{distance}} remaining', { distance: formatDistanceKm(next.remainingKm) }) : undefined,
    },
    {
      metricId: 'text', occurrenceId: 'milestone-eta', label: t('milestones.kpi.eta', 'Next projected ETA'),
      rawValue: known ? formatDateMs(next?.forecast?.etaMs) : null,
      context: known ? next?.forecast ? t('milestones.kpi.etaEvidence', 'Trailing-90-day projection, not a guarantee')
        : pace.supported ? t('milestones.kpi.etaOutOfRange', 'Supported pace, but beyond forecast horizon')
          : t('milestones.kpi.etaUnsupported', 'Unavailable without supported 90-day evidence') : undefined,
    },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const coverage = t('milestones.sourceCoverage', 'Bounded observations and calibration; lifetime completeness is unknown.');
  return <div id="milestone-kpis" data-testid="milestone-kpis">
    <OperationalBrief compact title={title} metrics={operationalMetrics} loading={isLoading}
      eyebrow={t('milestones.title', 'Odometer milestones')} description={coverage}
      statusLabel={isLoading ? t('analytics.brief.loading', 'Loading evidence')
        : error ? t('analytics.brief.unavailable', 'Evidence unavailable')
          : retained ? t('analytics.brief.retained', 'Retained evidence') : t('analytics.brief.returned', 'Returned evidence')}
      statusTone={error || retained ? 'warning' : 'neutral'}
      scope={<span>{t('milestones.sourcePeriod', 'Returned drive-history window')}</span>}
      provenance={coverage}
    />
    {error ? <SourceContent state="error" label={title} emptyMessage=""
      errorMessage={t('error.loadFailed', 'Failed to load data')} error={error}
      errorRecovery={{ onRetry }}>{null}</SourceContent>
      : known && summary.accounting.eligibleRows === 0 ? <EmptyState className="py-5"
        icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
        message={t('milestones.kpi.empty', 'No eligible positive-distance drives are available in the returned history window.')}
        actionTo={{ label: t('milestones.actions.browseDrives', 'Browse drives'), to: '/drives' }} /> : null}
  </div>;
}
