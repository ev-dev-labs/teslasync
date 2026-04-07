import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getRouteEfficiency, getRouteEfficiencyDetail, Vehicle, RouteSummary, RouteDriveDetail } from '../api'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton } from '../components/ui'
import { MapPin, ArrowRight, TrendingUp, Clock, Gauge } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { ChartTooltip, axisTickSm, chartGrid } from '../components/Charts'
import { formatDate } from '../lib/dateFormat'
import { fmtNumber, fmtPercent, fmtInt, fmtWithUnit } from '../lib/numberFormat'

function EfficiencyBar({ best, avg, worst }: { best: number; avg: number; worst: number }) {
  const max = Math.max(worst, 1)
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
        <div className="h-full flex">
          <div className="h-full rounded-l-full" style={{ width: `${(best / max) * 100}%`, background: '#10b981' }} />
          <div className="h-full" style={{ width: `${((avg - best) / max) * 100}%`, background: '#00f0ff' }} />
          <div className="h-full rounded-r-full" style={{ width: `${((worst - avg) / max) * 100}%`, background: '#ef4444' }} />
        </div>
      </div>
      <div className="flex gap-3 text-[10px] shrink-0">
        <span className="text-neon-green font-bold">{fmtNumber(best, 1)}</span>
        <span className="text-neon-cyan font-bold">{fmtNumber(avg, 1)}</span>
        <span className="text-red-400 font-bold">{fmtNumber(worst, 1)}</span>
      </div>
    </div>
  )
}

function RouteCard({ route, onExpand, isExpanded }: {
  route: RouteSummary
  onExpand: () => void
  isExpanded: boolean
}) {
  return (
    <GlassPanel className="p-5 cursor-pointer transition-all hover:border-white/10" onClick={onExpand}>
      {/* Route header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neon-cyan/10 text-neon-cyan shrink-0">
          <MapPin className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            <span className="truncate">{route.start_location}</span>
            <ArrowRight className="h-3 w-3 shrink-0" style={{ color: 'var(--text-muted)' }} />
            <span className="truncate">{route.end_location}</span>
          </div>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {route.trip_count} trips · {fmtNumber(route.avg_distance_km, 1)} km avg
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Avg Efficiency</p>
          <p className="text-sm font-bold text-neon-cyan">{fmtNumber(route.avg_efficiency, 1)}%/100km</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Avg Speed</p>
          <p className="text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>
            {route.avg_speed > 0 ? fmtWithUnit(route.avg_speed, 'km/h', 0) : 'N/A'}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Avg Temp</p>
          <p className="text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>
            {route.avg_temp > 0 ? `${fmtInt(route.avg_temp)}°C` : 'N/A'}
          </p>
        </div>
      </div>

      {/* Best/Worst Bar */}
      <div>
        <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <span>Best</span>
          <span>Average</span>
          <span>Worst</span>
        </div>
        <EfficiencyBar best={route.best_efficiency} avg={route.avg_efficiency} worst={route.worst_efficiency} />
      </div>

      {isExpanded && (
        <div className="mt-2 text-[10px] text-neon-cyan font-medium">▲ Click to collapse</div>
      )}
      {!isExpanded && (
        <div className="mt-2 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>▼ Click for trip details</div>
      )}
    </GlassPanel>
  )
}

