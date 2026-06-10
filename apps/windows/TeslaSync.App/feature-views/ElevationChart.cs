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
/// The native WinUI 3 Elevation Profile feature surface — a parity port of
/// web/src/features/driving/components/drive-detail/ElevationChart.tsx. It reproduces the web
/// <c>ChartContainer</c> chrome (title "Elevation Profile" + accessible summary) wrapping the gain / loss /
/// net stat row and a composed trace — an elevation <c>Area</c> on a left axis plus a speed <c>Line</c> on a
/// right axis — beneath a two-series legend. The web component is a pure child of the Drive-Detail page that
/// draws an empty "No telemetry data available" surface for a trace of one sample or fewer; the native
/// feature-view owns its cache-then-network drive-telemetry read and therefore renders every state the P2
/// contract mandates — a loading skeleton, the populated chart, that friendly empty surface, an explicit
/// retry surface on hard failure, plus stale and offline freshness chips. All data flows through the shared
/// <see cref="ElevationChartViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class ElevationChart : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";  // Segoe Fluent — Refresh
    private const string GainGlyph = "\uE74A";     // Segoe Fluent — Up (web ArrowUpRight)
    private const string LossGlyph = "\uE74B";     // Segoe Fluent — Down (web ArrowDownRight)
    private const double ChartHeight = 220;        // web ChartContainer height={220}
    private const double FadeInDelayMs = 150;
    private const double LegendSwatchWidth = 16;
    private const double StatFontSize = 12;        // web text-xs
    private const double LegendFontSize = 12;

    private readonly ElevationChartViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ElevationChartDiagnostics _diagnostics;
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
    public ElevationChart(
        IElevationChartSource source,
        ILocalizer localizer,
        ElevationChartDiagnostics? diagnostics = null,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ElevationChartDiagnostics();
        _viewModel = new ElevationChartViewModel(source, localizer, units);
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

    /// <summary>The canonical surface id (<c>elevation-chart</c>).</summary>
    public static string SurfaceId => ElevationChartRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public ElevationChartViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ElevationChartSource"/> from the shared
    /// data layer (the host's P2-core dependencies), scoped to an explicit <paramref name="driveId"/> (the
    /// Drive-Detail route) or — when null — the newest drive of the <paramref name="vehicleId"/> / primary
    /// vehicle.
    /// </summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle when no drive id is supplied.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="vehicleId">An explicit vehicle id; null uses the primary cached vehicle.</param>
    /// <param name="driveId">An explicit drive id (the Drive-Detail route); null resolves the newest drive.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink; a private collector is used when null.</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    public static ElevationChart Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        long? driveId = null,
        ElevationChartDiagnostics? diagnostics = null,
        UnitPref? units = null)
    {
        var source = new ElevationChartSource(vehicles, api, engine, options, vehicleId, driveId);
        return new ElevationChart(source, localizer, diagnostics, units);
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

    private void UpdateFreshness(ElevationChartState state)
    {
        bool showActions = state is not (ElevationChartState.Loading or ElevationChartState.Error);
        _actions.Visibility = showActions ? Visibility.Visible : Visibility.Collapsed;
        if (!showActions)
        {
            return;
        }

        bool stale = state == ElevationChartState.Stale;
        bool offline = state == ElevationChartState.Offline;
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

    private UIElement BuildBody(ElevationChartDisplay display, ElevationChartState state) => state switch
    {
        ElevationChartState.Loading => BuildLoading(),
        ElevationChartState.Error => BuildError(),
        ElevationChartState.Empty => BuildEmpty(),
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

    private static StackPanel BuildChart(ElevationChartDisplay display)
    {
        var content = new StackPanel { Spacing = 8 };
        content.Children.Add(BuildStatsRow(display));

        var chart = new ElevationComposedChart
        {
            Model = display.Chart,
            MinHeight = ChartHeight,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        AutomationProperties.SetName(chart, display.ChartAriaLabel);

        content.Children.Add(chart);
        content.Children.Add(BuildLegend(display.Chart));
        return content;
    }

    // Web: the gain / loss / net row above the chart (text-green-400 / text-red-400 / text-muted).
    private static StackPanel BuildStatsRow(ElevationChartDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var stats = display.Stats;
        row.Children.Add(StatChip(GainGlyph, $"{stats.GainText} {display.GainLabel}", DisplayTokens.Brush(ElevationChartProjection.ElevationBrushKey)));
        row.Children.Add(StatChip(LossGlyph, $"{stats.LossText} {display.LossLabel}", DisplayTokens.Brush("TsColorDangerBrush")));
        row.Children.Add(StatText($"{display.NetLabel}: {stats.NetText}", DisplayTokens.TextMuted));

        AutomationProperties.SetName(
            row,
            string.Format(
                CultureInfo.CurrentCulture,
                "{0} {1}, {2} {3}, {4} {5}",
                display.GainLabel, stats.GainText, display.LossLabel, stats.LossText, display.NetLabel, stats.NetText));
        return row;
    }

    private static StackPanel StatChip(string glyph, string text, Brush brush)
    {
        var chip = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon { Glyph = glyph, FontSize = StatFontSize, Foreground = brush };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        chip.Children.Add(icon);
        chip.Children.Add(StatText(text, brush));
        return chip;
    }

    private static TextBlock StatText(string text, Brush brush) => new()
    {
        Text = text,
        FontSize = StatFontSize,
        Foreground = brush,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // Web: the recharts <Legend> auto-generated from the two series names + colours.
    private static StackPanel BuildLegend(ElevationChartModel chart)
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        legend.Children.Add(LegendItem(chart.ElevationSeriesName, DisplayTokens.Brush(ElevationChartProjection.ElevationBrushKey)));
        legend.Children.Add(LegendItem(chart.SpeedSeriesName, DisplayTokens.Brush(ElevationChartProjection.SpeedBrushKey)));
        return legend;
    }

    private static StackPanel LegendItem(string label, Brush brush)
    {
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
        AutomationProperties.SetAccessibilityView(swatch, AccessibilityView.Raw);

        var text = new TextBlock
        {
            Text = label,
            FontSize = LegendFontSize,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = brush,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(swatch);
        row.Children.Add(text);
        AutomationProperties.SetName(row, label);
        return row;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ElevationChartAutomationPeer(this);

    private sealed class ElevationChartAutomationPeer(ElevationChart owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((ElevationChart)Owner).ViewModel.Title
                : name;
        }
    }

    /// <summary>
    /// The native dual-axis elevation renderer — the analogue of the web recharts <c>ComposedChart</c>: an
    /// elevation <c>Area</c> on the left "elev" axis (filled + stroked) plus a speed <c>Line</c> on the right
    /// "speed" axis. Each series is plotted against its own pre-normalized ratio so it occupies the full
    /// vertical range exactly as the web's two Y axes do. Pixel geometry is recomputed on every resize; the
    /// spoken summary is published for assistive technology.
    /// </summary>
    private sealed partial class ElevationComposedChart : ContentControl
    {
        private const double InsetLeft = 36;
        private const double InsetRight = 40;
        private const double InsetTop = 8;
        private const double InsetBottom = 18;
        private const double AxisLabelFontSize = 10;
        private const double SpeedLineOpacity = 0.6;  // web Line strokeOpacity={0.6}
        private const double AreaOpacity = 0.2;        // web Area fillOpacity={0.2}

        private readonly Canvas _canvas = new();
        private ElevationChartModel _model = new(
            Array.Empty<ElevationChartPoint>(),
            "Elevation (m)", "Speed (km/h)", "0", "0", "0", string.Empty);

        public ElevationComposedChart()
        {
            IsTabStop = false;
            HorizontalContentAlignment = HorizontalAlignment.Stretch;
            VerticalContentAlignment = VerticalAlignment.Stretch;
            Content = _canvas;
            SizeChanged += (_, _) => Render();
        }

        /// <summary>The projected chart model; reassigning re-renders and republishes the spoken summary.</summary>
        public ElevationChartModel Model
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

            // Web parity draw order (back to front): elevation area + stroke, then the speed line.
            var elevation = MapSeries(points, plotW, plotH, baseline, p => p.ElevationRatio);
            DrawArea(elevation, DisplayTokens.Brush(ElevationChartProjection.ElevationBrushKey), baseline, AreaOpacity);
            DrawLine(elevation, DisplayTokens.Brush(ElevationChartProjection.ElevationBrushKey), thickness: 2, opacity: 1.0);

            var speed = MapSeries(points, plotW, plotH, baseline, p => p.SpeedRatio);
            DrawLine(speed, DisplayTokens.Brush(ElevationChartProjection.SpeedBrushKey), thickness: 1.5, opacity: SpeedLineOpacity);

            DrawAxisLabels(width, baseline);
        }

        private static List<PointD> MapSeries(
            IReadOnlyList<ElevationChartPoint> points,
            double plotW,
            double plotH,
            double baseline,
            Func<ElevationChartPoint, double> selector)
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

        private void DrawLine(List<PointD> line, Brush brush, double thickness, double opacity)
        {
            if (line.Count == 0)
            {
                return;
            }

            if (line.Count == 1)
            {
                var dot = new Ellipse { Width = 4, Height = 4, Fill = brush, Opacity = opacity };
                Canvas.SetLeft(dot, line[0].X - 2);
                Canvas.SetTop(dot, line[0].Y - 2);
                _canvas.Children.Add(dot);
                return;
            }

            var polyline = ChartShapes.Polyline(line, brush, thickness);
            polyline.Opacity = opacity;
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
            // Left "elev" axis bounds (web left YAxis auto-domain [min, max]) and right "speed" axis bounds
            // (web right YAxis anchored at zero).
            AddAxisLabel(_model.ElevAxisMaxLabel, 2, InsetTop - 2);
            AddAxisLabel(_model.ElevAxisMinLabel, 2, baseline - 6);
            AddAxisLabel(_model.SpeedAxisMaxLabel, width - InsetRight + 2, InsetTop - 2);
            AddAxisLabel("0", width - InsetRight + 2, baseline - 6);
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
