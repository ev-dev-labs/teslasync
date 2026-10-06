import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, MapPin } from 'lucide-react';

import { PageLayout, LayoutCard, SourceContent } from '@/components/layout';
import { Text, Badge, HelpTooltip } from '@/components/ui';

import { StaleRefreshWarning } from '@/components/feedback';
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
import { useDataState } from '@/hooks/useDataState';
import { chartTokens } from '@/lib/tokens';


import { analyzeChargerResilience, type SiteGroupedBy } from '../lib/chargerResilience';
import { ChargerResilienceStats } from '../components/ChargerResilienceStats';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const GROUPED_BY_DEFAULTS: Record<SiteGroupedBy, string> = {
  place: 'Named place',
  geo: 'Approximate location',
  charger_type: 'Charger type only',
};

export default function ChargerResiliencePage() {
  const { fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('chargerResilience.title', 'Charger Resilience'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatEnergy } = useUnits();

  const sessionsQuery = useChargingHistory(vehicleIdStr);
  const sessionsState = useDataState(sessionsQuery, { provenance: 'historical' });
  const summary = useMemo(() => analyzeChargerResilience(sessionsQuery.data ?? []), [sessionsQuery.data]);

  const chartData = useMemo(
    () =>
      summary.sites.map((s) => ({
        site: s.label,
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

  const isLoading = sessionsQuery.isLoading && !sessionsState.hasData;
  const fatalError = sessionsState.fatalError;
  const sourceLabel = t('dataSources.labels.chargingHistory', 'Charging history');
  const sourceStatus = fatalError ? 'error' : isLoading ? 'loading'
    : !sessionsState.hasData ? 'empty'
      : sessionsState.refreshError != null || sessionsState.isRefreshBlocked ? 'retained' : 'ready';
  const recovery = { onRetry: () => { void sessionsQuery.refetch(); }, resourceName: sourceLabel };
  const unavailableMessage = t('chargerResilience.historyUnavailable', 'Charging history has not loaded. Retry this source or reconnect to continue.');

  return (
    <PageLayout
      title={t('chargerResilience.title', 'Charger Resilience')}
      subtitle={t(
        'chargerResilience.subtitle',
        'How much charging depends on a single location, and what would happen if it disappeared',
      )}
      query={sessionsQuery}
      busy={sessionsState.isRefreshing}
    >
      <StaleRefreshWarning state={sessionsState} label={sourceLabel} />
      {/* 1 — KPI band */}
      <FadeIn>
        <ChargerResilienceStats summary={summary} state={sessionsState} loading={isLoading} />
      </FadeIn>

      {/* 2 — Energy share by site */}
      <FadeIn delay={0.1}>
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
            error={fatalError}
            onRetry={recovery.onRetry}
            empty={chartData.length === 0}
            emptyMessage={!sessionsState.hasData ? unavailableMessage
              : t('chargerResilience.noData', 'No charging locations recorded yet.')}
            height={340}
            data={exportData}
            exportData={exportData}
            dataColumns={[
              { key: 'site', label: t('chargerResilience.col.site', 'Site') },
              { key: 'share', label: t('chargerResilience.col.share', 'Energy share (%)') },
              { key: 'sessions', label: t('chargerResilience.col.sessions', 'Sessions') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 16, right: 16, bottom: 42, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="site" tickFormatter={(label: string) => label.length > 20 ? `${label.slice(0, 19)}…` : label}
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }} angle={-30} textAnchor="end" height={64} />
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
      </FadeIn>

      {/* 3 — What-if top-site loss + site detail */}
      <FadeIn delay={0.2}>
        <div className="grid min-w-0 gap-4 @3xl:grid-cols-2">
          <LayoutCard title={t('chargerResilience.whatIf', 'What If the Top Site Disappeared?')} actions={<div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              <HelpTooltip
                size="sm"
                i18nKey="help.chargerResilience.whatIf"
                defaultValue="A hypothetical, not a prediction: it simply recomputes the same concentration metrics with the top site's energy and sessions removed, to show how much resilience is being masked or hurt by relying on it."
                ariaLabel={t('help.chargerResilience.iconLabel', 'More info about the what-if scenario')}
              />
            </div>}>
            <SourceContent state={sourceStatus === 'ready' && summary.whatIfTopSiteLoss == null ? 'empty' : sourceStatus}
              label={sourceLabel}
              emptyMessage={!sessionsState.hasData ? unavailableMessage : t('chargerResilience.noWhatIf', 'Not enough data to model a loss scenario yet.')}
              errorMessage={unavailableMessage} error={fatalError} errorRecovery={recovery}>
            {summary.whatIfTopSiteLoss != null && (
              <div className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 break-words @sm:grid-cols-2">
                <Text variant="caption">{t('chargerResilience.atRisk', 'Energy at risk')}</Text>
                <Text variant="bodySm">{formatEnergy(summary.whatIfTopSiteLoss.energyAtRiskWh)}</Text>
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
            </SourceContent>
          </LayoutCard>

          <LayoutCard title={t('chargerResilience.detail', 'Sites')} actions={<MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />}>
            <SourceContent state={sourceStatus === 'ready' && summary.sites.length === 0 ? 'empty' : sourceStatus}
              label={sourceLabel}
              emptyMessage={!sessionsState.hasData ? unavailableMessage : t('chargerResilience.noSites', 'No charging locations recorded yet.')}
              errorMessage={unavailableMessage} error={fatalError} errorRecovery={recovery}>
              <ul className="grid gap-2">
                {summary.sites.map((s) => (
                  <li key={s.key} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-2.5">
                    <div className="min-w-0">
                      <Text variant="bodySm" className="break-words font-medium">{s.label}</Text>
                      <Text variant="caption">
                        {t(`chargerResilience.groupedBy.${s.groupedBy}`, GROUPED_BY_DEFAULTS[s.groupedBy])}
                      </Text>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="neutral" size="sm">
                        {t('chargerResilience.sessionsCount', '{{n}} sessions', { n: s.sessions })}
                      </Badge>
                      <Badge variant={s.energyShare >= 0.5 ? 'warning' : 'info'}>
                        {fmtPercent(Math.round(s.energyShare * 1000) / 10)}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </SourceContent>
          </LayoutCard>
        </div>
      </FadeIn>
    </PageLayout>
  );
}
