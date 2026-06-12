namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The coarse-pointer seam the SwipeRow binds through (P1/S8 state-holder layer) — the native analogue of the web
/// <c>useIsCoarsePointer()</c> hook (web/src/components/mobile/SwipeRow.tsx L38, L111), which reads the
/// <c>(pointer: coarse)</c> media query so the swipe gesture is enabled on touch devices and skipped on a mouse.
/// The web component reads it declaratively; the WinUI view has to source the OS primary-pointer capability and
/// react if it changes (e.g. a 2-in-1 device docking a keyboard), so that responsibility is expressed as this
/// small seam. The production implementation (probing the WinUI pointer device capabilities) lives with the
/// view; <see cref="StaticCoarsePointerSource"/> stands in for headless hosts and unit tests so the projection /
/// view-model can be exercised without a pointer device.
/// </summary>
public interface ICoarsePointerSource
{
    /// <summary>
    /// True when the primary pointer is coarse (touch), so the swipe gesture is wired up by default (web
    /// <c>useIsCoarsePointer()</c> / the <c>(pointer: coarse)</c> media query).
    /// </summary>
    bool IsCoarsePointer { get; }

    /// <summary>
    /// Subscribe to runtime changes of the coarse-pointer flag. The callback receives the new value. Dispose the
    /// returned handle to unsubscribe (the web media-query listener cleanup).
    /// </summary>
    /// <param name="onChanged">Invoked with the new coarse-pointer value when it changes.</param>
    IDisposable Observe(Action<bool> onChanged);
}

/// <summary>
/// An <see cref="ICoarsePointerSource"/> with a fixed value and no runtime changes — the headless / unit-test
/// default. It lets the projection and view-model be verified for both the touch (active) and mouse (passthrough)
/// branches without a pointer-device host. <see cref="Observe"/> returns an already-inert handle because the value
/// never changes.
/// </summary>
public sealed class StaticCoarsePointerSource : ICoarsePointerSource
{
    /// <summary>Creates a source that always reports <paramref name="isCoarsePointer"/>.</summary>
    /// <param name="isCoarsePointer">The fixed coarse-pointer value.</param>
    public StaticCoarsePointerSource(bool isCoarsePointer) => IsCoarsePointer = isCoarsePointer;

    /// <summary>A shared source that reports a coarse (touch) pointer — the common "gesture active" test default.</summary>
    public static StaticCoarsePointerSource Coarse { get; } = new(isCoarsePointer: true);

    /// <summary>A shared source that reports a fine (mouse) pointer — the "render children straight through" test default.</summary>
    public static StaticCoarsePointerSource Fine { get; } = new(isCoarsePointer: false);

    /// <inheritdoc />
    public bool IsCoarsePointer { get; }

    /// <inheritdoc />
    public IDisposable Observe(Action<bool> onChanged)
    {
        ArgumentNullException.ThrowIfNull(onChanged);
        return InertSubscription.Instance;
    }

    private sealed class InertSubscription : IDisposable
    {
        public static InertSubscription Instance { get; } = new();

        private InertSubscription()
        {
        }

        public void Dispose()
        {
            // The value never changes, so nothing was subscribed.
        }
    }
}

/// <summary>
/// The haptic seam the SwipeRow fires through when the reveal threshold is first crossed — the native analogue of
/// the web <c>navigator.vibrate(10)</c> / <c>safeVibrate</c> best-effort blip (web/src/components/mobile/SwipeRow.tsx
/// L89-L101, L199-L202). Like the web helper — which is a silent no-op on browsers without the Vibration API —
/// the default native implementation (<see cref="NoopSwipeHaptic"/>) is inert, because a Windows desktop has no
/// vibration motor; a host on a haptics-capable device can supply its own implementation, and
/// <see cref="DelegateSwipeHaptic"/> lets a host / test observe the pulses.
/// </summary>
public interface ISwipeHaptic
{
    /// <summary>Fire a short haptic blip of <paramref name="milliseconds"/> ms (web <c>navigator.vibrate(ms)</c>).</summary>
    /// <param name="milliseconds">The blip length in milliseconds.</param>
    void Pulse(int milliseconds);
}

/// <summary>
/// The inert haptic — every pulse is dropped. The default on a Windows desktop (no vibration motor), mirroring the
/// web <c>safeVibrate</c> no-op on browsers without the Vibration API.
/// </summary>
public sealed class NoopSwipeHaptic : ISwipeHaptic
{
    /// <summary>The shared singleton instance.</summary>
    public static NoopSwipeHaptic Instance { get; } = new();

    private NoopSwipeHaptic()
    {
    }

    /// <inheritdoc />
    public void Pulse(int milliseconds)
    {
        // No vibration motor on desktop — best-effort no-op, exactly as the web safeVibrate is on unsupported hosts.
    }
}

/// <summary>
/// A delegate-backed <see cref="ISwipeHaptic"/> — the implementation a haptics-capable host (or a test) builds
/// from its own pulse routine. A <see langword="null"/> delegate degrades to a no-op so a partially-wired host
/// never throws.
/// </summary>
public sealed class DelegateSwipeHaptic : ISwipeHaptic
{
    private readonly Action<int>? _pulse;

    /// <summary>Creates the haptic from its pulse delegate; a null delegate is inert.</summary>
    /// <param name="pulse">The routine that fires a blip of the given millisecond length.</param>
    public DelegateSwipeHaptic(Action<int>? pulse) => _pulse = pulse;

    /// <inheritdoc />
    public void Pulse(int milliseconds) => _pulse?.Invoke(milliseconds);
}
