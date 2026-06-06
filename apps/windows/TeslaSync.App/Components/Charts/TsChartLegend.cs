using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using Windows.UI.Text;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// Interactive legend with hidden-series toggles (mirrors the web
/// <c>ChartLegend</c> + useChartLegendState). Each entry is a keyboard-operable
/// toggle that hides / shows its series via the shared <see cref="ChartLegendState"/>;
/// hidden entries dim and strike through. Raises <see cref="SeriesToggled"/> so the
/// owning chart can re-render the visible set.
/// </summary>
public partial class TsChartLegend : ContentControl
{
    private readonly StackPanel _items = new() { Orientation = Orientation.Horizontal, Spacing = 12 };
    private ChartLegendState _state = new();

    public static readonly DependencyProperty SeriesProperty = DependencyProperty.Register(
        nameof(Series), typeof(IReadOnlyList<ChartSeries>), typeof(TsChartLegend),
        new PropertyMetadata(null, OnSeriesChanged));

    public TsChartLegend()
    {
        IsTabStop = false;
        Content = _items;
    }

    /// <summary>Raised after a legend entry toggles its series' visibility.</summary>
    public event EventHandler<string>? SeriesToggled;

    /// <summary>The series to list.</summary>
    public IReadOnlyList<ChartSeries>? Series
    {
        get => (IReadOnlyList<ChartSeries>?)GetValue(SeriesProperty);
        set => SetValue(SeriesProperty, value);
    }

    /// <summary>The shared legend / hidden-series state.</summary>
    public ChartLegendState State
    {
        get => _state;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _state = value;
            Rebuild();
        }
    }

    private static void OnSeriesChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsChartLegend)d).Rebuild();

    private void Rebuild()
    {
        _items.Children.Clear();
        var series = Series ?? [];

        foreach (var s in series)
        {
            _items.Children.Add(BuildEntry(s));
        }
    }

    private ToggleButton BuildEntry(ChartSeries series)
    {
        var visible = _state.IsVisible(series.Name);

        var swatch = new Rectangle
        {
            Width = 12,
            Height = 12,
            RadiusX = 3,
            RadiusY = 3,
            Fill = ChartBrushes.ForSeries(series),
            VerticalAlignment = VerticalAlignment.Center,
        };

        var label = new TextBlock
        {
            Text = series.Name,
            Foreground = visible ? ChartBrushes.TextPrimary : ChartBrushes.TextMuted,
            TextDecorations = visible ? TextDecorations.None : TextDecorations.Strikethrough,
            FontSize = TypographyTokens.Size("TsTypeBodySmFontSize", 12),
            VerticalAlignment = VerticalAlignment.Center,
        };

        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        content.Children.Add(swatch);
        content.Children.Add(label);

        var toggle = new ToggleButton
        {
            Content = content,
            IsChecked = visible,
            Background = new SolidColorBrush(),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(4, 2, 4, 2),
        };
        AutomationProperties.SetName(toggle, series.Name);

        toggle.Click += (s, e) =>
        {
            var nowVisible = _state.Toggle(series.Name);
            label.Foreground = nowVisible ? ChartBrushes.TextPrimary : ChartBrushes.TextMuted;
            label.TextDecorations = nowVisible ? TextDecorations.None : TextDecorations.Strikethrough;
            toggle.IsChecked = nowVisible;
            SeriesToggled?.Invoke(this, series.Name);
        };

        return toggle;
    }
}
