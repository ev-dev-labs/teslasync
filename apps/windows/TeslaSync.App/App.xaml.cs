using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using TeslaSync.App.Auth;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Notifications;
using TeslaSync.App.Settings;
using TeslaSync.App.Shell;
using Windows.ApplicationModel.Activation;

namespace TeslaSync.App;

/// <summary>
/// Application object. Creates the single top-level <see cref="ShellWindow"/> on launch,
/// kicks off the silent session restore (P2/W4-0001), and routes any protocol activation:
/// OAuth callbacks (<c>teslasync://oauth/...</c>) complete the in-flight sign-in, while
/// navigation deep links (<c>teslasync://app/...</c> / universal links) land on a route.
/// </summary>
public partial class App : Application
{
    private ShellWindow? _window;

    public App()
    {
        InitializeComponent();
    }

    /// <summary>The single top-level window, exposed so features (e.g. file pickers) can resolve its handle.</summary>
    public static Window? MainWindow { get; private set; }

    protected override void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        // P2 data-wiring: compose the REST data layer once and hand it to the shell so it can
        // register data-backed page factories (live pages replace the empty-source defaults).
        var data = ShellDataContext.Create();
        _window = new ShellWindow(data);
        MainWindow = _window;
        _window.Activate();

        // Pre-populate the vehicle-scope cache so vehicle-scoped pages resolve without first
        // visiting Vehicles (non-blocking).
        _ = data.WarmAsync();

        // Rehydrate any persisted session from the Credential Locker (non-blocking).
        _ = AppAuth.InitializeAsync();

        // Load non-secret preferences (theme/density/units/startup) from LocalSettings (non-blocking).
        _ = AppSettingsHost.InitializeAsync();

        HandleActivation(AppInstance.GetCurrent().GetActivatedEventArgs());
    }

    /// <summary>
    /// Handles a protocol activation redirected to this already-running instance (the
    /// single-instance OAuth callback path wired up in <see cref="Program"/>).
    /// </summary>
    internal void OnRedirectedActivation(AppActivationArguments args)
    {
        var window = _window;
        window?.DispatcherQueue.TryEnqueue(() => HandleActivation(args));
    }

    private void HandleActivation(AppActivationArguments? args)
    {
        if (args is null)
        {
            return;
        }

        try
        {
            switch (args.Kind)
            {
                case ExtendedActivationKind.Protocol when args.Data is IProtocolActivatedEventArgs protocol:
                    // OAuth callbacks are consumed by the awaiting sign-in; never route them as deep links.
                    if (!AppAuth.TryHandleActivation(protocol.Uri))
                    {
                        _window?.ActivateFromUri(protocol.Uri);
                    }

                    break;

                case ExtendedActivationKind.AppNotification
                    when args.Data is Microsoft.Windows.AppNotifications.AppNotificationActivatedEventArgs notification:
                    // P2/W8-0001: a toast (or one of its buttons) routes through the notification activator.
                    AppNotifications.HandleActivation(notification);
                    break;

                case ExtendedActivationKind.Launch when args.Data is ILaunchActivatedEventArgs launch:
                    // P2/W8-0001: a jump-list task launches the app with a teslasync:// deep-link argument.
                    ActivateFromArgumentString(launch.Arguments);
                    break;

                case ExtendedActivationKind.File when args.Data is IFileActivatedEventArgs file && file.Files.Count > 0:
                    // P2/W8-0002: opening a .teslasync file (windows.fileTypeAssociation) lands on
                    // Backup & Restore, where the bundle is imported.
                    ActivateFromArgumentString($"{DeepLink.Scheme}://{DeepLink.Authority}/backup");
                    break;

                default:
                    break;
            }
        }
        catch (Exception)
        {
            // Activation is best-effort; a missing/identity-less host must not crash launch.
        }
    }

    private void ActivateFromArgumentString(string? arguments)
    {
        if (!string.IsNullOrWhiteSpace(arguments)
            && Uri.TryCreate(arguments, UriKind.Absolute, out var uri)
            && string.Equals(uri.Scheme, DeepLink.Scheme, StringComparison.OrdinalIgnoreCase))
        {
            _window?.ActivateFromUri(uri);
        }
    }
}
