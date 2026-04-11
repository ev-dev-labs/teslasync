import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { request } from '../api/client'
import { PageHeader, GlassPanel, FadeIn, EmptyState } from '../components/ui'
import { Database } from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'
import {
  SignalMultiSelect,
  DateTimeRangeControls,
  QueryControls,
  SignalDataTable,
  toLocalDatetimeStr,
  type SignalHistoryResponse,
} from '../components/SignalQueryControls'

export default function SignalLogViewer() {
  usePageTitle('Signal Log')
  const { vehicleId: paramVehicleId } = useParams<{ vehicleId: string }>()
  const vehicleId = paramVehicleId ? Number(paramVehicleId) : 1

  // Signal selection
  const [selectedSignals, setSelectedSignals] = useState<string[]>([])

  // Date range (local-TZ strings for the datetime-local inputs)
  const now = useMemo(() => new Date(), [])
  const [fromStr, setFromStr] = useState(() => toLocalDatetimeStr(new Date(now.getTime() - 1 * 3600_000)))
  const [toStr, setToStr] = useState(() => toLocalDatetimeStr(now))

  // Pagination
  const [perPage, setPerPage] = useState(50)
  const [page, setPage] = useState(1)

  // Query trigger — only fetch when user clicks "Query"
  const [queryParams, setQueryParams] = useState<{
    signals: string[]
    from: string
    to: string
    page: number
    perPage: number
  } | null>(null)

  function applyPreset(hours: number) {
    const end = new Date()
    const start = new Date(end.getTime() - hours * 3600_000)
    setFromStr(toLocalDatetimeStr(start))
    setToStr(toLocalDatetimeStr(end))
  }

  function handleQuery() {
    if (selectedSignals.length === 0) return
    const fromUTC = new Date(fromStr).toISOString()
    const toUTC = new Date(toStr).toISOString()
    setPage(1)
    setQueryParams({ signals: selectedSignals, from: fromUTC, to: toUTC, page: 1, perPage })
  }

  function goToPage(p: number) {
    setPage(p)
    if (queryParams) setQueryParams({ ...queryParams, page: p, perPage })
  }

  // Fetch history
  const { data: historyResp, isLoading, isFetching } = useQuery<SignalHistoryResponse>({
    queryKey: ['signal-history', queryParams],
    queryFn: () => {
      const qp = queryParams!
      const params = new URLSearchParams({
        vehicle_id: String(vehicleId),
        signals: qp.signals.join(','),
        from: qp.from,
        to: qp.to,
        page: String(qp.page),
        per_page: String(qp.perPage),
      })
      return request(`/signals/history?${params}`)
    },
    enabled: !!queryParams,
  })

  const rows = historyResp?.data ?? []
  const pagination = historyResp?.pagination
  const totalPages = pagination?.total_pages ?? 1
  const totalRecords = pagination?.total ?? 0
  const hasQueried = queryParams !== null

  return (
    <FadeIn>
      <PageHeader
        title="Signal Log Viewer"
        subtitle="Query signal history from Postgres"
        icon={<Database className="h-7 w-7 text-neon-cyan" />}
      />

      {/* ── Controls ── */}
      <GlassPanel className="p-4 mb-4 space-y-4">
        <SignalMultiSelect
          vehicleId={vehicleId}
          selected={selectedSignals}
          onChange={setSelectedSignals}
        />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
          <DateTimeRangeControls
            fromStr={fromStr}
            toStr={toStr}
            onFromChange={setFromStr}
            onToChange={setToStr}
            onPreset={applyPreset}
          />
          <QueryControls
            perPage={perPage}
            onPerPageChange={setPerPage}
            onQuery={handleQuery}
            disabled={selectedSignals.length === 0 || isFetching}
            loading={isFetching}
          />
        </div>
      </GlassPanel>

      {/* ── Results ── */}
      {!hasQueried ? (
        <EmptyState
          icon={<Database className="h-10 w-10" />}
          title="Select signals and click Query"
          description="Choose one or more signals, set a date range, then hit Query to browse signal history."
        />
      ) : (
        <SignalDataTable
          rows={rows}
          page={page}
          totalPages={totalPages}
          total={totalRecords}
          perPage={perPage}
          onPageChange={goToPage}
          loading={isLoading}
        />
      )}
    </FadeIn>
  )
}
