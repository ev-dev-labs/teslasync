using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// A labelled vertical time marker for overlaying an event on a cartesian chart
/// (mirrors the web chart time-marker). Renders a tokenized rule with a caption chip
/// at the top; the host sizes its height and positions it on the chart's overlay
/// canvas at the event's X pixel. Colour follows an optional semantic
/// <see cref="Role"/>.
/// </summary>
public partial class TsChartTimeMarker : ContentControl
{
    private readonly Border _chip;
    private readonly Caption _caption = new();
    private readonly Rectangle _rule;

    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(TsChartTimeMarker),
        new PropertyMetadata(string.Empty, OnChanged));

    public static readonly DependencyProperty RoleProperty = DependencyProperty.Register(
        nameof(Role), typeof(ChartRole), typeof(TsChartTimeMarker),
        new PropertyMetadata(ChartRole.None, OnChanged));

    public TsChartTimeMarker()
    {
        IsTabStop = false;

        _chip = new Border
        {
            Background = ChartBrushes.Surface,
            BorderBrush = ChartBrushes.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(6, 2, 6, 2),
            Child = _caption,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        _rule = new Rectangle
        {
            Width = 1,
            Fill = ChartBrushes.Border,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Stretch,
        };

        var root = new Grid();
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_chip, 0);
        Grid.SetRow(_rule, 1);
        root.Children.Add(_chip);
        root.Children.Add(_rule);
        Content = root;

        Apply();
    }

    /// <summary>The marker caption (e.g. an event time or name).</summary>
    public string Label
    {
        get => (string)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    /// <summary>Optional semantic colour for the rule and chip border.</summary>
    public ChartRole Role
    {
        get => (ChartRole)GetValue(RoleProperty);
        set => SetValue(RoleProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsChartTimeMarker)d).Apply();

    private void Apply()
    {
        _caption.Value = Label;
        if (Role != ChartRole.None)
        {
            var brush = ChartBrushes.Resolve(ChartPalette.KeyForRole(Role));
            _rule.Fill = brush;
            _chip.BorderBrush = brush;
        }
        else
        {
            _rule.Fill = ChartBrushes.Border;
            _chip.BorderBrush = ChartBrushes.Border;
        }

        AutomationProperties.SetName(this, string.IsNullOrEmpty(Label) ? "Time marker" : $"Time marker {Label}");
    }
}
