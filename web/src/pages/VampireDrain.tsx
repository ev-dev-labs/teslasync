import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getVampireDrainEvents, getVampireDrainStats } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton, Pagination, DateRangeFilter } from '../components/ui'
import { Moon, BatteryWarning, Shield, TrendingDown, Clock, Download } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Legend, CartesianGrid
} from 'recharts'
import clsx from 'clsx'
import { useSettings } from '../hooks/useSettings'
import { ChartTooltip, ChartGradient, axisTickSm, chartGrid, chartAnimation } from '../components/Charts'
import { exportAsCSV, exportAsJSON } from '../lib/export'

function StatCard({ icon, label, value, unit, color }: { icon: React.ReactNode; label: string; value: string; unit: string; color: string }) {
  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <div className={clsx('rounded-lg sm:rounded-xl p-2 sm:p-2.5', `bg-${color}/10`)}>{icon}</div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
          <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{value} <span className="text-xs text-[var(--text-muted)]">{unit}</span></p>
        </div>
      </div>
    </GlassPanel>
  )
}

export default function VampireDrain() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 365); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const { convertDistance, convertTemp, distanceUnit, tempUnit } = useSettings()

  const { data: events, isLoading } = useQuery({
    queryKey: ['vampire-drain', vehicleId, startDate, endDate, page, pageSize],
    queryFn: () => getVampireDrainEvents(vehicleId!, pageSize, (page - 1) * pageSize, startDate, endDate),
    enabled: vehicleId !== null,
  })

  const { data: stats } = useQuery({
    queryKey: ['vampire-drain-stats', vehicleId],
    queryFn: () => getVampireDrainStats(vehicleId!),
    enabled: vehicleId !== null,
  })

  const chartData = (events ?? []).slice(0, 50).reverse().map(e => ({
    date: new Date(e.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    drain: e.drain_rate_pct_per_hour,
    battery_lost: e.battery_lost,
    duration: e.duration_hours,
    sentry: e.sentry_mode ? 'Sentry On' : 'Sentry Off',
    temp: e.outside_temp_avg,
  }))

  const sentryData = (events ?? []).map(e => ({
    duration: e.duration_hours,
    drain: e.drain_rate_pct_per_hour,
    temp: e.outside_temp_avg ?? 20,
    sentry: e.sentry_mode,
  }))

  // Drain correlation: sentry ON vs OFF by temperature range
  const drainCorrelation = useMemo(() => {
    if (!events || events.length === 0) return []
    const tempRanges = [
      { min: -Infinity, max: 10, label: 'Cold (<10°C)' },
      { min: 10, max: 25, label: 'Mild (10-25°C)' },
      { min: 25, max: Infinity, label: 'Hot (>25°C)' },
    ]
    return tempRanges.map(range => {
      const inRange = events.filter(e => {
        const temp = e.outside_temp_avg ?? 20
        return temp >= range.min && temp < range.max
      })
      const sentryOn = inRange.filter(e => e.sentry_mode)
      const sentryOff = inRange.filter(e => !e.sentry_mode)
      const avgOn = sentryOn.length > 0 ? sentryOn.reduce((s, e) => s + e.drain_rate_pct_per_hour, 0) / sentryOn.length : 0
      const avgOff = sentryOff.length > 0 ? sentryOff.reduce((s, e) => s + e.drain_rate_pct_per_hour, 0) / sentryOff.length : 0
      return {
        range: range.label,
        sentryOn: parseFloat(avgOn.toFixed(3)),
        sentryOff: parseFloat(avgOff.toFixed(3)),
        countOn: sentryOn.length,
        countOff: sentryOff.length,
      }
    }).filter(d => d.countOn > 0 || d.countOff > 0)
  }, [events])

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Vampire Drain" subtitle="Analyze energy loss while your vehicle is parked" />
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <StatCard icon={<TrendingDown className="h-5 w-5 text-neon-purple" />} label="Avg Drain Rate" value={(stats?.avg_drain_rate ?? 0).toFixed(2)} unit="%/hr" color="neon-purple" />
        <StatCard icon={<BatteryWarning className="h-5 w-5 text-neon-red" />} label="Total Range Lost" value={convertDistance(stats?.total_range_lost ?? 0).toFixed(0)} unit={distanceUnit} color="neon-red" />
        <StatCard icon={<Clock className="h-5 w-5 text-neon-cyan" />} label="Total Idle Hours" value={(stats?.total_hours ?? 0).toFixed(0)} unit="hrs" color="neon-cyan" />
        <StatCard icon={<Shield className="h-5 w-5 text-neon-amber" />} label="Events" value={String(stats?.event_count ?? 0)} unit="" color="neon-amber" />
      </div>

      {/* Sentry comparison */}
      {stats && (stats.avg_sentry_drain > 0 || stats.avg_nosentry_drain > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <GlassPanel className="p-5">
            <div className="flex items-center gap-3 mb-2">
              <Shield className="h-4 w-4 text-neon-red" />
              <span className="text-xs font-medium text-[var(--text-secondary)]">Sentry Mode ON</span>
            </div>
            <p className="text-2xl font-bold text-neon-red">{stats.avg_sentry_drain.toFixed(2)}%<span className="text-sm text-[var(--text-muted)]">/hr</span></p>
          </GlassPanel>
          <GlassPanel className="p-5">
            <div className="flex items-center gap-3 mb-2">
              <Moon className="h-4 w-4 text-neon-green" />
              <span className="text-xs font-medium text-[var(--text-secondary)]">Sentry Mode OFF</span>
            </div>
            <p className="text-2xl font-bold text-neon-green">{stats.avg_nosentry_drain.toFixed(2)}%<span className="text-sm text-[var(--text-muted)]">/hr</span></p>
          </GlassPanel>
        </div>
      )}

      {/* Drain Rate Over Time */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Drain Rate Over Time</h3>
          {events && events.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => exportAsCSV((events ?? []).map(e => ({
                  date: e.start_date, duration_hours: e.duration_hours, battery_lost: e.battery_lost,
                  drain_rate_pct_hr: e.drain_rate_pct_per_hour, outside_temp: e.outside_temp_avg,
                  sentry_mode: e.sentry_mode ? 'Yes' : 'No',
                })), 'teslasync-vampire-drain.csv')}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)' }}
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
              <button
                onClick={() => exportAsJSON(events ?? [], 'teslasync-vampire-drain.json')}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)' }}
              >
                <Download className="h-3.5 w-3.5" /> JSON
              </button>
            </div>
          )}
        </div>
        {isLoading ? <Skeleton className="h-48 sm:h-64 rounded-xl" /> : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-48 sm:h-64 text-sm" style={{ color: 'var(--text-muted)' }}>No vampire drain data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} {...chartAnimation}>
              <defs>
                <ChartGradient id="drainGrad" color="#a855f7" opacity={0.8} />
              </defs>
              {chartGrid}
              <XAxis dataKey="date" tick={axisTickSm} />
              <YAxis tick={axisTickSm} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="drain" name="Drain Rate (%/hr)" fill="url(#drainGrad)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>

      {/* Scatter: Duration vs Drain */}
      {sentryData.length > 0 && (
        <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Duration vs Drain Rate</h3>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="duration" name="Duration (hrs)" tick={axisTickSm} />
              <YAxis dataKey="drain" name="Drain (%/hr)" tick={axisTickSm} />
              <ZAxis dataKey="temp" range={[40, 200]} name="Temperature" />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }} />
              <Scatter name="Sentry On" data={sentryData.filter(d => d.sentry)} fill="#ef4444" />
              <Scatter name="Sentry Off" data={sentryData.filter(d => !d.sentry)} fill="#10b981" />
            </ScatterChart>
          </ResponsiveContainer>
        </GlassPanel>
      )}

      {/* Drain Correlation: Sentry Mode × Temperature */}
      {drainCorrelation.length > 0 && (
        <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            Drain Rate: Sentry Mode × Temperature
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={drainCorrelation} {...chartAnimation}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTickSm} label={{ value: '%/hr', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }} />
              <Bar dataKey="sentryOn" name="Sentry ON" fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Bar dataKey="sentryOff" name="Sentry OFF" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-3 gap-3 mt-3 text-center">
            {drainCorrelation.map(d => (
              <div key={d.range} className="text-[10px] text-[var(--text-muted)]">
                <p className="font-medium text-[var(--text-secondary)]">{d.range}</p>
                <p>ON: {d.countOn} events · OFF: {d.countOff} events</p>
              </div>
            ))}
          </div>
        </GlassPanel>
      )}

      {/* Event List */}
      <GlassPanel className="p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Recent Events</h3>
        {!events?.length ? (
          <p className="text-sm text-[var(--text-muted)] py-8 text-center">No drain events recorded</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] border-b border-white/5">
                  <th className="text-left py-2 pr-4">Date</th>
                  <th className="text-right pr-4">Duration</th>
                  <th className="text-right pr-4">Battery Lost</th>
                  <th className="text-right pr-4">Drain Rate</th>
                  <th className="text-right pr-4">Temp</th>
                  <th className="text-center">Sentry</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="py-2.5 pr-4" style={{ color: 'var(--text-primary)' }}>{new Date(e.start_date).toLocaleDateString()}</td>
                    <td className="text-right pr-4 text-[var(--text-secondary)]">{e.duration_hours.toFixed(1)}h</td>
                    <td className="text-right pr-4 text-neon-red">{e.battery_lost}%</td>
                    <td className="text-right pr-4 text-neon-purple">{e.drain_rate_pct_per_hour.toFixed(2)}%/hr</td>
                    <td className="text-right pr-4 text-[var(--text-secondary)]">{e.outside_temp_avg !== null ? `${convertTemp(e.outside_temp_avg).toFixed(0)}${tempUnit}` : '--'}</td>
                    <td className="text-center">{e.sentry_mode ? <Shield className="h-3.5 w-3.5 text-neon-amber inline" /> : <span className="text-gray-600">--</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={pageSize} total={events.length < pageSize ? (page - 1) * pageSize + events.length : page * pageSize + 1} onPageChange={setPage} onPageSizeChange={s => { setPageSize(s); setPage(1) }} />
          </div>
        )}
      </GlassPanel>
    </FadeIn>
  )
}
