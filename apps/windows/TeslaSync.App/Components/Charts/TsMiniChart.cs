using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// Compact axis-less chart for a single series (mirrors the web <c>MiniChart</c>).
/// Fills its container and redraws on resize, rendering the series as a line, soft
/// area or bars depending on <see cref="ChartSeries.Kind"/>. Used standalone for
/// "metric at a glance" panels and as the cell of <see cref="TsSmallMultiplesChart"/>.
/// </summary>
public partial class TsMiniChart : ContentControl
{
    private readonly Canvas _canvas = new();

    public static readonly DependencyProperty SeriesProperty = DependencyProperty.Register(
        nameof(Series), typeof(ChartSeries), typeof(TsMiniChart), new PropertyMetadata(null, OnRenderChanged));

    public TsMiniChart()
    {
        IsTabStop = false;
        MinHeight = 48;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        Content = _canvas;
        SizeChanged += (s, e) => Render();
    }

    /// <summary>The single series to draw.</summary>
    public ChartSeries? Series
    {
        get => (ChartSeries?)GetValue(SeriesProperty);
        set => SetValue(SeriesProperty, value);
    }

    private static void OnRenderChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsMiniChart)d).Render();

    private void Render()
    {
        var width = ActualWidth > 0 ? ActualWidth : Width;
        var height = ActualHeight > 0 ? ActualHeight : Height;
        _canvas.Children.Clear();
        if (double.IsNaN(width) || double.IsNaN(height) || width <= 0 || height <= 0)
        {
            return;
        }

        _canvas.Width = width;
        _canvas.Height = height;

        var series = Series;
        if (series is null || series.Points.Count == 0)
        {
            return;
        }

        IReadOnlyList<ChartSeries> single = [series];
        var plot = ChartGeometry.PlotArea(width, height, new EdgeInsets(2, 4, 2, 4));
        var x = ChartGeometry.BuildXScale(single, plot);
        var y = ChartGeometry.BuildYScale(single, plot);
        var brush = ChartBrushes.ForSeries(series);

        switch (series.Kind)
        {
            case ChartSeriesKind.Bar:
                foreach (var rect in ChartGeometry.BarRects(single, 0, x, y))
                {
                    var bar = new Microsoft.UI.Xaml.Shapes.Rectangle
                    {
                        Width = Math.Max(1, rect.Width),
                        Height = Math.Max(0, rect.Height),
                        Fill = brush,
                        RadiusX = 1,
                        RadiusY = 1,
                    };
                    Canvas.SetLeft(bar, rect.X);
                    Canvas.SetTop(bar, rect.Y);
                    _canvas.Children.Add(bar);
                }

                break;
            case ChartSeriesKind.Area:
                var fill = ChartShapes.Polygon(ChartGeometry.AreaPolygon(series, x, y), brush);
                fill.Opacity = 0.22;
                _canvas.Children.Add(fill);
                _canvas.Children.Add(ChartShapes.Polyline(ChartGeometry.LinePoints(series, x, y), brush, 1.5));
                break;
            default:
                _canvas.Children.Add(ChartShapes.Polyline(ChartGeometry.LinePoints(series, x, y), brush, 1.5));
                break;
        }
    }
}
