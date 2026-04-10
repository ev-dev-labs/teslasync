import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getVampireDrainEvents, getVampireDrainStats } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton, Pagination, DateRangeFilter, MetricCard, ChartContainer, Select } from '../components/ui'
import { Moon, BatteryWarning, Shield, TrendingDown, Clock, Download } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Legend
} from 'recharts'
import { useSettings } from '../hooks/useSettings'
import { ChartTooltip, ChartGradient, axisTickSm, chartGrid, chartAnimation } from '../components/Charts'
import { exportAsCSV, exportAsJSON } from '../lib/export'
import { formatDateShort, formatDate } from '../lib/dateFormat'
import { fmtNumber, fmtInt } from '../lib/numberFormat'

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
    date: formatDateShort(e.start_date),
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

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Vampire Drain" subtitle="Analyze energy loss while your vehicle is parked" />
        {vehicles && vehicles.length > 1 && (
          <Select
            value={vehicleId ?? ''}
            onChange={e => setSelectedVehicle(Number(e.target.value))}
            options={vehicles.map(v => ({ value: String(v.id), label: v.display_name || v.vin }))}
          />
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
        <MetricCard icon={<TrendingDown className="h-5 w-5" />} label="Avg Drain Rate" value={`${fmtNumber(stats?.avg_drain_rate ?? 0)}%/hr`} color="purple" />
        <MetricCard icon={<BatteryWarning className="h-5 w-5" />} label="Total Range Lost" value={`${fmtInt(convertDistance(stats?.total_range_lost ?? 0))} ${distanceUnit}`} color="red" />
        <MetricCard icon={<Clock className="h-5 w-5" />} label="Total Idle Hours" value={`${fmtInt(stats?.total_hours ?? 0)} hrs`} color="cyan" />
        <MetricCard icon={<Shield className="h-5 w-5" />} label="Events" value={String(stats?.event_count ?? 0)} color="amber" />
      </div>

      {/* Sentry comparison */}
      {stats && (stats.avg_sentry_drain > 0 || stats.avg_nosentry_drain > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <MetricCard
            icon={<Shield className="h-4 w-4" />}
            label="Sentry Mode ON"
            value={`${fmtNumber(stats.avg_sentry_drain)}%/hr`}
            color="red"
          />
          <MetricCard
            icon={<Moon className="h-4 w-4" />}
            label="Sentry Mode OFF"
            value={`${fmtNumber(stats.avg_nosentry_drain)}%/hr`}
            color="green"
          />
        </div>
      )}

      {/* Drain Rate Over Time */}
      <ChartContainer
        title="Drain Rate Over Time"
        className="mb-6 sm:mb-8"
        height={280}
        actions={events && events.length > 0 ? (
          <>
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
          </>
        ) : undefined}
      >
        {isLoading ? <Skeleton className="h-48 sm:h-64 rounded-xl" /> : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--text-muted)' }}>No vampire drain data available</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
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
      </ChartContainer>

      {/* Scatter: Duration vs Drain */}
      {sentryData.length > 0 && (
        <ChartContainer title="Duration vs Drain Rate" className="mb-6 sm:mb-8" height={280}>
          <ResponsiveContainer width="100%" height="100%">
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
        </ChartContainer>
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
                    <td className="py-2.5 pr-4" style={{ color: 'var(--text-primary)' }}>{formatDate(e.start_date)}</td>
                    <td className="text-right pr-4 text-[var(--text-secondary)]">{fmtNumber(e.duration_hours)}h</td>
                    <td className="text-right pr-4 text-neon-red">{e.battery_lost}%</td>
                    <td className="text-right pr-4 text-neon-purple">{fmtNumber(e.drain_rate_pct_per_hour)}%/hr</td>
                    <td className="text-right pr-4 text-[var(--text-secondary)]">{e.outside_temp_avg !== null ? `${fmtInt(convertTemp(e.outside_temp_avg))}${tempUnit}` : '--'}</td>
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
