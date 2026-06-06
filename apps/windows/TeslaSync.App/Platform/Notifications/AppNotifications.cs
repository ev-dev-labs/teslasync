using Microsoft.UI.Dispatching;
using Microsoft.Windows.AppNotifications;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Push;
using TeslaSync.App.Live;
using TeslaSync.App.Platform;
using TeslaSync.App.Push;
using TeslaSync.App.Shell;
using WinRT.Interop;

namespace TeslaSync.App.Notifications;

/// <summary>
/// Composition root for the Windows notification-polish surfaces (P2/W8-0001), mirroring
/// <see cref="AppPush"/>. It builds the foreground <see cref="NotificationDispatcher"/> (the rich
/// successor to the W6 router) over the real Windows surfaces — the App SDK toast service, the in-app
/// banner, the Focus Assist provider and the persisted settings store — and wires the toast-activation
/// handler, the taskbar service (fed by a job tracker) and the jump-list service. The dispatcher is
/// exposed as an <see cref="IForegroundPushRouter"/> so the W6 <c>PushSessionController</c> routes
/// foreground pushes through it; when this graph cannot initialize (no package identity) callers fall
/// back to the basic W6 router, so notifications degrade gracefully rather than breaking.
///
/// <para>Startup is best-effort and idempotent: an unpackaged dev run leaves the app fully usable with
/// the richer surfaces simply inactive.</para>
/// </summary>
public static class AppNotifications
{
    private static readonly object Gate = new();
    private static readonly LocalSettingsNotificationSettingsStore SettingsStore = new();

    private static NotificationDispatcher? _dispatcher;
    private static ToastActivationHandler? _activation;
    private static TaskbarService? _taskbar;
    private static TaskbarJobTracker? _tracker;
    private static JumpListService? _jumpList;
    private static WindowForegroundLifecycle? _foreground;
    private static NotificationInbox? _inbox;
    private static ShellWindow? _shell;
    private static NotificationSettings _settings = NotificationSettings.Default;
    private static bool _started;

    /// <summary>The foreground notification router, once started — used as the W6 push router.</summary>
    public static IForegroundPushRouter? Router
    {
        get
        {
            lock (Gate)
            {
                return _dispatcher;
            }
        }
    }

    /// <summary>The live foreground notifications inbox, once started.</summary>
    public static INotificationInbox? Inbox
    {
        get
        {
            lock (Gate)
            {
                return _inbox;
            }
        }
    }

    /// <summary>The taskbar job tracker that real features report long-running work to, once started.</summary>
    public static TaskbarJobTracker? Jobs
    {
        get
        {
            lock (Gate)
            {
                return _tracker;
            }
        }
    }

    /// <summary>The current notification settings (the persisted preferences, or defaults).</summary>
    public static NotificationSettings Settings
    {
        get
        {
            lock (Gate)
            {
                return _settings;
            }
        }
    }

    /// <summary>
    /// Builds the notification graph against the shell <paramref name="window"/>, its UI
    /// <paramref name="dispatcher"/> and the in-app <paramref name="banner"/>, and starts the toast
    /// activator. Idempotent and best-effort.
    /// </summary>
    public static void Start(ShellWindow window, DispatcherQueue dispatcher, TsAlertBanner banner)
    {
        ArgumentNullException.ThrowIfNull(window);
        ArgumentNullException.ThrowIfNull(dispatcher);
        ArgumentNullException.ThrowIfNull(banner);

        lock (Gate)
        {
            if (_started)
            {
                return;
            }

            _started = true;
            try
            {
                BuildAndStart(window, dispatcher, banner);
            }
            catch (Exception)
            {
                // Best-effort: a missing package identity or unsupported host must not crash launch.
            }
        }
    }

    /// <summary>Routes a cold-launch toast activation into the shell (called from app activation handling).</summary>
    public static void HandleActivation(AppNotificationActivatedEventArgs args)
    {
        ToastActivationHandler? handler;
        lock (Gate)
        {
            handler = _activation;
        }

        handler?.HandleActivation(args);
    }

    /// <summary>Persists and applies updated notification <paramref name="settings"/> (settings-page integration).</summary>
    public static async Task UpdateSettingsAsync(NotificationSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        lock (Gate)
        {
            _settings = settings;
        }

        await SettingsStore.SaveAsync(settings).ConfigureAwait(false);
    }

    /// <summary>Rebuilds the Windows jump list from the current routes. Best-effort.</summary>
    public static Task RefreshJumpListAsync()
    {
        JumpListService? jumpList;
        lock (Gate)
        {
            jumpList = _jumpList;
        }

        return jumpList?.UpdateAsync() ?? Task.CompletedTask;
    }

    /// <summary>Tears down the notification graph and unregisters the toast activator.</summary>
    public static void Stop()
    {
        lock (Gate)
        {
            _activation?.Dispose();
            _foreground?.Dispose();
            _dispatcher = null;
            _activation = null;
            _taskbar = null;
            _tracker = null;
            _jumpList = null;
            _foreground = null;
            _inbox = null;
            _shell = null;
            _started = false;
        }
    }

    private static void BuildAndStart(ShellWindow window, DispatcherQueue dispatcher, TsAlertBanner banner)
    {
        var registry = new RouteRegistry();
        var diagnostics = new NotificationDiagnostics();
        var localizer = ShellLocalizer.Instance;

        var inbox = new NotificationInbox();
        var bannerSink = new PushBannerPresenter(dispatcher, banner);
        var toast = new AppNotificationToastService();
        var composer = new NotificationComposer(registry, localizer, () => CurrentSettings().RedactSensitiveContent);
        var foreground = new WindowForegroundLifecycle(window);
        var focusAssist = new WindowsFocusAssistProvider();

        var dispatcherImpl = new NotificationDispatcher(
            inbox,
            bannerSink,
            toast,
            composer,
            foreground,
            focusAssist,
            CurrentSettings,
            diagnostics);

        var activation = new ToastActivationHandler(registry, dispatcher, Navigate, diagnostics);
        activation.Start();

        var tracker = new TaskbarJobTracker();
        var taskbar = new TaskbarService(WindowNative.GetWindowHandle(window), dispatcher, diagnostics);
        tracker.Changed += OnTaskbarStatusChanged;

        var jumpList = new JumpListService(registry, localizer, diagnostics);

        _shell = window;
        _inbox = inbox;
        _dispatcher = dispatcherImpl;
        _activation = activation;
        _tracker = tracker;
        _taskbar = taskbar;
        _jumpList = jumpList;
        _foreground = foreground;

        RunDetached(LoadSettingsAsync());
        RunDetached(jumpList.UpdateAsync());
        taskbar.Apply(TaskbarStatus.Idle);
    }

    private static void OnTaskbarStatusChanged(object? sender, TaskbarStatus status)
    {
        TaskbarService? taskbar;
        lock (Gate)
        {
            taskbar = _taskbar;
        }

        taskbar?.Apply(status);
    }

    private static void Navigate(ToastActivation activation)
    {
        ShellWindow? shell;
        lock (Gate)
        {
            shell = _shell;
        }

        shell?.ActivateFromUri(DeepLink.BuildUri(activation.RoutePath));
    }

    private static async Task LoadSettingsAsync()
    {
        var loaded = await SettingsStore.LoadAsync().ConfigureAwait(false);
        lock (Gate)
        {
            _settings = loaded;
        }
    }

    private static NotificationSettings CurrentSettings()
    {
        lock (Gate)
        {
            return _settings;
        }
    }

    private static void RunDetached(Task task) =>
        _ = task.ContinueWith(
            static t => _ = t.Exception,
            CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
}
