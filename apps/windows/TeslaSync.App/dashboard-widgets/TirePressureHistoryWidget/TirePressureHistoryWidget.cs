using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Tire Pressure History dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/TirePressureHistoryWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a skeleton while loading, a retry surface on error, otherwise a freshness header) wrapping the web
/// <c>WidgetChartSummary</c>: a summary stat row (latest FL / FR / RL / RR pressures) and — when standard
/// (≥2 columns) — the four-corner pressure line chart (one series per tire) with the recommended-range
/// Min / Max reference lines; a friendly "No tire pressure history" empty state covers the surface when no
/// timestamped TPMS row is available (the web <c>hasData = chartData.length &gt; 0</c> gate). At a single
/// column the title and chart collapse to the stat row only (the web <c>isCompact</c> branch). All data
/// flows through the shared <see cref="TirePressureHistoryViewModel"/>; the view never performs HTTP. Every
/// string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class TirePressureHistoryWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly TirePressureHistoryViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly TirePressureHistoryDiagnostics _diagnostics;
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
    public TirePressureHistoryWidget(
        ITirePressureHistorySource source,
        ILocalizer localizer,
        TirePressureHistorySize size,
        UnitPref? units = null,
        TirePressureHistoryDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new TirePressureHistoryDiagnostics();
        _viewModel = new TirePressureHistoryViewModel(source, localizer, size, units);
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

    /// <summary>The canonical registry id this surface registers under (<c>tire-pressure-history</c>).</summary>
    public static string RegistryId => TirePressureHistoryRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the history for the new layout.</summary>
    public TirePressureHistorySize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the corner pressures.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TirePressureHistorySource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle
    /// unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static TirePressureHistoryWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        TirePressureHistorySize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        TirePressureHistoryDiagnostics? diagnostics = null)
    {
        var source = new TirePressureHistorySource(vehicles, api, engine, options, vehicleId);
        return new TirePressureHistoryWidget(
            source, localizer, size ?? TirePressureHistoryRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = TirePressureHistoryProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info)),
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.tirePressureHistory.refresh", "Refresh tire pressure history"));
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
            case TirePressureHistoryState.Loading:
                Content = BuildLoading();
                break;

            case TirePressureHistoryState.Error:
                Content = BuildError();
                break;

            case TirePressureHistoryState.Empty:
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

        // Web parity: WidgetChartSummary always renders the stat row; the chart only when not compact.
        column.Children.Add(BuildStatRow(display));

        if (!display.IsCompact && BuildChart(display, _viewModel.Title, PressureUnit()) is { } chart)
        {
            column.Children.Add(chart);
        }

        return column;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 32, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 160, ReduceMotion = MotionPreference.ReduceMotion });

        AutomationProperties.SetName(column, _localizer.GetString("widget.tirePressureHistory.loading", "Loading tire pressure history"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.tirePressureHistory.error", "Couldn't load tire pressure history"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = TirePressureHistoryProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private string PressureUnit() => UnitLabels.Label(_viewModel.Units.Pressure);

    private static Grid BuildStatRow(TirePressureHistoryDisplay display)
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

    private static StackPanel BuildStatCell(TirePressureSummaryStat stat)
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

    // Web parity: four line series — FL / FR / RL / RR — over a shared time axis, each bridging the gaps the
    // web Recharts `connectNulls` does, overlaid with the recommended-range Min / Max reference lines. Null
    // when no corner reading is plottable.
    private static TsLineChart? BuildChart(TirePressureHistoryDisplay display, string title, string unit)
    {
        var series = new List<ChartSeries>(4);
        AddSeries(series, display.FrontLeftSeriesName, display.FrontLeftPoints, TirePressureHistoryProjection.FrontLeftColorIndex, unit);
        AddSeries(series, display.FrontRightSeriesName, display.FrontRightPoints, TirePressureHistoryProjection.FrontRightColorIndex, unit);
        AddSeries(series, display.RearLeftSeriesName, display.RearLeftPoints, TirePressureHistoryProjection.RearLeftColorIndex, unit);
        AddSeries(series, display.RearRightSeriesName, display.RearRightPoints, TirePressureHistoryProjection.RearRightColorIndex, unit);

        if (series.Count == 0)
        {
            return null;
        }

        // Web parity: the two dashed recommended-range reference lines (web ReferenceLine y=Min / y=Max),
        // shown only when they fall inside the plotted data domain — see TirePressureHistoryProjection for the
        // web unit-bug note and the discard-on-overflow rationale.
        var annotations = new List<ChartAnnotation>(2);
        if (display.ShowRecommendedLow)
        {
            annotations.Add(new ChartAnnotation("min", ChartAnnotationKind.HorizontalLine, display.RecommendedLowDisplay)
            {
                Label = display.MinLabel,
            });
        }

        if (display.ShowRecommendedHigh)
        {
            annotations.Add(new ChartAnnotation("max", ChartAnnotationKind.HorizontalLine, display.RecommendedHighDisplay)
            {
                Label = display.MaxLabel,
            });
        }

        return new TsLineChart
        {
            Title = title,
            Series = series,
            Annotations = annotations,
            ShowLegend = series.Count > 1,

            // Web parity: the pressure YAxis auto-fits its domain (no forced zero baseline), so the four
            // tightly-grouped tire traces stay readable.
            IncludeZero = false,
            MinHeight = 200,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
    }

    private static void AddSeries(
        List<ChartSeries> series,
        string name,
        IReadOnlyList<ChartPoint> points,
        int colorIndex,
        string unit)
    {
        if (points.Count == 0)
        {
            return;
        }

        series.Add(new ChartSeries(name, points)
        {
            ColorIndex = colorIndex,
            Unit = unit,
            Decimals = TirePressureHistoryProjection.PressurePrecision,
        });
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
