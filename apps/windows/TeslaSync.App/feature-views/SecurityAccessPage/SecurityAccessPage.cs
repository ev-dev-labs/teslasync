using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>SecurityAccessPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/SecurityAccessPage.tsx</c> (route <c>/security-access</c>, nav name
/// <c>SecurityAccess</c>). It binds to a <see cref="SecurityAccessPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle + vehicle picker + data-freshness), the
/// load-failure <see cref="InfoBar"/> (web <c>AlertBanner</c>), the security-alert <see cref="TsGlassPanel"/>
/// (GlassPanel1), the live vehicle-state <see cref="TsGlassPanel"/> (GlassPanel2) with the lock/sentry/door/window
/// status rows, the summary stat cards, the event-history <see cref="TsDataTable"/> and the event timeline — each
/// with its loading / empty / error surface. The view is a thin renderer: all branch selection, formatting and i18n
/// happen in the view-model's <see cref="SecurityAccessDisplay"/> projection. State changes are marshalled onto the
/// UI thread.
/// </summary>
public sealed partial class SecurityAccessPage : UserControl, IDisposable
{
    private const string AlertGlyph = "\uE7BA";
    private const string LockGlyph = "\uE72E";
    private const string ClockGlyph = "\uE823";
    private const double SectionSpacing = 20;
    private const double PanelPadding = 20;

    private readonly SecurityAccessPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressVehicleChange;

    // ── Scaffold + header ──
    private readonly TsPageContainer _scaffold = new();
    private readonly TsVehicleSelect _vehicleSelect = new() { MinWidth = 220 };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    // ── Load-failure banner (web AlertBanner) ──
    private readonly InfoBar _errorBar = new()
    {
        IsClosable = false,
        Severity = InfoBarSeverity.Error,
        IsOpen = false,
        Visibility = Visibility.Collapsed,
    };

    private readonly Button _retryButton = new();

    // ── GlassPanel1: security alert ──
    private readonly TsGlassPanel _alertPanel = new();
    private readonly FontIcon _alertIcon = new() { Glyph = AlertGlyph, FontSize = 20 };
    private readonly Text _alertText = new();

    // ── Summary stat cards (web SummaryStatsRow) ──
    private readonly TsStatCard _statStatus = new();
    private readonly TsStatCard _statLastLock = new();
    private readonly TsStatCard _statSentry = new();
    private readonly TsStatCard _statTotal = new();

    // ── GlassPanel2: live vehicle state ──
    private readonly TsGlassPanel _livePanel = new();
    private readonly PanelTitle _liveTitle = new();
    private readonly StackPanel _statusList = new() { Spacing = 8 };
    private readonly StackPanel _liveList = new() { Spacing = 6 };
    private readonly TsEmptyState _liveEmpty = new() { IconGlyph = LockGlyph, Visibility = Visibility.Collapsed };

    // ── Event history table ──
    private readonly TsGlassPanel _historyPanel = new();
    private readonly PanelTitle _historyTitle = new();
    private readonly TsDataTable _historyTable = new() { Selectable = false };

    // ── Event timeline ──
    private readonly TsGlassPanel _timelinePanel = new();
    private readonly PanelTitle _timelineTitle = new();
    private readonly StackPanel _timelineList = new() { Spacing = 10 };
    private readonly TsEmptyState _timelineEmpty = new() { IconGlyph = ClockGlyph, Visibility = Visibility.Collapsed };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public SecurityAccessPage()
        : this(EmptySecurityAccessFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The security-access data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SecurityAccessPage(ISecurityAccessFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SecurityAccessPageViewModel(feed, localizer);

        Content = BuildLayout();

        _retryButton.Click += OnRetryClicked;
        _errorBar.ActionButton = _retryButton;

        _vehicleSelect.SelectionChanged += OnVehicleSelectionChanged;
        _vehicleSelect.RetryRequested += OnRetryInvoked;
        _scaffold.RetryRequested += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>SecurityAccess</c>).</summary>
    public static string RouteName => SecurityAccessRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public SecurityAccessPageViewModel ViewModel => _viewModel;

    private TsPageContainer BuildLayout()
    {
        _scaffold.AddHeaderAction(_vehicleSelect);
        _scaffold.AddHeaderAction(_freshness);
        _scaffold.PageContent = BuildScrollableContent();
        return _scaffold;
    }

    private ScrollViewer BuildScrollableContent()
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(_errorBar);
        stack.Children.Add(BuildAlertPanel());
        stack.Children.Add(BuildSummaryRow());
        stack.Children.Add(BuildLivePanel());
        stack.Children.Add(BuildHistoryPanel());
        stack.Children.Add(BuildTimelinePanel());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private TsGlassPanel BuildAlertPanel()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _alertIcon.Foreground = TypographyTokens.Brush("TsColorDangerBrush");
        _alertText.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(_alertIcon);
        row.Children.Add(_alertText);

        _alertPanel.Padding = new Thickness(16);
        _alertPanel.Content = row;
        AutomationProperties.SetName(_alertPanel, "Security alert");
        return _alertPanel;
    }

    private Grid BuildSummaryRow() =>
        BuildEqualColumns(16, _statStatus, _statLastLock, _statSentry, _statTotal);

    private TsGlassPanel BuildLivePanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(PanelPadding) };
        body.Children.Add(_liveTitle);
        body.Children.Add(_statusList);
        body.Children.Add(_liveList);
        body.Children.Add(_liveEmpty);

        _livePanel.Content = body;
        AutomationProperties.SetName(_livePanel, "Live vehicle state");
        return _livePanel;
    }

    private TsGlassPanel BuildHistoryPanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(PanelPadding) };
        body.Children.Add(_historyTitle);
        body.Children.Add(_historyTable);

        _historyPanel.Content = body;
        AutomationProperties.SetName(_historyPanel, "Security event history");
        return _historyPanel;
    }

    private TsGlassPanel BuildTimelinePanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(PanelPadding) };
        body.Children.Add(_timelineTitle);
        body.Children.Add(_timelineList);
        body.Children.Add(_timelineEmpty);

        _timelinePanel.Content = body;
        AutomationProperties.SetName(_timelinePanel, "Security event timeline");
        return _timelinePanel;
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
        _retryButton.Click -= OnRetryClicked;
        _vehicleSelect.SelectionChanged -= OnVehicleSelectionChanged;
        _vehicleSelect.RetryRequested -= OnRetryInvoked;
        _scaffold.RetryRequested -= OnRetryInvoked;
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

    private void Render(SecurityAccessDisplay display)
    {
        _scaffold.Title = display.Title;
        _scaffold.Subtitle = display.Subtitle;
        _scaffold.IsLoading = display.ShowLoading;
        AutomationProperties.SetName(this, display.AutomationName);

        RenderVehicleSelect();
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        // Load-failure banner (web AlertBanner over content).
        _errorBar.Message = display.ErrorText;
        _errorBar.IsOpen = display.ShowErrorBanner;
        _errorBar.Visibility = Show(display.ShowErrorBanner);
        _retryButton.Content = display.RetryLabel;

        // GlassPanel1: security alert.
        _alertText.Value = display.AlertText;
        _alertPanel.Visibility = Show(display.ShowAlert);

        // Summary stat cards.
        RenderStat(_statStatus, display.SummaryStats, 0);
        RenderStat(_statLastLock, display.SummaryStats, 1);
        RenderStat(_statSentry, display.SummaryStats, 2);
        RenderStat(_statTotal, display.SummaryStats, 3);

        // GlassPanel2: live vehicle state.
        _liveTitle.Value = display.LiveTitle;
        RenderStatusList(display.StatusItems);
        RenderLiveList(display.LiveItems);
        bool hasLive = display.HasLatest;
        _statusList.Visibility = Show(hasLive);
        _liveList.Visibility = Show(hasLive);
        _liveEmpty.Title = display.LiveEmptyMessage;
        _liveEmpty.Visibility = Show(!hasLive);
        AutomationProperties.SetName(_liveEmpty, display.LiveEmptyMessage);

        // Event history table.
        _historyTitle.Value = display.HistoryTitle;
        _historyTable.Columns = BuildColumns(display.Columns);
        _historyTable.Rows = BuildRows(display.Rows);
        _historyTable.EmptyMessage = display.HistoryEmptyMessage;
        AutomationProperties.SetName(_historyTable, display.HistoryTitle);

        // Event timeline.
        _timelineTitle.Value = display.TimelineTitle;
        RenderTimeline(display.Timeline);
        bool hasTimeline = display.Timeline.Count > 0;
        _timelineList.Visibility = Show(hasTimeline);
        _timelineEmpty.Title = display.TimelineEmptyMessage;
        _timelineEmpty.Visibility = Show(!hasTimeline);
        AutomationProperties.SetName(_timelineEmpty, display.TimelineEmptyMessage);
    }

    private void RenderVehicleSelect()
    {
        _suppressVehicleChange = true;
        try
        {
            if (_viewModel.VehiclesLoading)
            {
                _vehicleSelect.SetLoading();
            }
            else if (_viewModel.VehiclesError is { } error)
            {
                _vehicleSelect.SetError(error);
            }
            else
            {
                _vehicleSelect.SetLoaded(_viewModel.Vehicles);
            }

            _vehicleSelect.SelectedId = _viewModel.SelectedVehicleId;
        }
        finally
        {
            _suppressVehicleChange = false;
        }
    }

    private static void RenderStat(TsStatCard card, IReadOnlyList<SecuritySummaryStat> stats, int index)
    {
        if (index >= stats.Count)
        {
            return;
        }

        SecuritySummaryStat stat = stats[index];
        card.Label = stat.Label;
        card.Value = stat.Value;
        card.Sublabel = stat.Sub;
    }

    private void RenderStatusList(IReadOnlyList<SecurityStatusItem> items)
    {
        _statusList.Children.Clear();
        foreach (var item in items)
        {
            var grid = new Grid { ColumnSpacing = 12 };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var label = new Caption { Value = item.Label, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(label, 0);

            var badge = new TsBadge { Status = ToStatusKind(item.Tone), Content = item.Value };
            Grid.SetColumn(badge, 1);

            grid.Children.Add(label);
            grid.Children.Add(badge);
            AutomationProperties.SetName(grid, $"{item.Label}: {item.Value}");
            _statusList.Children.Add(grid);
        }
    }

    private void RenderLiveList(IReadOnlyList<SecurityLiveItem> items)
    {
        _liveList.Children.Clear();
        foreach (var item in items)
        {
            var grid = new Grid { ColumnSpacing = 12 };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var label = new Caption { Value = item.Label, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(label, 0);

            var value = new Text { Value = item.Value, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(value, 1);

            grid.Children.Add(label);
            grid.Children.Add(value);
            _liveList.Children.Add(grid);
        }
    }

    private void RenderTimeline(IReadOnlyList<SecurityTimelineRow> rows)
    {
        _timelineList.Children.Clear();
        foreach (var row in rows)
        {
            var item = new StackPanel { Spacing = 2 };

            var heading = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var dot = new TsBadge { Status = ToStatusKind(row.Tone), Dot = true, Content = row.Title };
            heading.Children.Add(dot);
            item.Children.Add(heading);

            string sub = string.IsNullOrEmpty(row.Detail) ? row.Time : $"{row.Detail} \u00b7 {row.Time}";
            item.Children.Add(new Caption { Value = sub });

            AutomationProperties.SetName(item, $"{row.Title}, {sub}");
            _timelineList.Children.Add(item);
        }
    }

    private static List<TsDataColumn> BuildColumns(IReadOnlyList<SecurityEventColumn> columns)
    {
        var built = new List<TsDataColumn>(columns.Count);
        foreach (var column in columns)
        {
            built.Add(new TsDataColumn
            {
                Key = column.Key,
                Header = column.Header,
                IsNumeric = column.IsNumeric,
            });
        }

        return built;
    }

    private static List<TsDataRow> BuildRows(IReadOnlyList<SecurityEventRow> rows)
    {
        var built = new List<TsDataRow>(rows.Count);
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["time"] = row.Time,
                ["lock"] = row.Lock,
                ["sentry"] = row.Sentry,
                ["doors"] = row.Doors,
                ["windows"] = row.Windows,
            };
            built.Add(new TsDataRow(row.Id, values));
        }

        return built;
    }

    private void OnVehicleSelectionChanged(object? sender, long? vehicleId)
    {
        if (_suppressVehicleChange)
        {
            return;
        }

        InvokeAsync(() => _viewModel.SetVehicleAsync(vehicleId));
    }

    private void OnRetryClicked(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static StatusKind ToStatusKind(SecurityTone tone) => tone switch
    {
        SecurityTone.Good => StatusKind.Success,
        SecurityTone.Warn => StatusKind.Warning,
        SecurityTone.Bad => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    protected override AutomationPeer OnCreateAutomationPeer() => new SecurityAccessPageAutomationPeer(this);

    private sealed class SecurityAccessPageAutomationPeer(SecurityAccessPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
