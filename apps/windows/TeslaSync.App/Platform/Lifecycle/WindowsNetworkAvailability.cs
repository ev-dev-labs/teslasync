using TeslaSync.App.Core.Lifecycle;
using Windows.Networking.Connectivity;

namespace TeslaSync.App.Platform.Lifecycle;

/// <summary>
/// The WinUI network-availability adapter for the <see cref="LifecycleCoordinator"/> (P2/W8-0002). It
/// projects <see cref="NetworkInformation"/>'s connectivity onto the headless
/// <see cref="INetworkAvailability"/> contract so the coordinator can surface offline state and treat
/// live data as stale on a drop, then re-validate on restore — without the core taking a WinRT
/// dependency. Connectivity is read defensively: an identity-less/host-less context reports online so
/// the app never wedges itself offline.
/// </summary>
public sealed class WindowsNetworkAvailability : INetworkAvailability, IDisposable
{
    private readonly object _gate = new();
    private bool _isOnline;
    private bool _disposed;

    /// <summary>Creates the adapter and begins observing system connectivity changes.</summary>
    public WindowsNetworkAvailability()
    {
        _isOnline = QueryOnline();
        NetworkInformation.NetworkStatusChanged += OnNetworkStatusChanged;
    }

    /// <inheritdoc />
    public event Action<bool>? AvailabilityChanged;

    /// <inheritdoc />
    public bool IsOnline
    {
        get
        {
            lock (_gate)
            {
                return _isOnline;
            }
        }
    }

    private void OnNetworkStatusChanged(object sender)
    {
        var online = QueryOnline();
        bool changed;
        lock (_gate)
        {
            changed = _isOnline != online;
            _isOnline = online;
        }

        if (changed)
        {
            AvailabilityChanged?.Invoke(online);
        }
    }

    private static bool QueryOnline()
    {
        try
        {
            var profile = NetworkInformation.GetInternetConnectionProfile();
            return profile?.GetNetworkConnectivityLevel() == NetworkConnectivityLevel.InternetAccess;
        }
        catch (Exception)
        {
            // If connectivity can't be read, assume online so the app stays usable.
            return true;
        }
    }

    /// <summary>Detaches the system connectivity handler.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        NetworkInformation.NetworkStatusChanged -= OnNetworkStatusChanged;
    }
}
