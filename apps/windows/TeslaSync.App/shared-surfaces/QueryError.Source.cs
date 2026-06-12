using TeslaSync.App.Core.Lifecycle;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The connectivity seam the <c>QueryError</c> binds through (P1/S8) — the native analogue of the web
/// <c>useOnlineStatus()</c> hook the component consumes (web/src/hooks/useOnlineStatus.ts, used at
/// web/src/components/feedback/QueryError.tsx L50). It exposes whether the device currently reports a connection
/// and raises <see cref="Changed"/> whenever that flips, so the network branch can swap between its offline and
/// unreachable forms and the reconnect auto-retry can fire — without the view reading connectivity itself. The
/// production binding is <see cref="NetworkQueryErrorConnectivitySource"/> over the P2-core
/// <see cref="INetworkAvailability"/> seam; <see cref="StaticQueryErrorConnectivitySource"/> stands in for
/// headless hosts and unit tests.
/// </summary>
public interface IQueryErrorConnectivitySource
{
    /// <summary>True while the device reports a usable connection (web <c>online</c>).</summary>
    bool IsOnline { get; }

    /// <summary>Raised whenever <see cref="IsOnline"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IQueryErrorConnectivitySource"/> with an explicit, caller-set value — the headless / unit-test
/// default. <see cref="Set"/> moves the value and raises <see cref="Changed"/> so the network branch can be
/// exercised in both its online (unreachable) and offline forms, and the reconnect auto-retry can be driven,
/// without a connectivity host.
/// </summary>
public sealed class StaticQueryErrorConnectivitySource : IQueryErrorConnectivitySource
{
    private bool _isOnline;

    /// <summary>Creates a source over an initial connectivity value.</summary>
    /// <param name="isOnline">Whether the device starts online (defaults to true, the web initial assumption).</param>
    public StaticQueryErrorConnectivitySource(bool isOnline = true) => _isOnline = isOnline;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool IsOnline => _isOnline;

    /// <summary>Move the value and raise <see cref="Changed"/> (the device going online/offline).</summary>
    /// <param name="isOnline">The new connectivity value.</param>
    public void Set(bool isOnline)
    {
        if (_isOnline == isOnline)
        {
            return;
        }

        _isOnline = isOnline;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="IQueryErrorConnectivitySource"/> — adapts the P2-core
/// <see cref="INetworkAvailability"/> lifecycle seam (the WinUI host's <c>Windows.Networking.Connectivity</c>
/// bridge) into the surface's connectivity value, the native analogue of the web resilience status broadcaster
/// behind <c>useOnlineStatus()</c> (web/src/hooks/useOnlineStatus.ts, web/src/lib/resilience.ts). It subscribes
/// once to <see cref="INetworkAvailability.AvailabilityChanged"/> and re-publishes it as <see cref="Changed"/>;
/// the value is read live from <see cref="INetworkAvailability.IsOnline"/>. WinUI-free so it is unit-tested
/// against a controllable fake availability.
/// </summary>
public sealed class NetworkQueryErrorConnectivitySource : IQueryErrorConnectivitySource, IDisposable
{
    private readonly INetworkAvailability _availability;
    private bool _disposed;

    /// <summary>Creates the source over the network-availability seam.</summary>
    /// <param name="availability">The P2-core connectivity seam (web online/offline broadcaster).</param>
    public NetworkQueryErrorConnectivitySource(INetworkAvailability availability)
    {
        ArgumentNullException.ThrowIfNull(availability);
        _availability = availability;
        _availability.AvailabilityChanged += OnAvailabilityChanged;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool IsOnline => _availability.IsOnline;

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

/// <summary>
/// The navigation seam the <c>QueryError</c> CTAs invoke (P1/S8) — the native analogue of the web
/// <c>useNavigate()</c> hook and the login redirect (web/src/components/feedback/QueryError.tsx L49, L102, L126).
/// The 404 "Back to list" CTA calls <see cref="NavigateToList"/> with the resource's list route (web
/// <c>navigate(listHref)</c>); the 401/403 "Sign in" CTA calls <see cref="NavigateToSignIn"/> (web
/// <c>window.location.href = '/login'</c>). The production binding is <see cref="DelegateQueryErrorNavigator"/>
/// over the shell's navigation; <see cref="RecordingQueryErrorNavigator"/> stands in for headless hosts and unit
/// tests. The view never navigates itself.
/// </summary>
public interface IQueryErrorNavigator
{
    /// <summary>Navigate to a resource's list view (web 404 <c>navigate(listHref)</c>).</summary>
    /// <param name="route">The list route (web <c>listHref</c>).</param>
    void NavigateToList(string route);

    /// <summary>Send the user to the login route (web 401/403 <c>window.location.href = '/login'</c>).</summary>
    void NavigateToSignIn();
}

/// <summary>
/// The production <see cref="IQueryErrorNavigator"/> — forwards each CTA to a shell-supplied delegate (the
/// functional-options binding the composition root wires to the navigation frame and the login redirect). Keeps
/// the seam WinUI-free so it is unit-tested without a navigation host.
/// </summary>
public sealed class DelegateQueryErrorNavigator : IQueryErrorNavigator
{
    private readonly Action<string> _navigateToList;
    private readonly Action _navigateToSignIn;

    /// <summary>Creates the navigator over the shell's navigation delegates.</summary>
    /// <param name="navigateToList">Invoked with the list route (web <c>navigate(listHref)</c>).</param>
    /// <param name="navigateToSignIn">Invoked to send the user to the login route (web login redirect).</param>
    public DelegateQueryErrorNavigator(Action<string> navigateToList, Action navigateToSignIn)
    {
        ArgumentNullException.ThrowIfNull(navigateToList);
        ArgumentNullException.ThrowIfNull(navigateToSignIn);
        _navigateToList = navigateToList;
        _navigateToSignIn = navigateToSignIn;
    }

    /// <inheritdoc />
    public void NavigateToList(string route)
    {
        ArgumentException.ThrowIfNullOrEmpty(route);
        _navigateToList(route);
    }

    /// <inheritdoc />
    public void NavigateToSignIn() => _navigateToSignIn();
}

/// <summary>
/// An <see cref="IQueryErrorNavigator"/> that records each request instead of navigating — the headless /
/// unit-test default. It lets the view-model's CTA dispatch be asserted (which route a "Back to list" targeted,
/// how many times "Sign in" was invoked) without a navigation host, and is the safe no-op default when the
/// designer / parameterless host has no navigation wired.
/// </summary>
public sealed class RecordingQueryErrorNavigator : IQueryErrorNavigator
{
    private readonly List<string> _listNavigations = [];

    /// <summary>The list routes "Back to list" navigated to, in order (web <c>navigate(listHref)</c> calls).</summary>
    public IReadOnlyList<string> ListNavigations => _listNavigations;

    /// <summary>The number of times "Sign in" was invoked (web login redirects).</summary>
    public int SignInCount { get; private set; }

    /// <inheritdoc />
    public void NavigateToList(string route)
    {
        ArgumentException.ThrowIfNullOrEmpty(route);
        _listNavigations.Add(route);
    }

    /// <inheritdoc />
    public void NavigateToSignIn() => SignInCount++;
}
