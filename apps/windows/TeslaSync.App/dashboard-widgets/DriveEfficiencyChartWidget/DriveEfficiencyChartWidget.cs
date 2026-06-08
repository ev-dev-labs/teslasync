using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Drive Efficiency Chart dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/DriveEfficiencyChartWidget.tsx. It mirrors the web
/// <c>WidgetShell</c> (a skeleton while loading, a retry surface on error, otherwise a freshness header)
/// wrapping the web <c>WidgetChartSummary</c>: a summary stat row (Avg, Best day, Trend) and — when
/// standard (not a single cell) — the daily-efficiency area chart with its 7-day rolling-average line
/// overlay and overall-average reference line, plus a two-entry legend; a friendly "No efficiency data yet"
/// empty state covers the surface when no drive yields a usable efficiency sample in the last 30 days (the
/// web <c>isEmpty</c> gate). All data flows through the shared <see cref="DriveEfficiencyChartViewModel"/>;
/// the view never performs HTTP. Efficiency is shown in the user's distance unit (Wh/mi or Wh/km); every
/// string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class DriveEfficiencyChartWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly DriveEfficiencyChartViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DriveEfficiencyChartDiagnostics _diagnostics;
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

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    public DriveEfficiencyChartWidget(
        IDriveEfficiencyChartSource source,
        ILocalizer localizer,
        DriveEfficiencyChartSize size,
        UnitPref? units = null,
        DriveEfficiencyChartDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new DriveEfficiencyChartDiagnostics();
        _viewModel = new DriveEfficiencyChartViewModel(source, localizer, size, units, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>drive-efficiency-chart</c>).</summary>
    public static string RegistryId => DriveEfficiencyChartRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the drives for the new layout.</summary>
    public DriveEfficiencyChartSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the efficiency in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DriveEfficiencyChartSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle
    /// unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static DriveEfficiencyChartWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        DriveEfficiencyChartSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        DriveEfficiencyChartDiagnostics? diagnostics = null)
    {
        var source = new DriveEfficiencyChartSource(vehicles, api, engine, options, vehicleId);
        return new DriveEfficiencyChartWidget(
            source, localizer, size ?? DriveEfficiencyChartRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = DriveEfficiencyChartProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(DriveEfficiencyChartProjection.HeaderAccentBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = Microsoft.UI.Text.FontWeights.Medium;
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.driveEfficiencyChart.refresh", "Refresh drive efficiency"));
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
            case DriveEfficiencyChartState.Loading:
                Content = BuildLoading();
                break;

            case DriveEfficiencyChartState.Error:
                Content = BuildError();
                break;

            case DriveEfficiencyChartState.Empty:
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
        var column = new StackPanel { Spacing = 12 };

        // Web parity: WidgetChartSummary always renders the stat row; the chart + legend only when not compact.
        column.Children.Add(BuildStatRow(display));

        if (!display.IsCompact)
        {
            column.Children.Add(BuildChart(display, _viewModel.Title));
            column.Children.Add(BuildLegend(display));
        }

        return column;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 32, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 160, ReduceMotion = MotionPreference.ReduceMotion });

        AutomationProperties.SetName(column, _localizer.GetString("widget.driveEfficiencyChart.loading", "Loading drive efficiency"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.driveEfficiencyChart.error", "Couldn't load drive efficiency"),
            ActionText = _localizer.GetString("widget.driveEfficiencyChart.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = DriveEfficiencyChartProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Grid BuildStatRow(DriveEfficiencyChartDisplay display)
    {
        int cols = display.IsCompact ? 2 : Math.Max(1, display.Stats.Count);
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

        if (display.IsCompact)
        {
            AutomationProperties.SetName(grid, display.CompactAutomationName);
        }

        return grid;
    }

    private static StackPanel BuildStatCell(DriveEfficiencyChartStat stat)
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
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
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

    /// <summary>
    /// The composed efficiency chart — the native analogue of the web recharts <c>AreaChart</c>: the
    /// daily-efficiency area (palette series 0) with the 7-day rolling-average line overlay (palette series
    /// 1) and the dashed overall-average reference line. Mixed series kinds share one surface via
    /// <see cref="TsComposedChart"/>. The chart carries the widget title as its accessible name.
    /// </summary>
    private static TsComposedChart BuildChart(DriveEfficiencyChartDisplay display, string title)
    {
        var dailyPoints = new List<ChartPoint>(display.Points.Count);
        var rollingPoints = new List<ChartPoint>(display.Points.Count);
        for (int i = 0; i < display.Points.Count; i++)
        {
            var point = display.Points[i];
            dailyPoints.Add(new ChartPoint(i, point.Efficiency, point.Label));
            if (point.RollingAvg is { } rolling)
            {
                rollingPoints.Add(new ChartPoint(i, rolling, point.Label));
            }
        }

        var series = new List<ChartSeries>(2)
        {
            new(display.DailySeriesName, dailyPoints)
            {
                Kind = ChartSeriesKind.Area,
                ColorIndex = DriveEfficiencyChartProjection.DailyColorIndex,
                Unit = display.EfficiencyUnit,
                Decimals = 0,
            },
        };

        // Web parity: the rolling-average overlay only draws where a 7-day window exists (recharts skips the
        // null rollingAvg leading points); omit the series entirely when no window is available yet.
        if (rollingPoints.Count > 0)
        {
            series.Add(new ChartSeries(display.RollingSeriesName, rollingPoints)
            {
                Kind = ChartSeriesKind.Line,
                ColorIndex = DriveEfficiencyChartProjection.RollingColorIndex,
                Unit = display.EfficiencyUnit,
                Decimals = 0,
            });
        }

        var annotations = new List<ChartAnnotation>(1);
        if (display.HasReferenceLine)
        {
            // The dashed overall-average reference line (web ReferenceLine y={overallAvg}).
            annotations.Add(new ChartAnnotation("avg", ChartAnnotationKind.HorizontalLine, display.ReferenceValue));
        }

        var chart = new TsComposedChart
        {
            Title = title,
            Series = series,
            Annotations = annotations,
            ShowLegend = false,
            IncludeZero = false,
            MinHeight = 160,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(chart, title);
        return chart;
    }

    private static StackPanel BuildLegend(DriveEfficiencyChartDisplay display)
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (var item in display.Legend)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
            var dot = new Border
            {
                Width = 8,
                Height = 8,
                CornerRadius = new CornerRadius(4),
                Background = DisplayTokens.Brush(item.ColorBrushKey),
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(dot, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

            var text = new TextBlock
            {
                Text = item.Label,
                FontSize = 10,
                Foreground = DisplayTokens.TextSecondary,
                VerticalAlignment = VerticalAlignment.Center,
            };

            row.Children.Add(dot);
            row.Children.Add(text);
            AutomationProperties.SetName(row, item.Label);
            legend.Children.Add(row);
        }

        return legend;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
