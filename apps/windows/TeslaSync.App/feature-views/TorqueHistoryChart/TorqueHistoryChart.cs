using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
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
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Motor-Torque history feature surface — a parity port of
/// web/src/features/driving/components/drivetrain-health/TorqueHistoryChart.tsx. It reproduces the web
/// <c>ChartContainer</c> chrome (title + subtitle) wrapping an area chart of the drive-inverter torque (Nm) over
/// time, the recharts <c>&lt;Legend&gt;</c> (the native chart's built-in legend carrying the "Torque (Nm)"
/// series chip) and the <c>&lt;ReferenceLine y={0}&gt;</c> baseline. The web component is a pure child of the
/// Drivetrain-Health page that returns <c>null</c> when it has one or fewer samples or no torque reading; the
/// native feature-view owns its cache-then-network motor-history read and therefore renders every state the P2
/// contract mandates — a loading skeleton, the populated chart, a friendly empty surface when there is nothing
/// to chart, an explicit retry surface on hard failure, plus stale and offline freshness chips. The chart's
/// accessible data table (the web <c>ChartContainer</c> exportable Time / Torque columns) is one toggle away in
/// an expander. All data flows through the shared <see cref="TorqueHistoryChartViewModel"/>; the view never
/// performs HTTP. Every string resolves through the i18n facade and every interactive element carries a Narrator
/// name.
/// </summary>
public sealed partial class TorqueHistoryChart : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double ChartHeight = 280;        // web ResponsiveContainer height={280}
    private const int FadeInDelayMs = 240;         // web <FadeIn delay={0.24}>
    private const double ChipFontSize = 12;
    private const double TableFontSize = 13;

    private readonly TorqueHistoryChartViewModel _viewModel;
    private readonly TorqueHistoryChartDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsFadeIn _fade = new() { DelayMs = FadeInDelayMs };
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
    private readonly TextBlock _freshnessChipText = new() { FontSize = ChipFontSize };
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
    public TorqueHistoryChart(
        ITorqueHistoryChartSource source,
        ILocalizer localizer,
        TorqueHistoryChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new TorqueHistoryChartDiagnostics();
        _viewModel = new TorqueHistoryChartViewModel(source, localizer);
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

    /// <summary>The canonical surface id (<c>torque-history-chart</c>).</summary>
    public static string SurfaceId => TorqueHistoryChartRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public TorqueHistoryChartViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TorqueHistoryChartSource"/> from the
    /// shared data layer (the host's P2-core dependencies), scoped to <paramref name="vehicleId"/> (the web
    /// page's selected / primary vehicle).
    /// </summary>
    public static TorqueHistoryChart Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        TorqueHistoryChartDiagnostics? diagnostics = null)
    {
        var source = new TorqueHistoryChartSource(vehicles, api, engine, options, vehicleId);
        return new TorqueHistoryChart(source, localizer, diagnostics);
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

    private void UpdateFreshness(TorqueHistoryChartState state)
    {
        bool showActions = state is not (TorqueHistoryChartState.Loading or TorqueHistoryChartState.Error);
        _actions.Visibility = showActions ? Visibility.Visible : Visibility.Collapsed;
        if (!showActions)
        {
            return;
        }

        bool stale = state == TorqueHistoryChartState.Stale;
        bool offline = state == TorqueHistoryChartState.Offline;
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

    private UIElement BuildBody(TorqueHistoryChartDisplay display, TorqueHistoryChartState state) => state switch
    {
        TorqueHistoryChartState.Loading => BuildLoading(),
        TorqueHistoryChartState.Error => BuildError(),
        TorqueHistoryChartState.Empty => BuildEmpty(),
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

    private static StackPanel BuildChart(TorqueHistoryChartDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(BuildAreaChart(display));
        content.Children.Add(BuildDataExpander(display));
        return content;
    }

    private static TsAreaChart BuildAreaChart(TorqueHistoryChartDisplay display)
    {
        // Web parity: torque points are plotted in order; null torque becomes a gap (the point is omitted) at its
        // original index so the temporal spacing of the surrounding samples is preserved on the numeric X scale.
        var points = new List<ChartPoint>(display.Points.Count);
        for (int i = 0; i < display.Points.Count; i++)
        {
            var point = display.Points[i];
            if (point.TorqueNm is { } torque)
            {
                points.Add(new ChartPoint(i, torque, point.TimeLabel));
            }
        }

        var series = new[]
        {
            new ChartSeries(display.SeriesLabel, points)
            {
                Kind = ChartSeriesKind.Area,
                ColorIndex = TorqueHistoryChartProjection.SeriesColorIndex,
                Unit = TorqueHistoryChartProjection.TorqueUnit,
                Decimals = 0,
            },
        };

        // Web parity: <ReferenceLine y={0} strokeDasharray="2 2" /> — the zero-torque baseline.
        var annotations = new[]
        {
            new ChartAnnotation(
                "torque-zero",
                ChartAnnotationKind.HorizontalLine,
                TorqueHistoryChartProjection.ReferenceLineValue),
        };

        var chart = new TsAreaChart
        {
            Series = series,
            Annotations = annotations,
            Title = display.Title,
            Height = ChartHeight,
            ShowLegend = true,   // web recharts <Legend /> carries the "Torque (Nm)" series chip
            IncludeZero = true,  // keep y=0 in the domain so the reference baseline is always visible
        };
        AutomationProperties.SetName(chart, display.ChartAriaLabel);
        return chart;
    }

    private static Expander BuildDataExpander(TorqueHistoryChartDisplay display)
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

    private static StackPanel BuildDataTable(TorqueHistoryChartDisplay display)
    {
        var table = new StackPanel { Spacing = 4 };
        table.Children.Add(BuildTableRow(display.TimeColumnLabel, display.TorqueColumnLabel, header: true));

        foreach (var point in display.Points)
        {
            string timeText = string.IsNullOrEmpty(point.TimeLabel)
                ? TorqueHistoryChartProjection.EmDash
                : point.TimeLabel;
            var row = BuildTableRow(timeText, point.TorqueText, header: false);
            AutomationProperties.SetName(row, point.AutomationName);
            table.Children.Add(row);
        }

        return table;
    }

    private static Grid BuildTableRow(string time, string torque, bool header)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var brush = header ? DisplayTokens.TextMuted : DisplayTokens.TextPrimary;
        AddCell(grid, time, 0, header ? DisplayTokens.TextMuted : DisplayTokens.TextSecondary);
        AddCell(grid, torque, 1, brush);
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
    protected override AutomationPeer OnCreateAutomationPeer() => new TorqueHistoryChartAutomationPeer(this);

    private sealed class TorqueHistoryChartAutomationPeer(TorqueHistoryChart owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((TorqueHistoryChart)Owner).ViewModel.Title
                : name;
        }
    }
}
