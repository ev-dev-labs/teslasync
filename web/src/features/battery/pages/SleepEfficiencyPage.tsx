import { useMemo, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { useSleepEfficiency } from '@/api/hooks/useEnergy';
import { AlertBanner, QueryError, SectionErrorBoundary, StaleRefreshWarning } from '@/components/feedback';
import { Button, Caption, HelpTooltip } from '@/components/ui';
import { CardGrid, PageLayout } from '@/components/layout';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useFormatting } from '@/hooks/useFormatting';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import {
  DataAvailabilityMatrix,
  DrainEventProfile,
  DwellDurationChart,
  RangeSourceCoverage,
  SentryComparisonChart,
  SentryProjectionContext,
  SleepEfficiencyDiagnostics,
  SleepMethodologyPanel,
  TransitionCompositionPanel,
  TransitionDestinationChart,
  TransitionDiversityDiagnostics,
  type SleepEfficiencyQueryState,
} from '../components/sleep-efficiency';
import {
  DrainEventDirectory,
  SleepEvidenceOverview,
  SleepSectionPlacement,
  StateEvidenceDirectory,
} from '../components/sleep-efficiency-modernization';
import {
  DEFAULT_SLEEP_RANGE_DAYS,
  analyzeSleepEfficiency,
  analyzeSleepRange,
} from '../lib/sleepEfficiencyAnalysis';

