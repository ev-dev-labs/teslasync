import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveCalendarHistory } from '@/api/hooks/useDriving';

import { Grid, PageLayout } from '@/components/layout';
import { AlertBanner, SectionErrorBoundary, StaleRefreshWarning } from '@/components/feedback';
import { Button } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import {
  DepartureConsistency,
  DrivingRhythmMethodology,
  HourlyDistribution,
  MonthlyRhythmTrend,
  StrongestSlots,
  WeekdayWeekendComparison,
  WeeklyPunchcard,
  type DrivingRhythmSectionState,
} from '../components/driving-rhythm';
import { buildDrivingRhythm } from '../lib/drivingRhythm';
import { DrivingRhythmBrief } from '../components/operationalbrief-a-m/DrivingRhythmBrief';

const SPLIT_COLUMNS = { default: 1, xl: 5 } as const;

export default function DrivingRhythmPage() {
  const { t } = useTranslation();
  usePageTitle(t('rhythm.title', 'Driving Rhythm'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { start, end, timezone } = useRangeState({
    persistKey: 'driving-rhythm.range',
    defaultPresetId: 'all',
    inheritSharedPreference: false,
  });
  const [analysisNowMs] = useState(() => Date.now());

  const drivesQuery = useDriveCalendarHistory(vehicleIdStr, start, end);
  const drives = useMemo(() => drivesQuery.data ?? [], [drivesQuery.data]);
  const sourceState = useDataState(drivesQuery, { provenance: 'historical' });
  const summary = useMemo(
    () =>
      buildDrivingRhythm(drives, {
        nowMs: analysisNowMs,
        timeZone: timezone,
        rangeStart: start,
        rangeEnd: end,
      }),
    [analysisNowMs, drives, end, start, timezone],
  );

  if (vehicleId == null) {
    return (
      <NoVehicleSelected
        pageTitle={t('rhythm.title', 'Driving Rhythm')}
      />
    );
  }

  const sectionState: DrivingRhythmSectionState = {
    isLoading: sourceState.status === 'initial',
    retained: sourceState.hasData && (
      sourceState.status === 'stale' ||
      sourceState.refreshError != null ||
      sourceState.isRefreshBlocked
    ),
    error: sourceState.fatalError,
    onRetry: () => {
      void drivesQuery.refetch();
    },
  };

  return (
    <PageLayout
      title={t('rhythm.title', 'Driving Rhythm')}
      subtitle={t(
        'rhythm.subtitle',
        'When your car actually gets driven',
      )}
      query={drivesQuery}
      busy={sourceState.status === 'initial' && !sourceState.isRefreshBlocked && drivesQuery.isFetching}
    >
      {sourceState.status === 'initial' && sourceState.isRefreshBlocked && (
        <AlertBanner
          data-testid="driving-rhythm-initial-paused"
          variant="info"
          title={t('dataSources.status.paused', 'Refresh paused')}
        >
          {t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
          <Button
            variant="ghost"
            size="sm"
            wrapLabel
            className="min-h-11 md:min-h-9"
            onClick={sectionState.onRetry}
          >
            {t('common.refresh', 'Refresh')}
          </Button>
        </AlertBanner>
      )}
      <StaleRefreshWarning state={sourceState} label={t('rhythm.title', 'Driving Rhythm')} />
      <SectionErrorBoundary name="DrivingRhythmBrief">
        <DrivingRhythmBrief summary={summary} {...sectionState}
          scope={t('rhythm.brief.window', '{{start}}–{{end}} · {{timezone}}', { start, end, timezone })}
          retained={sectionState.retained} />
      </SectionErrorBoundary>

      <SectionErrorBoundary name="WeeklyPunchcard">
        <WeeklyPunchcard summary={summary} state={sectionState} />
      </SectionErrorBoundary>

      <Grid cols={SPLIT_COLUMNS} gap={4}>
        <div className="min-w-0 xl:col-span-3">
          <SectionErrorBoundary name="HourlyDistribution">
            <HourlyDistribution
              summary={summary}
              state={sectionState}
            />
          </SectionErrorBoundary>
        </div>
        <div className="min-w-0 xl:col-span-2">
          <SectionErrorBoundary name="WeekdayWeekendComparison">
            <WeekdayWeekendComparison
              summary={summary}
              state={sectionState}
            />
          </SectionErrorBoundary>
        </div>
      </Grid>

      <SectionErrorBoundary name="MonthlyRhythmTrend">
        <MonthlyRhythmTrend summary={summary} state={sectionState} />
      </SectionErrorBoundary>

      <Grid cols={SPLIT_COLUMNS} gap={4}>
        <div className="min-w-0 xl:col-span-3">
          <SectionErrorBoundary name="DepartureConsistency">
            <DepartureConsistency
              summary={summary}
              state={sectionState}
            />
          </SectionErrorBoundary>
        </div>
        <div className="min-w-0 xl:col-span-2">
          <SectionErrorBoundary name="StrongestSlots">
            <StrongestSlots
              summary={summary}
              state={sectionState}
            />
          </SectionErrorBoundary>
        </div>
      </Grid>

      <SectionErrorBoundary name="DrivingRhythmMethodology">
        <DrivingRhythmMethodology
          summary={summary}
          start={start}
          end={end}
          state={sectionState}
        />
      </SectionErrorBoundary>
    </PageLayout>
  );
}
