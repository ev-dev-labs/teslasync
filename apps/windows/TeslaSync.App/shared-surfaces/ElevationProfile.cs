using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 elevation-profile surface — a parity port of the web
/// <c>ElevationProfile</c> (web/src/components/charts/ElevationProfile.tsx). It wraps the shared
/// <see cref="TsChartContainer"/> (the native counterpart of the web <c>ChartContainer</c>): the empty
/// branch shows the localized "no elevation data" message (web <c>EmptyState</c>), and the populated branch
/// shows a distance-versus-elevation area chart with the cumulative gain/loss subtitle (web
/// <c>↑ …m  ↓ …m</c>), a grid, distance/elevation axes, a dashed cursor reference line at the selected
/// replay frame (web <c>ReferenceLine</c> at <c>cursorDistance</c>) and a hover tooltip. Clicking a sample
/// reports its original index through <see cref="ElevationProfileViewModel.IndexSelected"/> (web
/// <c>onClickIndex</c>). All data flows through the shared <see cref="ElevationProfileViewModel"/>; the view
/// never performs HTTP. Every string resolves through the i18n facade and the chart carries a Narrator name.
/// </summary>
public sealed partial class ElevationProfile : ContentControl, IDisposable
{
    private const double GutterLeft = 38;
    private const double GutterBottom = 18;
    private const double GutterTop = 8;
    private const double GutterRight = 10;
    private const double AreaFillOpacity = 0.22;
    private const double AxisFontSize = 10;

    private readonly ElevationProfileViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ElevationProfileDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsChartContainer _container = new();
    private readonly Grid _chartBody = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Canvas _plot = new();
    private readonly Canvas _hover = new() { IsHitTestVisible = false };
    private readonly Border _tooltip;
    private readonly TextBlock _tooltipPrimary = new() { FontSize = 11, FontWeight = FontWeights.SemiBold };
    private readonly TextBlock _tooltipSecondary = new() { FontSize = 11 };
    private readonly Ellipse _hoverMarker;

    private LinearScale? _xScale;
    private LinearScale? _yScale;
    private RectD _plotRect;
    private double _chartHeight = ElevationProfileRegistration.DefaultHeight;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data seam, localizer and optional diagnostics collector.</summary>
    public ElevationProfile(
        IElevationProfileSource source,
        ILocalizer localizer,
        ElevationProfileDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ElevationProfileDiagnostics();
        _viewModel = new ElevationProfileViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        _tooltip = BuildTooltip();
        _hoverMarker = BuildHoverMarker();
        BuildBody();
        Content = _container;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        ApplyDisplay();
    }

    /// <summary>The diagnostics slug this surface registers under (<c>ElevationProfile</c>).</summary>
    public static string Slug => ElevationProfileRegistration.Slug;

    /// <summary>The view-model whose <see cref="ElevationProfileViewModel.IndexSelected"/> a host subscribes to.</summary>
    public ElevationProfileViewModel ViewModel => _viewModel;

    /// <summary>The plotted chart height in DIPs (web <c>height</c> prop); reassigning re-lays the chart.</summary>
    public double ChartHeight
    {
        get => _chartHeight;
        set
        {
            double clamped = double.IsNaN(value) || value <= 0 ? ElevationProfileRegistration.DefaultHeight : value;
            if (Math.Abs(clamped - _chartHeight) < double.Epsilon)
            {
                return;
            }

            _chartHeight = clamped;
            _chartBody.Height = _chartHeight;
            ScheduleRender();
        }
    }

    /// <summary>Detach from the view-model (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void BuildBody()
    {
        _chartBody.Height = _chartHeight;

        _plot.HorizontalAlignment = HorizontalAlignment.Stretch;
        _plot.VerticalAlignment = VerticalAlignment.Stretch;
        _plot.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        _plot.SizeChanged += OnPlotSizeChanged;
        _plot.Tapped += OnPlotTapped;
        _plot.PointerMoved += OnPlotPointerMoved;
        _plot.PointerExited += OnPlotPointerExited;
        _plot.PointerCanceled += OnPlotPointerExited;

        _hover.Children.Add(_hoverMarker);
        _hover.Children.Add(_tooltip);

        _chartBody.Children.Add(_plot);
        _chartBody.Children.Add(_hover);

        _container.Body = _chartBody;
        _container.DataViewLabel = _localizer.GetString("replay.elevation.dataTable", "Show elevation data table");
    }

    private Border BuildTooltip()
    {
        var stack = new StackPanel { Spacing = 1 };
        stack.Children.Add(_tooltipPrimary);
        stack.Children.Add(_tooltipSecondary);

        var tooltip = new Border
        {
            Background = ChartBrushes.Surface,
            BorderBrush = ChartBrushes.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(8, 6, 8, 6),
            Visibility = Visibility.Collapsed,
            Child = stack,
        };
        AutomationProperties.SetAccessibilityView(tooltip, AccessibilityView.Raw);
        return tooltip;
    }

