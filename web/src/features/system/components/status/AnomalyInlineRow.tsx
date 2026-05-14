/**
 * AnomalyInlineRow — surfaces the most recent anomaly detected for the
 * primary vehicle as a Health row. Renders nothing when there are no
 * anomalies in the last 24h or no vehicles to query.
 *
 * Phase 2 inline anomaly detection: we don't poll all vehicles
 * (would be N requests). For a self-hosted single-operator instance the
 * common case is one or two vehicles; we use the first one as a sample.
 * Click-through routes to the dedicated /anomaly-detection page where
 * the operator can pick a vehicle.
 */

import { Activity } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { request } from '@/api/client'
import { STALE_TIMES } from '@/lib/constants'
import { useVehicles } from '@/api/hooks/useVehicles'
import { HealthRow } from '@/components/status'
import type { AnomalyData, AnomalyEntry } from '@/api/hooks/useAnomalies'

const SEVERITY_TO_STATUS = {
  critical: 'unhealthy' as const,
  warning: 'degraded' as const,
  info: 'unknown' as const,
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'recently'
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export function AnomalyInlineRow() {
  const { data: vehicles } = useVehicles()
  const firstVehicleId = vehicles?.[0]?.id != null ? String(vehicles[0].id) : null

  const { data } = useQuery<AnomalyData>({
    queryKey: ['system-status', 'anomalies-summary', firstVehicleId],
    queryFn: ({ signal }) =>
      request<AnomalyData>(`/analytics/anomalies?vehicle_id=${firstVehicleId}&days=1`, { signal }),
    enabled: firstVehicleId !== null,
    staleTime: STALE_TIMES.SLOW,
  })

  if (!data || data.anomalies_last_24h === 0) return null

  const top: AnomalyEntry | undefined = data.anomalies[0]
  if (!top) return null

  const summary = `${data.anomalies_last_24h} in 24h · ${top.signal} ${formatRelative(top.detected_at)}`

  return (
    <HealthRow
      status={SEVERITY_TO_STATUS[top.severity]}
      icon={<Activity className="h-4 w-4" />}
      label="Anomalies"
      summary={summary}
      to="/anomaly-detection"
    />
  )
}
