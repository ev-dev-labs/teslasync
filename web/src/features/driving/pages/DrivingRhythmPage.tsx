import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveCalendarHistory } from '@/api/hooks/useDriving';

import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import {
  DepartureConsistency,
  DrivingRhythmKpis,
  DrivingRhythmMethodology,
  HourlyDistribution,
  MonthlyRhythmTrend,
  StrongestSlots,
  WeekdayWeekendComparison,
  WeeklyPunchcard,
  type DrivingRhythmSectionState,
} from '../components/driving-rhythm';
import { buildDrivingRhythm } from '../lib/drivingRhythm';

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
    isLoading: drivesQuery.isLoading,
    error: drivesQuery.isError ? drivesQuery.error : null,
    onRetry: () => {
      void drivesQuery.refetch();
    },
  };

  return (
    <PageContainer
      title={t('rhythm.title', 'Driving Rhythm')}
      subtitle={t(
        'rhythm.subtitle',
        'When your car actually gets driven',
      )}
      query={drivesQuery}
    >
      <FadeIn>
        <DrivingRhythmKpis summary={summary} {...sectionState} />
      </FadeIn>

      <FadeIn delay={0.05}>
        <WeeklyPunchcard summary={summary} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.1}>
        <Grid cols={SPLIT_COLUMNS} gap={4}>
          <HourlyDistribution
            summary={summary}
            state={sectionState}
            className="xl:col-span-3"
          />
          <WeekdayWeekendComparison
            summary={summary}
            state={sectionState}
            className="xl:col-span-2"
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.15}>
        <MonthlyRhythmTrend summary={summary} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.2}>
        <Grid cols={SPLIT_COLUMNS} gap={4}>
          <DepartureConsistency
            summary={summary}
            state={sectionState}
            className="xl:col-span-3"
          />
          <StrongestSlots
            summary={summary}
            state={sectionState}
            className="xl:col-span-2"
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.25}>
        <DrivingRhythmMethodology
          summary={summary}
          start={start}
          end={end}
          state={sectionState}
        />
      </FadeIn>
    </PageContainer>
  );
}
