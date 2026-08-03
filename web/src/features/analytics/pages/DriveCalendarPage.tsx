import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Flame, Trophy, Route } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useDrives } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';

import { buildDriveCalendar } from '../lib/driveCalendar';

/** Cell opacity per intensity level 0–4. */
const LEVEL_OPACITY = [1, 0.3, 0.5, 0.75, 1] as const;

export default function DriveCalendarPage() {
  const { t } = useTranslation();
  usePageTitle(t('driveCalendar.title', 'Drive Calendar'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatDistance } = useUnits();

  const drivesQuery = useDrives(vehicleIdStr);

  const calendar = useMemo(
    () => buildDriveCalendar(drivesQuery.data ?? [], Date.now()),
    [drivesQuery.data],
  );

  // Column-per-week layout: weeks[w][d] with JS day rows (Sun-first like the
  // GitHub graph).
  const weeks = useMemo(() => {
    const out: (typeof calendar.days)[] = [];
    for (let i = 0; i < calendar.days.length; i += 7) out.push(calendar.days.slice(i, i + 7));
    return out;
  }, [calendar.days]);

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('driveCalendar.title', 'Drive Calendar')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('driveCalendar.title', 'Drive Calendar')}
      subtitle={t('driveCalendar.subtitle', 'A year of driving at a glance, with streaks')}
      query={drivesQuery}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('driveCalendar.kpis', 'Drive calendar summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('driveCalendar.activeDays', 'Active Days')}
                value={calendar.activeDays}
                subtitle={t('driveCalendar.inYear', 'in the last 52 weeks')}
                icon={<CalendarDays className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('driveCalendar.currentStreak', 'Current Streak')}
                value={t('driveCalendar.days', '{{count}} days', { count: calendar.currentStreak })}
                subtitle={t('driveCalendar.longest', 'longest: {{count}}', { count: calendar.longestStreak })}
                icon={<Flame className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('driveCalendar.distance', 'Distance')}
                value={formatDistance(calendar.totalDistanceM, { precision: 0 })}
                subtitle={t('driveCalendar.driveCount', '{{count}} drives', { count: calendar.totalDrives })}
                icon={<Route className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('driveCalendar.busiestDay', 'Busiest Day')}
                value={calendar.busiestDay ? formatDistance(calendar.busiestDay.distanceM, { precision: 0 }) : '—'}
                subtitle={calendar.busiestDay ? formatDateShort(calendar.busiestDay.date) : undefined}
                icon={<Trophy className="h-5 w-5" />}
                color="purple"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — The year grid */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('driveCalendar.grid', 'Last 52 Weeks')}
            <HelpTooltip
              size="sm"
              i18nKey="help.driveCalendar.body"
              defaultValue="Each cell is one day; darker means more distance, scaled against your 95th-percentile day so one road trip doesn't flatten the rest. Streaks count consecutive days with at least one drive."
              ariaLabel={t('help.driveCalendar.iconLabel', 'More info about the calendar')}
            />
          </PanelTitle>
          {isError ? (
            <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
          ) : isLoading ? (
            <Skeleton height={180} />
          ) : calendar.totalDrives === 0 ? (
            <EmptyState
              icon={<CalendarDays className="h-8 w-8" />}
              message={t('driveCalendar.noDrives', 'No drives in the last year yet.')}
              actionTo={{ label: t('driveCalendar.browseDrives', 'Browse drives'), to: '/drives' }}
            />
          ) : (
            <div
              className="overflow-x-auto"
              role="img"
              aria-label={t('driveCalendar.grid.aria', 'Daily driving heatmap for the last 52 weeks; {{active}} active days, current streak {{streak}} days', {
                active: calendar.activeDays,
                streak: calendar.currentStreak,
              })}
            >
              <div className="flex min-w-[720px] gap-0.5">
                {weeks.map((week, w) => (
                  <div key={w} className="flex flex-col gap-0.5">
                    {week.map((day) => (
                      <Fragment key={day.date}>
                        <div
                          title={`${formatDateShort(day.date)} · ${formatDistance(day.distanceM, { precision: 1 })} · ${day.drives}`}
                          className="h-3 w-3 rounded-sm border border-[var(--border-subtle)]"
                          style={{
                            background: day.level > 0 ? chartTokens.series[1] : 'var(--surface-2)',
                            opacity: LEVEL_OPACITY[day.level],
                          }}
                        />
                      </Fragment>
                    ))}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-1.5">
                <Text variant="caption">{t('driveCalendar.less', 'Less')}</Text>
                {LEVEL_OPACITY.map((opacity, level) => (
                  <span
                    key={level}
                    className="h-3 w-3 rounded-sm border border-[var(--border-subtle)]"
                    style={{
                      background: level > 0 ? chartTokens.series[1] : 'var(--surface-2)',
                      opacity,
                    }}
                    aria-hidden="true"
                  />
                ))}
                <Text variant="caption">{t('driveCalendar.more', 'More')}</Text>
              </div>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
