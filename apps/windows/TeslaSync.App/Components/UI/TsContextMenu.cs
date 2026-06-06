using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized right-click context menu wrapper (mirrors the web
/// <c>ContextMenu</c>). Hosts a consumer target (the control's <c>Content</c>)
/// and attaches a <see cref="Menu"/> as its WinUI <see cref="ContextFlyout"/>,
/// so right-click and the keyboard Menu key both open it with full Narrator
/// support.
/// </summary>
public partial class TsContextMenu : ContentControl
{
    public static readonly DependencyProperty MenuProperty = DependencyProperty.Register(
        nameof(Menu), typeof(MenuFlyout), typeof(TsContextMenu),
        new PropertyMetadata(null, OnMenuChanged));

    public TsContextMenu()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
    }

    /// <summary>The menu shown on right-click / Menu key.</summary>
    public MenuFlyout? Menu
    {
        get => (MenuFlyout?)GetValue(MenuProperty);
        set => SetValue(MenuProperty, value);
    }

    private static void OnMenuChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var control = (TsContextMenu)d;
        control.ContextFlyout = control.Menu;
    }
}
