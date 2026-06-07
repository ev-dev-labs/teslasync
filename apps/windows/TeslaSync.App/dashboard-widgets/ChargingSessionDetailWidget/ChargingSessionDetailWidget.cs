using System.Collections.Generic;
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
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Charging Session Detail dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/ChargingSessionDetailWidget.tsx. It mirrors the web
/// <c>WidgetShell</c> (a skeleton while loading, a retry surface on error, otherwise a freshness header)
/// wrapping the web <c>WidgetChartSummary</c>: a summary stat row (Energy Added, Duration, Peak Power,
/// Charger) and — when standard (≥2 cols) — the last charge session's power curve with its dashed
/// state-of-charge overlay (the web dual-axis recharts <c>ComposedChart</c>). At a single column the layout
/// collapses to the web compact branch: a large kWh-added number with the charger badge. A friendly
/// "No charge sessions" empty state covers the surface when there is no vehicle, no charging session, or no
/// session detail (the web <c>!detail</c> gate). All data flows through the shared
/// <see cref="ChargingSessionDetailViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class ChargingSessionDetailWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly ChargingSessionDetailViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ChargingSessionDetailDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly ScrollViewer _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public ChargingSessionDetailWidget(
        IChargingSessionDetailSource source,
        ILocalizer localizer,
        ChargingSessionDetailSize size,
        ChargingSessionDetailDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ChargingSessionDetailDiagnostics();
        _viewModel = new ChargingSessionDetailViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>charging-session-detail</c>).</summary>
    public static string RegistryId => ChargingSessionDetailRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the session for the new layout.</summary>
    public ChargingSessionDetailSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ChargingSessionDetailSource"/> from
    /// the shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached
    /// vehicle unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static ChargingSessionDetailWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ChargingSessionDetailSize? size = null,
        long? vehicleId = null,
        ChargingSessionDetailDiagnostics? diagnostics = null)
    {
        var source = new ChargingSessionDetailSource(vehicles, api, engine, options, vehicleId);
        return new ChargingSessionDetailWidget(
            source, localizer, size ?? ChargingSessionDetailRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = ChargingSessionDetailProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(ChargingSessionDetailProjection.PowerBrushKey),
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.chargingSessionDetail.refresh", "Refresh charge session"));
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
            case ChargingSessionDetailState.Loading:
                Content = BuildLoading();
                break;

            case ChargingSessionDetailState.Error:
                Content = BuildError();
                break;

            case ChargingSessionDetailState.Empty:
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

    private StackPanel BuildBody()
    {
        var display = _viewModel.Display;
        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    // ── Compact layout: large kWh number + charger badge (web isCompact branch) ──
    private static StackPanel BuildCompact(ChargingSessionDetailDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(new TextBlock
        {
            Text = display.CompactEnergyText,
            FontSize = 24,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.Brush(ChargingSessionDetailProjection.PowerBrushKey),
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        column.Children.Add(new TextBlock
        {
            Text = display.CompactUnitLabel.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            CharacterSpacing = 80,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var badge = new TsBadge
        {
            Status = display.ChargerStatus,
            Content = display.ChargerLabel,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        column.Children.Add(badge);

        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    // ── Standard / Wide layout: stat row + power/SoC curve (web WidgetChartSummary) ──
    private StackPanel BuildStandard(ChargingSessionDetailDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildStatRow(display));
        column.Children.Add(display.HasChart ? BuildChart(display.Chart) : BuildNoCurve());
        return column;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 32, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 160, ReduceMotion = MotionPreference.ReduceMotion });

        AutomationProperties.SetName(column, _localizer.GetString("widget.chargingSessionDetail.loading", "Loading charge session"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.chargingSessionDetail.error", "Couldn't load the charge session"),
            ActionText = _localizer.GetString("widget.chargingSessionDetail.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = ChargingSessionDetailProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private TextBlock BuildNoCurve()
    {
        string message = _localizer.GetString("widget.chargingSessionDetail.noCurve", "No charge curve data");
        var text = new TextBlock
        {
            Text = message,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            MinHeight = 120,
            Margin = new Thickness(0, 8, 0, 0),
        };
        AutomationProperties.SetName(text, message);
        return text;
    }

    private static Grid BuildStatRow(ChargingSessionDetailDisplay display)
    {
        // Web parity: WidgetChartSummary uses a 2-col grid that relaxes to a horizontal row on wider widgets.
        int cols = display.IsWide ? Math.Max(1, display.Stats.Count) : 2;
        int rows = (int)Math.Ceiling(display.Stats.Count / (double)cols);

        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 8 };
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
            var cell = BuildStatCell(display.Stats[i]);
            Grid.SetColumn(cell, i % cols);
            Grid.SetRow(cell, i / cols);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private static StackPanel BuildStatCell(ChargingSessionDetailStat stat)
    {
        var label = new TextBlock
        {
            Text = stat.Label,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var valueRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Bottom };
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

    private static ChargeCurveChart BuildChart(ChargeCurveChartModel model) => new()
    {
        Model = model,
        MinHeight = 160,
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Stretch,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);

    /// <summary>
    /// The native dual-axis charge-curve renderer — the analogue of the web recharts <c>ComposedChart</c>
    /// (a power <c>Area</c> scaled to its own left axis + a dashed state-of-charge <c>Line</c> scaled to a
    /// fixed 0..100% right axis). Each series is plotted against its own pre-normalized ratio so both curves
    /// occupy the full vertical range exactly as the web's two Y axes do. Null samples are skipped and the
    /// curve connects across the gap (web <c>connectNulls</c>). Pixel geometry is recomputed on every
    /// resize; the spoken summary is published for assistive technology.
    /// </summary>
    private sealed partial class ChargeCurveChart : ContentControl
    {
        private const double InsetLeft = 30;
        private const double InsetRight = 30;
        private const double InsetTop = 8;
        private const double InsetBottom = 16;

        private readonly Canvas _canvas = new();
        private ChargeCurveChartModel _model = new(
            Array.Empty<ChargeCurvePoint>(), "Power (kW)", "SoC %", 5, "0", string.Empty);

        public ChargeCurveChart()
        {
            IsTabStop = false;
            HorizontalContentAlignment = HorizontalAlignment.Stretch;
            VerticalContentAlignment = VerticalAlignment.Stretch;
            Content = _canvas;
            SizeChanged += (_, _) => Render();
        }

        /// <summary>The projected chart model; reassigning re-renders and republishes the spoken summary.</summary>
        public ChargeCurveChartModel Model
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

            var powerBrush = DisplayTokens.Brush(ChargingSessionDetailProjection.PowerBrushKey);
            var socBrush = DisplayTokens.Brush(ChargingSessionDetailProjection.SocBrushKey);

            var powerPixels = MapSeries(points, plotW, plotH, baseline, p => p.PowerRatio);
            var socPixels = MapSeries(points, plotW, plotH, baseline, p => p.SocRatio);

            DrawPowerArea(powerPixels, powerBrush, baseline);
            DrawLine(powerPixels, powerBrush, dashed: false);
            DrawLine(socPixels, socBrush, dashed: true);

            DrawAxisLabels(width, baseline);
        }

        private static List<PointD> MapSeries(
            IReadOnlyList<ChargeCurvePoint> points,
            double plotW,
            double plotH,
            double baseline,
            Func<ChargeCurvePoint, double?> selector)
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

        private void DrawPowerArea(List<PointD> line, Brush brush, double baseline)
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
            fill.Opacity = 0.2;
            _canvas.Children.Add(fill);
        }

        private void DrawLine(List<PointD> line, Brush brush, bool dashed)
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

            var polyline = ChartShapes.Polyline(line, brush, 1.5);
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
            // Left power axis bound (web left YAxis domain max) and right SoC axis bound (web right YAxis 100%).
            AddAxisLabel(_model.PowerAxisMaxLabel, 2, InsetTop - 2);
            AddAxisLabel("0", 2, baseline - 6);
            AddAxisLabel("100", width - InsetRight + 2, InsetTop - 2);
            AddAxisLabel("0", width - InsetRight + 2, baseline - 6);
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
