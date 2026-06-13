using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The native WinUI 3 <c>MQTTInspectorPage</c> — a parity port of the web page
/// <c>web/src/features/telemetry/pages/MQTTInspectorPage.tsx</c> (route <c>/mqtt-inspector</c>, nav name
/// <c>MQTTInspector</c>). It binds to a <see cref="MQTTInspectorPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle + the auto-refresh indicator + the broker
/// connection badge), the top "unable to load" error banner (web <c>error &amp;&amp; !status</c>), the four summary
/// stat cards (Streaming Vehicles / Total Signals / Total Batches / Signals&#160;per&#160;sec), the connection-info
/// panel (broker / uptime / topic patterns or the "no status" empty state), the Signal-Throughput area chart in a
/// <see cref="TsGlassPanel"/> (or the "collecting" note) and the Vehicle-Breakdown panel (a
/// <see cref="TsDataTable"/> with its loading / empty branches). The view is a thin renderer: all branch selection,
/// formatting and i18n happen in the view-model's <see cref="MqttInspectorDisplay"/> projection. State changes are
/// marshalled onto the UI thread; an auto-refresh timer mirrors the web 5&#160;s refetch interval.
/// </summary>
public sealed partial class MQTTInspectorPage : UserControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";   // Segoe Fluent — Refresh
    private const string WarningGlyph = "\uE7BA";   // Segoe Fluent — Warning (stale-count chip)
    private const double ChartHeight = 200;          // web ResponsiveContainer height={200}
    private const int AutoRefreshSeconds = MqttInspectorRegistration.RefreshIntervalSeconds;

    private readonly MQTTInspectorPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private DispatcherQueueTimer? _autoRefresh;
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly FontIcon _refreshIcon = new() { Glyph = RefreshGlyph, FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _refreshLabel = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsBadge _connectionBadge = new() { Dot = true, VerticalAlignment = VerticalAlignment.Center };

    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };

    private readonly TsStatCard _streamingVehiclesCard = new();
    private readonly TsStatCard _totalSignalsCard = new();
    private readonly TsStatCard _totalBatchesCard = new();
    private readonly TsStatCard _signalsPerSecCard = new();

    private readonly TsGlassPanel _connectionPanel = new();
    private readonly ContentControl _connectionHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    private readonly TsGlassPanel _throughputPanel = new();
    private readonly PanelTitle _throughputTitle = new();
    private readonly ContentControl _throughputHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    private readonly TsGlassPanel _vehiclePanel = new();
    private readonly PanelTitle _vehicleTitle = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _vehicleCountLabel = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly FontIcon _staleIcon = new() { Glyph = WarningGlyph, FontSize = 13, VerticalAlignment = VerticalAlignment.Center, Foreground = DisplayTokens.TextMuted };
    private readonly Caption _staleCountLabel = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _staleChip = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentControl _vehicleHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    private readonly TsDataTable _table = new() { PageSize = 500 };
    private readonly TsDataColumn _colVin = new() { Key = "vin", Width = 200, CanSort = false };
    private readonly TsDataColumn _colState = new() { Key = "state", Width = 110, CanSort = false };
    private readonly TsDataColumn _colSignals = new() { Key = "signals", Width = 110, CanSort = false, IsNumeric = true };
    private readonly TsDataColumn _colBatches = new() { Key = "batches", Width = 110, CanSort = false, IsNumeric = true };
    private readonly TsDataColumn _colSigPerSec = new() { Key = "sigPerSec", Width = 100, CanSort = false, IsNumeric = true };
    private readonly TsDataColumn _colLastReceived = new() { Key = "lastReceived", Width = 150, CanSort = false };
    private readonly TsDataColumn _colStatus = new() { Key = "status", Width = 100, CanSort = false };

    /// <summary>Creates the page over the default (empty) broker feed and the shell resource localizer.</summary>
    public MQTTInspectorPage()
        : this(EmptyMqttStatusFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The broker-status data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public MQTTInspectorPage(IMqttStatusFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new MQTTInspectorPageViewModel(feed, localizer);

        BuildConnectionPanel();
        BuildThroughputPanel();
        BuildVehiclePanel();
        ConfigureTableColumns();

        Content = BuildLayout();

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>MQTTInspectorPage</c>).</summary>
    public static string Slug => MqttInspectorRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_errorBanner);
        stack.Children.Add(BuildStatCards());
        stack.Children.Add(_connectionPanel);
        stack.Children.Add(_throughputPanel);
        stack.Children.Add(_vehiclePanel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private StackPanel BuildHeader()
    {
        var header = new StackPanel { Spacing = 4 };

        var topRow = new Grid();
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_title, 0);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var refreshChip = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        refreshChip.Children.Add(_refreshIcon);
        refreshChip.Children.Add(_refreshLabel);

        actions.Children.Add(refreshChip);
        actions.Children.Add(_connectionBadge);
        Grid.SetColumn(actions, 1);

        topRow.Children.Add(_title);
        topRow.Children.Add(actions);

        header.Children.Add(topRow);
        header.Children.Add(_subtitle);
        return header;
    }

    private Grid BuildStatCards() =>
        BuildEqualColumns(16, _streamingVehiclesCard, _totalSignalsCard, _totalBatchesCard, _signalsPerSecCard);

    private void BuildConnectionPanel()
    {
        var body = new StackPanel { Padding = new Thickness(20) };
        body.Children.Add(_connectionHost);
        _connectionPanel.Padding = new Thickness(0);
        _connectionPanel.Content = body;
    }

    private void BuildThroughputPanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(20) };
        body.Children.Add(_throughputTitle);
        body.Children.Add(_throughputHost);
        _throughputPanel.Padding = new Thickness(0);
        _throughputPanel.Content = body;
    }

    private void BuildVehiclePanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(20) };

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(_vehicleTitle);
        titleRow.Children.Add(_vehicleCountLabel);
        Grid.SetColumn(titleRow, 0);

        _staleChip.Children.Add(_staleIcon);
        _staleChip.Children.Add(_staleCountLabel);
        Grid.SetColumn(_staleChip, 1);

        headerRow.Children.Add(titleRow);
        headerRow.Children.Add(_staleChip);

        body.Children.Add(headerRow);
        body.Children.Add(_vehicleHost);

        _vehiclePanel.Padding = new Thickness(0);
        _vehiclePanel.Content = body;
    }

    private void ConfigureTableColumns()
    {
        _table.Columns =
        [
            _colVin, _colState, _colSignals, _colBatches, _colSigPerSec, _colLastReceived, _colStatus,
        ];
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();

        _autoRefresh ??= CreateAutoRefreshTimer();
        _autoRefresh.Start();

        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private DispatcherQueueTimer CreateAutoRefreshTimer()
    {
        var timer = _dispatcher.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(AutoRefreshSeconds);
        timer.IsRepeating = true;
        timer.Tick += OnAutoRefreshTick;
        return timer;
    }

    private void OnAutoRefreshTick(DispatcherQueueTimer sender, object args) =>
        _dispatcher.TryEnqueue(() => _ = _viewModel.RefreshAsync());

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_autoRefresh is { } timer)
        {
            timer.Stop();
            timer.Tick -= OnAutoRefreshTick;
            _autoRefresh = null;
        }

        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void Render(MqttInspectorDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        _refreshLabel.Value = display.RefreshIntervalText;
        _refreshIcon.Opacity = _viewModel.IsFetching ? 1.0 : 0.5;
        AutomationProperties.SetName(this, display.AutomationName);

        // Broker connection badge (web Connected / Disconnected Badge).
        _connectionBadge.Content = display.ConnectionText;
        _connectionBadge.Status = display.ConnectionStatus;
        AutomationProperties.SetName(_connectionBadge, display.ConnectionText);

        // Top error banner (web `error && !status` AlertBanner).
        _errorBanner.Title = display.ErrorBannerTitle;
        _errorBanner.Message = display.ErrorBannerMessage;
        _errorBanner.IsOpen = display.ShowErrorBanner;
        _errorBanner.Visibility = Show(display.ShowErrorBanner);

        // Summary stat cards.
        ApplyStatCard(_streamingVehiclesCard, display.StatCards[0]);
        ApplyStatCard(_totalSignalsCard, display.StatCards[1]);
        ApplyStatCard(_totalBatchesCard, display.StatCards[2]);
        ApplyStatCard(_signalsPerSecCard, display.StatCards[3]);

        // Connection info panel.
        _connectionHost.Content = BuildConnectionContent(display);

        // Throughput chart panel.
        _throughputTitle.Value = display.SignalThroughputTitle;
        _throughputHost.Content = BuildThroughputContent(display);

        // Vehicle breakdown panel.
        _vehicleTitle.Value = display.VehicleBreakdownTitle;
        _vehicleCountLabel.Value = display.VehicleCountText;
        _vehicleCountLabel.Visibility = Show(display.ShowVehicleCount);
        _staleCountLabel.Value = display.StaleCountText;
        _staleChip.Visibility = Show(display.ShowStaleCount);
        _vehicleHost.Content = BuildVehicleContent(display);
    }

    private static void ApplyStatCard(TsStatCard card, MqttStatCardDisplay model)
    {
        card.Label = model.Label;
        card.Value = model.Value;
        card.Glyph = model.Glyph;
        AutomationProperties.SetName(card, $"{model.Label} {model.Value}");
    }

    private static FrameworkElement BuildConnectionContent(MqttInspectorDisplay display)
    {
        if (!display.HasStatus)
        {
            return new TsEmptyState { Message = display.NoStatusMessage };
        }

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 24 };

        if (display.ShowBroker)
        {
            row.Children.Add(BuildInfoBlock(display.BrokerLabel, display.BrokerValue, mono: true));
        }

        if (display.ShowUptime)
        {
            row.Children.Add(BuildInfoBlock(display.UptimeLabel, display.UptimeValue, mono: true));
        }

        if (display.HasTopics)
        {
            row.Children.Add(BuildTopicsBlock(display));
        }
        else
        {
            row.Children.Add(new TsEmptyState { Message = display.NoTopicsMessage });
        }

        return row;
    }

    private static StackPanel BuildInfoBlock(string label, string value, bool mono)
    {
        var block = new StackPanel { Spacing = 2 };
        block.Children.Add(new Caption { Value = label });
        block.Children.Add(new TextBlock
        {
            Text = value,
            Foreground = DisplayTokens.TextPrimary,
            FontFamily = mono ? new FontFamily("Consolas") : FontFamily.XamlAutoFontFamily,
            TextWrapping = TextWrapping.Wrap,
        });
        return block;
    }

    private static StackPanel BuildTopicsBlock(MqttInspectorDisplay display)
    {
        var block = new StackPanel { Spacing = 6 };
        block.Children.Add(new Caption { Value = display.TopicPatternsLabel });

        var chips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        foreach (var topic in display.Topics)
        {
            chips.Children.Add(new TsBadge { Content = topic, Status = StatusKind.Neutral });
        }

        block.Children.Add(chips);
        return block;
    }

    private static FrameworkElement BuildThroughputContent(MqttInspectorDisplay display)
    {
        if (display.ChartReady && display.ThroughputSeries is { } series)
        {
            var content = new StackPanel { Spacing = 12 };

            var chart = new TsCartesianChart
            {
                Series = [series],
                Title = display.SignalThroughputTitle,
                Height = ChartHeight,
                IncludeZero = true,
            };
            AutomationProperties.SetName(chart, display.ChartAriaLabel);
            content.Children.Add(chart);

            var dataView = new TsChartDataView { Series = [series] };
            var expander = new Expander
            {
                Header = display.ChartAriaLabel,
                Content = dataView,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
            };
            AutomationProperties.SetName(expander, display.ChartAriaLabel);
            content.Children.Add(expander);

            return content;
        }

        return new Grid
        {
            Height = 192, // web h-48
            Children =
            {
                new TextBlock
                {
                    Text = display.CollectingDataMessage,
                    Foreground = DisplayTokens.TextMuted,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                },
            },
        };
    }

    private FrameworkElement BuildVehicleContent(MqttInspectorDisplay display)
    {
        if (display.VehiclesLoading)
        {
            return BuildSkeletonRows(3, 56); // web 3 × Skeleton h-14
        }

        _table.EmptyMessage = display.NoVehiclesMessage;
        _colVin.Header = display.VinHeader;
        _colState.Header = display.StateHeader;
        _colSignals.Header = display.SignalsHeader;
        _colBatches.Header = display.BatchesHeader;
        _colSigPerSec.Header = display.SigPerSecHeader;
        _colLastReceived.Header = display.LastReceivedHeader;
        _colStatus.Header = display.StatusHeader;
        _table.Rows = BuildTableRows(display.VehicleRows);
        AutomationProperties.SetName(_table, display.VehicleBreakdownTitle);
        return _table;
    }

    private static List<TsDataRow> BuildTableRows(IReadOnlyList<MqttVehicleRowDisplay> rows)
    {
        var built = new List<TsDataRow>(rows.Count);
        var index = 0;
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["vin"] = row.Vin,
                ["state"] = row.StateText,
                ["signals"] = row.SignalsText,
                ["batches"] = row.BatchesText,
                ["sigPerSec"] = row.SigPerSecText,
                ["lastReceived"] = row.LastReceivedText,
                ["status"] = row.StatusText,
            };
            built.Add(new TsDataRow($"{index}:{row.Vin}", values));
            index++;
        }

        return built;
    }

    private static StackPanel BuildSkeletonRows(int count, double height)
    {
        var stack = new StackPanel { Spacing = 8 };
        for (var i = 0; i < count; i++)
        {
            stack.Children.Add(new TsSkeleton { BlockHeight = height });
        }

        return stack;
    }

    private static Grid BuildEqualColumns(double spacing, params FrameworkElement[] children)
    {
        var grid = new Grid { ColumnSpacing = spacing };
        for (var i = 0; i < children.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(children[i], i);
            grid.Children.Add(children[i]);
        }

        return grid;
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