export default function SleepEfficiencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('sleep.title', 'Sleep Efficiency'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;
  const { formatDateTime } = useDateFormat();
  const { start, end, startInstant, endInstantExclusive } = useRangeState({
    persistKey: 'sleep-efficiency.range',
  });
  const requestedRange = useMemo(
    () => analyzeSleepRange(start, end, { startInstant, endInstantExclusive }),
    [end, start, startInstant, endInstantExclusive],
  );
  const days =
    requestedRange.inclusiveDays ?? DEFAULT_SLEEP_RANGE_DAYS;
  const sleepQuery = useSleepEfficiency(
    vehicleIdStr,
    days,
    startInstant,
    endInstantExclusive,
  );
  const sleepState = useDataState(sleepQuery, { provenance: 'historical' });
  const [frozenNowMs] = useState(() => Date.now());
  const responseAsOfMs = Number.isFinite(sleepQuery.dataUpdatedAt)
    && sleepQuery.dataUpdatedAt > 0
    ? sleepQuery.dataUpdatedAt
    : frozenNowMs;
  const analysisAsOfMs = requestedRange.status === 'valid'
    && requestedRange.endInstantExclusiveMs != null
    ? Math.min(responseAsOfMs, requestedRange.endInstantExclusiveMs - 1)
    : responseAsOfMs;
  const analysis = useMemo(
    () =>
      analyzeSleepEfficiency(
        sleepQuery.data,
        analysisAsOfMs,
        start,
        end,
        { startInstant, endInstantExclusive },
      ),
    [analysisAsOfMs, end, sleepQuery.data, start, startInstant, endInstantExclusive],
  );

  const { formatTemperature, formatEnergy } = useUnits();
  const { formatCurrency, pricingState } = useFormatting();
  const { fmtNumber } = useNumberFormatting();
  const configuredSymbol = pricingState.data?.currency_symbol;
  const currencyKnown = pricingState.hasData
    && typeof configuredSymbol === 'string'
    && configuredSymbol.trim().length > 0;
  const formatSleepCurrency = (amount: number) => {
    if (!Number.isFinite(amount)) return '—';
    return currencyKnown
      ? formatCurrency(amount)
      : `${fmtNumber(amount)} (${t('app.currency', 'Currency')}: ${t('sleep.common.unavailable', 'Unavailable')})`;
  };
  const vehicleSelected = vehicleId != null;
  const hasCachedData = sleepState.hasData;
  const dataResolved =
    vehicleSelected && hasCachedData;
  const isLoading =
    vehicleSelected
    && !dataResolved
    && !sleepState.isRefreshBlocked
    && (sleepQuery.isLoading || sleepQuery.isFetching);
  const initialError =
    vehicleSelected ? sleepState.fatalError : null;
  const refreshError = sleepState.refreshError;
  const queryState: SleepEfficiencyQueryState = {
    vehicleSelected,
    isLoading,
    isResolved:
      vehicleSelected
      && (dataResolved || (!isLoading && sleepQuery.isError)),
    error: initialError,
    refreshError,
    onRetry: () => {
      void sleepQuery.refetch();
    },
  };
  const common = { analysis, state: queryState };
  const sections: ComponentProps<typeof CardGrid>['items'] = [
    { id: 'evidence', size: 'full', content: <SleepEvidenceOverview {...common} trust={sleepState} /> },
    { id: 'transition-destinations', size: 'half', content: <TransitionDestinationChart {...common} /> },
    { id: 'transition-composition', size: 'half', content: <TransitionCompositionPanel {...common} /> },
    { id: 'dwell-duration', size: 'half', content: <DwellDurationChart {...common} /> },
    { id: 'efficiency-diagnostics', size: 'half', content: <SleepEfficiencyDiagnostics {...common} /> },
    { id: 'transition-diversity', size: 'half', content: <TransitionDiversityDiagnostics {...common} /> },
    { id: 'sentry-comparison', size: 'half', content: <SentryComparisonChart {...common} /> },
    { id: 'state-directory', size: 'full', content: <StateEvidenceDirectory {...common} /> },
    {
      id: 'sentry-projection', size: 'half',
      content: <SentryProjectionContext {...common} formatCurrency={formatSleepCurrency} formatEnergy={formatEnergy} />,
    },
    { id: 'drain-profile', size: 'half', content: <DrainEventProfile {...common} /> },
    {
      id: 'event-directory', size: 'full',
      content: <DrainEventDirectory {...common} formatTemperature={formatTemperature} />,
    },
    { id: 'availability', size: 'full', content: <DataAvailabilityMatrix {...common} /> },
    { id: 'range-coverage', size: 'full', content: <RangeSourceCoverage {...common} /> },
    { id: 'methodology', size: 'full', content: <SleepMethodologyPanel {...common} /> },
  ];

  return (
    <PageLayout
      title={t('sleep.title', 'Sleep Efficiency')}
      subtitle={t(
        'sleep.subtitle',
        'Inspect transition counts, withheld duration derivations, Sentry evidence, and exact source accounting',
      )}
      query={sleepQuery}
      metadataActions={
        <>
          {hasCachedData && analysis.source.frozenNowIso && (
            <Caption data-testid="sleep-analysis-as-of">
              {t('operationalMode.asOf.label', 'As of {{when}}', {
                when: formatDateTime(analysis.source.frozenNowIso),
              })}
            </Caption>
          )}
          <HelpTooltip
            i18nKey="sleep.methodology.transitionSemantics"
            defaultValue="state_distribution.count records FSM transition destinations from fsm_transitions.to_state; it is not occupancy or duration."
            ariaLabel={t('sleep.methodology.title', 'Methodology and interpretation limits')}
          />
        </>
      }
    >
      {pricingState.fatalError && (
        <QueryError error={pricingState.fatalError} onRetry={pricingState.retry ?? undefined} />
      )}
      <StaleRefreshWarning
        state={pricingState}
        label={t('settings.title', 'Settings')}
      />
      {hasCachedData && sleepState.status !== 'ok' && (
        <div data-testid={refreshError ? 'sleep-refresh-error' : undefined}>
          <StaleRefreshWarning
            state={sleepState}
            label={t('sleep.title', 'Sleep Efficiency')}
            message={refreshError
              ? t(
                'sleep.states.refreshError',
                'Sleep evidence could not refresh. Showing the most recently loaded response and its existing evidence gates.',
              )
              : undefined}
          />
        </div>
      )}
      {vehicleSelected && !hasCachedData && sleepState.isRefreshBlocked && (
        <AlertBanner
          data-testid="sleep-initial-paused"
          variant="info"
        >
          {t(
            'sleep.modernization.states.initialPaused',
            'Sleep evidence has not loaded because the request is paused. No drain or sleep-health conclusion is available.',
          )}
          <Button
            variant="ghost"
            size="sm"
            wrapLabel
            className="min-h-11 md:min-h-9"
            onClick={queryState.onRetry}
          >
            {t('common.refresh', 'Refresh')}
          </Button>
        </AlertBanner>
      )}

      <CardGrid
        label={t('sleep.modernization.layout.evidence', 'Sleep evidence sections')}
        items={sections.map((section) => ({
          ...section,
          content: (
            <SleepSectionPlacement>
              <SectionErrorBoundary name={`SleepEfficiency:${section.id}`}>
                {section.content}
              </SectionErrorBoundary>
            </SleepSectionPlacement>
          ),
        }))}
      />
    </PageLayout>
  );
}
