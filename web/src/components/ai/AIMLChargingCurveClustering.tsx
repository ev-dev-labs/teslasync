// ML charging-curve fingerprint clustering model. Wires the "Train charging-curve clusters"
// button to POST /api/v1/ai/ml/charging-curves/cluster. The
// narration walks the user through the per-cluster (L1 overnight /
// L2 workplace / DC fast / unknown) LEARNED charging envelope
// (mean peak power plus stddev / p5 / p95 per cluster, mean avg
// power / total energy / duration / ramp shape) returned by
// train_charge_curve_clusters AND the deterministic rule-label
// fallback per cluster (when fewer than
// mlchargingcurves.DefaultMinSessionsPerCluster=3 sessions exist
// in the lookback window), then summarises the
// currently-effective baseline via query_charge_curve_clusters.
//
// The AI never persists state — it is read-only narration over
// the learned envelope; the canonical Charging Curve page at
// /charging/curves with the existing rule-based session labels
// (web/src/features/charging/components/charging-curve/helpers.ts)
// is unchanged (ADR-015 §I3 + §I8 propose-only contract).
//
// Sibling distinction: this is the ML3-tier *statistical
// clustering* model. The C3-tier *charging-curve-fingerprint-
// clustering* feature is a separate LLM narrator over the C3
// aggregator's output; both surfaces coexist on /charging/curves
// with independent per-feature toggles and independent test IDs.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

// This feature streams its narration purely through useAiStream's
// built-in delta-text accumulator (surfaced by AiOutputPanel), so it
// has no per-event work to do. A module-level no-op keeps the onEvent
// callback identity stable across renders instead of allocating a
// fresh closure in the render path (which would re-run useAiStream's
// onEvent-ref effect on every render).
const noop = (): void => {}

// Default learning window: the last 90 days. Charging sessions
// are O(0.1–1/day) per vehicle (the prompt's
// DefaultMinSessionsPerCluster=3 acknowledges this), so a 90-day
// window is what the trainer needs to cover representative
// L1/L2/DC behaviour. The Go trainer clamps the upper bound at
// mlchargingcurves.MaxLookbackDays=365, so wider values are
// silently capped server-side. Mirrors the SPA Charging Curve
// page's default lookback for parity with the baseline charts.
const DEFAULT_LOOKBACK_DAYS = 90

interface InnerSectionProps {
  /**
   * Active vehicle id from the parent Charging Curve page. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent (or not a positive integer) we still render the
   * section — the gate has already passed — but keep the Train button
   * disabled because the backend cluster handler rejects any
   * `vehicle_id <= 0` with HTTP 400 (see
   * internal/api/aimlchargcv/handler.go `parseClusterRequest`).
   */
  vehicleId?: number
}

function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  // Mirror the handler-side parser (vehicle_id must be a positive
  // integer). A missing, non-finite (NaN), zero, or negative id keeps
  // the Train button disabled so the SPA never fires a request the
  // backend would immediately 400. The weaker `vehicleId != null`
  // guard this replaced wrongly enabled 0 / -5 / NaN and POSTed a
  // doomed vehicle_id=0. Keeping the disabled state computed (rather
  // than a literal) also keeps the double-submit wiring test honest.
  const numericVehicleId =
    typeof vehicleId === 'number' && Number.isFinite(vehicleId) ? vehicleId : 0
  const canStart = numericVehicleId > 0
  const body = useMemo(
    () => ({ vehicle_id: numericVehicleId, lookback_days: DEFAULT_LOOKBACK_DAYS }),
    [numericVehicleId],
  )
  const stream = useAiStream({
    url: '/ai/ml/charging-curves/cluster',
    body,
    onEvent: noop,
    // AI-01: vehicle scope is part of stream identity — switching the
    // active vehicle aborts any in-flight clustering run and clears
    // the previous vehicle's clusters before the new scope streams in.
    scopeKey: canStart ? numericVehicleId : null,
  })
  return (
    <AIFeatureCard
      title={t(
        'charging.aiMlClustering.title',
        'Learn per-vehicle charging-curve clusters',
      )}
      description={t(
        'charging.aiMlClustering.description',
        'Compute per-cluster (L1 overnight / L2 workplace / DC fast) learned charging envelope from this vehicle’s recent sessions and walk through how each cluster compares to the deterministic rule-label baseline used by the Charging Curve page today.',
      )}
      buttonLabel={t(
        'charging.aiMlClustering.generateButton',
        'Train charging-curve clusters',
      )}
      badgeLabel={t('charging.aiMlClustering.badge', 'Helix')}
      emptyHint={
        canStart
          ? undefined
          : t(
              'charging.aiMlClustering.noVehicleHint',
              'Pick a vehicle to train its charging-curve clusters.',
            )
      }
      canStart={canStart}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIMLChargingCurveClusteringInner'

export const AIMLChargingCurveClustering = withAiFeature(
  'ml-charging-curve-clustering',
  InnerSection,
)
AIMLChargingCurveClustering.displayName = 'AIMLChargingCurveClustering'
