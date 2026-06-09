using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Drive Overview feature surface — a parity port of
/// web/src/features/driving/components/drive-detail/DriveOverviewChart.tsx. It reproduces the web
/// <c>ChartContainer</c> chrome (title "Drive Overview" + accessible summary) wrapping a composed drive
/// trace — a speed <c>Area</c>, the optional dashed ideal / estimated range <c>Line</c>s, the SOC and
/// optional usable-SOC <c>Line</c>s on a shared left axis, and a power <c>Line</c> on a right axis — plus the
/// rich Mean / Max / Min legend beneath it. The web component is a pure child of the Drive-Detail page that
/// draws an empty "No telemetry data available" placeholder for a trace of one sample or fewer; the native
/// feature-view owns its cache-then-network drive-telemetry read and therefore renders every state the P2
/// contract mandates — a loading skeleton, the populated chart, that friendly empty surface, an explicit
/// retry surface on hard failure, plus stale and offline freshness chips. All data flows through the shared
/// <see cref="DriveOverviewChartViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class DriveOverviewChart : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double ChartHeight = 360;        // web ChartContainer height={360}
    private const double FadeInDelayMs = 150;
    private const double LegendSwatchWidth = 16;
    private const double LegendFontSize = 12;

    private readonly DriveOverviewChartViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DriveOverviewChartDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsFadeIn _fade = new() { DelayMs = (int)FadeInDelayMs };
    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new() { Spacing = 16 };
    private readonly Grid _header = new();
    private readonly StackPanel _heading = new() { Spacing = 2 };
    private readonly SectionTitle _title = new();
    private readonly StackPanel _actions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsBadge _freshnessChip = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _freshnessChipText = new() { FontSize = LegendFontSize };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refresh = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, (optional) diagnostics and units.</summary>
    /// <param name="source">The cache-then-network drive-telemetry source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink; a private collector is used when null.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public DriveOverviewChart(
        IDriveOverviewChartSource source,
        ILocalizer localizer,
        DriveOverviewChartDiagnostics? diagnostics = null,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new DriveOverviewChartDiagnostics();
        _viewModel = new DriveOverviewChartViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _refresh.Click += OnRefreshClick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _fade;
        Render();
    }

    /// <summary>The canonical surface id (<c>drive-overview-chart</c>).</summary>
    public static string SurfaceId => DriveOverviewChartRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public DriveOverviewChartViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DriveOverviewChartSource"/> from the
    /// shared data layer (the host's P2-core dependencies), scoped to an explicit <paramref name="driveId"/>
    /// (the Drive-Detail route) or — when null — the newest drive of the <paramref name="vehicleId"/> /
    /// primary vehicle.
    /// </summary>
    public static DriveOverviewChart Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        long? driveId = null,
        DriveOverviewChartDiagnostics? diagnostics = null,
        UnitPref? units = null)
    {
        var source = new DriveOverviewChartSource(vehicles, api, engine, options, vehicleId, driveId);
        return new DriveOverviewChart(source, localizer, diagnostics, units);
    }

    private void BuildChrome()
    {
        _heading.Children.Add(_title);

        _freshnessChip.Content = _freshnessChipText;

        _actions.Children.Add(_freshnessChip);
        _actions.Children.Add(_freshness);
        _actions.Children.Add(_refresh);

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_heading, 0);
        Grid.SetColumn(_actions, 1);
        _header.Children.Add(_heading);
        _header.Children.Add(_actions);

        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        _panel.Padding = new Thickness(16);
        _panel.Content = _root;
        _fade.Content = _panel;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _refresh.Click -= OnRefreshClick;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
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
        Render();
    }

    private void Render()
    {
        var display = _viewModel.Display;
        var state = _viewModel.State;

        _title.Value = display.Title;
        AutomationProperties.SetName(this, display.Title);

        UpdateFreshness(state);
        _bodyHost.Child = BuildBody(display, state);
    }

    private void UpdateFreshness(DriveOverviewChartState state)
    {
        bool showActions = state is not (DriveOverviewChartState.Loading or DriveOverviewChartState.Error);
        _actions.Visibility = showActions ? Visibility.Visible : Visibility.Collapsed;
        if (!showActions)
        {
            return;
        }

        bool stale = state == DriveOverviewChartState.Stale;
        bool offline = state == DriveOverviewChartState.Offline;
        if (stale || offline)
        {
            _freshnessChip.Visibility = Visibility.Visible;
            _freshnessChip.Status = offline ? StatusKind.Danger : StatusKind.Warning;
            _freshnessChipText.Text = offline ? _viewModel.OfflineChip : _viewModel.StaleChip;
            AutomationProperties.SetName(_freshnessChip, _freshnessChipText.Text);
        }
        else
        {
            _freshnessChip.Visibility = Visibility.Collapsed;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = offline;
        AutomationProperties.SetName(_refresh, _viewModel.RefreshLabel);
    }

    private UIElement BuildBody(DriveOverviewChartDisplay display, DriveOverviewChartState state) => state switch
    {
        DriveOverviewChartState.Loading => BuildLoading(),
        DriveOverviewChartState.Error => BuildError(),
        DriveOverviewChartState.Empty => BuildEmpty(),
        _ => BuildChart(display),
    };

    private StackPanel BuildLoading()
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(new TsSkeleton { BlockHeight = ChartHeight });
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        AutomationProperties.SetName(stack, _viewModel.LoadingLabel);
        return stack;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.ErrorTitle,
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private StackPanel BuildChart(DriveOverviewChartDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };

        var chart = new DriveOverviewComposedChart
        {
            Model = display.Chart,
            MinHeight = ChartHeight,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        AutomationProperties.SetName(chart, display.ChartAriaLabel);

        content.Children.Add(chart);
        content.Children.Add(BuildLegend(display.Legend));
        return content;
    }

    private StackPanel BuildLegend(IReadOnlyList<DriveOverviewLegendItem> legend)
    {
        var stack = new StackPanel { Spacing = 6 };
        string meanLabel = _localizer.GetString("driveDetail.stat.mean", "Mean");
        string maxLabel = _localizer.GetString("driveDetail.stat.max", "Max");
        string minLabel = _localizer.GetString("driveDetail.stat.min", "Min");

        foreach (var item in legend)
        {
            stack.Children.Add(BuildLegendRow(item, meanLabel, maxLabel, minLabel));
        }

        return stack;
    }

    private static StackPanel BuildLegendRow(
        DriveOverviewLegendItem item, string meanLabel, string maxLabel, string minLabel)
    {
        var brush = DisplayTokens.Brush(item.ColorBrushKey);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var swatch = new Line
        {
            X1 = 0,
            X2 = LegendSwatchWidth,
            Y1 = 0,
            Y2 = 0,
            Stroke = brush,
            StrokeThickness = 2,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (item.Dashed)
        {
            swatch.StrokeDashArray = new DoubleCollection { 4, 2 };
        }

        AutomationProperties.SetAccessibilityView(swatch, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = item.Label,
            FontSize = LegendFontSize,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = brush,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(swatch);
        row.Children.Add(label);
        row.Children.Add(StatText($"{meanLabel}: {item.Mean}"));
        row.Children.Add(StatText($"{maxLabel}: {item.Max}"));
        row.Children.Add(StatText($"{minLabel}: {item.Min}"));

        AutomationProperties.SetName(row, item.AutomationName);
        return row;
    }

    private static TextBlock StatText(string text) => new()
    {
        Text = text,
        FontSize = LegendFontSize,
        Foreground = DisplayTokens.TextMuted,
        VerticalAlignment = VerticalAlignment.Center,
    };

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DriveOverviewChartAutomationPeer(this);

    private sealed class DriveOverviewChartAutomationPeer(DriveOverviewChart owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((DriveOverviewChart)Owner).ViewModel.Title
                : name;
        }
    }

    /// <summary>
    /// The native dual-axis drive-overview renderer — the analogue of the web recharts <c>ComposedChart</c>:
    /// a speed <c>Area</c> + dashed ideal / est range <c>Line</c>s + a SOC <c>Line</c> + optional usable-SOC
    /// <c>Line</c> on the shared left axis, plus a power <c>Line</c> on the right axis. Each series is plotted
    /// against its own pre-normalized ratio so it occupies the full vertical range exactly as the web's two Y
    /// axes do. Null samples are skipped and the curve connects across the gap (web <c>connectNulls</c>).
    /// Pixel geometry is recomputed on every resize; the spoken summary is published for assistive
    /// technology.
    /// </summary>
    private sealed partial class DriveOverviewComposedChart : ContentControl
    {
        private const double InsetLeft = 36;
        private const double InsetRight = 40;
        private const double InsetTop = 8;
        private const double InsetBottom = 18;
        private const double AxisLabelFontSize = 10;

        private readonly Canvas _canvas = new();
        private DriveOverviewChartModel _model = new(
            Array.Empty<DriveOverviewChartPoint>(), false, false, false,
            "Speed", "Range (ideal)", "Range (est.)", "SOC", "Usable SOC", "Power",
            "0", "0", "0", string.Empty);

        public DriveOverviewComposedChart()
        {
            IsTabStop = false;
            HorizontalContentAlignment = HorizontalAlignment.Stretch;
            VerticalContentAlignment = VerticalAlignment.Stretch;
            Content = _canvas;
            SizeChanged += (_, _) => Render();
        }

        /// <summary>The projected chart model; reassigning re-renders and republishes the spoken summary.</summary>
        public DriveOverviewChartModel Model
        {
            get => _model;
            set
            {
                _model = value;
                AutomationProperties.SetName(this, value.AutomationName);
                Render();
            }
        }

        private void Render()
        {
            double width = ActualWidth;
            double height = ActualHeight;
            _canvas.Children.Clear();
            _canvas.Width = width;
            _canvas.Height = height;

            var points = _model.Points;
            if (width <= 0 || height <= 0 || points.Count == 0)
            {
                return;
            }

            double plotW = width - InsetLeft - InsetRight;
            double plotH = height - InsetTop - InsetBottom;
            if (plotW <= 0 || plotH <= 0)
            {
                return;
            }

            double baseline = InsetTop + plotH;
            DrawBaseline(baseline, width);

            // Web parity draw order (back to front): speed area, ideal range, est range, SOC, usable SOC, power.
            var speedPixels = MapSeries(points, plotW, plotH, baseline, p => p.SpeedRatio);
            DrawArea(speedPixels, DisplayTokens.Brush(DriveOverviewChartProjection.SpeedBrushKey), baseline, 0.12);
            DrawLine(speedPixels, DisplayTokens.Brush(DriveOverviewChartProjection.SpeedBrushKey), dashed: false, thickness: 1.5);

            if (_model.HasIdealRange)
            {
                var ideal = MapSeries(points, plotW, plotH, baseline, p => p.IdealRangeRatio);
                DrawLine(ideal, DisplayTokens.Brush(DriveOverviewChartProjection.IdealRangeBrushKey), dashed: true, thickness: 1);
            }

            if (_model.HasEstRange)
            {
                var est = MapSeries(points, plotW, plotH, baseline, p => p.EstRangeRatio);
                DrawLine(est, DisplayTokens.Brush(DriveOverviewChartProjection.EstRangeBrushKey), dashed: true, thickness: 1);
            }

            var soc = MapSeries(points, plotW, plotH, baseline, p => p.SocRatio);
            DrawLine(soc, DisplayTokens.Brush(DriveOverviewChartProjection.SocBrushKey), dashed: false, thickness: 1.5);

            if (_model.HasUsableSoc)
            {
                var usable = MapSeries(points, plotW, plotH, baseline, p => p.UsableSocRatio);
                DrawLine(usable, DisplayTokens.Brush(DriveOverviewChartProjection.UsableSocBrushKey), dashed: false, thickness: 1);
            }

            var power = MapSeries(points, plotW, plotH, baseline, p => p.PowerRatio);
            DrawLine(power, DisplayTokens.Brush(DriveOverviewChartProjection.PowerBrushKey), dashed: false, thickness: 1.5);

            DrawAxisLabels(width, baseline);
        }

        private static List<PointD> MapSeries(
            IReadOnlyList<DriveOverviewChartPoint> points,
            double plotW,
            double plotH,
            double baseline,
            Func<DriveOverviewChartPoint, double?> selector)
        {
            var pixels = new List<PointD>(points.Count);
            int n = points.Count;
            for (int i = 0; i < n; i++)
            {
                if (selector(points[i]) is not { } ratio)
                {
                    // Web connectNulls: skip the gap and connect adjacent non-null samples.
                    continue;
                }

                double x = n == 1 ? InsetLeft + (plotW / 2) : InsetLeft + (plotW * i / (n - 1));
                double y = baseline - (ratio * plotH);
                pixels.Add(new PointD(x, y));
            }

            return pixels;
        }

        private void DrawArea(List<PointD> line, Brush brush, double baseline, double opacity)
        {
            if (line.Count == 0)
            {
                return;
            }

            var area = new List<PointD>(line.Count + 2)
            {
                new(line[0].X, baseline),
            };
            area.AddRange(line);
            area.Add(new PointD(line[^1].X, baseline));

            var fill = ChartShapes.Polygon(area, brush);
            fill.Opacity = opacity;
            _canvas.Children.Add(fill);
        }

        private void DrawLine(List<PointD> line, Brush brush, bool dashed, double thickness)
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
                _canvas.Children.Add(dot);
                return;
            }

            var polyline = ChartShapes.Polyline(line, brush, thickness);
            if (dashed)
            {
                polyline.StrokeDashArray = new DoubleCollection { 4, 2 };
            }

            _canvas.Children.Add(polyline);
        }

        private void DrawBaseline(double baseline, double width)
        {
            _canvas.Children.Add(new Line
            {
                X1 = InsetLeft,
                X2 = width - InsetRight,
                Y1 = baseline,
                Y2 = baseline,
                Stroke = DisplayTokens.Border,
                StrokeThickness = 0.5,
                Opacity = 0.6,
            });
        }

        private void DrawAxisLabels(double width, double baseline)
        {
            // Left "speed" axis bound (web left YAxis domain [0, dataMax]) and right power-axis bounds
            // (web right YAxis spanning zero, unit kW).
            AddAxisLabel(_model.LeftAxisMaxLabel, 2, InsetTop - 2);
            AddAxisLabel("0", 2, baseline - 6);
            AddAxisLabel(_model.PowerAxisMaxLabel, width - InsetRight + 2, InsetTop - 2);
            AddAxisLabel(_model.PowerAxisMinLabel, width - InsetRight + 2, baseline - 6);
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
            _canvas.Children.Add(label);
        }
    }
}
