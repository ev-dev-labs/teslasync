using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>FSMTimelineChart</c> feature surface — a parity port of
/// web/src/features/system/components/FSMTimelineChart.tsx. It is a pure presentational control: assign a
/// <see cref="Model"/> (the web <c>transitions</c> / <c>hours</c> / <c>emptyMessage</c> props) and it renders
/// exactly one of the two web branches inside a translucent <see cref="TsGlassPanel"/> (the native analogue of
/// the web <c>ChartContainer</c>) — <see cref="FSMTimelineChartState.Ready"/> (the stacked-area timeline: one
/// soft, non-overlapping band per FSM <c>fsm_name</c>, stacked bottom-to-top over the local <c>HH:mm</c> time
/// axis, with a count Y axis and grid, the native analogue of the recharts stacked <c>AreaChart</c> with its
/// per-type <c>stackId="1"</c> areas) or <see cref="FSMTimelineChartState.Empty"/> (the web <c>EmptyState</c>
/// with the parent's range message or the localized <c>fsm.noTimelineData</c> fallback). The title renders in
/// BOTH branches so the panel is never a blank box. Mirroring the web <c>chart-a11y:no-table</c> marker the
/// surface exposes its data through a spoken summary and per-bucket Narrator names rather than a tabular
/// fallback (the transition list view on the parent page holds the per-row detail). The view never performs
/// HTTP; all bucketing, label resolution and formatting happen in the WinUI-free
/// <see cref="FSMTimelineChartProjection"/>. Every string resolves through the i18n facade and the surface plus
/// every bucket carry a Narrator name.
/// </summary>
public sealed partial class FSMTimelineChart : ContentControl
{
    // web ChartContainer `p-4` — the 16px inset.
    private const double PanelPadding = 16;

    // web `<ResponsiveContainer height={220}>` inside the height-260 ChartContainer.
    private const double ChartHeight = 220;

    // Segoe Fluent "Activity" glyph — the native stand-in for the web EmptyState icon, matching the
    // chart-empty-state convention used by the sibling chart surfaces.
    private const string ActivityGlyph = "\uE9D2";

    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly FSMTimelineChartDiagnostics _diagnostics;

    private FSMTimelineChartModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, optional diagnostics and clock.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="FSMTimelineChartModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">The reference clock the window is measured back from (web <c>Date.now()</c>); defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public FSMTimelineChart(
        ILocalizer localizer,
        FSMTimelineChartModel? model = null,
        FSMTimelineChartDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? FSMTimelineChartModel.Empty;
        _diagnostics = diagnostics ?? new FSMTimelineChartDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>FSMTimelineChart</c>).</summary>
    public static string Slug => FSMTimelineChartRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public FSMTimelineChartModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        FSMTimelineChartDisplay display = FSMTimelineChartProjection.Project(_model, _localizer, _clock());

