using System.Collections.Generic;
using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using Windows.Foundation;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// Pie / donut chart (mirrors the web recharts <c>PieChart</c>). Each
/// <see cref="ChartPoint"/> in <see cref="Values"/> becomes a wedge coloured from
/// the brand palette by its order; set <see cref="InnerRadiusRatio"/> above zero for
/// a donut. The control is size-responsive, exposes a spoken slice summary to UI
/// Automation and shows each slice's value beside the ring.
/// </summary>
public partial class TsPieChart : ContentControl
{
    private readonly Canvas _canvas = new();

    public static readonly DependencyProperty ValuesProperty = DependencyProperty.Register(
        nameof(Values), typeof(IReadOnlyList<ChartPoint>), typeof(TsPieChart),
        new PropertyMetadata(null, OnRenderChanged));

    public static readonly DependencyProperty InnerRadiusRatioProperty = DependencyProperty.Register(
        nameof(InnerRadiusRatio), typeof(double), typeof(TsPieChart),
        new PropertyMetadata(0.0, OnRenderChanged));

    public static readonly DependencyProperty UnitProperty = DependencyProperty.Register(
        nameof(Unit), typeof(string), typeof(TsPieChart),
        new PropertyMetadata(string.Empty, OnRenderChanged));

    public TsPieChart()
    {
        IsTabStop = false;
        MinHeight = 160;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        Content = _canvas;
        SizeChanged += (s, e) => Render();
    }

    /// <summary>The slices to draw; <c>Y</c> is the slice magnitude and <c>Label</c> its name.</summary>
    public IReadOnlyList<ChartPoint>? Values
    {
        get => (IReadOnlyList<ChartPoint>?)GetValue(ValuesProperty);
        set => SetValue(ValuesProperty, value);
    }

    /// <summary>0 = full pie; 0.6 = a donut with a 60%-radius hole.</summary>
    public double InnerRadiusRatio
    {
        get => (double)GetValue(InnerRadiusRatioProperty);
        set => SetValue(InnerRadiusRatioProperty, value);
    }

    /// <summary>Unit suffix appended to slice value labels.</summary>
    public string Unit
    {
        get => (string)GetValue(UnitProperty);
        set => SetValue(UnitProperty, value);
    }

    private static void OnRenderChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsPieChart)d).Render();

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

        var values = Values ?? [];
        if (values.Count == 0)
        {
            AutomationProperties.SetName(this, "Pie chart, no data available");
            return;
        }

        var radius = (Math.Min(width, height) / 2) - 8;
        var center = new PointD(width / 2, height / 2);
        var slices = ChartGeometry.PieSlices(values);

        foreach (var slice in slices)
        {
            _canvas.Children.Add(BuildWedge(center, radius, slice));
        }

        if (InnerRadiusRatio > 0)
        {
            var hole = new Ellipse
            {
                Width = radius * InnerRadiusRatio * 2,
                Height = radius * InnerRadiusRatio * 2,
                Fill = ChartBrushes.Surface,
            };
            Canvas.SetLeft(hole, center.X - (radius * InnerRadiusRatio));
            Canvas.SetTop(hole, center.Y - (radius * InnerRadiusRatio));
            _canvas.Children.Add(hole);
        }

        foreach (var slice in slices)
        {
            var mid = slice.StartAngleDeg + (slice.SweepAngleDeg / 2);
            var anchor = ChartGeometry.PointOnCircle(center, radius * 0.7, mid);
            var label = new TextBlock
            {
                Text = ChartPalette.FormatValue(slice.Value, 0, string.IsNullOrEmpty(Unit) ? null : Unit),
                Foreground = ChartBrushes.TextPrimary,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 11),
            };
            Canvas.SetLeft(label, anchor.X - 10);
            Canvas.SetTop(label, anchor.Y - 8);
            _canvas.Children.Add(label);
        }

        AutomationProperties.SetName(this, Summarize(values));
    }

    private static Microsoft.UI.Xaml.Shapes.Path BuildWedge(PointD center, double radius, PieSlice slice)
    {
        var start = ChartGeometry.PointOnCircle(center, radius, slice.StartAngleDeg);
        var end = ChartGeometry.PointOnCircle(center, radius, slice.StartAngleDeg + slice.SweepAngleDeg);

        var figure = new PathFigure { StartPoint = new Point(center.X, center.Y), IsClosed = true };
        figure.Segments.Add(new LineSegment { Point = new Point(start.X, start.Y) });
        figure.Segments.Add(new ArcSegment
        {
            Point = new Point(end.X, end.Y),
            Size = new Size(radius, radius),
            IsLargeArc = slice.SweepAngleDeg > 180,
            SweepDirection = SweepDirection.Clockwise,
        });

        var geometry = new PathGeometry();
        geometry.Figures.Add(figure);

        return new Microsoft.UI.Xaml.Shapes.Path
        {
            Data = geometry,
            Fill = ChartBrushes.ForIndex(slice.ColorIndex),
        };
    }

    private static string Summarize(IReadOnlyList<ChartPoint> values)
    {
        var total = 0.0;
        foreach (var v in values)
        {
            total += v.Y;
        }

        return string.Create(CultureInfo.InvariantCulture, $"Pie chart, {values.Count} slices, total {total:0.##}");
    }
}
