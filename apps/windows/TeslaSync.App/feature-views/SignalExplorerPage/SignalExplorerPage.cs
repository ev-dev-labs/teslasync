using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The native WinUI 3 <c>SignalExplorerPage</c> — a parity port of the web page
/// <c>web/src/features/telemetry/pages/SignalExplorerPage.tsx</c> (route <c>/signal-explorer</c>, nav name
/// <c>SignalExplorer</c>). It binds to a <see cref="SignalExplorerPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle + vehicle picker + the live-connection
/// badge), the failure banner (web <c>anyError</c>), the no-vehicle empty state (web <c>vehicleId === 0</c>), the
/// explore-controls panel (GlassPanel1 — the shared <see cref="SignalSelector"/>, the time-range picker, the
/// per-page picker, the Explore button, the Live toggle and the live help affordance), the pre-explore empty state
/// and the results region (the shared <see cref="SignalStatsPanel"/> and <see cref="SignalChartPanel"/> the subtitle
/// promises, plus the SignalHistoryTable port — loading skeleton, the data table and the no-data empty state). The
/// view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="SignalExplorerDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class SignalExplorerPage : UserControl, IDisposable
{
    private const string ActivityGlyph = "\uE9D2"; // pulse (web Activity icon)
    private const string DatabaseGlyph = "\uE9D9"; // data / explore (web Database icon)
    private const string RadioGlyph = "\uE93C";    // Radio (web live-stream icon)

    private readonly SignalExplorerPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressEvents;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsSelect _vehicleSelect = new() { MinWidth = 200 };
    private readonly TsBadge _liveBadge = new() { Dot = true, Visibility = Visibility.Collapsed };

    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };
    private readonly TsPageLoadSkeleton _loadingSkeleton = new();
    private readonly StackPanel _content = new() { Spacing = 16 };

    private readonly TsEmptyState _noVehicleEmpty = new() { IconGlyph = ActivityGlyph };

    private readonly TsGlassPanel _controlsPanel = new();
    private readonly SignalSelector _signalSelector;
    private readonly Caption _timeRangeLabel = new();
    private readonly TsRangePicker _rangePicker = new();
    private readonly TsSelect _perPageSelect = new() { MinWidth = 96 };
    private readonly TsButton _exploreButton = new() { Variant = ButtonVariant.Primary, IconGlyph = DatabaseGlyph };
    private readonly TsButton _liveButton = new() { Variant = ButtonVariant.Outline, IconGlyph = RadioGlyph };
    private readonly TsHelpTooltip _help = new();

    private readonly TsEmptyState _preExploreEmpty = new() { IconGlyph = DatabaseGlyph };

    private readonly SignalStatsPanel _statsPanel;
    private readonly SignalChartPanel _chartPanel;

    private readonly TsGlassPanel _resultsPanel = new();
    private readonly PanelTitle _resultsTitle = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _resultsMeta = new() { HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsTableSkeleton _resultsLoading = new();
    private readonly TsDataTable _resultsTable = new();
    private readonly TsEmptyState _resultsEmpty = new() { IconGlyph = ActivityGlyph };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public SignalExplorerPage()
        : this(EmptySignalExplorerFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The vehicles / available-signals / history data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SignalExplorerPage(ISignalExplorerFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new SignalExplorerPageViewModel(feed, localizer);
        _signalSelector = new SignalSelector(localizer) { Max = SignalExplorerProjection.MaxSignals };
        _statsPanel = new SignalStatsPanel(localizer);
        _chartPanel = new SignalChartPanel(localizer);

        BuildContent();
        Content = BuildLayout();

        _vehicleSelect.SelectionChanged += OnVehicleChanged;
        _signalSelector.SelectionChanged += OnSignalsChanged;
        _rangePicker.RangeChanged += OnRangeChanged;
        _perPageSelect.SelectionChanged += OnPerPageChanged;
        _exploreButton.Click += OnExploreClick;
        _liveButton.Click += OnLiveClick;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>SignalExplorerPage</c>).</summary>
    public static string Slug => SignalExplorerRegistration.Slug;

    /// <summary>
    /// The P1/S4 live-stream seam — the SSE wiring calls this as the connection state changes so the header badge
    /// reflects the stream (web <c>live.connected</c>). Marshalled onto the UI thread.
    /// </summary>
    public void UpdateLiveState(bool connected)
    {
        if (_dispatcher.HasThreadAccess)
        {
            _viewModel.UpdateLiveState(connected);
        }
        else
        {
            _dispatcher.TryEnqueue(() => _viewModel.UpdateLiveState(connected));
        }
    }

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_errorBanner);
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_noVehicleEmpty);
        stack.Children.Add(_content);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var heading = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);

        _vehicleSelect.DisplayMemberPath = nameof(SignalExplorerVehicleOption.Label);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(_vehicleSelect);
        actions.Children.Add(_liveBadge);

        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(heading, 0);
        Grid.SetColumn(actions, 1);
        grid.Children.Add(heading);
        grid.Children.Add(actions);
        return grid;
    }

    private void BuildContent()
    {
        _content.Children.Add(BuildControlsPanel());
        _content.Children.Add(_preExploreEmpty);
        _content.Children.Add(_statsPanel);
        _content.Children.Add(_chartPanel);
        _content.Children.Add(BuildResultsPanel());
    }

    private TsGlassPanel BuildControlsPanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(20) };
        body.Children.Add(_signalSelector);

        // Left: time-range label + picker. Right: per-page picker, Explore, Live, help.
        var rangeColumn = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Bottom };
        rangeColumn.Children.Add(_timeRangeLabel);
        rangeColumn.Children.Add(_rangePicker);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Bottom,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        _perPageSelect.DisplayMemberPath = nameof(SignalExplorerPerPageOption.Label);
        _exploreButton.VerticalAlignment = VerticalAlignment.Bottom;
        _liveButton.VerticalAlignment = VerticalAlignment.Bottom;
        _help.VerticalAlignment = VerticalAlignment.Bottom;
        actions.Children.Add(_perPageSelect);
        actions.Children.Add(_exploreButton);
        actions.Children.Add(_liveButton);
        actions.Children.Add(_help);

        var row = new Grid { ColumnSpacing = 16 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(rangeColumn, 0);
        Grid.SetColumn(actions, 1);
        row.Children.Add(rangeColumn);
        row.Children.Add(actions);
        body.Children.Add(row);

        _controlsPanel.Content = body;
        return _controlsPanel;
    }

    private TsGlassPanel BuildResultsPanel()
    {
        var icon = new FontIcon { Glyph = ActivityGlyph, FontSize = 14, Foreground = Brush("TsColorTextSecondaryBrush"), VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var header = new Grid { ColumnSpacing = 8, Margin = new Thickness(0, 0, 0, 12) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(_resultsTitle, 1);
        Grid.SetColumn(_resultsMeta, 2);
        header.Children.Add(icon);
        header.Children.Add(_resultsTitle);
        header.Children.Add(_resultsMeta);

        var body = new StackPanel { Spacing = 8, Padding = new Thickness(20) };
        body.Children.Add(header);
        body.Children.Add(_resultsLoading);
        body.Children.Add(_resultsTable);
        body.Children.Add(_resultsEmpty);

        _resultsPanel.Content = body;
        return _resultsPanel;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        _signalSelector.Dispose();
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

    private void Render(SignalExplorerDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Header — vehicle picker (web VehicleSelect).
        _vehicleSelect.ItemsSource = display.VehicleOptions;
        _vehicleSelect.SelectedItem = display.VehicleOptions.FirstOrDefault(o => o.Id == display.SelectedVehicleId);
        _vehicleSelect.Visibility = Show(display.VehicleOptions.Count > 0);
        AutomationProperties.SetName(_vehicleSelect, display.SelectVehicleLabel);

        // Header — live connection badge (web `isLive ? <Badge>` connected/disconnected).
        _liveBadge.Content = display.LiveBadgeText;
        _liveBadge.Status = display.LiveBadgeConnected ? StatusKind.Success : StatusKind.Danger;
        _liveBadge.Visibility = Show(display.ShowLiveBadge);

        // Failure banner (web anyError).
        _errorBanner.IsOpen = display.HasError;
        _errorBanner.Visibility = Show(display.HasError);
        _errorBanner.Message = display.ErrorBannerText;

        // Loading scaffold vs the body.
        _loadingSkeleton.Visibility = Show(display.ShowLoading);
        _content.Visibility = Show(!display.ShowLoading);

        // No-vehicle empty state (web vehicleId === 0).
        _noVehicleEmpty.Visibility = Show(display.ShowNoVehicle);
        _noVehicleEmpty.Title = display.NoVehicleTitle;
        _noVehicleEmpty.Message = display.NoVehicleMessage;

        // GlassPanel1 — the explore controls.
        _controlsPanel.Visibility = Show(display.ShowControls);
        AutomationProperties.SetName(_controlsPanel, display.Title);
        if (display.ShowControls)
        {
            _signalSelector.SetSignals(display.AvailableSignals);
            _signalSelector.SetSelected(display.SelectedSignals);

            _timeRangeLabel.Value = display.TimeRangeLabel;
            _rangePicker.Range = display.Range;
            AutomationProperties.SetName(_rangePicker, display.TimeRangeLabel);

            _perPageSelect.Header = display.PerPageLabel;
            _perPageSelect.ItemsSource = display.PerPageOptions;
            _perPageSelect.SelectedItem = display.PerPageOptions.FirstOrDefault(o => o.Value == display.PerPage);
            _perPageSelect.Visibility = Show(display.ShowPerPage);
            AutomationProperties.SetName(_perPageSelect, display.PerPageLabel);

            _exploreButton.Text = display.ExploreLabel;
            _exploreButton.IsEnabled = display.CanExplore;
            _exploreButton.IsLoading = display.IsFetching;
            _exploreButton.Visibility = Show(display.ShowExplore);
            AutomationProperties.SetName(_exploreButton, display.ExploreLabel);

            _liveButton.Text = display.LiveButtonText;
            _liveButton.Variant = display.LiveButtonIsDestructive ? ButtonVariant.Destructive : ButtonVariant.Outline;
            _liveButton.IsEnabled = display.CanToggleLive;
            AutomationProperties.SetName(_liveButton, display.LiveButtonText);

            _help.Hint = display.HelpLiveAria;
            AutomationProperties.SetName(_help, display.HelpLiveAria);
        }

        // Pre-explore empty state (web "Pick signals and click Explore").
        _preExploreEmpty.Visibility = Show(display.ShowPreExploreEmpty);
        _preExploreEmpty.Title = display.PreExploreEmptyTitle;
        _preExploreEmpty.Message = display.PreExploreEmptyMessage;

        // Stats panel (web `activeStats.length > 0 ? <SignalStatsPanel>`).
        _statsPanel.Visibility = Show(display.ShowStats);
        if (display.ShowStats)
        {
            _statsPanel.Model = new SignalStatsModel(display.Stats, display.SelectedSignals, display.HistoryLoading);
        }

        // Chart panel (web <SignalChartPanel> — the subtitle's promised chart).
        _chartPanel.Visibility = Show(display.ShowResults);
        if (display.ShowResults)
        {
            _chartPanel.Model = display.IsLive
                ? new SignalChartPanelModel(
                    display.SelectedSignals,
                    Array.Empty<SignalChartSample>(),
                    Array.Empty<SignalChartStat>())
                { IsLive = true }
                : new SignalChartPanelModel(display.SelectedSignals, display.ChartSamples, display.ChartStats)
                { Loading = display.HistoryLoading, PointsLoaded = display.PointsLoaded };
        }

        // Results region (web SignalHistoryTable — only in historical mode after Explore).
        _resultsPanel.Visibility = Show(display.ShowHistoryTable);
        AutomationProperties.SetName(_resultsPanel, display.ResultsTitle);
        if (display.ShowHistoryTable)
        {
            _resultsTitle.Value = display.ResultsTitle;
            _resultsMeta.Value = display.ResultsMetaText;

            _resultsLoading.Visibility = Show(display.HistoryLoading);

            _resultsTable.Visibility = Show(display.ShowResultsTable);
            if (display.ShowResultsTable)
            {
                _resultsTable.Columns = BuildColumns(display.Columns);
                _resultsTable.Rows = BuildRows(display.Rows);
                _resultsTable.PageSize = display.PerPage;
                _resultsTable.EmptyMessage = display.EmptyResultsMessage;
            }

            _resultsEmpty.Visibility = Show(display.ShowEmptyResults);
            _resultsEmpty.Title = display.EmptyResultsTitle;
            _resultsEmpty.Message = display.EmptyResultsMessage;
        }

        _suppressEvents = false;
    }

    private static List<TsDataColumn> BuildColumns(IReadOnlyList<SignalExplorerColumnDisplay> columns)
    {
        var result = new List<TsDataColumn>(columns.Count);
        foreach (var column in columns)
        {
            result.Add(new TsDataColumn { Key = column.Key, Header = column.Header });
        }

        return result;
    }

    private static List<TsDataRow> BuildRows(IReadOnlyList<SignalExplorerRowDisplay> rows)
    {
        var result = new List<TsDataRow>(rows.Count);
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["time"] = row.Timestamp,
                ["signal"] = row.Signal,
                ["value"] = row.Value,
                ["type"] = row.TypeLabel,
            };
            result.Add(new TsDataRow(row.RowKey, values));
        }

        return result;
    }

    private void OnVehicleChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents || _vehicleSelect.SelectedItem is not SignalExplorerVehicleOption option)
        {
            return;
        }

        if (option.Id != _viewModel.SelectedVehicleId)
        {
            InvokeAsync(() => _viewModel.SelectVehicleAsync(option.Id));
        }
    }

    private void OnSignalsChanged(object? sender, IReadOnlyList<string> selection)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetSelectedSignals(selection);
    }

    private void OnRangeChanged(object? sender, DateRange range)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetRange(range);
    }

    private void OnPerPageChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents || _perPageSelect.SelectedItem is not SignalExplorerPerPageOption option)
        {
            return;
        }

        _viewModel.SetPerPage(option.Value);
    }

    private void OnExploreClick(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        InvokeAsync(() => _viewModel.ExploreAsync());
    }

    private void OnLiveClick(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.ToggleLive();
    }

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Microsoft.UI.Xaml.Media.Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value)
        && value is Microsoft.UI.Xaml.Media.Brush brush ? brush : null;
}
