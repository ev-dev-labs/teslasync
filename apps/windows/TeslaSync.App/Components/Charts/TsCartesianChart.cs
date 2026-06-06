using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// The native cartesian rendering surface that powers every axis-based TeslaSync
/// chart (mirrors the web recharts <c>LineChart</c> / <c>AreaChart</c> /
/// <c>BarChart</c> / <c>ScatterChart</c> / <c>ComposedChart</c>). It draws a
/// tokenized grid and axes, then renders each bound <see cref="ChartSeries"/>
/// according to its <see cref="ChartSeriesKind"/>, overlays reference
/// <see cref="Annotations"/>, hosts an interactive <see cref="TsChartLegend"/> with
/// hidden-series toggles, and tracks the pointer to drive a synchronized cursor and
/// a <see cref="TsChartTooltip"/>. Charts that share a <see cref="CursorSync"/> group
/// move their cursors together. A spoken <see cref="AutomationProperties"/> summary
/// is published for assistive technology. Concrete kinds derive from this and simply
/// fix a default series kind.
/// </summary>
public partial class TsCartesianChart : ContentControl
{
    private static readonly EdgeInsets PlotInsets = new(44, 10, 12, 22);

    private readonly Grid _surface = new() { MinHeight = 200 };
    private readonly Canvas _canvas = new();
    private readonly Canvas _overlay = new() { IsHitTestVisible = false };
    private readonly Line _cursorLine;
    private readonly TsChartTooltip _tooltip = new();
    private readonly TsChartLegend _legend = new();

    private IReadOnlyList<ChartSeries> _visible = [];
    private LinearScale? _xScale;
    private bool _applyingSync;

    public static readonly DependencyProperty SeriesProperty = DependencyProperty.Register(
        nameof(Series), typeof(IReadOnlyList<ChartSeries>), typeof(TsCartesianChart),
        new PropertyMetadata(null, OnRenderChanged));

    public static readonly DependencyProperty AnnotationsProperty = DependencyProperty.Register(
        nameof(Annotations), typeof(IReadOnlyList<ChartAnnotation>), typeof(TsCartesianChart),
        new PropertyMetadata(null, OnRenderChanged));

    public static readonly DependencyProperty ShowGridProperty = DependencyProperty.Register(
        nameof(ShowGrid), typeof(bool), typeof(TsCartesianChart),
        new PropertyMetadata(true, OnRenderChanged));

    public static readonly DependencyProperty ShowAxesProperty = DependencyProperty.Register(
        nameof(ShowAxes), typeof(bool), typeof(TsCartesianChart),
        new PropertyMetadata(true, OnRenderChanged));

    public static readonly DependencyProperty ShowLegendProperty = DependencyProperty.Register(
        nameof(ShowLegend), typeof(bool), typeof(TsCartesianChart),
        new PropertyMetadata(true, OnLegendVisibilityChanged));

    public static readonly DependencyProperty IncludeZeroProperty = DependencyProperty.Register(
        nameof(IncludeZero), typeof(bool), typeof(TsCartesianChart),
        new PropertyMetadata(true, OnRenderChanged));

    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(
        nameof(Title), typeof(string), typeof(TsCartesianChart),
        new PropertyMetadata(string.Empty, OnRenderChanged));

    public TsCartesianChart()
    {
        IsTabStop = true;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _cursorLine = new Line
        {
            Stroke = ChartBrushes.Border,
            StrokeThickness = 1,
            Visibility = Visibility.Collapsed,
        };

        _overlay.Children.Add(_cursorLine);
        _overlay.Children.Add(_tooltip);

        _surface.Children.Add(_canvas);
        _surface.Children.Add(_overlay);

        _legend.SeriesToggled += (s, e) => Render();

        var root = new StackPanel { Spacing = 8 };
        root.Children.Add(_surface);
        root.Children.Add(_legend);
        Content = root;

        _surface.SizeChanged += (s, e) => Render();
        _surface.PointerMoved += OnSurfacePointerMoved;
        _surface.PointerExited += OnSurfacePointerExited;
    }

