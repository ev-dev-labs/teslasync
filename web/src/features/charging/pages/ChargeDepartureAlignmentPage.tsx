import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, Gauge, AlertTriangle, Link2 } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip, ChartLegend,
  ComposedChart, Bar, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useChargingHistory } from '@/api/hooks/useCharging';
import { useDriveHistory } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { chartTokens } from '@/lib/tokens';
import { fmtPercent } from '@/lib/numberFormat';
import { formatDurationSecondsAsMinutes } from '@/lib/dateFormat';

import { analyzeChargeDepartureAlignment, type AlignmentFlag } from '../lib/chargeDepartureAlignment';

const FLAG_DEFAULTS: Record<AlignmentFlag, string> = {
  tight_margin: 'Cut it close on departure',
  excess_buffer: 'Added far more than that trip used',
  early_full_dwell: 'Sat at full charge before leaving',
  long_dwell: 'Long gap before departure',
  soc_mismatch: 'SoC reading looks inconsistent',
};

const CHART_KEY = 'charge-departure-alignment';

function dayLabel(ms: number, locale: string): string {
  return new Date(ms).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

export default function ChargeDepartureAlignmentPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('chargeDepartureAlignment.title', 'Charge \u2192 Departure Alignment'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const hiddenSeries = useHiddenSeries(CHART_KEY);

  const sessionsQuery = useChargingHistory(vehicleIdStr);
  const drivesQuery = useDriveHistory(vehicleIdStr);

  const summary = useMemo(
    () => analyzeChargeDepartureAlignment(sessionsQuery.data ?? [], drivesQuery.data ?? []),
    [sessionsQuery.data, drivesQuery.data],
  );

  const chartData = useMemo(
    () =>
      summary.pairs.map((p) => ({
        date: dayLabel(p.chargeEndedMs, i18n.language),
        dwellMin: Math.round(p.dwellS / 60),
        margin: p.readinessMarginPct,
        misaligned: p.flags.length > 0,
      })),
    [summary.pairs, i18n.language],
  );

  // ChartContainer's CSV export only accepts scalar cells, so the boolean
  // misalignment marker (which only drives Cell colouring) is dropped here.
  const exportData = useMemo(
    () => chartData.map(({ misaligned: _misaligned, ...rest }) => rest),
    [chartData],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('chargeDepartureAlignment.title', 'Charge \u2192 Departure Alignment')} />;
  }

  const isLoading = sessionsQuery.isLoading || drivesQuery.isLoading;
  const isError = sessionsQuery.isError || drivesQuery.isError;

  return (
    <PageContainer
      title={t('chargeDepartureAlignment.title', 'Charge \u2192 Departure Alignment')}
      subtitle={t(
        'chargeDepartureAlignment.subtitle',
        'How well each charge matched the very next drive \u2014 a temporal pairing, never proof of intent',
      )}
      query={[sessionsQuery, drivesQuery]}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('chargeDepartureAlignment.kpis', 'Charge departure alignment metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={sessionsQuery.error ?? drivesQuery.error} onRetry={() => { sessionsQuery.refetch(); drivesQuery.refetch(); }} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={96} className="rounded-xl" />)
          ) : (
            <>
              <MetricCard
                label={t('chargeDepartureAlignment.avgDwell', 'Avg. Dwell Time')}
                value={formatDurationSecondsAsMinutes(summary.avgDwellS)}
                subtitle={t('chargeDepartureAlignment.avgDwellHint', 'from charge end to next drive')}
                icon={<Clock3 className="h-4 w-4" />}
                color="cyan"
              />
              <MetricCard
                label={t('chargeDepartureAlignment.avgMargin', 'Avg. Readiness Margin')}
                value={summary.avgReadinessMarginPct != null ? fmtPercent(summary.avgReadinessMarginPct, 1) : '\u2014'}
                subtitle={t('chargeDepartureAlignment.avgMarginHint', 'SoC left once that drive ended')}
                icon={<Gauge className="h-4 w-4" />}
                color="purple"
                help={{
                  i18nKey: 'help.chargeDepartureAlignment.avgMargin',
                  defaultValue:
                    'The realized safety buffer: how much charge was still left when the paired drive finished. A low average does not itself mean anything went wrong \u2014 it only describes what happened, not what was intended.',
                }}
              />
              <MetricCard
                label={t('chargeDepartureAlignment.misaligned', 'Misaligned Rate')}
                value={fmtPercent(summary.misalignedRatePct, 1)}
                subtitle={t('chargeDepartureAlignment.misalignedHint', '{{n}} of {{total}} paired sessions', {
                  n: summary.misalignedCount,
                  total: summary.pairedCount,
                })}
                icon={<AlertTriangle className="h-4 w-4" />}
                color={summary.misalignedRatePct >= 40 ? 'amber' : 'green'}
                help={{
                  i18nKey: 'help.chargeDepartureAlignment.misaligned',
                  defaultValue:
                    'Share of pairings that tripped at least one heuristic (a tight margin, a very long or already-full dwell, far more energy added than that trip used, or an inconsistent SoC reading). Each is circumstantial on its own.',
                }}
              />
              <MetricCard
                label={t('chargeDepartureAlignment.paired', 'Paired Sessions')}
                value={summary.pairedCount}
                subtitle={t('chargeDepartureAlignment.pairedHint', 'of {{n}} ended charges within 24h of a drive', {
                  n: summary.totalEndedCharges,
                })}
                icon={<Link2 className="h-4 w-4" />}
                color="blue"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Dwell and readiness margin over time */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && chartData.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: pairs appear once a charge and a following drive both exist. */
              icon={<Link2 className="h-8 w-8" />}
              message={t(
                'chargeDepartureAlignment.noData',
                'No charge could be paired with a following drive within 24 hours yet.',
              )}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('chargeDepartureAlignment.chart', 'Dwell Time vs. Readiness Margin')}
            subtitle={t('chargeDepartureAlignment.chartHint', 'Bars are minutes parked after charging; the line is SoC left after that drive')}
            ariaLabel={t(
              'chargeDepartureAlignment.chartAria',
              'Bar chart of post-charge dwell minutes with a line showing the readiness margin left after the paired drive',
            )}
            chartKey={CHART_KEY}
            loading={isLoading}
            empty={chartData.length === 0}
            height={340}
            data={exportData}
            dataColumns={[
              { key: 'date', label: t('chargeDepartureAlignment.col.date', 'Date') },
              { key: 'dwellMin', label: t('chargeDepartureAlignment.col.dwell', 'Dwell (min)') },
              { key: 'margin', label: t('chargeDepartureAlignment.col.margin', 'Readiness margin (%)') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis yAxisId="dwell" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis yAxisId="margin" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} domain={[0, 100]} unit="%" />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={hiddenSeries} />
                <Bar
                  yAxisId="dwell"
                  dataKey="dwellMin"
                  name={t('chargeDepartureAlignment.col.dwell', 'Dwell (min)')}
                  radius={[3, 3, 0, 0]}
                  hide={hiddenSeries.isHidden('dwellMin')}
                >
                  {chartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.misaligned ? chartTokens.series[3] : chartTokens.series[0]}
                      fillOpacity={d.misaligned ? 1 : 0.7}
                    />
                  ))}
                </Bar>
                <Line
                  yAxisId="margin"
                  type="monotone"
                  dataKey="margin"
                  name={t('chargeDepartureAlignment.col.margin', 'Readiness margin (%)')}
                  stroke={chartTokens.series[2]}
                  strokeWidth={2}
                  dot
                  hide={hiddenSeries.isHidden('margin')}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Pair detail */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Link2 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('chargeDepartureAlignment.detail', 'Recent Pairs')}
            <HelpTooltip
              size="sm"
              i18nKey="help.chargeDepartureAlignment.detail"
              defaultValue="Pairing a charge with the next drive is a temporal adjacency, not a proof of intent \u2014 a charge could have been meant for a later trip. A small negative SoC drift between charge-end and drive-start is ordinary vampire drain, not a fault."
              ariaLabel={t('help.chargeDepartureAlignment.iconLabel', 'More info about how pairs are formed')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={180} />
          ) : summary.pairs.length === 0 ? (
            <EmptyState /* no-action: pairs appear once a charge and a following drive both exist. */
              icon={<Link2 className="h-8 w-8" />}
              message={t('chargeDepartureAlignment.noPairs', 'No paired sessions to show yet.')}
            />
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {[...summary.pairs].reverse().slice(0, 12).map((p) => (
                <li key={`${p.chargeId}-${p.driveId}`} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <Text variant="bodySm" className="font-medium">
                      {dayLabel(p.chargeEndedMs, i18n.language)}
                    </Text>
                    <Text variant="caption">{formatDurationSecondsAsMinutes(p.dwellS)} {t('chargeDepartureAlignment.dwellSuffix', 'dwell')}</Text>
                  </div>
                  <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1">
                    <Text variant="caption">{t('chargeDepartureAlignment.margin', 'Readiness margin')}</Text>
                    <Text variant="bodySm">{p.readinessMarginPct != null ? fmtPercent(p.readinessMarginPct, 0) : '\u2014'}</Text>
                    <Text variant="caption">{t('chargeDepartureAlignment.socUsed', 'SoC that drive used')}</Text>
                    <Text variant="bodySm">{p.socUsedPct != null ? fmtPercent(p.socUsedPct, 0) : '\u2014'}</Text>
                  </div>
                  {p.flags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {p.flags.map((flag) => (
                        <Badge key={flag} variant="neutral" size="sm">
                          {t(`chargeDepartureAlignment.flag.${flag}`, FLAG_DEFAULTS[flag])}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <Badge variant="success" size="sm">
                      {t('chargeDepartureAlignment.wellMatched', 'Well matched')}
                    </Badge>
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
