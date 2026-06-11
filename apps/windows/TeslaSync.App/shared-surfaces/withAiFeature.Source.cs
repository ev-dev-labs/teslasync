namespace TeslaSync.App.SharedSurfaces;

// The AI-feature visibility gate (IAiFeatureGate) and its predicate / AI-off implementations
// (DelegateAiFeatureGate, StaticAiFeatureGate) are defined once for all AI shared surfaces in
// AICabinTemperatureImpactNarrative.Source.cs (the canonical home); this surface reuses them rather than
// redeclaring them, mirroring how AIRAGHelp and AINLGrafanaPanel consume the shared gate.

/// <summary>
/// The native port of the web <c>useAiEnabled</c> hook (web/src/hooks/useAiEnabled.ts) — the data adapter the
/// withAiFeature gate consults before rendering. It folds the web hook's fail-closed checks into a single
/// predicate over the shared <see cref="IAiFeatureGate"/> (the P1/S8 state-holder seam that wraps the user's
/// AI settings):
/// <list type="number">
///   <item>the feature id is present in the canonical registry (web <c>if (!AI_FEATURES[feature]) return false</c>);</item>
///   <item>AI mode is not <c>off</c> and the per-feature opt-in flag is exactly <c>true</c> — both abstracted by
///     <see cref="IAiFeatureGate.IsEnabled"/>, whose production implementation reads the same
///     <c>ai_mode</c> + <c>ai_features[feature]</c> settings the web hook reads through <c>useSettings()</c>.</item>
/// </list>
/// Any other state — a null gate, a blank id, an unknown id, or a gate that reports an unresolved settings
/// snapshot as disabled — yields <see langword="false"/>, mirroring the web hook's fail-closed posture
/// (ADR-015 §I6) so the native and web gates reach the same verdict for the same inputs. Pure and WinUI-free
/// so it is unit-tested without a host.
/// </summary>
public static class AiEnabledEvaluator
{
    /// <summary>
    /// Evaluate whether <paramref name="featureId"/> is enabled end-to-end — the native analogue of
    /// <c>useAiEnabled(feature)</c>.
    /// </summary>
    /// <param name="gate">The AI feature gate (web <c>useSettings</c>-backed enablement source).</param>
    /// <param name="featureId">The AI feature id (web <c>AiFeatureId</c>).</param>
    /// <returns>True iff the feature is registered and the gate reports it enabled.</returns>
    public static bool IsEnabled(IAiFeatureGate gate, string featureId)
    {
        // web useAiEnabled fail-closed order: a missing source or a blank id can never enable a surface; then
        // registry membership; then the mode/flag verdict (the gate). Match it exactly.
        if (gate is null || string.IsNullOrEmpty(featureId))
        {
            return false;
        }

        if (!WithAiFeatureRegistration.IsRegisteredFeature(featureId))
        {
            return false;
        }

        return gate.IsEnabled(featureId);
    }
}