        UIElement surface = display.State switch
        {
            FSMTimelineChartState.Ready => BuildReady(display),
            _ => BuildEmpty(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Ready (web fall-through: the ChartContainer title + the stacked AreaChart) ────────────────────────
    private static TsGlassPanel BuildReady(FSMTimelineChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(new PanelTitle { Value = display.Title });

        var chart = new StackedAreaTimeline
        {
            Display = display,
            MinHeight = ChartHeight,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(chart, display.AriaLabel);
        stack.Children.Add(chart);

        return Box(stack, display.AutomationName);
    }

    // ── Empty (web: buckets.length === 0 → EmptyState message={emptyMessage ?? t('fsm.noTimelineData')}) ──
    private static TsGlassPanel BuildEmpty(FSMTimelineChartDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(new PanelTitle { Value = display.Title });
        stack.Children.Add(new TsEmptyState
        {
            IconGlyph = ActivityGlyph,
            Message = display.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return Box(stack, display.AutomationName);
    }

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, automationName);
        AutomationProperties.SetAccessibilityView(panel, AccessibilityView.Content);
        return panel;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new FSMTimelineChartAutomationPeer(this);

    private sealed class FSMTimelineChartAutomationPeer(FSMTimelineChart owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((FSMTimelineChart)Owner)._model.EmptyMessageOverride ?? FSMTimelineChartRegistration.Slug
                : name;
        }
    }

    /// <summary>
    /// The stacked-area plotting surface — the native analogue of the web recharts stacked <c>AreaChart</c>. It
    /// draws a tokenized count grid and Y/X axes, then one soft band per FSM type stacked bottom-to-top: each
    /// band is the filled region between its running lower and upper cumulative totals (so the bands never
    /// overlap and each keeps its own categorical palette colour at the web's <c>fillOpacity={0.3}</c>), topped
    /// by a full-strength stroke (the web <c>stroke={CHART_COLORS[i]}</c>). It redraws on resize and reuses the
    /// shared chart geometry / palette / shape primitives, so axis math and colours stay token-driven and
    /// theme-aware. A spoken summary is published for assistive technology and every bucket carries a tooltip +
    /// Narrator name. Degenerate inputs (a single bucket, an all-zero window) render without throwing.
    /// </summary>
    private sealed class StackedAreaTimeline : ContentControl
    {
        private const double GridStrokeThickness = 0.5;
        private const double BandStrokeThickness = 2;
        private const double BandFillOpacity = 0.3;
        private const double AxisFontSize = 11;
        private const int MaxXLabels = 8;
        private const double SingleBucketHalfWidth = 24;

        private static readonly EdgeInsets PlotInsets = new(40, 8, 12, 22);

        private readonly Grid _surface = new() { MinHeight = 160 };
        private readonly Canvas _canvas = new();

        private FSMTimelineChartDisplay? _display;

        public StackedAreaTimeline()
        {
            IsTabStop = false;
            HorizontalContentAlignment = HorizontalAlignment.Stretch;
            VerticalContentAlignment = VerticalAlignment.Stretch;

            _surface.Children.Add(_canvas);
            Content = _surface;
            _surface.SizeChanged += (_, _) => Render();
        }

        /// <summary>The projected display to plot; reassigning redraws the surface.</summary>
        public FSMTimelineChartDisplay? Display
        {
            get => _display;
            set
            {
                _display = value;
                Render();
            }
        }

        private void Render()
        {
            _canvas.Children.Clear();

            double width = _surface.ActualWidth;
            double height = _surface.ActualHeight;
            _canvas.Width = width;
            _canvas.Height = height;

            if (_display is not { } display || width <= 0 || height <= 0
                || display.Buckets.Count == 0 || display.FsmTypes.Count == 0)
            {
                return;
            }

            RectD plot = ChartGeometry.PlotArea(width, height, PlotInsets);
            if (plot.Width <= 0 || plot.Height <= 0)
            {
                return;
            }

            int bucketCount = display.Buckets.Count;
            double maxY = Math.Max(1, display.MaxTotal);
            var yScale = new LinearScale(0, maxY, plot.Y + plot.Height, plot.Y);
            var xScale = new LinearScale(0, Math.Max(1, bucketCount - 1), plot.X, plot.X + plot.Width);

            DrawGridAndYAxis(plot, yScale);

            double[] xs = BuildXPositions(plot, xScale, bucketCount);
            DrawBands(display, xs, yScale);
            DrawXAxis(display, xs, plot, bucketCount);

            AutomationProperties.SetName(_canvas, display.AriaLabel);
        }

        private static double[] BuildXPositions(RectD plot, LinearScale xScale, int bucketCount)
        {
            if (bucketCount == 1)
            {
                // A lone bucket has no horizontal extent to sweep an area across, so it renders as a centred
                // column whose two edges give the band polygons a finite width.
                double centre = plot.X + (plot.Width / 2);
                double half = Math.Min(plot.Width * 0.3, SingleBucketHalfWidth);
                return [centre - half, centre + half];
            }

            var xs = new double[bucketCount];
            for (int b = 0; b < bucketCount; b++)
            {
                xs[b] = xScale.Map(b);
            }

            return xs;
        }

        private void DrawGridAndYAxis(RectD plot, LinearScale yScale)
        {
            var seen = new HashSet<long>();
            foreach (double rawTick in yScale.Ticks(5))
            {
                // Web parity: `<YAxis allowDecimals={false} />` — counts are whole numbers.
                long tick = (long)Math.Round(rawTick, MidpointRounding.AwayFromZero);
                if (tick < 0 || tick > yScale.DomainMax || !seen.Add(tick))
                {
                    continue;
                }

                double py = yScale.Map(tick);
                _canvas.Children.Add(new Line
                {
                    X1 = plot.X,
                    X2 = plot.X + plot.Width,
                    Y1 = py,
                    Y2 = py,
                    Stroke = ChartBrushes.Border,
                    StrokeThickness = GridStrokeThickness,
                    Opacity = 0.5,
                });

                var label = new TextBlock
                {
                    Text = tick.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    Foreground = ChartBrushes.TextMuted,
                    FontSize = AxisFontSize,
                };
                AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
                Canvas.SetLeft(label, 2);
                Canvas.SetTop(label, py - 8);
                _canvas.Children.Add(label);
            }
        }

        private void DrawBands(FSMTimelineChartDisplay display, double[] xs, LinearScale yScale)
        {
            int bucketCount = display.Buckets.Count;
            int edges = xs.Length;
            var lower = new long[bucketCount];

            for (int t = 0; t < display.FsmTypes.Count; t++)
            {
                var upper = new long[bucketCount];
                for (int b = 0; b < bucketCount; b++)
                {
                    upper[b] = lower[b] + display.Buckets[b].Counts[t];
                }

                Brush brush = ChartBrushes.ForIndex(display.SeriesColorIndices[t]);

                var top = new List<PointD>(edges);
                var polygon = new List<PointD>(edges * 2);
                for (int k = 0; k < edges; k++)
                {
                    int b = bucketCount == 1 ? 0 : k;
                    var point = new PointD(xs[k], yScale.Map(upper[b]));
                    top.Add(point);
                    polygon.Add(point);
                }

                for (int k = edges - 1; k >= 0; k--)
                {
                    int b = bucketCount == 1 ? 0 : k;
                    polygon.Add(new PointD(xs[k], yScale.Map(lower[b])));
                }

                Polygon fill = ChartShapes.Polygon(polygon, brush);
                fill.Opacity = BandFillOpacity;
                _canvas.Children.Add(fill);
                _canvas.Children.Add(ChartShapes.Polyline(top, brush, BandStrokeThickness));

                lower = upper;
            }
        }

        private void DrawXAxis(FSMTimelineChartDisplay display, double[] xs, RectD plot, int bucketCount)
        {
            int step = Math.Max(1, (int)Math.Ceiling(bucketCount / (double)MaxXLabels));
            double labelTop = plot.Y + plot.Height + 4;

            for (int b = 0; b < bucketCount; b += step)
            {
                double x = bucketCount == 1 ? plot.X + (plot.Width / 2) : xs[b];
                var label = new TextBlock
                {
                    Text = display.Buckets[b].TimeLabel,
                    Foreground = ChartBrushes.TextMuted,
                    FontSize = AxisFontSize,
                    TextAlignment = TextAlignment.Center,
                };
                AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
                ToolTipService.SetToolTip(label, display.Buckets[b].AutomationName);
                Canvas.SetLeft(label, x - 16);
                Canvas.SetTop(label, labelTop);
                _canvas.Children.Add(label);
            }
        }
    }
}
