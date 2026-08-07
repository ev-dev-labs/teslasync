import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDrives } from '@/api/hooks/useDriving';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import {
  CalendarSummaryCards,
  DriveCalendarHeatmap,
  MonthlyActivityChart,
  RhythmInsightsPanel,
  TopDrivingDaysPanel,
  WeekdayPatternChart,
  type DriveCalendarSectionState,
} from '../components/drive-calendar';
import { buildDriveCalendar } from '../lib/driveCalendar';

const ANALYTICS_DRIVE_WINDOW = { limit: 1000 } as const;
const ACTIVITY_COLUMNS = { default: 1, xl: 5 } as const;

/** A responsive 52-week driving recap derived entirely from the drives query. */
export default function DriveCalendarPage() {
  const { t } = useTranslation();
  usePageTitle(t('driveCalendar.title', 'Drive Calendar'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDrives(vehicleIdStr, ANALYTICS_DRIVE_WINDOW);

  const calendar = useMemo(
    () => buildDriveCalendar(drivesQuery.data ?? [], Date.now()),
    [drivesQuery.data],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('driveCalendar.title', 'Drive Calendar')} />;
  }

  const sectionState: DriveCalendarSectionState = {
    isLoading: drivesQuery.isLoading,
    error: drivesQuery.isError ? drivesQuery.error : null,
    onRetry: () => {
      void drivesQuery.refetch();
    },
  };

  return (
    <PageContainer
      title={t('driveCalendar.title', 'Drive Calendar')}
      subtitle={t(
        'driveCalendar.subtitle',
        'A year of driving at a glance, with streaks',
      )}
      query={drivesQuery}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <CalendarSummaryCards calendar={calendar} {...sectionState} />
      </FadeIn>

      <FadeIn delay={0.05}>
        <DriveCalendarHeatmap calendar={calendar} {...sectionState} />
      </FadeIn>

      <FadeIn delay={0.1}>
        <section aria-label={t('driveCalendar.activity', 'Driving activity')}>
          <Grid cols={ACTIVITY_COLUMNS} gap={4}>
            <MonthlyActivityChart
              months={calendar.months}
              className="xl:col-span-3"
              {...sectionState}
            />
            <WeekdayPatternChart
              weekdays={calendar.weekdays}
              className="xl:col-span-2"
              {...sectionState}
            />
          </Grid>
        </section>
      </FadeIn>

      <FadeIn delay={0.15}>
        <section
          aria-label={t(
            'driveCalendar.insights',
            'Driving patterns and highlights',
          )}
        >
          <Grid cols={ACTIVITY_COLUMNS} gap={4}>
            <RhythmInsightsPanel
              calendar={calendar}
              className="xl:col-span-2"
              {...sectionState}
            />
            <TopDrivingDaysPanel
              days={calendar.topDays}
              className="xl:col-span-3"
              {...sectionState}
            />
          </Grid>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
