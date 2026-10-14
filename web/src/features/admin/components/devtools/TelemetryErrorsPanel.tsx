import { useTranslation } from 'react-i18next'
import { Badge, Button, Caption, ErrorText, HelperText, Text, DataTable, type Column } from '@/components/ui'
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
  const { t } = useTranslation()
  if (!requested) {
    return (
      <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3">
        <Caption>{title}</Caption>
        <HelperText className="mt-1 italic">{idleMessage}</HelperText>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3">
        <Caption>{title}</Caption>
        <div className="mt-2"><Skeleton lines={3} /></div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="mt-3 rounded-lg bg-[var(--semantic-danger-bg)] p-3">
        <Caption>{title}</Caption>
        <ErrorText className="mt-1">{error}</ErrorText>
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
        <Caption>{title}</Caption>
        <DataTable
          tableId="admin:fleet-api-errors"
          columns={columns}
          mobileColumns={['timestamp', 'code', 'message']}
          data={rows}
          enableValueFilters
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
    <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3">
      <div className="flex items-center justify-between">
        <Caption>{title}</Caption>
        <Badge variant={ok ? 'success' : 'warning'} size="sm" dot>
          {ok ? '0' : '?'}
        </Badge>
      </div>
      <HelperText className="mt-1">
        {ok ? emptyMessage : t('devtools.errorsUnknown', 'Fleet Telemetry error status is unknown: the response format was not recognized.')}
      </HelperText>
      {!ok && rawData != null && (
        <details className="mt-2">
          <summary className="cursor-pointer">
            <Caption>{rawDisclosureLabel}</Caption>
          </summary>
          <Text as="pre" variant="code" className="mt-1 max-h-64 overflow-auto rounded bg-[var(--surface-1)] p-2">
            {JSON.stringify(rawData, null, 2)}
          </Text>
        </details>
      )}
    </div>
  )
}
