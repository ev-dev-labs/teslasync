import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';

import { useSleepEfficiency } from '@/api/hooks/useEnergy';
import { AlertBanner } from '@/components/feedback';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import {
  DataAvailabilityMatrix,
  DrainEventDirectory,
  DrainEventProfile,
  DwellDurationChart,
  RangeSourceCoverage,
  SentryComparisonChart,
  SentryProjectionContext,
  SleepEfficiencyDiagnostics,
  SleepEvidenceBand,
  SleepMethodologyPanel,
  StateEvidenceDirectory,
  TransitionCompositionPanel,
  TransitionDestinationChart,
  TransitionDiversityDiagnostics,
  type SleepEfficiencyQueryState,
} from '../components/sleep-efficiency';
import {
  DEFAULT_SLEEP_RANGE_DAYS,
  analyzeSleepEfficiency,
  analyzeSleepRange,
} from '../lib/sleepEfficiencyAnalysis';

const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function SleepEfficiencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('sleep.title', 'Sleep Efficiency'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;
  const { start, end, setRange } = useRangeState({
    persistKey: 'sleep-efficiency.range',
    defaultPresetId: '30d',
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
  const hasCachedData = sleepQuery.data !== undefined;
  const dataResolved =
    vehicleSelected && (hasCachedData || sleepQuery.isSuccess);
  const isLoading =
    vehicleSelected
    && !dataResolved
    && (sleepQuery.isLoading || sleepQuery.isFetching);
  const initialError =
    vehicleSelected && !hasCachedData && sleepQuery.isError
      ? sleepQuery.error
      : null;
  const refreshError =
    hasCachedData && sleepQuery.isError ? sleepQuery.error : null;
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
  const actions = (
    <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end sm:gap-3">
      <VehicleSelect
        ariaLabel={t('sleep.selectVehicle', 'Select vehicle')}
      />
      <RangePicker
        value={{ start, end }}
        onChange={setRange}
        align="end"
        triggerTestId="sleep-efficiency-range"
      />
    </div>
  );

  return (
    <PageContainer
      title={t('sleep.title', 'Sleep Efficiency')}
      subtitle={t(
        'sleep.subtitle',
        'Inspect transition counts, withheld duration derivations, Sentry evidence, and exact source accounting',
      )}
      actions={actions}
      query={sleepQuery}
    >
      {refreshError && (
        <AlertBanner
          data-testid="sleep-refresh-error"
          variant="warning"
          icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
        >
          {t(
            'sleep.states.refreshError',
            'Sleep evidence could not refresh. Showing the most recently loaded response and its existing evidence gates.',
          )}
        </AlertBanner>
      )}

      <FadeIn>
        <SleepEvidenceBand {...common} />
      </FadeIn>

      <FadeIn delay={0.04}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <TransitionDestinationChart {...common} />
          <TransitionCompositionPanel {...common} />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.08}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <DwellDurationChart {...common} />
          <SleepEfficiencyDiagnostics {...common} />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.12}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <TransitionDiversityDiagnostics {...common} />
          <SentryComparisonChart {...common} />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.16}>
        <StateEvidenceDirectory {...common} />
      </FadeIn>

      <FadeIn delay={0.2}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <SentryProjectionContext
            {...common}
            formatCurrency={formatCurrency}
            formatEnergy={formatEnergy}
          />
          <DrainEventProfile {...common} />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.24}>
        <DrainEventDirectory
          {...common}
          formatTemperature={formatTemperature}
        />
      </FadeIn>

      <FadeIn delay={0.28}>
        <DataAvailabilityMatrix {...common} />
      </FadeIn>

      <FadeIn delay={0.32}>
        <RangeSourceCoverage {...common} />
      </FadeIn>

      <FadeIn delay={0.36}>
        <SleepMethodologyPanel {...common} />
      </FadeIn>
    </PageContainer>
  );
}