    private static Ellipse BuildHoverMarker() => new()
    {
        Width = 8,
        Height = 8,
        Fill = ChartBrushes.Resolve(ElevationProfileRegistration.CursorBrushKey),
        Visibility = Visibility.Collapsed,
    };

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(ElevationProfileViewModel.Display))
        {
            ScheduleRender();
        }
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        ApplyDisplay();
    }

    private void ApplyDisplay()
    {
        var display = _viewModel.Display;
        _container.Title = display.Title;
        _container.AccessibleSummary = display.AccessibleSummary;

        if (display.IsEmpty)
        {
            HideHover();
            _container.Subtitle = string.Empty;
            _container.EmptyMessage = display.EmptyMessage;
            _container.DataView.Series = [];
            _container.State = ChartState.Empty;
            _plot.Children.Clear();
            _xScale = null;
            _yScale = null;
            return;
        }

        var series = ElevationProfileProjection.BuildSeries(display, display.ElevationLabel);
        _container.Subtitle = display.Subtitle;
        _container.DataView.XLabel = display.DistanceUnit;
        _container.DataView.Series = [series];
        _container.State = ChartState.Ready;
        DrawChart(display, series);
    }

    private void OnPlotSizeChanged(object sender, SizeChangedEventArgs e)
    {
        _plot.Width = e.NewSize.Width;
        _plot.Height = e.NewSize.Height;
        _hover.Width = e.NewSize.Width;
        _hover.Height = e.NewSize.Height;
        if (!_viewModel.Display.IsEmpty)
        {
            DrawChart(_viewModel.Display, ElevationProfileProjection.BuildSeries(_viewModel.Display, _viewModel.Display.ElevationLabel));
        }
    }

    private void DrawChart(ElevationProfileDisplay display, ChartSeries series)
    {
        HideHover();
        _plot.Children.Clear();

        double width = _plot.ActualWidth > 0 ? _plot.ActualWidth : _plot.Width;
        double height = _plot.ActualHeight > 0 ? _plot.ActualHeight : _plot.Height;
        if (double.IsNaN(width) || double.IsNaN(height) || width <= 0 || height <= 0 || display.Points.Count == 0)
        {
            _xScale = null;
            _yScale = null;
            return;
        }

        IReadOnlyList<ChartSeries> single = [series];
        var plot = ChartGeometry.PlotArea(width, height, new EdgeInsets(GutterLeft, GutterTop, GutterRight, GutterBottom));
        var x = ChartGeometry.BuildXScale(single, plot);
        var y = ChartGeometry.BuildYScale(single, plot, includeZero: false);
        _xScale = x;
        _yScale = y;
        _plotRect = plot;

        DrawGrid(x, y, plot);

        var areaBrush = ChartBrushes.ForSeries(series);
        var fill = ChartShapes.Polygon(ChartGeometry.AreaPolygon(series, x, y), areaBrush);
        fill.Opacity = AreaFillOpacity;
        _plot.Children.Add(fill);
        _plot.Children.Add(ChartShapes.Polyline(ChartGeometry.LinePoints(series, x, y), areaBrush, 1.75));

        DrawAxes(display, x, y, plot);
        DrawCursor(display, x, plot);

        // Keep the hover overlay on top of the freshly drawn shapes.
        if (!_hover.Children.Contains(_hoverMarker))
        {
            _hover.Children.Add(_hoverMarker);
        }
    }

    private void DrawGrid(LinearScale x, LinearScale y, RectD plot)
    {
        var gridBrush = ChartBrushes.Border;
        foreach (double tick in y.Ticks(4))
        {
            if (tick < y.DomainMin || tick > y.DomainMax)
            {
                continue;
            }

            double py = y.Map(tick);
            var line = new Line { X1 = plot.X, Y1 = py, X2 = plot.X + plot.Width, Y2 = py, Stroke = gridBrush, StrokeThickness = 1, Opacity = 0.35 };
            _plot.Children.Add(line);
        }

        foreach (double tick in x.Ticks(4))
        {
            if (tick < x.DomainMin || tick > x.DomainMax)
            {
                continue;
            }

            double px = x.Map(tick);
            var line = new Line { X1 = px, Y1 = plot.Y, X2 = px, Y2 = plot.Y + plot.Height, Stroke = gridBrush, StrokeThickness = 1, Opacity = 0.2 };
            _plot.Children.Add(line);
        }
    }

    private void DrawAxes(ElevationProfileDisplay display, LinearScale x, LinearScale y, RectD plot)
    {
        var muted = ChartBrushes.TextMuted;

        foreach (double tick in y.Ticks(4))
        {
            if (tick < y.DomainMin || tick > y.DomainMax)
            {
                continue;
            }

            var label = AxisLabel(ChartPalette.FormatValue(tick, 0), muted);
            Canvas.SetLeft(label, 2);
            Canvas.SetTop(label, y.Map(tick) - (AxisFontSize - 1));
            _plot.Children.Add(label);
        }

        // Y-axis unit (web YAxis label "m").
        var unitY = AxisLabel(display.ElevationAxisLabel, muted);
        Canvas.SetLeft(unitY, 2);
        Canvas.SetTop(unitY, plot.Y);
        _plot.Children.Add(unitY);

        // X-axis start / end distance labels (web XAxis tickFormatter fmt(v,1)).
        var startLabel = AxisLabel(ChartPalette.FormatValue(x.DomainMin, 1), muted);
        Canvas.SetLeft(startLabel, plot.X);
        Canvas.SetTop(startLabel, plot.Y + plot.Height + 2);
        _plot.Children.Add(startLabel);

        var endText = ChartPalette.FormatValue(x.DomainMax, 1);
        var endLabel = AxisLabel(endText, muted);
        Canvas.SetLeft(endLabel, (plot.X + plot.Width) - EstimateTextWidth(endText));
        Canvas.SetTop(endLabel, plot.Y + plot.Height + 2);
        _plot.Children.Add(endLabel);

        // X-axis unit (web XAxis label distanceUnit, insideBottomRight).
        var unitX = AxisLabel(display.DistanceUnit, muted);
        Canvas.SetLeft(unitX, (plot.X + plot.Width) - EstimateTextWidth(display.DistanceUnit));
        Canvas.SetTop(unitX, plot.Y + plot.Height - (AxisFontSize + 4));
        _plot.Children.Add(unitX);
    }

    private void DrawCursor(ElevationProfileDisplay display, LinearScale x, RectD plot)
    {
        if (display.CursorDistance is not { } cursorDistance)
        {
            return;
        }

        double cx = x.Map(cursorDistance);
        var cursor = new Line
        {
            X1 = cx,
            Y1 = plot.Y,
            X2 = cx,
            Y2 = plot.Y + plot.Height,
            Stroke = ChartBrushes.Resolve(ElevationProfileRegistration.CursorBrushKey),
            StrokeThickness = 2,
            StrokeDashArray = new DoubleCollection { 4, 2 },
        };
        _plot.Children.Add(cursor);
    }

    private static TextBlock AxisLabel(string text, Brush brush) => new()
    {
        Text = text,
        FontSize = AxisFontSize,
        Foreground = brush,
    };

    private void OnPlotTapped(object sender, TappedRoutedEventArgs e)
    {
        int position = NearestPosition(e.GetPosition(_plot).X);
        if (position >= 0)
        {
            _viewModel.RequestSelect(position);
        }
    }

    private void OnPlotPointerMoved(object sender, PointerRoutedEventArgs e)
    {
        var display = _viewModel.Display;
        if (_xScale is not { } x || _yScale is not { } y || display.Points.Count == 0)
        {
            return;
        }

        Point pointer = e.GetCurrentPoint(_plot).Position;
        int position = NearestPosition(pointer.X);
        if (position < 0)
        {
            HideHover();
            return;
        }

        ChartPoint point = display.Points[position];
        double px = x.Map(point.X);
        double py = y.Map(point.Y);

        Canvas.SetLeft(_hoverMarker, px - (_hoverMarker.Width / 2));
        Canvas.SetTop(_hoverMarker, py - (_hoverMarker.Height / 2));
        _hoverMarker.Visibility = Visibility.Visible;

        _tooltipPrimary.Text = ChartPalette.FormatValue(point.X, 2, display.DistanceUnit);
        _tooltipSecondary.Text = $"{display.ElevationLabel}: {ChartPalette.FormatValue(point.Y, 0, "m")}";
        PositionTooltip(px, py);
        _tooltip.Visibility = Visibility.Visible;
    }

    private void OnPlotPointerExited(object sender, PointerRoutedEventArgs e) => HideHover();

    private void PositionTooltip(double anchorX, double anchorY)
    {
        _tooltip.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        double tipWidth = _tooltip.DesiredSize.Width;
        double tipHeight = _tooltip.DesiredSize.Height;

        double left = anchorX + 12;
        if (_plotRect.Width > 0 && left + tipWidth > _plotRect.X + _plotRect.Width)
        {
            left = anchorX - tipWidth - 12;
        }

        double top = anchorY - tipHeight - 8;
        if (top < _plotRect.Y)
        {
            top = anchorY + 8;
        }

        Canvas.SetLeft(_tooltip, Math.Max(0, left));
        Canvas.SetTop(_tooltip, Math.Max(0, top));
    }

    private void HideHover()
    {
        _tooltip.Visibility = Visibility.Collapsed;
        _hoverMarker.Visibility = Visibility.Collapsed;
    }

    // Maps a pointer X (in plot pixels) to the nearest sample position, or -1 when no chart is drawn.
    private int NearestPosition(double pointerX)
    {
        var points = _viewModel.Display.Points;
        if (_xScale is not { } x || points.Count == 0)
        {
            return -1;
        }

        int best = -1;
        double bestDistance = double.PositiveInfinity;
        for (int i = 0; i < points.Count; i++)
        {
            double delta = Math.Abs(x.Map(points[i].X) - pointerX);
            if (delta < bestDistance)
            {
                bestDistance = delta;
                best = i;
            }
        }

        return best;
    }

    private static double EstimateTextWidth(string text) => (text?.Length ?? 0) * (AxisFontSize * 0.6);
}
