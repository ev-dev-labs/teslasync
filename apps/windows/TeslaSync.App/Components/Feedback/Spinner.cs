using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;

namespace TeslaSync.App.Components.Feedback;

/// <summary>
/// Tokenized busy indicator (mirrors the web <c>Spinner</c>). Wraps a Fluent
/// <see cref="ProgressRing"/> sized to the shared <see cref="ControlSize"/> scale
/// with an optional caption. The accessible <see cref="Label"/> is published to
/// UI Automation as a polite live region so the busy state is announced.
/// </summary>
public partial class TsSpinner : ContentControl
{
    private readonly ProgressRing _ring = new() { IsActive = true };
    private readonly Caption _caption = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly StackPanel _root;

    public static readonly DependencyProperty SizeProperty = DependencyProperty.Register(
        nameof(Size), typeof(ControlSize), typeof(TsSpinner),
        new PropertyMetadata(ControlSize.Medium, OnVisualChanged));

    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(TsSpinner),
        new PropertyMetadata(string.Empty, OnVisualChanged));

    public TsSpinner()
    {
        IsTabStop = false;
        _root = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _root.Children.Add(_ring);
        _root.Children.Add(_caption);
        Content = _root;
        LiveRegion.Configure(_root);
        ApplyVisual();
    }

    /// <summary>Ring sizing scale.</summary>
    public ControlSize Size
    {
        get => (ControlSize)GetValue(SizeProperty);
        set => SetValue(SizeProperty, value);
    }

    /// <summary>Localized busy caption / accessible name.</summary>
    public string Label
    {
        get => (string)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    private static void OnVisualChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsSpinner)d).ApplyVisual();

    private void ApplyVisual()
    {
        var dimension = Size switch
        {
            ControlSize.Small => 18.0,
            ControlSize.Large => 36.0,
            _ => 24.0,
        };
        _ring.Width = dimension;
        _ring.Height = dimension;

        var hasLabel = !string.IsNullOrEmpty(Label);
        _caption.Value = Label;
        _caption.Visibility = hasLabel ? Visibility.Visible : Visibility.Collapsed;
        AutomationProperties.SetName(this, hasLabel ? Label : "Loading");
        LiveRegion.Announce(_root);
    }
}
