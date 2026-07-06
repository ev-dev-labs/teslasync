import { Badge, Button, DataTable, type Column } from '@/components/ui'
import { Skeleton } from '@/components/feedback'
import { Icons } from '@/lib/icons'

import type { TelemetryError } from './types'

interface TelemetryErrorsPanelProps {
  title: string
  loading: boolean
  error: string | undefined
  requested: boolean
  ok: boolean
  errors: TelemetryError[]
  columns: Column<TelemetryError>[]
  vin: string
  idleMessage: string
  emptyMessage: string
  rawData: unknown
  rawDisclosureLabel: string
  downloadLabel: string
}

// TelemetryErrorsPanel renders the 4-state UI for the "View Errors"
// button: idle | loading | error | empty | data. The pre-fix code only
// rendered the data state, which silently disappeared on the much more
// common empty / error / loading states. The raw-response disclosure
// beneath the empty state helps the operator distinguish "Tesla returned
// zero errors" (healthy) from "Tesla returned a shape we did not
// recognise" (which would also produce zero rows).
export function TelemetryErrorsPanel({
  title,
  loading,
  error,
  requested,
  ok,
  errors,
  columns,
  vin,
  idleMessage,
  emptyMessage,
  rawData,
  rawDisclosureLabel,
  downloadLabel,
}: TelemetryErrorsPanelProps) {
  if (!requested) {
    return (
      <div className="mt-3 rounded-lg bg-white/[0.02] p-3">
        <span className="text-xs font-medium text-[var(--text-secondary)]">{title}</span>
        <p className="mt-1 text-sm italic text-[var(--text-muted)]">{idleMessage}</p>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="mt-3 rounded-lg bg-white/[0.02] p-3">
        <span className="text-xs font-medium text-[var(--text-secondary)]">{title}</span>
        <div className="mt-2"><Skeleton lines={3} /></div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="mt-3 rounded-lg bg-neon-red/5 p-3">
        <span className="text-xs font-medium text-[var(--text-secondary)]">{title}</span>
        <p className="mt-1 text-sm text-rose-300">{error}</p>
      </div>
    )
  }
  // Null-safety: `errors` is typed as a non-optional array, but this panel
  // sits at the boundary of a defensively-parsed Tesla response, so guard
  // against a runtime shape-drift handing us `undefined` before we touch
  // `.length` / iterate — a blank crash here is worse than an empty state.
  const rows = errors ?? []
  if (rows.length > 0) {
    return (
      <div className="space-y-2">
        <DataTable
          tableId="admin:fleet-api-errors"
          columns={columns}
          data={rows}
          keyExtractor={(r) => r.rowKey}
          compact
          pagination={{ defaultPageSize: 50 }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `telemetry-errors-${vin || 'all'}.json`
            // Firefox (and some WebKit builds) only honour a synthetic click
            // when the anchor is attached to the live document; detached
            // anchors are silently ignored. Attach → click → detach.
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(url)
          }}
          icon={<Icons.download className="h-3.5 w-3.5" />}
        >
          {downloadLabel}
        </Button>
      </div>
    )
  }
  // Empty: request succeeded but produced zero rows. If extraction
  // returned ok=false (unknown shape) we surface the raw response so
  // the operator can debug Tesla's wire-shape drift; if ok=true we
  // simply say the vehicle has no errors (the healthy steady state).
  return (
    <div className="mt-3 rounded-lg bg-white/[0.02] p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-secondary)]">{title}</span>
        <Badge variant={ok ? 'success' : 'warning'} size="sm" dot>
          {ok ? '0' : '?'}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">{emptyMessage}</p>
      {!ok && rawData != null && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
            {rawDisclosureLabel}
          </summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded bg-[var(--surface-overlay)] p-2 text-xs text-[var(--text-primary)]">
            {JSON.stringify(rawData, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}
