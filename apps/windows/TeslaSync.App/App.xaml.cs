using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using TeslaSync.App.Shell;

namespace TeslaSync.App;

/// <summary>
/// Application entry point. Creates the single top-level <see cref="ShellWindow"/> on
/// launch and forwards any protocol (deep-link) activation to it so
/// <c>teslasync://</c> / universal links land on the right route.
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

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new ShellWindow();
        MainWindow = _window;
        _window.Activate();

        TryHandleProtocolActivation(_window);
    }

    private static void TryHandleProtocolActivation(ShellWindow window)
    {
        try
        {
            var activation = AppInstance.GetCurrent().GetActivatedEventArgs();
            if (activation?.Kind == ExtendedActivationKind.Protocol
                && activation.Data is Windows.ApplicationModel.Activation.IProtocolActivatedEventArgs protocol)
            {
                window.ActivateFromUri(protocol.Uri);
            }
        }
        catch (Exception)
        {
            // Activation is best-effort; a missing/identity-less host must not crash launch.
        }
    }
}
