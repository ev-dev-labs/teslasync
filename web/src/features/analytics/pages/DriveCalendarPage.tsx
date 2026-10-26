import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';

import { useDriveCalendarHistory } from '@/api/hooks/useDriving';
import { deriveDataState } from '@/api/dataState';

import { Grid, PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { DataSourceNotice, EmptyState, StaleRefreshWarning } from '@/components/feedback';
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
const COMPACT_HEATMAP_MAX_WEEKS = 16;

function DriveCalendarContent() {
  const { t } = useTranslation();
  usePageTitle(t('driveCalendar.title', 'Drive calendar'));
  const { start, end, startInstant, endInstantExclusive, timezone } = useRangeState();
  const { vehicleId, vehiclesState } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDriveCalendarHistory(vehicleIdStr, startInstant, endInstantExclusive);
  const historyState = deriveDataState(drivesQuery, { provenance: 'historical' });
  const source = vehicleId == null ? vehiclesState : historyState;
  const todayMs = Date.now();

  const calendar = useMemo(
    () => buildDriveCalendar(drivesQuery.data ?? [], todayMs, { start, end }),
    [drivesQuery.data, start, end, todayMs],
  );
  const compactHeatmap = calendar.weeks.length <= COMPACT_HEATMAP_MAX_WEEKS;

  if (vehicleId == null && vehiclesState.status === 'unavailable') {
    return <NoVehicleSelected pageTitle={t('driveCalendar.title', 'Drive calendar')} />;
  }

  const sectionState: DriveCalendarSectionState = {
    isLoading: source.status === 'initial' || (vehicleId == null && !source.fatalError),
    error: source.fatalError,
    onRetry: () => {
      if (vehicleId == null) vehiclesState.retry?.();
      else void drivesQuery.refetch();
    },
  };

  return (
    <PageLayout
      title={t('driveCalendar.title', 'Drive calendar')}
      subtitle={t('driveCalendar.subtitle', 'Driving activity and streaks in the selected period')}
    >
      {!source.hasData && source.isRefreshBlocked ? (
        <DataSourceNotice
          title={t('dataSources.status.paused', 'Refresh paused')}
          sources={[{
            id: 'drive-history',
            label: t('driveCalendar.title', 'Drive calendar'),
            query: vehicleId == null ? {
              data: vehiclesState.data,
              isPending: vehiclesState.status === 'initial',
              isError: vehiclesState.fatalError != null,
              error: vehiclesState.fatalError,
              fetchStatus: vehiclesState.isRefreshBlocked ? 'paused' : 'idle',
              refetch: vehiclesState.retry ?? undefined,
            } : drivesQuery,
          }]}
        />
      ) : (
        <StaleRefreshWarning state={source} />
      )}
      <FadeIn>
        <CalendarSummaryCards calendar={calendar} rangeEnd={end} {...sectionState}
          retained={source.status === 'stale' || source.isRefreshBlocked}
          period={{
            kind: 'analysis', label: `${start} – ${end}`,
            start: startInstant, endExclusive: endInstantExclusive,
            timezone, completeness: 'unknown',
            provenance: t('driveCalendar.sourcePeriod', 'Returned drives in the selected workspace range; continuous coverage is unknown.'),
          }} />
      </FadeIn>

      <FadeIn delay={0.05}>
        <section aria-label={t('driveCalendar.activity', 'Driving activity')}>
          <Grid
            gap={4}
            className={compactHeatmap
              // The heatmap panel is a LayoutCard, which is a size-contained
              // (@container) element: it contributes ~0 intrinsic width, so a
              // bare max-content track collapses to padding (26px) with
              // per-character text wrap. Floor the track at the 15rem
              // side-panel minimum instead; the week grid scrolls inside.
              ? 'grid-cols-1 xl:grid-cols-[minmax(min(100%,15rem),max-content)_minmax(0,1fr)] 2xl:grid-cols-[minmax(min(100%,15rem),max-content)_minmax(0,3fr)_minmax(0,2fr)]'
              : 'grid-cols-1 xl:grid-cols-5'}
          >
            <DriveCalendarHeatmap
              calendar={calendar}
              className={compactHeatmap ? 'min-w-0' : 'min-w-0 xl:col-span-5'}
              {...sectionState}
            />
            <MonthlyActivityChart
              months={calendar.months}
              className={compactHeatmap ? 'min-w-0' : 'xl:col-span-3'}
              {...sectionState}
            />
            <WeekdayPatternChart
              weekdays={calendar.weekdays}
              className={compactHeatmap ? 'min-w-0 xl:col-span-2 2xl:col-span-1' : 'xl:col-span-2'}
              {...sectionState}
            />
          </Grid>
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
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
    </PageLayout>
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
        <PageLayout title={t('driveCalendar.title', 'Drive calendar')}>
          <EmptyState
            message={t('driveCalendar.invalidYear', 'Choose a year from 1900 through {{year}}.', { year: currentYear })}
            actionTo={{
              label: t('driveCalendar.openCalendar', 'Open drive calendar'),
              to: '/drive-calendar',
            }}
          />
        </PageLayout>
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
