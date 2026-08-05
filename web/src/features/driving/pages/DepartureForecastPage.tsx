import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Clock, Sparkles, Thermometer } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip, ChartLegend,
  ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from '@/components/charts';

import { useDrives } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { chartTokens } from '@/lib/tokens';

import { forecastDepartures, weekdayPeaks } from '../lib/departureForecast';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const WEEKDAY_DEFAULTS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function formatClock(ms: number, locale: string): string {
  return new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export default function DepartureForecastPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('departure.title', 'Departure Forecast'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const forecastHidden = useHiddenSeries('departure-forecast-24h');

  const drivesQuery = useDrives(vehicleIdStr);

  const forecast = useMemo(
    () => forecastDepartures(drivesQuery.data ?? [], Date.now()),
    [drivesQuery.data],
  );
  const peaks = useMemo(() => weekdayPeaks(forecast.rates), [forecast.rates]);

  const chartData = useMemo(
    () =>
      forecast.slots.map((s) => ({
        hour: `${String(s.hour).padStart(2, '0')}:00`,
        probability: Math.round(s.p * 1000) / 10,
        cumulative: Math.round(s.cumulative * 1000) / 10,
        isPeak: forecast.peak != null && s.startMs === forecast.peak.startMs,
      })),
    [forecast.slots, forecast.peak],
  );

  // ChartContainer's CSV export only accepts scalar cells, so the boolean
  // peak marker (which drives Cell colouring) is dropped from the export view.
  const exportData = useMemo(
    () => chartData.map(({ isPeak: _isPeak, ...rest }) => rest),
    [chartData],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('departure.title', 'Departure Forecast')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;
  const locale = i18n.language;

  return (
    <PageContainer
      title={t('departure.title', 'Departure Forecast')}
      subtitle={t(
        'departure.subtitle',
        'When you are likely to drive next, and when to start preconditioning',
      )}
      query={drivesQuery}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('departure.kpis', 'Departure forecast metrics')}
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
                label={t('departure.nextLikely', 'Next Likely Departure')}
                value={
                  forecast.nextLikely != null
                    ? formatClock(forecast.nextLikely.startMs, locale)
                    : '—'
                }
                subtitle={
                  forecast.nextLikely != null
                    ? t('departure.inHours', 'in {{count}} h', {
                        count: forecast.nextLikely.offsetH,
                      })
                    : t('departure.noLikely', 'nothing above the threshold')
                }
                icon={<CalendarClock className="h-5 w-5" />}
                color="cyan"
                help={{
                  i18nKey: 'help.departure.nextLikely',
                  defaultValue:
                    'Each weekday-hour gets its own Poisson rate, estimated with a Gamma prior so an hour you have never driven in does not read as "impossible" on thin evidence. The probability of at least one departure in an hour is 1 − e^−λ.',
                }}
              />
              <MetricCard
                label={t('departure.peak', 'Peak Hour')}
                value={
                  forecast.peak != null
                    ? `${Math.round(forecast.peak.p * 100)}%`
                    : '—'
                }
                subtitle={
                  forecast.peak != null
                    ? formatClock(forecast.peak.startMs, locale)
                    : undefined
                }
                icon={<Clock className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('departure.precondition', 'Precondition At')}
                value={
                  forecast.preconditionAtMs != null
                    ? formatClock(forecast.preconditionAtMs, locale)
                    : '—'
                }
                subtitle={t('departure.preconditionHint', 'ahead of the peak hour')}
                icon={<Thermometer className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('departure.confidence', 'Model Confidence')}
                value={`${Math.round(forecast.confidence * 100)}%`}
                subtitle={t('departure.evidence', '{{drives}} drives over {{weeks}} weeks', {
                  drives: forecast.totalDepartures,
                  weeks: Math.round(forecast.observedWeeks),
                })}
                icon={<Sparkles className="h-5 w-5" />}
                color={forecast.confidence >= 0.6 ? 'green' : 'blue'}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Next 24 hours */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && forecast.totalDepartures === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: the forecast trains itself on recorded drives and appears once any exist. */
              icon={<CalendarClock className="h-8 w-8" />}
              message={t(
                'departure.noData',
                'No drives recorded yet, so there is no departure pattern to learn from.',
              )}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('departure.chart', 'Departure Probability — Next 24 Hours')}
            subtitle={t(
              'departure.chartHint',
              'Bars are the chance of leaving within each hour; the line is the cumulative chance of having left by then',
            )}
            ariaLabel={t(
              'departure.chart.aria',
              'Hourly departure probability bars with a cumulative probability line over the next 24 hours',
            )}
            chartKey="departure-forecast-24h"
            loading={isLoading}
            empty={chartData.length === 0}
            height={340}
            data={exportData}
            dataColumns={[
              { key: 'hour', label: t('departure.col.hour', 'Hour') },
              { key: 'probability', label: t('departure.col.p', 'Probability (%)') },
              { key: 'cumulative', label: t('departure.col.cumulative', 'Cumulative (%)') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="hour" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval={1} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} domain={[0, 100]} unit="%" />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={forecastHidden} />
                <Bar
                  dataKey="probability"
                  name={t('departure.hourly', 'This hour')}
                  radius={[3, 3, 0, 0]}
                  hide={forecastHidden.isHidden('probability')}
                >
                  {chartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.isPeak ? chartTokens.series[3] : chartTokens.series[0]}
                      fillOpacity={d.isPeak ? 1 : 0.7}
                    />
                  ))}
                </Bar>
                <Line
                  type="monotone"
                  dataKey="cumulative"
                  name={t('departure.cumulative', 'By this hour')}
                  stroke={chartTokens.series[2]}
                  strokeWidth={2}
                  dot={false}
                  hide={forecastHidden.isHidden('cumulative')}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Weekly rhythm */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('departure.weekly', 'Weekly Rhythm')}
            <HelpTooltip
              size="sm"
              i18nKey="help.departure.weekly"
              defaultValue="Each weekday's busiest hour, taken from the fitted Poisson intensities rather than raw counts — so a single early-morning airport run on one Tuesday cannot masquerade as a routine."
              ariaLabel={t('help.departure.iconLabel', 'More info about the weekly rhythm')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={140} />
          ) : peaks.length === 0 ? (
            <EmptyState /* no-action: per-weekday peaks emerge automatically as drives accumulate. */
              icon={<Clock className="h-8 w-8" />}
              message={t(
                'departure.noPattern',
                'No weekday pattern has emerged yet — a few weeks of driving will reveal one.',
              )}
            />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {peaks.map((p) => (
                <li
                  key={p.weekday}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <Text variant="bodySm">
                    {t(`departure.weekday.${WEEKDAY_KEYS[p.weekday]}`, WEEKDAY_DEFAULTS[p.weekday])}
                  </Text>
                  <div className="flex items-center gap-2">
                    <Text variant="caption">
                      {String(p.hour).padStart(2, '0')}:00
                    </Text>
                    <Badge variant={p.p >= 0.5 ? 'success' : p.p >= 0.25 ? 'info' : 'neutral'}>
                      {Math.round(p.p * 100)}%
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
