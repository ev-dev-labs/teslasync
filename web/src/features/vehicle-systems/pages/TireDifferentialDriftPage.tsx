import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, Search, Scale, Waypoints } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip, ChartLegend,
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useTirePressureAnalysisHistory } from '@/api/hooks/useVehicleSystems';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { convertPressureFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';

import { summarizeTireDifferentialDrift, TIRE_CORNERS, type TireCorner } from '../lib/tireDifferentialDrift';

const CORNER_FALLBACK: Record<TireCorner, string> = {
  fl: 'Front Left', fr: 'Front Right', rl: 'Rear Left', rr: 'Rear Right',
};
const CORNER_COLOR: Record<TireCorner, string> = {
  fl: chartTokens.series[0]!, fr: chartTokens.series[1]!, rl: chartTokens.series[2]!, rr: chartTokens.series[3]!,
};

export default function TireDifferentialDriftPage() {
  const { t } = useTranslation();
  usePageTitle(t('tireDifferentialDrift.title', 'Tire Differential Drift'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : '';
  const { unitPrefs, formatPressure } = useUnits();
  const residualHidden = useHiddenSeries('tire-differential-drift-residuals');

  const historyQuery = useTirePressureAnalysisHistory(vehicleIdStr);
  const summary = useMemo(
    () => summarizeTireDifferentialDrift(historyQuery.data ?? []),
    [historyQuery.data],
  );

  const cornerLabel = (corner: TireCorner) =>
    t(`tireDifferentialDrift.corner.${corner}`, CORNER_FALLBACK[corner]);

  // Pa → kPa (SI floor) → the user's display unit. Purely multiplicative,
  // so this is valid for both absolute residuals and per-day slopes alike.
  const toDisplay = (pa: number) => convertPressureFromSI(pa / 1000, unitPrefs.pressure);

  const residualSeries = useMemo(
    () =>
      summary.residuals.map((r) => ({
        time: new Date(r.ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' }),
        fl: Math.round(toDisplay(r.fl) * 100) / 100,
        fr: Math.round(toDisplay(r.fr) * 100) / 100,
        rl: Math.round(toDisplay(r.rl) * 100) / 100,
        rr: Math.round(toDisplay(r.rr) * 100) / 100,
      })),
    [summary.residuals, unitPrefs.pressure],
  );

  const slopeBars = useMemo(
    () =>
      summary.corners.map((c) => ({
        corner: t(`tireDifferentialDrift.corner.${c.corner}`, CORNER_FALLBACK[c.corner]),
        key: c.corner,
        slope: Math.round(toDisplay(c.slopePaPerDay) * 100) / 100,
        confidence: c.confidence,
      })),
    [summary.corners, unitPrefs.pressure, t],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('tireDifferentialDrift.title', 'Tire Differential Drift')} />;
  }

  const isLoading = historyQuery.isLoading;
  const isError = historyQuery.isError;
  const leakCard = summary.leakCorner != null ? cornerLabel(summary.leakCorner) : null;
  const imbalanceCard = summary.imbalanceCorner != null ? cornerLabel(summary.imbalanceCorner) : null;
  const leakDaysToThreshold =
    summary.leakCorner != null
      ? (summary.corners.find((c) => c.corner === summary.leakCorner)?.daysToThreshold ?? null)
      : null;

  return (
    <PageContainer
      title={t('tireDifferentialDrift.title', 'Tire Differential Drift')}
      subtitle={t(
        'tireDifferentialDrift.subtitle',
        'Removes the four-tire common mode at every sample, so what remains is how each corner moves relative to its peers — an inference, not a manufacturer reading',
      )}
      query={historyQuery}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('tireDifferentialDrift.kpis', 'Differential drift metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={historyQuery.error} onRetry={() => historyQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={96} className="rounded-xl" />)
          ) : (
            <>
              <MetricCard
                label={t('tireDifferentialDrift.leakCorner', 'Likely Leak Corner')}
                value={leakCard ?? t('tireDifferentialDrift.none', 'None detected')}
                subtitle={t('tireDifferentialDrift.leakScore', 'evidence score {{score}}', { score: fmtNumber(summary.leakScore, 2) })}
                icon={<Search className="h-5 w-5" />}
                color={leakCard != null ? 'amber' : 'green'}
                help={{
                  i18nKey: 'help.tireDifferentialDrift.leakCorner',
                  defaultValue: 'Each corner residual (reading minus the four-tire median) gets its own Theil-Sen slope over time. The corner with the strongest, most pairwise-consistent negative slope — clearing minimum samples, span, and agreement bars — is flagged here. A shared weather swing cancels equally, so it cannot trigger this alone.',
                }}
              />
              <MetricCard
                label={t('tireDifferentialDrift.imbalance', 'Structural Imbalance')}
                value={formatPressure(summary.imbalancePa / 1000, { precision: 2 })}
                subtitle={
                  imbalanceCard != null
                    ? t('tireDifferentialDrift.imbalanceCorner', 'largest offset: {{corner}}', { corner: imbalanceCard })
                    : t('tireDifferentialDrift.noImbalance', 'corners evenly matched')
                }
                icon={<Scale className="h-5 w-5" />}
                color="purple"
                help={{
                  i18nKey: 'help.tireDifferentialDrift.imbalance',
                  defaultValue: "The spread between each corner's mean (constant) residual — independent of the leak ranking. A corner permanently offset (e.g. after a wheel swap) shows up here with zero slope, invisible to the leak ranking alone.",
                }}
              />
              <MetricCard
                label={t('tireDifferentialDrift.daysToThreshold', 'Days to Threshold')}
                value={leakDaysToThreshold != null ? String(leakDaysToThreshold) : '—'}
                subtitle={t('tireDifferentialDrift.daysToThresholdHint', 'projected from the fitted trend, evidence-gated')}
                icon={<Gauge className="h-5 w-5" />}
                color={leakDaysToThreshold != null && leakDaysToThreshold <= 14 ? 'amber' : 'blue'}
              />
              <MetricCard
                label={t('tireDifferentialDrift.samples', 'Samples Analyzed')}
                value={summary.usableSamples}
                subtitle={t('tireDifferentialDrift.samplesHint', '{{span}} day span · {{n}} raw rows', { span: summary.spanDays ?? '—', n: summary.analyzedSamples })}
                icon={<Waypoints className="h-5 w-5" />}
                color="cyan"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Residual timeline */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && residualSeries.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: residuals accrue automatically as TPMS history is reported. */
              icon={<Gauge className="h-8 w-8" />}
              message={t('tireDifferentialDrift.noData', 'No usable four-corner TPMS history yet. Each row needs a plausible reading on all four tires to compute the common-mode median.')}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('tireDifferentialDrift.residualTimeline', 'Common-Mode-Removed Residuals')}
            subtitle={t('tireDifferentialDrift.residualTimelineHint', "Each corner's deviation from the four-tire median at every sample — shared weather swings cancel out, leaving only relative drift")}
            ariaLabel={t('tireDifferentialDrift.residualTimelineAria', 'Line chart of four tire-corner pressure residuals against the common-mode median over time')}
            chartKey="tire-differential-drift-residuals"
            loading={isLoading}
            empty={residualSeries.length === 0}
            height={340}
            data={residualSeries}
            dataColumns={[
              { key: 'time', label: t('tireDifferentialDrift.col.time', 'Time') },
              { key: 'fl', label: cornerLabel('fl') },
              { key: 'fr', label: cornerLabel('fr') },
              { key: 'rl', label: cornerLabel('rl') },
              { key: 'rr', label: cornerLabel('rr') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={residualSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} unit={` ${unitPrefs.pressure}`} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={residualHidden} />
                {TIRE_CORNERS.map((corner) => (
                  <Line
                    key={corner}
                    type="monotone"
                    dataKey={corner}
                    name={cornerLabel(corner)}
                    stroke={CORNER_COLOR[corner]}
                    strokeWidth={2}
                    dot={false}
                    hide={residualHidden.isHidden(corner)}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Per-corner slope ranking */}
      <FadeIn delay={0.2}>
        {/* chart-legend-audit:skip single series (one bar per corner, distinguished by axis category, not stacked/grouped series) */}
        <ChartContainer
          title={t('tireDifferentialDrift.slopeRanking', 'Per-Corner Drift Rate')}
          subtitle={t('tireDifferentialDrift.slopeRankingHint', "Theil-Sen slope of each corner's residual, per day — negative means losing pressure relative to the group")}
          ariaLabel={t('tireDifferentialDrift.slopeRankingAria', 'Bar chart of the fitted residual drift rate per day for each tire corner')}
          loading={isLoading}
          empty={slopeBars.length === 0}
          height={280}
          data={slopeBars}
          dataColumns={[
            { key: 'corner', label: t('tireDifferentialDrift.col.corner', 'Corner') },
            { key: 'slope', label: t('tireDifferentialDrift.col.slope', `Slope (${unitPrefs.pressure}/day)`) },
            { key: 'confidence', label: t('tireDifferentialDrift.col.confidence', 'Confidence') },
          ]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={slopeBars}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="corner" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} unit={` ${unitPrefs.pressure}/d`} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="slope" name={t('tireDifferentialDrift.col.slope', 'Slope')} radius={[4, 4, 0, 0]}>
                {slopeBars.map((bar) => (
                  <Cell key={bar.key} fill={bar.key === summary.leakCorner ? chartTokens.series[3] : CORNER_COLOR[bar.key]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </FadeIn>

      {/* 4 — What it means */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Search className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('tireDifferentialDrift.reading', 'Reading This Inference')}
            <HelpTooltip
              size="sm"
              i18nKey="help.tireDifferentialDrift.reading"
              defaultValue="Every number here is derived from resampled TPMS residuals, not a manufacturer specification. Leak ranking and structural imbalance are independent read-outs of the same residual series and can disagree — a corner can be offset without drifting, or drifting without ever being the most offset."
              ariaLabel={t('help.tireDifferentialDrift.iconLabel', 'More info about this inference')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={140} />
          ) : summary.usableSamples === 0 ? (
            <EmptyState /* no-action: the reading follows from the residual series computed above. */
              icon={<Scale className="h-8 w-8" />}
              message={t('tireDifferentialDrift.noReading', 'The reading appears once at least one usable four-corner sample has been analyzed.')}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {summary.corners.map((c) => (
                <div key={c.corner} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Text variant="body" className="font-medium">{cornerLabel(c.corner)}</Text>
                    {c.corner === summary.leakCorner ? (
                      <Badge variant="warning">{t('tireDifferentialDrift.suspect', 'Leak suspect')}</Badge>
                    ) : null}
                    {c.corner === summary.imbalanceCorner ? (
                      <Badge variant="info">{t('tireDifferentialDrift.offset', 'Most offset')}</Badge>
                    ) : null}
                  </div>
                  <Text variant="caption" as="p">
                    {t('tireDifferentialDrift.cornerStats', 'slope {{slope}}/day · confidence {{conf}} · mean offset {{offset}}', {
                      slope: formatPressure(c.slopePaPerDay / 1000, { precision: 2 }),
                      conf: fmtNumber(c.confidence, 2),
                      offset: formatPressure(c.meanResidualPa / 1000, { precision: 2 }),
                    })}
                  </Text>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
