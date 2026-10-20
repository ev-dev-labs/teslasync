import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DestinationEvidenceBrief } from '../components/operationalbrief-a-m/DestinationEvidenceBrief';

import { useDriveHistory } from '@/api/hooks/useDriving';

import { Grid, PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { AlertBanner, StaleRefreshWarning } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';
import type { Drive } from '@/types/driving';

import {
  DestinationTransitionsEvidenceQuality,
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
  const { t } = useTranslation();
  const { locale } = useNumberFormatting();
  usePageTitle(t('destinationTransitions.title', 'Destination transitions'));

  const { vehicleId } = useSelectedVehicle();
  const selectedTimeZone = useTimezone('vehicle');
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDriveHistory(vehicleIdStr, DRIVE_HISTORY_LIMIT);
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const analysisScope = useMemo(
    () => ({ vehicleId, initialNowMs: Date.now() }),
    [vehicleId],
  );
  // A refresh failure keeps the last successful snapshot's classification clock.
  const snapshotAt = drivesState.updatedAt;
  const nowMs =
    snapshotAt != null && Number.isFinite(snapshotAt)
      ? snapshotAt
      : analysisScope.initialNowMs;
  const hasCachedData =
    vehicleId != null && drivesState.hasData;
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
    sourceTrust: drivesState,
    vehicleSelected: vehicleId != null,
    isLoading:
      vehicleId != null && drivesState.status === 'initial' && !drivesState.isRefreshBlocked,
    isResolved,
    error:
      drivesState.fatalError,
    refreshError:
      drivesState.refreshError,
    onRetry: () => void drivesQuery.refetch(),
  };
  const timeZone = model.timeZone;
  return (
    <PageLayout
      title={t('destinationTransitions.title', 'Destination transitions')}
      query={drivesQuery}
      subtitle={t(
        'destinationTransitions.subtitle',
        'Continuity-safe historical destination flows, support, temporal profiles, and complete returned-row accounting',
      )}
    >
      {state.vehicleSelected && drivesState.isRefreshBlocked && !drivesState.hasData && !state.error && (
        <AlertBanner
          variant="info"
          role="status"
          aria-live="polite"
          title={t('dataSources.status.paused', 'Refresh paused')}
          data-testid="destination-transitions-initial-pause"
        >
          <Text as="p" variant="bodySm">
            {t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
          </Text>
          {drivesState.retry != null && (
            <Button type="button" variant="ghost" size="sm" onClick={drivesState.retry}>
              {t('destinationTransitions.states.retry', 'Retry')}
            </Button>
          )}
        </AlertBanner>
      )}
      {drivesState.isRefreshBlocked && drivesState.hasData && (
        <StaleRefreshWarning state={drivesState} hideRetry={drivesState.refreshError != null} label={t('destinationTransitions.title', 'Destination transitions')} />
      )}
      <FadeIn>
        <DestinationEvidenceBrief
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
    </PageLayout>
  );
}
