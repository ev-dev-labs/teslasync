// Learned per-vehicle anomaly baselines.
// Wires the "Train baseline" button to
// POST /api/v1/ai/ml/anomaly-baselines/train. The narration walks
// the user through the per-signal learned envelope returned by
// train_anomaly_baseline (and the deterministic safe-range
// fallback for any signal with too few samples), then summarises
// the current effective baseline via query_anomaly_baseline. The
// AI never persists state — it is read-only narration over the
// learned envelope; mutations go through the existing baseline
// detector at GET /api/v1/analytics/anomalies, unchanged
// (ADR-015 §I3 + §I8 propose-only contract).

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

// Stable module-scope no-op event sink. This narrator only renders the
// accumulated delta.text that useAiStream already exposes as
// stream.text, so it has no per-event work to do. Hoisting the handler
// out of the component keeps its identity stable across renders, so
// useAiStream's onEvent-tracking effect does not re-subscribe on every
// render (matches the AICostForecastNarration convention).
const NOOP_EVENT = () => {}

interface InnerSectionProps {
  vehicleId?: number
}

function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  // Default learning window: the last 14 days. Wide enough to
  // capture a representative weekly cadence (commuting + weekend
  // long drives), narrow enough that a recent owner-behaviour
  // change (new commute, summer→winter) is reflected in the
  // learned mean/stddev within a couple of weeks. The trainer
  // clamps the upper bound at anomaly.MaxDays=30, so wider values
  // are silently capped server-side.
  const body = useMemo(
    () => ({ vehicle_id: vehicleId ?? 0, days: 14 }),
    [vehicleId],
  )
  const stream = useAiStream({
    url: '/ai/ml/anomaly-baselines/train',
    body,
    onEvent: NOOP_EVENT,
    // AI-01: vehicle scope is part of stream identity — switching the
    // active vehicle aborts any in-flight training run and clears the
    // previous vehicle's baseline narrative before the new scope
    // streams in.
    scopeKey: vehicleId ?? null,
  })

  // canStart is a COMPUTED guard (never a literal true) so the on-mode
  // tests catch a regression that pins the button as always enabled. It
  // also mirrors the backend contract — vehicle_id must be > 0 (see
  // internal/api/aimlanom/handler.go) — so a 0 / negative / unresolved
  // id keeps the Train button disabled instead of firing a request the
  // handler would reject with HTTP 400.
  const canStart = vehicleId != null && vehicleId > 0

  return (
    <AIFeatureCard
      title={t('anomaly.aiBaseline.title', 'Learn per-vehicle baseline')}
      description={t(
        'anomaly.aiBaseline.description',
        'Compute statistical anomaly bounds (mean, stddev, p5/p95) from this vehicle’s recent signal history and walk through how each signal compares to the static safe-range fallback.',
      )}
      buttonLabel={t('anomaly.aiBaseline.generateButton', 'Train baseline')}
      badgeLabel={t('anomaly.aiBaseline.badge', 'Helix')}
      canStart={canStart}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AILearnedAnomalyBaselinesInner'

export const AILearnedAnomalyBaselines = withAiFeature(
  'learned-per-vehicle-anomaly-baselines',
  InnerSection,
)
AILearnedAnomalyBaselines.displayName = 'AILearnedAnomalyBaselines'
