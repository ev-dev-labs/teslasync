// ML2 Range-prediction model.
// Wires the "Train range model" button to
// POST /api/v1/ai/ml/range/train. The narration walks the user
// through the per-bucket (temp_bucket × speed_bucket) learned
// Wh/km envelope returned by train_range_model (and the
// deterministic linear-fallback for any bucket with too few
// drives), then summarises the currently-effective heuristic
// baseline via query_range_prediction. The AI never persists state
// it is read-only narration over the learned envelope; the
// canonical Projected Range page at /projected-range
// (RangeProjectionHandler at GET /api/v1/vehicles/{id}/range/projection)
// is unchanged (ADR-015 §I3 + §I8 propose-only contract).

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

/**
 * canPredictRange is the single predicate that gates BOTH the "Train
 * range model" button's enabled state and the vehicle_id the training
 * request carries.
 *
 * The backend handler (internal/api/aimlrange/handler.go) rejects the
 * request with a 400 ("vehicle_id is required and must be > 0") for any
 * id <= 0, and the body's `?? 0` sentinel means 0 stands for "no
 * vehicle in scope". A guard of `vehicleId != null` alone would leave
 * the button enabled for that 0 sentinel (and for negatives / NaN),
 * letting a click fire a request the server is guaranteed to reject.
 * Mirroring the handler-side `vehicle_id > 0` contract keeps the button
 * disabled until the parent has resolved a real active vehicle — the
 * same posture the sibling AIBatteryHealthForecastNarrative takes.
 *
 * Exported for direct unit testing; the request wiring lives in
 * {@link InnerSection}.
 */
export function canPredictRange(vehicleId: number | undefined): boolean {
  return vehicleId != null && Number.isFinite(vehicleId) && vehicleId > 0
}

interface InnerSectionProps {
  /**
   * vehicleId surfaced by the parent ProjectedRangePage. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent (or a non-positive placeholder) we still render
   * the section (the gate has already passed) but the Train button
   * stays disabled because the backend requires vehicle_id > 0.
   */
  vehicleId?: number
}

/**
 * Stable no-op stream event handler. The range-model narrative is
 * accumulated by useAiStream's built-in `text` field, so this feature
 * needs no per-event handling. A module-level reference keeps
 * useAiStream's onEvent effect from re-subscribing on every render (a
 * fresh inline `() => {}` would).
 */
const noop = (): void => {}

function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  // Both the button's enabled state and the request body derive from
  // this single predicate, so a training request can never fire against
  // a non-vehicle (vehicle_id <= 0) — see canPredictRange.
  const canStart = canPredictRange(vehicleId)
  // Default learning window: the last 14 days. Wide enough to
  // capture a representative weekly cadence (commuting + weekend
  // long drives), narrow enough that a recent owner-behaviour
  // change (new commute, summer→winter) is reflected in the
  // learned per-bucket Wh/km within a couple of weeks. The trainer
  // clamps the upper bound at mlrange.MaxDays=30, so wider values
  // are silently capped server-side.
  const body = useMemo(
    () => ({ vehicle_id: canStart ? (vehicleId ?? 0) : 0, days: 14 }),
    [canStart, vehicleId],
  )
  const stream = useAiStream({
    url: '/ai/ml/range/train',
    body,
    onEvent: noop,
  })
  // Computed disabled — never literal-true. The explicit boolean expression
  // also keeps the on-mode wiring test honest: a regression that
  // pins the button as always-disabled would silently falsify the
  // double-submit guard test.
  return (
    <AIFeatureCard
      title={t('range.aiPredict.title', 'Learn per-vehicle range model')}
      description={t(
                'range.aiPredict.description',
                'Compute per-bucket (temperature × speed) learned Wh/km from this vehicle’s recent drives and walk through how each bucket compares to the static heuristic curve the projection uses today.',
              )}
      buttonLabel={t('range.aiPredict.generateButton', 'Train range model')}
      badgeLabel={t('range.aiPredict.badge', 'Helix')}
      canStart={canStart}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIRangePredictionInner'

export const AIRangePrediction = withAiFeature(
  'range-prediction-model',
  InnerSection,
)
AIRangePrediction.displayName = 'AIRangePrediction'