    /// <summary>The data series to plot.</summary>
    public IReadOnlyList<ChartSeries>? Series
    {
        get => (IReadOnlyList<ChartSeries>?)GetValue(SeriesProperty);
        set => SetValue(SeriesProperty, value);
    }

    /// <summary>Reference lines / bands drawn over the plot.</summary>
    public IReadOnlyList<ChartAnnotation>? Annotations
    {
        get => (IReadOnlyList<ChartAnnotation>?)GetValue(AnnotationsProperty);
        set => SetValue(AnnotationsProperty, value);
    }

    /// <summary>Whether the background grid lines are drawn.</summary>
    public bool ShowGrid
    {
        get => (bool)GetValue(ShowGridProperty);
        set => SetValue(ShowGridProperty, value);
    }

    /// <summary>Whether axis tick labels are drawn.</summary>
    public bool ShowAxes
    {
        get => (bool)GetValue(ShowAxesProperty);
        set => SetValue(ShowAxesProperty, value);
    }

    /// <summary>Whether the interactive legend is shown beneath the plot.</summary>
    public bool ShowLegend
    {
        get => (bool)GetValue(ShowLegendProperty);
        set => SetValue(ShowLegendProperty, value);
    }

    /// <summary>Whether the Y domain is forced to include zero.</summary>
    public bool IncludeZero
    {
        get => (bool)GetValue(IncludeZeroProperty);
        set => SetValue(IncludeZeroProperty, value);
    }

    /// <summary>Heading used in the accessible summary.</summary>
    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    /// <summary>The shared legend / hidden-series state.</summary>
    public ChartLegendState LegendState
    {
        get => _legend.State;
        set => _legend.State = value;
    }

    /// <summary>Optional cross-chart cursor synchronization group.</summary>
    public ChartCursorSyncGroup? CursorSync { get; set; }

    /// <summary>The default kind applied to series that don't specify one.</summary>
    protected ChartSeriesKind? DefaultKind { get; init; }

