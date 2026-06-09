using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
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

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Charging Speed Trend feature surface — a parity port of
/// web/src/features/charging/components/charging-curve/SpeedTrendChart.tsx. It reproduces the web
/// <c>ChartContainer</c> chrome (title + subtitle) wrapping a two-line chart of each month's average DC and
/// AC charge rate in kW, plus the standalone two-chip legend ("DC Fast" / "AC / Home") below it. The web
/// component is a pure child of the Charging-Curve page that draws an empty chart when its <c>sessions</c>
/// prop is empty; the native feature-view owns its cache-then-network charging-session read and therefore
/// renders every state the P2 contract mandates — a loading skeleton, the populated chart, a friendly empty
/// surface when there are no sessions to chart, an explicit retry surface on hard failure, plus stale and
/// offline freshness chips. The chart's accessible data table (the web <c>ChartContainer</c> exportable
/// columns) is one toggle away in an expander. All data flows through the shared
/// <see cref="SpeedTrendChartViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class SpeedTrendChart : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double ChartHeight = 280;        // web ResponsiveContainer height={280}
    private const double FadeInDelayMs = 300;
    private const double LegendSwatchWidth = 14;
    private const double LegendSwatchHeight = 8;
    private const double LegendFontSize = 12;
    private const double TableFontSize = 13;

    private readonly SpeedTrendChartViewModel _viewModel;
    private readonly SpeedTrendChartDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsFadeIn _fade = new() { DelayMs = (int)FadeInDelayMs };
    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new() { Spacing = 16 };
    private readonly Grid _header = new();
    private readonly StackPanel _heading = new() { Spacing = 2 };
    private readonly SectionTitle _title = new();
    private readonly Caption _subtitle = new();
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

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics.</summary>
    public SpeedTrendChart(
        ISpeedTrendChartSource source,
        ILocalizer localizer,
        SpeedTrendChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new SpeedTrendChartDiagnostics();
        _viewModel = new SpeedTrendChartViewModel(source, localizer);
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

    /// <summary>The canonical surface id (<c>speed-trend-chart</c>).</summary>
    public static string SurfaceId => SpeedTrendChartRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SpeedTrendChartViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SpeedTrendChartSource"/> from the
    /// shared data layer (the host's P2-core dependencies), scoped to <paramref name="vehicleId"/> (the web
    /// page's selected / first vehicle).
    /// </summary>
    public static SpeedTrendChart Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        SpeedTrendChartDiagnostics? diagnostics = null)
    {
        var source = new SpeedTrendChartSource(api, engine, options, vehicleId);
        return new SpeedTrendChart(source, localizer, diagnostics);
    }

    private void BuildChrome()
    {
        _heading.Children.Add(_title);
        _heading.Children.Add(_subtitle);

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
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.Title);

        UpdateFreshness(state);
        _bodyHost.Child = BuildBody(display, state);
    }

    private void UpdateFreshness(SpeedTrendChartState state)
    {
        bool showActions = state is not (SpeedTrendChartState.Loading or SpeedTrendChartState.Error);
        _actions.Visibility = showActions ? Visibility.Visible : Visibility.Collapsed;
        if (!showActions)
        {
            return;
        }

        bool stale = state == SpeedTrendChartState.Stale;
        bool offline = state == SpeedTrendChartState.Offline;
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

    private UIElement BuildBody(SpeedTrendChartDisplay display, SpeedTrendChartState state) => state switch
    {
        SpeedTrendChartState.Loading => BuildLoading(),
        SpeedTrendChartState.Error => BuildError(),
        SpeedTrendChartState.Empty => BuildEmpty(),
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

    private static StackPanel BuildChart(SpeedTrendChartDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new Caption { Value = display.AxisLabel });
        content.Children.Add(BuildLineChart(display));
        content.Children.Add(BuildLegend(display));
        content.Children.Add(BuildDataExpander(display));
        return content;
    }

    private static TsCartesianChart BuildLineChart(SpeedTrendChartDisplay display)
    {
        var dc = new List<ChartPoint>(display.Months.Count);
        var ac = new List<ChartPoint>(display.Months.Count);
        for (int i = 0; i < display.Months.Count; i++)
        {
            var month = display.Months[i];
            dc.Add(new ChartPoint(i, month.DcAvgKw, month.Month));
            ac.Add(new ChartPoint(i, month.AcAvgKw, month.Month));
        }

        var series = new[]
        {
            new ChartSeries(display.DcSeriesLabel, dc)
            {
                Kind = ChartSeriesKind.Line,
                ColorIndex = SpeedTrendChartProjection.DcSeriesColorIndex,
                Unit = SpeedTrendChartProjection.PowerUnit,
                Decimals = 1,
            },
            new ChartSeries(display.AcSeriesLabel, ac)
            {
                Kind = ChartSeriesKind.Line,
                ColorIndex = SpeedTrendChartProjection.AcSeriesColorIndex,
                Unit = SpeedTrendChartProjection.PowerUnit,
                Decimals = 1,
            },
        };

        // Web parity: the recharts LineChart shows no built-in <Legend>; the series names surface only in the
        // tooltip / data table while the standalone legend below carries the "DC Fast" / "AC / Home" chips.
        var chart = new TsCartesianChart
        {
            Series = series,
            Title = display.Title,
            Height = ChartHeight,
            ShowLegend = false,
            IncludeZero = true,
        };
        AutomationProperties.SetName(chart, display.ChartAriaLabel);
        return chart;
    }

    private static StackPanel BuildLegend(SpeedTrendChartDisplay display)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16 };
        foreach (var item in display.Legend)
        {
            var swatch = new Rectangle
            {
                Width = LegendSwatchWidth,
                Height = LegendSwatchHeight,
                RadiusX = 2,
                RadiusY = 2,
                Fill = DisplayTokens.Brush(item.ColorBrushKey),
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(swatch, AccessibilityView.Raw);

            var label = new TextBlock
            {
                Text = item.Label,
                FontSize = LegendFontSize,
                Foreground = DisplayTokens.TextSecondary,
                VerticalAlignment = VerticalAlignment.Center,
            };

            var entry = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            entry.Children.Add(swatch);
            entry.Children.Add(label);
            AutomationProperties.SetName(entry, item.Label);
            row.Children.Add(entry);
        }

        return row;
    }

    private static Expander BuildDataExpander(SpeedTrendChartDisplay display)
    {
        var expander = new Expander
        {
            Header = display.ChartAriaLabel,
            Content = BuildDataTable(display),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(expander, display.ChartAriaLabel);
        return expander;
    }

    private static StackPanel BuildDataTable(SpeedTrendChartDisplay display)
    {
        var table = new StackPanel { Spacing = 4 };
        table.Children.Add(BuildTableRow(
            display.MonthColumnLabel, display.DcColumnLabel, display.AcColumnLabel, header: true));

        foreach (var month in display.Months)
        {
            string monthText = string.IsNullOrEmpty(month.Month) ? "\u2014" : month.Month;
            var row = BuildTableRow(monthText, month.DcAvgText, month.AcAvgText, header: false);
            AutomationProperties.SetName(row, month.AutomationName);
            table.Children.Add(row);
        }

        return table;
    }

    private static Grid BuildTableRow(string month, string dc, string ac, bool header)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        for (int c = 0; c < 3; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var brush = header ? DisplayTokens.TextMuted : DisplayTokens.TextPrimary;
        AddCell(grid, month, 0, header ? DisplayTokens.TextMuted : DisplayTokens.TextSecondary);
        AddCell(grid, dc, 1, brush);
        AddCell(grid, ac, 2, brush);
        return grid;
    }

    private static void AddCell(Grid grid, string text, int column, Microsoft.UI.Xaml.Media.Brush foreground)
    {
        var cell = new TextBlock
        {
            Text = text,
            FontSize = TableFontSize,
            Foreground = foreground,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        Grid.SetColumn(cell, column);
        grid.Children.Add(cell);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SpeedTrendChartAutomationPeer(this);

    private sealed class SpeedTrendChartAutomationPeer(SpeedTrendChart owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((SpeedTrendChart)Owner).ViewModel.Title
                : name;
        }
    }
}
