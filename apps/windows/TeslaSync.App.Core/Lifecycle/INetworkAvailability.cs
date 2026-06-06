namespace TeslaSync.App.Core.Lifecycle;

/// <summary>
/// The network-availability seam the <see cref="LifecycleCoordinator"/> observes (P2/W8-0002). The
/// WinUI host implements it over <c>Windows.Networking.Connectivity.NetworkInformation</c>; tests use a
/// controllable fake. A loss of connectivity lets the app surface an offline banner and treat live
/// data as stale, while a restore lets it resume — without the coordinator taking a WinRT dependency.
///
/// <para>The default <see cref="AlwaysOnline"/> implementation never reports a change, which is the
/// correct behaviour for a headless/host-less context.</para>
/// </summary>
public interface INetworkAvailability
{
    /// <summary>True while the device has a usable internet connection.</summary>
    bool IsOnline { get; }

    /// <summary>Raised when connectivity changes; the argument is the new <see cref="IsOnline"/>.</summary>
    event Action<bool>? AvailabilityChanged;
}

/// <summary>An <see cref="INetworkAvailability"/> that is always online and never raises a change.</summary>
public sealed class AlwaysOnline : INetworkAvailability
{
    /// <summary>The shared singleton instance.</summary>
    public static AlwaysOnline Instance { get; } = new();

    private AlwaysOnline()
    {
    }

    /// <inheritdoc />
    public bool IsOnline => true;

    /// <inheritdoc />
    public event Action<bool>? AvailabilityChanged
    {
        add
        {
            // Never raised — connectivity is permanently assumed online.
        }

        remove
        {
            // Never raised — nothing to detach.
        }
    }
}
