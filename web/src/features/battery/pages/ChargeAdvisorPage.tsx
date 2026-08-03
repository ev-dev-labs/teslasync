import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PlugZap, BatteryMedium, CalendarClock, Flame } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
  ComposedChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from '@/components/charts';

import { useDrives } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useVehicleLive } from '@/hooks/useVehicleLive';
import { usePageTitle } from '@/hooks/usePageTitle';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import { computeChargeAdvice, RESERVE_FLOOR_PCT } from '../lib/chargeAdvisor';

const DAY_I18N: Record<number, { key: string; fallback: string }> = {
  0: { key: 'chargeAdvisor.day.sun', fallback: 'Sun' },
  1: { key: 'chargeAdvisor.day.mon', fallback: 'Mon' },
  2: { key: 'chargeAdvisor.day.tue', fallback: 'Tue' },
  3: { key: 'chargeAdvisor.day.wed', fallback: 'Wed' },
  4: { key: 'chargeAdvisor.day.thu', fallback: 'Thu' },
  5: { key: 'chargeAdvisor.day.fri', fallback: 'Fri' },
  6: { key: 'chargeAdvisor.day.sat', fallback: 'Sat' },
};

export default function ChargeAdvisorPage() {
  const { t } = useTranslation();
  usePageTitle(t('chargeAdvisor.title', 'Charge Advisor'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const drivesQuery = useDrives(vehicleIdStr);
  const drives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);
  const live = useVehicleLive(vehicleId ?? undefined);

  // Prefer the live SoC; fall back to the newest drive's arrival SoC so the
  // advisor still works when the car is asleep or the stream is down.
  const currentSoc = useMemo(() => {
    if (live.state.batteryLevel > 0) return live.state.batteryLevel;
    const latest = [...drives]
      .filter((d) => d.endBatteryPct != null)
      .sort((a, b) => b.startTs.localeCompare(a.startTs))[0];
    return latest?.endBatteryPct ?? null;
  }, [live.state.batteryLevel, drives]);

  const advice = useMemo(
    () => computeChargeAdvice(drives, currentSoc, Date.now()),
    [drives, currentSoc],
  );

  const dayLabel = (day: number) => t(DAY_I18N[day]!.key, DAY_I18N[day]!.fallback);

  const forecastData = useMemo(
    () =>
      advice.forecast.map((f) => ({
        label: f.offset === 0 ? t('chargeAdvisor.today', 'Today') : dayLabel(f.day),
        burn: f.expectedBurnPct,
        soc: f.projectedEndPct,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dayLabel derives from t
    [advice.forecast, t],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('chargeAdvisor.title', 'Charge Advisor')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('chargeAdvisor.title', 'Charge Advisor')}
      subtitle={t('chargeAdvisor.subtitle', 'Do you need to plug in tonight?')}
      query={drivesQuery}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('chargeAdvisor.kpis', 'Charge advisor summary metrics')}
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
                label={t('chargeAdvisor.verdict', 'Tonight')}
                value={
                  advice.forecast.length === 0
                    ? '—'
                    : advice.chargeTonight
                      ? t('chargeAdvisor.plugIn', 'Plug in')
                      : t('chargeAdvisor.skip', 'Skip it')
                }
                subtitle={
                  advice.daysToReserve != null
                    ? t('chargeAdvisor.reserveIn', 'reserve in ~{{days}} days', { days: advice.daysToReserve })
                    : t('chargeAdvisor.reserveSafe', 'no reserve risk this week')
                }
                icon={<PlugZap className="h-5 w-5" />}
                color={advice.chargeTonight ? 'amber' : 'green'}
              />
              <MetricCard
                label={t('chargeAdvisor.currentSoc', 'Battery Now')}
                value={currentSoc != null ? `${Math.round(currentSoc)}%` : '—'}
                subtitle={
                  live.state.batteryLevel > 0
                    ? t('chargeAdvisor.live', 'live')
                    : t('chargeAdvisor.lastKnown', 'last known arrival')
                }
                icon={<BatteryMedium className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('chargeAdvisor.typicalBurn', 'Typical Daily Use')}
                value={advice.typicalDailyBurnPct != null ? `${advice.typicalDailyBurnPct}%` : '—'}
                subtitle={t('chargeAdvisor.drivingDays', 'on driving days')}
                icon={<Flame className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('chargeAdvisor.history', 'History')}
                value={advice.analyzedDays}
                subtitle={t('chargeAdvisor.daysAnalyzed', 'driving days analyzed')}
                icon={<CalendarClock className="h-5 w-5" />}
                color="blue"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — 7-day projection */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && advice.forecast.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: the projection needs a few days of SoC history plus a current battery level; it appears automatically once data exists. */
              icon={<PlugZap className="h-8 w-8" />}
              message={t('chargeAdvisor.noForecast', 'Not enough battery history yet to project the week ahead.')}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('chargeAdvisor.forecast', 'Week-Ahead Battery Projection')}
            subtitle={t('chargeAdvisor.forecastHint', 'Expected daily use from your weekday habits; the dashed line is the {{pct}}% reserve floor', { pct: RESERVE_FLOOR_PCT })}
            ariaLabel={t('chargeAdvisor.forecast.aria', 'Projected battery percentage for the next seven days with expected daily consumption')}
            loading={isLoading}
            empty={forecastData.length === 0}
            height={320}
            data={forecastData}
            dataColumns={[
              { key: 'label', label: t('chargeAdvisor.col.day', 'Day') },
              { key: 'burn', label: t('chargeAdvisor.col.burn', 'Expected use %') },
              { key: 'soc', label: t('chargeAdvisor.col.soc', 'Projected battery %') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={forecastData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine
                  y={RESERVE_FLOOR_PCT}
                  stroke={chartTokens.series[3]}
                  strokeDasharray="6 4"
                  strokeOpacity={0.8}
                />
                <Bar
                  dataKey="burn"
                  name={t('chargeAdvisor.expectedUse', 'Expected use')}
                  fill={chartTokens.series[4]}
                  fillOpacity={0.35}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="soc"
                  name={t('chargeAdvisor.projected', 'Projected battery')}
                  stroke={chartTokens.series[5]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Weekday habits */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('chargeAdvisor.weekdays', 'Typical Use by Weekday')}
            <HelpTooltip
              size="sm"
              i18nKey="help.chargeAdvisor.body"
              defaultValue="Median battery percentage consumed on days you actually drive, per weekday, discounted by how often that weekday is driven at all. The projection walks these expectations forward from your current charge."
              ariaLabel={t('help.chargeAdvisor.iconLabel', 'More info about the advisor')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={90} />
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                const wb = advice.weekdayBurn[day]!;
                return (
                  <div
                    key={day}
                    className="flex flex-col items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                  >
                    <Text variant="caption">{dayLabel(day)}</Text>
                    <Text className="font-mono text-lg tabular-nums text-cyan-300">
                      {wb.medianPct != null ? `${Math.round(wb.medianPct)}%` : '—'}
                    </Text>
                    <Badge variant={wb.driveDayShare != null && wb.driveDayShare > 0.6 ? 'info' : 'neutral'}>
                      {wb.driveDayShare != null
                        ? t('chargeAdvisor.drivenShare', '{{pct}}% driven', { pct: Math.round(wb.driveDayShare * 100) })
                        : t('chargeAdvisor.noHistory', 'no data')}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
