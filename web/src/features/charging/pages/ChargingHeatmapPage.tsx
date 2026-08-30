import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity, BarChart3, CalendarClock, Clock, DollarSign, MapPin, RefreshCw, Zap,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Button, GlassPanel, PanelTitle, SectionTitle, Text, Caption } from '@/components/ui';
import { MetricCard, MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ChartTooltip, EmbeddedChart, chartGrid, axisTickSm,
} from '@/components/charts';
import { RangePicker, VehicleSelect } from '@/components/forms';

import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { fmtInt } from '@/lib/numberFormat';
import { DAYS } from '@/lib/constants';
import { chartTokens } from '@/lib/tokens';

import {
  HeatmapGrid,
  buildGrid,
  aggregateLocations,
  aggregateByDayOfWeek,
  deriveInsights,
  formatHourLabel,
} from '../components/charging-heatmap';

export default function ChargingHeatmapPage() {
  const { t } = useTranslation();
  usePageTitle(t('charging.heatmap.title', 'Charging Patterns'));

  // The header VehiclePicker is the source of truth for the active vehicle.
  const { vehicleId } = useSelectedVehicle();
  const { start, end, setRange } = useRangeState({
    persistKey: 'charging-heatmap.range',
    defaultPresetId: 'all',
  });

  const query = useChargingSessionsPaginated(vehicleId, { limit: 2000, start, end });
  const { data, isLoading, isError, error, refetch } = query;
  const sessions = data ?? [];
  const hasData = sessions.length > 0;

  const { formatEnergy, formatDuration } = useUnits();
  const { formatCurrency } = useFormatting();

  const model = useMemo(() => buildGrid(sessions), [sessions]);
  const insights = useMemo(() => deriveInsights(model), [model]);
  const dayOfWeekData = useMemo(() => aggregateByDayOfWeek(model, DAYS), [model]);
  const locationData = useMemo(
    () => aggregateLocations(sessions, t('charging.heatmap.unknownPlace', 'Unknown')),
    [sessions, t],
  );

  const stats = useMemo(() => {
    if (sessions.length === 0) return null;
    let totalEnergyWh = 0;
    let totalCost = 0;
    let totalDurationS = 0;
    let durationCount = 0;
    for (const s of sessions) {
      totalEnergyWh += s.total_energy_added_wh ?? 0;
      totalCost += s.cost_decimal ?? 0;
      const started = new Date(s.started_at).getTime();
      const ended = s.ended_at ? new Date(s.ended_at).getTime() : Number.NaN;
      if (Number.isFinite(started) && Number.isFinite(ended) && ended > started) {
        totalDurationS += (ended - started) / 1000;
        durationCount += 1;
      }
    }
    return {
      count: sessions.length,
      totalEnergyWh,
      totalCost,
      // Average only over sessions that actually have a measured duration —
      // live (unfinished) or timestamp-less sessions must not dilute the mean.
      avgDurationS: durationCount > 0 ? totalDurationS / durationCount : 0,
    };
  }, [sessions]);

  const barMax = Math.max(stats?.count ?? 0, 1);

  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
      <VehicleSelect />
      <RangePicker
        value={{ start, end }}
        onChange={setRange}
        align="end"
        triggerTestId="charging-heatmap-range"
      />
      <Button
        variant="ghost"
        onClick={() => refetch()}
        aria-label={t('common.refresh', 'Refresh')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('charging.heatmap.title', 'Charging Patterns')}
      subtitle={t('charging.heatmap.subtitle', 'When and where you charge')}
      actions={actions}
      query={query}
    >
      {/* ── KPI band ── */}
      <FadeIn>
        <section
          aria-label={t('charging.heatmap.kpis', 'Charging summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={92} />)
          ) : (
            <>
              <MetricCard
                label={t('charging.heatmap.totalSessions', 'Total Sessions')}
                value={fmtInt(stats?.count ?? 0)}
                icon={<Activity className="h-5 w-5" aria-hidden="true" />}
                color="cyan"
              />
              <MetricCard
                label={t('charging.heatmap.totalEnergy', 'Total Energy')}
                value={formatEnergy(stats?.totalEnergyWh ?? 0)}
                icon={<Zap className="h-5 w-5" aria-hidden="true" />}
                color="green"
              />
              <MetricCard
                label={t('charging.heatmap.totalCost', 'Total Cost')}
                value={formatCurrency(stats?.totalCost ?? 0)}
                icon={<DollarSign className="h-5 w-5" aria-hidden="true" />}
                color="purple"
              />
              <MetricCard
                label={t('charging.heatmap.avgDuration', 'Avg Duration')}
                value={formatDuration(stats?.avgDurationS ?? 0)}
                icon={<Clock className="h-5 w-5" aria-hidden="true" />}
                color="amber"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* ── Hero: weekly heatmap + insights side panel ── */}
      <FadeIn delay={0.1}>
        <section aria-labelledby="charging-heatmap-when" className="space-y-4">
          <SectionTitle id="charging-heatmap-when">
            {t('charging.heatmap.whenSection', 'When You Charge')}
          </SectionTitle>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
            <GlassPanel className="min-w-0 p-4 sm:p-5 xl:col-span-2">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('charging.heatmap.gridTitle', 'Weekly Charging Heatmap')}
              </PanelTitle>
              {isLoading ? (
                <Skeleton height={260} />
              ) : isError ? (
                <QueryError error={error} onRetry={() => refetch()} />
              ) : !hasData ? (
                /* no-action: transient empty — resolves once sessions exist in the selected range */
                <EmptyState
                  icon={<CalendarClock className="h-8 w-8" aria-hidden="true" />}
                  message={t('charging.heatmap.noData', 'No charging sessions in this range')}
                />
              ) : (
                <HeatmapGrid model={model} formatEnergy={formatEnergy} />
              )}
            </GlassPanel>

            <GlassPanel className="min-w-0 p-4 sm:p-5">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('charging.heatmap.insights', 'Charging Insights')}
              </PanelTitle>
              {isLoading ? (
                <Skeleton height={220} />
              ) : isError ? (
                <QueryError error={error} onRetry={() => refetch()} />
              ) : !hasData ? (
                /* no-action: transient empty — insights derive from charging history */
                <EmptyState
                  icon={<Activity className="h-8 w-8" aria-hidden="true" />}
                  message={t('charging.heatmap.noInsights', 'Insights appear once you have charging history')}
                />
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/[0.06] p-3">
                    <Caption>{t('charging.heatmap.favorite', 'Favorite Charging Time')}</Caption>
                    <Text as="p" size="sm" weight="semibold" color="primary" className="mt-1">
                      {model.maxCount > 0
                        ? t('charging.heatmap.favoriteValue', '{{day}}s at {{hour}}', {
                            day: DAYS[model.favDay],
                            hour: formatHourLabel(model.favHour),
                          })
                        : '—'}
                    </Text>
                    <Caption>
                      {t('charging.heatmap.favoriteSessions', '{{count}} sessions', {
                        count: model.maxCount,
                      })}
                    </Caption>
                  </div>

                  <div className="space-y-3">
                    <MetricBar
                      label={t('charging.heatmap.busiestDay', 'Busiest Day')}
                      value={insights.busiestDayCount}
                      max={barMax}
                      color={chartTokens.series[5]}
                      sublabel={`${DAYS[insights.busiestDay]} · ${fmtInt(insights.busiestDayCount)}`}
                    />
                    <MetricBar
                      label={t('charging.heatmap.busiestHour', 'Busiest Hour')}
                      value={insights.busiestHourCount}
                      max={barMax}
                      color={chartTokens.series[1]}
                      sublabel={`${formatHourLabel(insights.busiestHour)} · ${fmtInt(insights.busiestHourCount)}`}
                    />
                    <MetricBar
                      label={t('charging.heatmap.weekdays', 'Weekdays')}
                      value={insights.weekdayCount}
                      max={barMax}
                      color={chartTokens.series[0]}
                      sublabel={fmtInt(insights.weekdayCount)}
                    />
                    <MetricBar
                      label={t('charging.heatmap.weekends', 'Weekends')}
                      value={insights.weekendCount}
                      max={barMax}
                      color={chartTokens.series[4]}
                      sublabel={fmtInt(insights.weekendCount)}
                    />
                  </div>
                </div>
              )}
            </GlassPanel>
          </div>
        </section>
      </FadeIn>

      {/* ── Breakdowns: top locations + sessions by weekday ── */}
      <FadeIn delay={0.2}>
        <section aria-labelledby="charging-heatmap-breakdowns" className="space-y-4">
          <SectionTitle id="charging-heatmap-breakdowns">
            {t('charging.heatmap.breakdowns', 'Charging Breakdowns')}
          </SectionTitle>
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2 xl:gap-5">
            <GlassPanel className="min-w-0 p-4 sm:p-5">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('charging.heatmap.topLocations', 'Top Charging Locations')}
              </PanelTitle>
              {isLoading ? (
                <Skeleton height={260} />
              ) : isError ? (
                <QueryError error={error} onRetry={() => refetch()} />
              ) : locationData.length === 0 ? (
                /* no-action: transient empty — needs ≥2 sessions at a named place */
                <EmptyState
                  icon={<MapPin className="h-8 w-8" aria-hidden="true" />}
                  message={t('charging.heatmap.noLocations', 'No repeat charging locations yet')}
                />
              ) : (
                <EmbeddedChart
                  title={t('charging.heatmap.topLocations', 'Top Charging Locations')}
                  ariaLabel={t(
                    'charging.heatmap.topLocationsAria',
                    'Charging session counts at the most frequently used locations',
                  )}
                  data={locationData.map(({ name, count }) => ({ name, count }))}
                  dataColumns={[
                    { key: 'name', label: t('charging.heatmap.location', 'Location') },
                    { key: 'count', label: t('charging.heatmap.sessionsWord', 'sessions') },
                  ]}
                  fluid={false}
                  mobileHeight={256}
                  height={288}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={locationData}
                      layout="vertical"
                      margin={{ top: 0, right: 20, left: 10, bottom: 0 }}
                    >
                      {chartGrid}
                      <XAxis type="number" tick={axisTickSm} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={axisTickSm} width={120} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar
                        dataKey="count"
                        fill={chartTokens.series[5]}
                        radius={[0, 4, 4, 0]}
                        name={t('charging.heatmap.sessionsWord', 'sessions')}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </EmbeddedChart>
              )}
            </GlassPanel>

            <GlassPanel className="min-w-0 p-4 sm:p-5">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('charging.heatmap.byDayOfWeek', 'Sessions by Day of Week')}
              </PanelTitle>
              {isLoading ? (
                <Skeleton height={260} />
              ) : isError ? (
                <QueryError error={error} onRetry={() => refetch()} />
              ) : !hasData ? (
                /* no-action: transient empty — resolves once sessions exist in the selected range */
                <EmptyState
                  icon={<BarChart3 className="h-8 w-8" aria-hidden="true" />}
                  message={t('charging.heatmap.noData', 'No charging sessions in this range')}
                />
              ) : (
                <EmbeddedChart
                  title={t('charging.heatmap.byDayOfWeek', 'Sessions by Day of Week')}
                  ariaLabel={t(
                    'charging.heatmap.byDayOfWeekAria',
                    'Charging session counts for each day of the week',
                  )}
                  data={dayOfWeekData.map(({ day, count }) => ({ day, count }))}
                  dataColumns={[
                    { key: 'day', label: t('charging.heatmap.day', 'Day') },
                    { key: 'count', label: t('charging.heatmap.sessionsWord', 'sessions') },
                  ]}
                  fluid={false}
                  mobileHeight={256}
                  height={288}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dayOfWeekData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                      {chartGrid}
                      <XAxis dataKey="day" tick={axisTickSm} />
                      <YAxis tick={axisTickSm} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar
                        dataKey="count"
                        fill={chartTokens.series[0]}
                        radius={[4, 4, 0, 0]}
                        name={t('charging.heatmap.sessionsWord', 'sessions')}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </EmbeddedChart>
              )}
            </GlassPanel>
          </div>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
