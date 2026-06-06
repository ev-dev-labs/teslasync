using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// Distance-versus-elevation area chart (mirrors the web <c>ElevationProfile</c>).
/// Fills its container, redraws on resize and overlays the min / max elevation as
/// captions. Bind <see cref="Points"/> with <c>X</c> = cumulative distance and
/// <c>Y</c> = elevation (SI metres); convert to display units at the call site.
/// </summary>
public partial class TsElevationProfile : ContentControl
{
    private readonly Canvas _canvas = new();
    private readonly Caption _maxLabel = new();
    private readonly Caption _minLabel = new();
    private readonly Grid _root = new();

    public static readonly DependencyProperty PointsProperty = DependencyProperty.Register(
        nameof(Points), typeof(IReadOnlyList<ChartPoint>), typeof(TsElevationProfile),
        new PropertyMetadata(null, OnRenderChanged));

    public static readonly DependencyProperty UnitProperty = DependencyProperty.Register(
        nameof(Unit), typeof(string), typeof(TsElevationProfile),
        new PropertyMetadata("m", OnRenderChanged));

    public TsElevationProfile()
    {
        IsTabStop = false;
        MinHeight = 120;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _maxLabel.HorizontalAlignment = HorizontalAlignment.Left;
        _maxLabel.VerticalAlignment = VerticalAlignment.Top;
        _minLabel.HorizontalAlignment = HorizontalAlignment.Left;
        _minLabel.VerticalAlignment = VerticalAlignment.Bottom;

        _root.Children.Add(_canvas);
        _root.Children.Add(_maxLabel);
        _root.Children.Add(_minLabel);
        Content = _root;

        SizeChanged += (s, e) => Render();
    }

    /// <summary>Elevation samples: <c>X</c> = distance, <c>Y</c> = elevation.</summary>
    public IReadOnlyList<ChartPoint>? Points
    {
        get => (IReadOnlyList<ChartPoint>?)GetValue(PointsProperty);
        set => SetValue(PointsProperty, value);
    }

    /// <summary>Display unit suffix for the min / max captions.</summary>
    public string Unit
    {
        get => (string)GetValue(UnitProperty);
        set => SetValue(UnitProperty, value);
    }

    private static void OnRenderChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsElevationProfile)d).Render();

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

        var points = Points ?? [];
        if (points.Count == 0)
        {
            _maxLabel.Value = string.Empty;
            _minLabel.Value = string.Empty;
            return;
        }

        var series = new ChartSeries("elevation", points)
        {
            Kind = ChartSeriesKind.Area,
            Role = ChartRole.Regen,
        };
        IReadOnlyList<ChartSeries> single = [series];

        var plot = ChartGeometry.PlotArea(width, height, new EdgeInsets(0, 8, 0, 8));
        var x = ChartGeometry.BuildXScale(single, plot);
        var y = ChartGeometry.BuildYScale(single, plot, includeZero: false);
        var brush = ChartBrushes.ForSeries(series);

        var fill = ChartShapes.Polygon(ChartGeometry.AreaPolygon(series, x, y), brush);
        fill.Opacity = 0.22;
        _canvas.Children.Add(fill);
        _canvas.Children.Add(ChartShapes.Polyline(ChartGeometry.LinePoints(series, x, y), brush, 1.75));

        var min = double.PositiveInfinity;
        var max = double.NegativeInfinity;
        foreach (var p in points)
        {
            min = Math.Min(min, p.Y);
            max = Math.Max(max, p.Y);
        }

        _maxLabel.Value = ChartPalette.FormatValue(max, 0, Unit);
        _minLabel.Value = ChartPalette.FormatValue(min, 0, Unit);
        AutomationProperties.SetName(this, $"Elevation profile, {_minLabel.Value} to {_maxLabel.Value}");
    }
}
