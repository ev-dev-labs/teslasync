using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;

namespace TeslaSync.App;

/// <summary>
/// Top-level application window hosting an empty NavigationView shell.
/// The root surface uses a Mica backdrop per the design-token material mapping
/// (TsMaterialRootBackdrop); navigation items and routed pages are wired up in
/// later W-series prompts.
/// </summary>
public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        SystemBackdrop = new MicaBackdrop();
    }
}
