import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getChargingHeatmap, Vehicle, ChargingHeatmapCell } from '../api'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton, MetricCard, ChartContainer, Select } from '../components/ui'
import { BatteryCharging, Clock, Zap, DollarSign } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { ChartTooltip, axisTickSm, chartGrid } from '../components/Charts'
import { fmtNumber, fmtInt } from '../lib/numberFormat'
import { usePageTitle } from '../hooks/usePageTitle'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function heatColor(count: number, max: number): string {
  if (count === 0 || max === 0) return 'rgba(0, 240, 255, 0.04)'
  const ratio = count / max
  if (ratio < 0.25) return 'rgba(0, 240, 255, 0.15)'
  if (ratio < 0.5) return 'rgba(16, 185, 129, 0.4)'
  if (ratio < 0.75) return 'rgba(245, 158, 11, 0.55)'
  return 'rgba(239, 68, 68, 0.75)'
}

export default function ChargingHeatmap() {
  usePageTitle('Charging Heatmap')
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data, isLoading } = useQuery({
    queryKey: ['charging-heatmap', vehicleId],
    queryFn: () => getChargingHeatmap(vehicleId!),
    enabled: vehicleId !== null,
  })

  // Build 7×24 grid lookup
  const { grid, maxCount, favorite } = useMemo(() => {
    const g: Record<string, ChargingHeatmapCell> = {}
    let mx = 0
    let favCell: ChargingHeatmapCell | null = null
    for (const c of data?.heatmap ?? []) {
      const key = `${c.day_of_week}-${c.hour_of_day}`
      g[key] = c
      if (c.session_count > mx) {
        mx = c.session_count
        favCell = c
      }
    }
    return { grid: g, maxCount: mx, favorite: favCell }
  }, [data])

  const favoriteText = favorite
    ? `You charge most on ${DAY_NAMES_FULL[favorite.day_of_week]}s at ${favorite.hour_of_day === 0 ? '12am' : favorite.hour_of_day <= 11 ? `${favorite.hour_of_day}am` : favorite.hour_of_day === 12 ? '12pm' : `${favorite.hour_of_day - 12}pm`}`
    : null

  const locationData = useMemo(
    () => (data?.locations ?? []).map(l => ({ ...l, fill: '#f59e0b' })),
    [data]
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Charging Patterns"
        subtitle="Heatmap of when and where you charge"
        icon={<BatteryCharging className="h-5 w-5" />}
        actions={
          vehicles && vehicles.length > 1 ? (
            <Select
              className="text-sm px-3 py-2"
              value={vehicleId ?? ''}
              onChange={e => setSelectedVehicle(Number(e.target.value))}
              options={vehicles.map((v: Vehicle) => ({ value: String(v.id), label: v.display_name || v.vin }))}
            />
          ) : undefined
        }
      />

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          {/* Summary Stats */}
          <StaggerContainer className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StaggerItem><MetricCard label="Total Sessions" value={data?.summary.total_sessions ?? 0} icon={<BatteryCharging className="h-4 w-4" />} color="cyan" /></StaggerItem>
            <StaggerItem><MetricCard label="Total kWh" value={`${fmtNumber(data?.summary.total_kwh ?? 0)}`} icon={<Zap className="h-4 w-4" />} color="green" /></StaggerItem>
            <StaggerItem><MetricCard label="Total Cost" value={`$${fmtNumber(data?.summary.total_cost ?? 0)}`} icon={<DollarSign className="h-4 w-4" />} color="amber" /></StaggerItem>
            <StaggerItem><MetricCard label="Avg Duration" value={`${fmtInt(data?.summary.avg_duration ?? 0)} min`} icon={<Clock className="h-4 w-4" />} color="purple" /></StaggerItem>
          </StaggerContainer>

          {/* Favorite Time Callout */}
          {favoriteText && (
            <FadeIn>
              <GlassPanel className="p-4 border-l-4 border-neon-cyan">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neon-cyan/10">
                    <Clock className="h-5 w-5 text-neon-cyan" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-neon-cyan">Favorite Charging Time</p>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{favoriteText}</p>
                  </div>
                </div>
              </GlassPanel>
            </FadeIn>
          )}

          {/* Heatmap Grid */}
          <FadeIn>
            <ChartContainer title="Weekly Charging Heatmap" height="auto">
              <div className="overflow-x-auto">
                <div className="min-w-[600px]">
                  {/* Hour labels */}
                  <div className="grid gap-[2px] mb-1" style={{ gridTemplateColumns: '56px repeat(24, 1fr)' }}>
                    <div />
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="text-center text-[9px]" style={{ color: 'var(--text-muted)' }}>
                        {h}
                      </div>
                    ))}
                  </div>
                  {/* Day rows */}
                  {Array.from({ length: 7 }, (_, d) => (
                    <div key={d} className="grid gap-[2px] mb-[2px]" style={{ gridTemplateColumns: '56px repeat(24, 1fr)' }}>
                      <div className="flex items-center text-xs font-medium pr-2" style={{ color: 'var(--text-secondary)' }}>
                        {DAYS[d]}
                      </div>
                      {Array.from({ length: 24 }, (_, h) => {
                        const cell = grid[`${d}-${h}`]
                        const count = cell?.session_count ?? 0
                        const avgE = cell?.avg_energy ?? 0
                        return (
                          <div
                            key={h}
                            className="aspect-square rounded-sm cursor-default transition-transform hover:scale-125 hover:z-10 relative group"
                            style={{ backgroundColor: heatColor(count, maxCount), minHeight: '16px' }}
                          >
                            {/* Tooltip */}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-20 pointer-events-none">
                              <div className="rounded-lg px-2 py-1 text-[10px] whitespace-nowrap shadow-lg" style={{ background: 'var(--surface-1)', border: '1px solid var(--glass-border)' }}>
                                <p className="font-semibold">{DAYS[d]} {h}:00</p>
                                <p>{count} session{count !== 1 ? 's' : ''}</p>
                                {count > 0 && <p>~{fmtNumber(avgE)} kWh avg</p>}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                  {/* Legend */}
                  <div className="flex items-center gap-2 mt-3 justify-end">
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Less</span>
                    {['rgba(0,240,255,0.04)', 'rgba(0,240,255,0.15)', 'rgba(16,185,129,0.4)', 'rgba(245,158,11,0.55)', 'rgba(239,68,68,0.75)'].map((bg, i) => (
                      <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: bg }} />
                    ))}
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>More</span>
                  </div>
                </div>
              </div>
            </ChartContainer>
          </FadeIn>

          {/* Location Breakdown */}
          {locationData.length > 0 && (
            <FadeIn>
              <ChartContainer title="Top Charging Locations" height={Math.max(200, locationData.length * 40)}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={locationData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <defs>
                      <linearGradient id="locGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.8} />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.4} />
                      </linearGradient>
                    </defs>
                    {chartGrid}
                    <XAxis type="number" tick={axisTickSm} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="location" tick={axisTickSm} tickLine={false} axisLine={false} width={120} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" fill="url(#locGrad)" radius={[0, 4, 4, 0]} animationDuration={800} name="Sessions" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </FadeIn>
          )}
        </>
      )}
    </div>
  )
}
