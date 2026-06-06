using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using TeslaSync.App.Auth;
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
        _window = new ShellWindow();
        MainWindow = _window;
        _window.Activate();

        // Rehydrate any persisted session from the Credential Locker (non-blocking).
        _ = AppAuth.InitializeAsync();

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
        try
        {
            if (args?.Kind == ExtendedActivationKind.Protocol
                && args.Data is IProtocolActivatedEventArgs protocol)
            {
                // OAuth callbacks are consumed by the awaiting sign-in; never route them as deep links.
                if (AppAuth.TryHandleActivation(protocol.Uri))
                {
                    return;
                }

                _window?.ActivateFromUri(protocol.Uri);
            }
        }
        catch (Exception)
        {
            // Activation is best-effort; a missing/identity-less host must not crash launch.
        }
    }
}
