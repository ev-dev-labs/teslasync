using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;

namespace TeslaSync.App.Components.UI;

/// <summary>Edge a <see cref="TsDrawer"/> slides in from.</summary>
public enum DrawerSide
{
    Left,
    Right,
}

/// <summary>
/// Tokenized slide-in drawer / side sheet (mirrors the web <c>Drawer</c>). Hosts
/// <see cref="DrawerContent"/> in a light-dismiss <see cref="Popup"/> anchored to
/// the left or right edge and sized to the window height. Toggle with
/// <see cref="IsOpen"/>.
/// </summary>
public partial class TsDrawer : ContentControl
{
    private readonly Popup _popup = new() { IsLightDismissEnabled = true };
    private readonly Border _pane = new();

    public static readonly DependencyProperty IsOpenProperty = DependencyProperty.Register(
        nameof(IsOpen), typeof(bool), typeof(TsDrawer),
        new PropertyMetadata(false, OnIsOpenChanged));

    public static readonly DependencyProperty SideProperty = DependencyProperty.Register(
        nameof(Side), typeof(DrawerSide), typeof(TsDrawer),
        new PropertyMetadata(DrawerSide.Right));

    public static readonly DependencyProperty PaneWidthProperty = DependencyProperty.Register(
        nameof(PaneWidth), typeof(double), typeof(TsDrawer),
        new PropertyMetadata(360.0));

    public static readonly DependencyProperty DrawerContentProperty = DependencyProperty.Register(
        nameof(DrawerContent), typeof(object), typeof(TsDrawer),
        new PropertyMetadata(null, OnDrawerContentChanged));

    public TsDrawer()
    {
        IsTabStop = false;
        _pane.Background = TypographyTokens.Brush("TsColorSurfaceBrush");
        _pane.BorderBrush = TypographyTokens.Brush("TsColorBorderBrush");
        _pane.BorderThickness = new Thickness(1, 0, 1, 0);
        _popup.Child = _pane;
        _popup.Closed += (s, e) =>
        {
            if (IsOpen)
            {
                IsOpen = false;
            }
        };
    }

    /// <summary>Whether the drawer is open.</summary>
    public bool IsOpen
    {
        get => (bool)GetValue(IsOpenProperty);
        set => SetValue(IsOpenProperty, value);
    }

    /// <summary>Edge the drawer is anchored to.</summary>
    public DrawerSide Side
    {
        get => (DrawerSide)GetValue(SideProperty);
        set => SetValue(SideProperty, value);
    }

    /// <summary>Width of the drawer pane.</summary>
    public double PaneWidth
    {
        get => (double)GetValue(PaneWidthProperty);
        set => SetValue(PaneWidthProperty, value);
    }

    /// <summary>Content hosted inside the drawer pane.</summary>
    public object? DrawerContent
    {
        get => GetValue(DrawerContentProperty);
        set => SetValue(DrawerContentProperty, value);
    }

    private static void OnIsOpenChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var drawer = (TsDrawer)d;
        if ((bool)e.NewValue)
        {
            drawer.OpenPopup();
        }
        else
        {
            drawer._popup.IsOpen = false;
        }
    }

    private static void OnDrawerContentChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var drawer = (TsDrawer)d;
        drawer._pane.Child = e.NewValue as UIElement;
    }

    private void OpenPopup()
    {
        if (XamlRoot is null)
        {
            return;
        }

        _popup.XamlRoot = XamlRoot;
        var size = XamlRoot.Size;
        _pane.Width = PaneWidth;
        _pane.Height = size.Height;
        _popup.VerticalOffset = 0;
        _popup.HorizontalOffset = Side == DrawerSide.Right ? size.Width - PaneWidth : 0;
        _popup.IsOpen = true;
    }
}
