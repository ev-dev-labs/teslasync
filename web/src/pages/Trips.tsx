import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getTrips } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton, Pagination, DateRangeFilter } from '../components/ui'
import { Route, MapPin, Clock, Fuel, Zap, Calendar, Download } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useSettings } from '../hooks/useSettings'
import { ChartTooltip, ChartGradient, axisTickSm, chartGrid, chartAnimation } from '../components/Charts'
import { exportAsCSV, exportAsJSON } from '../lib/export'

function formatDuration(startDate: string, endDate: string | null): string {
  if (!endDate) return 'In progress'
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime()
  const hours = Math.floor(ms / 3600000)
  const mins = Math.round((ms % 3600000) / 60000)
  if (hours === 0) return `${mins}m`
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

export default function Trips() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 365); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const { convertDistance, convertEfficiency, distanceUnit, efficiencyUnit } = useSettings()

  const { data: trips, isLoading } = useQuery({
    queryKey: ['trips', vehicleId, startDate, endDate, page, pageSize],
    queryFn: () => getTrips(vehicleId ?? undefined, pageSize, (page - 1) * pageSize, startDate, endDate),
    enabled: true,
  })

  const allTrips = trips ?? []
  const filteredTrips = vehicleId ? allTrips.filter(t => t.vehicle_id === vehicleId) : allTrips

  // Stats
  const totalDist = filteredTrips.reduce((s, t) => s + t.total_distance_km, 0)
  const totalEnergy = filteredTrips.reduce((s, t) => s + t.total_energy_kwh, 0)
  const totalCost = filteredTrips.reduce((s, t) => s + t.total_cost, 0)
  const totalDrives = filteredTrips.reduce((s, t) => s + t.drive_count, 0)

  // Bar chart: top 10 trips by distance
  const chartData = [...filteredTrips]
    .sort((a, b) => b.total_distance_km - a.total_distance_km)
    .slice(0, 10)
    .map(t => ({
      name: t.name || `Trip ${t.id}`,
      distance: t.total_distance_km,
      energy: t.total_energy_kwh,
    }))

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Trips" subtitle="Multi-drive trip reports with distance and cost tracking" icon={<Route className="h-7 w-7 text-neon-blue" />} />
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

      <FadeIn>
        <DateRangeFilter
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onApply={() => setPage(1)}
        />
      </FadeIn>

      {/* Stats Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 sm:mb-8">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 sm:mb-8">
          {[
            { label: 'Total Distance', value: `${convertDistance(totalDist).toFixed(0)} ${distanceUnit}`, sub: `${filteredTrips.length} trips`, icon: MapPin, color: '#00f0ff' },
            { label: 'Energy Used', value: `${totalEnergy.toFixed(1)} kWh`, sub: `${totalDrives} drives`, icon: Zap, color: '#f59e0b' },
            { label: 'Total Cost', value: `$${totalCost.toFixed(2)}`, sub: `$${totalDist > 0 ? (totalCost / convertDistance(totalDist) * 100).toFixed(1) : '0'}/100${distanceUnit}`, icon: Fuel, color: '#10b981' },
            { label: 'Total Trips', value: `${filteredTrips.length}`, sub: `${totalDrives} total drives`, icon: Route, color: '#8b5cf6' },
          ].map(card => (
            <GlassPanel key={card.label} className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <card.icon className="h-4 w-4" style={{ color: card.color }} />
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{card.label}</span>
              </div>
              <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">{card.sub}</p>
            </GlassPanel>
          ))}
        </div>
      )}

      {/* Top Trips Chart */}
      {chartData.length > 0 && (
        <GlassPanel className="p-4 sm:p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Top Trips by Distance</h3>
            <div className="flex gap-2">
              <button
                onClick={() => exportAsCSV(filteredTrips.map(t => ({
                  id: t.id, name: t.name || `Trip ${t.id}`, start_date: t.start_date, end_date: t.end_date,
                  distance_km: t.total_distance_km, energy_kwh: t.total_energy_kwh, cost: t.total_cost,
                  drives: t.drive_count, charges: t.charge_count,
                })), 'teslasync-trips.csv')}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)' }}
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
              <button
                onClick={() => exportAsJSON(filteredTrips, 'teslasync-trips.json')}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)' }}
              >
                <Download className="h-3.5 w-3.5" /> JSON
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} layout="vertical" {...chartAnimation}>
              <defs>
                <ChartGradient id="tripGrad" color="#00f0ff" opacity={0.8} />
              </defs>
              {chartGrid}
              <XAxis type="number" tick={axisTickSm} />
              <YAxis dataKey="name" type="category" tick={axisTickSm} width={80} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="distance" fill="url(#tripGrad)" name={`Distance (${distanceUnit})`} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </GlassPanel>
      )}

      {/* Trip List */}
      <GlassPanel className="p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>All Trips</h3>
        {filteredTrips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
            <Route className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">No trips recorded yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTrips.map(trip => (
              <div key={trip.id} className="glass-card p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="h-10 w-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,240,255,0.1)' }}>
                    <Route className="h-5 w-5 text-neon-cyan" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {trip.name || `Trip #${trip.id}`}
                    </p>
                    <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)] mt-0.5">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(trip.start_date).toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDuration(trip.start_date, trip.end_date)}
                      </span>
                      <span>{trip.drive_count} drives</span>
                      {trip.charge_count > 0 && <span>{trip.charge_count} charges</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 sm:gap-6 text-right w-full sm:w-auto justify-end">
                  <div>
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{convertDistance(trip.total_distance_km).toFixed(0)} {distanceUnit}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{trip.drive_count} drives</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold" style={{ color: '#f59e0b' }}>{trip.total_energy_kwh.toFixed(1)} kWh</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{trip.total_distance_km > 0 ? convertEfficiency(trip.total_energy_kwh / trip.total_distance_km * 1000).toFixed(0) : 0} {efficiencyUnit}</p>
                  </div>
                  {trip.total_cost > 0 && (
                    <div>
                      <p className="text-sm font-bold" style={{ color: '#10b981' }}>${trip.total_cost.toFixed(2)}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">cost</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
      {filteredTrips.length > 0 && (
        <Pagination page={page} pageSize={pageSize} total={filteredTrips.length < pageSize ? (page - 1) * pageSize + filteredTrips.length : page * pageSize + 1} onPageChange={setPage} onPageSizeChange={s => { setPageSize(s); setPage(1) }} />
      )}
    </FadeIn>
  )
}
