import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getVehicles, getFleetAnalytics, getEnergyStats, getBatteryReport,
  getMileageStats, getStateSummary
} from '../api'
import { PageHeader, GlassPanel, FadeIn, DateRangeFilter, Skeleton } from '../components/ui'
import {
  BarChart3, Car, Zap, Battery, Fuel, MapPin, Clock, TrendingUp, Gauge
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, RadialBarChart, RadialBar
} from 'recharts'

interface TooltipPayload { name: string; value: number; color?: string; fill?: string }
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color || p.fill }}>●</span> {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </p>
      ))}
    </div>
  )
}

const COLORS = ['#00f0ff', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ef4444', '#3b82f6']

function formatDuration(min: number): string {
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export default function Statistics() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 365); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: analytics, isLoading } = useQuery({
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
            <select
              value={vehicleId ?? ''}
              onChange={e => setSelectedVehicle(Number(e.target.value))}
              className="glass-card px-3 py-2 text-sm rounded-lg border-0 focus:ring-1 focus:ring-neon-cyan/50"
              style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
            >
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Fleet Summary */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-6 sm:mb-8">
          {[1,2,3,4,5,6,7,8].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-6 sm:mb-8">
          {[
            { label: 'Vehicles', value: `${analytics?.total_vehicles ?? 0}`, icon: Car, color: '#00f0ff' },
            { label: 'Distance', value: `${((analytics?.total_distance_km ?? 0) / 1000).toFixed(1)}k km`, icon: MapPin, color: '#10b981' },
            { label: 'Drives', value: `${analytics?.total_drives ?? 0}`, icon: TrendingUp, color: '#3b82f6' },
            { label: 'Charges', value: `${analytics?.total_charging_sessions ?? 0}`, icon: Battery, color: '#f59e0b' },
            { label: 'Energy', value: `${(analytics?.total_energy_kwh ?? 0).toFixed(0)} kWh`, icon: Zap, color: '#8b5cf6' },
            { label: 'Cost', value: `$${(analytics?.total_cost ?? 0).toFixed(0)}`, icon: Fuel, color: '#ec4899' },
            { label: 'Efficiency', value: `${(analytics?.avg_efficiency_wh_km ?? 0).toFixed(0)} Wh/km`, icon: Gauge, color: '#f97316' },
            { label: 'CO₂ Saved', value: `${(energy?.co2_saved_kg ?? 0).toFixed(0)} kg`, icon: Clock, color: '#06b6d4' },
          ].map(card => (
            <GlassPanel key={card.label} className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <card.icon className="h-3.5 w-3.5" style={{ color: card.color }} />
                <span className="text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>{card.label}</span>
              </div>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</p>
            </GlassPanel>
          ))}
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
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{(battery?.degradation_pct ?? 0).toFixed(1)}%</p>
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
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>State Distribution</h3>
          {statePie.length === 0 ? (
            <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">No state data</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={statePie} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {statePie.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 10 }} formatter={(val: string, entry: { payload?: { value?: number } }) => `${val} (${formatDuration(entry?.payload?.value ?? 0)})`} />
                <Tooltip formatter={(val: number) => formatDuration(val)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>

        {/* Mileage Summary */}
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Mileage Summary</h3>
          <div className="space-y-4">
            {[
              { label: 'Total Distance', value: `${(mileage?.total_distance ?? 0).toFixed(0)} km`, color: '#00f0ff' },
              { label: 'Daily Average', value: `${(mileage?.avg_daily ?? 0).toFixed(1)} km`, color: '#10b981' },
              { label: 'Best Day', value: `${(mileage?.max_daily ?? 0).toFixed(0)} km`, color: '#f59e0b' },
              { label: 'Total Energy', value: `${(mileage?.total_energy ?? 0).toFixed(0)} kWh`, color: '#8b5cf6' },
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
        <GlassPanel className="p-6 mb-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Vehicle Comparison</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={compChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="distance" fill="#00f0ff" name="Distance (km)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="energy" fill="#f59e0b" name="Energy (kWh)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </GlassPanel>
      )}

      {/* Monthly Charging Trend */}
      {chargingTrend.length > 0 && (
        <GlassPanel className="p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Monthly Charging Trend</h3>
          <ResponsiveContainer width="100%" height={280}>
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
        </GlassPanel>
      )}
    </FadeIn>
  )
}
