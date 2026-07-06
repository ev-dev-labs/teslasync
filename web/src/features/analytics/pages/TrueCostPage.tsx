import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign, Fuel, Zap, TrendingUp, Leaf, Wrench, PiggyBank } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { MetricCard, Currency, DataFreshnessAuto } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { VehicleSelect } from '@/components/forms';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Legend,
  ChartContainer, ChartTooltip, ChartGradient, chartGrid, axisTick,
} from '@/components/charts';
import { AITCONarration } from '@/components/ai/AITCONarration';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useCostBreakdown } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { useSettings } from '@/hooks/useSettings';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';

/* Chart series colors — dynamic hex handed to Recharts (EV cyan / ICE red / savings green). */
const COLOR_EV = '#00f0ff';
const COLOR_ICE = '#ef4444';
const COLOR_SAVINGS = '#10b981';

/**
 * Render a date string, falling back to an em dash for missing values.
 * The API models `first_date` / `last_date` as non-nullable strings but
 * returns `""` when a vehicle has no charging history yet, so a plain
 * `?? '—'` (nullish only) would leak an empty gap into the date range.
 */
function dateOrDash(value: string | null | undefined): string {
  return typeof value === 'string' && value.trim() ? value : '—';
}

/* ── Component ── */

export default function TrueCostPage() {
  const { t } = useTranslation();
  usePageTitle(t('tco.title', 'Total Cost of Ownership'));

  const { unitPrefs, formatEnergy } = useUnits();
  const { formatCurrency } = useFormatting();
  const { settings } = useSettings();
  const distanceUnit = unitPrefs.distance;
  const gasUnit = settings.gas_unit ?? 'gallon';
  const gasUnitLabel = gasUnit === 'liter'
    ? t('common.unit.liter', 'L')
    : t('common.unit.gallon', 'gal');

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : '';

  const tcoQuery = useCostBreakdown(vehicleIdStr);
  const { data: tco, isLoading, isError, error, refetch } = tcoQuery;
  const onRetry = useCallback(() => { void refetch(); }, [refetch]);

  const fmtCurrency = useCallback((v: number) => formatCurrency(v), [formatCurrency]);
  const monthlyBreakdown = tco?.monthly_breakdown ?? [];

  // Stable, memoised two-bar comparison so the cost-per-km chart doesn't
  // receive a freshly-allocated data array (and re-run its layout) on every
  // unrelated re-render of the page.
  const costPerKmData = useMemo(
    () => [
      { name: t('tco.evElectric', 'EV (Electric)'), cost: tco?.cost_per_km_ev ?? 0, fill: COLOR_EV },
      { name: t('tco.iceGas', 'ICE (Gas)'), cost: tco?.cost_per_km_ice ?? 0, fill: COLOR_ICE },
    ],
    [t, tco?.cost_per_km_ev, tco?.cost_per_km_ice],
  );

  return (
    <PageContainer
      title={t('tco.title', 'Total Cost of Ownership')}
      subtitle={t('tco.subtitle', 'Compare your EV running costs against an equivalent gas vehicle')}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          {/* Cagg-driven; force amber after 6h to surface stale aggregates. */}
          <DataFreshnessAuto query={tcoQuery} forceStaleAfterMs={6 * 60 * 60 * 1000} />
        </div>
      }
    >
      {/* Opt-in Helix narrator — self-gated via withAiFeature (absent in ai-off mode),
          rendered outside the data gate; it never replaces the charts below. */}
      <AITCONarration vehicleId={vehicleId ?? undefined} />

      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('tco.kpis', 'Cost summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={error} onRetry={onRetry} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={104} className="rounded-xl" />
            ))
          ) : tco ? (
            <>
              <MetricCard
                label={t('tco.totalEvCost', 'Total EV Cost')}
                value={fmtCurrency(tco.total_charging_cost ?? 0)}
                icon={<Zap className="h-5 w-5" />}
                color="cyan"
                subtitle={`${formatEnergy(tco.total_wh ?? 0)} · ${fmtInt(tco.total_sessions ?? 0)} ${t('tco.sessions', 'sessions')}`}
              />
              <MetricCard
                label={t('tco.equivGasCost', 'Equiv. Gas Cost')}
                value={fmtCurrency(tco.equivalent_gas_cost ?? 0)}
                icon={<Fuel className="h-5 w-5" />}
                color="red"
                subtitle={`@ ${formatCurrency(tco.gas_price ?? 0)}/${gasUnitLabel} · ${fmtNumber(tco.gas_efficiency_mpg ?? 0)} ${t('tco.mpg', 'MPG')}`}
              />
              <MetricCard
                label={t('tco.totalSavings', 'Total Savings')}
                value={fmtCurrency(tco.total_savings ?? 0)}
                icon={<Leaf className="h-5 w-5" />}
                color="green"
                subtitle={t('tco.overMonths', 'Over {{months}} months', { months: fmtNumber(tco.months_of_ownership ?? 0) })}
              />
              <MetricCard
                label={t('tco.monthlySavings', 'Monthly Savings')}
                value={fmtCurrency(tco.monthly_savings ?? 0)}
                icon={<TrendingUp className="h-5 w-5" />}
                color="green"
                subtitle={t('tco.plusMaintenance', '+ ~$50/mo maintenance savings')}
              />
            </>
          ) : (
            <GlassPanel className="col-span-full p-8">
              <EmptyState /* no-action: transient empty state — no cost data until a charging session exists */
                icon={<DollarSign className="h-10 w-10" />}
                message={t('tco.noData', 'No data available. Start charging to see your cost analysis.')}
              />
            </GlassPanel>
          )}
        </section>
      </FadeIn>

      {/* 2 — Hero bento: cumulative savings (spans 2) + savings breakdown (spans 1) */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* chart-a11y:no-table derived cumulative metric; each month's value is
              restated in the savings-breakdown panel rendered beside this chart */}
          <ChartContainer
            title={t('tco.cumulativeSavings', 'Cumulative Savings Over Time')}
            ariaLabel={t('tco.cumulativeSavings.aria', 'Cumulative EV-vs-gas savings area chart over time')}
            exportable
            exportFilename="cumulative-savings"
            height={340}
            className="xl:col-span-2"
          >
            {isError ? (
              <QueryError error={error} onRetry={onRetry} />
            ) : isLoading ? (
              <Skeleton height="100%" className="rounded-xl" />
            ) : monthlyBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyBreakdown}>
                  <defs>
                    <ChartGradient id="savingsGrad" color={COLOR_SAVINGS} opacity={0.4} />
                  </defs>
                  {chartGrid}
                  <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCurrency(v, 0)} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="cumulative_savings"
                    stroke={COLOR_SAVINGS}
                    fill="url(#savingsGrad)"
                    strokeWidth={2}
                    name={t('tco.cumulativeSavings', 'Cumulative Savings')}
                    animationDuration={800}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState /* no-action: transient empty state — no monthly rollups yet */
                message={t('tco.noMonthlyData', 'No monthly data available yet')}
              />
            )}
          </ChartContainer>

          {/* Savings breakdown — fills the column beside the hero chart on wide screens */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('tco.savingsBreakdown', 'Savings Breakdown')}
            </PanelTitle>
            {isError ? (
              <QueryError error={error} onRetry={onRetry} />
            ) : isLoading ? (
              <Skeleton height={220} className="rounded-xl" />
            ) : tco ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
                  <Text as="p" variant="metricLabel" className="mb-2 flex items-center gap-1.5">
                    <Leaf className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                    {t('tco.fuelSavings', 'Fuel Savings')}
                  </Text>
                  <Text as="p" size="xl" weight="bold" className="tabular-nums text-emerald-300">{fmtCurrency(tco.total_savings ?? 0)}</Text>
                  <Text as="p" variant="caption" className="mt-1">{t('tco.electricityVsGas', 'Electricity vs gasoline')}</Text>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
                  <Text as="p" variant="metricLabel" className="mb-2 flex items-center gap-1.5">
                    <Wrench className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                    {t('tco.maintenanceSavings', 'Maintenance Savings (Est.)')}
                  </Text>
                  <Text as="p" size="xl" weight="bold" className="tabular-nums text-emerald-300">{fmtCurrency(tco.maintenance_savings_estimate ?? 0)}</Text>
                  <Text as="p" variant="caption" className="mt-1">{t('tco.noOilChanges', 'No oil changes, less brake wear')}</Text>
                </div>
                <div className="rounded-xl border border-neon-green/20 bg-neon-green/10 p-4">
                  <Text as="p" variant="metricLabel" className="mb-2 flex items-center gap-1.5">
                    <PiggyBank className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                    {t('tco.totalEstSavings', 'Total Estimated Savings')}
                  </Text>
                  <Text as="p" size="xl" weight="bold" className="tabular-nums text-emerald-300">{fmtCurrency((tco.total_savings ?? 0) + (tco.maintenance_savings_estimate ?? 0))}</Text>
                  <Text as="p" variant="caption" className="mt-1">
                    {fmtInt(convertDistanceFromSI((tco.total_km ?? 0) * 1000, distanceUnit))} {distanceUnit} · {dateOrDash(tco.first_date)} → {dateOrDash(tco.last_date)}
                  </Text>
                </div>
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — no savings until cost data exists */
                message={t('tco.noData', 'No data available. Start charging to see your cost analysis.')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Secondary bento: cost/km + monthly EV-vs-gas side-by-side on wide screens */}
      <FadeIn delay={0.2}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="space-y-3">
            {/* chart-a11y:no-table two-bar EV-vs-gas comparison; the numeric values
                are restated in the chips directly below the chart */}
            <ChartContainer
              title={t('tco.costPerKm', 'Cost per Kilometer')}
              ariaLabel={t('tco.costPerKm.aria', 'Cost per kilometer bar chart comparing EV electricity to gas')}
              exportable
              exportFilename="cost-per-km"
              height={240}
            >
              {isError ? (
                <QueryError error={error} onRetry={onRetry} />
              ) : isLoading ? (
                <Skeleton height="100%" className="rounded-xl" />
              ) : tco ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={costPerKmData}>
                    {chartGrid}
                    <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCurrency(v, 3)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="cost" name={t('tco.costKm', 'Cost/km')} radius={[6, 6, 0, 0]} animationDuration={800} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState /* no-action: transient empty state — no cost data yet */
                  message={t('tco.noData', 'No data available. Start charging to see your cost analysis.')}
                />
              )}
            </ChartContainer>
            {/* Cost-per-km values restated as at-a-glance chips below the chart. */}
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-xl border border-neon-cyan/20 bg-neon-cyan/10 p-3">
                <Text as="p" size="lg" weight="bold" className="tabular-nums text-cyan-300">
                  <Currency value={tco?.cost_per_km_ev} precision={3} />
                </Text>
                <Text as="p" variant="caption">{t('tco.perKmEv', 'per km (EV)')}</Text>
              </div>
              <div className="rounded-xl border border-neon-red/20 bg-neon-red/10 p-3">
                <Text as="p" size="lg" weight="bold" className="tabular-nums text-rose-300">
                  <Currency value={tco?.cost_per_km_ice} precision={3} />
                </Text>
                <Text as="p" variant="caption">{t('tco.perKmGas', 'per km (Gas)')}</Text>
              </div>
            </div>
          </div>

          {/* chart-a11y:no-table month-by-month rollup; aggregate savings are shown
              in the breakdown panel above */}
          <ChartContainer
            title={t('tco.monthlyEvVsGas', 'Monthly EV vs Gas Cost')}
            ariaLabel={t('tco.monthlyEvVsGas.aria', 'Monthly EV vs gas cost comparison bar chart')}
            exportable
            exportFilename="monthly-ev-vs-gas"
            height={296}
          >
            {isError ? (
              <QueryError error={error} onRetry={onRetry} />
            ) : isLoading ? (
              <Skeleton height="100%" className="rounded-xl" />
            ) : monthlyBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyBreakdown}>
                  {chartGrid}
                  <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCurrency(v, 0)} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="ev_cost" name={t('tco.evCost', 'EV Cost')} fill={COLOR_EV} radius={[4, 4, 0, 0]} animationDuration={800} />
                  <Bar dataKey="equiv_gas_cost" name={t('tco.gasEquiv', 'Gas Equiv.')} fill={COLOR_ICE} radius={[4, 4, 0, 0]} animationDuration={800} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState /* no-action: transient empty state — no monthly rollups yet */
                message={t('tco.noMonthlyData', 'No monthly data available yet')}
              />
            )}
          </ChartContainer>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
