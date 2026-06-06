using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// Radar / spider chart (mirrors the web recharts <c>RadarChart</c>). Each series'
/// points are placed on evenly spaced axes (one per point index) and joined into a
/// filled polygon. Concentric tokenized rings and spokes give scale; axis labels
/// come from each point's <see cref="ChartPoint.Label"/>. Size-responsive with a
/// spoken summary for UI Automation.
/// </summary>
public partial class TsRadarChart : ContentControl
{
    private readonly Canvas _canvas = new();

    public static readonly DependencyProperty SeriesProperty = DependencyProperty.Register(
        nameof(Series), typeof(IReadOnlyList<ChartSeries>), typeof(TsRadarChart),
        new PropertyMetadata(null, OnRenderChanged));

    public static readonly DependencyProperty MaxValueProperty = DependencyProperty.Register(
        nameof(MaxValue), typeof(double), typeof(TsRadarChart),
        new PropertyMetadata(0.0, OnRenderChanged));

    public TsRadarChart()
    {
        IsTabStop = false;
        MinHeight = 200;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        Content = _canvas;
        SizeChanged += (s, e) => Render();
    }

    /// <summary>The series to overlay on the radar.</summary>
    public IReadOnlyList<ChartSeries>? Series
    {
        get => (IReadOnlyList<ChartSeries>?)GetValue(SeriesProperty);
        set => SetValue(SeriesProperty, value);
    }

    /// <summary>Axis maximum; 0 = auto from the data.</summary>
    public double MaxValue
    {
        get => (double)GetValue(MaxValueProperty);
        set => SetValue(MaxValueProperty, value);
    }

    private static void OnRenderChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsRadarChart)d).Render();

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

        var series = Series ?? [];
        var axisCount = 0;
        var max = MaxValue;
        foreach (var s in series)
        {
            axisCount = Math.Max(axisCount, s.Points.Count);
            foreach (var p in s.Points)
            {
                max = Math.Max(max, p.Y);
            }
        }

        if (axisCount == 0 || max <= 0)
        {
            AutomationProperties.SetName(this, "Radar chart, no data available");
            return;
        }

        var radius = (Math.Min(width, height) / 2) - 24;
        var center = new PointD(width / 2, height / 2);

        for (var ring = 1; ring <= 4; ring++)
        {
            var ringPoints = new List<PointD>(axisCount);
            for (var i = 0; i < axisCount; i++)
            {
                var angle = (360.0 / axisCount * i) - 90;
                ringPoints.Add(ChartGeometry.PointOnCircle(center, radius * ring / 4, angle));
            }

            var ringPolygon = ChartShapes.Polyline([.. ringPoints, ringPoints[0]], ChartBrushes.Border, 0.5);
            ringPolygon.Opacity = 0.4;
            _canvas.Children.Add(ringPolygon);
        }

        for (var i = 0; i < axisCount; i++)
        {
            var angle = (360.0 / axisCount * i) - 90;
            var tip = ChartGeometry.PointOnCircle(center, radius, angle);
            _canvas.Children.Add(new Line
            {
                X1 = center.X,
                Y1 = center.Y,
                X2 = tip.X,
                Y2 = tip.Y,
                Stroke = ChartBrushes.Border,
                StrokeThickness = 0.5,
                Opacity = 0.4,
            });

            var label = LabelFor(series, i);
            if (!string.IsNullOrEmpty(label))
            {
                var anchor = ChartGeometry.PointOnCircle(center, radius + 12, angle);
                var text = new TextBlock
                {
                    Text = label,
                    Foreground = ChartBrushes.TextMuted,
                    FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 11),
                };
                Canvas.SetLeft(text, anchor.X - 12);
                Canvas.SetTop(text, anchor.Y - 8);
                _canvas.Children.Add(text);
            }
        }

        foreach (var s in series)
        {
            var brush = ChartBrushes.ForSeries(s);
            var polygon = ChartGeometry.RadarPolygon(s, center, radius, max);
            if (polygon.Count == 0)
            {
                continue;
            }

            var fill = ChartShapes.Polygon(polygon, brush);
            fill.Opacity = 0.18;
            _canvas.Children.Add(fill);
            _canvas.Children.Add(ChartShapes.Polyline([.. polygon, polygon[0]], brush, 1.75));
        }

        AutomationProperties.SetName(this, ChartAccessibility.Summarize("Radar chart", series));
    }

    private static string LabelFor(IReadOnlyList<ChartSeries> series, int index)
    {
        foreach (var s in series)
        {
            if (index < s.Points.Count && !string.IsNullOrEmpty(s.Points[index].Label))
            {
                return s.Points[index].Label!;
            }
        }

        return string.Empty;
    }
}
