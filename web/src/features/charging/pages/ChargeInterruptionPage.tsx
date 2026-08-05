import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Activity, MapPinOff, ShieldQuestion } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard, TimeStamp } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip, ChartLegend,
  ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useChargingHistory } from '@/api/hooks/useCharging';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { chartTokens } from '@/lib/tokens';
import { fmtPercent } from '@/lib/numberFormat';

import { analyzeChargeInterruptions, type InterruptionCause, type InterruptionTrend } from '../lib/chargeInterruption';

const CAUSE_DEFAULTS: Record<InterruptionCause, string> = {
  no_end_timestamp: 'No end timestamp recorded',
  no_end_soc: 'No end SoC recorded',
  stalled_soc_gain: 'SoC gained far slower than this site usually manages',
  power_collapse: 'Power fell well below this session\u2019s own peak',
  aborted_early: 'Stopped almost immediately after starting',
};

const TREND_BADGE: Record<InterruptionTrend, 'danger' | 'success' | 'neutral'> = {
  rising: 'danger',
  falling: 'success',
  flat: 'neutral',
  insufficient_data: 'neutral',
};

const TREND_DEFAULTS: Record<InterruptionTrend, string> = {
  rising: 'Getting worse',
  falling: 'Improving',
  flat: 'Steady',
  insufficient_data: 'Not enough history',
};

const CHART_KEY = 'charge-interruption-risk-by-site';

