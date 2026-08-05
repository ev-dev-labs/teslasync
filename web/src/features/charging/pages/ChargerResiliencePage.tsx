import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Layers, MapPin, Route } from 'lucide-react';

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
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useChargingHistory } from '@/api/hooks/useCharging';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { chartTokens } from '@/lib/tokens';
import { fmtPercent } from '@/lib/numberFormat';

import { analyzeChargerResilience, type SiteGroupedBy } from '../lib/chargerResilience';

const GROUPED_BY_DEFAULTS: Record<SiteGroupedBy, string> = {
  place: 'Named place',
  geo: 'Approximate location',
  charger_type: 'Charger type only',
};

export default function ChargerResiliencePage() {
  const { t } = useTranslation();
  usePageTitle(t('chargerResilience.title', 'Charger Resilience'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatEnergy } = useUnits();

  const sessionsQuery = useChargingHistory(vehicleIdStr);
  const summary = useMemo(() => analyzeChargerResilience(sessionsQuery.data ?? []), [sessionsQuery.data]);

  const chartData = useMemo(
    () =>
      summary.sites.map((s) => ({
        site: s.label.length > 20 ? `${s.label.slice(0, 19)}…` : s.label,
        share: Math.round(s.energyShare * 1000) / 10,
        sessions: s.sessions,
        isTop: summary.topSite != null && s.key === summary.topSite.key,
      })),
    [summary.sites, summary.topSite],
  );

  // ChartContainer's CSV export only accepts scalar cells, so the boolean
  // top-site marker (which only drives Cell colouring) is dropped here.
  const exportData = useMemo(
    () => chartData.map(({ isTop: _isTop, ...rest }) => rest),
    [chartData],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('chargerResilience.title', 'Charger Resilience')} />;
  }

  const isLoading = sessionsQuery.isLoading;
  const isError = sessionsQuery.isError;

  return (
    <PageContainer
      title={t('chargerResilience.title', 'Charger Resilience')}
      subtitle={t(
        'chargerResilience.subtitle',
        'How much charging depends on a single location, and what would happen if it disappeared',
      )}
      query={sessionsQuery}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('chargerResilience.kpis', 'Charger resilience metrics')}
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
                label={t('chargerResilience.score', 'Resilience Score')}
                value={summary.resilienceScore}
                subtitle={t('chargerResilience.scoreHint', 'out of 100')}
                icon={<ShieldCheck className="h-4 w-4" />}
                color={summary.resilienceScore >= 66 ? 'green' : summary.resilienceScore >= 33 ? 'amber' : 'red'}
                help={{
                  i18nKey: 'help.chargerResilience.score',
                  defaultValue:
                    'A composite of three things: how much energy is NOT concentrated in your top site (40%), how often an alternate site has actually been used rather than just being available on paper (30%), and how many effectively-equal sites your charging behaves like (30%).',
                }}
              />
              <MetricCard
                label={t('chargerResilience.effectiveSites', 'Effective Site Count')}
                value={summary.effectiveSiteCount}
                subtitle={t('chargerResilience.effectiveSitesHint', '{{n}} locations seen', {
                  n: summary.sites.length,
                })}
                icon={<Layers className="h-4 w-4" />}
                color="cyan"
                help={{
                  i18nKey: 'help.chargerResilience.effectiveSites',
                  defaultValue:
                    'The reciprocal of the energy-weighted Herfindahl-Hirschman Index (1/HHI) — the number of equally-sized sites this portfolio behaves like. Usually smaller than a raw count of distinct locations, because a handful of those were only visited once.',
                }}
              />
              <MetricCard
                label={t('chargerResilience.topDependency', 'Top-Site Dependency')}
                value={fmtPercent(summary.topSiteDependencyPct, 1)}
                subtitle={summary.topSite?.label ?? t('chargerResilience.none', 'None yet')}
                icon={<MapPin className="h-4 w-4" />}
                color={summary.topSiteDependencyPct >= 66 ? 'red' : summary.topSiteDependencyPct >= 40 ? 'amber' : 'green'}
              />
              <MetricCard
                label={t('chargerResilience.fallback', 'Fallback Coverage')}
                value={fmtPercent(summary.fallbackCoveragePct, 1)}
                subtitle={t('chargerResilience.fallbackHint', 'sessions charged elsewhere')}
                icon={<Route className="h-4 w-4" />}
                color="purple"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Energy share by site */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && chartData.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: sites are discovered from charge history as it accumulates. */
              icon={<MapPin className="h-8 w-8" />}
              message={t('chargerResilience.noData', 'No charging locations recorded yet.')}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('chargerResilience.chart', 'Energy Share by Site')}
            subtitle={t('chargerResilience.chartHint', 'The top site is highlighted; a taller bar means more dependency')}
            ariaLabel={t(
              'chargerResilience.chartAria',
              'Bar chart of the percentage of total charging energy delivered at each site',
            )}
            // Single data series (energy share) — no legend/hidden-series
            // toggle is needed because there is nothing else to hide.
            loading={isLoading}
            empty={chartData.length === 0}
            height={340}
            data={exportData}
            dataColumns={[
              { key: 'site', label: t('chargerResilience.col.site', 'Site') },
              { key: 'share', label: t('chargerResilience.col.share', 'Energy share (%)') },
              { key: 'sessions', label: t('chargerResilience.col.sessions', 'Sessions') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 16, right: 16, bottom: 42, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="site" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} angle={-30} textAnchor="end" height={64} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} domain={[0, 100]} unit="%" />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="share" name={t('chargerResilience.col.share', 'Energy share (%)')} radius={[3, 3, 0, 0]}>
                  {chartData.map((d) => (
                    <Cell key={d.site} fill={d.isTop ? chartTokens.series[3] : chartTokens.series[0]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — What-if top-site loss + site detail */}
      <FadeIn delay={0.2}>
        <div className="grid gap-4 lg:grid-cols-2">
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('chargerResilience.whatIf', 'What If the Top Site Disappeared?')}
              <HelpTooltip
                size="sm"
                i18nKey="help.chargerResilience.whatIf"
                defaultValue="A hypothetical, not a prediction: it simply recomputes the same concentration metrics with the top site's energy and sessions removed, to show how much resilience is being masked or hurt by relying on it."
                ariaLabel={t('help.chargerResilience.iconLabel', 'More info about the what-if scenario')}
              />
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={140} />
            ) : summary.whatIfTopSiteLoss == null ? (
              <EmptyState /* no-action: appears once at least one site has recorded energy. */
                icon={<ShieldCheck className="h-8 w-8" />}
                message={t('chargerResilience.noWhatIf', 'Not enough data to model a loss scenario yet.')}
              />
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Text variant="caption">{t('chargerResilience.atRisk', 'Energy at risk')}</Text>
                <Text variant="bodySm">{formatEnergy(summary.whatIfTopSiteLoss.energyAtRiskWh, { precision: 0 })}</Text>
                <Text variant="caption">{t('chargerResilience.newTop', 'New top site')}</Text>
                <Text variant="bodySm">{summary.whatIfTopSiteLoss.newTopSiteLabel ?? t('chargerResilience.none', 'None yet')}</Text>
                <Text variant="caption">{t('chargerResilience.scoreBefore', 'Score before')}</Text>
                <Text variant="bodySm">{summary.whatIfTopSiteLoss.resilienceScoreBefore}</Text>
                <Text variant="caption">{t('chargerResilience.scoreAfter', 'Score after loss')}</Text>
                <Text
                  variant="bodySm"
                  className={summary.whatIfTopSiteLoss.resilienceScoreDelta < 0 ? 'text-rose-300' : 'text-emerald-300'}
                >
                  {summary.whatIfTopSiteLoss.resilienceScoreAfter}
                  {' '}
                  ({summary.whatIfTopSiteLoss.resilienceScoreDelta >= 0 ? '+' : ''}
                  {summary.whatIfTopSiteLoss.resilienceScoreDelta})
                </Text>
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('chargerResilience.detail', 'Sites')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={140} />
            ) : summary.sites.length === 0 ? (
              <EmptyState /* no-action: locations appear as charge sessions are recorded. */
                icon={<MapPin className="h-8 w-8" />}
                message={t('chargerResilience.noSites', 'No charging locations recorded yet.')}
              />
            ) : (
              <ul className="grid gap-2">
                {summary.sites.map((s) => (
                  <li key={s.key} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-2.5">
                    <div className="min-w-0">
                      <Text variant="bodySm" className="truncate font-medium">{s.label}</Text>
                      <Text variant="caption">
                        {t(`chargerResilience.groupedBy.${s.groupedBy}`, GROUPED_BY_DEFAULTS[s.groupedBy])}
                      </Text>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="neutral" size="sm">
                        {t('chargerResilience.sessionsCount', '{{n}} sessions', { n: s.sessions })}
                      </Badge>
                      <Badge variant={s.energyShare >= 0.5 ? 'warning' : 'info'}>
                        {fmtPercent(Math.round(s.energyShare * 1000) / 10, 1)}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        </div>
      </FadeIn>
    </PageContainer>
  );
}
