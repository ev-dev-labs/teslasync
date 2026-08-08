import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveHistory } from '@/api/hooks/useDriving';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';
import type { Drive } from '@/types/driving';

import {
  DestinationTransitionsEvidenceQuality,
  DestinationTransitionsKpiBand,
  DestinationTransitionsMethodology,
  DestinationVisitShareChart,
  EmpiricalInformationEdges,
  FrequentAcceptedEdges,
  LeadingSuccessorsDirectory,
  LocalTwoHourTransitionProfile,
  MonthlyTransitionTrend,
  OriginConcentrationSupportChart,
  TopTransitionMatrix,
  WeekdayTransitionProfile,
  type DestinationTransitionsQueryState,
} from '../components/destination-transitions';
import { buildDestinationTransitions } from '../lib/destinationTransitions';

const DRIVE_HISTORY_LIMIT = 1_000;
const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function DestinationTransitionsPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('destinationTransitions.title', 'Destination Transitions'));

  const { vehicleId } = useSelectedVehicle();
  const selectedTimeZone = useTimezone('vehicle');
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDriveHistory(vehicleIdStr, DRIVE_HISTORY_LIMIT);
  const [nowMs] = useState(() => Date.now());
  const hasCachedData =
    vehicleId != null && drivesQuery.data !== undefined;
  const isResolved =
    vehicleId != null && (hasCachedData || drivesQuery.isSuccess);
  const drives = useMemo<Drive[]>(
    () => (vehicleId != null ? drivesQuery.data ?? [] : []),
    [drivesQuery.data, vehicleId],
  );
  const model = useMemo(
    () =>
      buildDestinationTransitions(
        drives,
        nowMs,
        selectedTimeZone,
        { historyLimit: DRIVE_HISTORY_LIMIT },
      ),
    [drives, nowMs, selectedTimeZone],
  );
  const state: DestinationTransitionsQueryState = {
    vehicleSelected: vehicleId != null,
    isLoading:
      vehicleId != null && !hasCachedData && drivesQuery.isLoading,
    isResolved,
    error:
      drivesQuery.isError && !hasCachedData
        ? drivesQuery.error
        : null,
    refreshError:
      drivesQuery.isError && hasCachedData
        ? drivesQuery.error
        : null,
    onRetry: () => void drivesQuery.refetch(),
  };
  const locale = i18n.language;
  const timeZone = model.timeZone;
  return (
    <PageContainer
      title={t('destinationTransitions.title', 'Destination Transitions')}
      subtitle={t(
        'destinationTransitions.subtitle',
        'Continuity-safe historical destination flows, support, temporal profiles, and complete returned-row accounting',
      )}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <DestinationTransitionsKpiBand
          model={model} state={state} locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <DestinationVisitShareChart
            model={model}
            state={state}
            locale={locale}
          />
          <OriginConcentrationSupportChart
            model={model}
            state={state}
            locale={locale}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.1}>
        <TopTransitionMatrix
          model={model} state={state} locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.15}>
        <LeadingSuccessorsDirectory
          model={model}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.2}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <FrequentAcceptedEdges
            model={model}
            state={state}
            locale={locale}
          />
          <EmpiricalInformationEdges
            model={model}
            state={state}
            locale={locale}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.25}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <LocalTwoHourTransitionProfile
            model={model}
            state={state}
            locale={locale}
            timeZone={timeZone}
          />
          <WeekdayTransitionProfile
            model={model}
            state={state}
            locale={locale}
            timeZone={timeZone}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.3}>
        <MonthlyTransitionTrend
          model={model}
          state={state}
          locale={locale}
          timeZone={timeZone}
        />
      </FadeIn>

      <FadeIn delay={0.35}>
        <DestinationTransitionsEvidenceQuality
          model={model}
          state={state}
          locale={locale}
          timeZone={timeZone}
        />
      </FadeIn>

      <FadeIn delay={0.4}>
        <DestinationTransitionsMethodology
          model={model}
          locale={locale}
          timeZone={timeZone}
        />
      </FadeIn>
    </PageContainer>
  );
}
