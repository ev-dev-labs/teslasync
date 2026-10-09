import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSleepEfficiency } from '@/api/hooks/useEnergy';
import { AlertBanner, StaleRefreshWarning } from '@/components/feedback';
import { Button, HelpTooltip } from '@/components/ui';
import { CardGrid, PageLayout } from '@/components/layout';
import { useDataState } from '@/hooks/useDataState';
import { useFormatting } from '@/hooks/useFormatting';
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
  const { start, end } = useRangeState({
    persistKey: 'sleep-efficiency.range',
  });
  const requestedRange = useMemo(
    () => analyzeSleepRange(start, end),
    [end, start],
  );
  const days =
    requestedRange.inclusiveDays ?? DEFAULT_SLEEP_RANGE_DAYS;
  const sleepQuery = useSleepEfficiency(
    vehicleIdStr,
    days,
    start,
    end,
  );
  const sleepState = useDataState(sleepQuery, { provenance: 'historical' });
  const [frozenNowMs] = useState(() => Date.now());
  const analysis = useMemo(
    () =>
      analyzeSleepEfficiency(
        sleepQuery.data,
        frozenNowMs,
        start,
        end,
      ),
    [end, frozenNowMs, sleepQuery.data, start],
  );

  const { formatTemperature, formatEnergy } = useUnits();
  const { formatCurrency } = useFormatting();
  const vehicleSelected = vehicleId != null;
  const hasCachedData = sleepState.hasData;
  const dataResolved =
    vehicleSelected && (hasCachedData || sleepQuery.isSuccess);
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

  return (
    <PageLayout
      title={t('sleep.title', 'Sleep Efficiency')}
      subtitle={t(
        'sleep.subtitle',
        'Inspect transition counts, withheld duration derivations, Sentry evidence, and exact source accounting',
      )}
      query={sleepQuery}
      metadataActions={
        <HelpTooltip
          i18nKey="sleep.methodology.transitionSemantics"
          defaultValue="state_distribution.count records FSM transition destinations from fsm_transitions.to_state; it is not occupancy or duration."
          ariaLabel={t('sleep.methodology.title', 'Methodology and interpretation limits')}
        />
      }
    >
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
          <Button variant="ghost" size="sm" onClick={queryState.onRetry}>
            {t('common.refresh', 'Refresh')}
          </Button>
        </AlertBanner>
      )}

      {/* Stable source order, measured allocated width, no replacement controller.
          Real specialist ChartContainers retain export/fullscreen/annotations. */}
      <CardGrid
        label={t('sleep.modernization.layout.evidence', 'Sleep evidence sections')}
        items={[
          { id: 'evidence', size: 'full', content: (
            <SleepSectionPlacement><SleepEvidenceOverview {...common} /></SleepSectionPlacement>
          ) },
          { id: 'transition-destinations', size: 'half', content: (
            <SleepSectionPlacement delay={0.04}><TransitionDestinationChart {...common} /></SleepSectionPlacement>
          ) },
          { id: 'transition-composition', size: 'half', content: (
            <SleepSectionPlacement delay={0.04}><TransitionCompositionPanel {...common} /></SleepSectionPlacement>
          ) },
          { id: 'dwell-duration', size: 'half', content: (
            <SleepSectionPlacement delay={0.08}><DwellDurationChart {...common} /></SleepSectionPlacement>
          ) },
          { id: 'efficiency-diagnostics', size: 'half', content: (
            <SleepSectionPlacement delay={0.08}><SleepEfficiencyDiagnostics {...common} /></SleepSectionPlacement>
          ) },
          { id: 'transition-diversity', size: 'half', content: (
            <SleepSectionPlacement delay={0.12}><TransitionDiversityDiagnostics {...common} /></SleepSectionPlacement>
          ) },
          { id: 'sentry-comparison', size: 'half', content: (
            <SleepSectionPlacement delay={0.12}><SentryComparisonChart {...common} /></SleepSectionPlacement>
          ) },
          { id: 'state-directory', size: 'full', content: (
            <SleepSectionPlacement delay={0.16}><StateEvidenceDirectory {...common} /></SleepSectionPlacement>
          ) },
          { id: 'sentry-projection', size: 'half', content: (
            <SleepSectionPlacement delay={0.2}>
              <SentryProjectionContext {...common} formatCurrency={formatCurrency} formatEnergy={formatEnergy} />
            </SleepSectionPlacement>
          ) },
          { id: 'drain-profile', size: 'half', content: (
            <SleepSectionPlacement delay={0.2}><DrainEventProfile {...common} /></SleepSectionPlacement>
          ) },
          { id: 'event-directory', size: 'full', content: (
            <SleepSectionPlacement delay={0.24}>
              <DrainEventDirectory {...common} formatTemperature={formatTemperature} />
            </SleepSectionPlacement>
          ) },
          { id: 'availability', size: 'full', content: (
            <SleepSectionPlacement delay={0.28}><DataAvailabilityMatrix {...common} /></SleepSectionPlacement>
          ) },
          { id: 'range-coverage', size: 'full', content: (
            <SleepSectionPlacement delay={0.32}><RangeSourceCoverage {...common} /></SleepSectionPlacement>
          ) },
          { id: 'methodology', size: 'full', content: (
            <SleepSectionPlacement delay={0.36}><SleepMethodologyPanel {...common} /></SleepSectionPlacement>
          ) },
        ]}
      />
    </PageLayout>
  );
}
