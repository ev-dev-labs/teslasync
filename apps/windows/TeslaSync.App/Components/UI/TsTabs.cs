using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized tab strip (mirrors the web <c>Tabs</c>). Wraps the WinUI
/// <see cref="TabView"/> with the add-button hidden by default so it reads as a
/// content tab navigator rather than a document host. Full keyboard and
/// Narrator tab semantics are inherited.
/// </summary>
public partial class TsTabs : TabView
{
    public TsTabs()
    {
        IsAddTabButtonVisible = false;
        CanReorderTabs = false;
        TabWidthMode = TabViewWidthMode.SizeToContent;
        Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
    }
}
