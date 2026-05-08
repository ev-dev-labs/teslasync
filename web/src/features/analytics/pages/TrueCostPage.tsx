import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign, Fuel, Zap, TrendingUp, Leaf } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Select } from '@/components/ui';
import { Currency, DataFreshnessAuto } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Legend,
  ChartContainer, ChartTooltip, ChartGradient, chartGrid, axisTick,
} from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useCostBreakdown } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';

/* ── Component ── */

export default function TrueCostPage() {
  const { t } = useTranslation();
  usePageTitle(t('tco.title', 'Total Cost of Ownership'));
  const { unitPrefs, formatEnergy } = useUnits();
  const distanceUnit = unitPrefs.distance;

  const { data: vehicles } = useVehicles();
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null;
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : '';

  const tcoQuery = useCostBreakdown(vehicleIdStr);
  const { data: tco, isLoading, error } = tcoQuery;

  const fmtCurrency = (v: number) => `$${fmtNumber(v)}`;

  const monthlyBreakdown = tco?.monthly_breakdown ?? [];

  return (
    <PageContainer
      title={t('tco.title', 'True Cost of Ownership')}
      subtitle={t('tco.subtitle', 'Compare your EV running costs against an equivalent gas vehicle')}
      loading={isLoading}
      error={error instanceof Error ? error : null}
      actions={
        <div className="flex items-center gap-3">
          {vehicles && vehicles.length > 1 && (
            <Select
              value={String(vehicleId ?? '')}
              onChange={(e) => setSelectedVehicle(Number(e.target.value))}
              options={vehicles.map((v) => ({ value: String(v.id), label: v.display_name || v.vin }))}
            />
          )}
          {/* Cagg-driven; force amber after 6h to surface stale aggregates. */}
          <DataFreshnessAuto query={tcoQuery} forceStaleAfterMs={6 * 60 * 60 * 1000} />
        </div>
      }
    >
      {tco ? (
        <>
          {/* Hero stat cards */}
          <StaggerContainer className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StaggerItem>
              <GlassPanel className="p-5" glow="cyan" hover>
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="h-4 w-4 text-neon-cyan" />
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                    {t('tco.totalEvCost', 'Total EV Cost')}
                  </span>
                </div>
                <p className="text-2xl font-bold text-cyan-300">{fmtCurrency(tco.total_charging_cost)}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {formatEnergy(tco.total_wh)} · {tco.total_sessions} {t('tco.sessions', 'sessions')}
                </p>
              </GlassPanel>
            </StaggerItem>

            <StaggerItem>
              <GlassPanel className="p-5" hover>
                <div className="flex items-center gap-2 mb-3">
                  <Fuel className="h-4 w-4 text-neon-red" />
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                    {t('tco.equivGasCost', 'Equiv. Gas Cost')}
                  </span>
                </div>
                <p className="text-2xl font-bold text-rose-300">{fmtCurrency(tco.equivalent_gas_cost)}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  @ ${tco.gas_price}/{t('tco.gal', 'gal')} · {tco.gas_efficiency_mpg} MPG
                </p>
              </GlassPanel>
            </StaggerItem>

            <StaggerItem>
              <GlassPanel className="p-5" glow="green" hover>
                <div className="flex items-center gap-2 mb-3">
                  <Leaf className="h-4 w-4 text-neon-green" />
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                    {t('tco.totalSavings', 'Total Savings')}
                  </span>
                </div>
                <p className="text-2xl font-bold text-emerald-300">{fmtCurrency(tco.total_savings)}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {t('tco.overMonths', 'Over {{months}} months', { months: fmtNumber(tco.months_of_ownership) })}
                </p>
              </GlassPanel>
            </StaggerItem>

            <StaggerItem>
              <GlassPanel className="p-5" glow="green" hover>
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="h-4 w-4 text-neon-green" />
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                    {t('tco.monthlySavings', 'Monthly Savings')}
                  </span>
                </div>
                <p className="text-2xl font-bold text-emerald-300">{fmtCurrency(tco.monthly_savings)}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {t('tco.plusMaintenance', '+ ~$50/mo maintenance savings')}
                </p>
              </GlassPanel>
            </StaggerItem>
          </StaggerContainer>

          {/* Cumulative savings chart */}
          <FadeIn>
            {/* chart-a11y:no-table area chart of derived cumulative metric — value at any month is announced by the description */}
            <ChartContainer
              title={t('tco.cumulativeSavings', 'Cumulative Savings Over Time')}
              ariaLabel={t('tco.cumulativeSavings.aria', 'Cumulative EV-vs-gas savings area chart over time')}
              exportable
              exportFilename="cumulative-savings"
            >
              {monthlyBreakdown.length > 0 ? (
                <div className="h-64 sm:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyBreakdown}>
                      <defs>
                        <ChartGradient id="savingsGrad" color="#10b981" opacity={0.4} />
                      </defs>
                      {chartGrid}
                      <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
                      <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v}`} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="cumulative_savings"
                        stroke="#10b981"
                        fill="url(#savingsGrad)"
                        strokeWidth={2}
                        name={t('tco.cumulativeSavings', 'Cumulative Savings')}
                        animationDuration={800}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('tco.noMonthlyData', 'No monthly data available yet')} />
              )}
            </ChartContainer>
          </FadeIn>

          {/* Cost per km comparison + Monthly EV vs Gas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FadeIn delay={0.1}>
              {/* chart-a11y:no-table EV-vs-gas comparison; numeric values announced via the cards below the chart */}
              <ChartContainer
                title={t('tco.costPerKm', 'Cost per Kilometer')}
                ariaLabel={t('tco.costPerKm.aria', 'Cost per kilometer bar chart comparing EV electricity to gas')}
                exportable
                exportFilename="cost-per-km"
              >
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { name: t('tco.evElectric', 'EV (Electric)'), cost: tco.cost_per_km_ev, fill: '#00f0ff' },
                      { name: t('tco.iceGas', 'ICE (Gas)'), cost: tco.cost_per_km_ice, fill: '#ef4444' },
                    ]}>
                      {chartGrid}
                      <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} />
                      <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${fmtNumber(v, 3)}`} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="cost" name={t('tco.costKm', 'Cost/km')} radius={[6, 6, 0, 0]} animationDuration={800} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4 text-center">
                  <div className="rounded-xl bg-neon-cyan/10 p-3 border border-neon-cyan/20">
                    <p className="text-lg font-bold text-cyan-300"><Currency value={tco.cost_per_km_ev} precision={3} /></p>
                    <p className="text-xs text-[var(--text-muted)]">{t('tco.perKmEv', 'per km (EV)')}</p>
                  </div>
                  <div className="rounded-xl bg-neon-red/10 p-3 border border-neon-red/20">
                    <p className="text-lg font-bold text-rose-300"><Currency value={tco.cost_per_km_ice} precision={3} /></p>
                    <p className="text-xs text-[var(--text-muted)]">{t('tco.perKmGas', 'per km (Gas)')}</p>
                  </div>
                </div>
              </ChartContainer>
            </FadeIn>

            <FadeIn delay={0.2}>
              {/* chart-a11y:no-table month-by-month rollup bar chart; SR users get aggregate via the savings breakdown panel */}
              <ChartContainer
                title={t('tco.monthlyEvVsGas', 'Monthly EV vs Gas Cost')}
                ariaLabel={t('tco.monthlyEvVsGas.aria', 'Monthly EV vs gas cost comparison bar chart')}
                exportable
                exportFilename="monthly-ev-vs-gas"
              >
                {monthlyBreakdown.length > 0 ? (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthlyBreakdown}>
                        {chartGrid}
                        <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
                        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v}`} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="ev_cost" name={t('tco.evCost', 'EV Cost')} fill="#00f0ff" radius={[4, 4, 0, 0]} animationDuration={800} />
                        <Bar dataKey="equiv_gas_cost" name={t('tco.gasEquiv', 'Gas Equiv.')} fill="#ef4444" radius={[4, 4, 0, 0]} animationDuration={800} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('tco.noMonthlyData', 'No monthly data available yet')} />
                )}
              </ChartContainer>
            </FadeIn>
          </div>

          {/* Breakdown summary */}
          <FadeIn delay={0.3}>
            <GlassPanel className="p-6">
              <h3 className="text-base font-semibold text-[var(--text-primary)] mb-6 flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-neon-green" />
                {t('tco.savingsBreakdown', 'Savings Breakdown')}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    {t('tco.fuelSavings', 'Fuel Savings')}
                  </p>
                  <p className="text-xl font-bold text-emerald-300">{fmtCurrency(tco.total_savings)}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{t('tco.electricityVsGas', 'Electricity vs gasoline')}</p>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    {t('tco.maintenanceSavings', 'Maintenance Savings (Est.)')}
                  </p>
                  <p className="text-xl font-bold text-emerald-300">{fmtCurrency(tco.maintenance_savings_estimate)}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{t('tco.noOilChanges', 'No oil changes, less brake wear')}</p>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    {t('tco.totalEstSavings', 'Total Estimated Savings')}
                  </p>
                  <p className="text-xl font-bold text-emerald-300">
                    {fmtCurrency(tco.total_savings + tco.maintenance_savings_estimate)}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {fmtInt(convertDistanceFromSI((tco.total_km ?? 0) * 1000, distanceUnit))} {distanceUnit} · {tco.first_date} → {tco.last_date}
                  </p>
                </div>
              </div>
            </GlassPanel>
          </FadeIn>
        </>
      ) : !isLoading ? (
        <GlassPanel className="p-8">
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<DollarSign className="h-10 w-10 text-[var(--text-muted)]" />}
            message={t('tco.noData', 'No data available. Start charging to see your cost analysis.')}
          />
        </GlassPanel>
      ) : null}
    </PageContainer>
  );
}
