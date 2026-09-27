import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';

import { useDriveCalendarHistory } from '@/api/hooks/useDriving';

import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
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
import { buildDriveCalendar, calendarDayKey } from '../lib/driveCalendar';

const ACTIVITY_COLUMNS = { default: 1, xl: 5 } as const;

function DriveCalendarContent() {
  const { t } = useTranslation();
  usePageTitle(t('driveCalendar.title', 'Drive Calendar'));
  const { start, end, startInstant, endInstantExclusive } = useRangeState();
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDriveCalendarHistory(vehicleIdStr, startInstant, endInstantExclusive);

  const calendar = useMemo(
    () => buildDriveCalendar(drivesQuery.data ?? [], Date.now(), { start, end }),
    [drivesQuery.data, start, end],
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
      subtitle={t('driveCalendar.subtitle', 'Driving activity and streaks in the selected period')}
    >
      <FadeIn>
        <CalendarSummaryCards calendar={calendar} rangeEnd={end} {...sectionState} />
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

/** A driving recap scoped by the same View settings as the rest of the workspace. */
export default function DriveCalendarPage() {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  const rawYear = params.get('year');
  if (rawYear == null) return <DriveCalendarContent />;

  if (!params.has('from') && !params.has('to')) {
    const currentYear = new Date().getFullYear();
    const year = Number(rawYear);
    if (!/^\d{4}$/.test(rawYear) || year < 1900 || year > currentYear) {
      return (
        <PageContainer title={t('driveCalendar.title', 'Drive Calendar')}>
          <EmptyState
            message={t('driveCalendar.invalidYear', 'Choose a year from 1900 through {{year}}.', { year: currentYear })}
            actionTo={{
              label: t('driveCalendar.openCalendar', 'Open Drive Calendar'),
              to: '/drive-calendar',
            }}
          />
        </PageContainer>
      );
    }
    const end = year === currentYear ? calendarDayKey(new Date()) : `${year}-12-31`;
    params.set('from', `${year}-01-01`);
    params.set('to', end);
    params.set('time_scope', 'custom');
  }
  params.delete('year');
  return <Navigate replace to={{ pathname, search: params.toString() }} />;
}
