import { useSettings } from '@/hooks/useSettings'
import { AI_FEATURES, type AiFeatureId } from '@/ai/features'

/**
 * Phase-50 / F0 — AI-Off Contract (ADR-015).
 *
 * Returns `true` iff the current Settings indicate the requested
 * feature is enabled end-to-end:
 *
 *  1. {@link AI_FEATURES} contains an entry for `feature` (catches
 *     typos at runtime in addition to the {@link AiFeatureId} compile
 *     check).
 *  2. `settings.ai_mode` is something other than `'off'`. Off mode
 *     blocks every AI surface unconditionally (ADR-015 §I1).
 *  3. `settings.ai_features[feature]` is exactly `true`. Per-feature
 *     opt-in is required even when the global mode is on (ADR-015 §I7
 *     — no AI feature defaults to enabled).
 *
 * Any other state — including a settings query that has not yet
 * resolved, an undefined `ai_features` map, a missing key, or `false`
 * — yields `false`. The fail-closed posture mirrors the backend
 * `guard.Wrap` 404 (ADR-015 §I6) so backend and frontend reach the
 * same verdict for the same inputs.
 *
 * Components that render AI UI MUST gate on this hook (typically via
 * the {@link withAiFeature} HOC which wraps it). The
 * `teslasync/ai-component-must-be-wrapped` ESLint rule and the
 * `tools/aivet` static check enforce that no AI component or AI
 * route bypasses this gate.
 */
export function useAiEnabled(feature: AiFeatureId): boolean {
  const { settings } = useSettings()
  if (!AI_FEATURES[feature]) return false
  if (!settings) return false
  if (settings.ai_mode === undefined || settings.ai_mode === 'off') return false
  const flags = settings.ai_features
  if (!flags) return false
  return flags[feature] === true
}
