using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AIThinkingIndicator"/> view — the native port of
/// the web component body (web/src/components/ai/AIThinkingIndicator.tsx). The web component is stateless apart
/// from the resolved label and the (CSS-evaluated) motion preference; this holder mirrors that exactly: it
/// resolves the leading label once through the i18n facade (or carries the caller's override) and tracks
/// <see cref="Animate"/> from the <see cref="IMotionPreferenceSource"/>, raising <see cref="PropertyChanged"/>
/// when the user toggles reduce-motion at runtime so the view can start/stop its dot-bounce and line-shimmer
/// storyboards. The view binds the projected <see cref="Label"/> / <see cref="Animate"/> and performs no I/O of
/// its own. <see cref="Dispose"/> unsubscribes from the motion source (the web media-query listener cleanup).
/// </summary>
public sealed class AIThinkingIndicatorViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly string? _customLabel;
    private readonly IDisposable _motionSubscription;
    private AIThinkingProjection _projection;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over the i18n facade, an optional already-translated label override (web
    /// <c>label</c> prop) and the reduce-motion source (P1/S8 seam).
    /// </summary>
    /// <param name="localizer">The i18n facade the default label resolves through.</param>
    /// <param name="customLabel">An optional already-translated override label, or null for the default.</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public AIThinkingIndicatorViewModel(ILocalizer localizer, string? customLabel, IMotionPreferenceSource motion)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(motion);

        _localizer = localizer;
        _customLabel = customLabel;
        _projection = AIThinkingProjection.Project(localizer, customLabel, motion.ReduceMotion);
        _motionSubscription = motion.Observe(OnReduceMotionChanged);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>AIThinkingIndicator</c>).</summary>
    public static string Slug => AIThinkingIndicatorRegistration.Slug;

    /// <summary>The current render projection (resolved label + motion flag + live semantics).</summary>
    public AIThinkingProjection Projection => _projection;

    /// <summary>The resolved leading label / accessible status name.</summary>
    public string Label => _projection.Label;

    /// <summary>Whether the indicator currently animates (false under reduced motion).</summary>
    public bool Animate => _projection.Animate;

    /// <summary>Stop listening to the motion source (the web effect cleanup); idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _motionSubscription.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnReduceMotionChanged(bool reduceMotion)
    {
        var next = AIThinkingProjection.Project(_localizer, _customLabel, reduceMotion);
        if (next == _projection)
        {
            return;
        }

        var animateChanged = next.Animate != _projection.Animate;
        var labelChanged = !string.Equals(next.Label, _projection.Label, StringComparison.Ordinal);
        _projection = next;

        Raise(nameof(Projection));
        if (animateChanged)
        {
            Raise(nameof(Animate));
        }

        if (labelChanged)
        {
            Raise(nameof(Label));
        }
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
