using Microsoft.UI.Xaml;
using TeslaSync.App.Core.Data.Cache;
using TeslaSync.App.Core.Lifecycle;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Settings;

namespace TeslaSync.App.Platform.Lifecycle;

/// <summary>
/// Process-singleton host for the Windows app lifecycle (P2/W8-0002), mirroring <c>AppPush</c> and
/// <c>AppNotifications</c>: it owns the single <see cref="WindowsLifecycleHost"/> composition (the
/// foreground/network seams, the <see cref="LifecycleCoordinator"/>, the crash-safe persistence
/// listener and the process crash handlers) in a static field and exposes the small surface the shell
/// drives. Keeping the disposable graph in a static host — rather than an instance field on the
/// <c>Window</c> — matches the established app composition pattern.
/// </summary>
public static class AppLifecycle
{
    private static readonly object Gate = new();
    private static WindowsLifecycleHost? _host;

    /// <summary>The current lifecycle phase (Launching until <see cref="Start"/> has run).</summary>
    public static AppLifecycleState State => Host?.State ?? AppLifecycleState.Launching;

    /// <summary>
    /// The foreground seam to share with the live SSE client so foreground transitions pause/resume
    /// exactly one stream (no duplicate subscriptions). Null until <see cref="Start"/> has run.
    /// </summary>
    public static IForegroundLifecycle? Foreground => Host?.Foreground;

    /// <summary>
    /// Composes the lifecycle graph for <paramref name="window"/> and installs the process crash
    /// handlers. Idempotent — a second call while already started is a no-op.
    /// </summary>
    public static void Start(
        Window window,
        AppSettingsService settings,
        ICacheStore? cache = null,
        Action<LifecycleShutdownReason>? persistExtra = null)
    {
        ArgumentNullException.ThrowIfNull(window);
        ArgumentNullException.ThrowIfNull(settings);

        lock (Gate)
        {
            _host ??= new WindowsLifecycleHost(window, settings, cache, persistExtra);
        }
    }

    /// <summary>Completes launch activation (<c>Launching</c> → <c>Running</c>).</summary>
    public static void MarkLaunched() => Host?.MarkLaunched();

    /// <summary>Runs the crash-safe persist (flush settings + window state) on every listener.</summary>
    public static void RequestShutdownPersist(LifecycleShutdownReason reason = LifecycleShutdownReason.WindowClosing) =>
        Host?.Coordinator.RequestShutdownPersist(reason);

    /// <summary>Tears down the lifecycle graph (detaches crash handlers + window/network seams).</summary>
    public static void Stop()
    {
        WindowsLifecycleHost? host;
        lock (Gate)
        {
            host = _host;
            _host = null;
        }

        host?.Dispose();
    }

    private static WindowsLifecycleHost? Host
    {
        get
        {
            lock (Gate)
            {
                return _host;
            }
        }
    }
}