function RouteDetailPanel({ vehicleId, route }: { vehicleId: number; route: RouteSummary }) {
  const { data, isLoading } = useQuery({
    queryKey: ['route-detail', vehicleId, route.start_location, route.end_location],
    queryFn: () => getRouteEfficiencyDetail(vehicleId, route.start_location, route.end_location),
  })

  if (isLoading) return <Skeleton className="h-48" />

  const drives = data?.drives ?? []
  if (drives.length === 0) {
    return (
      <GlassPanel className="p-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        No trip details available
      </GlassPanel>
    )
  }

  // Best trip
  const bestTrip = drives.reduce((best, d) => d.efficiency < best.efficiency && d.efficiency > 0 ? d : best, drives[0])
  const bestDate = formatDate(bestTrip.start_date)

  // Sparkline data for efficiency trend (reverse for chronological order)
  const sparkData = [...drives].reverse().map(d => ({
    date: formatDate(d.start_date),
    efficiency: d.efficiency,
    temp: d.outside_temp_avg,
    speed: d.speed_avg,
  }))

  return (
    <GlassPanel className="p-5 space-y-4">
      {/* Insight */}
      <div className="p-3 rounded-lg border-l-4 border-neon-green" style={{ background: 'rgba(16,185,129,0.05)' }}>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span className="font-semibold text-neon-green">💡 </span>
          Your {route.start_location} → {route.end_location} commute averages{' '}
          <span className="font-bold text-neon-cyan">{fmtNumber(route.avg_efficiency, 1)}%/100km</span>.
          Best trip: <span className="font-bold text-neon-green">{fmtNumber(bestTrip.efficiency, 1)}%/100km</span> on {bestDate}
          {bestTrip.outside_temp_avg > 0 ? ` (${bestTrip.outside_temp_avg}°C` : ''}
          {bestTrip.speed_avg > 0 ? `, ${bestTrip.speed_avg} km/h avg)` : bestTrip.outside_temp_avg > 0 ? ')' : ''}.
        </p>
      </div>

      {/* Sparkline chart */}
      {sparkData.length > 1 && (
        <div>
          <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Efficiency Trend</h4>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                {chartGrid}
                <XAxis dataKey="date" tick={axisTickSm} tickLine={false} axisLine={false} />
                <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="efficiency" name="Efficiency (%/100km)"
                  stroke="#00f0ff" strokeWidth={2} dot={{ r: 2, fill: '#00f0ff' }} animationDuration={800} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Trip table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--glass-border)' }}>
              <th className="text-left py-1.5 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Date</th>
              <th className="text-right py-1.5 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Dist</th>
              <th className="text-right py-1.5 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Duration</th>
              <th className="text-right py-1.5 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Speed</th>
              <th className="text-right py-1.5 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Temp</th>
              <th className="text-right py-1.5 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Efficiency</th>
            </tr>
          </thead>
          <tbody>
            {drives.map((d: RouteDriveDetail) => {
              const isBest = d.id === bestTrip.id
              return (
                <tr key={d.id} className="border-b" style={{ borderColor: 'var(--glass-border)' }}>
                  <td className="py-1.5 px-2" style={{ color: 'var(--text-secondary)' }}>
                    {formatDate(d.start_date)}
                  </td>
                  <td className="text-right py-1.5 px-2" style={{ color: 'var(--text-secondary)' }}>{fmtWithUnit(d.distance, 'km', 1)}</td>
                  <td className="text-right py-1.5 px-2" style={{ color: 'var(--text-secondary)' }}>{fmtInt(d.duration_min)} min</td>
                  <td className="text-right py-1.5 px-2" style={{ color: 'var(--text-secondary)' }}>
                    {d.speed_avg > 0 ? `${d.speed_avg} km/h` : '-'}
                  </td>
                  <td className="text-right py-1.5 px-2" style={{ color: 'var(--text-secondary)' }}>
                    {d.outside_temp_avg > 0 ? `${d.outside_temp_avg}°C` : '-'}
                  </td>
                  <td className={`text-right py-1.5 px-2 font-bold ${isBest ? 'text-neon-green' : 'text-neon-cyan'}`}>
                    {fmtNumber(d.efficiency, 1)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </GlassPanel>
  )
}

export default function RouteEfficiency() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data, isLoading } = useQuery({
    queryKey: ['route-efficiency', vehicleId],
    queryFn: () => getRouteEfficiency(vehicleId!),
    enabled: vehicleId !== null,
  })

  const [expandedRoute, setExpandedRoute] = useState<string | null>(null)

  const routes = data?.routes ?? []
  const hasData = routes.length > 0

  // Chart data for top routes comparison
  const comparisonData = useMemo(() => {
    return routes.slice(0, 8).map(r => ({
      name: `${r.start_location.slice(0, 12)}→${r.end_location.slice(0, 12)}`,
      best: r.best_efficiency,
      avg: r.avg_efficiency,
      worst: r.worst_efficiency,
      trips: r.trip_count,
    }))
  }, [routes])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Route Efficiency"
        subtitle="Compare efficiency across your most-driven routes and find your best driving patterns"
        actions={
          vehicles && vehicles.length > 1 ? (
            <select
              value={vehicleId ?? ''}
              onChange={e => setSelectedVehicle(Number(e.target.value))}
              className="glass-input text-sm px-3 py-2"
            >
              {vehicles.map((v: Vehicle) => (
                <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>
              ))}
            </select>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-56 sm:h-80" />
          <Skeleton className="h-56 sm:h-80" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : !hasData ? (
        <FadeIn>
          <GlassPanel className="p-12 text-center">
            <MapPin className="mx-auto h-12 w-12 text-neon-cyan opacity-40 mb-4" />
            <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>No route data yet</p>
            <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
              Routes appear once you have drives with geocoded start &amp; end addresses and distance &gt; 1 km.
              Make sure Fleet Telemetry or API polling is capturing location data for your drives.
            </p>
          </GlassPanel>
        </FadeIn>
      ) : (
        <>
          {/* Summary stats */}
          <StaggerContainer className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <MapPin className="mx-auto h-6 w-6 text-neon-cyan mb-2" />
                <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Routes</p>
                <p className="text-xl font-bold text-neon-cyan">{routes.length}</p>
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <TrendingUp className="mx-auto h-6 w-6 text-neon-green mb-2" />
                <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Total Trips</p>
                <p className="text-xl font-bold text-neon-green">
                  {routes.reduce((s, r) => s + r.trip_count, 0)}
                </p>
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <Gauge className="mx-auto h-6 w-6 text-neon-purple mb-2" />
                <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Best Efficiency</p>
                <p className="text-xl font-bold text-neon-purple">
                  {fmtPercent(Math.min(...routes.map(r => r.best_efficiency)), 1)}
                </p>
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <Clock className="mx-auto h-6 w-6 text-neon-amber mb-2" />
                <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Most Driven</p>
                <p className="text-xl font-bold text-neon-amber">{routes[0].trip_count}x</p>
              </GlassPanel>
            </StaggerItem>
          </StaggerContainer>

          {/* Route comparison chart */}
          {comparisonData.length > 1 && (
            <FadeIn>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-6 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-neon-cyan" /> Route Efficiency Comparison
                </h3>
                <div className="h-48 sm:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparisonData} layout="vertical">
                      {chartGrid}
                      <XAxis type="number" tick={axisTickSm} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" tick={axisTickSm} tickLine={false} axisLine={false} width={120} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="best" name="Best" fill="#10b981" fillOpacity={0.8} radius={[0, 3, 3, 0]} animationDuration={800} />
                      <Bar dataKey="avg" name="Average" fill="#00f0ff" fillOpacity={0.6} radius={[0, 3, 3, 0]} animationDuration={800} />
                      <Bar dataKey="worst" name="Worst" fill="#ef4444" fillOpacity={0.5} radius={[0, 3, 3, 0]} animationDuration={800} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </GlassPanel>
            </FadeIn>
          )}

          {/* Route cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {routes.map((route) => {
              const key = `${route.start_location}→${route.end_location}`
              const isExpanded = expandedRoute === key
              return (
                <div key={key} className="space-y-2">
                  <FadeIn>
                    <RouteCard
                      route={route}
                      onExpand={() => setExpandedRoute(isExpanded ? null : key)}
                      isExpanded={isExpanded}
                    />
                  </FadeIn>
                  {isExpanded && vehicleId !== null && (
                    <FadeIn>
                      <RouteDetailPanel vehicleId={vehicleId} route={route} />
                    </FadeIn>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
