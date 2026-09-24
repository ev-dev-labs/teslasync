import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { useDriveCalendarHistory } from '@/api/hooks/useDriving';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Button, Input } from '@/components/ui';
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
import { buildDriveCalendar, driveCalendarBounds } from '../lib/driveCalendar';

const ACTIVITY_COLUMNS = { default: 1, xl: 5 } as const;
const FIRST_YEAR = 1900;

/** A responsive driving recap with complete history for each selected year. */
export default function DriveCalendarPage() {
  const { t } = useTranslation();
  usePageTitle(t('driveCalendar.title', 'Drive Calendar'));

  const [searchParams, setSearchParams] = useSearchParams();
  const [yearError, setYearError] = useState('');
  const currentYear = new Date().getFullYear();
  const rawYear = searchParams.get('year');
  const year = rawYear && /^\d{4}$/.test(rawYear) && Number(rawYear) >= FIRST_YEAR && Number(rawYear) <= currentYear
    ? Number(rawYear)
    : null;
  const selectYear = (selected: number | null) => {
    setYearError('');
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (selected != null) next.set('year', String(selected));
      else next.delete('year');
      return next;
    });
  };
  const { start, endExclusive } = driveCalendarBounds(Date.now(), year);
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDriveCalendarHistory(vehicleIdStr, start.toISOString(), endExclusive.toISOString());

  const calendar = useMemo(
    () => buildDriveCalendar(drivesQuery.data ?? [], Date.now(), year),
    [drivesQuery.data, year],
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
        year == null ? 'driveCalendar.subtitle' : 'driveCalendar.yearSubtitle',
        year == null ? 'A year of driving at a glance, with streaks' : 'Driving activity across {{year}}',
        { year },
      )}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-end gap-3">
          <Button variant={year == null ? 'primary' : 'ghost'} size="sm" onClick={() => selectYear(null)}>
            {t('driveCalendar.rolling', 'Last 52 weeks')}
          </Button>
          <div className="flex items-end gap-1">
            <Button variant="ghost" size="sm" disabled={year === FIRST_YEAR}
              onClick={() => selectYear((year ?? currentYear) - 1)}
              aria-label={t('driveCalendar.previousYear', 'Previous year')}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Input
              key={year ?? 'rolling'}
              label={t('driveCalendar.jumpToYear', 'Jump to year')}
              type="number"
              min={FIRST_YEAR}
              max={currentYear}
              size="sm"
              className="w-24"
              defaultValue={year ?? ''}
              placeholder={String(currentYear)}
              error={yearError || (rawYear != null && year == null
                ? t('driveCalendar.invalidYear', 'Choose a year from 1900 through {{year}}.', { year: currentYear })
                : undefined)}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (!value) return;
                const parsed = Number(value);
                if (!/^\d{4}$/.test(value) || !Number.isInteger(parsed) || parsed < FIRST_YEAR || parsed > currentYear) {
                  setYearError(t('driveCalendar.invalidYear', 'Choose a year from 1900 through {{year}}.', { year: currentYear }));
                  return;
                }
                selectYear(parsed);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
            <Button variant="ghost" size="sm" disabled={year == null || year >= currentYear}
              onClick={() => selectYear((year ?? currentYear) + 1)}
              aria-label={t('driveCalendar.nextYear', 'Next year')}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <VehicleSelect />
        </div>
      }
    >
      <FadeIn>
        <CalendarSummaryCards calendar={calendar} year={year} {...sectionState} />
      </FadeIn>

      <FadeIn delay={0.05}>
        <DriveCalendarHeatmap calendar={calendar} year={year} {...sectionState} />
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
