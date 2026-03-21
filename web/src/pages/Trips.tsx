import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getTrips, getDrives } from '../api'
import type { Drive, Trip } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton, Pagination, DateRangeFilter } from '../components/ui'
import { Route, MapPin, Clock, Fuel, Zap, Calendar, Download, Navigation, DollarSign } from 'lucide-react'
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

function TripPlanner({ vehicles: _vehicles, drives }: { vehicles: any[]; drives: Drive[] }) {
  const [distance, setDistance] = useState(200)
  const [currentBattery, setCurrentBattery] = useState(80)
  const [weather, setWeather] = useState<'mild' | 'cold' | 'hot'>('mild')
  const [sentry, setSentry] = useState(false)
  const [highway, setHighway] = useState(false)

  const avgEfficiency = useMemo(() => {
    if (!drives?.length) return 180
    const total = drives.reduce((s, d) => {
      if (d.distance > 0 && d.start_battery_level && d.end_battery_level) {
        const used = (d.start_battery_level - d.end_battery_level) / 100 * 75
        return { wh: s.wh + (used * 1000), km: s.km + d.distance }
      }
      return s
    }, { wh: 0, km: 0 })
    return total.km > 0 ? total.wh / total.km : 180
  }, [drives])

  const adjustedEfficiency = useMemo(() => {
    let eff = avgEfficiency
    if (weather === 'cold') eff *= 1.4
    if (weather === 'hot') eff *= 1.1
    if (highway) eff *= 1.25
    if (sentry) eff *= 1.05
    return eff
  }, [avgEfficiency, weather, highway, sentry])

  const batteryCapacity = 75000
  const availableEnergy = (currentBattery / 100) * batteryCapacity
  const energyNeeded = distance * adjustedEfficiency
  const canComplete = availableEnergy >= energyNeeded
  const remainingBattery = Math.max(0, ((availableEnergy - energyNeeded) / batteryCapacity) * 100)
  const maxRange = availableEnergy / adjustedEfficiency
  const chargeStopsNeeded = canComplete ? 0 : Math.ceil((energyNeeded - availableEnergy) / (batteryCapacity * 0.6))

  return (
    <GlassPanel className="p-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
        <Navigation className="h-4 w-4 text-neon-cyan" /> Trip Planner
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="space-y-4">
          <div>
            <label className="text-[11px] text-[var(--text-muted)] uppercase">Distance (km)</label>
            <input type="range" min="10" max="1000" value={distance} onChange={e => setDistance(Number(e.target.value))}
              className="w-full" />
            <span className="text-lg font-bold text-neon-cyan">{distance} km</span>
          </div>
          <div>
            <label className="text-[11px] text-[var(--text-muted)] uppercase">Current Battery (%)</label>
            <input type="range" min="5" max="100" value={currentBattery} onChange={e => setCurrentBattery(Number(e.target.value))}
              className="w-full" />
            <span className="text-lg font-bold" style={{color: currentBattery > 50 ? '#10b981' : currentBattery > 20 ? '#f59e0b' : '#ef4444'}}>{currentBattery}%</span>
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <select value={weather} onChange={e => setWeather(e.target.value as 'mild' | 'cold' | 'hot')}
                className="glass-card px-2 py-1 text-xs rounded" style={{background:'var(--surface-2)',color:'var(--text-primary)'}}>
                <option value="mild">Mild (15-25°C)</option>
                <option value="cold">Cold (&lt;5°C)</option>
                <option value="hot">Hot (&gt;35°C)</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={highway} onChange={e => setHighway(e.target.checked)} />
              Highway
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={sentry} onChange={e => setSentry(e.target.checked)} />
              Sentry
            </label>
          </div>
        </div>

        {/* Results */}
        <div className="space-y-3">
          <div className={`rounded-xl p-4 text-center ${canComplete ? 'bg-neon-green/10 border border-neon-green/20' : 'bg-neon-red/10 border border-neon-red/20'}`}>
            <p className={`text-2xl font-bold ${canComplete ? 'text-neon-green' : 'text-neon-red'}`}>
              {canComplete ? '✅ Can Complete' : '⚠️ Charging Required'}
            </p>
            {canComplete ? (
              <p className="text-sm text-[var(--text-secondary)]">Arrive with ~{remainingBattery.toFixed(0)}% battery</p>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">{chargeStopsNeeded} charging stop{chargeStopsNeeded > 1 ? 's' : ''} needed</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="glass-card p-3 rounded-lg">
              <p className="text-lg font-bold text-neon-cyan">{maxRange.toFixed(0)} km</p>
              <p className="text-[10px] text-[var(--text-muted)]">Max Range</p>
            </div>
            <div className="glass-card p-3 rounded-lg">
              <p className="text-lg font-bold text-neon-purple">{adjustedEfficiency.toFixed(0)} Wh/km</p>
              <p className="text-[10px] text-[var(--text-muted)]">Est. Efficiency</p>
            </div>
            <div className="glass-card p-3 rounded-lg">
              <p className="text-lg font-bold text-neon-amber">{(energyNeeded/1000).toFixed(1)} kWh</p>
              <p className="text-[10px] text-[var(--text-muted)]">Energy Needed</p>
            </div>
            <div className="glass-card p-3 rounded-lg">
              <p className="text-lg font-bold text-neon-green">{(distance/(adjustedEfficiency > 0 ? distance/maxRange*60 : 60)).toFixed(0)} min</p>
              <p className="text-[10px] text-[var(--text-muted)]">Est. Drive Time</p>
            </div>
          </div>

          {/* Range bar */}
          <div>
            <div className="flex justify-between text-[10px] text-[var(--text-muted)] mb-1">
              <span>0 km</span><span>{maxRange.toFixed(0)} km (max range)</span>
            </div>
            <div className="h-4 rounded-full overflow-hidden" style={{background: 'var(--surface-2)'}}>
              <div className="h-full rounded-full bg-gradient-to-r from-neon-green to-neon-cyan relative"
                style={{width: `${Math.min(100, (distance / Math.max(maxRange, 1)) * 100)}%`}}>
                {distance > maxRange && (
                  <div className="absolute right-0 top-0 bottom-0 bg-neon-red/40 rounded-r-full"
                    style={{width: `${((distance - maxRange) / distance) * 100}%`}} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </GlassPanel>
  )
}

function TripCostBreakdown({ trip, electricityRate = 0.15 }: { trip: Trip; electricityRate?: number }) {
  const energyCost = (trip.total_energy_kwh || 0) * electricityRate
  const costPerKm = trip.total_distance_km > 0 ? energyCost / trip.total_distance_km : 0
  const gasConsumption = 8 // L/100km
  const gasPrice = 1.50 // $/L
  const gasCost = (trip.total_distance_km / 100) * gasConsumption * gasPrice
  const savings = gasCost - energyCost

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
      <div className="glass-card p-2 rounded-lg text-center">
        <p className="text-sm font-bold text-neon-cyan">${energyCost.toFixed(2)}</p>
        <p className="text-[9px] text-[var(--text-muted)]">Energy Cost</p>
      </div>
      <div className="glass-card p-2 rounded-lg text-center">
        <p className="text-sm font-bold text-neon-green">${costPerKm.toFixed(3)}/km</p>
        <p className="text-[9px] text-[var(--text-muted)]">Cost per km</p>
      </div>
      <div className="glass-card p-2 rounded-lg text-center">
        <p className="text-sm font-bold text-neon-amber">${gasCost.toFixed(2)}</p>
        <p className="text-[9px] text-[var(--text-muted)]">Gas Equivalent</p>
      </div>
      <div className="glass-card p-2 rounded-lg text-center">
        <p className="text-sm font-bold text-neon-green">${savings.toFixed(2)}</p>
        <p className="text-[9px] text-[var(--text-muted)]">Saved vs Gas</p>
      </div>
    </div>
  )
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

  const { data: drives } = useQuery({
    queryKey: ['drives', vehicleId],
    queryFn: () => getDrives(vehicleId!, 200, 0),
    enabled: !!vehicleId,
  })

  const allTrips = trips ?? []
  const filteredTrips = vehicleId ? allTrips.filter(t => t.vehicle_id === vehicleId) : allTrips

  // Stats
  const totalDist = filteredTrips.reduce((s, t) => s + t.total_distance_km, 0)
  const totalEnergy = filteredTrips.reduce((s, t) => s + t.total_energy_kwh, 0)
  const totalCost = filteredTrips.reduce((s, t) => s + t.total_cost, 0)
  const totalDrives = filteredTrips.reduce((s, t) => s + t.drive_count, 0)

  // Cost summary for current month
  const costSummary = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthTrips = filteredTrips.filter(t => new Date(t.start_date) >= monthStart)
    const electricityRate = 0.15
    const gasConsumption = 8
    const gasPrice = 1.50
    const totalEnergyCost = monthTrips.reduce((s, t) => s + (t.total_energy_kwh * electricityRate), 0)
    const avgCost = monthTrips.length > 0 ? totalEnergyCost / monthTrips.length : 0
    const totalGasCost = monthTrips.reduce((s, t) => s + ((t.total_distance_km / 100) * gasConsumption * gasPrice), 0)
    const totalSavings = totalGasCost - totalEnergyCost
    return { totalEnergyCost, avgCost, totalSavings, tripCount: monthTrips.length }
  }, [filteredTrips])

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

      {/* Cost Summary */}
      {!isLoading && filteredTrips.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6 sm:mb-8">
          <GlassPanel className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-4 w-4 text-neon-cyan" />
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Energy Costs (This Month)</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>${costSummary.totalEnergyCost.toFixed(2)}</p>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">{costSummary.tripCount} trips this month</p>
          </GlassPanel>
          <GlassPanel className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-neon-amber" />
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Avg Cost per Trip</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>${costSummary.avgCost.toFixed(2)}</p>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">electricity @ $0.15/kWh</p>
          </GlassPanel>
          <GlassPanel className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Fuel className="h-4 w-4 text-neon-green" />
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Total Savings vs Gas</span>
            </div>
            <p className="text-xl font-bold text-neon-green">${costSummary.totalSavings.toFixed(2)}</p>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">vs 8L/100km @ $1.50/L</p>
          </GlassPanel>
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
              <YAxis dataKey="name" type="category" tick={axisTickSm} width={120} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="distance" fill="url(#tripGrad)" name={`Distance (${distanceUnit})`} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </GlassPanel>
      )}

      {/* Trip Planner */}
      <div className="mb-6">
        <TripPlanner vehicles={vehicles ?? []} drives={drives ?? []} />
      </div>

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
              <div key={trip.id} className="glass-card p-3 sm:p-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
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
                <TripCostBreakdown trip={trip} />
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
