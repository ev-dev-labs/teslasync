import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDrives, useRegenEfficiency } from '@/api/hooks/useDriving';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';

import {
  AmbientTemperatureContext,
  CoverageMethodology,
  MonthlyRecoveryTrend,
  RankedDriveEvidence,
  RecoveryOverview,
  RecoveryRatioDistribution,
  RegenKpiBand,
  StartingSocContext,
  type RegenSectionState,
} from '../components/regen-efficiency';
import {
  REGEN_HISTORY_LIMIT,
  buildRegenEfficiencyModel,
} from '../lib/regenEfficiency';

const CONTEXT_COLUMNS = { default: 1, xl: 2 } as const;

export default function RegenEfficiencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('regen.title', 'Regenerative Braking'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const selectedTimeZone = useTimezone('vehicle');
  const {
    start,
    end,
    startInstant,
    endInstantExclusive,
    timezone,
    setRange,
  } = useRangeState({
    persistKey: 'regen-efficiency.range',
    defaultPresetId: 'all',
    timezone: selectedTimeZone,
  });

  const aggregateQuery = useRegenEfficiency(
    vehicleIdStr,
    startInstant,
    endInstantExclusive,
  );
  const drivesQuery = useDrives(vehicleIdStr, {
    start: startInstant,
    end: endInstantExclusive,
    limit: REGEN_HISTORY_LIMIT,
  });
  const drives = useMemo(() => drivesQuery.data ?? [], [drivesQuery.data]);
  const model = useMemo(
    () => buildRegenEfficiencyModel(drives, REGEN_HISTORY_LIMIT, timezone),
    [drives, timezone],
  );

  const aggregateState: RegenSectionState = {
    isLoading: aggregateQuery.isLoading,
    isResolved: aggregateQuery.isSuccess,
    error: aggregateQuery.isError ? aggregateQuery.error : null,
    onRetry: () => {
      void aggregateQuery.refetch();
    },
  };
  const detailState: RegenSectionState = {
    isLoading: drivesQuery.isLoading,
    isResolved: drivesQuery.isSuccess,
    error: drivesQuery.isError ? drivesQuery.error : null,
    onRetry: () => {
      void drivesQuery.refetch();
    },
  };

  return (
    <PageContainer
      title={t('regen.title', 'Regenerative Braking')}
      subtitle={t(
        'regen.subtitle',
        'Descriptive energy-recovery evidence for the selected date window',
      )}
      query={[aggregateQuery, drivesQuery]}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="regen-efficiency-range"
          />
        </div>
      }
    >
      <FadeIn>
        <RegenKpiBand
          aggregate={aggregateQuery.data}
          model={model}
          aggregateState={aggregateState}
          detailState={detailState}
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        <RecoveryOverview
          aggregate={aggregateQuery.data}
          model={model}
          aggregateState={aggregateState}
          detailState={detailState}
        />
      </FadeIn>

      <FadeIn delay={0.1}>
        <MonthlyRecoveryTrend model={model} state={detailState} />
      </FadeIn>

      <FadeIn delay={0.15}>
        <RecoveryRatioDistribution model={model} state={detailState} />
      </FadeIn>

      <FadeIn delay={0.2}>
        <Grid cols={CONTEXT_COLUMNS} gap={4}>
          <AmbientTemperatureContext model={model} state={detailState} />
          <StartingSocContext model={model} state={detailState} />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.25}>
        <RankedDriveEvidence model={model} state={detailState} />
      </FadeIn>

      <FadeIn delay={0.3}>
        <CoverageMethodology
          aggregate={aggregateQuery.data}
          model={model}
          aggregateState={aggregateState}
          detailState={detailState}
        />
      </FadeIn>
    </PageContainer>
  );
}
