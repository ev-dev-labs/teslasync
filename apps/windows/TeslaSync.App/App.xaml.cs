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

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }
}
