using TeslaSync.App.Core.Lifecycle;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One immutable online/offline snapshot — the native analogue of the boolean the web
/// <c>useOnlineStatus()</c> hook returns (web/src/hooks/useOnlineStatus.ts), which the web
/// <c>OfflineBanner</c> reads to decide whether to render (web/src/components/feedback/OfflineBanner.tsx L24-26).
/// Exposed by the P1/S8 <see cref="IOnlineStatusSource"/> and consumed by
/// <see cref="OfflineBannerProjection.Project"/>. Only the offline snapshot renders the banner. Pure data — no
/// WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="IsOnline">True while the device reports a usable connection (web <c>online</c>).</param>
public sealed record OnlineStatusSnapshot(bool IsOnline)
{
    /// <summary>The online snapshot — the banner is hidden (web <c>online === true</c> returns null).</summary>
    public static OnlineStatusSnapshot Online { get; } = new(true);

    /// <summary>The offline snapshot — the banner is shown (web <c>online === false</c>).</summary>
    public static OnlineStatusSnapshot Offline { get; } = new(false);

    /// <summary>True while offline (web <c>!online</c>): the banner's render gate.</summary>
    public bool IsOffline => !IsOnline;
}

/// <summary>
/// The online-status seam the <c>OfflineBanner</c> binds through (P1/S8) — the native analogue of the web
/// <c>useOnlineStatus()</c> subscription (web/src/hooks/useOnlineStatus.ts, backed by the shared
/// <c>lib/resilience</c> connection broadcaster). It exposes the current <see cref="OnlineStatusSnapshot"/> and
/// raises <see cref="Changed"/> whenever the device moves online/offline. The view never reads connectivity
/// itself — it binds to this seam. The production binding is <see cref="NetworkOnlineStatusSource"/> over the
/// P2-core <see cref="INetworkAvailability"/> seam; <see cref="StaticOnlineStatusSource"/> stands in for headless
/// hosts and unit tests.
/// </summary>
public interface IOnlineStatusSource
{
    /// <summary>The current online/offline snapshot (web <c>useOnlineStatus()</c> value).</summary>
    OnlineStatusSnapshot Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IOnlineStatusSource"/> with an explicit, caller-set snapshot — the headless / unit-test default.
/// <see cref="Set"/> moves the snapshot and raises <see cref="Changed"/> so the banner projection and view-model
/// can be exercised in both the online (hidden) and offline (shown) states without a connectivity host.
/// </summary>
public sealed class StaticOnlineStatusSource : IOnlineStatusSource
{
    private OnlineStatusSnapshot _current;

    /// <summary>Creates a source over an initial online/offline snapshot.</summary>
    /// <param name="current">The initial snapshot.</param>
    public StaticOnlineStatusSource(OnlineStatusSnapshot current)
    {
        ArgumentNullException.ThrowIfNull(current);
        _current = current;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public OnlineStatusSnapshot Current => _current;

    /// <summary>Move the snapshot and raise <see cref="Changed"/> (the device going online/offline).</summary>
    /// <param name="snapshot">The new snapshot.</param>
    public void Set(OnlineStatusSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        _current = snapshot;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="IOnlineStatusSource"/> — adapts the P2-core <see cref="INetworkAvailability"/>
/// lifecycle seam (the WinUI host's <c>Windows.Networking.Connectivity</c> bridge) into the banner's online
/// snapshot, the native analogue of the web <c>window 'online'/'offline'</c> listeners that back
/// <c>useOnlineStatus()</c> (web/src/hooks/useOnlineStatus.ts, web/src/lib/resilience.ts). It subscribes once to
/// <see cref="INetworkAvailability.AvailabilityChanged"/> and re-publishes it as <see cref="Changed"/>; the
/// snapshot is derived live from <see cref="INetworkAvailability.IsOnline"/>. WinUI-free so it is unit-tested
/// against a controllable fake availability.
/// </summary>
public sealed class NetworkOnlineStatusSource : IOnlineStatusSource, IDisposable
{
    private readonly INetworkAvailability _availability;
    private bool _disposed;

    /// <summary>Creates the source over the network-availability seam.</summary>
    /// <param name="availability">The P2-core connectivity seam (web online/offline listeners).</param>
    public NetworkOnlineStatusSource(INetworkAvailability availability)
    {
        ArgumentNullException.ThrowIfNull(availability);
        _availability = availability;
        _availability.AvailabilityChanged += OnAvailabilityChanged;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public OnlineStatusSnapshot Current =>
        _availability.IsOnline ? OnlineStatusSnapshot.Online : OnlineStatusSnapshot.Offline;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _availability.AvailabilityChanged -= OnAvailabilityChanged;
        GC.SuppressFinalize(this);
    }

    private void OnAvailabilityChanged(bool online) => Changed?.Invoke(this, EventArgs.Empty);
}
