import { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Activity, BarChart3 } from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, Skeleton, EmptyState } from '../components/ui'
import { ChartTooltip } from '../components/Charts'
import { CHART_COLORS } from '../lib/colors'
import { request } from '../api/client'
import { usePageTitle } from '../hooks/usePageTitle'
import { fmtNumber, fmtInt } from '../lib/numberFormat'
import {
  SignalMultiSelect,
  DateTimeRangeControls,
  QueryControls,
  SignalDataTable,
  toLocalDatetimeStr,
  type SignalHistoryResponse,
} from '../components/SignalQueryControls'

// ── Types (unique to Explorer) ──

interface SignalStat {
  signal: string
  min: number
  max: number
  avg: number
  count: number
}

// ── Component ──

export default function SignalExplorer() {
  usePageTitle('Signal Explorer')
  const vehicleId = 1

  // Signal selection
  const [selectedSignals, setSelectedSignals] = useState<string[]>([])

  // DateTime range — default 1 hour
  const [fromStr, setFromStr] = useState(() => toLocalDatetimeStr(new Date(Date.now() - 3600_000)))
  const [toStr, setToStr] = useState(() => toLocalDatetimeStr(new Date()))

  // Explore trigger key — queries only run when this changes
  const [exploreKey, setExploreKey] = useState<number | null>(null)

  // Table pagination
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)

  // ── Preset helper ──
  const applyPreset = useCallback((hours: number) => {
    const end = new Date()
    setFromStr(toLocalDatetimeStr(new Date(end.getTime() - hours * 3600_000)))
    setToStr(toLocalDatetimeStr(end))
  }, [])

  // ── Explore ──
  const canExplore = selectedSignals.length > 0 && fromStr && toStr

  const handleExplore = useCallback(() => {
    if (!canExplore) return
    setPage(1)
    setExploreKey(Date.now())
  }, [canExplore])

  const signalsCsv = selectedSignals.join(',')
  const fromIso = fromStr ? new Date(fromStr).toISOString() : ''
  const toIso = toStr ? new Date(toStr).toISOString() : ''

  // ── Chart data query (up to 1000 pts) ──
  const { data: chartResponse, isLoading: chartLoading } = useQuery<SignalHistoryResponse>({
    queryKey: ['explorer-chart', exploreKey],
    queryFn: () =>
      request(`/signals/history?vehicle_id=${vehicleId}&signals=${signalsCsv}&from=${fromIso}&to=${toIso}&page=1&per_page=1000`),
    enabled: exploreKey !== null,
  })

  // ── Stats query ──
  const { data: statsData, isLoading: statsLoading } = useQuery<SignalStat[]>({
    queryKey: ['explorer-stats', exploreKey],
    queryFn: () =>
      request(`/signals/stats?vehicle_id=${vehicleId}&signals=${signalsCsv}&from=${fromIso}&to=${toIso}`),
    enabled: exploreKey !== null,
  })

  // ── Paginated table query ──
  const { data: tableResponse, isLoading: tableLoading } = useQuery<SignalHistoryResponse>({
    queryKey: ['explorer-table', exploreKey, page, perPage],
    queryFn: () =>
      request(`/signals/history?vehicle_id=${vehicleId}&signals=${signalsCsv}&from=${fromIso}&to=${toIso}&page=${page}&per_page=${perPage}`),
    enabled: exploreKey !== null,
  })

  const isLoading = chartLoading || statsLoading || tableLoading
  const hasData = exploreKey !== null

  // ── Chart data transform ──
  const chartData = useMemo(() => {
    if (!chartResponse?.data?.length) return []
    const map = new Map<string, Record<string, unknown>>()
    for (const row of chartResponse.data) {
      const ts = row.created_at
      let entry = map.get(ts)
      if (!entry) {
        entry = { timestamp: ts }
        map.set(ts, entry)
      }
      entry[row.signal] = row.value_num ?? (row.value_bool === true ? 1 : row.value_bool === false ? 0 : null)
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.timestamp as string).getTime() - new Date(b.timestamp as string).getTime(),
    )
  }, [chartResponse])

  // Dual Y-axis when signal scales differ significantly
  const useRightAxis = useMemo(() => {
    if (!statsData || statsData.length < 2) return false
    const ranges = statsData.map(s => Math.abs(s.max - s.min) || 1)
    return ranges[0] / ranges[1] > 10 || ranges[1] / ranges[0] > 10
  }, [statsData])

  return (
    <FadeIn>
      <PageHeader
        title="Signal Explorer"
        subtitle="Explore signal history — multi-signal charts, stats & data"
        icon={<Activity className="h-7 w-7 text-neon-cyan" />}
      />

      {/* ── Controls ── */}
      <GlassPanel className="p-4 sm:p-5 mb-6 space-y-4">
        <SignalMultiSelect
          vehicleId={vehicleId}
          selected={selectedSignals}
          onChange={setSelectedSignals}
          maxSignals={5}
        />
        <DateTimeRangeControls
          fromStr={fromStr}
          toStr={toStr}
          onFromChange={setFromStr}
          onToChange={setToStr}
          onPreset={applyPreset}
        />
        <QueryControls
          perPage={perPage}
          onPerPageChange={v => { setPerPage(v); setPage(1) }}
          onQuery={handleExplore}
          disabled={!canExplore}
          loading={isLoading && hasData}
          label="Explore"
        />
      </GlassPanel>

      {/* ── Content ── */}
      {!hasData ? (
        <GlassPanel className="p-4">
          <EmptyState
            icon={<Activity className="h-10 w-10" />}
            title="Select signals and click Explore"
            description="Choose up to 5 signals, set a time range, and click Explore to visualise signal history."
          />
        </GlassPanel>
      ) : (
        <div className="space-y-5">
          {/* ── Chart ── */}
          <GlassPanel className="p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-4 w-4 text-neon-cyan" />
              <h2 className="section-title">Signal Chart</h2>
              {chartResponse && (
                <span className="ml-auto text-[10px] text-[var(--text-muted)]">
                  {fmtInt(chartResponse.data.length)} points loaded
                </span>
              )}
            </div>

            {chartLoading ? (
              <Skeleton className="h-[350px] w-full" />
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={chartData} margin={{ top: 10, right: useRightAxis ? 20 : 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="timestamp"
                    tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                    tickFormatter={(v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  />
                  <YAxis yAxisId="left" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  {useRightAxis && (
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  )}
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, cursor: 'pointer' }} iconType="circle" />
                  {selectedSignals.map((sig, i) => (
                    <Line
                      key={sig}
                      type="monotone"
                      dataKey={sig}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={1.5}
                      dot={false}
                      name={sig}
                      yAxisId={useRightAxis && i === 1 ? 'right' : 'left'}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[350px] flex items-center justify-center text-[var(--text-muted)]">
                No data for this time range
              </div>
            )}
          </GlassPanel>

          {/* ── Stats summary ── */}
          <GlassPanel className="p-4 sm:p-5">
            <h2 className="section-title mb-3">Stats Summary</h2>
            {statsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
              </div>
            ) : statsData && statsData.length > 0 ? (
              <div className="overflow-x-auto rounded-xl">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="px-3 py-2 text-left text-[var(--text-muted)] font-medium">Signal</th>
                      <th className="px-3 py-2 text-right text-[var(--text-muted)] font-medium">Min</th>
                      <th className="px-3 py-2 text-right text-[var(--text-muted)] font-medium">Max</th>
                      <th className="px-3 py-2 text-right text-[var(--text-muted)] font-medium">Avg</th>
                      <th className="px-3 py-2 text-right text-[var(--text-muted)] font-medium">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statsData.map((s, i) => (
                      <tr key={s.signal} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                        <td className="px-3 py-2 font-mono font-semibold" style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>
                          {s.signal}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[var(--text-secondary)]">{fmtNumber(s.min)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[var(--text-secondary)]">{fmtNumber(s.max)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[var(--text-primary)]">{fmtNumber(s.avg)}</td>
                        <td className="px-3 py-2 text-right font-mono text-[var(--text-muted)]">{fmtInt(s.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">No stats available</p>
            )}
          </GlassPanel>

          {/* ── Data table ── */}
          <SignalDataTable
            rows={tableResponse?.data ?? []}
            page={page}
            totalPages={tableResponse?.pagination.total_pages ?? 1}
            total={tableResponse?.pagination.total ?? 0}
            perPage={perPage}
            onPageChange={setPage}
            loading={tableLoading}
          />
        </div>
      )}
    </FadeIn>
  )
}
