namespace TeslaSync.App.Core.Live;

/// <summary>
/// The foreground/background lifecycle seam the <see cref="SseClient"/> uses to pause and resume a
/// live subscription. While the app is backgrounded the client suspends its connection (and
/// reports <see cref="LiveConnection.Paused"/>) rather than holding a socket open and burning
/// battery; it reconnects when the app returns to the foreground.
///
/// <para>The WinUI app implements this over the window's activation/visibility events; tests use a
/// controllable fake. The default <see cref="AlwaysForeground"/> implementation never pauses, which
/// is the correct behaviour for a headless/host-less context.</para>
/// </summary>
public interface IForegroundLifecycle
{
    /// <summary>True while the app is in the foreground and the stream should run.</summary>
    bool IsForeground { get; }

    /// <summary>Raised when the foreground state changes; the argument is the new <see cref="IsForeground"/>.</summary>
    event Action<bool>? ForegroundChanged;
}

/// <summary>An <see cref="IForegroundLifecycle"/> that is always foreground and never pauses.</summary>
public sealed class AlwaysForeground : IForegroundLifecycle
{
    /// <summary>The shared singleton instance.</summary>
    public static AlwaysForeground Instance { get; } = new();

    private AlwaysForeground()
    {
    }

    /// <inheritdoc />
    public bool IsForeground => true;

    /// <inheritdoc />
    public event Action<bool>? ForegroundChanged
    {
        add
        {
            // Never raised — the lifecycle is permanently foreground.
        }

        remove
        {
            // Never raised — nothing to detach.
        }
    }
}
