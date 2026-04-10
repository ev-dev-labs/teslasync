import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAPICallLogs, getAPICallLogStats } from '../api'
import { PageHeader, GlassPanel, FadeIn, StatCard, Button } from '../components/ui'
import { formatDateTime } from '../lib/dateFormat'
import { FileText, Clock, AlertTriangle, Activity, Download, ChevronLeft, ChevronRight, Search, Filter, ChevronDown, ChevronUp, X } from 'lucide-react'
import { fmtNumber } from '../lib/numberFormat'
import clsx from 'clsx'

function StatusBadge({ code }: { code: number | null }) {
  if (!code) return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-400">N/A</span>
  const color = code < 300 ? 'text-emerald-400 bg-emerald-400/10' : code < 400 ? 'text-blue-400 bg-blue-400/10' : code < 500 ? 'text-amber-400 bg-amber-400/10' : 'text-red-400 bg-red-400/10'
  return <span className={clsx('text-xs font-mono px-2 py-0.5 rounded-full', color)}>{code}</span>
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: 'text-emerald-400 bg-emerald-400/10 ring-emerald-400/20',
    POST: 'text-blue-400 bg-blue-400/10 ring-blue-400/20',
    PUT: 'text-amber-400 bg-amber-400/10 ring-amber-400/20',
    PATCH: 'text-orange-400 bg-orange-400/10 ring-orange-400/20',
    DELETE: 'text-red-400 bg-red-400/10 ring-red-400/20',
  }
  return (
    <span className={clsx('text-[10px] font-bold font-mono px-2 py-0.5 rounded-md ring-1', colors[method] || 'text-gray-400 bg-gray-400/10 ring-gray-400/20')}>
      {method}
    </span>
  )
}

function JsonViewer({ data, label }: { data: string | null; label: string }) {
  if (!data) return <p className="text-xs text-[var(--text-muted)] italic">No {label.toLowerCase()}</p>
  let formatted = data
  try {
    formatted = JSON.stringify(JSON.parse(data), null, 2)
  } catch { /* not JSON, show raw */ }
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-1">{label}</p>
      <pre className="text-xs font-mono p-3 rounded-lg overflow-x-auto max-h-60 whitespace-pre-wrap break-all" style={{ background: 'var(--surface-1)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)' }}>
        {formatted}
      </pre>
    </div>
  )
}

