import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getTCOAnalytics, Vehicle } from '../api'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton, ChartContainer, Select } from '../components/ui'
import { DollarSign, Fuel, Zap, TrendingUp, Leaf } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend,
} from 'recharts'
import { ChartTooltip, axisTickSm, chartGrid, ChartGradient } from '../components/Charts'
import { fmtNumber, fmtInt } from '../lib/numberFormat'
import { usePageTitle } from '../hooks/usePageTitle'

export default function TrueCostOwnership() {
  usePageTitle('Total Cost of Ownership')
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: tco, isLoading } = useQuery({
    queryKey: ['tco-analytics', vehicleId],
    queryFn: () => getTCOAnalytics(vehicleId!),
    enabled: vehicleId !== null,
  })

  const fmtCurrency = (v: number) => `$${fmtNumber(v)}`

  return (
    <div className="space-y-8">
      <PageHeader
        title="True Cost of Ownership"
        subtitle="Compare your EV running costs against an equivalent gas vehicle"
        icon={<DollarSign className="h-5 w-5 text-neon-green" />}
        actions={
          vehicles && vehicles.length > 1 ? (
            <Select
              value={String(vehicleId ?? '')}
              onChange={e => setSelectedVehicle(Number(e.target.value))}
              options={vehicles.map((v: Vehicle) => ({ value: String(v.id), label: v.display_name }))}
            />
          ) : undefined
        }
      />

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : tco ? (
        <>
          {/* Hero stat cards */}
          <StaggerContainer className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StaggerItem>
              <GlassPanel className="p-5" glow="cyan" hover>
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="h-4 w-4 text-neon-cyan" />
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Total EV Cost</span>
                </div>
                <p className="text-2xl font-bold text-neon-cyan">{fmtCurrency(tco.total_charging_cost)}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">{fmtNumber(tco.total_kwh)} kWh over {tco.total_sessions} sessions</p>
              </GlassPanel>
            </StaggerItem>

            <StaggerItem>
              <GlassPanel className="p-5" glow="red" hover>
                <div className="flex items-center gap-2 mb-3">
                  <Fuel className="h-4 w-4 text-neon-red" />
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Equiv. Gas Cost</span>
                </div>
                <p className="text-2xl font-bold text-neon-red">{fmtCurrency(tco.equivalent_gas_cost)}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">@ ${tco.gas_price}/gal · {tco.gas_efficiency_mpg} MPG</p>
              </GlassPanel>
            </StaggerItem>

            <StaggerItem>
              <GlassPanel className="p-5" glow="green" hover>
                <div className="flex items-center gap-2 mb-3">
                  <Leaf className="h-4 w-4 text-neon-green" />
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Total Savings</span>
                </div>
                <p className="text-2xl font-bold text-neon-green">{fmtCurrency(tco.total_savings)}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">Over {fmtNumber(tco.months_of_ownership)} months</p>
              </GlassPanel>
            </StaggerItem>

            <StaggerItem>
              <GlassPanel className="p-5" glow="green" hover>
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="h-4 w-4 text-neon-green" />
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Monthly Savings</span>
                </div>
                <p className="text-2xl font-bold text-neon-green">{fmtCurrency(tco.monthly_savings)}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">+ ~$50/mo maintenance savings</p>
              </GlassPanel>
            </StaggerItem>
          </StaggerContainer>

          {/* Cumulative savings chart */}
          <FadeIn>
            <ChartContainer title="Cumulative Savings Over Time" height="auto">
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={tco.monthly_breakdown}>
                    <defs>
                      <ChartGradient id="savingsGrad" color="#10b981" opacity={0.4} />
                    </defs>
                    {chartGrid}
                    <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
                    <YAxis tick={axisTickSm} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="cumulative_savings"
                      stroke="#10b981"
                      fill="url(#savingsGrad)"
                      strokeWidth={2}
                      name="Cumulative Savings"
                      animationDuration={800}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </ChartContainer>
          </FadeIn>

          {/* Cost per km comparison + Monthly EV vs Gas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FadeIn delay={0.1}>
              <ChartContainer title="Cost per Kilometer" height="auto">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { name: 'EV (Electric)', cost: tco.cost_per_km_ev, fill: '#00f0ff' },
                      { name: 'ICE (Gas)', cost: tco.cost_per_km_ice, fill: '#ef4444' },
                    ]}>
                      {chartGrid}
                      <XAxis dataKey="name" tick={axisTickSm} tickLine={false} axisLine={false} />
                      <YAxis tick={axisTickSm} tickLine={false} axisLine={false} tickFormatter={v => `$${v.toFixed(3)}`} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="cost" name="Cost/km" radius={[6, 6, 0, 0]} animationDuration={800}>
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4 text-center">
                  <div className="rounded-xl bg-neon-cyan/10 p-3 border border-neon-cyan/20">
                    <p className="text-lg font-bold text-neon-cyan">${fmtNumber(tco.cost_per_km_ev)}</p>
                    <p className="text-xs text-[var(--text-muted)]">per km (EV)</p>
                  </div>
                  <div className="rounded-xl bg-neon-red/10 p-3 border border-neon-red/20">
                    <p className="text-lg font-bold text-neon-red">${fmtNumber(tco.cost_per_km_ice)}</p>
                    <p className="text-xs text-[var(--text-muted)]">per km (Gas)</p>
                  </div>
                </div>
              </ChartContainer>
            </FadeIn>

            <FadeIn delay={0.2}>
              <ChartContainer title="Monthly EV vs Gas Cost" height="auto">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={tco.monthly_breakdown}>
                      {chartGrid}
                      <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
                      <YAxis tick={axisTickSm} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }} />
                      <Bar dataKey="ev_cost" name="EV Cost" fill="#00f0ff" radius={[4, 4, 0, 0]} animationDuration={800} />
                      <Bar dataKey="equiv_gas_cost" name="Gas Equiv." fill="#ef4444" radius={[4, 4, 0, 0]} animationDuration={800} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartContainer>
            </FadeIn>
          </div>

          {/* Breakdown summary */}
          <FadeIn delay={0.3}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-6 flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-neon-green" /> Savings Breakdown
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Fuel Savings</p>
                  <p className="text-xl font-bold text-neon-green">{fmtCurrency(tco.total_savings)}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Electricity vs gasoline</p>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Maintenance Savings (Est.)</p>
                  <p className="text-xl font-bold text-neon-green">{fmtCurrency(tco.maintenance_savings_estimate)}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">No oil changes, less brake wear</p>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Total Estimated Savings</p>
                  <p className="text-xl font-bold text-neon-green">{fmtCurrency(tco.total_savings + tco.maintenance_savings_estimate)}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{fmtInt(tco.total_km)} km driven · {tco.first_date} → {tco.last_date}</p>
                </div>
              </div>
            </GlassPanel>
          </FadeIn>
        </>
      ) : (
        <GlassPanel className="p-8 text-center">
          <p className="text-[var(--text-muted)]">No data available. Start charging to see your cost analysis.</p>
        </GlassPanel>
      )}
    </div>
  )
}
