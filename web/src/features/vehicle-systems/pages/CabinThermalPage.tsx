import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Snowflake, Thermometer, TrendingDown, Waves } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
  LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from '@/components/charts';

import { useClimateHistory } from '@/api/hooks/useVehicleSystems';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { chartTokens } from '@/lib/tokens';

import { summarizeCabinThermal, buildSoakCurve, minutesToReach } from '../lib/cabinThermal';

/** Illustrative soak: a hot cabin on a warm day, projected with the fitted τ. */
const DEMO_START_C = 45;
const DEMO_AMBIENT_C = 22;
const DEMO_TARGET_C = 25;
const DEMO_HORIZON_MIN = 240;

export default function CabinThermalPage() {
  const { t } = useTranslation();
  usePageTitle(t('cabinThermal.title', 'Cabin Thermal Model'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatTemperature } = useUnits();

  const climateQuery = useClimateHistory(vehicleIdStr ?? '');

  const summary = useMemo(
    () => summarizeCabinThermal(climateQuery.data ?? []),
    [climateQuery.data],
  );

  const curve = useMemo(() => {
    if (summary.tauMin == null) return [];
    return buildSoakCurve(DEMO_START_C, DEMO_AMBIENT_C, summary.tauMin, DEMO_HORIZON_MIN, 10).map(
      (p) => ({
        minutes: p.minutes,
        cabin: p.cabinC,
      }),
    );
  }, [summary.tauMin]);

  const scatter = useMemo(
    () =>
      summary.events.map((e) => ({
        gap: Math.round((e.startInsideC - e.ambientC) * 10) / 10,
        tau: Math.round(e.tauMin),
        r2: Math.round(e.r2 * 100) / 100,
        cooling: e.cooling,
      })),
    [summary.events],
  );

  const coolingPoints = useMemo(() => scatter.filter((p) => p.cooling), [scatter]);
  const warmingPoints = useMemo(() => scatter.filter((p) => !p.cooling), [scatter]);

  const exportScatter = useMemo(
    () => scatter.map(({ cooling, ...rest }) => ({ ...rest, direction: cooling ? 'cooling' : 'warming' })),
    [scatter],
  );

  const minutesToComfort = useMemo(
    () =>
      summary.tauMin == null
        ? null
        : minutesToReach(DEMO_START_C, DEMO_AMBIENT_C, summary.tauMin, DEMO_TARGET_C),
    [summary.tauMin],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('cabinThermal.title', 'Cabin Thermal Model')} />;
  }

  const isLoading = climateQuery.isLoading;
  const isError = climateQuery.isError;

  return (
    <PageContainer
      title={t('cabinThermal.title', 'Cabin Thermal Model')}
      subtitle={t(
        'cabinThermal.subtitle',
        "Newton's law of cooling fitted to your own parked cabin, giving the time constant that predicts how fast it soaks toward ambient",
      )}
      query={climateQuery}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('cabinThermal.kpis', 'Cabin thermal metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={climateQuery.error} onRetry={() => climateQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('cabinThermal.tau', 'Time Constant τ')}
                value={summary.tauMin != null ? `${summary.tauMin} min` : '—'}
                subtitle={t('cabinThermal.tauHint', 'to close 63 % of the gap to ambient')}
                icon={<Thermometer className="h-5 w-5" />}
                color="cyan"
                help={{
                  i18nKey: 'help.cabinThermal.tau',
                  defaultValue:
                    "A parked cabin approaches outside temperature exponentially. Taking the log of the temperature gap turns that curve into a straight line whose slope is −1/τ, so a least-squares fit on each parked window recovers the cabin's thermal time constant directly from your own data — no manufacturer figure required.",
                }}
              />
              <MetricCard
                label={t('cabinThermal.halfLife', 'Half-Life')}
                value={summary.halfLifeMin != null ? `${summary.halfLifeMin} min` : '—'}
                subtitle={t('cabinThermal.halfLifeHint', 'to lose half the temperature gap')}
                icon={<TrendingDown className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('cabinThermal.fitQuality', 'Fit Quality')}
                value={summary.meanR2 != null ? `${Math.round(summary.meanR2 * 100)}%` : '—'}
                subtitle={t('cabinThermal.fitQualityHint', 'mean R² across soak windows')}
                icon={<Waves className="h-5 w-5" />}
                color={
                  (summary.meanR2 ?? 0) >= 0.9 ? 'green' : (summary.meanR2 ?? 0) >= 0.7 ? 'amber' : 'blue'
                }
              />
              <MetricCard
                label={t('cabinThermal.windows', 'Soak Windows')}
                value={summary.events.length}
                subtitle={t('cabinThermal.windowsHint', '{{n}} rejected as unusable', {
                  n: summary.rejectedWindows,
                })}
                icon={<Snowflake className="h-5 w-5" />}
                color="blue"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Predicted soak curve */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && summary.tauMin == null ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: soak windows accrue on their own whenever the car sits parked with climate reporting. */
              icon={<Thermometer className="h-8 w-8" />}
              message={t(
                'cabinThermal.noFit',
                'No usable soak window yet. The model needs a stretch of parked time where inside and outside temperature were both being reported.',
              )}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('cabinThermal.curve', 'Predicted Soak Curve')}
            subtitle={t(
              'cabinThermal.curveHint',
              'A {{start}} cabin left in {{ambient}} weather, projected with your fitted time constant',
              {
                start: formatTemperature(DEMO_START_C, { precision: 0 }),
                ambient: formatTemperature(DEMO_AMBIENT_C, { precision: 0 }),
              },
            )}
            ariaLabel={t(
              'cabinThermal.curve.aria',
              'Line chart of predicted cabin temperature decaying toward ambient over four hours',
            )}
            loading={isLoading}
            empty={curve.length === 0}
            height={340}
            data={curve}
            dataColumns={[
              { key: 'minutes', label: t('cabinThermal.col.minutes', 'Minutes parked') },
              { key: 'cabin', label: t('cabinThermal.col.cabin', 'Cabin (°C)') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis
                  dataKey="minutes"
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  unit=" min"
                />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} unit="°" />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine
                  y={DEMO_AMBIENT_C}
                  stroke={chartTokens.series[2]}
                  strokeDasharray="4 4"
                  label={{
                    value: t('cabinThermal.ambient', 'Ambient'),
                    position: 'right',
                    fill: 'var(--text-muted)',
                    fontSize: 11,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="cabin"
                  name={t('cabinThermal.cabin', 'Cabin')}
                  stroke={chartTokens.series[0]}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — τ against starting gap */}
      <FadeIn delay={0.2}>
        <ChartContainer
          title={t('cabinThermal.scatter', 'Time Constant by Starting Gap')}
          subtitle={t(
            'cabinThermal.scatterHint',
            'A genuinely first-order cabin gives roughly the same τ regardless of how big the initial gap was',
          )}
          ariaLabel={t(
            'cabinThermal.scatter.aria',
            'Scatter plot of fitted thermal time constant against the starting temperature gap, split by cooling and warming windows',
          )}
          loading={isLoading}
          empty={scatter.length === 0}
          height={320}
          data={exportScatter}
          dataColumns={[
            { key: 'gap', label: t('cabinThermal.col.gap', 'Start gap (°C)') },
            { key: 'tau', label: t('cabinThermal.col.tau', 'τ (min)') },
            { key: 'r2', label: t('cabinThermal.col.r2', 'R²') },
            { key: 'direction', label: t('cabinThermal.col.direction', 'Direction') },
          ]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 16, right: 16, bottom: 24, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis
                type="number"
                dataKey="gap"
                name={t('cabinThermal.col.gap', 'Start gap (°C)')}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="tau"
                name={t('cabinThermal.col.tau', 'τ (min)')}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ strokeDasharray: '3 3' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Scatter
                name={t('cabinThermal.cooling', 'Cooling down')}
                data={coolingPoints}
                fill={chartTokens.series[0]}
                fillOpacity={0.8}
              />
              <Scatter
                name={t('cabinThermal.warming', 'Warming up')}
                data={warmingPoints}
                fill={chartTokens.series[3]}
                fillOpacity={0.8}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </ChartContainer>
      </FadeIn>

      {/* 4 — What it means */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Waves className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('cabinThermal.readout', 'What Your τ Means')}
            <HelpTooltip
              size="sm"
              i18nKey="help.cabinThermal.readout"
              defaultValue="Cooling and warming time constants are fitted separately because they are not the same physical process: a cabin shedding heat radiates through glass, while a cold cabin gains heat mostly by conduction. A large difference between the two is normal and informative."
              ariaLabel={t('help.cabinThermal.iconLabel', 'More info about the thermal readout')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={140} />
          ) : summary.tauMin == null ? (
            <EmptyState /* no-action: the readout is derived from the fit and appears with it. */
              icon={<Snowflake className="h-8 w-8" />}
              message={t(
                'cabinThermal.noReadout',
                'The readout appears once at least one parked window has been fitted.',
              )}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <Text variant="caption" as="p" className="mb-1">
                  {t('cabinThermal.coolingTau', 'Cooling time constant')}
                </Text>
                <Text variant="body">
                  {summary.coolingTauMin != null
                    ? t('cabinThermal.minutes', '{{n}} min', { n: summary.coolingTauMin })
                    : t('cabinThermal.notMeasured', 'Not measured yet')}
                </Text>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <Text variant="caption" as="p" className="mb-1">
                  {t('cabinThermal.warmingTau', 'Warming time constant')}
                </Text>
                <Text variant="body">
                  {summary.warmingTauMin != null
                    ? t('cabinThermal.minutes', '{{n}} min', { n: summary.warmingTauMin })
                    : t('cabinThermal.notMeasured', 'Not measured yet')}
                </Text>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 sm:col-span-2">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant="info">{t('cabinThermal.worked', 'Worked example')}</Badge>
                  <Text variant="caption">
                    {t('cabinThermal.exampleLabel', '{{start}} cabin, {{ambient}} outside', {
                      start: formatTemperature(DEMO_START_C, { precision: 0 }),
                      ambient: formatTemperature(DEMO_AMBIENT_C, { precision: 0 }),
                    })}
                  </Text>
                </div>
                <Text variant="body">
                  {minutesToComfort != null
                    ? t(
                        'cabinThermal.example',
                        'It takes about {{n}} minutes of simply sitting there to fall to {{target}} — so a precondition started later than that is wasted energy.',
                        {
                          n: minutesToComfort,
                          target: formatTemperature(DEMO_TARGET_C, { precision: 0 }),
                        },
                      )
                    : t(
                        'cabinThermal.exampleUnreachable',
                        'Passive soaking alone never reaches that target from this starting point — active cooling is the only route.',
                      )}
                </Text>
              </div>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
