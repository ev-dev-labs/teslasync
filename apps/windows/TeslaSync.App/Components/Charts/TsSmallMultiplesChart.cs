using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// A responsive grid of titled mini charts (mirrors the web
/// <c>SmallMultiplesChart</c>). Each series becomes its own labelled
/// <see cref="TsMiniChart"/> cell so several metrics can be compared at a glance
/// on a shared layout. The column count adapts to the available width.
/// </summary>
public partial class TsSmallMultiplesChart : ContentControl
{
    private readonly VariableSizedWrapGrid _grid = new()
    {
        Orientation = Orientation.Horizontal,
        ItemHeight = 96,
    };

    public static readonly DependencyProperty SeriesProperty = DependencyProperty.Register(
        nameof(Series), typeof(IReadOnlyList<ChartSeries>), typeof(TsSmallMultiplesChart),
        new PropertyMetadata(null, OnRenderChanged));

    public static readonly DependencyProperty CellWidthProperty = DependencyProperty.Register(
        nameof(CellWidth), typeof(double), typeof(TsSmallMultiplesChart),
        new PropertyMetadata(180.0, OnRenderChanged));

    public TsSmallMultiplesChart()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Content = _grid;
        Render();
    }

    /// <summary>One mini chart is drawn per series.</summary>
    public IReadOnlyList<ChartSeries>? Series
    {
        get => (IReadOnlyList<ChartSeries>?)GetValue(SeriesProperty);
        set => SetValue(SeriesProperty, value);
    }

    /// <summary>Fixed width of each mini-chart cell.</summary>
    public double CellWidth
    {
        get => (double)GetValue(CellWidthProperty);
        set => SetValue(CellWidthProperty, value);
    }

    private static void OnRenderChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsSmallMultiplesChart)d).Render();

    private void Render()
    {
        _grid.ItemWidth = CellWidth;
        _grid.Children.Clear();

        var series = Series ?? [];
        foreach (var s in series)
        {
            var title = new Caption { Value = s.Name };
            var mini = new TsMiniChart { Series = s, Height = 64, Width = CellWidth - 8 };

            var cell = new StackPanel { Spacing = 2, Padding = new Thickness(4) };
            cell.Children.Add(title);
            cell.Children.Add(mini);
            _grid.Children.Add(cell);
        }
    }
}
