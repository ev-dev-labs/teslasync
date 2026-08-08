import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, MapPin, Plug, Zap } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
  BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from '@/components/charts';

import { useChargingSessions } from '@/api/hooks/useCharging';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { chartTokens } from '@/lib/tokens';
import { formatDateShort } from '@/lib/dateFormat';

import { analyzeChargerHealth, type SiteStatus } from '../lib/chargerHealth';

const STATUS_BADGE: Record<SiteStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  healthy: 'success',
  degrading: 'warning',
  degraded: 'danger',
  unknown: 'neutral',
};

const STATUS_DEFAULT: Record<SiteStatus, string> = {
  healthy: 'Healthy',
  degrading: 'Slipping',
  degraded: 'Degraded',
  unknown: 'Not enough data',
};

export default function ChargerHealthPage() {
  const { t } = useTranslation();
  usePageTitle(t('chargerHealth.title', 'Charger Health'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatPower, formatEnergy } = useUnits();

  const sessionsQuery = useChargingSessions(vehicleIdStr);

  const summary = useMemo(
    () => analyzeChargerHealth(sessionsQuery.data ?? []),
    [sessionsQuery.data],
  );

  const chartData = useMemo(
    () =>
      summary.sites
        .filter((s) => s.status !== 'unknown')
        .map((s) => ({
          site: s.label.length > 22 ? `${s.label.slice(0, 21)}…` : s.label,
          ratio: Math.round(s.performanceRatio * 1000) / 10,
          baseline: Math.round(s.baselineW / 100) / 10,
          recent: Math.round(s.recentW / 100) / 10,
          status: s.status,
        })),
    [summary.sites],
  );

  const exportData = useMemo(
    () => chartData.map(({ status, ...rest }) => ({ ...rest, status: String(status) })),
    [chartData],
  );

  const totalHoursLost = useMemo(
    () => summary.sites.reduce((sum, s) => sum + s.hoursLostPerYear, 0),
    [summary.sites],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('chargerHealth.title', 'Charger Health')} />;
  }

  const isLoading = sessionsQuery.isLoading;
  const isError = sessionsQuery.isError;

  return (
    <PageContainer
      title={t('chargerHealth.title', 'Charger Health')}
      subtitle={t(
        'chargerHealth.subtitle',
        'Every charging location benchmarked against its own best behaviour, so a stall that has quietly slowed down cannot hide',
      )}
      query={sessionsQuery}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('chargerHealth.kpis', 'Charger health metrics')}
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
                label={t('chargerHealth.sites', 'Locations Tracked')}
                value={summary.sites.length}
                subtitle={t('chargerHealth.sessionsHint', '{{n}} scorable sessions', {
                  n: summary.usableSessions,
                })}
                icon={<MapPin className="h-5 w-5" />}
                color="cyan"
                help={{
                  i18nKey: 'help.chargerHealth.sites',
                  defaultValue:
                    'Each location is judged only against itself. Comparing a home wall box to a Supercharger would be meaningless, so instead every site establishes its own demonstrated ceiling from its cleanest past sessions, and recent sessions are measured against that. Sessions that sat mostly above the taper threshold are excluded, because a slow charge from 80 % is physics, not a fault.',
                }}
              />
              <MetricCard
                label={t('chargerHealth.degraded', 'Underperforming')}
                value={summary.degradedCount}
                subtitle={t('chargerHealth.degradedHint', 'sites below their own baseline')}
                icon={<Activity className="h-5 w-5" />}
                color={summary.degradedCount > 0 ? 'red' : 'green'}
              />
              <MetricCard
                label={t('chargerHealth.fastest', 'Fastest Site')}
                value={
                  summary.fastestSite != null
                    ? formatPower(summary.fastestSite.baselineW, { precision: 0 })
                    : '—'
                }
                subtitle={summary.fastestSite?.label ?? t('chargerHealth.none', 'None yet')}
                icon={<Zap className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('chargerHealth.timeLost', 'Time Lost per Year')}
                value={totalHoursLost > 0 ? `${Math.round(totalHoursLost)} h` : '0 h'}
                subtitle={t('chargerHealth.timeLostHint', 'extra plugged-in hours from shortfall')}
                icon={<Plug className="h-5 w-5" />}
                color={totalHoursLost > 0 ? 'amber' : 'green'}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Performance against own baseline */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && summary.sites.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: sites are discovered from charge history as it accumulates. */
              icon={<Plug className="h-8 w-8" />}
              message={t(
                'chargerHealth.noData',
                'No charging location has enough clean sessions to benchmark yet. A few full-power charges at the same place is all it takes.',
              )}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('chargerHealth.chart', 'Recent Power vs. Own Baseline')}
            subtitle={t(
              'chargerHealth.chartHint',
              '100 % means the site is still delivering everything it once did',
            )}
            ariaLabel={t(
              'chargerHealth.chart.aria',
              'Bar chart of each charging site recent power as a percentage of its own demonstrated baseline',
            )}
            loading={isLoading}
            empty={chartData.length === 0}
            height={340}
            data={exportData}
            dataColumns={[
              { key: 'site', label: t('chargerHealth.col.site', 'Site') },
              { key: 'ratio', label: t('chargerHealth.col.ratio', 'Performance (%)') },
              { key: 'baseline', label: t('chargerHealth.col.baseline', 'Baseline (kW)') },
              { key: 'recent', label: t('chargerHealth.col.recent', 'Recent (kW)') },
              { key: 'status', label: t('chargerHealth.col.status', 'Status') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 16, right: 16, bottom: 42, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis
                  dataKey="site"
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                  angle={-30}
                  textAnchor="end"
                  height={64}
                />
                <YAxis
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  domain={[0, 110]}
                  unit="%"
                />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine
                  y={100}
                  stroke={chartTokens.series[2]}
                  strokeDasharray="4 4"
                  label={{
                    value: t('chargerHealth.baseline', 'Baseline'),
                    position: 'right',
                    fill: 'var(--text-muted)',
                    fontSize: 11,
                  }}
                />
                <Bar
                  dataKey="ratio"
                  name={t('chargerHealth.col.ratio', 'Performance (%)')}
                  radius={[3, 3, 0, 0]}
                >
                  {chartData.map((d) => (
                    <Cell
                      key={d.site}
                      fill={
                        d.status === 'healthy'
                          ? chartTokens.series[2]
                          : d.status === 'degrading'
                            ? chartTokens.series[3]
                            : chartTokens.series[5]
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Site detail */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('chargerHealth.detail', 'Locations')}
            <HelpTooltip
              size="sm"
              i18nKey="help.chargerHealth.detail"
              defaultValue="Sites are grouped by place name where one is known, and otherwise by a rounded coordinate cell, so the same physical stall is recognised across visits even when the reported address wobbles slightly. AC and DC are labelled separately because their expected power differs by an order of magnitude."
              ariaLabel={t('help.chargerHealth.iconLabel', 'More info about site grouping')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={180} />
          ) : summary.sites.length === 0 ? (
            <EmptyState /* no-action: locations appear as charge sessions are recorded. */
              icon={<MapPin className="h-8 w-8" />}
              message={t(
                'chargerHealth.noSites',
                'No charging locations recorded yet.',
              )}
            />
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {summary.sites.map((s) => (
                <li
                  key={s.key}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Text variant="body" className="font-medium">{s.label}</Text>
                    <Badge variant={STATUS_BADGE[s.status]}>
                      {t(`chargerHealth.status.${s.status}`, STATUS_DEFAULT[s.status])}
                    </Badge>
                    <Badge variant="neutral" size="sm">
                      {s.kind === 'dc'
                        ? t('chargerHealth.dc', 'DC')
                        : t('chargerHealth.ac', 'AC')}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                    <Text variant="caption">
                      {t('chargerHealth.baselinePower', 'Baseline')}
                    </Text>
                    <Text variant="bodySm">{formatPower(s.baselineW, { precision: 0 })}</Text>
                    <Text variant="caption">
                      {t('chargerHealth.recentPower', 'Recent')}
                    </Text>
                    <Text variant="bodySm">{formatPower(s.recentW, { precision: 0 })}</Text>
                    <Text variant="caption">
                      {t('chargerHealth.energy', 'Energy taken')}
                    </Text>
                    <Text variant="bodySm">{formatEnergy(s.totalEnergyWh, { precision: 0 })}</Text>
                    <Text variant="caption">
                      {t('chargerHealth.visits', 'Visits')}
                    </Text>
                    <Text variant="bodySm">
                      {t('chargerHealth.visitsValue', '{{n}} ({{rated}} scored)', {
                        n: s.sessions,
                        rated: s.ratedSessions,
                      })}
                    </Text>
                    <Text variant="caption">
                      {t('chargerHealth.lastSeen', 'Last visit')}
                    </Text>
                    <Text variant="bodySm">{formatDateShort(new Date(s.lastSeenMs).toISOString())}</Text>
                    {s.hoursLostPerYear > 0 ? (
                      <>
                        <Text variant="caption">
                          {t('chargerHealth.cost', 'Costs you')}
                        </Text>
                        <Text variant="bodySm" className="text-amber-300">
                          {t('chargerHealth.costValue', '{{h}} h/year', {
                            h: Math.round(s.hoursLostPerYear),
                          })}
                        </Text>
                      </>
                    ) : null}
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