    private static void OnRenderChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsCartesianChart)d).Render();

    private static void OnLegendVisibilityChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var c = (TsCartesianChart)d;
        c._legend.Visibility = c.ShowLegend ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>Attaches a cursor-sync group so this chart tracks peers' cursors.</summary>
    public void AttachCursorSync(ChartCursorSyncGroup group)
    {
        ArgumentNullException.ThrowIfNull(group);
        CursorSync = group;
        group.CursorChanged += OnSyncCursorChanged;
    }

    private IReadOnlyList<ChartSeries> ResolveSeries()
    {
        var raw = Series ?? [];
        if (DefaultKind is not { } kind)
        {
            return raw;
        }

        var adjusted = new List<ChartSeries>(raw.Count);
        foreach (var s in raw)
        {
            adjusted.Add(new ChartSeries(s.Name, s.Points)
            {
                Kind = kind,
                ColorIndex = s.ColorIndex,
                Role = s.Role,
                Unit = s.Unit,
                Decimals = s.Decimals,
            });
        }

        return adjusted;
    }

    private void Render()
    {
        var width = _surface.ActualWidth;
        var height = _surface.ActualHeight;
        _canvas.Children.Clear();
        _canvas.Width = width;
        _canvas.Height = height;
        _overlay.Width = width;
        _overlay.Height = height;

        var all = ResolveSeries();
        _legend.Series = all;
        _visible = LegendState.VisibleSeries(all);

        AutomationProperties.SetName(this, ChartAccessibility.Summarize(Title, all));

        if (width <= 0 || height <= 0 || _visible.Count == 0)
        {
            _xScale = null;
            return;
        }

        var plot = ChartGeometry.PlotArea(width, height, PlotInsets);
        var x = ChartGeometry.BuildXScale(_visible, plot);
        var y = ChartGeometry.BuildYScale(_visible, plot, IncludeZero);
        _xScale = x;

        if (ShowGrid)
        {
            DrawGrid(plot, x, y);
        }

        if (ShowAxes)
        {
            DrawAxes(plot, x, y);
        }

        DrawSeries(x, y);
        DrawAnnotations(plot, x, y);
    }

    private void DrawGrid(RectD plot, LinearScale x, LinearScale y)
    {
        foreach (var tick in y.Ticks())
        {
            var py = y.Map(tick);
            _canvas.Children.Add(new Line
            {
                X1 = plot.X,
                X2 = plot.X + plot.Width,
                Y1 = py,
                Y2 = py,
                Stroke = ChartBrushes.Border,
                StrokeThickness = 0.5,
                Opacity = 0.5,
            });
        }

        foreach (var tick in x.Ticks())
        {
            var px = x.Map(tick);
            _canvas.Children.Add(new Line
            {
                X1 = px,
                X2 = px,
                Y1 = plot.Y,
                Y2 = plot.Y + plot.Height,
                Stroke = ChartBrushes.Border,
                StrokeThickness = 0.5,
                Opacity = 0.25,
            });
        }
    }

    private void DrawAxes(RectD plot, LinearScale x, LinearScale y)
    {
        foreach (var tick in y.Ticks())
        {
            var label = new TextBlock
            {
                Text = ChartPalette.FormatValue(tick, null),
                Foreground = ChartBrushes.TextMuted,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 11),
            };
            Canvas.SetLeft(label, 2);
            Canvas.SetTop(label, y.Map(tick) - 8);
            _canvas.Children.Add(label);
        }

        foreach (var tick in x.Ticks())
        {
            var label = new TextBlock
            {
                Text = ChartPalette.FormatValue(tick, 0),
                Foreground = ChartBrushes.TextMuted,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 11),
            };
            Canvas.SetLeft(label, x.Map(tick) - 8);
            Canvas.SetTop(label, plot.Y + plot.Height + 4);
            _canvas.Children.Add(label);
        }
    }

    private void DrawSeries(LinearScale x, LinearScale y)
    {
        var barSeries = new List<ChartSeries>();
        foreach (var s in _visible)
        {
            if (s.Kind == ChartSeriesKind.Bar)
            {
                barSeries.Add(s);
            }
        }

        foreach (var s in _visible)
        {
            var brush = ChartBrushes.ForSeries(s);
            switch (s.Kind)
            {
                case ChartSeriesKind.Bar:
                    var barIndex = barSeries.IndexOf(s);
                    foreach (var rect in ChartGeometry.BarRects(barSeries, barIndex, x, y))
                    {
                        var bar = new Rectangle
                        {
                            Width = Math.Max(1, rect.Width),
                            Height = Math.Max(0, rect.Height),
                            Fill = brush,
                            RadiusX = 2,
                            RadiusY = 2,
                        };
                        Canvas.SetLeft(bar, rect.X);
                        Canvas.SetTop(bar, rect.Y);
                        _canvas.Children.Add(bar);
                    }

                    break;
                case ChartSeriesKind.Area:
                    var fill = ChartShapes.Polygon(ChartGeometry.AreaPolygon(s, x, y), brush);
                    fill.Opacity = 0.2;
                    _canvas.Children.Add(fill);
                    _canvas.Children.Add(ChartShapes.Polyline(ChartGeometry.LinePoints(s, x, y), brush, 2));
                    break;
                case ChartSeriesKind.Scatter:
                    foreach (var p in ChartGeometry.ScatterPoints(s, x, y))
                    {
                        var dot = new Ellipse { Width = 6, Height = 6, Fill = brush };
                        Canvas.SetLeft(dot, p.X - 3);
                        Canvas.SetTop(dot, p.Y - 3);
                        _canvas.Children.Add(dot);
                    }

                    break;
                default:
                    _canvas.Children.Add(ChartShapes.Polyline(ChartGeometry.LinePoints(s, x, y), brush, 2));
                    break;
            }
        }
    }

    private void DrawAnnotations(RectD plot, LinearScale x, LinearScale y)
    {
        var annotations = Annotations ?? [];
        foreach (var annotation in annotations)
        {
            var brush = annotation.Role != ChartRole.None
                ? ChartBrushes.Resolve(ChartPalette.KeyForRole(annotation.Role))
                : ChartBrushes.TextMuted;

            switch (annotation.Kind)
            {
                case ChartAnnotationKind.HorizontalLine:
                    var hy = y.Map(annotation.Value);
                    _canvas.Children.Add(DashedLine(plot.X, hy, plot.X + plot.Width, hy, brush));
                    AddAnnotationLabel(annotation.Label, plot.X + 4, hy - 14);
                    break;
                case ChartAnnotationKind.Band:
                    var top = Math.Min(y.Map(annotation.Value), y.Map(annotation.Value2));
                    var bottom = Math.Max(y.Map(annotation.Value), y.Map(annotation.Value2));
                    var band = new Rectangle
                    {
                        Width = plot.Width,
                        Height = Math.Max(0, bottom - top),
                        Fill = brush,
                        Opacity = 0.12,
                    };
                    Canvas.SetLeft(band, plot.X);
                    Canvas.SetTop(band, top);
                    _canvas.Children.Add(band);
                    AddAnnotationLabel(annotation.Label, plot.X + 4, top + 2);
                    break;
                default:
                    var vx = x.Map(annotation.Value);
                    _canvas.Children.Add(DashedLine(vx, plot.Y, vx, plot.Y + plot.Height, brush));
                    AddAnnotationLabel(annotation.Label, vx + 4, plot.Y + 2);
                    break;
            }
        }
    }

    private static Line DashedLine(double x1, double y1, double x2, double y2, Brush stroke) => new()
    {
        X1 = x1,
        Y1 = y1,
        X2 = x2,
        Y2 = y2,
        Stroke = stroke,
        StrokeThickness = 1,
        StrokeDashArray = [4, 3],
    };

    private void AddAnnotationLabel(string? text, double left, double top)
    {
        if (string.IsNullOrEmpty(text))
        {
            return;
        }

        var label = new TextBlock
        {
            Text = text,
            Foreground = ChartBrushes.TextMuted,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 11),
        };
        Canvas.SetLeft(label, left);
        Canvas.SetTop(label, top);
        _canvas.Children.Add(label);
    }

    private void OnSurfacePointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (_xScale is null || _visible.Count == 0)
        {
            return;
        }

        var px = e.GetCurrentPoint(_surface).Position.X;
        var domainX = _xScale.Invert(px);
        UpdateCursor(domainX);

        if (CursorSync is not null && !_applyingSync)
        {
            CursorSync.SetCursor(domainX);
        }
    }

    private void OnSurfacePointerExited(object sender, PointerRoutedEventArgs e)
    {
        HideCursor();
        if (CursorSync is not null && !_applyingSync)
        {
            CursorSync.Clear();
        }
    }

    private void OnSyncCursorChanged(object? sender, ChartCursorChange change)
    {
        _applyingSync = true;
        try
        {
            if (change.IsActive)
            {
                UpdateCursor(change.DomainX);
            }
            else
            {
                HideCursor();
            }
        }
        finally
        {
            _applyingSync = false;
        }
    }

    private void UpdateCursor(double domainX)
    {
        if (_xScale is null || _visible.Count == 0)
        {
            return;
        }

        var index = ChartTooltipFormatter.NearestIndex(_visible, domainX);
        if (index < 0)
        {
            HideCursor();
            return;
        }

        ChartSeries? basis = null;
        foreach (var s in _visible)
        {
            if (index < s.Points.Count)
            {
                basis = s;
                break;
            }
        }

        if (basis is null)
        {
            HideCursor();
            return;
        }

        var snappedX = _xScale.Map(basis.Points[index].X);
        _cursorLine.X1 = snappedX;
        _cursorLine.X2 = snappedX;
        _cursorLine.Y1 = PlotInsets.Top;
        _cursorLine.Y2 = _surface.ActualHeight - PlotInsets.Bottom;
        _cursorLine.Visibility = Visibility.Visible;

        var model = ChartTooltipFormatter.ForIndex(_visible, index);
        _tooltip.Update(model);
        _tooltip.Show();

        var tooltipLeft = Math.Min(snappedX + 12, Math.Max(0, _surface.ActualWidth - 140));
        Canvas.SetLeft(_tooltip, tooltipLeft);
        Canvas.SetTop(_tooltip, PlotInsets.Top);
    }

    private void HideCursor()
    {
        _cursorLine.Visibility = Visibility.Collapsed;
        _tooltip.Hide();
    }
}
