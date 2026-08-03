import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Target, Flame, Trophy, Gauge } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Text, Input, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
  BarChart, Bar, Cell, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useDrives } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useStoredNumber } from '@/hooks/useStoredNumber';
import { usePageTitle } from '@/hooks/usePageTitle';
import { convertDistanceToSI } from '@/lib/unitConversion';
import { chartTokens } from '@/lib/tokens';

import { summarizeTarget } from '../lib/efficiencyTarget';

/** km per statute mile, derived from the shared conversion lib. */
const KM_PER_MILE = convertDistanceToSI(1, 'mi') / 1000;

export default function EfficiencyTargetPage() {
  const { t } = useTranslation();
  usePageTitle(t('effTarget.title', 'Efficiency Target'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { unitPrefs } = useUnits();

  // Canonical target is Wh/km; edited in the user's display unit.
  const [targetWhPerKm, setTargetWhPerKm] = useStoredNumber('teslasync:efficiency-target:v1', 160);

  const drivesQuery = useDrives(vehicleIdStr);

  const summary = useMemo(
    () => summarizeTarget(drivesQuery.data ?? [], targetWhPerKm),
    [drivesQuery.data, targetWhPerKm],
  );

  const isMiles = unitPrefs.distance === 'mi';
  const effUnit = isMiles ? t('effTarget.whPerMi', 'Wh/mi') : t('effTarget.whPerKm', 'Wh/km');
  const toDisplay = (whPerKm: number) => Math.round(isMiles ? whPerKm * KM_PER_MILE : whPerKm);
  const targetDisplay = toDisplay(targetWhPerKm);

  function handleTargetChange(text: string): void {
    if (text === '') return;
    const n = Number(text);
    if (!Number.isFinite(n) || n <= 0) return;
    setTargetWhPerKm(isMiles ? n / KM_PER_MILE : n);
  }

  const chartData = useMemo(
    () =>
      summary.weeks.map((w) => ({
        week: w.weekStart.substring(5),
        consumption: toDisplay(w.whPerKm),
        // String, not boolean: rows feed ChartContainer's a11y fallback
        // table, whose cells are string | number only.
        hit: w.hit ? '✓' : '✗',
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toDisplay derives from isMiles
    [summary.weeks, isMiles],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('effTarget.title', 'Efficiency Target')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('effTarget.title', 'Efficiency Target')}
      subtitle={t('effTarget.subtitle', 'Set a consumption goal and defend it week after week')}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            step={5}
            aria-label={t('effTarget.targetInput', 'Weekly consumption target')}
            key={`target-${unitPrefs.distance}`}
            defaultValue={targetDisplay}
            onChange={(e) => handleTargetChange(e.target.value)}
            suffix={<span className="whitespace-nowrap">{effUnit}</span>}
            className="max-w-[9rem]"
          />
        </div>
      }
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('effTarget.kpis', 'Efficiency target summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('effTarget.target', 'Target')}
                value={`${targetDisplay} ${effUnit}`}
                icon={<Target className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('effTarget.streak', 'Current Streak')}
                value={t('effTarget.weeks', '{{count}} weeks', { count: summary.currentStreak })}
                subtitle={t('effTarget.longest', 'longest: {{count}}', { count: summary.longestStreak })}
                icon={<Flame className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('effTarget.hitRate', 'Hit Rate')}
                value={summary.hitRate != null ? `${Math.round(summary.hitRate * 100)}%` : '—'}
                subtitle={t('effTarget.ofWeeks', 'of {{count}} weeks', { count: summary.weeks.length })}
                icon={<Trophy className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('effTarget.overall', 'Overall')}
                value={summary.overallWhPerKm != null ? `${toDisplay(summary.overallWhPerKm)} ${effUnit}` : '—'}
                subtitle={t('effTarget.analyzed', '{{count}} drives analyzed', { count: summary.analyzed })}
                icon={<Gauge className="h-5 w-5" />}
                color="purple"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Weekly bars vs target */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && summary.weeks.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState
              icon={<Target className="h-8 w-8" />}
              message={t('effTarget.noData', 'No drives with energy data yet.')}
              actionTo={{ label: t('effTarget.browseDrives', 'Browse drives'), to: '/drives' }}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('effTarget.chart', 'Weekly Consumption vs Target')}
            subtitle={t('effTarget.chartHint', 'Green weeks beat the target; the dashed line is your goal')}
            ariaLabel={t('effTarget.chart.aria', 'Weekly energy consumption bars against the target line')}
            loading={isLoading}
            empty={chartData.length === 0}
            height={340}
            data={chartData}
            dataColumns={[
              { key: 'week', label: t('effTarget.col.week', 'Week') },
              { key: 'consumption', label: `${t('effTarget.col.consumption', 'Consumption')} (${effUnit})` },
              { key: 'hit', label: t('effTarget.col.hit', 'Target hit') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="week" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine
                  y={targetDisplay}
                  stroke={chartTokens.series[5]}
                  strokeDasharray="6 4"
                  strokeOpacity={0.8}
                />
                <Bar
                  dataKey="consumption"
                  name={t('effTarget.consumption', 'Consumption')}
                  radius={[4, 4, 0, 0]}
                >
                  {chartData.map((w) => (
                    <Cell
                      key={w.week}
                      fill={w.hit === '✓' ? chartTokens.series[1] : chartTokens.series[3]}
                      fillOpacity={0.8}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Method note */}
      <FadeIn delay={0.2}>
        <GlassPanel className="flex items-center gap-3 p-4 sm:p-5">
          <Target className="h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />
          <Text variant="bodySm" className="flex-1">
            {t(
              'effTarget.methodNote',
              'Weeks run Monday to Sunday in your local time. A week hits the target when its distance-weighted consumption lands at or below your goal.',
            )}
          </Text>
          <HelpTooltip
            size="sm"
            i18nKey="help.efficiencyTarget.body"
            defaultValue="A week's consumption is total energy divided by total distance across its drives — short sub-km hops are excluded so parking maneuvers don't distort the grade."
            ariaLabel={t('help.efficiencyTarget.iconLabel', 'More info about the target math')}
          />
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
