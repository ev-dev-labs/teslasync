import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, MapPinOff } from 'lucide-react';

import { PageLayout, LayoutCard } from '@/components/layout';
import { Text, Badge, HelpTooltip, Button } from '@/components/ui';

import { TimeStamp } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning, DataStateNotice } from '@/components/feedback';
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
import { deriveDataState } from '@/api/dataState';
import { ChargeInterruptionStats } from '../components/charge-interruption-modernization';
import { analyzeChargeInterruptions, type InterruptionCause, type InterruptionTrend } from '../lib/chargeInterruption';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('chargeInterruption.title', 'Charge Interruption Risk'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const hiddenSeries = useHiddenSeries(CHART_KEY);

  const sessionsQuery = useChargingHistory(vehicleIdStr);
  const sessionsState = deriveDataState(sessionsQuery, { provenance: 'historical' });
  const summary = useMemo(() => analyzeChargeInterruptions(sessionsQuery.data ?? []), [sessionsQuery.data]);

  const chartData = useMemo(
    () =>
      summary.sites
        .filter((s) => s.evidenceCount > 0)
        .map((s) => ({
          site: s.label,
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

  const isLoading = sessionsQuery.isLoading && !sessionsState.hasData;
  const fatalError = sessionsState.fatalError;
  const sourceLabel = t('chargeInterruption.modernization.source', 'Charging history');
  const initialPaused = !sessionsState.hasData && sessionsState.isRefreshBlocked && !fatalError;
  const pausedMessage = t(
    'chargeInterruption.modernization.paused',
    'Charging history loading is paused. Connect to resume or retry.',
  );

  return (
    <PageLayout
      title={t('chargeInterruption.title', 'Charge Interruption Risk')}
      subtitle={t(
        'chargeInterruption.subtitle',
        'Sessions that may have been cut short or under-delivered, estimated from indirect evidence \u2014 never a hardware diagnosis',
      )}
      query={sessionsQuery}
      busy={sessionsState.isRefreshing}
      className="w-full min-w-0"
    >
      <StaleRefreshWarning state={sessionsState} label={sourceLabel} />
      {initialPaused && (
        <DataStateNotice state="stale" title={sourceLabel}>
          <Text as="p" variant="bodySm">{pausedMessage}</Text>
          <Button variant="secondary" onClick={() => { void sessionsQuery.refetch(); }}>
            {t('error.retry', 'Retry')}
          </Button>
        </DataStateNotice>
      )}
      {/* 1 — KPI band */}
      <FadeIn>
        <ChargeInterruptionStats
          summary={sessionsState.hasData ? summary : undefined}
          loading={isLoading}
          retained={sessionsState.refreshError != null || sessionsState.isRefreshBlocked}
          error={fatalError}
          unavailableReason={initialPaused ? pausedMessage : undefined}
          onRetry={() => { void sessionsQuery.refetch(); }}
        />
      </FadeIn>

      {/* 2 — Risk by site, with evidence overlay so confidence is visible */}
      <FadeIn delay={0.1}>
          <ChartContainer
            title={t('chargeInterruption.chart', 'Posterior Risk by Site')}
            subtitle={t('chargeInterruption.chartHint', 'Bars are risk; the line is how much evidence backs it')}
            ariaLabel={t(
              'chargeInterruption.chartAria',
              'Bar chart of posterior interruption risk per charging site, with a line showing the evidence count behind each estimate',
            )}
            chartKey={CHART_KEY}
            loading={isLoading}
            error={fatalError}
            onRetry={() => { void sessionsQuery.refetch(); }}
            empty={chartData.length === 0}
            emptyMessage={initialPaused ? pausedMessage : t(
              'chargeInterruption.noData',
              'No charging location has enough history yet to estimate an interruption risk.',
            )}
            emptyIcon={<AlertTriangle className="h-8 w-8" />}
            className="w-full min-w-0"
            height={340}
            data={chartData}
            exportData={chartData}
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
                <XAxis dataKey="site" tickFormatter={(label: string) => label.length > 20 ? `${label.slice(0, 19)}…` : label}
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }} angle={-30} textAnchor="end" height={64} />
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
      </FadeIn>

      {/* 3 — Per-site detail */}
      <FadeIn delay={0.2}>
        <LayoutCard title={t('chargeInterruption.detail', 'Sites')} actions={
          <div className="flex flex-wrap items-center gap-2">
            <MapPinOff className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
            <HelpTooltip
              size="sm"
              i18nKey="help.chargeInterruption.detail"
              defaultValue="The credible interval (low–high) widens automatically for sites with little history — that is the model admitting it isn't sure yet, not a downgrade."
              ariaLabel={t('help.chargeInterruption.iconLabel', 'More info about the site list')}
            />
          </div>
        }>
          {fatalError ? (
            <QueryError error={fatalError} resourceName={sourceLabel} onRetry={() => { void sessionsQuery.refetch(); }} />
          ) : isLoading ? (
            <Skeleton height={180} />
          ) : summary.sites.length === 0 ? (
            <EmptyState /* no-action: locations appear as charge sessions are recorded. */
              icon={<MapPinOff className="h-8 w-8" />}
              message={initialPaused ? pausedMessage : t('chargeInterruption.noSites', 'No charging locations recorded yet.')}
            />
          ) : (
            <ul className="grid min-w-0 grid-cols-1 gap-3 @3xl:grid-cols-2 @6xl:grid-cols-3">
              {summary.sites.map((s) => (
                <li key={s.key} className="min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Text variant="body" className="min-w-0 break-words font-medium">{s.label}</Text>
                    <Badge variant={TREND_BADGE[s.recentTrend]}>
                      {t(`chargeInterruption.trend.${s.recentTrend}`, TREND_DEFAULTS[s.recentTrend])}
                    </Badge>
                  </div>
                  <div className="mb-2 grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 @sm:grid-cols-3">
                    <Text variant="caption">{t('chargeInterruption.risk', 'Posterior risk')}</Text>
                    <Text variant="bodySm" className="break-words @sm:col-span-2">
                      {fmtPercent(s.posteriorMean * 100)}
                      {' '}
                      <Text as="span" variant="caption">
                        ({fmtPercent(s.posteriorLow * 100)}–{fmtPercent(s.posteriorHigh * 100)})
                      </Text>
                    </Text>
                    <Text variant="caption">{t('chargeInterruption.evidence', 'Evidence')}</Text>
                    <Text variant="bodySm" className="break-words @sm:col-span-2">
                      {t('chargeInterruption.evidenceValue', '{{suspect}} of {{n}} sessions', {
                        suspect: s.suspectedCount,
                        n: s.evidenceCount,
                      })}
                    </Text>
                    <Text variant="caption">{t('chargeInterruption.lastSuspected', 'Last suspected')}</Text>
                    <Text variant="bodySm" className="@sm:col-span-2">
                      {s.lastSuspectedMs != null ? <TimeStamp value={s.lastSuspectedMs} /> : '—'}
                    </Text>
                  </div>
                  {s.topCauses.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {s.topCauses.map((cause) => (
                        <Badge key={cause} variant="neutral" size="sm">
                          <span className="whitespace-normal break-words">{t(`chargeInterruption.cause.${cause}`, CAUSE_DEFAULTS[cause])}</span>
                        </Badge>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </LayoutCard>
      </FadeIn>
    </PageLayout>
  );
}
