using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="WithAiFeature"/> gate view — the native port of the
/// web <c>withAiFeature</c> HOC body (web/src/components/ai/withAiFeature.tsx). It mirrors the HOC exactly: an
/// unknown feature id throws at construction (the web HOC throws at the wrapping call, not at render, so a typo
/// is caught the first time the surface is built — web L37-L42); <see cref="IsGateOpen"/> evaluates the web
/// <c>useAiEnabled(feature)</c> verdict through the shared <see cref="IAiFeatureGate"/> (the P1/S8 seam), so a
/// closed gate collapses the whole surface (web <c>if (!enabled) return null</c>); and <see cref="WrapperName"/>
/// reproduces the web <c>displayName</c> (<c>withAiFeature(&lt;id&gt;, &lt;inner&gt;)</c>) so the wrapped surface
/// is identifiable in tooling, just as the web name shows in React DevTools. The view binds these projections
/// and never reads the gate directly. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class WithAiFeatureViewModel : INotifyPropertyChanged
{
    private readonly IAiFeatureGate _gate;
    private readonly string _featureId;
    private readonly string _innerName;

    /// <summary>
    /// Creates the holder over the AI feature gate (web <c>useAiEnabled</c> source), the wrapped feature id and
    /// the optional inner-component name used for <see cref="WrapperName"/>. Throws when the feature id is blank
    /// or is not in the canonical AI feature registry — the native analogue of <c>withAiFeature</c> rejecting an
    /// unknown id at module load.
    /// </summary>
    /// <param name="gate">The AI feature gate (web <c>useAiEnabled</c>); off collapses the whole surface.</param>
    /// <param name="featureId">The wrapped AI feature id (web <c>feature</c>).</param>
    /// <param name="innerName">The inner component's name (web <c>Inner.displayName ?? Inner.name ?? 'Component'</c>).</param>
    /// <exception cref="ArgumentNullException">The gate is null.</exception>
    /// <exception cref="ArgumentException">The feature id is blank or not in the canonical registry.</exception>
    public WithAiFeatureViewModel(IAiFeatureGate gate, string featureId, string? innerName = null)
    {
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentException.ThrowIfNullOrEmpty(featureId);
        if (!WithAiFeatureRegistration.IsRegisteredFeature(featureId))
        {
            throw new ArgumentException(WithAiFeatureRegistration.UnknownFeatureMessage(featureId), nameof(featureId));
        }

        _gate = gate;
        _featureId = featureId;

        // web: const innerName = Inner.displayName ?? Inner.name ?? 'Component'.
        _innerName = string.IsNullOrEmpty(innerName) ? "Component" : innerName;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The wrapped AI feature id (web <c>feature</c>).</summary>
    public string FeatureId => _featureId;

    /// <summary>
    /// True when the feature is enabled end-to-end (web <c>useAiEnabled(feature)</c>). When false the whole
    /// surface renders nothing — the native analogue of the HOC returning <see langword="null"/>. Re-evaluated
    /// on each read (and after <see cref="Refresh"/>) so a settings change flips the gate, mirroring the web
    /// hook re-running on every render.
    /// </summary>
    public bool IsGateOpen => AiEnabledEvaluator.IsEnabled(_gate, _featureId);

    /// <summary>
    /// The root marker automation id (<c>ai-feature-&lt;id&gt;-root</c>) the view applies when the gate is open
    /// — the native analogue of the web wrapper's <c>data-testid</c> / <c>data-ai-feature</c> markers.
    /// </summary>
    public string RootAutomationId => WithAiFeatureRegistration.RootAutomationId(_featureId);

    /// <summary>
    /// The wrapper's descriptive name — <c>withAiFeature(&lt;id&gt;, &lt;inner&gt;)</c> (web
    /// <c>Wrapped.displayName</c>), surfaced for tooling/diagnostics the way the web name shows in React DevTools.
    /// </summary>
    public string WrapperName => string.Concat("withAiFeature(", _featureId, ", ", _innerName, ")");

    /// <summary>
    /// Re-raise <see cref="IsGateOpen"/> so a host re-evaluates the gate and re-renders — the native analogue of
    /// the web hook re-running when the AI settings change (e.g. the user toggles the feature off). The gate is
    /// read live, so callers invoke this when the underlying settings snapshot changes.
    /// </summary>
    public void Refresh() =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsGateOpen)));
}
