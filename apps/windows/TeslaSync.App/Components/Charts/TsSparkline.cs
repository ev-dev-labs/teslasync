using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// Tiny inline trend line (mirrors the web <c>Sparkline</c>). Auto-scales the
/// supplied values to its own min/max and draws a soft area fill beneath a
/// stroked line, sized by <see cref="ChartWidth"/> × <see cref="ChartHeight"/>.
/// Intended for compact "trend in a cell" use inside tables and stat cards.
/// </summary>
public partial class TsSparkline : ContentControl
{
    private readonly Canvas _canvas = new();

    public static readonly DependencyProperty DataProperty = DependencyProperty.Register(
        nameof(Data), typeof(IReadOnlyList<double>), typeof(TsSparkline), new PropertyMetadata(null, OnRenderChanged));

    public static readonly DependencyProperty ChartWidthProperty = DependencyProperty.Register(
        nameof(ChartWidth), typeof(double), typeof(TsSparkline), new PropertyMetadata(100.0, OnRenderChanged));

    public static readonly DependencyProperty ChartHeightProperty = DependencyProperty.Register(
        nameof(ChartHeight), typeof(double), typeof(TsSparkline), new PropertyMetadata(30.0, OnRenderChanged));

    public static readonly DependencyProperty ColorIndexProperty = DependencyProperty.Register(
        nameof(ColorIndex), typeof(int), typeof(TsSparkline), new PropertyMetadata(0, OnRenderChanged));

    public static readonly DependencyProperty RoleProperty = DependencyProperty.Register(
        nameof(Role), typeof(ChartRole), typeof(TsSparkline), new PropertyMetadata(ChartRole.None, OnRenderChanged));

    public TsSparkline()
    {
        IsTabStop = false;
        Content = _canvas;
        Render();
    }

    /// <summary>The values to plot, in order.</summary>
    public IReadOnlyList<double>? Data
    {
        get => (IReadOnlyList<double>?)GetValue(DataProperty);
        set => SetValue(DataProperty, value);
    }

    /// <summary>Width of the sparkline in pixels.</summary>
    public double ChartWidth
    {
        get => (double)GetValue(ChartWidthProperty);
        set => SetValue(ChartWidthProperty, value);
    }

    /// <summary>Height of the sparkline in pixels.</summary>
    public double ChartHeight
    {
        get => (double)GetValue(ChartHeightProperty);
        set => SetValue(ChartHeightProperty, value);
    }

    /// <summary>Categorical palette index for the line.</summary>
    public int ColorIndex
    {
        get => (int)GetValue(ColorIndexProperty);
        set => SetValue(ColorIndexProperty, value);
    }

    /// <summary>Semantic role for the line (overrides <see cref="ColorIndex"/>).</summary>
    public ChartRole Role
    {
        get => (ChartRole)GetValue(RoleProperty);
        set => SetValue(RoleProperty, value);
    }

    private static void OnRenderChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsSparkline)d).Render();

    private void Render()
    {
        _canvas.Width = ChartWidth;
        _canvas.Height = ChartHeight;
        _canvas.Children.Clear();

        var data = Data ?? [];
        var points = ChartGeometry.SparklinePoints(data, ChartWidth, ChartHeight);
        if (points.Count == 0)
        {
            return;
        }

        var brush = Role != ChartRole.None
            ? ChartBrushes.Resolve(ChartPalette.KeyForRole(Role))
            : ChartBrushes.ForIndex(ColorIndex);

        var area = new List<PointD>(points.Count + 2);
        area.Add(new PointD(points[0].X, ChartHeight));
        area.AddRange(points);
        area.Add(new PointD(points[^1].X, ChartHeight));

        var fill = ChartShapes.Polygon(area, brush);
        fill.Opacity = 0.22;
        _canvas.Children.Add(fill);

        _canvas.Children.Add(ChartShapes.Polyline(points, brush, 1.5));
    }
}
