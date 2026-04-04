import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getFleetAnalytics, getBatteryReport, getMileageStats, getVisitedLocations, Vehicle } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { GitCompare, Check, AlertTriangle } from 'lucide-react'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, Legend,
} from 'recharts'
import { ChartTooltip } from '../components/Charts'
import { CHART_COLORS } from '../lib/colors'
import { useSettings } from '../hooks/useSettings'

type ComparisonRow = {
  label: string
  values: (string | number)[]
  raw: number[]
  higherIsBetter: boolean
}

function highlightClass(raw: number[], idx: number, higherIsBetter: boolean): string {
  if (raw.length < 2 || raw.every(v => v === raw[0])) return ''
  const best = higherIsBetter ? Math.max(...raw) : Math.min(...raw)
  const worst = higherIsBetter ? Math.min(...raw) : Math.max(...raw)
  if (raw[idx] === best) return 'text-neon-green font-bold'
  if (raw[idx] === worst) return 'text-neon-red font-bold'
  return ''
}

export default function Compare() {
  const { convertDistance, convertEfficiency, distanceUnit, efficiencyUnit } = useSettings()
  const { data: vehicles, isLoading: loadingVehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selected, setSelected] = useState<number[]>([])

  const { data: fleet } = useQuery({
    queryKey: ['fleet-analytics-compare'],
    queryFn: () => getFleetAnalytics(365),
    enabled: selected.length >= 2,
  })

  const batteryQueries = selected.map(id =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ['battery-report', id],
      queryFn: () => getBatteryReport(id),
      enabled: selected.length >= 2,
    })
  )

  const mileageQueries = selected.map(id =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ['mileage-stats', id],
      queryFn: () => getMileageStats(id),
      enabled: selected.length >= 2,
    })
  )

  const locationQueries = selected.map(id =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ['visited-locations', id],
      queryFn: () => getVisitedLocations(id, 1),
      enabled: selected.length >= 2,
    })
  )

  const toggleVehicle = (id: number) => {
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(v => v !== id)
      if (prev.length >= 3) return prev
      return [...prev, id]
    })
  }

  const selectedVehicles = useMemo(
    () => vehicles?.filter(v => selected.includes(v.id)) ?? [],
    [vehicles, selected]
  )

  const isDataReady = selected.length >= 2
    && batteryQueries.every(q => !q.isLoading)
    && mileageQueries.every(q => !q.isLoading)
    && locationQueries.every(q => !q.isLoading)

  const rows = useMemo((): ComparisonRow[] => {
    if (!isDataReady) return []

    const fleetComparison = fleet?.vehicle_comparison ?? []

    return selected.map((_id, i) => {
      const v = selectedVehicles[i]
      const battery = batteryQueries[i]?.data
      const mileage = mileageQueries[i]?.data
      const fleetEntry = fleetComparison.find(fc => fc.id === v?.id)
      const topLocation = locationQueries[i]?.data?.[0]

      return { v, battery, mileage, fleetEntry, topLocation }
    }).reduce<ComparisonRow[]>((_acc, _item, _i, arr) => {
      const makeRow = (
        label: string,
        extractor: (item: typeof arr[0]) => number,
        formatter: (val: number) => string,
        higherIsBetter: boolean
      ): ComparisonRow => {
        const raw = arr.map(extractor)
        return { label, values: raw.map(formatter), raw, higherIsBetter }
      }

      return [
        {
          label: 'Vehicle Name',
          values: arr.map(a => a.v?.display_name || '—'),
          raw: arr.map(() => 0),
          higherIsBetter: true,
        },
        {
          label: 'Model',
          values: arr.map(a => a.v?.model || '—'),
          raw: arr.map(() => 0),
          higherIsBetter: true,
        },
        {
          label: 'VIN',
          values: arr.map(a => a.v?.vin || '—'),
          raw: arr.map(() => 0),
          higherIsBetter: true,
        },
        makeRow(`Total Distance (${distanceUnit})`, a => convertDistance(a.mileage?.total_distance ?? 0), v => v.toLocaleString(undefined, { maximumFractionDigits: 0 }), true),
        makeRow('Total Drives', a => a.mileage?.total_drives ?? 0, v => v.toLocaleString(), true),
        makeRow('Total Energy (kWh)', a => a.fleetEntry?.energy ?? a.mileage?.total_energy ?? 0, v => v.toFixed(1), true),
        makeRow('Total Charging Cost ($)', _a => {
          const monthlyTrend = fleet?.charging_analytics?.monthly_trend ?? []
          return monthlyTrend.reduce((sum, m) => sum + m.cost, 0) / (fleet?.total_vehicles || 1)
        }, v => `$${v.toFixed(2)}`, false),
        makeRow(`Avg Efficiency (${efficiencyUnit})`, a => convertEfficiency(a.fleetEntry?.efficiency ?? 0), v => v.toFixed(1), false),
        makeRow('Battery Health Score', a => a.battery?.health_score ?? 0, v => v.toFixed(0), true),
        makeRow('Battery Degradation (%)', a => a.battery?.degradation_pct ?? 0, v => `${v.toFixed(1)}%`, false),
        makeRow(`Avg Daily Distance (${distanceUnit})`, a => convertDistance(a.mileage?.avg_daily ?? 0), v => v.toFixed(1), true),
        {
          label: 'Most Visited Location',
          values: arr.map(a => a.topLocation?.address_name || '—'),
          raw: arr.map(() => 0),
          higherIsBetter: true,
        },
      ]
    }, [])
  }, [isDataReady, selected, selectedVehicles, fleet, batteryQueries, mileageQueries, locationQueries])

  // Radar chart data
  const radarData = useMemo(() => {
    if (!isDataReady || rows.length === 0) return []

    const metrics = [
      { label: 'Distance', rowLabel: `Total Distance (${distanceUnit})` },
      { label: 'Efficiency', rowLabel: `Avg Efficiency (${efficiencyUnit})` },
      { label: 'Health', rowLabel: 'Battery Health Score' },
      { label: 'Cost', rowLabel: 'Total Charging Cost ($)' },
      { label: 'Daily Avg', rowLabel: `Avg Daily Distance (${distanceUnit})` },
      { label: 'Drives', rowLabel: 'Total Drives' },
    ]

    return metrics.map(m => {
      const row = rows.find(r => r.label === m.rowLabel)
      if (!row) return { metric: m.label }
      const maxVal = Math.max(...row.raw, 1)
      const entry: Record<string, string | number> = { metric: m.label }
      selectedVehicles.forEach((v, i) => {
        entry[v.display_name || `Vehicle ${v.id}`] = Math.round((row.raw[i] / maxVal) * 100)
      })
      return entry
    })
  }, [isDataReady, rows, selectedVehicles])

  if (loadingVehicles) {
    return (
      <div className="space-y-6">
        <PageHeader title="Compare Vehicles" subtitle="Select 2-3 vehicles to compare side by side" />
        <Skeleton className="h-64 sm:h-96" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Compare Vehicles"
        subtitle="Select 2-3 vehicles to compare side by side"
        icon={<GitCompare className="h-6 w-6 text-neon-cyan" />}
      />

      {/* Vehicle selector */}
      <FadeIn>
        <GlassPanel className="p-6">
          <h3 className="section-title mb-4 flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-neon-cyan" /> Select Vehicles (2-3)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {vehicles?.map((v: Vehicle) => {
              const isSelected = selected.includes(v.id)
              const disabled = !isSelected && selected.length >= 3
              return (
                <button
                  key={v.id}
                  onClick={() => !disabled && toggleVehicle(v.id)}
                  disabled={disabled}
                  className={`relative flex items-center gap-3 rounded-xl border p-4 text-left transition-all duration-200 ${
                    isSelected
                      ? 'border-neon-cyan/50 bg-neon-cyan/5 shadow-[0_0_15px_rgba(0,240,255,0.1)]'
                      : disabled
                        ? 'border-white/[0.04] opacity-40 cursor-not-allowed'
                        : 'border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02] cursor-pointer'
                  }`}
                >
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    isSelected ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/[0.05] text-[var(--text-muted)]'
                  }`}>
                    {isSelected ? <Check className="h-4 w-4" /> : <span className="text-xs font-bold">{v.model?.[0] || '?'}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {v.display_name || 'Unnamed Vehicle'}
                    </p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {v.model} · {v.vin}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
          {selected.length < 2 && (
            <p className="mt-3 flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              <AlertTriangle className="h-4 w-4 text-neon-amber" />
              Select at least 2 vehicles to compare
            </p>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Comparison table */}
      {selected.length >= 2 && !isDataReady && (
        <Skeleton className="h-64 sm:h-96" />
      )}

      {isDataReady && rows.length > 0 && (
        <>
          <FadeIn delay={0.1}>
            <GlassPanel className="p-6 overflow-x-auto">
              <h3 className="section-title mb-6 flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-neon-cyan" /> Comparison Table
              </h3>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-white/[0.06] text-[var(--text-muted)] text-xs uppercase tracking-wider">
                  <tr>
                    <th className="pb-3 pr-6 min-w-[100px] sm:min-w-[180px]">Metric</th>
                    {selectedVehicles.map(v => (
                      <th key={v.id} className="pb-3 pr-6 min-w-[80px] sm:min-w-[150px]">
                        {v.display_name || v.vin}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {rows.map(row => (
                    <tr key={row.label} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 pr-6 font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {row.label}
                      </td>
                      {row.values.map((val, i) => (
                        <td
                          key={i}
                          className={`py-3 pr-6 ${
                            ['Vehicle Name', 'Model', 'VIN', 'Most Visited Location'].includes(row.label)
                              ? 'text-[var(--text-primary)]'
                              : highlightClass(row.raw, i, row.higherIsBetter)
                          }`}
                        >
                          {val}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </GlassPanel>
          </FadeIn>

          {/* Radar chart */}
          {radarData.length > 0 && (
            <FadeIn delay={0.2}>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-6 flex items-center gap-2">
                  <GitCompare className="h-4 w-4 text-neon-purple" /> Visual Comparison
                </h3>
                <div className="h-80 sm:h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                      <PolarGrid stroke="var(--glass-border)" strokeOpacity={0.5} />
                      <PolarAngleAxis
                        dataKey="metric"
                        tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                      />
                      <PolarRadiusAxis
                        angle={30}
                        domain={[0, 100]}
                        tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
                      />
                      {selectedVehicles.map((v, i) => (
                        <Radar
                          key={v.id}
                          name={v.display_name || `Vehicle ${v.id}`}
                          dataKey={v.display_name || `Vehicle ${v.id}`}
                          stroke={CHART_COLORS[i % CHART_COLORS.length]}
                          fill={CHART_COLORS[i % CHART_COLORS.length]}
                          fillOpacity={0.15}
                          strokeWidth={2}
                        />
                      ))}
                      <Tooltip content={<ChartTooltip />} />
                      <Legend
                        wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </GlassPanel>
            </FadeIn>
          )}
        </>
      )}
    </div>
  )
}
