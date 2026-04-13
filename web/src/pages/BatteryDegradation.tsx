import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getBatteryDegradation, Vehicle } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton, ChartContainer, AlertBanner, Select } from '../components/ui'
import { Battery, TrendingDown, AlertTriangle, Thermometer, Zap, Shield } from 'lucide-react'
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'
import { ChartTooltip, axisTickSm, chartGrid } from '../components/Charts'
import { healthColor } from '../lib/colors'
import { fmtNumber, fmtInt } from '../lib/numberFormat'
import { usePageTitle } from '../hooks/usePageTitle'

function HealthGauge({ value, size = 200 }: { value: number; size?: number }) {
  const clamped = Math.min(Math.max(value, 0), 100)
  const r = (size - 20) / 2
  const circ = 2 * Math.PI * r * 0.75
  const offset = circ - (clamped / 100) * circ
  const color = healthColor(clamped)
  const startAngle = 135

  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: size, height: size + 20 }}>
      <svg width={size} height={size} className="overflow-visible">
        <defs>
          <linearGradient id="health-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={1} />
            <stop offset="100%" stopColor={color} stopOpacity={0.3} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--glass-border)" strokeWidth={10}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * 0.25}
          transform={`rotate(${startAngle} ${size / 2} ${size / 2})`} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#health-grad)" strokeWidth={10}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          transform={`rotate(${startAngle} ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 1.2s ease-out', filter: `drop-shadow(0 0 8px ${color}66)` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ paddingBottom: 10 }}>
        <p className="text-4xl font-bold" style={{ color }}>{fmtNumber(clamped)}%</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Battery Health</p>
      </div>
    </div>
  )
}

function RiskCard({ label, value, detail, level }: {
  label: string; value: string | number; detail: string; level: 'green' | 'amber' | 'red'
}) {
  const colors = {
    green: { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)', text: '#10b981', dot: 'bg-neon-green' },
    amber: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)', text: '#f59e0b', dot: 'bg-neon-amber' },
    red: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', text: '#ef4444', dot: 'bg-neon-red' },
  }
  const c = colors[level]

  return (
    <div className="rounded-xl p-4" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`h-2 w-2 rounded-full ${c.dot}`} style={{ boxShadow: `0 0 6px ${c.text}80` }} />
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      </div>
      <p className="text-2xl font-bold" style={{ color: c.text }}>{value}</p>
      <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{detail}</p>
    </div>
  )
}

