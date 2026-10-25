import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { type StatMetric } from '@/components/data-display/stat-reference';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';
import { AlertBanner, QueryError } from '@/components/feedback';
import { LayoutCard } from '@/components/layout/layout-reference';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { StatPeriod } from '@/lib/metric-reference';
import type { SleepEfficiencySectionProps } from '../sleep-efficiency';

export function SleepEvidenceOverview({ analysis, state, trust }: SleepEfficiencySectionProps & {
  trust: Pick<DataState<unknown>, 'hasData' | 'status' | 'isRefreshBlocked'>;
}) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { formatDayKey } = useDateFormat();
  const hasResponse = state.vehicleSelected && trust.hasData && analysis.source.hasResponse;
  const hasTransitionCounts = hasResponse && analysis.stateAccounting.collectionPresent
    && (analysis.stateAccounting.returnedRows === 0 || analysis.stateAccounting.includedRows > 0);
  const loading = state.vehicleSelected && state.isLoading && !trust.hasData && !trust.isRefreshBlocked;
  const retained = trust.hasData && (trust.status !== 'ok' || Boolean(state.refreshError));
  const rangeValue = analysis.range.status === 'valid'
    && analysis.range.requestedStart && analysis.range.requestedEnd
    ? t('sleep.kpi.rangeValue', '{{start}} to {{end}}', {
      start: formatDayKey(analysis.range.requestedStart), end: formatDayKey(analysis.range.requestedEnd),
    })
    : t('sleep.common.unavailable', 'Unavailable');
  const sentryAvailability = analysis.sentry.comparisonAvailable
    ? t('sleep.availability.status.available', 'Available')
    : analysis.sentry.hasAnyEvidence
      ? t('sleep.availability.status.partial', 'Partial')
      : t('sleep.availability.status.unavailable', 'Unavailable');
  // Duration is bridged in seconds; breadth is source support, not confidence.
  const metrics: StatMetric[] = [
    {
      metricId: 'text', occurrenceId: 'sleep-window', rawValue: rangeValue,
      label: t('sleep.kpi.utcWindow', 'Selected window'),
      description: t('sleep.kpi.utcWindow', 'Selected window'),
      context: analysis.range.inclusiveDays != null
        ? t('sleep.kpi.inclusiveDays', '{{count}} inclusive calendar days', { count: analysis.range.inclusiveDays })
        : t('sleep.kpi.invalidWindow', 'No valid inclusive day count'),
    },
    {
      metricId: 'count', occurrenceId: 'sleep-destinations',
      rawValue: hasTransitionCounts ? analysis.transitions.totalCount : null,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
      label: t('sleep.kpi.transitionDestinations', 'Valid transition destinations'),
      description: t('sleep.kpi.transitionSubtitle', 'Destination counts from the vehicle FSM'),
      context: t('sleep.kpi.transitionSubtitle', 'Destination counts from the vehicle FSM'),
    },
    {
      metricId: 'percent', occurrenceId: 'sleep-asleep-count-share',
      rawValue: hasResponse && analysis.transitions.asleepShare != null
        ? analysis.transitions.asleepShare * 100 : null,
      display: { formatter: raw => ({ value: t('sleep.kpi.percentValue', '{{value}}%', { value: fmtNumber(raw) }), unit: '' }) },
      label: t('sleep.kpi.asleepTransitionShare', 'Asleep-transition share'),
      description: t('sleep.kpi.countBasedNotTime', 'Count-based; not a time share'),
      context: t('sleep.kpi.countBasedNotTime', 'Count-based; not a time share'),
    },
    {
      metricId: 'percent', occurrenceId: 'sleep-duration-efficiency',
      rawValue: hasResponse ? analysis.dwell.recomputedEfficiencyPct : null,
      display: { formatter: raw => ({ value: t('sleep.kpi.percentValue', '{{value}}%', { value: fmtNumber(raw) }), unit: '' }) },
      label: t('sleep.kpi.durationEfficiency', 'Duration-based sleep efficiency'),
      description: t('sleep.kpi.durationEfficiency', 'Duration-based sleep efficiency'),
      context: analysis.dwell.available
        ? t('sleep.kpi.durationEvidence', 'Derived from positive dwell minutes')
        : t('sleep.kpi.dwellPending', 'Unavailable pending dwell reconstruction'),
    },
    {
      metricId: 'duration', occurrenceId: 'sleep-average-time-to-sleep',
      rawValue: hasResponse && analysis.dwell.timeToSleepAvgMin != null
        ? analysis.dwell.timeToSleepAvgMin * 60 : null,
      display: { formatter: raw => ({ value: t('sleep.kpi.minutesValue', '{{value}} min', { value: fmtNumber(raw / 60) }), unit: '' }) },
      label: t('sleep.kpi.averageTimeToSleep', 'Average time-to-sleep'),
      description: t('sleep.kpi.averageTimeToSleep', 'Average time-to-sleep'),
      context: analysis.dwell.timeToSleepAvgMin != null
        ? t('sleep.kpi.reportedEvidence', 'Positive finite response value')
        : t('sleep.kpi.placeholderWithheld', 'Placeholder zero withheld'),
    },
    {
      metricId: 'status', occurrenceId: 'sleep-sentry-comparison',
      rawValue: hasResponse ? sentryAvailability : null,
      label: t('sleep.kpi.sentryAvailability', 'Sentry comparison'),
      description: t('sleep.kpi.sentrySamples', 'Requires positive sample counts'),
      context: t('sleep.kpi.sentrySamples', 'Requires positive sample counts'),
    },
    {
      metricId: 'score', occurrenceId: 'sleep-evidence-breadth',
      rawValue: hasResponse ? analysis.breadth.score : null,
      display: { formatter: raw => ({ value: t('sleep.kpi.breadthValue', '{{score}} / 100', { score: fmtInt(raw) }), unit: '' }) },
      label: t('sleep.kpi.evidenceBreadth', 'Evidence breadth'),
      description: t('sleep.kpi.breadthNotConfidence', 'Source support score; not confidence'),
      context: t('sleep.kpi.breadthNotConfidence', 'Source support score; not confidence'),
    },
  ];
  // Inclusive calendar dates are not an invented exclusive instant boundary.
  // Coverage remains in RangeSourceCoverage, not a claim of complete history.
  const period: StatPeriod = {
    kind: 'unknown', label: rangeValue,
    reason: t('sleep.kpi.description', 'Counts, duration derivations, and source breadth are kept separate so unavailable evidence is never rendered as a measured zero.'),
  };
  return (
    <section data-testid="sleep-efficiency-kpi-evidence">
      <LayoutCard title={t('sleep.kpi.title', 'Evidence overview')}>
        {state.error && !trust.hasData ? (
          <div data-testid="sleep-query-initial-error">
            <QueryError error={state.error} onRetry={state.onRetry} />
          </div>
        ) : (
          <>
            <div
              role={loading ? 'status' : undefined}
              aria-label={loading ? t('sleep.states.loadingAria', 'Loading sleep evidence') : undefined}
            >
              <BatteryEvidenceBrief
                variant="embedded"
                id="sleep-efficiency-evidence"
                title={t('sleep.kpi.title', 'Evidence overview')}
                metrics={metrics}
                period={period}
                loading={loading}
                hasEvidence={hasResponse && analysis.source.hasEvidence}
                retained={retained}
                secondary={!state.vehicleSelected
                  ? t('sleep.states.noVehicle', 'Select a vehicle to load its sleep evidence.')
                  : trust.hasData && state.refreshError
                    ? t(
                      'sleep.states.refreshError',
                      'Sleep evidence could not refresh. Showing the most recently loaded response and its existing evidence gates.',
                    )
                    : trust.hasData && trust.isRefreshBlocked
                      ? t('dataSources.status.paused', 'Refresh paused')
                      : !hasResponse && trust.isRefreshBlocked
                        ? t(
                          'sleep.modernization.states.initialPaused',
                          'Sleep evidence has not loaded because the request is paused. No drain or sleep-health conclusion is available.',
                        )
                        : undefined}
              />
            </div>
            {!state.vehicleSelected && (
              <AlertBanner variant="info">
                {t('sleep.states.noVehicle', 'Select a vehicle to load its sleep evidence.')}
              </AlertBanner>
            )}
          </>
        )}
      </LayoutCard>
    </section>
  );
}
