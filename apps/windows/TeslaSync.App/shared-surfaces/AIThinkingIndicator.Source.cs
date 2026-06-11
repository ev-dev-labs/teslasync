namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The reduced-motion preference seam the AIThinkingIndicator binds through (P1/S8 state-holder layer) — the
/// native analogue of the web <c>motion-safe:</c> Tailwind variant / the <c>prefers-reduced-motion</c> media
/// query the source relies on (web/src/components/ai/AIThinkingIndicator.tsx). The web component reads the
/// preference purely declaratively in CSS; the WinUI view has to source the OS "show animations" flag and react
/// when the user toggles it at runtime, so that responsibility is expressed as this small seam. The production
/// implementation (wrapping <c>TeslaSync.App.Components.Motion.MotionPreference</c>) lives with the WinUI view;
/// <see cref="StaticMotionPreferenceSource"/> stands in for headless hosts and unit tests so the projection /
/// view-model can be exercised without a XAML runtime.
/// </summary>
public interface IMotionPreferenceSource
{
    /// <summary>
    /// True when the user has asked the OS to minimise animations, so the indicator drops the bouncing dots and
    /// the line shimmer and shows the static skeleton (web <c>prefers-reduced-motion</c>).
    /// </summary>
    bool ReduceMotion { get; }

    /// <summary>
    /// Subscribe to runtime changes of the reduce-motion preference. The callback receives the new value.
    /// Dispose the returned handle to unsubscribe (the web media-query listener cleanup).
    /// </summary>
    IDisposable Observe(Action<bool> onChanged);
}

/// <summary>
/// An <see cref="IMotionPreferenceSource"/> with a fixed value and no runtime changes — the headless / unit-test
/// default. It lets the projection and view-model be verified for both the full-motion and reduced-motion
/// branches without a UISettings host. <see cref="Observe"/> returns an already-inert handle because the value
/// never changes.
/// </summary>
public sealed class StaticMotionPreferenceSource : IMotionPreferenceSource
{
    /// <summary>Creates a source that always reports <paramref name="reduceMotion"/>.</summary>
    public StaticMotionPreferenceSource(bool reduceMotion) => ReduceMotion = reduceMotion;

    /// <summary>A shared source that reports full motion (the common test default).</summary>
    public static StaticMotionPreferenceSource FullMotion { get; } = new(reduceMotion: false);

    /// <summary>A shared source that reports reduced motion.</summary>
    public static StaticMotionPreferenceSource Reduced { get; } = new(reduceMotion: true);

    /// <inheritdoc />
    public bool ReduceMotion { get; }

    /// <inheritdoc />
    public IDisposable Observe(Action<bool> onChanged)
    {
        ArgumentNullException.ThrowIfNull(onChanged);
        return NoOpSubscription.Instance;
    }

    private sealed class NoOpSubscription : IDisposable
    {
        public static NoOpSubscription Instance { get; } = new();

        private NoOpSubscription()
        {
        }

        public void Dispose()
        {
            // The value never changes, so nothing was subscribed.
        }
    }
}
