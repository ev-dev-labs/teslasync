using Microsoft.UI.Xaml;

namespace TeslaSync.App;

/// <summary>
/// Application entry point. Creates the single top-level window on launch.
/// The real navigation shell and pages are introduced in later W-series prompts.
/// </summary>
public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
    }

    /// <summary>The single top-level window, exposed so features (e.g. file pickers) can resolve its handle.</summary>
    public static Window? MainWindow { get; private set; }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        MainWindow = _window;
        _window.Activate();
    }
}
