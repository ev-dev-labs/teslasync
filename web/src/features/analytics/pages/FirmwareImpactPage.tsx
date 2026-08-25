import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircuitBoard, FlaskConical, Minus, TrendingDown, TrendingUp } from 'lucide-react';

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

import { useDrives } from '@/api/hooks/useDriving';
import { useSoftwareUpdates } from '@/api/hooks/useVehicleSystems';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { chartTokens } from '@/lib/tokens';
import { formatDateShort } from '@/lib/dateFormat';

import { analyzeFirmwareImpact, type ImpactVerdict } from '../lib/firmwareImpact';

const VERDICT_BADGE: Record<ImpactVerdict, 'success' | 'danger' | 'neutral' | 'warning'> = {
  better: 'success',
  worse: 'danger',
  noChange: 'neutral',
  insufficient: 'warning',
};

const VERDICT_DEFAULT: Record<ImpactVerdict, string> = {
  better: 'More efficient',
  worse: 'Less efficient',
  noChange: 'No measurable change',
  insufficient: 'Not enough drives',
};

export default function FirmwareImpactPage() {
  const { t } = useTranslation();
  usePageTitle(t('firmwareImpact.title', 'Firmware Impact'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const drivesQuery = useDrives(vehicleIdStr);
  const updatesQuery = useSoftwareUpdates(vehicleIdStr ?? '');
  const dataSources = useMemo(
    () => [
      {
        id: 'drive-history',
        label: t('dataSources.labels.driveHistory', 'Drive history'),
        query: drivesQuery,
      },
      {
        id: 'software-updates',
        label: t('dataSources.labels.softwareUpdates', 'Software updates'),
        query: updatesQuery,
      },
    ],
    [drivesQuery, t, updatesQuery],
  );

  const summary = useMemo(
    () =>
      analyzeFirmwareImpact(
        (updatesQuery.data ?? []).map((u) => ({
          version: u.version ?? '',
          installedAt: u.installedAt ?? null,
          status: u.status ?? undefined,
        })),
        drivesQuery.data ?? [],
      ),
    [updatesQuery.data, drivesQuery.data],
  );

  const chartData = useMemo(
    () =>
      summary.impacts
        .filter((i) => i.verdict !== 'insufficient')
        .map((i) => ({
          version: i.version,
          delta: Math.round(i.deltaWhPerKm * 10) / 10,
          share: Math.round(i.deltaShare * 1000) / 10,
          p: i.p != null ? Math.round(i.p * 1000) / 1000 : null,
          verdict: i.verdict,
        })),
    [summary.impacts],
  );

  const exportData = useMemo(
    () => chartData.map(({ verdict, ...rest }) => ({ ...rest, verdict: String(verdict) })),
    [chartData],
  );

  const best = useMemo(
    () =>
      summary.impacts
        .filter((i) => i.verdict === 'better')
        .sort((a, b) => a.deltaWhPerKm - b.deltaWhPerKm)[0] ?? null,
    [summary.impacts],
  );
  const worst = useMemo(
    () =>
      summary.impacts
        .filter((i) => i.verdict === 'worse')
        .sort((a, b) => b.deltaWhPerKm - a.deltaWhPerKm)[0] ?? null,
    [summary.impacts],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('firmwareImpact.title', 'Firmware Impact')} />;
  }

  const drivesHaveData = drivesQuery.data !== undefined;
  const updatesHaveData = updatesQuery.data !== undefined;
  const isLoading =
    (!drivesHaveData && drivesQuery.isLoading)
    || (!updatesHaveData && updatesQuery.isLoading);
  const isError =
    (drivesQuery.isError && !drivesHaveData)
    || (updatesQuery.isError && !updatesHaveData);
  const error =
    drivesQuery.isError && !drivesHaveData
      ? drivesQuery.error
      : updatesQuery.error;

  return (
    <PageContainer
      title={t('firmwareImpact.title', 'Firmware Impact')}
      subtitle={t(
        'firmwareImpact.subtitle',
        'A controlled before-and-after test of every software update, judged by Welch\u2019s t-test on your real consumption',
      )}
      query={[drivesQuery, updatesQuery]}
      dataSources={dataSources}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('firmwareImpact.kpis', 'Firmware impact metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError
                error={error}
                onRetry={() => {
                  void drivesQuery.refetch();
                  void updatesQuery.refetch();
                }}
              />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('firmwareImpact.tested', 'Updates Tested')}
                value={summary.impacts.length}
                subtitle={t('firmwareImpact.skipped', '{{n}} skipped for thin data', {
                  n: summary.skipped,
                })}
                icon={<CircuitBoard className="h-5 w-5" />}
                color="cyan"
                help={{
                  i18nKey: 'help.firmwareImpact.tested',
                  defaultValue:
                    'Each install splits your drives into a before window and an after window, clipped so no drive is ever credited to two versions. The two consumption samples are compared with Welch\u2019s t-test, which — unlike the ordinary t-test — does not assume the two periods had equal variance, and that matters because driving conditions are never that tidy.',
                }}
              />
              <MetricCard
                label={t('firmwareImpact.significant', 'Statistically Real')}
                value={summary.significantCount}
                subtitle={t('firmwareImpact.significantHint', 'p < 0.05 with a non-trivial effect')}
                icon={<FlaskConical className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('firmwareImpact.best', 'Biggest Gain')}
                value={best != null ? `${Math.round(best.deltaWhPerKm * 10) / 10} Wh/km` : '—'}
                subtitle={best != null ? best.version : t('firmwareImpact.none', 'None detected')}
                icon={<TrendingDown className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('firmwareImpact.worst', 'Biggest Regression')}
                value={worst != null ? `+${Math.round(worst.deltaWhPerKm * 10) / 10} Wh/km` : '—'}
                subtitle={worst != null ? worst.version : t('firmwareImpact.none', 'None detected')}
                icon={<TrendingUp className="h-5 w-5" />}
                color={worst != null ? 'red' : 'blue'}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Delta per version */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && summary.impacts.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: comparisons appear automatically once enough drives straddle an update. */
              icon={<CircuitBoard className="h-8 w-8" />}
              message={t(
                'firmwareImpact.noData',
                'No update yet has enough drives on both sides of it to support a comparison. This fills in as you drive after each install.',
              )}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('firmwareImpact.chart', 'Consumption Change per Version')}
            subtitle={t(
              'firmwareImpact.chartHint',
              'Bars below the line mean the car got more efficient after that update',
            )}
            ariaLabel={t(
              'firmwareImpact.chart.aria',
              'Bar chart of the change in energy consumption in watt-hours per kilometre after each firmware version',
            )}
            loading={isLoading}
            empty={chartData.length === 0}
            height={340}
            data={exportData}
            dataColumns={[
              { key: 'version', label: t('firmwareImpact.col.version', 'Version') },
              { key: 'delta', label: t('firmwareImpact.col.delta', 'Δ Wh/km') },
              { key: 'share', label: t('firmwareImpact.col.share', 'Δ %') },
              { key: 'p', label: t('firmwareImpact.col.p', 'p-value') },
              { key: 'verdict', label: t('firmwareImpact.col.verdict', 'Verdict') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 16, right: 16, bottom: 32, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis
                  dataKey="version"
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                  angle={-30}
                  textAnchor="end"
                  height={56}
                />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} unit=" Wh/km" />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine y={0} stroke="var(--text-muted)" />
                <Bar dataKey="delta" name={t('firmwareImpact.col.delta', 'Δ Wh/km')} radius={[3, 3, 0, 0]}>
                  {chartData.map((d) => (
                    <Cell
                      key={d.version}
                      fill={
                        d.verdict === 'better'
                          ? chartTokens.series[2]
                          : d.verdict === 'worse'
                            ? chartTokens.series[5]
                            : chartTokens.series[7]
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Per-version detail */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('firmwareImpact.detail', 'Version by Version')}
            <HelpTooltip
              size="sm"
              i18nKey="help.firmwareImpact.detail"
              defaultValue="A verdict needs two things at once: a p-value below 0.05, so the difference is unlikely to be chance, and a Cohen\u2019s d above a floor, so the difference is large enough to care about. Enough drives will make almost any difference statistically significant, which is exactly why the effect-size gate is there."
              ariaLabel={t('help.firmwareImpact.iconLabel', 'More info about the verdicts')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={180} />
          ) : summary.impacts.length === 0 ? (
            <EmptyState /* no-action: version detail is derived from the comparisons above. */
              icon={<Minus className="h-8 w-8" />}
              message={t(
                'firmwareImpact.noDetail',
                'Nothing to compare yet — each update needs drives recorded both before and after it.',
              )}
            />
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {summary.impacts.map((i) => (
                <li
                  key={`${i.version}-${i.installedMs}`}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Text variant="body" className="font-medium">{i.version}</Text>
                    <Badge variant={VERDICT_BADGE[i.verdict]}>
                      {t(`firmwareImpact.verdict.${i.verdict}`, VERDICT_DEFAULT[i.verdict])}
                    </Badge>
                    <Text variant="caption">
                      {formatDateShort(i.installedAt)}
                    </Text>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                    <Text variant="caption">
                      {t('firmwareImpact.before', 'Before')}
                    </Text>
                    <Text variant="bodySm">
                      {t('firmwareImpact.whPerKmN', '{{v}} Wh/km · n={{n}}', {
                        v: Math.round(i.before.meanWhPerKm),
                        n: i.before.n,
                      })}
                    </Text>
                    <Text variant="caption">
                      {t('firmwareImpact.after', 'After')}
                    </Text>
                    <Text variant="bodySm">
                      {t('firmwareImpact.whPerKmN', '{{v}} Wh/km · n={{n}}', {
                        v: Math.round(i.after.meanWhPerKm),
                        n: i.after.n,
                      })}
                    </Text>
                    <Text variant="caption">
                      {t('firmwareImpact.change', 'Change')}
                    </Text>
                    <Text variant="bodySm">
                      {`${i.deltaWhPerKm > 0 ? '+' : ''}${Math.round(i.deltaWhPerKm * 10) / 10} Wh/km (${
                        i.deltaShare > 0 ? '+' : ''
                      }${Math.round(i.deltaShare * 1000) / 10}%)`}
                    </Text>
                    <Text variant="caption">
                      {t('firmwareImpact.stats', 'p · d')}
                    </Text>
                    <Text variant="bodySm">
                      {i.p != null && i.cohensD != null
                        ? `${i.p < 0.001 ? '<0.001' : i.p.toFixed(3)} · ${Math.abs(i.cohensD).toFixed(2)}`
                        : '—'}
                    </Text>
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
