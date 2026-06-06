using Microsoft.UI.Xaml;
using TeslaSync.App.Core.Data.Cache;
using TeslaSync.App.Core.Lifecycle;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Settings;
using TeslaSync.App.Live;

namespace TeslaSync.App.Platform.Lifecycle;

/// <summary>
/// The WinUI composition root for app lifecycle (P2/W8-0002). It builds the headless
/// <see cref="LifecycleCoordinator"/> from the window's foreground seam
/// (<see cref="WindowForegroundLifecycle"/>) and the system network seam
/// (<see cref="WindowsNetworkAvailability"/>), registers the crash-safe
/// <see cref="SettingsPersistenceListener"/>, and installs the process-wide unhandled-exception
/// handlers that drive a final persist.
///
/// <para>This is an <b>MSIX</b>-packaged app: its identity, protocol activation and capabilities are
/// declared in <c>Package.appxmanifest</c>, and the launch / OAuth-callback / jump-list / toast
/// activations are routed in <see cref="App"/>. Single-instance keying lives in <see cref="Program"/>.
/// The coordinator deliberately shares its <see cref="IForegroundLifecycle"/> with the live SSE client
/// via <see cref="Foreground"/>, so a foreground transition pauses/resumes exactly one stream — there
/// is never a duplicate subscription, and a resumed-but-silent stream reads as stale via the existing
/// freshness window rather than being shown as live.</para>
/// </summary>
public sealed class WindowsLifecycleHost : IDisposable
{
    private readonly WindowForegroundLifecycle _foreground;
    private readonly WindowsNetworkAvailability _network;
    private readonly LifecycleCoordinator _coordinator;
    private readonly SettingsPersistenceListener _persistence;
    private bool _disposed;

    /// <summary>Composes the lifecycle graph for <paramref name="window"/> and installs crash handlers.</summary>
    public WindowsLifecycleHost(
        Window window,
        AppSettingsService settings,
        ICacheStore? cache = null,
        Action<LifecycleShutdownReason>? persistExtra = null)
    {
        ArgumentNullException.ThrowIfNull(window);
        ArgumentNullException.ThrowIfNull(settings);

        _foreground = new WindowForegroundLifecycle(window);
        _network = new WindowsNetworkAvailability();
        _coordinator = new LifecycleCoordinator(_foreground, _network);
        _persistence = new SettingsPersistenceListener(settings, cache, persistExtra);
        _coordinator.AddListener(_persistence);

        InstallCrashHandlers();
    }

    /// <summary>The lifecycle state machine — register additional <see cref="ILifecycleListener"/>s here.</summary>
    public LifecycleCoordinator Coordinator => _coordinator;

    /// <summary>
    /// The foreground seam to share with the live SSE client so pause/resume is driven once (no
    /// duplicate streams).
    /// </summary>
    public IForegroundLifecycle Foreground => _foreground;

    /// <summary>The current lifecycle phase.</summary>
    public AppLifecycleState State => _coordinator.State;

    /// <summary>Completes launch activation (<c>Launching</c> → <c>Running</c>).</summary>
    public void MarkLaunched() => _coordinator.MarkLaunched();

    private void InstallCrashHandlers()
    {
        AppDomain.CurrentDomain.UnhandledException += OnDomainUnhandledException;
        TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;

        if (Application.Current is { } app)
        {
            app.UnhandledException += OnXamlUnhandledException;
        }
    }

    private void RemoveCrashHandlers()
    {
        AppDomain.CurrentDomain.UnhandledException -= OnDomainUnhandledException;
        TaskScheduler.UnobservedTaskException -= OnUnobservedTaskException;

        if (Application.Current is { } app)
        {
            app.UnhandledException -= OnXamlUnhandledException;
        }
    }

    private void OnDomainUnhandledException(object sender, System.UnhandledExceptionEventArgs e) =>
        _coordinator.NotifyFatalError();

    private void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e) =>
        _coordinator.NotifyFatalError();

    private void OnXamlUnhandledException(object sender, Microsoft.UI.Xaml.UnhandledExceptionEventArgs e) =>
        _coordinator.NotifyFatalError();

    /// <summary>Detaches the crash handlers and disposes the window/network seams.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        RemoveCrashHandlers();
        _coordinator.RemoveListener(_persistence);
        _coordinator.Dispose();
        _foreground.Dispose();
        _network.Dispose();
    }
}
