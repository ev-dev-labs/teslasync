using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
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

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Drive Telemetry dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/DriveTelemetryWidget.tsx. It mirrors the web <c>WidgetShell</c> (a
/// skeleton while loading, a retry surface on error, otherwise — when not compact — a "Drive Telemetry"
/// freshness header) wrapping the latest drive's replay: a summary stat row (Distance, Duration and, when
/// the drive carries energy, Efficiency) plus — when standard (≥2 cols) — the dual-axis speed / power /
/// battery replay chart (the web recharts <c>ComposedChart</c>: a cyan speed line and dashed amber battery
/// line on the shared left axis, a green power area on the right axis and, on the wide layout, a gray
/// elevation area and the drive's start-address badge) with a matching legend. When the resolved drive has
/// no telemetry, the chart area falls back to a friendly "No telemetry for this drive" surface while the
/// stats remain (the web <c>chartData.length &gt; 0 ? chart : EmptyState</c> sub-gate); when there is no
/// vehicle or no drive history the whole surface shows "No recent drives" (the web <c>!latestDrive</c>
/// gate). At a single column the title, chart and legend collapse to the stat row only (the web
/// <c>isCompact = size.cols &lt;= 1</c> branch). All data flows through the shared
/// <see cref="DriveTelemetryViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class DriveTelemetryWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double ChartMinHeight = 150;

    private readonly DriveTelemetryViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DriveTelemetryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 6,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly ScrollViewer _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network drive-telemetry source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint.</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">The PII-safe diagnostics collector; a default is used when null.</param>
    public DriveTelemetryWidget(
        IDriveTelemetrySource source,
        ILocalizer localizer,
        DriveTelemetrySize size,
        UnitPref? units = null,
        DriveTelemetryDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new DriveTelemetryDiagnostics();
        _viewModel = new DriveTelemetryViewModel(source, localizer, size, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>drive-telemetry</c>).</summary>
    public static string RegistryId => DriveTelemetryRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the replay for the new layout.</summary>
    public DriveTelemetrySize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the stats + chart in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DriveTelemetrySource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle
    /// unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static DriveTelemetryWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        DriveTelemetrySize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        DriveTelemetryDiagnostics? diagnostics = null)
    {
        var source = new DriveTelemetrySource(vehicles, api, engine, options, vehicleId);
        return new DriveTelemetryWidget(
            source, localizer, size ?? DriveTelemetryRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = DriveTelemetryProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(DriveTelemetryProjection.SpeedBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(icon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.driveTelemetry.refresh", "Refresh drive telemetry"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(12, 8, 12, 2);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(actions);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(12, 0, 12, 12);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);
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

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
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

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

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
        switch (_viewModel.State)
        {
            case DriveTelemetryState.Loading:
                Content = BuildLoading();
                break;

            case DriveTelemetryState.Error:
                Content = BuildError();
                break;

            case DriveTelemetryState.Empty:
                UpdateHeader();
                _bodyHost.Content = BuildEmpty();
                Content = _root;
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = BuildBody();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        // Web parity: the compact layout uses a title-less WidgetShell.
        _titleRow.Visibility = _viewModel.Display.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    // ── Compact layout: summary stats only (web WidgetChartSummary compact, no chart) ──
    private static Grid BuildCompact(DriveTelemetryDisplay display)
    {
        int cols = Math.Max(1, Math.Min(2, display.Stats.Count));
        int rows = (int)Math.Ceiling(display.Stats.Count / (double)cols);

        var grid = new Grid
        {
            ColumnSpacing = 16,
            RowSpacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            MinHeight = 44,
        };
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Stats.Count; i++)
        {
            var cell = BuildStatCell(display.Stats[i], center: true);
            Grid.SetColumn(cell, i % cols);
            Grid.SetRow(cell, i / cols);
            grid.Children.Add(cell);
        }

        AutomationProperties.SetName(grid, display.CompactAutomationName);
        return grid;
    }

    // ── Standard / Wide layout: stats + address badge + replay chart + legend (web standard branch) ──
    private StackPanel BuildStandard(DriveTelemetryDisplay display)
    {
        var column = new StackPanel { Spacing = 8 };

        column.Children.Add(BuildHeaderStats(display));
        column.Children.Add(display.HasChart ? BuildChart(display.Chart) : BuildNoTelemetry());
        column.Children.Add(BuildLegend(display.Legend));

        return column;
    }

    private static StackPanel BuildHeaderStats(DriveTelemetryDisplay display)
    {
        // Web parity: a flex-wrap row of label-over-value stat columns plus the start-address badge (wide).
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            VerticalAlignment = VerticalAlignment.Center,
        };

        foreach (var stat in display.Stats)
        {
            row.Children.Add(BuildStatCell(stat, center: false));
        }

        if (display.StartAddress is { } address)
        {
            var badge = new TsBadge
            {
                Status = StatusKind.Neutral,
                Content = new TextBlock
                {
                    Text = address,
                    FontSize = 12,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    TextWrapping = TextWrapping.NoWrap,
                    MaxWidth = 180,
                },
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetName(badge, address);
            row.Children.Add(badge);
        }

        return row;
    }

    private static StackPanel BuildStatCell(DriveTelemetryStat stat, bool center)
    {
        var alignment = center ? HorizontalAlignment.Center : HorizontalAlignment.Left;

        var label = new TextBlock
        {
            Text = stat.Label,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = alignment,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var valueRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 2,
            HorizontalAlignment = alignment,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        valueRow.Children.Add(new TextBlock
        {
            Text = stat.Value,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        if (!string.IsNullOrEmpty(stat.Unit))
        {
            valueRow.Children.Add(new TextBlock
            {
                Text = stat.Unit,
                FontSize = 10,
                Foreground = DisplayTokens.TextMuted,
                Margin = new Thickness(0, 0, 0, 1),
                VerticalAlignment = VerticalAlignment.Bottom,
            });
        }

        var cell = new StackPanel { Spacing = 2 };
        cell.Children.Add(label);
        cell.Children.Add(valueRow);
        AutomationProperties.SetName(cell, stat.AutomationName);
        return cell;
    }

    private static StackPanel BuildLegend(IReadOnlyList<DriveTelemetryLegendItem> items)
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (var item in items)
        {
            var dot = new Border
            {
                Width = 8,
                Height = 8,
                CornerRadius = new CornerRadius(4),
                Background = DisplayTokens.Brush(item.ColorBrushKey),
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

            var text = new TextBlock
            {
                Text = item.Label,
                FontSize = 10,
                Foreground = DisplayTokens.TextSecondary,
                VerticalAlignment = VerticalAlignment.Center,
            };

            var entry = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
            entry.Children.Add(dot);
            entry.Children.Add(text);
            AutomationProperties.SetName(entry, item.Label);
            legend.Children.Add(entry);
        }

        return legend;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 32, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 150, ReduceMotion = MotionPreference.ReduceMotion });

        AutomationProperties.SetName(column, _localizer.GetString("widget.driveTelemetry.loading", "Loading drive telemetry"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.driveTelemetry.error", "Couldn't load drive telemetry"),
            ActionText = _localizer.GetString("widget.driveTelemetry.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = DriveTelemetryProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private TsEmptyState BuildNoTelemetry() => new()
    {
        IconGlyph = DriveTelemetryProjection.HeaderGlyph,
        Message = _viewModel.NoTelemetryMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static DriveTelemetryChart BuildChart(DriveTelemetryChartModel model) => new()
    {
        Model = model,
        MinHeight = ChartMinHeight,
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Stretch,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);

    /// <summary>
    /// The native dual-axis drive-replay renderer — the analogue of the web recharts <c>ComposedChart</c>: a
    /// speed <c>Line</c> + dashed battery <c>Line</c> (and, on the wide layout, an elevation <c>Area</c>) on
    /// the shared left axis, plus a power <c>Area</c> + line on the right axis. Each series is plotted
    /// against its own pre-normalized ratio so it occupies the full vertical range exactly as the web's two
    /// Y axes do. Null samples are skipped and the curve connects across the gap (web <c>connectNulls</c>).
    /// Pixel geometry is recomputed on every resize; the spoken summary is published for assistive
    /// technology.
    /// </summary>
    private sealed partial class DriveTelemetryChart : ContentControl
    {
        private const double InsetLeft = 30;
        private const double InsetRight = 30;
        private const double InsetTop = 8;
        private const double InsetBottom = 16;

        private readonly Canvas _canvas = new();
        private DriveTelemetryChartModel _model = new(
            Array.Empty<DriveTelemetryChartPoint>(), false, "Speed", "Power (kW)", "Battery %", "Elevation", "0", "0", "0", string.Empty);

        public DriveTelemetryChart()
        {
            IsTabStop = false;
            HorizontalContentAlignment = HorizontalAlignment.Stretch;
            VerticalContentAlignment = VerticalAlignment.Stretch;
            Content = _canvas;
            SizeChanged += (_, _) => Render();
        }

        /// <summary>The projected chart model; reassigning re-renders and republishes the spoken summary.</summary>
        public DriveTelemetryChartModel Model
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

            var speedBrush = DisplayTokens.Brush(DriveTelemetryProjection.SpeedBrushKey);
            var powerBrush = DisplayTokens.Brush(DriveTelemetryProjection.PowerBrushKey);
            var batteryBrush = DisplayTokens.Brush(DriveTelemetryProjection.BatteryBrushKey);
            var elevationBrush = DisplayTokens.Brush(DriveTelemetryProjection.ElevationBrushKey);

            // Web parity draw order (back to front): elevation area (wide), power area + line, speed line,
            // dashed battery line.
            if (_model.IsWide)
            {
                var elevationPixels = MapSeries(points, plotW, plotH, baseline, p => p.ElevationRatio);
                DrawArea(elevationPixels, elevationBrush, baseline, 0.15);
            }

            var powerPixels = MapSeries(points, plotW, plotH, baseline, p => p.PowerRatio);
            DrawArea(powerPixels, powerBrush, baseline, 0.3);
            DrawLine(powerPixels, powerBrush, dashed: false, thickness: 1.5);

            var speedPixels = MapSeries(points, plotW, plotH, baseline, p => p.SpeedRatio);
            DrawLine(speedPixels, speedBrush, dashed: false, thickness: 2);

            var batteryPixels = MapSeries(points, plotW, plotH, baseline, p => p.BatteryRatio);
            DrawLine(batteryPixels, batteryBrush, dashed: true, thickness: 1.5);

            DrawAxisLabels(width, baseline);
        }

        private static List<PointD> MapSeries(
            IReadOnlyList<DriveTelemetryChartPoint> points,
            double plotW,
            double plotH,
            double baseline,
            Func<DriveTelemetryChartPoint, double?> selector)
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
                polyline.StrokeDashArray = new DoubleCollection { 4, 3 };
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
            // Left "speed" axis bound (web left YAxis domain [0, dataMax + 10]) and right power axis bounds
            // (web right YAxis auto-domain spanning zero).
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
                FontSize = 9,
                Foreground = DisplayTokens.TextMuted,
            };
            AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
            Canvas.SetLeft(label, left);
            Canvas.SetTop(label, top);
            _canvas.Children.Add(label);
        }
    }
}
