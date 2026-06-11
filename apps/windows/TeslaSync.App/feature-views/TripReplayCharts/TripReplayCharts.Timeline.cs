using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native interactive Speed &amp; Power timeline renderer — the analogue of the web recharts
/// <c>AreaChart</c> in web/src/features/trips/components/TripReplayCharts.tsx: a speed <c>Area</c> on the
/// left axis plus a power <c>Area</c> (kW) on the right axis, each pre-normalized to its own ratio so it
/// occupies the full vertical range exactly as the web's two Y axes do, overlaid by a dashed playhead
/// reference line at the current replay index (web <c>&lt;ReferenceLine x={cursorTime} /&gt;</c>).
/// <para>
/// It reproduces the web's interaction model: pointer moves and taps (and Left / Right / Home / End keys for
/// keyboard users) write the hovered sample's <c>time</c> into the shared <see cref="CursorSync"/> group (web
/// <c>useSyncedCursor</c> + the chart's <c>onClick</c>); the owning view-model bridges that group back into a
/// seek (web <c>ChartCursorBridge</c>), advancing <see cref="CurrentIndex"/> and so moving the playhead. The
/// playhead is repositioned without rebuilding the area geometry. A spoken summary is published for
/// assistive technology.
/// </para>
/// </summary>
internal sealed partial class TripReplayTimelineChart : ContentControl
{
    private const double InsetLeft = 38;
    private const double InsetRight = 40;
    private const double InsetTop = 10;
    private const double InsetBottom = 20;
    private const double AxisLabelFontSize = 10;
    private const double AreaOpacity = 0.2;        // web Area fillOpacity (gradient ~0.3 → flat 0.2)
    private const double SpeedStroke = 2;          // web Area strokeWidth
    private const double PowerStroke = 2;
    private const double PlayheadStroke = 2;       // web ReferenceLine strokeWidth={2}
    private const int GridLineCount = 3;

    /// <summary>Design-token brush key for the speed series (web <c>CHART_COLORS[0]</c> cyan → semantic Speed).</summary>
    internal const string SpeedBrush = "TsChartSpeedBrush";

    /// <summary>Design-token brush key for the power series (web <c>CHART_COLORS[1]</c> violet → semantic Power).</summary>
    internal const string PowerBrush = "TsChartPowerBrush";

    private const string PlayheadBrushKey = "TsColorInfoBrush"; // web ReferenceLine stroke #00b4d8 cyan

    private readonly Canvas _plot = new();
    private readonly Canvas _overlay = new() { IsHitTestVisible = false };
    private readonly Grid _surface = new() { MinHeight = 160 };

    private readonly Line _playhead = new()
    {
        Stroke = DisplayTokens.Brush(PlayheadBrushKey),
        StrokeThickness = PlayheadStroke,
        StrokeDashArray = new DoubleCollection { 4, 2 },
        Visibility = Visibility.Collapsed,
    };

    private TripReplayTimelineModel _model = new(
        Array.Empty<TripReplayChartPoint>(), 1, 0, 0, "Speed", "Power", "km/h", "kW", string.Empty);
    private int _currentIndex;
    private ChartCursorSyncGroup? _cursorSync;

    public TripReplayTimelineChart()
    {
        IsTabStop = true;
        UseSystemFocusVisuals = true;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _overlay.Children.Add(_playhead);
        _surface.Children.Add(_plot);
        _surface.Children.Add(_overlay);
        Content = _surface;

        _surface.SizeChanged += (_, _) => RenderAll();
        _surface.PointerMoved += OnPointerMoved;
        _surface.PointerExited += OnPointerExited;
        Tapped += OnTapped;
        KeyDown += OnKeyDown;
    }