export default function ChargeInterruptionPage() {
  const { t } = useTranslation();
  usePageTitle(t('chargeInterruption.title', 'Charge Interruption Risk'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const hiddenSeries = useHiddenSeries(CHART_KEY);

  const sessionsQuery = useChargingHistory(vehicleIdStr);
  const summary = useMemo(() => analyzeChargeInterruptions(sessionsQuery.data ?? []), [sessionsQuery.data]);

  const chartData = useMemo(
    () =>
      summary.sites
        .filter((s) => s.evidenceCount > 0)
        .map((s) => ({
          site: s.label.length > 20 ? `${s.label.slice(0, 19)}\u2026` : s.label,
          risk: Math.round(s.posteriorMean * 1000) / 10,
          low: Math.round(s.posteriorLow * 1000) / 10,
          high: Math.round(s.posteriorHigh * 1000) / 10,
          evidence: s.evidenceCount,
        })),
    [summary.sites],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('chargeInterruption.title', 'Charge Interruption Risk')} />;
  }

  const isLoading = sessionsQuery.isLoading;
  const isError = sessionsQuery.isError;

  return (
    <PageContainer
      title={t('chargeInterruption.title', 'Charge Interruption Risk')}
      subtitle={t(
        'chargeInterruption.subtitle',
        'Sessions that may have been cut short or under-delivered, estimated from indirect evidence \u2014 never a hardware diagnosis',
      )}
      query={sessionsQuery}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('chargeInterruption.kpis', 'Charge interruption metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={sessionsQuery.error} onRetry={() => sessionsQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={96} className="rounded-xl" />)
          ) : (
            <>
              <MetricCard
                label={t('chargeInterruption.overallRisk', 'Overall Risk')}
                value={fmtPercent(summary.overallPosteriorMean * 100, 0)}
                subtitle={t('chargeInterruption.overallRiskHint', 'pooled across {{n}} evaluable sessions', {
                  n: summary.evaluableSessions,
                })}
                icon={<AlertTriangle className="h-4 w-4" />}
                color={summary.overallPosteriorMean > 0.3 ? 'red' : summary.overallPosteriorMean > 0.15 ? 'amber' : 'green'}
                help={{
                  i18nKey: 'help.chargeInterruption.overallRisk',
                  defaultValue:
                    'A Beta-Bayesian estimate, not a count of confirmed failures. Every signal used (missing end SoC, a stalled charge rate, a power collapse, an early abort) is circumstantial \u2014 each has an innocent explanation too. This number is a probability, weighted by how much evidence exists, never a verdict.',
                }}
              />
              <MetricCard
                label={t('chargeInterruption.suspected', 'Suspected Sessions')}
                value={summary.suspectedSessions}
                subtitle={t('chargeInterruption.suspectedHint', 'of {{n}} scoreable sessions', {
                  n: summary.evaluableSessions,
                })}
                icon={<Activity className="h-4 w-4" />}
                color="cyan"
              />
              <MetricCard
                label={t('chargeInterruption.highestRisk', 'Highest-Risk Site')}
                value={
                  summary.highestRiskSite != null
                    ? fmtPercent(summary.highestRiskSite.posteriorMean * 100, 0)
                    : '\u2014'
                }
                subtitle={summary.highestRiskSite?.label ?? t('chargeInterruption.none', 'None yet')}
                icon={<MapPinOff className="h-4 w-4" />}
                color="purple"
                help={{
                  i18nKey: 'help.chargeInterruption.highestRisk',
                  defaultValue:
                    'Ranked by the conservative (2.5th percentile) bound of the risk estimate, not the raw average \u2014 so a single unlucky session at a brand-new site can\u2019t outrank a site with a real, well-evidenced pattern.',
                }}
              />
              <MetricCard
                label={t('chargeInterruption.sitesTracked', 'Sites Tracked')}
                value={summary.sites.length}
                subtitle={t('chargeInterruption.sitesTrackedHint', '{{n}} sessions total', {
                  n: summary.totalSessions,
                })}
                icon={<ShieldQuestion className="h-4 w-4" />}
                color="blue"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Risk by site, with evidence overlay so confidence is visible */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && chartData.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: sites appear automatically once charge history accumulates. */
              icon={<AlertTriangle className="h-8 w-8" />}
              message={t(
                'chargeInterruption.noData',
                'No charging location has enough history yet to estimate an interruption risk.',
              )}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('chargeInterruption.chart', 'Posterior Risk by Site')}
            subtitle={t('chargeInterruption.chartHint', 'Bars are risk; the line is how much evidence backs it')}
            ariaLabel={t(
              'chargeInterruption.chartAria',
              'Bar chart of posterior interruption risk per charging site, with a line showing the evidence count behind each estimate',
            )}
            chartKey={CHART_KEY}
            loading={isLoading}
            empty={chartData.length === 0}
            height={340}
            data={chartData}
            dataColumns={[
              { key: 'site', label: t('chargeInterruption.col.site', 'Site') },
              { key: 'risk', label: t('chargeInterruption.col.risk', 'Risk (%)') },
              { key: 'low', label: t('chargeInterruption.col.low', 'Low bound (%)') },
              { key: 'high', label: t('chargeInterruption.col.high', 'High bound (%)') },
              { key: 'evidence', label: t('chargeInterruption.col.evidence', 'Evidence (sessions)') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 16, right: 16, bottom: 42, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="site" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} angle={-30} textAnchor="end" height={64} />
                <YAxis yAxisId="risk" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} domain={[0, 100]} unit="%" />
                <YAxis yAxisId="evidence" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={hiddenSeries} />
                <Bar
                  yAxisId="risk"
                  dataKey="risk"
                  name={t('chargeInterruption.col.risk', 'Risk (%)')}
                  fill={chartTokens.series[3]}
                  radius={[3, 3, 0, 0]}
                  hide={hiddenSeries.isHidden('risk')}
                />
                <Line
                  yAxisId="evidence"
                  type="monotone"
                  dataKey="evidence"
                  name={t('chargeInterruption.col.evidence', 'Evidence (sessions)')}
                  stroke={chartTokens.series[5]}
                  strokeWidth={2}
                  dot
                  hide={hiddenSeries.isHidden('evidence')}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Per-site detail */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <MapPinOff className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('chargeInterruption.detail', 'Sites')}
            <HelpTooltip
              size="sm"
              i18nKey="help.chargeInterruption.detail"
              defaultValue="The credible interval (low–high) widens automatically for sites with little history — that is the model admitting it isn't sure yet, not a downgrade."
              ariaLabel={t('help.chargeInterruption.iconLabel', 'More info about the site list')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={180} />
          ) : summary.sites.length === 0 ? (
            <EmptyState /* no-action: locations appear as charge sessions are recorded. */
              icon={<MapPinOff className="h-8 w-8" />}
              message={t('chargeInterruption.noSites', 'No charging locations recorded yet.')}
            />
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {summary.sites.map((s) => (
                <li key={s.key} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Text variant="body" className="font-medium">{s.label}</Text>
                    <Badge variant={TREND_BADGE[s.recentTrend]}>
                      {t(`chargeInterruption.trend.${s.recentTrend}`, TREND_DEFAULTS[s.recentTrend])}
                    </Badge>
                  </div>
                  <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                    <Text variant="caption">{t('chargeInterruption.risk', 'Posterior risk')}</Text>
                    <Text variant="bodySm" className="sm:col-span-2">
                      {fmtPercent(s.posteriorMean * 100, 0)}
                      {' '}
                      <Text as="span" variant="caption">
                        ({fmtPercent(s.posteriorLow * 100, 0)}–{fmtPercent(s.posteriorHigh * 100, 0)})
                      </Text>
                    </Text>
                    <Text variant="caption">{t('chargeInterruption.evidence', 'Evidence')}</Text>
                    <Text variant="bodySm" className="sm:col-span-2">
                      {t('chargeInterruption.evidenceValue', '{{suspect}} of {{n}} sessions', {
                        suspect: s.suspectedCount,
                        n: s.evidenceCount,
                      })}
                    </Text>
                    {s.lastSuspectedMs != null && (
                      <>
                        <Text variant="caption">{t('chargeInterruption.lastSuspected', 'Last suspected')}</Text>
                        <Text variant="bodySm" className="sm:col-span-2">
                          <TimeStamp value={s.lastSuspectedMs} />
                        </Text>
                      </>
                    )}
                  </div>
                  {s.topCauses.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {s.topCauses.map((cause) => (
                        <Badge key={cause} variant="neutral" size="sm">
                          {t(`chargeInterruption.cause.${cause}`, CAUSE_DEFAULTS[cause])}
                        </Badge>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
