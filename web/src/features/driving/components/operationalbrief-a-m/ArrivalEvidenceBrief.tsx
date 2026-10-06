import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import type { ArrivalReliabilityKpiBand } from '../arrival-reliability/ArrivalReliabilityKpiBand';
import { ArrivalReliabilityQueryStatus } from '../arrival-reliability/ArrivalReliabilityQueryStatus';
import { arrivalIndex, arrivalPercent } from '../arrival-reliability/labels';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

type Props = ComponentProps<typeof ArrivalReliabilityKpiBand>;

export function ArrivalEvidenceBrief({ analysis, state, locale, formatDuration }: Props) {
  const { t } = useTranslation();
  const ready = state.isResolved && !state.error;
  const pending = !state.vehicleSelected
    ? t('arrivalReliability.states.selectVehicleKpi', 'Select a vehicle above to load timing evidence.')
    : state.isLoading ? t('arrivalReliability.states.loadingKpi', 'Waiting for returned drive history…')
      : state.error ? t('arrivalReliability.states.errorKpi', 'Drive history is unavailable; use the status below to retry.')
        : !state.isResolved ? t('arrivalReliability.states.pendingKpi', 'Drive-history availability has not resolved.') : null;
  const cap = analysis.accounting.historyCapReached
    ? t('arrivalReliability.kpis.capReached', 'Latest 1,000-row cap reached')
    : t('arrivalReliability.kpis.capNotReached', 'Below the 1,000-row cap');
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'routes', rawValue: ready ? analysis.coverage.supportedRoutes : null,
      label: t('arrivalReliability.kpis.routes', 'Supported routes'),
      description: pending ?? t('arrivalReliability.kpis.routeGate', 'at least 3 drives each') },
    { metricId: 'count', occurrenceId: 'included', rawValue: ready ? analysis.accounting.includedRows : null,
      label: t('arrivalReliability.kpis.included', 'Included drives'),
      description: pending ?? t('arrivalReliability.kpis.returned', '{{count}} rows returned', { count: analysis.accounting.returnedRows }) },
    { metricId: 'percent', occurrenceId: 'coverage',
      rawValue: ready && analysis.coverage.repeatedRouteCoverage != null ? analysis.coverage.repeatedRouteCoverage * 100 : null,
      label: t('arrivalReliability.kpis.coverage', 'Repeated-route coverage'),
      description: pending ?? t('arrivalReliability.kpis.coverageHint', 'included drives on supported routes'),
      display: { formatter: (raw) => ({ value: arrivalPercent(raw / 100, locale), unit: '' }) } },
    { metricId: 'score', occurrenceId: 'consistency', rawValue: ready ? analysis.aggregate.timingConsistencyIndex : null,
      label: t('arrivalReliability.kpis.consistency', 'Timing consistency index'),
      description: pending ?? t('arrivalReliability.kpis.descriptive', 'descriptive 0–100 index'),
      display: { formatter: (raw) => ({ value: arrivalIndex(raw, locale), unit: '' }) } },
    { metricId: 'percent', occurrenceId: 'allowance',
      rawValue: ready && analysis.aggregate.withinAllowanceShare != null ? analysis.aggregate.withinAllowanceShare * 100 : null,
      label: t('arrivalReliability.kpis.allowanceShare', 'Observed within-allowance share'),
      description: pending ?? t('arrivalReliability.kpis.inSample', 'in-sample route observations'),
      display: { formatter: (raw) => ({ value: arrivalPercent(raw / 100, locale), unit: '' }) } },
    { metricId: 'duration', occurrenceId: 'p90', rawValue: ready ? analysis.aggregate.sampleWeightedP90BufferS : null,
      label: t('arrivalReliability.kpis.p90Buffer', 'Observed p90 buffer'),
      description: pending ?? cap,
      display: { formatter: (raw) => ({ value: formatDuration(raw), unit: '' }) } },
  ];
  return <section aria-label={t('arrivalReliability.kpis.aria', 'Observed arrival timing evidence summary')} data-testid="arrival-kpis">
    <DrivingSummaryBrief metrics={metrics}
      title={t('arrivalReliability.kpis.title', 'Observed timing evidence')}
      description={t('arrivalReliability.brief.description', 'Descriptive timing consistency for repeated directional routes; within-allowance shares are in-sample observations, not calibrated reliability promises.')}
      scope={ready ? `${cap} · ${analysis.timeZone}` : t('driving.brief.unresolvedCoverage', 'Drive-history coverage is unresolved')}
      provenance={t('arrivalReliability.brief.source', 'Returned drive history; repeated-route support, descriptive indices and sample-weighted p90 buffers.')}
      loading={state.isLoading} error={state.error} showError={false} retained={state.refreshError != null} onRetry={state.onRetry}
      statusLabel={!state.vehicleSelected ? t('driving.brief.selectVehicle', 'Select a vehicle')
        : !state.isResolved && !state.isLoading && !state.error ? t('driving.brief.awaiting', 'Awaiting evidence') : undefined} />
    <ArrivalReliabilityQueryStatus analysis={analysis} state={state} />
  </section>;
}