    /// <summary>The projected timeline; reassigning re-renders the areas and republishes the spoken summary.</summary>
    public TripReplayTimelineModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            AutomationProperties.SetName(this, value.AutomationName);
            RenderAll();
        }
    }

    /// <summary>The replay playhead index (web <c>currentIndex</c>); reassigning repositions the reference line.</summary>
    public int CurrentIndex
    {
        get => _currentIndex;
        set
        {
            if (_currentIndex == value)
            {
                return;
            }

            _currentIndex = value;
            PositionPlayhead();
        }
    }

    /// <summary>
    /// The shared cursor-sync group hover / click / keyboard seeks broadcast into (web <c>useSyncedCursor</c>).
    /// The owning view-model subscribes to it and bridges a position back into a seek.
    /// </summary>
    public ChartCursorSyncGroup? CursorSync
    {
        get => _cursorSync;
        set => _cursorSync = value;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TripReplayTimelineAutomationPeer(this);

    private double PlotWidth => Math.Max(0, _surface.ActualWidth - InsetLeft - InsetRight);

    private double PlotHeight => Math.Max(0, _surface.ActualHeight - InsetTop - InsetBottom);

    private void RenderAll()
    {
        double width = _surface.ActualWidth;
        double height = _surface.ActualHeight;
        _plot.Children.Clear();
        _plot.Width = width;
        _plot.Height = height;
        _overlay.Width = width;
        _overlay.Height = height;

        var points = _model.Points;
        double plotW = PlotWidth;
        double plotH = PlotHeight;
        if (width <= 0 || height <= 0 || plotW <= 0 || plotH <= 0 || points.Count == 0)
        {
            _playhead.Visibility = Visibility.Collapsed;
            return;
        }

        double baseline = InsetTop + plotH;
        DrawGrid(baseline, plotH, width);

        // Web parity draw order (back to front): speed area + stroke, then power area + stroke.
        var speed = MapSeries(points, plotW, plotH, baseline, SpeedRatio);
        DrawArea(speed, DisplayTokens.Brush(SpeedBrush), baseline);
        DrawLine(speed, DisplayTokens.Brush(SpeedBrush), SpeedStroke);

        var power = MapSeries(points, plotW, plotH, baseline, PowerRatio);
        DrawArea(power, DisplayTokens.Brush(PowerBrush), baseline);
        DrawLine(power, DisplayTokens.Brush(PowerBrush), PowerStroke);

        DrawAxisLabels(width, baseline);
        PositionPlayhead();
    }

    private double SpeedRatio(TripReplayChartPoint p) =>
        _model.SpeedAxisMax > 0 ? Math.Clamp(p.Speed / _model.SpeedAxisMax, 0.0, 1.0) : 0.0;

    private double PowerRatio(TripReplayChartPoint p)
    {
        double range = _model.PowerAxisMax - _model.PowerAxisMin;
        return range > 0 ? Math.Clamp((p.Power - _model.PowerAxisMin) / range, 0.0, 1.0) : 0.5;
    }

    private static List<PointD> MapSeries(
        IReadOnlyList<TripReplayChartPoint> points,
        double plotW,
        double plotH,
        double baseline,
        Func<TripReplayChartPoint, double> selector)
    {
        var pixels = new List<PointD>(points.Count);
        int n = points.Count;
        for (int i = 0; i < n; i++)
        {
            double ratio = selector(points[i]);
            double x = n == 1 ? InsetLeft + (plotW / 2) : InsetLeft + (plotW * i / (n - 1));
            double y = baseline - (ratio * plotH);
            pixels.Add(new PointD(x, y));
        }

        return pixels;
    }

    private void DrawArea(List<PointD> line, Brush brush, double baseline)
    {
        if (line.Count < 2)
        {
            return;
        }

        var area = new List<PointD>(line.Count + 2) { new(line[0].X, baseline) };
        area.AddRange(line);
        area.Add(new PointD(line[^1].X, baseline));

        var fill = ChartShapes.Polygon(area, brush);
        fill.Opacity = AreaOpacity;
        _plot.Children.Add(fill);
    }

    private void DrawLine(List<PointD> line, Brush brush, double thickness)
    {
        if (line.Count == 0)
        {
            return;
        }

        if (line.Count == 1)
        {
            var dot = new Ellipse { Width = 4, Height = 4, Fill = brush };
            Canvas.SetLeft(dot, line[0].X - 2);
            Canvas.SetTop(dot, line[0].Y - 2);
            _plot.Children.Add(dot);
            return;
        }

        _plot.Children.Add(ChartShapes.Polyline(line, brush, thickness));
    }

    private void DrawGrid(double baseline, double plotH, double width)
    {
        double right = width - InsetRight;
        for (int i = 1; i <= GridLineCount; i++)
        {
            double y = baseline - (plotH * i / (GridLineCount + 1));
            _plot.Children.Add(new Line
            {
                X1 = InsetLeft,
                X2 = right,
                Y1 = y,
                Y2 = y,
                Stroke = ChartBrushes.Border,
                StrokeThickness = 0.5,
                Opacity = 0.35,
            });
        }

        _plot.Children.Add(new Line
        {
            X1 = InsetLeft,
            X2 = right,
            Y1 = baseline,
            Y2 = baseline,
            Stroke = ChartBrushes.Border,
            StrokeThickness = 0.5,
            Opacity = 0.6,
        });
    }

    private void DrawAxisLabels(double width, double baseline)
    {
        // Left "speed" axis (web left YAxis, label = speedUnit) anchored at zero; right "power" axis
        // (web right YAxis, label = kW) across its min..max so regen stays visible.
        AddAxisLabel(_model.SpeedUnitLabel, 2, InsetTop - 2);
        AddAxisLabel(TripReplayChartsProjection.FormatAxisLabel(_model.SpeedAxisMax), 2, InsetTop + 10);
        AddAxisLabel("0", 2, baseline - 6);

        double rightX = width - InsetRight + 2;
        AddAxisLabel(_model.PowerUnitLabel, rightX, InsetTop - 2);
        AddAxisLabel(TripReplayChartsProjection.FormatAxisLabel(_model.PowerAxisMax), rightX, InsetTop + 10);
        AddAxisLabel(TripReplayChartsProjection.FormatAxisLabel(_model.PowerAxisMin), rightX, baseline - 6);
    }

    private void AddAxisLabel(string text, double left, double top)
    {
        var label = new TextBlock
        {
            Text = text,
            FontSize = AxisLabelFontSize,
            Foreground = DisplayTokens.TextMuted,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
        Canvas.SetLeft(label, left);
        Canvas.SetTop(label, Math.Max(0, top));
        _plot.Children.Add(label);
    }

    private void PositionPlayhead()
    {
        var points = _model.Points;
        double plotW = PlotWidth;
        double plotH = PlotHeight;
        if (points.Count == 0 || plotW <= 0 || plotH <= 0)
        {
            _playhead.Visibility = Visibility.Collapsed;
            return;
        }

        int index = Math.Clamp(_currentIndex, 0, points.Count - 1);
        double x = XForIndex(index, points.Count, plotW);
        _playhead.X1 = x;
        _playhead.X2 = x;
        _playhead.Y1 = InsetTop;
        _playhead.Y2 = InsetTop + plotH;
        _playhead.Visibility = Visibility.Visible;
    }

    private static double XForIndex(int index, int count, double plotW) =>
        count <= 1 ? InsetLeft + (plotW / 2) : InsetLeft + (plotW * index / (count - 1));

    private void OnPointerMoved(object sender, PointerRoutedEventArgs e)
    {
        double px = e.GetCurrentPoint(_surface).Position.X;
        BroadcastNearest(px);
    }

    private void OnPointerExited(object sender, PointerRoutedEventArgs e) => _cursorSync?.Clear();

    private void OnTapped(object sender, TappedRoutedEventArgs e)
    {
        // Web parity: the chart's onClick seeks to the clicked sample. Focus first so keyboard seeking follows.
        Focus(FocusState.Programmatic);
        double px = e.GetPosition(_surface).X;
        BroadcastNearest(px);
    }

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        var points = _model.Points;
        if (points.Count == 0)
        {
            return;
        }

        int last = points.Count - 1;
        int next = e.Key switch
        {
            Windows.System.VirtualKey.Left => _currentIndex - 1,
            Windows.System.VirtualKey.Right => _currentIndex + 1,
            Windows.System.VirtualKey.Home => 0,
            Windows.System.VirtualKey.End => last,
            _ => int.MinValue,
        };

        if (next == int.MinValue)
        {
            return;
        }

        int clamped = Math.Clamp(next, 0, last);
        _cursorSync?.SetCursor(points[clamped].Time);
        e.Handled = true;
    }

    private void BroadcastNearest(double pointerX)
    {
        var points = _model.Points;
        double plotW = PlotWidth;
        if (points.Count == 0 || plotW <= 0 || _cursorSync is null)
        {
            return;
        }

        double frac = Math.Clamp((pointerX - InsetLeft) / plotW, 0.0, 1.0);
        int index = points.Count == 1 ? 0 : (int)Math.Round(frac * (points.Count - 1), MidpointRounding.AwayFromZero);
        index = Math.Clamp(index, 0, points.Count - 1);
        _cursorSync.SetCursor(points[index].Time);
    }

    private sealed class TripReplayTimelineAutomationPeer(TripReplayTimelineChart owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Image;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            if (!string.IsNullOrEmpty(name))
            {
                return name;
            }

            var model = ((TripReplayTimelineChart)Owner).Model;
            return string.IsNullOrEmpty(model.AutomationName)
                ? string.Format(CultureInfo.CurrentCulture, "{0}, {1}", model.SpeedSeriesName, model.PowerSeriesName)
                : model.AutomationName;
        }
    }
}
