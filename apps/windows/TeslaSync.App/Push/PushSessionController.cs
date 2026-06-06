using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Push;

namespace TeslaSync.App.Push;

/// <summary>
/// The foreground composition glue for Windows push (P2/W6-0002), mirroring the W6
/// <c>LiveSessionController</c>. It ties the auth session to device registration and pumps foreground
/// push payloads into the router:
/// <list type="bullet">
///   <item>On sign-in it renews/registers the WNS channel; on sign-out it unregisters and clears it
///         (channel refresh after auth/user changes and cleanup on sign-out — ADR-009).</item>
///   <item>It forwards each raw foreground payload from the <see cref="IForegroundPushReceiver"/> to
///         the <see cref="IForegroundPushRouter"/> (decoded with <see cref="PushPayloadParser"/>),
///         with no background stream held open.</item>
/// </list>
/// Registration runs off the UI thread; failures are swallowed (the service records them) so a push
/// hiccup never destabilises the shell.
/// </summary>
public sealed class PushSessionController : IDisposable
{
    private readonly IPushRegistrationService _service;
    private readonly IForegroundPushRouter _router;
    private readonly IForegroundPushReceiver _receiver;
    private readonly AuthService _auth;
    private readonly object _gate = new();
    private bool _started;
    private bool _authenticated;
    private bool _disposed;

    /// <summary>Creates the controller over the registration service, router, receiver and auth core.</summary>
    public PushSessionController(
        IPushRegistrationService service,
        IForegroundPushRouter router,
        IForegroundPushReceiver receiver,
        AuthService auth)
    {
        ArgumentNullException.ThrowIfNull(service);
        ArgumentNullException.ThrowIfNull(router);
        ArgumentNullException.ThrowIfNull(receiver);
        ArgumentNullException.ThrowIfNull(auth);
        _service = service;
        _router = router;
        _receiver = receiver;
        _auth = auth;
    }

    /// <summary>Subscribes to auth + push events and registers immediately when already signed in.</summary>
    public void Start()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        lock (_gate)
        {
            if (_started)
            {
                return;
            }

            _started = true;
            _authenticated = _auth.State.IsAuthenticated;
        }

        _receiver.PayloadReceived += OnPayloadReceived;
        _auth.StateChanged += OnAuthStateChanged;

        if (_authenticated)
        {
            RunDetached(_service.OnAuthChangedAsync(true));
        }
    }

    /// <summary>Unsubscribes from auth + push events; safe to call when already stopped.</summary>
    public void Stop()
    {
        lock (_gate)
        {
            if (!_started)
            {
                return;
            }

            _started = false;
        }

        _receiver.PayloadReceived -= OnPayloadReceived;
        _auth.StateChanged -= OnAuthStateChanged;
    }

    /// <summary>Stops the controller.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Stop();
    }

    private void OnAuthStateChanged(object? sender, AuthState state)
    {
        // Act only on a genuine authenticated⇄unauthenticated transition so an ordinary token
        // refresh (SignedIn → Refreshing → SignedIn) does not churn the registration.
        bool nowAuthenticated = state.IsAuthenticated;
        bool changed;
        lock (_gate)
        {
            changed = nowAuthenticated != _authenticated;
            _authenticated = nowAuthenticated;
        }

        if (!changed)
        {
            return;
        }

        RunDetached(_service.OnAuthChangedAsync(nowAuthenticated));
    }

    private void OnPayloadReceived(object? sender, string raw)
    {
        RunDetached(_router.RouteAsync(PushPayloadParser.Parse(raw)));
    }

    private static void RunDetached(Task task) =>
        _ = task.ContinueWith(
            static t => _ = t.Exception,
            CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
}
