using Microsoft.UI.Dispatching;
using Microsoft.Windows.AppNotifications;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.Notifications;

/// <summary>
/// Routes toast activations into shell navigation (P2/W8-0001). It registers with the Windows App SDK
/// <see cref="AppNotificationManager"/> so a tap on a toast (or one of its buttons) — whether the app is
/// running or cold-launched from a closed state — decodes back through the core
/// <see cref="ToastActivationRouter"/> to a validated route, and is then handed to the shell on the UI
/// thread. An explicit dismiss is acknowledged without navigating. Registration and teardown are
/// best-effort so an unpackaged host never crashes.
/// </summary>
public sealed class ToastActivationHandler : IDisposable
{
    private readonly RouteRegistry _registry;
    private readonly DispatcherQueue _dispatcher;
    private readonly Action<ToastActivation> _navigate;
    private readonly NotificationDiagnostics _diagnostics;
    private bool _registered;
    private bool _disposed;

    /// <summary>Creates the handler over the route registry, the UI dispatcher, a navigation callback and diagnostics.</summary>
    public ToastActivationHandler(
        RouteRegistry registry,
        DispatcherQueue dispatcher,
        Action<ToastActivation> navigate,
        NotificationDiagnostics diagnostics)
    {
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(dispatcher);
        ArgumentNullException.ThrowIfNull(navigate);
        ArgumentNullException.ThrowIfNull(diagnostics);

        _registry = registry;
        _dispatcher = dispatcher;
        _navigate = navigate;
        _diagnostics = diagnostics;
    }

    /// <summary>Subscribes to toast activations and registers the app's notification activator. Idempotent.</summary>
    public void Start()
    {
        if (_registered)
        {
            return;
        }

        AppNotificationManager.Default.NotificationInvoked += OnNotificationInvoked;
        AppNotificationManager.Default.Register();
        _registered = true;
    }

    /// <summary>Routes a cold-launch toast activation (delivered through the app's activation arguments).</summary>
    public void HandleActivation(AppNotificationActivatedEventArgs args)
    {
        ArgumentNullException.ThrowIfNull(args);
        Route(args.Arguments);
    }

    /// <summary>Unsubscribes and unregisters the activator; safe to call more than once.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (!_registered)
        {
            return;
        }

        try
        {
            AppNotificationManager.Default.NotificationInvoked -= OnNotificationInvoked;
            AppNotificationManager.Default.Unregister();
        }
        catch (Exception)
        {
            // Teardown is best-effort; an unregistered/identity-less host is a no-op.
        }

        _registered = false;
    }

    private void OnNotificationInvoked(AppNotificationManager sender, AppNotificationActivatedEventArgs args) =>
        Route(args.Arguments);

    private void Route(IEnumerable<KeyValuePair<string, string>>? arguments)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        if (arguments is not null)
        {
            foreach (var pair in arguments)
            {
                map[pair.Key] = pair.Value;
            }
        }

        var activation = ToastActivationRouter.Resolve(ToastArguments.Encode(map), _registry);
        _diagnostics.RecordActivation(activation.Kind);

        if (!activation.ShouldNavigate)
        {
            return;
        }

        if (_dispatcher.HasThreadAccess)
        {
            _navigate(activation);
        }
        else
        {
            _dispatcher.TryEnqueue(() => _navigate(activation));
        }
    }
}
