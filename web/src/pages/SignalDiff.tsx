import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GitCompare, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts'
import { PageHeader, GlassPanel, FadeIn, Skeleton, Button, Input, Select, DataTable, type Column } from '../components/ui'
import { ChartTooltip } from '../components/Charts'
import { request } from '../api/client'
import { fmtNumber } from '../lib/numberFormat'
import clsx from 'clsx'
import { usePageTitle } from '../hooks/usePageTitle'

interface SignalPoint {
  timestamp: string
  value_num?: number
  value_str?: string
  value_bool?: boolean
}

interface SignalHistoryResponse {
  vehicle_id: number
  signal: string
  from: string
  to: string
  count: number
  data: SignalPoint[]
}

interface RangeStats {
  min: number
  max: number
  avg: number
  count: number
}

function computeStats(data: SignalPoint[]): RangeStats {
  const nums = data.map(d => d.value_num).filter((v): v is number => v != null)
  if (nums.length === 0) return { min: 0, max: 0, avg: 0, count: 0 }
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length
  return { min, max, avg, count: nums.length }
}

function toLocalDatetimeInput(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function endOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(23, 59, 59, 999)
  return r
}

export default function SignalDiff() {
  usePageTitle('Signal Diff')
  const vehicleId = 1
  const [selectedSignal, setSelectedSignal] = useState('')

  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const yesterdayStart = startOfDay(new Date(now.getTime() - 86400000))
  const yesterdayEnd = endOfDay(new Date(now.getTime() - 86400000))

  const [rangeAFrom, setRangeAFrom] = useState(toLocalDatetimeInput(todayStart))
  const [rangeATo, setRangeATo] = useState(toLocalDatetimeInput(todayEnd))
  const [rangeBFrom, setRangeBFrom] = useState(toLocalDatetimeInput(yesterdayStart))
  const [rangeBTo, setRangeBTo] = useState(toLocalDatetimeInput(yesterdayEnd))

  const { data: availableSignals } = useQuery<{ signals: string[] }>({
    queryKey: ['signal-available', vehicleId],
    queryFn: () => request(`/signals/${vehicleId}/available`),
  })

  const rangeAEnabled = !!selectedSignal && !!rangeAFrom && !!rangeATo
  const rangeBEnabled = !!selectedSignal && !!rangeBFrom && !!rangeBTo

  const { data: historyA, isLoading: loadingA } = useQuery<SignalHistoryResponse>({
    queryKey: ['signal-diff-a', vehicleId, selectedSignal, rangeAFrom, rangeATo],
    queryFn: () => request(`/signals/${vehicleId}/${selectedSignal}/history?from=${new Date(rangeAFrom).toISOString()}&to=${new Date(rangeATo).toISOString()}&limit=2000`),
    enabled: rangeAEnabled,
  })

  const { data: historyB, isLoading: loadingB } = useQuery<SignalHistoryResponse>({
    queryKey: ['signal-diff-b', vehicleId, selectedSignal, rangeBFrom, rangeBTo],
    queryFn: () => request(`/signals/${vehicleId}/${selectedSignal}/history?from=${new Date(rangeBFrom).toISOString()}&to=${new Date(rangeBTo).toISOString()}&limit=2000`),
    enabled: rangeBEnabled,
  })

  const statsA = useMemo(() => computeStats(historyA?.data ?? []), [historyA])
  const statsB = useMemo(() => computeStats(historyB?.data ?? []), [historyB])

  const chartDataA = useMemo(() =>
    (historyA?.data ?? []).map(p => ({
      time: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: p.value_num ?? (p.value_bool ? 1 : 0),
    })), [historyA])

  const chartDataB = useMemo(() =>
    (historyB?.data ?? []).map(p => ({
      time: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: p.value_num ?? (p.value_bool ? 1 : 0),
    })), [historyB])

  function applyPreset(preset: 'today-yesterday' | 'week') {
    if (preset === 'today-yesterday') {
      setRangeAFrom(toLocalDatetimeInput(todayStart))
      setRangeATo(toLocalDatetimeInput(todayEnd))
      setRangeBFrom(toLocalDatetimeInput(yesterdayStart))
      setRangeBTo(toLocalDatetimeInput(yesterdayEnd))
    } else {
      const thisWeekStart = new Date(now)
      thisWeekStart.setDate(now.getDate() - now.getDay())
      thisWeekStart.setHours(0, 0, 0, 0)
      const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86400000)
      const lastWeekEnd = new Date(thisWeekStart.getTime() - 1)
      setRangeAFrom(toLocalDatetimeInput(thisWeekStart))
      setRangeATo(toLocalDatetimeInput(now))
      setRangeBFrom(toLocalDatetimeInput(lastWeekStart))
      setRangeBTo(toLocalDatetimeInput(lastWeekEnd))
    }
  }

  function DiffIndicator({ label, a, b }: { label: string; a: number; b: number }) {
    const diff = a - b
    const icon = diff > 0 ? <ArrowUp className="h-3 w-3" /> : diff < 0 ? <ArrowDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />
    const color = diff > 0 ? 'text-neon-green' : diff < 0 ? 'text-neon-red' : 'text-[var(--text-muted)]'
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-[var(--text-muted)]">{label}:</span>
        <span className={clsx('flex items-center gap-0.5 font-mono font-medium', color)}>
          {icon} {fmtNumber(Math.abs(diff))}
        </span>
      </div>
    )
  }

  interface ComparisonRow { label: string; a: number; b: number }

  const comparisonRows: ComparisonRow[] = [
    { label: 'Min', a: statsA.min, b: statsB.min },
    { label: 'Max', a: statsA.max, b: statsB.max },
    { label: 'Average', a: statsA.avg, b: statsB.avg },
    { label: 'Data Points', a: statsA.count, b: statsB.count },
  ]

  const comparisonColumns: Column<ComparisonRow>[] = [
    { key: 'metric', header: 'Metric', render: (row) => <span className="text-[var(--text-secondary)]">{row.label}</span> },
    { key: 'rangeA', header: 'Range A', className: 'text-right', render: (row) => <span className="font-mono text-[var(--text-primary)]">{fmtNumber(row.a)}</span> },
    { key: 'rangeB', header: 'Range B', className: 'text-right', render: (row) => <span className="font-mono text-[var(--text-primary)]">{fmtNumber(row.b)}</span> },
    { key: 'diff', header: 'Diff', className: 'text-right', render: (row) => <DiffIndicator label="" a={row.a} b={row.b} /> },
  ]

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Signal Diff"
        subtitle="Compare signal values across two time ranges"
        icon={<GitCompare className="h-6 w-6 text-neon-cyan" />}
      />

      {/* Controls */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Signal Selector */}
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">Signal</label>
              <Select
                value={selectedSignal}
                onChange={e => setSelectedSignal(e.target.value)}
                options={[{ value: '', label: 'Select a signal…' }, ...(availableSignals?.signals ?? []).map(s => ({ value: s, label: s }))]}
              />
            </div>

            {/* Range A */}
            <div>
              <label className="block text-xs text-neon-cyan mb-1.5">Range A</label>
              <div className="flex gap-2">
                <Input type="datetime-local" value={rangeAFrom} onChange={e => setRangeAFrom(e.target.value)}
                  className="flex-1" />
                <Input type="datetime-local" value={rangeATo} onChange={e => setRangeATo(e.target.value)}
                  className="flex-1" />
              </div>
            </div>

            {/* Range B */}
            <div>
              <label className="block text-xs text-neon-amber mb-1.5">Range B</label>
              <div className="flex gap-2">
                <Input type="datetime-local" value={rangeBFrom} onChange={e => setRangeBFrom(e.target.value)}
                  className="flex-1" />
                <Input type="datetime-local" value={rangeBTo} onChange={e => setRangeBTo(e.target.value)}
                  className="flex-1" />
              </div>
            </div>
          </div>

          {/* Presets */}
          <div className="flex gap-2 mt-4">
            <Button variant="secondary" size="sm" onClick={() => applyPreset('today-yesterday')}>
              Today vs Yesterday
            </Button>
            <Button variant="secondary" size="sm" onClick={() => applyPreset('week')}>
              This Week vs Last Week
            </Button>
          </div>
        </GlassPanel>
      </FadeIn>

      {selectedSignal && (
        <>
          {/* Side-by-Side Charts */}
          <FadeIn delay={0.2}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Range A Chart */}
              <GlassPanel className="p-5">
                <h3 className="text-sm font-semibold text-neon-cyan mb-3">Range A</h3>
                {loadingA ? (
                  <Skeleton className="h-56" />
                ) : chartDataA.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartDataA}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="value" stroke="#00f0ff" strokeWidth={1.5} dot={false} name={selectedSignal} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-56 flex items-center justify-center text-[var(--text-muted)] text-sm">No data in Range A</div>
                )}
              </GlassPanel>

              {/* Range B Chart */}
              <GlassPanel className="p-5">
                <h3 className="text-sm font-semibold text-neon-amber mb-3">Range B</h3>
                {loadingB ? (
                  <Skeleton className="h-56" />
                ) : chartDataB.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartDataB}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={1.5} dot={false} name={selectedSignal} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-56 flex items-center justify-center text-[var(--text-muted)] text-sm">No data in Range B</div>
                )}
              </GlassPanel>
            </div>
          </FadeIn>

          {/* Summary Comparison Table */}
          <FadeIn delay={0.3}>
            <GlassPanel className="p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Comparison Summary</h3>
              <DataTable
                columns={comparisonColumns}
                data={comparisonRows}
                keyExtractor={(row) => row.label}
              />
            </GlassPanel>
          </FadeIn>
        </>
      )}

      {!selectedSignal && (
        <FadeIn delay={0.2}>
          <GlassPanel className="p-12 flex flex-col items-center justify-center">
            <GitCompare className="h-12 w-12 text-[var(--text-muted)] opacity-30 mb-3" />
            <p className="text-lg text-[var(--text-muted)]">Select a signal to compare</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">Choose a signal and configure two time ranges to compare</p>
          </GlassPanel>
        </FadeIn>
      )}
    </div>
  )
}

