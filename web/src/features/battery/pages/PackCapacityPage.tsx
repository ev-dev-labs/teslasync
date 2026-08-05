import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, BatteryCharging, Gauge, TrendingDown } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
  ComposedChart, Line, Area, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';

import { useChargingSessions } from '@/api/hooks/useCharging';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';

import { summarizePackCapacity } from '../lib/packCapacity';

export default function PackCapacityPage() {
  const { t } = useTranslation();
  usePageTitle(t('packCapacity.title', 'Pack Capacity'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatEnergy } = useUnits();

  const sessionsQuery = useChargingSessions(vehicleIdStr);

  const summary = useMemo(
    () => summarizePackCapacity(sessionsQuery.data ?? []),
    [sessionsQuery.data],
  );

  // The filtered estimate with its ±1σ credible band, plus the raw
  // measurements so the reader can see how noisy the underlying data is.
  const chartData = useMemo(
    () =>
      summary.states.map((s) => ({
        date: formatDateShort(s.ts),
        filtered: Math.round(s.capacityWh / 100) / 10,
        observed: Math.round(s.observedWh / 100) / 10,
        band: [
          Math.round((s.capacityWh - s.sigmaWh) / 100) / 10,
          Math.round((s.capacityWh + s.sigmaWh) / 100) / 10,
        ] as [number, number],
      })),
    [summary.states],
  );

  // The ±1σ band is a tuple, which the CSV exporter cannot represent; it is
  // flattened into explicit low/high columns for the download view.
  const exportData = useMemo(
    () =>
      chartData.map(({ band, ...rest }) => ({
        ...rest,
        bandLow: band[0],
        bandHigh: band[1],
      })),
    [chartData],
  );

  const rejectedTotal =
    summary.rejected.narrowWindow +
    summary.rejected.missingEnergy +
    summary.rejected.missingSoc +
    summary.rejected.badTimestamp;

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('packCapacity.title', 'Pack Capacity')} />;
  }

  const isLoading = sessionsQuery.isLoading;
  const isError = sessionsQuery.isError;

  return (
    <PageContainer
      title={t('packCapacity.title', 'Pack Capacity')}
      subtitle={t(
        'packCapacity.subtitle',
        'A Kalman-filtered estimate of usable pack capacity, learned from every charge',
      )}
      query={sessionsQuery}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('packCapacity.kpis', 'Pack capacity metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={sessionsQuery.error} onRetry={() => sessionsQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('packCapacity.current', 'Usable Capacity')}
                value={summary.currentWh != null ? formatEnergy(summary.currentWh) : '—'}
                subtitle={
                  summary.currentSigmaWh != null
                    ? t('packCapacity.sigma', '±{{value}} (1σ)', {
                        value: formatEnergy(summary.currentSigmaWh),
                      })
                    : undefined
                }
                icon={<BatteryCharging className="h-5 w-5" />}
                color="cyan"
                help={{
                  i18nKey: 'help.packCapacity.current',
                  defaultValue:
                    'Each charge session implies a capacity (energy added ÷ SoC gained). Those estimates are individually terrible — Tesla reports whole-number SoC, so a 10 % top-up carries huge quantisation error. A Kalman filter weights every session by its own measurement uncertainty and folds them into one running estimate.',
                }}
              />
              <MetricCard
                label={t('packCapacity.soh', 'State of Health')}
                value={
                  summary.stateOfHealth != null
                    ? `${Math.round(summary.stateOfHealth * 1000) / 10}%`
                    : '—'
                }
                subtitle={
                  summary.peakWh != null
                    ? t('packCapacity.vsPeak', 'vs. peak {{value}}', {
                        value: formatEnergy(summary.peakWh),
                      })
                    : undefined
                }
                icon={<Gauge className="h-5 w-5" />}
                color={
                  summary.stateOfHealth == null
                    ? 'blue'
                    : summary.stateOfHealth >= 0.92
                      ? 'green'
                      : summary.stateOfHealth >= 0.85
                        ? 'amber'
                        : 'red'
                }
              />
              <MetricCard
                label={t('packCapacity.fade', 'Annual Fade')}
                value={
                  summary.fadeSharePerYear != null
                    ? `${Math.round(summary.fadeSharePerYear * 1000) / 10}%`
                    : '—'
                }
                subtitle={
                  summary.fadeWhPerYear != null
                    ? t('packCapacity.fadeAbs', '{{value}} per year', {
                        value: formatEnergy(Math.abs(summary.fadeWhPerYear)),
                      })
                    : t('packCapacity.fadeHold', 'needs 30+ days of history')
                }
                icon={<TrendingDown className="h-5 w-5" />}
                color={
                  summary.fadeSharePerYear == null
                    ? 'blue'
                    : summary.fadeSharePerYear > 0.03
                      ? 'red'
                      : 'green'
                }
              />
              <MetricCard
                label={t('packCapacity.sessions', 'Sessions Used')}
                value={summary.observations.length || '—'}
                subtitle={t('packCapacity.span', 'over {{count}} days', {
                  count: Math.round(summary.spanDays),
                })}
                icon={<Activity className="h-5 w-5" />}
                color="purple"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Filtered capacity with credible band */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && summary.states.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: the filter needs charge sessions with a wide SoC window; they accrue automatically. */
              icon={<BatteryCharging className="h-8 w-8" />}
              message={t(
                'packCapacity.noData',
                'No charge session has spanned enough SoC to imply a capacity yet. Longer charges — 20 % to 80 % rather than brief top-ups — produce usable estimates.',
              )}
            />
          </GlassPanel>
        ) : (
          // chart-legend-audit:skip the ±1σ band is only meaningful drawn behind the filtered line; hiding either alone misrepresents the estimate
          <ChartContainer
            title={t('packCapacity.chart', 'Capacity Estimate Over Time')}
            subtitle={t(
              'packCapacity.chartHint',
              'Dots are raw per-session estimates; the line is the filtered belief and the shaded band its ±1σ uncertainty',
            )}
            ariaLabel={t(
              'packCapacity.chart.aria',
              'Kalman-filtered pack capacity over time with an uncertainty band and raw per-session observations',
            )}
            loading={isLoading}
            empty={chartData.length === 0}
            height={360}
            data={exportData}
            dataColumns={[
              { key: 'date', label: t('packCapacity.col.date', 'Date') },
              { key: 'filtered', label: t('packCapacity.col.filtered', 'Filtered (kWh)') },
              { key: 'observed', label: t('packCapacity.col.observed', 'Observed (kWh)') },
              { key: 'bandLow', label: t('packCapacity.col.bandLow', 'σ low (kWh)') },
              { key: 'bandHigh', label: t('packCapacity.col.bandHigh', 'σ high (kWh)') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  domain={['auto', 'auto']}
                  unit=" kWh"
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area
                  type="monotone"
                  dataKey="band"
                  name={t('packCapacity.band', 'Uncertainty')}
                  stroke="none"
                  fill={chartTokens.series[0]}
                  fillOpacity={0.15}
                />
                <Scatter
                  dataKey="observed"
                  name={t('packCapacity.observed', 'Per-session estimate')}
                  fill={chartTokens.series[4]}
                  fillOpacity={0.55}
                />
                <Line
                  type="monotone"
                  dataKey="filtered"
                  name={t('packCapacity.filtered', 'Filtered estimate')}
                  stroke={chartTokens.series[0]}
                  strokeWidth={2.5}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Session ledger */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('packCapacity.ledger', 'Measurement Ledger')}
            <HelpTooltip
              size="sm"
              i18nKey="help.packCapacity.ledger"
              defaultValue="The Kalman gain shows how much each session was trusted. A wide SoC window on an accurate meter earns a high gain and moves the estimate; a 3 % top-up earns almost none. Process noise grows with the gap since the previous session, so the filter stays responsive after a long silence."
              ariaLabel={t('help.packCapacity.iconLabel', 'More info about the measurement ledger')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={140} />
          ) : summary.observations.length === 0 ? (
            <EmptyState /* no-action: entries appear as qualifying charge sessions are recorded. */
              icon={<Activity className="h-8 w-8" />}
              message={t(
                'packCapacity.noSessions',
                'No qualifying sessions yet. {{count}} were examined and set aside.',
                { count: rejectedTotal },
              )}
            />
          ) : (
            <>
              <ul className="space-y-2">
                {[...summary.states]
                  .reverse()
                  .slice(0, 12)
                  .map((s, i) => (
                    <li
                      key={`${s.tsMs}-${i}`}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                    >
                      <Badge variant={s.gain >= 0.3 ? 'success' : s.gain >= 0.1 ? 'info' : 'neutral'}>
                        {t('packCapacity.gain', 'gain {{value}}', {
                          value: Math.round(s.gain * 100) / 100,
                        })}
                      </Badge>
                      <Text variant="bodySm">
                        {t(
                          'packCapacity.ledgerLine',
                          '{{date}}: measured {{observed}}, estimate now {{filtered}}',
                          {
                            date: formatDateShort(s.ts),
                            observed: formatEnergy(s.observedWh),
                            filtered: formatEnergy(s.capacityWh),
                          },
                        )}
                      </Text>
                      <Badge variant="neutral">
                        {t('packCapacity.sigmaBadge', '±{{value}}', {
                          value: formatEnergy(s.sigmaWh),
                        })}
                      </Badge>
                    </li>
                  ))}
              </ul>
              {rejectedTotal > 0 && (
                <Text variant="caption" as="p" className="mt-3">
                  {t(
                    'packCapacity.rejected',
                    '{{total}} sessions set aside: {{narrow}} too narrow, {{energy}} missing energy, {{soc}} missing SoC, {{ts}} bad timestamp.',
                    {
                      total: rejectedTotal,
                      narrow: summary.rejected.narrowWindow,
                      energy: summary.rejected.missingEnergy,
                      soc: summary.rejected.missingSoc,
                      ts: summary.rejected.badTimestamp,
                    },
                  )}
                </Text>
              )}
            </>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
