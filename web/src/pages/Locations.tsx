import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getVisitedLocations } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton, Pagination, QueryError, MetricCard, ChartContainer, Select } from '../components/ui'
import { MapPin, Clock, Hash, Trophy, Navigation } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import clsx from 'clsx'
import { formatDate } from '../lib/dateFormat'
import { ChartTooltip } from '../components/Charts'

export default function Locations() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const { data: locations, isLoading, error, refetch } = useQuery({
    queryKey: ['visited-locations', vehicleId, page, pageSize],
    queryFn: () => getVisitedLocations(vehicleId ?? undefined, pageSize, (page - 1) * pageSize),
    enabled: vehicleId !== null,
  })

  const totalVisits = locations?.reduce((s, l) => s + l.visit_count, 0) ?? 0
  const totalTime = locations?.reduce((s, l) => s + l.total_duration_min, 0) ?? 0
  const uniquePlaces = locations?.length ?? 0
  const topLocation = locations?.[0]

  const chartData = (locations ?? []).slice(0, 15).map(l => ({
    name: l.address_name.length > 25 ? l.address_name.slice(0, 22) + '...' : l.address_name,
    visits: l.visit_count,
    hours: Math.round(l.total_duration_min / 60),
  }))

  const timeChartData = (locations ?? []).slice(0, 10).map(l => ({
    name: l.address_name.length > 25 ? l.address_name.slice(0, 22) + '...' : l.address_name,
    hours: +(l.total_duration_min / 60).toFixed(1),
    avgDuration: l.visit_count > 0 ? +(l.total_duration_min / l.visit_count).toFixed(0) : 0,
  }))

  const avgDurationMin = totalVisits > 0 ? Math.round(totalTime / totalVisits) : 0

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Visited Locations" subtitle="Places you've been — ranked by frequency" icon={<MapPin className="h-7 w-7 text-neon-green" />} />
        {vehicles && vehicles.length > 1 && (
          <Select
            value={vehicleId ?? ''}
            onChange={e => setSelectedVehicle(Number(e.target.value))}
            options={vehicles.map(v => ({ value: String(v.id), label: v.display_name || v.vin }))}
          />
        )}
      </div>

      {error && <QueryError error={error} onRetry={refetch} />}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <MetricCard label="Unique Places" value={uniquePlaces} icon={<Navigation className="h-4 w-4 sm:h-5 sm:w-5" />} color="green" />
        <MetricCard label="Total Visits" value={totalVisits} icon={<Hash className="h-4 w-4 sm:h-5 sm:w-5" />} color="cyan" />
        <MetricCard label="Total Time" value={`${Math.round(totalTime / 60)}h`} icon={<Clock className="h-4 w-4 sm:h-5 sm:w-5" />} color="purple" />
        <MetricCard label="Most Visited" value={topLocation?.address_name ?? '--'} icon={<Trophy className="h-4 w-4 sm:h-5 sm:w-5" />} color="amber" />
        <MetricCard label="Avg Visit" value={avgDurationMin > 60 ? `${Math.floor(avgDurationMin / 60)}h ${avgDurationMin % 60}m` : `${avgDurationMin}m`} icon={<Clock className="h-4 w-4 sm:h-5 sm:w-5" />} color="cyan" />
      </div>

      {/* Top Locations Chart */}
      <ChartContainer title="Top Locations by Visits" height={Math.max(300, chartData.length * 36)} className="mb-6 sm:mb-8">
        {isLoading ? <Skeleton className="h-full rounded-xl" /> : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">No visited location data</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 120 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#9ca3af' }} width={110} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="visits" name="Visits" fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>

      {/* Top Locations by Time Spent */}
      {timeChartData.length > 0 && (
        <ChartContainer title="Top Locations by Time Spent (hours)" height={Math.max(280, timeChartData.length * 36)} className="mb-6 sm:mb-8">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={timeChartData} layout="vertical" margin={{ left: 120 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#9ca3af' }} width={110} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="hours" name="Hours" fill="#a855f7" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}

      {/* Location List */}
      <GlassPanel className="p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>All Locations</h3>
        {isLoading ? (
          <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        ) : !locations?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--text-muted)]">
            <MapPin className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">No visited locations recorded yet</p>
          </div>
        ) : (
          <>
          <div className="space-y-2">
            {locations.map((loc, i) => (
              <GlassPanel key={loc.id} className="p-4 flex items-center gap-4 hover:border-[var(--glass-border)] transition-colors">
                <div className={clsx(
                  'h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0',
                  i === 0 ? 'bg-neon-amber/20 text-neon-amber' : i < 3 ? 'bg-neon-cyan/10 text-neon-cyan' : 'bg-white/5 text-[var(--text-muted)]'
                )}>
                  #{i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{loc.address_name}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {loc.visit_count} visits · {Math.round(loc.total_duration_min / 60)}h total · ~{loc.visit_count > 0 ? Math.round(loc.total_duration_min / loc.visit_count) : 0}m avg
                    {loc.last_visited && ` · Last: ${formatDate(loc.last_visited)}`}
                  </p>
                </div>
                <div className="flex items-center gap-1 text-neon-green text-xs font-medium">
                  <Hash className="h-3 w-3" />{loc.visit_count}
                </div>
              </GlassPanel>
            ))}
          </div>
          <Pagination page={page} pageSize={pageSize} total={locations.length < pageSize ? (page - 1) * pageSize + locations.length : page * pageSize + 1} onPageChange={setPage} onPageSizeChange={s => { setPageSize(s); setPage(1) }} />
          </>
        )}
      </GlassPanel>
    </FadeIn>
  )
}
