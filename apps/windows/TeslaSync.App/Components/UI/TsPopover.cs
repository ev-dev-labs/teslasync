using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized popover (mirrors the web <c>Popover</c>). Wraps a consumer trigger
/// (the control's <c>Content</c>) and shows <see cref="PopoverContent"/> in a
/// light-dismiss WinUI <see cref="Flyout"/> when the trigger is invoked. The
/// flyout provides focus management and Escape-to-dismiss for free.
/// </summary>
public partial class TsPopover : ContentControl
{
    private readonly Flyout _flyout = new();

    public static readonly DependencyProperty PopoverContentProperty = DependencyProperty.Register(
        nameof(PopoverContent), typeof(object), typeof(TsPopover),
        new PropertyMetadata(null, OnPopoverContentChanged));

    public TsPopover()
    {
        IsTabStop = false;
        FlyoutBase.SetAttachedFlyout(this, _flyout);
        Tapped += (s, e) => FlyoutBase.ShowAttachedFlyout(this);
    }

    /// <summary>Content displayed inside the popover surface.</summary>
    public object? PopoverContent
    {
        get => GetValue(PopoverContentProperty);
        set => SetValue(PopoverContentProperty, value);
    }

    /// <summary>Opens the popover programmatically.</summary>
    public void Show() => FlyoutBase.ShowAttachedFlyout(this);

    /// <summary>Closes the popover programmatically.</summary>
    public void Hide() => _flyout.Hide();

    private static void OnPopoverContentChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var popover = (TsPopover)d;
        popover._flyout.Content = e.NewValue as UIElement;
    }
}
