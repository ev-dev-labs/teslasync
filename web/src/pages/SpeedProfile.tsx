import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getSpeedProfile, Vehicle, EfficiencyCategory } from '../api'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton } from '../components/ui'
import { Gauge, Zap, TrendingUp, AlertTriangle, Car } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Cell,
} from 'recharts'
import { ChartTooltip, axisTickSm, chartGrid } from '../components/Charts'
import { useUnits } from '../hooks/useUnits'

function bucketColor(bucket: string): string {
  if (bucket.startsWith('0') || bucket.startsWith('15')) return '#10b981'
  if (bucket.startsWith('30') || bucket.startsWith('45')) return '#00f0ff'
  if (bucket.startsWith('60') || bucket.startsWith('75')) return '#f59e0b'
  return '#ef4444'
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'City (<30)': <Car className="h-5 w-5" />,
  'Suburban (30-60)': <TrendingUp className="h-5 w-5" />,
  'Highway (60-90)': <Gauge className="h-5 w-5" />,
  'High Speed (90+)': <Zap className="h-5 w-5" />,
}

const CATEGORY_COLORS: Record<string, string> = {
  'City (<30)': 'text-neon-green',
  'Suburban (30-60)': 'text-neon-cyan',
  'Highway (60-90)': 'text-neon-amber',
  'High Speed (90+)': 'text-neon-red',
}

function scatterColor(efficiency: number): string {
  if (efficiency < 5) return '#10b981'
  if (efficiency < 10) return '#00f0ff'
  if (efficiency < 15) return '#f59e0b'
  return '#ef4444'
}

export default function SpeedProfile() {
  const u = useUnits()
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data, isLoading } = useQuery({
    queryKey: ['speed-profile', vehicleId],
    queryFn: () => getSpeedProfile(vehicleId!),
    enabled: vehicleId !== null,
  })

  // Compute time percentage for distribution chart
  const distData = useMemo(() => {
    const d = data?.distribution ?? []
    const total = d.reduce((s, b) => s + b.readings, 0)
    return d.map(b => ({
      ...b,
      pct: total > 0 ? Math.round((b.readings / total) * 1000) / 10 : 0,
      fill: bucketColor(b.speed_bucket),
    }))
  }, [data])

  const categories = data?.categories ?? []
  const points = data?.points ?? []

  // Optimal speed insight
  const insight = useMemo(() => {
    if (points.length < 10) return null
    const sorted = [...points].filter(p => p.efficiency > 0).sort((a, b) => a.efficiency - b.efficiency)
    const best = sorted.slice(0, Math.ceil(sorted.length * 0.2))
    const avgBest = best.reduce((s, p) => s + p.speed_avg, 0) / best.length
    return `Drives around ${Math.round(u.speedVal(avgBest))} ${u.speedUnit} show the best efficiency. Reducing highway speed could improve efficiency by ~15%.`
  }, [points])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Speed Profile"
        subtitle="Speed distribution and efficiency analysis"
        icon={<Gauge className="h-5 w-5" />}
        actions={
          vehicles && vehicles.length > 1 ? (
            <select
              className="glass-input text-sm px-3 py-2"
              value={vehicleId ?? ''}
              onChange={e => setSelectedVehicle(Number(e.target.value))}
            >
              {vehicles.map((v: Vehicle) => (
                <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>
              ))}
            </select>
          ) : undefined
        }
      />

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          {/* Insight Callout */}
          {insight && (
            <FadeIn>
              <GlassPanel className="p-4 border-l-4 border-neon-green">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neon-green/10">
                    <AlertTriangle className="h-5 w-5 text-neon-green" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-neon-green">Efficiency Insight</p>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{insight}</p>
                  </div>
                </div>
              </GlassPanel>
            </FadeIn>
          )}

          {/* Speed Distribution Bar Chart */}
          <FadeIn>
            <GlassPanel className="p-4 sm:p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <Gauge className="h-4 w-4 text-neon-cyan" /> Speed Distribution (Last 30 Days)
              </h3>
              {distData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={distData} margin={{ bottom: 5 }}>
                    {chartGrid}
                    <XAxis dataKey="speed_bucket" tick={axisTickSm} tickLine={false} axisLine={false} label={{ value: `Speed (${u.speedUnit})`, position: 'insideBottom', offset: -2, style: { fill: 'var(--text-muted)', fontSize: 10 } }} />
                    <YAxis tick={axisTickSm} tickLine={false} axisLine={false} label={{ value: 'Time %', angle: -90, position: 'insideLeft', style: { fill: 'var(--text-muted)', fontSize: 10 } }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="pct" radius={[4, 4, 0, 0]} animationDuration={800} name="Time %">
                      {distData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No telemetry data available</p>
              )}
            </GlassPanel>
          </FadeIn>

          {/* Efficiency vs Speed Scatter */}
          {points.length > 0 && (
            <FadeIn>
              <GlassPanel className="p-4 sm:p-6">
                <h3 className="section-title mb-4 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-neon-green" /> Efficiency vs Speed
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                  <ScatterChart margin={{ bottom: 5 }}>
                    {chartGrid}
                    <XAxis type="number" dataKey="speed_avg" name="Avg Speed" unit={` ${u.speedUnit}`} tick={axisTickSm} tickLine={false} axisLine={false} />
                    <YAxis type="number" dataKey="efficiency" name="Battery %/100km" tick={axisTickSm} tickLine={false} axisLine={false} />
                    <ZAxis type="number" dataKey="distance" range={[30, 200]} name="Distance" />
                    <Tooltip content={<ChartTooltip />} />
                    <Scatter data={points} animationDuration={800}>
                      {points.map((p, i) => (
                        <Cell key={i} fill={scatterColor(p.efficiency)} fillOpacity={0.7} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-3 mt-2 justify-end">
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    <span className="inline-block w-2 h-2 rounded-full bg-neon-green" /> Efficient
                  </span>
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    <span className="inline-block w-2 h-2 rounded-full bg-neon-amber" /> Moderate
                  </span>
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    <span className="inline-block w-2 h-2 rounded-full bg-neon-red" /> High consumption
                  </span>
                </div>
              </GlassPanel>
            </FadeIn>
          )}

          {/* Speed Category Breakdown Cards */}
          {categories.length > 0 && (
            <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {categories.map((c: EfficiencyCategory) => (
                <StaggerItem key={c.category}>
                  <GlassPanel className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${CATEGORY_COLORS[c.category] ?? 'text-neon-cyan'} bg-white/5`}>
                        {CATEGORY_ICONS[c.category] ?? <Car className="h-5 w-5" />}
                      </div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{c.category}</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Drives</span>
                        <span className="text-sm font-bold text-neon-cyan">{c.drive_count}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Avg Speed</span>
                        <span className="text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>{u.speed(c.avg_speed)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Battery %/100km</span>
                        <span className={`text-sm font-bold ${c.battery_pct_per_100km < 8 ? 'text-neon-green' : c.battery_pct_per_100km < 15 ? 'text-neon-amber' : 'text-neon-red'}`}>
                          {c.battery_pct_per_100km.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </GlassPanel>
                </StaggerItem>
              ))}
            </StaggerContainer>
          )}
        </>
      )}
    </div>
  )
}