export default function BatteryDegradation() {
  usePageTitle('Battery Degradation')
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data, isLoading } = useQuery({
    queryKey: ['battery-degradation', vehicleId],
    queryFn: () => getBatteryDegradation(vehicleId!),
    enabled: vehicleId !== null,
  })

  // Build chart data combining actual trend + projection
  const trendChartData = useMemo(() => {
    if (!data) return []
    const actual = (data.monthly_trend || []).map(m => ({
      month: m.month.slice(2), // "24-01" format
      health: m.avg_health,
      type: 'actual' as const,
    }))
    const projection = (data.prediction?.projection_points || []).map(p => ({
      month: p.month.slice(2),
      projected: p.health,
      type: 'projected' as const,
    }))
    // Merge: for actual data, use health; for projection, use projected
    const merged = [...actual.map(a => ({ ...a, projected: undefined as number | undefined })),
      ...projection.map(p => ({ month: p.month, health: undefined as number | undefined, projected: p.projected, type: p.type }))]
    // Connect actual to projection: set last actual point's projected value
    if (actual.length > 0 && projection.length > 0) {
      const lastActualIdx = actual.length - 1
      merged[lastActualIdx].projected = merged[lastActualIdx].health
    }
    return merged
  }, [data])

  const capacityChartData = useMemo(() => {
    if (!data?.monthly_trend) return []
    return data.monthly_trend.map(m => ({
      month: m.month.slice(2),
      capacity: m.avg_capacity,
      range: m.avg_range,
    }))
  }, [data])

  const habits = data?.charging_habits
  const totalCharges = (habits?.fast_charge_count ?? 0) + (habits?.slow_charge_count ?? 0)
  const fastChargePct = totalCharges > 0 ? fmtInt((habits?.fast_charge_count ?? 0) / totalCharges * 100) : '0'

  const noData = !isLoading && (!data || data.snapshots.length === 0)

  // Risk factor levels
  const fastChargeLevel = (data?.fast_charge_ratio ?? 0) > 50 ? 'red' : (data?.fast_charge_ratio ?? 0) > 25 ? 'amber' : 'green'
  const deepDischargeLevel = (habits?.deep_discharge_count ?? 0) > 20 ? 'red' : (habits?.deep_discharge_count ?? 0) > 10 ? 'amber' : 'green'
  const fullChargeLevel = (habits?.charge_to_full_count ?? 0) > totalCharges / 2 ? 'red' : (habits?.charge_to_full_count ?? 0) > totalCharges / 4 ? 'amber' : 'green'
  const tempLevel = (data?.current_temp ?? 25) > 40 ? 'red' : (data?.current_temp ?? 25) > 35 ? 'amber' : 'green'

  return (
    <div className="space-y-8">
      <PageHeader
        title="Battery Degradation"
        subtitle="Health trends, degradation predictions, and charging habit impact analysis"
        actions={
          vehicles && vehicles.length > 1 ? (
            <Select
              value={vehicleId ?? ''}
              onChange={e => setSelectedVehicle(Number(e.target.value))}
              className="text-sm px-3 py-2"
              options={vehicles.map((v: Vehicle) => ({ value: String(v.id), label: v.display_name || v.vin }))}
            />
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : noData ? (
        <FadeIn>
          <GlassPanel className="p-12 text-center">
            <Battery className="h-12 w-12 mx-auto mb-4 text-neon-purple/30" />
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Not Enough Data</h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Battery health snapshots will appear here once telemetry data is collected.
            </p>
          </GlassPanel>
        </FadeIn>
      ) : (
        <>
          {/* Health gauge + prediction callout */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FadeIn>
              <GlassPanel className="p-6 flex flex-col items-center justify-center min-h-[300px]">
                <HealthGauge value={data?.current_health ?? 0} />
                <div className="flex items-center gap-4 mt-4">
                  <div className="text-center">
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Capacity</p>
                    <p className="text-lg font-bold text-neon-cyan">{fmtNumber(data?.current_capacity ?? 0)} kWh</p>
                  </div>
                  <div className="h-8 w-px" style={{ background: 'var(--glass-border)' }} />
                  <div className="text-center">
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Cycles</p>
                    <p className="text-lg font-bold text-neon-purple">{data?.current_cycles ?? 0}</p>
                  </div>
                  <div className="h-8 w-px" style={{ background: 'var(--glass-border)' }} />
                  <div className="text-center">
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Range</p>
                    <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{fmtInt(data?.current_range ?? 0)} km</p>
                  </div>
                </div>
              </GlassPanel>
            </FadeIn>
            <FadeIn delay={0.05}>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-4 flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-neon-purple" /> Prediction
                </h3>
                {data?.prediction?.has_enough_data ? (
                  <div className="space-y-4">
                    <div className="rounded-xl p-4" style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.15)' }}>
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        At current rate, battery reaches <span className="font-bold text-neon-amber">80% health</span> in approximately{' '}
                        <span className="font-bold text-neon-purple">~{fmtNumber(data.prediction.years_to_80_pct ?? 0)} years</span>
                        {data.prediction.predicted_date && (
                          <> ({data.prediction.predicted_date})</>
                        )}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
                        <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Degradation Rate</p>
                        <p className="text-lg font-bold text-neon-red">{fmtNumber(Math.abs(data.prediction.slope_per_year))}%/yr</p>
                      </div>
                      <div className="rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
                        <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Stress Level</p>
                        <p className={`text-lg font-bold ${
                          data.stress_level === 'Low' ? 'text-neon-green' :
                          data.stress_level === 'Medium' ? 'text-neon-amber' : 'text-neon-red'
                        }`}>{data.stress_level}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl p-4 text-center" style={{ background: 'var(--surface-2)' }}>
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-neon-amber/50" />
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Need more data points to generate prediction (minimum 3 snapshots required)
                    </p>
                  </div>
                )}
              </GlassPanel>
            </FadeIn>
          </div>

          {/* Degradation trend chart with projection */}
          {trendChartData.length > 0 && (
            <FadeIn delay={0.1}>
              <ChartContainer title="Health Trend & Projection" height="clamp(256px, 40vw, 320px)">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendChartData}>
                      {chartGrid}
                      <XAxis dataKey="month" tick={axisTickSm} />
                      <YAxis domain={[70, 100]} tick={axisTickSm} />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine y={80} stroke="#f59e0b" strokeDasharray="6 4" strokeWidth={1.5}
                        label={{ value: '80% threshold', position: 'insideTopRight', fill: '#f59e0b', fontSize: 10 }} />
                      <Line dataKey="health" name="Actual Health %" stroke="#10b981" strokeWidth={2.5}
                        dot={{ fill: '#10b981', r: 3 }} connectNulls={false} />
                      <Line dataKey="projected" name="Projected %" stroke="#a855f7" strokeWidth={2}
                        strokeDasharray="8 4" dot={false} connectNulls={false} />
                    </LineChart>
                  </ResponsiveContainer>
              </ChartContainer>
            </FadeIn>
          )}

          {/* Risk factors */}
          <FadeIn delay={0.15}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <Shield className="h-4 w-4 text-neon-amber" /> Risk Factors
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <RiskCard
                  label="Fast Charges"
                  value={habits?.fast_charge_count ?? 0}
                  detail={`${fastChargePct}% of all charges`}
                  level={fastChargeLevel as 'green' | 'amber' | 'red'}
                />
                <RiskCard
                  label="Deep Discharges"
                  value={habits?.deep_discharge_count ?? 0}
                  detail="Below 10% SOC"
                  level={deepDischargeLevel as 'green' | 'amber' | 'red'}
                />
                <RiskCard
                  label="Charged to Full"
                  value={habits?.charge_to_full_count ?? 0}
                  detail="Above 95% SOC"
                  level={fullChargeLevel as 'green' | 'amber' | 'red'}
                />
                <RiskCard
                  label="Avg Cell Temp"
                  value={`${fmtNumber(data?.current_temp ?? 0)}°C`}
                  detail={tempLevel === 'green' ? 'Optimal range' : tempLevel === 'amber' ? 'Slightly elevated' : 'High temperature'}
                  level={tempLevel as 'green' | 'amber' | 'red'}
                />
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Monthly capacity trend */}
          {capacityChartData.length > 0 && (
            <FadeIn delay={0.2}>
              <ChartContainer title="Capacity Over Time" height="clamp(224px, 36vw, 288px)">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={capacityChartData}>
                      {chartGrid}
                      <XAxis dataKey="month" tick={axisTickSm} />
                      <YAxis tick={axisTickSm} />
                      <Tooltip content={<ChartTooltip />} />
                      <defs>
                        <linearGradient id="cap-gradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#a855f7" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#a855f7" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <Area dataKey="capacity" name="Capacity (kWh)" stroke="#a855f7" strokeWidth={2}
                        fill="url(#cap-gradient)" />
                    </AreaChart>
                  </ResponsiveContainer>
              </ChartContainer>
            </FadeIn>
          )}

          {/* Charging habits impact */}
          <FadeIn delay={0.25}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <Zap className="h-4 w-4 text-neon-green" /> Charging Habits Impact
              </h3>
              <AlertBanner
                variant={data?.stress_level === 'Low' ? 'success' : data?.stress_level === 'Medium' ? 'warning' : 'danger'}
                icon={<Thermometer className="h-5 w-5" />}
                title={`${fastChargePct}% fast charges, ${habits?.deep_discharge_count ?? 0} deep discharges — ${data?.stress_level} stress`}
              >
                {data?.stress_level === 'Low'
                  ? 'Your charging habits are optimal for battery longevity.'
                  : data?.stress_level === 'Medium'
                  ? 'Consider reducing fast charging frequency and avoiding full charges when possible.'
                  : 'High stress detected. Reducing fast charges and deep discharges can improve battery lifespan.'}
              </AlertBanner>
            </GlassPanel>
          </FadeIn>
        </>
      )}
    </div>
  )
}
