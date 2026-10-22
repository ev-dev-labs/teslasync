import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity, BarChart3, CalendarClock, MapPin, RefreshCw,
} from 'lucide-react';

import { PageLayout, CardGrid, LayoutCard } from '@/components/layout';
import { Accordion, Button, SectionTitle, Table, Text, Caption } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ChartTooltip, EmbeddedChart, chartGrid, axisTickSm,
} from '@/components/charts';


import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';

import { formatTime, formatWeekdayName } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';

import {
  HeatmapGrid,
  buildGrid,
  aggregateLocations,
  aggregateByDayOfWeek,
  deriveInsights,
} from '../components/charging-heatmap';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { ChargingHeatmapSummary } from '../components/charging-heatmap-modernization';

export default function ChargingHeatmapPage() {
  const { fmtInt, locale } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('charging.heatmap.title', 'Charging Patterns'));

  // The header VehiclePicker is the source of truth for the active vehicle.
  const { vehicleId: selectedVehicleId, vehiclesState } = useSelectedVehicle();
  const vehicleId = selectedVehicleId != null && Number.isSafeInteger(selectedVehicleId) && selectedVehicleId > 0
    ? selectedVehicleId : null;
  const { startInstant, endInstantExclusive } = useRangeState({
    persistKey: 'charging-heatmap.range',
    defaultPresetId: 'all',
  });

  const query = useChargingSessionsPaginated(vehicleId, {
    limit: 2000,
    start: startInstant,
    end: endInstantExclusive,
  });
  const refetch = useCallback(async () => {
    if (vehicleId == null) throw new Error('Vehicle scope has not resolved');
    return query.refetch();
  }, [vehicleId, query.refetch]);
  const scopedQuery = vehicleId != null
    ? { ...query, refetch }
    : { data: undefined, refetch: undefined };
  const state = useDataState(scopedQuery, { provenance: 'historical' });
  // Background errors/pauses must not replace a previously loaded calendar.
  const isLoading = !state.hasData && (vehicleId != null
    ? query.isLoading
    : vehiclesState?.status === 'initial' && !vehiclesState.isRefreshBlocked);
  const isError = state.fatalError != null;
  const error = state.fatalError;
  const sessions = state.data ?? [];
  const hasData = sessions.length > 0;

  const { formatEnergy } = useUnits();
  // Labels describe browser-local bucket identities, not real instants to
  // convert into another timezone. UTC reference dates keep them stable.
  const dayLabels = useMemo(() => {
    return Array.from({ length: 7 }, (_, day) => formatWeekdayName(new Date(Date.UTC(2024, 0, 7 + day)), { locale, tz: 'UTC' }));
  }, [locale]);
  const fullDayLabels = useMemo(() => {
    return Array.from({ length: 7 }, (_, day) => formatWeekdayName(new Date(Date.UTC(2024, 0, 7 + day)), { locale, tz: 'UTC', weekdayStyle: 'long' }));
  }, [locale]);
  const hourLabels = useMemo(() => Array.from({ length: 24 }, (_, hour) =>
    formatTime(new Date(Date.UTC(2024, 0, 7, hour)), { locale, tz: 'UTC' }),
  ), [locale]);

  const model = useMemo(() => buildGrid(sessions), [sessions]);
  const insights = useMemo(() => deriveInsights(model), [model]);
  const dayOfWeekData = useMemo(() => aggregateByDayOfWeek(model, dayLabels), [model, dayLabels]);
  const locationData = useMemo(
    () => aggregateLocations(sessions, t('charging.heatmap.unknownPlace', 'Unknown')),
    [sessions, t],
  );
  const loadedScope = t('charging.heatmap.loadedScope', 'Summary of the returned sessions for the shared vehicle and date scope (request limit: 2,000). This is not a complete-history total.');
  const slotData = useMemo(() => {
    // Match the existing browser-local buckets without treating missing Wh as
    // a measured zero in the keyboard/touch/export alternative.
    const recorded = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const energy = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    for (const session of sessions) {
      if (!session.started_at) continue;
      const started = new Date(session.started_at);
      if (Number.isNaN(started.getTime())) continue;
      if (session.total_energy_added_wh != null && Number.isFinite(session.total_energy_added_wh)) {
        recorded[started.getDay()][started.getHours()] += 1;
        energy[started.getDay()][started.getHours()] += session.total_energy_added_wh;
      }
    }
    return model.grid.flatMap((row, day) => row.map((cell, hour) => ({
      dayIndex: day,
      hourIndex: hour,
      day: dayLabels[day],
      hour: hourLabels[hour],
      count: cell.count,
      energy_wh: recorded[day][hour] > 0 ? energy[day][hour] : null,
      recorded_energy_count: recorded[day][hour],
      energyStatus: cell.count === 0
        ? t('common.noReading', 'No reading')
        : recorded[day][hour] === 0
          ? t('charging.heatmap.noMeasurements', 'No recorded measurements in the returned sessions')
          : recorded[day][hour] < cell.count
            ? t('charging.heatmap.partialMeasurements', 'Some returned sessions have no recorded value; the total includes recorded values only.')
            : '',
    })));
  }, [model, sessions, t, dayLabels, hourLabels]);
  const slotColumns = [
    { key: 'day', label: t('charging.heatmap.day', 'Day') },
    { key: 'hour', label: t('chart.col.time', 'Time') },
    { key: 'count', label: t('charging.heatmap.sessionsWord', 'sessions'), kind: 'count' as const },
    {
      key: 'energy_wh', label: t('charging.heatmap.totalEnergy', 'Total Energy'),
      format: (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) ? formatEnergy(value) : '—',
    },
    { key: 'energyStatus', label: t('common.status', 'Status') },
  ];

  const stats = useMemo(() => {
    if (sessions.length === 0) return null;
    let totalEnergyWh = 0;
    let totalCost = 0;
    let totalDurationS = 0;
    let durationCount = 0;
    let energyCount = 0;
    let costCount = 0;
    for (const s of sessions) {
      if (typeof s.total_energy_added_wh === 'number' && Number.isFinite(s.total_energy_added_wh)) {
        totalEnergyWh += s.total_energy_added_wh;
        energyCount += 1;
      }
      if (typeof s.cost_decimal === 'number' && Number.isFinite(s.cost_decimal)) {
        totalCost += s.cost_decimal;
        costCount += 1;
      }
      const started = s.started_at ? new Date(s.started_at).getTime() : Number.NaN;
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
      energyCount,
      costCount,
      durationCount,
      // Average only over sessions that actually have a measured duration —
      // live (unfinished) or timestamp-less sessions must not dilute the mean.
      avgDurationS: durationCount > 0 ? totalDurationS / durationCount : 0,
    };
  }, [sessions]);

  const barMax = Math.max(stats?.count ?? 0, 1);

  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
      <Button
        variant="ghost"
        onClick={() => refetch()}
        disabled={vehicleId == null}
        aria-label={t('common.refresh', 'Refresh')}
        className="h-11 w-11"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <PageLayout
      title={t('charging.heatmap.title', 'Charging Patterns')}
      subtitle={t('charging.heatmap.subtitle', 'When and where you charge')}
      secondaryActions={actions}
      query={vehicleId != null ? { ...query, refetch } : undefined}
    >
      {vehiclesState && (
        <StaleRefreshWarning state={vehiclesState} label={t('nav.vehicles', 'Fleet')} />
      )}
      {vehiclesState?.fatalError && (
        <QueryError
          error={vehiclesState.fatalError}
          onRetry={vehiclesState.retry ?? undefined}
          resourceName={t('nav.vehicles', 'Fleet')}
        />
      )}
      {vehicleId == null && vehiclesState?.hasData && (
        <EmptyState
          title={t('common.noVehicleSelected.title', 'No vehicle selected')}
          message={t('common.noVehicleSelected.desc', 'Add a vehicle to your fleet to see data on this page.')}
          actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
        />
      )}
      <StaleRefreshWarning state={state} label={t('charging.heatmap.title', 'Charging Patterns')} />
      {!state.hasData && (state.isRefreshBlocked || (vehicleId == null && vehiclesState?.isRefreshBlocked)) && (
        <AlertBanner variant="warning" role="status">
          {t('charging.heatmap.loadPaused', 'Loading is paused. Charging history will appear when the connection resumes.')}
        </AlertBanner>
      )}
      <Text variant="bodySm" className="min-w-0 break-words">
        {loadedScope}
      </Text>
      {/* ── KPI band ── */}
      <FadeIn>
        <section
          aria-label={t('charging.heatmap.kpis', 'Charging summary')}
          className="min-w-0"
        >
          <ChargingHeatmapSummary
            stats={stats}
            state={state}
            loading={isLoading}
          />
        </section>
      </FadeIn>

      {/* ── Hero: weekly heatmap + insights side panel ── */}
      <FadeIn delay={0.1}>
        <section aria-labelledby="charging-heatmap-when" className="space-y-4">
          <SectionTitle id="charging-heatmap-when">
            {t('charging.heatmap.whenSection', 'When You Charge')}
          </SectionTitle>
          <CardGrid
            label={t('charging.heatmap.whenSection', 'When You Charge')}
            items={[
              { id: 'charging-heatmap-weekly', size: 'half', content: (
            <LayoutCard title={t('charging.heatmap.gridTitle', 'Weekly Charging Heatmap')}>
              {isLoading ? (
                <Skeleton height={260} />
              ) : isError ? (
                <QueryError error={error} onRetry={() => refetch()} />
              ) : !hasData ? (
                /* no-action: transient empty — resolves once sessions exist in the selected range */
                <EmptyState
                  icon={<CalendarClock className="h-8 w-8" aria-hidden="true" />}
                  message={state.hasData
                    ? t('charging.heatmap.noData', 'No charging sessions in this range')
                    : t('charging.heatmap.historyNotLoaded', 'Charging history has not loaded')}
                />
              ) : (
                <>
                  <EmbeddedChart
                    title={t('charging.heatmap.gridTitle', 'Weekly Charging Heatmap')}
                    ariaLabel={t('charging.heatmap.gridAria', 'Charging sessions by weekday and hour of day')}
                    ariaDescription={loadedScope}
                    data={slotData}
                    dataColumns={slotColumns}
                    exportData={slotData}
                    exportable
                    fullscreen
                    fluid={false}
                    height={300}
                    mobileHeight={300}
                  >
                    <HeatmapGrid model={model} energySlots={slotData} formatEnergy={formatEnergy} framed />
                  </EmbeddedChart>
                  <Accordion
                    title={t('chart.a11y.fallbackTableLabel', '{{title}} — data table', {
                      title: t('charging.heatmap.gridTitle', 'Weekly Charging Heatmap'),
                    })}
                    description={loadedScope}
                    className="mt-4"
                    headerClassName="min-h-11 px-3 py-3"
                    bodyClassName="p-3"
                  >
                    <div
                      role="region"
                      aria-label={t('charging.heatmap.gridAria', 'Charging sessions by weekday and hour of day')}
                      className="max-h-96 min-w-0 overflow-auto rounded-panel"
                    >
                      <Table
                        variant="embedded"
                        tabIndex={0}
                        aria-label={t('charging.heatmap.gridAria', 'Charging sessions by weekday and hour of day')}
                        className="focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                      >
                        <thead>
                          <tr>
                            {slotColumns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {slotData.map((slot) => (
                            <tr key={`${slot.dayIndex}-${slot.hourIndex}`}>
                              <th scope="row">{slot.day} {slot.hour}</th>
                              <td>{slot.hour}</td>
                              <td>{fmtInt(slot.count)}</td>
                              <td>{slot.energy_wh != null ? formatEnergy(slot.energy_wh) : '—'}</td>
                              <td><Text variant="bodySm">{slot.energyStatus}</Text></td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  </Accordion>
                </>
              )}
            </LayoutCard>
              ) },

              { id: 'charging-heatmap-insights', size: 'third', content: (
            <LayoutCard title={t('charging.heatmap.insights', 'Charging Insights')}>
              {isLoading ? (
                <Skeleton height={220} />
              ) : isError ? (
                <QueryError error={error} onRetry={() => refetch()} />
              ) : !hasData ? (
                /* no-action: transient empty — insights derive from charging history */
                <EmptyState
                  icon={<Activity className="h-8 w-8" aria-hidden="true" />}
                  message={state.hasData
                    ? t('charging.heatmap.noInsights', 'Insights appear once you have charging history')
                    : t('charging.heatmap.historyNotLoaded', 'Charging history has not loaded')}
                />
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
                    <Caption>{t('charging.heatmap.favorite', 'Favorite Charging Time')}</Caption>
                    <Text as="p" size="sm" weight="semibold" color="primary" className="mt-1">
                      {model.maxCount > 0
                        ? t('charging.heatmap.favoriteValue', '{{day}} at {{hour}}', {
                            day: fullDayLabels[model.favDay],
                            hour: hourLabels[model.favHour],
                          })
                        : '—'}
                    </Text>
                    <Caption>
                      {t('charging.heatmap.favoriteSessions', '{{formattedCount}} sessions', {
                        count: model.maxCount,
                        formattedCount: fmtInt(model.maxCount),
                      })}
                    </Caption>
                  </div>

                  <div className="space-y-3">
                    <MetricBar
                      label={t('charging.heatmap.busiestDay', 'Busiest Day')}
                      value={insights.busiestDayCount}
                      max={barMax}
                      color={chartTokens.series[5]}
                      fill="solid"
                      sublabel={`${dayLabels[insights.busiestDay]} · ${fmtInt(insights.busiestDayCount)}`}
                    />
                    <MetricBar
                      label={t('charging.heatmap.busiestHour', 'Busiest Hour')}
                      value={insights.busiestHourCount}
                      max={barMax}
                      color={chartTokens.series[1]}
                      fill="solid"
                      sublabel={`${hourLabels[insights.busiestHour]} · ${fmtInt(insights.busiestHourCount)}`}
                    />
                    <MetricBar
                      label={t('charging.heatmap.weekdays', 'Weekdays')}
                      value={insights.weekdayCount}
                      max={barMax}
                      color={chartTokens.series[0]}
                      fill="solid"
                      sublabel={fmtInt(insights.weekdayCount)}
                    />
                    <MetricBar
                      label={t('charging.heatmap.weekends', 'Weekends')}
                      value={insights.weekendCount}
                      max={barMax}
                      color={chartTokens.series[4]}
                      fill="solid"
                      sublabel={fmtInt(insights.weekendCount)}
                    />
                  </div>
                </div>
              )}
            </LayoutCard>
              ) },
            ]}
          />
        </section>
      </FadeIn>

      {/* ── Breakdowns: top locations + sessions by weekday ── */}
      <FadeIn delay={0.2}>
        <section aria-labelledby="charging-heatmap-breakdowns" className="space-y-4">
          <SectionTitle id="charging-heatmap-breakdowns">
            {t('charging.heatmap.breakdowns', 'Charging Breakdowns')}
          </SectionTitle>
          <CardGrid
            label={t('charging.heatmap.breakdowns', 'Charging Breakdowns')}
            items={[
              { id: 'charging-heatmap-locations', size: 'half', content: (
            <LayoutCard title={t('charging.heatmap.topLocations', 'Top Charging Locations')}>
              {isLoading ? (
                <Skeleton height={260} />
              ) : isError ? (
                <QueryError error={error} onRetry={() => refetch()} />
              ) : locationData.length === 0 ? (
                /* no-action: transient empty — needs ≥2 sessions at a named place */
                <EmptyState
                  icon={<MapPin className="h-8 w-8" aria-hidden="true" />}
                  message={state.hasData
                    ? t('charging.heatmap.noLocations', 'No repeat charging locations yet')
                    : t('charging.heatmap.historyNotLoaded', 'Charging history has not loaded')}
                />
              ) : (
                <EmbeddedChart
                  title={t('charging.heatmap.topLocations', 'Top Charging Locations')}
                  ariaLabel={t(
                    'charging.heatmap.topLocationsAria',
                    'Charging session counts at the most frequently used locations',
                  )}
                  data={locationData.map(({ name, count }) => ({ name, count }))}
                  exportData={locationData.map(({ name, count }) => ({ name, count }))}
                  exportable
                  fullscreen
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
            </LayoutCard>
              ) },

              { id: 'charging-heatmap-weekdays', size: 'half', content: (
            <LayoutCard title={t('charging.heatmap.byDayOfWeek', 'Sessions by Day of Week')}>
              {isLoading ? (
                <Skeleton height={260} />
              ) : isError ? (
                <QueryError error={error} onRetry={() => refetch()} />
              ) : !hasData ? (
                /* no-action: transient empty — resolves once sessions exist in the selected range */
                <EmptyState
                  icon={<BarChart3 className="h-8 w-8" aria-hidden="true" />}
                  message={state.hasData
                    ? t('charging.heatmap.noData', 'No charging sessions in this range')
                    : t('charging.heatmap.historyNotLoaded', 'Charging history has not loaded')}
                />
              ) : (
                <EmbeddedChart
                  title={t('charging.heatmap.byDayOfWeek', 'Sessions by Day of Week')}
                  ariaLabel={t(
                    'charging.heatmap.byDayOfWeekAria',
                    'Charging session counts for each day of the week',
                  )}
                  data={dayOfWeekData.map(({ day, count }) => ({ day, count }))}
                  exportData={dayOfWeekData.map(({ day, count }) => ({ day, count }))}
                  exportable
                  fullscreen
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
            </LayoutCard>
              ) },
            ]}
          />
        </section>
      </FadeIn>
    </PageLayout>
  );
}