export default function ApiLogs() {
  const [page, setPage] = useState(0)
  const [method, setMethod] = useState('')
  const [status, setStatus] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const limit = 25

  const { data: stats } = useQuery({
    queryKey: ['api-log-stats'],
    queryFn: getAPICallLogStats,
    refetchInterval: 30_000,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['api-logs', page, method, status, endpoint, startDate, endDate],
    queryFn: () => getAPICallLogs({
      limit,
      offset: page * limit,
      method: method || undefined,
      status: status || undefined,
      endpoint: endpoint || undefined,
      start: startDate || undefined,
      end: endDate || undefined,
    }),
    refetchInterval: 10_000,
  })

  const logs = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / limit)
  const hasFilters = method || status || endpoint || startDate || endDate

  function clearFilters() {
    setMethod('')
    setStatus('')
    setEndpoint('')
    setStartDate('')
    setEndDate('')
    setPage(0)
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `teslasync-api-logs-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Tesla API Logs" subtitle="Record of all Tesla API calls with request/response details" />

      {/* Stats */}
      <FadeIn>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={<FileText className="h-5 w-5" />} label="Total Calls" value={stats?.total_calls?.toLocaleString() ?? '—'} color="cyan" />
          <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Error Rate" value={stats ? `${fmtNumber(stats.error_rate)}%` : '—'} color="amber" change={stats && stats.error_rate > 5 ? { value: String(stats.error_count), positive: false } : undefined} />
          <StatCard icon={<Clock className="h-5 w-5" />} label="Avg Duration" value={stats ? `${Math.round(stats.avg_duration_ms)}ms` : '—'} color="green" />
          <StatCard icon={<Activity className="h-5 w-5" />} label="Last 24h" value={stats?.last_24h?.toLocaleString() ?? '—'} color="purple" />
        </div>
      </FadeIn>

      {/* Filters */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-[var(--text-muted)]" />
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Filters</span>
            {hasFilters && (
              <Button variant="ghost" size="sm" icon={<X className="h-3 w-3" />} onClick={clearFilters} className="ml-auto">Clear</Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <select value={method} onChange={e => { setMethod(e.target.value); setPage(0) }} className="glass-input px-3 py-2 text-sm">
              <option value="">All Methods</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
            <select value={status} onChange={e => { setStatus(e.target.value); setPage(0) }} className="glass-input px-3 py-2 text-sm">
              <option value="">All Status</option>
              <option value="2xx">2xx Success</option>
              <option value="3xx">3xx Redirect</option>
              <option value="4xx">4xx Client Error</option>
              <option value="5xx">5xx Server Error</option>
            </select>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Filter by endpoint..."
                value={endpoint}
                onChange={e => { setEndpoint(e.target.value); setPage(0) }}
                className="glass-input pl-8 pr-3 py-2 text-sm"
              />
            </div>
            <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(0) }} className="glass-input px-3 py-2 text-sm" placeholder="Start date" />
            <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(0) }} className="glass-input px-3 py-2 text-sm" placeholder="End date" />
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Table */}
      <FadeIn delay={0.1}>
        <GlassPanel className="overflow-hidden">
          {/* Header with export */}
          <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--glass-border)' }}>
            <p className="text-sm text-[var(--text-secondary)]">
              {total > 0 ? `Showing ${page * limit + 1}–${Math.min((page + 1) * limit, total)} of ${total.toLocaleString()}` : 'No logs found'}
            </p>
            <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExport} disabled={logs.length === 0}>Export JSON</Button>
          </div>

          {isLoading ? (
            <div className="p-8 text-center">
              <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[var(--theme-primary)] border-t-transparent" />
              <p className="text-sm text-[var(--text-muted)] mt-2">Loading logs...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="h-10 w-10 text-[var(--text-muted)] mx-auto mb-3 opacity-40" />
              <p className="text-sm text-[var(--text-muted)]">No API call logs found</p>
              {hasFilters && <p className="text-xs text-[var(--text-muted)] mt-1">Try adjusting your filters</p>}
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--text-muted)]" style={{ background: 'var(--surface-2)' }}>
                      <th className="px-4 py-3 font-medium">Time</th>
                      <th className="px-4 py-3 font-medium">Method</th>
                      <th className="px-4 py-3 font-medium">Endpoint</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Duration</th>
                      <th className="px-4 py-3 font-medium">Error</th>
                      <th className="px-4 py-3 font-medium w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: 'var(--glass-border)' }}>
                    {logs.map((log) => (
                      <>
                        <tr
                          key={log.id}
                          onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                          className="cursor-pointer transition-colors hover:bg-white/[0.02]"
                          style={{ borderColor: 'var(--glass-border)' }}
                        >
                          <td className="px-4 py-3 text-xs font-mono text-[var(--text-muted)] whitespace-nowrap">
                            {formatDateTime(log.created_at)}
                          </td>
                          <td className="px-4 py-3"><MethodBadge method={log.method} /></td>
                          <td className="px-4 py-3 text-xs font-mono text-[var(--text-secondary)] max-w-[300px] truncate" title={log.url}>
                            {log.url.replace(/^https?:\/\/[^/]+/, '')}
                          </td>
                          <td className="px-4 py-3"><StatusBadge code={log.status_code} /></td>
                          <td className="px-4 py-3 text-xs font-mono text-right text-[var(--text-secondary)]">{log.duration_ms}ms</td>
                          <td className="px-4 py-3 text-xs text-red-400 max-w-[200px] truncate">{log.error || '—'}</td>
                          <td className="px-4 py-3">
                            {expandedId === log.id ? <ChevronUp className="h-3.5 w-3.5 text-[var(--text-muted)]" /> : <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
                          </td>
                        </tr>
                        {expandedId === log.id && (
                          <tr key={`${log.id}-detail`}>
                            <td colSpan={7} className="p-4 space-y-3" style={{ background: 'var(--surface-2)' }}>
                              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                <JsonViewer data={log.request_body} label="Request Body" />
                                <JsonViewer data={log.response_body} label="Response Body" />
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="sm:hidden divide-y" style={{ borderColor: 'var(--glass-border)' }}>
                {logs.map((log) => (
                  <div key={log.id} className="p-3">
                    <div
                      onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <MethodBadge method={log.method} />
                        <StatusBadge code={log.status_code} />
                        <span className="text-[10px] font-mono text-[var(--text-muted)] ml-auto">{log.duration_ms}ms</span>
                      </div>
                      <p className="text-xs font-mono text-[var(--text-secondary)] truncate">{log.url.replace(/^https?:\/\/[^/]+/, '')}</p>
                      <p className="text-[10px] text-[var(--text-muted)] mt-1">{formatDateTime(log.created_at)}</p>
                      {log.error && <p className="text-[10px] text-red-400 mt-1 truncate">{log.error}</p>}
                    </div>
                    {expandedId === log.id && (
                      <div className="mt-3 space-y-2">
                        <JsonViewer data={log.request_body} label="Request Body" />
                        <JsonViewer data={log.response_body} label="Response Body" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t" style={{ borderColor: 'var(--glass-border)' }}>
              <Button variant="secondary" size="sm" icon={<ChevronLeft className="h-3.5 w-3.5" />} onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Previous</Button>
              <span className="text-xs text-[var(--text-muted)]">
                Page {page + 1} of {totalPages}
              </span>
              <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Next <ChevronRight className="h-3.5 w-3.5" /></Button>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </div>
  )
}
