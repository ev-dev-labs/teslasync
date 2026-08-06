import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Clock3, CalendarDays, Activity } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, HelpTooltip } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { MetricCard, KVList, type KVItem } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useDrives } from '@/api/hooks/useDriving';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import { buildDrivingRhythm, formatFractionalHour } from '../lib/drivingRhythm';

/** Display order: Monday-first week over JS `getDay()` indices. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const DAY_I18N: Record<number, { key: string; fallback: string }> = {
  0: { key: 'rhythm.day.sun', fallback: 'Sun' },
  1: { key: 'rhythm.day.mon', fallback: 'Mon' },
  2: { key: 'rhythm.day.tue', fallback: 'Tue' },
  3: { key: 'rhythm.day.wed', fallback: 'Wed' },
  4: { key: 'rhythm.day.thu', fallback: 'Thu' },
  5: { key: 'rhythm.day.fri', fallback: 'Fri' },
  6: { key: 'rhythm.day.sat', fallback: 'Sat' },
};

export default function DrivingRhythmPage() {
  const { t } = useTranslation();
  usePageTitle(t('rhythm.title', 'Driving Rhythm'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { start, end, setRange } = useRangeState({
    persistKey: 'driving-rhythm.range',
    defaultPresetId: 'all',
  });

  const drivesQuery = useDrives(vehicleIdStr);
  const allDrives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const drives = useMemo<Drive[]>(() => {
    if (!allDrives.length) return [];
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allDrives.filter((d) => {
      if (!d.startTs) return false;
      const ts = new Date(d.startTs).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allDrives, start, end]);

  const rhythm = useMemo(() => buildDrivingRhythm(drives), [drives]);

  const dayLabel = (day: number) => t(DAY_I18N[day]!.key, DAY_I18N[day]!.fallback);

  const departures = useMemo<KVItem[]>(
    () =>
      DAY_ORDER.map((day) => ({
        label: dayLabel(day),
        value:
          rhythm.medianDepartureByDay[day] != null
            ? formatFractionalHour(rhythm.medianDepartureByDay[day]!)
            : '—',
      })),
     
    [rhythm.medianDepartureByDay, t],
  );

  const weekdaySharePct =
    rhythm.total > 0 ? Math.round((rhythm.weekdayCount / rhythm.total) * 100) : null;

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('rhythm.title', 'Driving Rhythm')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('rhythm.title', 'Driving Rhythm')}
      subtitle={t('rhythm.subtitle', 'When your car actually gets driven')}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="driving-rhythm-range"
          />
        </div>
      }
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('rhythm.kpis', 'Driving rhythm summary metrics')}
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
                label={t('rhythm.totalDrives', 'Drives')}
                value={rhythm.total}
                icon={<CalendarDays className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('rhythm.favoriteSlot', 'Favorite Slot')}
                value={
                  rhythm.favorite
                    ? `${dayLabel(rhythm.favorite.day)} ${String(rhythm.favorite.hour).padStart(2, '0')}:00`
                    : '—'
                }
                subtitle={
                  rhythm.favorite
                    ? t('rhythm.driveCount', '{{count}} drives', { count: rhythm.favorite.count })
                    : undefined
                }
                icon={<Clock3 className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('rhythm.weekdayShare', 'Weekday Share')}
                value={weekdaySharePct != null ? `${weekdaySharePct}%` : '—'}
                subtitle={t('rhythm.weekendCount', '{{count}} weekend drives', { count: rhythm.weekendCount })}
                icon={<CalendarClock className="h-5 w-5" />}
                color="blue"
              />
              <MetricCard
                label={t('rhythm.predictability', 'Predictability')}
                value={rhythm.predictability != null ? rhythm.predictability : '—'}
                subtitle={t('rhythm.of100', 'of 100')}
                icon={<Activity className="h-5 w-5" />}
                color="green"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Punchcard (2/3) + typical departures (1/3) */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('rhythm.punchcard', 'Weekly Punchcard')}
              <HelpTooltip
                size="sm"
                i18nKey="help.drivingRhythm.body"
                defaultValue="Each cell counts drives starting in that weekday-hour slot (your local time). Darker cells are busier. The predictability score rises the more your departures concentrate into a few slots."
                ariaLabel={t('help.drivingRhythm.iconLabel', 'More info about the punchcard')}
              />
            </PanelTitle>
            {isError ? (
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            ) : isLoading ? (
              <Skeleton height={260} />
            ) : rhythm.total === 0 ? (
              <EmptyState
                icon={<CalendarClock className="h-8 w-8" />}
                message={t('rhythm.noDrives', 'No drives in this period yet.')}
                actionTo={{ label: t('rhythm.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            ) : (
              <div
                className="overflow-x-auto"
                role="img"
                aria-label={t('rhythm.punchcard.aria', 'Punchcard of drive starts by weekday and hour; favorite slot {{slot}}', {
                  slot: rhythm.favorite
                    ? `${dayLabel(rhythm.favorite.day)} ${String(rhythm.favorite.hour).padStart(2, '0')}:00`
                    : '—',
                })}
              >
                <div className="grid min-w-[560px] grid-cols-[2.5rem_repeat(24,1fr)] gap-0.5">
                  {/* hour header row */}
                  <div />
                  {Array.from({ length: 24 }, (_, h) => (
                    <Text key={h} variant="caption" className="text-center text-2xs tabular-nums">
                      {h % 3 === 0 ? h : ''}
                    </Text>
                  ))}
                  {DAY_ORDER.map((day) => (
                    <Fragment key={day}>
                      <Text variant="caption" className="self-center">{dayLabel(day)}</Text>
                      {Array.from({ length: 24 }, (_, hour) => {
                        const count = rhythm.matrix[day]![hour]!;
                        const intensity = rhythm.maxCount > 0 ? count / rhythm.maxCount : 0;
                        return (
                          <div
                            key={hour}
                            title={`${dayLabel(day)} ${String(hour).padStart(2, '0')}:00 · ${count}`}
                            className="aspect-square rounded-sm border border-[var(--border-subtle)]"
                            style={{
                              background: count > 0 ? chartTokens.series[5] : 'var(--surface-2)',
                              opacity: count > 0 ? 0.25 + intensity * 0.75 : 1,
                            }}
                          />
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('rhythm.departures', 'Typical Departure')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={220} />
            ) : (
              <KVList
                items={departures}
                emptyMessage={t('rhythm.noDrives', 'No drives in this period yet.')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
