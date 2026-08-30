// Smart-charge schedule suggestion.
// Draft button posts to /api/v1/ai/charging/schedule/draft.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  vehicleId?: string | number
  targetSoc?: number
  currentSoc?: number
  departBy?: string
  ratePlanId?: string
  maxAmps?: number
  batteryCapacityKwh?: number
  chargerVoltage?: number
  preferOffPeak?: boolean
}

// The stream renders its narrative purely through useAiStream's built-in
// delta-text accumulator (surfaced by AiOutputPanel), so it has no
// per-event work to do. A module-level no-op keeps the callback identity
// stable across renders instead of allocating a fresh closure in the
// render path.
const noop = (): void => {}

/**
 * normalizeVehicleId mirrors the backend contract in
 * internal/api/aismartcharge/handler.go (`parseDraftBody`), which
 * rejects any request whose `vehicle_id` is not a positive integer with
 * HTTP 400. Validating the same shape at the display boundary keeps the
 * Draft button from firing a request the handler would immediately
 * reject — the pre-hardening `!!vehicleId` guard wrongly enabled the
 * button for the truthy string ids "0", "-5", "42.5", and "abc", each of
 * which the handler 400s. Returns the canonical positive integer when
 * valid (leading zeros dropped, whitespace trimmed), or `null` (button
 * disabled) otherwise. Mirrors the sibling AIChargingDiagnosis's
 * normalizeSessionId.
 */
function normalizeVehicleId(vehicleId: string | number | undefined): number | null {
  if (vehicleId == null) return null
  if (typeof vehicleId === 'number') {
    return Number.isSafeInteger(vehicleId) && vehicleId > 0 ? vehicleId : null
  }
  const trimmed = vehicleId.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function InnerSection({
  vehicleId,
  targetSoc,
  currentSoc,
  departBy,
  ratePlanId,
  maxAmps,
  batteryCapacityKwh,
  chargerVoltage,
  preferOffPeak,
}: InnerSectionProps) {
  const { t } = useTranslation()
  const validVehicleId = useMemo(() => normalizeVehicleId(vehicleId), [vehicleId])
  const trimmedRatePlanId = (ratePlanId ?? '').trim()
  const body = useMemo(() => {
    // depart_by must be RFC3339; the SmartChargePage feeds a
    // datetime-local string which we normalize the same way the
    // deterministic Optimize call does. An empty or unparseable value
    // falls back to "now" so the handler's required-RFC3339 check never
    // trips on a blank field.
    const departIso = (() => {
      if (!departBy) return new Date().toISOString()
      const d = new Date(departBy)
      return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
    })()
    return {
      vehicle_id: validVehicleId ?? 0,
      target_soc: targetSoc ?? 80,
      depart_by: departIso,
      rate_plan_id: trimmedRatePlanId,
      max_amps: maxAmps ?? 32,
      battery_capacity_kwh: batteryCapacityKwh ?? 75,
      charger_voltage: chargerVoltage ?? 240,
      prefer_off_peak: preferOffPeak ?? true,
      current_soc: currentSoc ?? 20,
    }
  }, [
    validVehicleId,
    targetSoc,
    departBy,
    trimmedRatePlanId,
    maxAmps,
    batteryCapacityKwh,
    chargerVoltage,
    preferOffPeak,
    currentSoc,
  ])
  const stream = useAiStream({
    url: '/ai/charging/schedule/draft',
    body,
    onEvent: noop,
    // AI-01: vehicle + departure scope is part of stream identity —
    // changing either aborts an in-flight draft and clears the
    // previous scope's schedule proposal before the new scope
    // streams in.
    scopeKey: validVehicleId ? `${validVehicleId}:${body.depart_by}` : null,
  })
  // canStart mirrors the two hard preconditions the backend enforces
  // before it will accept a draft: a positive-integer vehicle_id and a
  // non-empty rate_plan_id. Everything else has a safe server-valid
  // default in `body`.
  const haveInputs = validVehicleId !== null && trimmedRatePlanId.length > 0
  return (
    <AIFeatureCard
      title={t('chargePlanner.aiAgent.title', 'Draft a schedule with Helix')}
      description={t(
        'chargePlanner.aiAgent.description',
        'Ask Helix to propose a time-of-use-optimized charge schedule grounded in your selected rate plan and target departure. The schedule is never saved automatically \u2014 review the proposed window and click Schedule below to apply it.',
      )}
      buttonLabel={t('chargePlanner.aiAgent.generateButton', 'Draft a schedule')}
      badgeLabel={t('chargePlanner.aiAgent.badge', 'Helix')}
      emptyHint={t(
        'chargePlanner.aiAgent.emptyHint',
        'Select a vehicle and a rate plan to draft a schedule.',
      )}
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AISmartChargeScheduleSuggestionInner'

export const AISmartChargeScheduleSuggestion = withAiFeature(
  'smart-charge-schedule-suggestion',
  InnerSection,
)
AISmartChargeScheduleSuggestion.displayName = 'AISmartChargeScheduleSuggestion'
