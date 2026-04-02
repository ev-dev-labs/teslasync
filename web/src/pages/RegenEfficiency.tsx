import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getRegenStats, Vehicle } from '../api'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton } from '../components/ui'
import { Zap, TrendingUp, Activity, Calendar } from 'lucide-react'
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  ComposedChart, Line, Bar
} from 'recharts'
import { ChartTooltip, axisTickSm, chartGrid } from '../components/Charts'

function RegenGauge({ value, size = 180 }: { value: number; size?: number }) {
  const clamped = Math.min(Math.max(value, 0), 100)
  const r = (size - 20) / 2
  const circ = Math.PI * r // semicircle
  const offset = circ - (clamped / 100) * circ
  const color = clamped >= 25 ? '#10b981' : clamped >= 15 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: size, height: size / 2 + 40 }}>
      <svg width={size} height={size / 2 + 10} className="overflow-visible">
        <defs>
          <linearGradient id="regen-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <path
          d={`M ${10} ${size / 2} A ${r} ${r} 0 0 1 ${size - 10} ${size / 2}`}
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth={8}
          strokeLinecap="round"
        />
        <path
          d={`M ${10} ${size / 2} A ${r} ${r} 0 0 1 ${size - 10} ${size / 2}`}
          fill="none"
          stroke="url(#regen-grad)"
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s ease-out', filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      </svg>
      <div className="absolute bottom-6 text-center">
        <p className="text-3xl font-bold" style={{ color }}>{clamped.toFixed(1)}%</p>
        <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Regen Ratio</p>
      </div>
    </div>
  )
}

export default function RegenEfficiency() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data, isLoading } = useQuery({
    queryKey: ['regen-stats', vehicleId],
    queryFn: () => getRegenStats(vehicleId!),
    enabled: vehicleId !== null,
  })

  const monthlyChartData = useMemo(() => {
    if (!data?.monthly_summary) return []
    return data.monthly_summary.map(m => ({
      month: m.month.slice(5),
      regen_power: m.avg_regen_power_kw,
      efficiency: m.avg_efficiency,
      drives: m.drive_count,
    }))
  }, [data])

  const noData = !isLoading && (!data || (data.drives.length === 0 && data.total_regen_kwh === 0))

  return (
    <div className="space-y-8">
      <PageHeader
        title="Regenerative Braking"
        subtitle="Track regen energy recovery, per-drive efficiency, and monthly trends"
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
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : noData ? (
        <FadeIn>
          <GlassPanel className="p-12 text-center">
            <Zap className="h-12 w-12 mx-auto mb-4 text-neon-green/30" />
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Not Enough Data</h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Drive data with regen braking information will appear here once available.
            </p>
          </GlassPanel>
        </FadeIn>
      ) : (
        <>
          {/* Hero stats */}
          <StaggerContainer className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Lifetime Regen', value: `${(data?.total_regen_kwh ?? 0).toFixed(1)} kWh`, color: 'text-neon-green' },
              { label: 'Regen Ratio', value: `${(data?.regen_ratio ?? 0).toFixed(1)}%`, color: 'text-neon-cyan' },
              { label: 'Monthly Avg', value: `${(data?.monthly_avg_regen ?? 0).toFixed(1)} kW`, color: 'text-neon-purple' },
              { label: 'Free Charges', value: `${(data?.free_charges ?? 0).toFixed(1)}`, color: 'text-neon-amber' },
            ].map(m => (
              <StaggerItem key={m.label}>
                <GlassPanel className="p-4 text-center">
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{m.label}</p>
                  <p className={`text-xl font-bold mt-1 ${m.color}`}>{m.value}</p>
                </GlassPanel>
              </StaggerItem>
            ))}
          </StaggerContainer>

          {/* Regen gauge + insight */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FadeIn>
              <GlassPanel className="p-6 flex flex-col items-center justify-center">
                <h3 className="section-title mb-4 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-neon-green" /> Regen Ratio Gauge
                </h3>
                <RegenGauge value={data?.regen_ratio ?? 0} />
              </GlassPanel>
            </FadeIn>
            <FadeIn delay={0.05}>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-4 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-neon-green" /> Regen Insight
                </h3>
                <div className="space-y-4">
                  <div className="rounded-xl p-4" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)' }}>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      You've recovered <span className="font-bold text-neon-green">{(data?.total_regen_kwh ?? 0).toFixed(1)} kWh</span> through
                      regenerative braking — equivalent to <span className="font-bold text-neon-green">~{(data?.free_charges ?? 0).toFixed(1)} free charges</span>.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Total Drive Energy</p>
                      <p className="text-lg font-bold text-neon-cyan">{(data?.total_drive_kwh ?? 0).toFixed(1)} kWh</p>
                    </div>
                    <div className="rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Recovery Rate</p>
                      <p className="text-lg font-bold text-neon-green">{(data?.regen_ratio ?? 0).toFixed(1)}%</p>
                    </div>
                  </div>
                </div>
              </GlassPanel>
            </FadeIn>
          </div>

          {/* Monthly regen trend chart */}
          {monthlyChartData.length > 0 && (
            <FadeIn delay={0.1}>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-6 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-neon-cyan" /> Monthly Regen Trend
                </h3>
                <div className="h-64 sm:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={monthlyChartData}>
                      {chartGrid}
                      <XAxis dataKey="month" tick={axisTickSm} />
                      <YAxis yAxisId="left" tick={axisTickSm} />
                      <YAxis yAxisId="right" orientation="right" tick={axisTickSm} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar yAxisId="left" dataKey="regen_power" name="Avg Regen (kW)" fill="#10b981" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                      <Line yAxisId="right" dataKey="efficiency" name="Efficiency" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </GlassPanel>
            </FadeIn>
          )}

          {/* Per-drive regen table */}
          {data && data.drives.length > 0 && (
            <FadeIn delay={0.15}>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-4 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-neon-purple" /> Per-Drive Regen Details
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b" style={{ borderColor: 'var(--glass-border)' }}>
                        <th className="text-left py-2 px-3 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Date</th>
                        <th className="text-right py-2 px-3 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Distance</th>
                        <th className="text-right py-2 px-3 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Max Regen</th>
                        <th className="text-right py-2 px-3 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Efficiency</th>
                        <th className="text-right py-2 px-3 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.drives.slice(0, 30).map(d => {
                        const scoreColor = d.regen_score >= 30 ? 'text-neon-green' : d.regen_score >= 15 ? 'text-neon-amber' : 'text-neon-red'
                        return (
                          <tr key={d.id} className="border-b hover:bg-white/[0.02] transition-colors" style={{ borderColor: 'var(--glass-border)' }}>
                            <td className="py-2.5 px-3" style={{ color: 'var(--text-secondary)' }}>
                              {new Date(d.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                              {d.distance.toFixed(1)} km
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-neon-cyan">
                              {d.power_min != null ? `${Math.abs(d.power_min).toFixed(0)} kW` : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                              {d.efficiency.toFixed(1)}%
                            </td>
                            <td className={`py-2.5 px-3 text-right font-bold ${scoreColor}`}>
                              {d.regen_score.toFixed(1)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </GlassPanel>
            </FadeIn>
          )}
        </>
      )}
    </div>
  )
}
