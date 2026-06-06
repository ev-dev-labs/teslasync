using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized primary navigation rail (mirrors the web <c>TabNav</c>). Wraps the
/// WinUI <see cref="NavigationView"/> with the back/settings chrome collapsed so
/// it behaves as the app section switcher. Adaptive pane behaviour, keyboard
/// access and Narrator landmarks are inherited.
/// </summary>
public partial class TsTabNav : NavigationView
{
    public TsTabNav()
    {
        IsBackButtonVisible = NavigationViewBackButtonVisible.Collapsed;
        IsSettingsVisible = false;
        PaneDisplayMode = NavigationViewPaneDisplayMode.Auto;
    }
}
