import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getVehicles, getFleetAnalytics, getEnergyStats, getBatteryReport,
  getMileageStats, getStateSummary
} from '../api'
import { PageHeader, GlassPanel, FadeIn, DateRangeFilter, Skeleton, QueryError, MetricCard, ChartContainer, Select } from '../components/ui'
import {
  BarChart3, Car, Zap, Battery, Fuel, MapPin, Clock, TrendingUp, Gauge
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, RadialBarChart, RadialBar
} from 'recharts'
import { useSettings } from '../hooks/useSettings'
import { ChartTooltip } from '../components/Charts'
import { fmtNumber, fmtInt, fmtPercent, fmtWithUnit } from '../lib/numberFormat'

const COLORS = ['#00f0ff', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ef4444', '#3b82f6']

function formatDuration(min: number): string {
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export default function Statistics() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const { convertDistance, convertEfficiency, distanceUnit, efficiencyUnit } = useSettings()
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 365); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: analytics, isLoading, error: analyticsError, refetch: refetchAnalytics } = useQuery({
    queryKey: ['fleet-analytics', startDate],
    queryFn: () => getFleetAnalytics(30, startDate),
  })

  const { data: energy } = useQuery({
    queryKey: ['energy-stats', vehicleId, startDate],
    queryFn: () => getEnergyStats(vehicleId!, 30, startDate),
    enabled: vehicleId !== null,
  })

  const { data: battery } = useQuery({
    queryKey: ['battery-report', vehicleId],
    queryFn: () => getBatteryReport(vehicleId!),
    enabled: vehicleId !== null,
  })

  const { data: mileage } = useQuery({
    queryKey: ['mileage-stats', vehicleId],
    queryFn: () => getMileageStats(vehicleId!),
    enabled: vehicleId !== null,
  })

  const { data: stateSummary } = useQuery({
    queryKey: ['state-summary', vehicleId, startDate],
    queryFn: () => getStateSummary(vehicleId!, 30, startDate),
    enabled: vehicleId !== null,
  })

  // Vehicle comparison chart
  const vehicleComp = analytics?.vehicle_comparison ?? []
  const compChart = vehicleComp.map(v => ({
    name: v.name,
    distance: v.distance,
    energy: v.energy,
    efficiency: v.efficiency,
  }))

  // Charging monthly trend
  const chargingTrend = analytics?.charging_analytics?.monthly_trend ?? []

  // State distribution pie
  const statePie = (stateSummary ?? []).map((s, i) => ({
    name: s.state.charAt(0).toUpperCase() + s.state.slice(1),
    value: Math.round(s.total_min),
    fill: COLORS[i % COLORS.length],
  }))

  // Battery health radial
  const healthScore = battery?.health_score ?? 0
  const radialData = [{ name: 'Health', value: healthScore, fill: healthScore >= 80 ? '#10b981' : healthScore >= 60 ? '#f59e0b' : '#ef4444' }]

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Statistics" subtitle="Comprehensive lifetime statistics dashboard" icon={<BarChart3 className="h-7 w-7 text-neon-blue" />} />
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
          {vehicles && vehicles.length > 1 && (
            <Select
              value={vehicleId ?? ''}
              onChange={e => setSelectedVehicle(Number(e.target.value))}
              options={vehicles.map(v => ({ value: String(v.id), label: v.display_name || v.vin }))}
            />
          )}
        </div>
      </div>

      {analyticsError && <QueryError error={analyticsError} onRetry={refetchAnalytics} />}

      {/* Fleet Summary */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-6 sm:mb-8">
          {[1,2,3,4,5,6,7,8].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-6 sm:mb-8">
          <MetricCard label="Vehicles" value={`${analytics?.total_vehicles ?? 0}`} icon={<Car className="h-3.5 w-3.5" />} color="cyan" />
          <MetricCard label="Distance" value={`${fmtNumber(convertDistance(analytics?.total_distance_km ?? 0) / 1000, 1)}k ${distanceUnit}`} icon={<MapPin className="h-3.5 w-3.5" />} color="green" />
          <MetricCard label="Drives" value={`${analytics?.total_drives ?? 0}`} icon={<TrendingUp className="h-3.5 w-3.5" />} color="cyan" />
          <MetricCard label="Charges" value={`${analytics?.total_charging_sessions ?? 0}`} icon={<Battery className="h-3.5 w-3.5" />} color="amber" />
          <MetricCard label="Energy" value={fmtWithUnit(analytics?.total_energy_kwh ?? 0, 'kWh', 0)} icon={<Zap className="h-3.5 w-3.5" />} color="purple" />
          <MetricCard label="Cost" value={`$${fmtInt(analytics?.total_cost ?? 0)}`} icon={<Fuel className="h-3.5 w-3.5" />} color="red" />
          <MetricCard label="Efficiency" value={`${fmtInt(convertEfficiency(analytics?.avg_efficiency_wh_km ?? 0))} ${efficiencyUnit}`} icon={<Gauge className="h-3.5 w-3.5" />} color="amber" />
          <MetricCard label="CO₂ Saved" value={fmtWithUnit(energy?.co2_saved_kg ?? 0, 'kg', 0)} icon={<Clock className="h-3.5 w-3.5" />} color="cyan" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-6">
        {/* Battery Health Radial */}
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Battery Health</h3>
          <div className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={200}>
              <RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="90%" data={radialData} startAngle={180} endAngle={0}>
                <RadialBar background dataKey="value" cornerRadius={10} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="-mt-16 text-center">
              <p className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>{healthScore}</p>
              <p className="text-xs text-[var(--text-muted)]">of 100</p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 text-center w-full">
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{fmtPercent(battery?.degradation_pct ?? 0, 1)}</p>
                <p className="text-[10px] text-[var(--text-muted)]">Degradation</p>
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{battery?.total_cycles ?? 0}</p>
                <p className="text-[10px] text-[var(--text-muted)]">Cycles</p>
              </div>
            </div>
          </div>
        </GlassPanel>

        {/* State Distribution */}
        <ChartContainer title="State Distribution" height={280}>
          {statePie.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">No state data</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statePie} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {statePie.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 10 }} formatter={(val: string, entry: any) => `${val} (${formatDuration(entry?.payload?.value ?? 0)})`} />
                <Tooltip formatter={(val: number) => formatDuration(val)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>

        {/* Mileage Summary */}
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Mileage Summary</h3>
          <div className="space-y-4">
            {[
              { label: 'Total Distance', value: `${fmtInt(convertDistance(mileage?.total_distance ?? 0))} ${distanceUnit}`, color: '#00f0ff' },
              { label: 'Daily Average', value: `${fmtNumber(convertDistance(mileage?.avg_daily ?? 0), 1)} ${distanceUnit}`, color: '#10b981' },
              { label: 'Best Day', value: `${fmtInt(convertDistance(mileage?.max_daily ?? 0))} ${distanceUnit}`, color: '#f59e0b' },
              { label: 'Total Energy', value: fmtWithUnit(mileage?.total_energy ?? 0, 'kWh', 0), color: '#8b5cf6' },
              { label: 'Total Drives', value: `${mileage?.total_drives ?? 0}`, color: '#ec4899' },
              { label: 'Days Tracked', value: `${mileage?.days_tracked ?? 0}`, color: '#3b82f6' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                </div>
                <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{item.value}</span>
              </div>
            ))}
          </div>
        </GlassPanel>
      </div>

      {/* Vehicle Comparison */}
      {compChart.length > 1 && (
        <ChartContainer title="Vehicle Comparison" height={280} className="mb-6">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={compChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="distance" fill="#00f0ff" name={`Distance (${distanceUnit})`} radius={[4, 4, 0, 0]} />
              <Bar dataKey="energy" fill="#f59e0b" name="Energy (kWh)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}

      {/* Monthly Charging Trend */}
      {chargingTrend.length > 0 && (
        <ChartContainer title="Monthly Charging Trend" height={280}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chargingTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="energy" fill="#00f0ff" name="Energy (kWh)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="cost" fill="#10b981" name="Cost ($)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="savings" fill="#f59e0b" name="Gas Savings ($)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}
    </FadeIn>
  )
}
