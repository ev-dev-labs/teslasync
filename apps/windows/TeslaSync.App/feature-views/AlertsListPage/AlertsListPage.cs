using System.Collections.Generic;
using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The native WinUI 3 <c>AlertsListPage</c> — a parity port of the web page
/// <c>web/src/features/notifications/pages/AlertsListPage.tsx</c> (route <c>/notifications/alerts</c>, nav name
/// <c>NotificationsAlerts</c>). It binds an <see cref="AlertsListPageViewModel"/> and renders every web region
/// with Fluent components and design tokens: the title + subtitle + quiet-hours badge, the KPI overview (six
/// metric tiles — Total / Critical / Warnings / Info / Unread / Read-rate — a secondary summary line and the
/// critical callout), the 7-day trend bar chart, the by-type pie chart, the pinned "Watching" panel, the filter
/// bar (search + All/Unread/Critical tabs + active chips), the paged alert-card list (the shared
/// <see cref="AlertCard"/> surface) with its empty branches and pagination, plus the acknowledge + audit-timeline
/// flows. The view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="AlertsListDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class AlertsListPage : UserControl, IDisposable
{
    private const string AlertGlyph = "\uEA8F";          // Segoe Fluent "Ringer".
    private const string FilterGlyph = "\uE71C";          // Segoe Fluent "Filter".
    private const string MutedGlyph = "\uE7ED";           // Segoe Fluent "Mute" (no-alerts empty state).
    private const string ClearGlyph = "\uE711";           // Segoe Fluent "Cancel".
    private const int MetricColumns = 3;

    private readonly AlertsListPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsBadge _quietBadge = new() { Status = StatusKind.Info, Visibility = Visibility.Collapsed };

    private readonly StackPanel _loadingPanel;
    private readonly TsErrorDisplay _errorState = new() { IconGlyph = AlertGlyph };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = MutedGlyph };

    private readonly StackPanel _content = new() { Spacing = 24 };

    // Overview ---------------------------------------------------------------------------------------------
    private readonly TsGlassPanel _overviewPanel = new();
    private readonly PanelTitle _overviewTitle = new();
    private readonly Grid _metricsGrid = new() { ColumnSpacing = 12, RowSpacing = 12 };
    private readonly StackPanel _secondaryLine = new() { Orientation = Orientation.Horizontal, Spacing = 10 };
    private readonly TsInlineCallout _criticalCallout = new() { Variant = CalloutVariant.Danger, Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _overviewEmpty = new() { IconGlyph = MutedGlyph, Visibility = Visibility.Collapsed };

    // Charts -----------------------------------------------------------------------------------------------
    private readonly TsGlassPanel _trendPanel = new();
    private readonly PanelTitle _trendTitle = new();
    private readonly TsBarChart _trendChart = new() { Height = 200, IncludeZero = true, ShowLegend = true };
    private readonly TsGlassPanel _typePanel = new();
    private readonly PanelTitle _typeTitle = new();
    private readonly TsPieChart _typeChart = new() { InnerRadiusRatio = 0.55, MinHeight = 180 };
    private readonly StackPanel _typeLegend = new() { Spacing = 6 };
    private readonly Grid _chartsRow = new() { ColumnSpacing = 24 };

    // Pinned -----------------------------------------------------------------------------------------------
    private readonly TsGlassPanel _pinnedPanel = new() { Visibility = Visibility.Collapsed };
    private readonly Label _pinnedHeader = new();
    private readonly StackPanel _pinnedList = new() { Spacing = 0 };

    // Filter bar -------------------------------------------------------------------------------------------
    private readonly TsSearchInput _search = new();
    private readonly StackPanel _tabsPanel = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly StackPanel _chipsPanel = new() { Orientation = Orientation.Horizontal, Spacing = 8 };

    // List -------------------------------------------------------------------------------------------------
    private readonly StackPanel _listPanel = new() { Spacing = 8 };
    private readonly TsEmptyState _listEmpty = new() { IconGlyph = MutedGlyph, Visibility = Visibility.Collapsed };
    private readonly StackPanel _pagination = new() { Orientation = Orientation.Horizontal, Spacing = 4, HorizontalAlignment = HorizontalAlignment.Right, Visibility = Visibility.Collapsed };
    private readonly Caption _pageLabel = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _firstButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, Text = "\u00AB" };
    private readonly TsButton _prevButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, Text = "\u2039" };
    private readonly TsButton _nextButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, Text = "\u203A" };
    private readonly TsButton _lastButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, Text = "\u00BB" };

    // Acknowledge / mark-read transient feedback (web toast) ----------------------------------------------
    private readonly TsInlineCallout _feedbackCallout = new() { Variant = CalloutVariant.Success, Dismissible = true, Visibility = Visibility.Collapsed };
    private long _lastAcknowledgedId;

    /// <summary>Raised when an affordance requests navigation (web router push) — drill-through, view-critical, studio.</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>Creates the page over the default empty-state feed and the shell resource localizer.</summary>
    public AlertsListPage()
        : this(EmptyAlertsFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The alerts + rules + pins data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public AlertsListPage(IAlertsFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new AlertsListPageViewModel(feed, localizer);

        _loadingPanel = BuildLoadingPanel();
        Content = BuildLayout();

        _search.QueryChanged += OnSearchChanged;
        _errorState.ActionInvoked += OnRetryInvoked;
        _criticalCallout.ActionInvoked += OnViewCritical;
        _feedbackCallout.ActionInvoked += OnUndoAcknowledge;
        _firstButton.Click += (_, _) => _viewModel.SetPage(1);
        _prevButton.Click += (_, _) => _viewModel.SetPage(_viewModel.Page - 1);
        _nextButton.Click += (_, _) => _viewModel.SetPage(_viewModel.Page + 1);
        _lastButton.Click += (_, _) => _viewModel.SetPage(_viewModel.Display.TotalPages);

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>AlertsListPage</c>).</summary>
    public static string Slug => AlertsListRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public AlertsListPageViewModel ViewModel => _viewModel;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };

        var header = new StackPanel { Spacing = 4 };
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        titleRow.Children.Add(_title);
        _quietBadge.VerticalAlignment = VerticalAlignment.Center;
        titleRow.Children.Add(_quietBadge);
        header.Children.Add(titleRow);
        header.Children.Add(_subtitle);

        stack.Children.Add(header);
        stack.Children.Add(_feedbackCallout);
        stack.Children.Add(_loadingPanel);
        stack.Children.Add(_errorState);
        stack.Children.Add(_emptyState);

        BuildContent();
        stack.Children.Add(_content);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private void BuildContent()
    {
        _content.Children.Add(BuildOverviewPanel());
        _content.Children.Add(BuildChartsRow());
        _content.Children.Add(BuildPinnedPanel());
        _content.Children.Add(BuildFilterBar());
        _content.Children.Add(_listPanel);
        _content.Children.Add(_listEmpty);
        _content.Children.Add(_pagination);

        _pagination.Children.Add(_firstButton);
        _pagination.Children.Add(_prevButton);
        _pageLabel.Margin = new Thickness(8, 0, 8, 0);
        _pagination.Children.Add(_pageLabel);
        _pagination.Children.Add(_nextButton);
        _pagination.Children.Add(_lastButton);
    }

    private TsGlassPanel BuildOverviewPanel()
    {
        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(_overviewTitle);
        body.Children.Add(_metricsGrid);
        body.Children.Add(_secondaryLine);
        body.Children.Add(_criticalCallout);
        body.Children.Add(_overviewEmpty);

        for (int c = 0; c < MetricColumns; c++)
        {
            _metricsGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        _overviewPanel.Content = body;
        return _overviewPanel;
    }

    private Grid BuildChartsRow()
    {
        _chartsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _chartsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var trendBody = new StackPanel { Spacing = 12 };
        trendBody.Children.Add(_trendTitle);
        trendBody.Children.Add(_trendChart);
        _trendPanel.Content = trendBody;
        Grid.SetColumn(_trendPanel, 0);
        _chartsRow.Children.Add(_trendPanel);

        var typeBody = new StackPanel { Spacing = 12 };
        typeBody.Children.Add(_typeTitle);
        var typeContent = new Grid { ColumnSpacing = 12 };
        typeContent.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(3, GridUnitType.Star) });
        typeContent.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        Grid.SetColumn(_typeChart, 0);
        _typeLegend.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_typeLegend, 1);
        typeContent.Children.Add(_typeChart);
        typeContent.Children.Add(_typeLegend);
        typeBody.Children.Add(typeContent);
        _typePanel.Content = typeBody;
        Grid.SetColumn(_typePanel, 1);
        _chartsRow.Children.Add(_typePanel);

        return _chartsRow;
    }

    private TsGlassPanel BuildPinnedPanel()
    {
        var body = new StackPanel { Spacing = 8 };
        body.Children.Add(_pinnedHeader);
        body.Children.Add(_pinnedList);
        _pinnedPanel.Content = body;
        return _pinnedPanel;
    }

    private StackPanel BuildFilterBar()
    {
        _search.MinWidth = 260;
        _search.HorizontalAlignment = HorizontalAlignment.Left;

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        row.Children.Add(_search);

        var filterGroup = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        filterGroup.Children.Add(new FontIcon { Glyph = FilterGlyph, FontSize = 14, VerticalAlignment = VerticalAlignment.Center });
        filterGroup.Children.Add(_tabsPanel);
        row.Children.Add(filterGroup);

        var bar = new StackPanel { Spacing = 8 };
        bar.Children.Add(row);
        bar.Children.Add(_chipsPanel);
        return bar;
    }

    private static StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel { Spacing = 12, Visibility = Visibility.Collapsed };
        for (int i = 0; i < 5; i++)
        {
            panel.Children.Add(new TsSkeleton { BlockHeight = 80, HorizontalAlignment = HorizontalAlignment.Stretch });
        }

        return panel;
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
        _search.QueryChanged -= OnSearchChanged;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _criticalCallout.ActionInvoked -= OnViewCritical;
        _feedbackCallout.ActionInvoked -= OnUndoAcknowledge;
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

    private void Render(AlertsListDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.Title);

        _quietBadge.Content = display.QuietHoursBadge;
        _quietBadge.Visibility = Show(display.QuietHoursActive);

        _loadingPanel.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.HasError);
        _errorState.Title = display.ListEmptyTitle;
        _errorState.ActionText = _localizer.GetString("common.retry", "Retry");

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Title = display.OverviewEmptyTitle;
        _emptyState.Message = display.OverviewEmptyMessage;

        _content.Visibility = Show(display.ShowContent);
        if (!display.ShowContent)
        {
            return;
        }

        RenderOverview(display);
        RenderCharts(display);
        RenderPinned(display);
        RenderFilters(display);
        RenderList(display);
        RenderPagination(display);
    }

    private void RenderOverview(AlertsListDisplay display)
    {
        _overviewTitle.Value = display.OverviewTitle;
        AutomationProperties.SetName(_overviewPanel, display.OverviewTitle);

        _overviewTitle.Visibility = Show(display.ShowOverview);
        _metricsGrid.Visibility = Show(display.ShowOverview);
        _secondaryLine.Visibility = Show(display.ShowOverview);
        _overviewEmpty.Visibility = Show(!display.ShowOverview);
        _overviewEmpty.Title = display.OverviewEmptyTitle;
        _overviewEmpty.Message = display.OverviewEmptyMessage;

        _metricsGrid.Children.Clear();
        _metricsGrid.RowDefinitions.Clear();
        int rows = (display.Metrics.Count + MetricColumns - 1) / MetricColumns;
        for (int r = 0; r < rows; r++)
        {
            _metricsGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Metrics.Count; i++)
        {
            var metric = display.Metrics[i];
            var card = new TsMetricCard
            {
                Label = metric.Label,
                Value = metric.Value,
                AccentBrushKey = metric.AccentBrushKey,
            };
            AutomationProperties.SetName(card, string.Create(CultureInfo.CurrentCulture, $"{metric.Label}: {metric.Value}"));
            Grid.SetColumn(card, i % MetricColumns);
            Grid.SetRow(card, i / MetricColumns);
            _metricsGrid.Children.Add(card);
        }

        RenderSecondaryLine(display);

        _criticalCallout.Visibility = Show(display.ShowCriticalCallout);
        _criticalCallout.Message = display.CriticalCalloutText;
        _criticalCallout.ActionText = display.ViewCriticalLabel;
    }

    private void RenderSecondaryLine(AlertsListDisplay display)
    {
        _secondaryLine.Children.Clear();

        var activeRules = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = string.Create(CultureInfo.CurrentCulture, $"{display.ActiveRulesLabel} {display.ActiveRulesValue}"),
        };
        activeRules.Click += (_, _) => RequestNavigation(AlertsListRegistration.StudioRoutePath);
        _secondaryLine.Children.Add(activeRules);

        _secondaryLine.Children.Add(Dot());
        _secondaryLine.Children.Add(new Caption
        {
            Value = string.Create(CultureInfo.CurrentCulture, $"{display.MostCommonLabel}: {display.MostCommonValue}"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        _secondaryLine.Children.Add(Dot());
        _secondaryLine.Children.Add(new Caption
        {
            Value = string.Create(CultureInfo.CurrentCulture, $"{display.Last7DaysLabel}: {display.Last7DaysValue}"),
            VerticalAlignment = VerticalAlignment.Center,
        });

        if (display.QuietHoursActive)
        {
            _secondaryLine.Children.Add(Dot());
            _secondaryLine.Children.Add(new Caption { Value = display.QuietHoursActiveLabel, VerticalAlignment = VerticalAlignment.Center });
        }
    }

    private void RenderCharts(AlertsListDisplay display)
    {
        _chartsRow.Visibility = Show(display.ShowCharts);
        _trendTitle.Value = display.TrendTitle;
        _typeTitle.Value = display.ByTypeTitle;
        AutomationProperties.SetName(_trendPanel, display.TrendTitle);
        AutomationProperties.SetName(_typePanel, display.ByTypeTitle);

        if (!display.ShowCharts)
        {
            return;
        }

        // 7-day trend — three severity series (web stacked BarChart, rendered as grouped Fluent bars).
        var critical = new List<ChartPoint>(display.TrendDays.Count);
        var warning = new List<ChartPoint>(display.TrendDays.Count);
        var info = new List<ChartPoint>(display.TrendDays.Count);
        for (int i = 0; i < display.TrendDays.Count; i++)
        {
            var day = display.TrendDays[i];
            critical.Add(new ChartPoint(i, day.Critical, day.DayLabel));
            warning.Add(new ChartPoint(i, day.Warning, day.DayLabel));
            info.Add(new ChartPoint(i, day.Info, day.DayLabel));
        }

        _trendChart.Series = new List<ChartSeries>
        {
            new(display.SeriesCriticalLabel, critical) { Kind = ChartSeriesKind.Bar, ColorIndex = 4 },
            new(display.SeriesWarningLabel, warning) { Kind = ChartSeriesKind.Bar, ColorIndex = 3 },
            new(display.SeriesInfoLabel, info) { Kind = ChartSeriesKind.Bar, ColorIndex = 0 },
        };

        // By-type donut + legend.
        var slices = new List<ChartPoint>(display.TypeSlices.Count);
        _typeLegend.Children.Clear();
        foreach (var slice in display.TypeSlices)
        {
            slices.Add(new ChartPoint(slice.ColorIndex, slice.Count, slice.Name));
            _typeLegend.Children.Add(BuildLegendRow(slice));
        }

        _typeChart.Values = slices;
    }

    private static StackPanel BuildLegendRow(AlertTypeSlice slice)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(new Ellipse
        {
            Width = 8,
            Height = 8,
            VerticalAlignment = VerticalAlignment.Center,
            Fill = ChartBrushes.ForIndex(slice.ColorIndex),
        });
        row.Children.Add(new Caption { Value = slice.Name, VerticalAlignment = VerticalAlignment.Center });
        row.Children.Add(new Text
        {
            Value = slice.Count.ToString("N0", CultureInfo.CurrentCulture),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(8, 0, 0, 0),
        });
        return row;
    }

    private void RenderPinned(AlertsListDisplay display)
    {
        _pinnedPanel.Visibility = Show(display.ShowPinned);
        if (!display.ShowPinned)
        {
            return;
        }

        _pinnedHeader.Value = string.Create(CultureInfo.CurrentCulture, $"{display.WatchingLabel} ({display.PinnedCount})");
        AutomationProperties.SetName(_pinnedPanel, display.WatchingLabel);

        _pinnedList.Children.Clear();
        foreach (var rule in display.PinnedRules)
        {
            var row = new Grid { Padding = new Thickness(0, 6, 0, 6) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var name = new Text { Value = rule.Name, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(name, 0);
            row.Children.Add(name);

            var status = new TsBadge
            {
                Status = rule.StatusVariant,
                Content = rule.StatusLabel,
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(status, 1);
            row.Children.Add(status);

            _pinnedList.Children.Add(new Border
            {
                Child = row,
                BorderThickness = new Thickness(0, 0, 0, 1),
                BorderBrush = Brush("TsColorBorderBrush"),
            });
        }
    }

    private void RenderFilters(AlertsListDisplay display)
    {
        _search.PromptText = display.SearchPrompt;

        // Keep the search box in sync when the model diverges from it (e.g. a chip removal cleared the query).
        if (!string.Equals(_search.Query, _viewModel.Search, StringComparison.Ordinal))
        {
            _search.Query = _viewModel.Search;
        }

        _tabsPanel.Children.Clear();
        foreach (var tab in display.FilterTabs)
        {
            var filter = tab.Filter;
            var button = new TsButton
            {
                Variant = tab.IsActive ? ButtonVariant.Primary : ButtonVariant.Subtle,
                Size = ControlSize.Small,
                Text = tab.Label,
            };
            button.Click += (_, _) => _viewModel.SetFilter(filter);
            _tabsPanel.Children.Add(button);
        }

        _chipsPanel.Children.Clear();
        _chipsPanel.Visibility = Show(display.ActiveChips.Count > 0);
        foreach (var chip in display.ActiveChips)
        {
            _chipsPanel.Children.Add(BuildChip(chip));
        }
    }

    private StackPanel BuildChip(AlertsFilterChip chip)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new TsBadge
        {
            Status = StatusKind.Neutral,
            Content = string.Create(CultureInfo.CurrentCulture, $"{chip.Label}: {chip.Value}"),
            VerticalAlignment = VerticalAlignment.Center,
        });

        string key = chip.Key;
        var remove = new TsButton { Variant = ButtonVariant.Icon, Size = ControlSize.Small, IconGlyph = ClearGlyph };
        AutomationProperties.SetName(remove, string.Create(CultureInfo.CurrentCulture, $"{ClearLabel()} {chip.Label}"));
        remove.Click += (_, _) =>
        {
            if (key == "q")
            {
                _viewModel.SetSearch(string.Empty);
            }
            else
            {
                _viewModel.SetFilter(AlertsFilter.All);
            }
        };
        row.Children.Add(remove);
        return row;
    }

    private void RenderList(AlertsListDisplay display)
    {
        _listEmpty.Visibility = Show(display.ShowListEmpty);
        _listEmpty.Title = display.ListEmptyTitle;
        _listEmpty.Message = display.ListEmptyMessage;

        _listPanel.Visibility = Show(display.ShowList);
        _listPanel.Children.Clear();
        if (!display.ShowList)
        {
            return;
        }

        foreach (var item in display.PagedAlerts)
        {
            _listPanel.Children.Add(BuildAlertCard(item));
        }
    }

    private AlertCard BuildAlertCard(AlertListItem item)
    {
        long id = item.Id;
        var card = new AlertCard(_localizer, item.Card);
        card.ViewContextRequested += (_, _) => RequestNavigation(item.Card.DrillHref);
        card.MarkReadRequested += (_, _) => InvokeAsync(async () =>
        {
            await _viewModel.MarkReadAsync(id).ConfigureAwait(true);
            ShowFeedback(_viewModel.Display.MarkReadSuccessLabel, undo: false);
        });
        card.AcknowledgeRequested += (_, _) => InvokeAsync(() => AcknowledgeAsync(id));
        card.ReopenRequested += (_, _) => InvokeAsync(() => _viewModel.ReopenAsync(id));
        card.OpenDetailRequested += (_, _) => InvokeAsync(() => ShowDetailAsync(id));
        return card;
    }

    private void RenderPagination(AlertsListDisplay display)
    {
        _pagination.Visibility = Show(display.ShowPagination);
        if (!display.ShowPagination)
        {
            return;
        }

        _pageLabel.Value = string.Create(CultureInfo.CurrentCulture, $"{display.Page} / {display.TotalPages}");
        _firstButton.IsEnabled = display.Page > 1;
        _prevButton.IsEnabled = display.Page > 1;
        _nextButton.IsEnabled = display.Page < display.TotalPages;
        _lastButton.IsEnabled = display.Page < display.TotalPages;
    }

    private async Task AcknowledgeAsync(long id)
    {
        string? note = await PromptForNoteAsync().ConfigureAwait(true);
        if (note is null)
        {
            return;
        }

        _lastAcknowledgedId = id;
        await _viewModel.AcknowledgeAsync(id, note).ConfigureAwait(true);
        ShowFeedback(_viewModel.Display.AckSuccessLabel, undo: true);
    }

    private async Task<string?> PromptForNoteAsync()
    {
        if (XamlRoot is null)
        {
            return string.Empty;
        }

        var input = new TsTextarea { MinHeight = 96, Hint = _localizer.GetString("alerts.ack.noteHint", "Add a note (optional)") };
        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = _localizer.GetString("alerts.ack.button", "Acknowledge"),
            Content = input,
            PrimaryButtonText = _localizer.GetString("alerts.ack.button", "Acknowledge"),
            CloseButtonText = _localizer.GetString("common.cancel", "Cancel"),
            DefaultButton = ContentDialogButton.Primary,
        };

        var result = await dialog.ShowAsync();
        return result == ContentDialogResult.Primary ? input.Text ?? string.Empty : null;
    }

    private async Task ShowDetailAsync(long id)
    {
        if (XamlRoot is null)
        {
            return;
        }

        var display = _viewModel.Display;
        var detail = await _viewModel.LoadDetailAsync(id).ConfigureAwait(true);

        var body = new StackPanel { Spacing = 12, MinWidth = 360 };
        if (!string.IsNullOrEmpty(detail.Title))
        {
            body.Children.Add(new Subhead { Value = detail.Title });
        }

        if (!string.IsNullOrEmpty(detail.Message))
        {
            body.Children.Add(new Caption { Value = detail.Message });
        }

        if (detail.Events.Count == 0)
        {
            body.Children.Add(new TsEmptyState
            {
                IconGlyph = AlertGlyph,
                Title = display.TimelineEmpty,
                Message = display.TimelineEmpty,
            });
        }
        else
        {
            foreach (var ev in detail.Events)
            {
                body.Children.Add(BuildTimelineRow(ev));
            }
        }

        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = display.TimelineTitle,
            Content = new ScrollViewer { Content = body, MaxHeight = 480 },
            CloseButtonText = _localizer.GetString("common.close", "Close"),
        };
        await dialog.ShowAsync();
    }

    private static StackPanel BuildTimelineRow(AlertTimelineEvent ev)
    {
        var row = new StackPanel { Spacing = 2 };
        string headline = string.IsNullOrEmpty(ev.Actor)
            ? ev.Kind
            : string.Create(CultureInfo.CurrentCulture, $"{ev.Kind} \u00B7 {ev.Actor}");
        row.Children.Add(new Text { Value = headline });
        if (!string.IsNullOrEmpty(ev.Note))
        {
            row.Children.Add(new Caption { Value = ev.Note });
        }

        if (ev.At is { } at)
        {
            row.Children.Add(new Caption { Value = at.ToString("g", CultureInfo.CurrentCulture) });
        }

        return row;
    }

    private void ShowFeedback(string message, bool undo)
    {
        _feedbackCallout.Message = message;
        _feedbackCallout.ActionText = undo ? _viewModel.Display.AckUndoLabel : string.Empty;
        _feedbackCallout.Visibility = Visibility.Visible;
        _feedbackCallout.IsOpen = true;
    }

    private void OnSearchChanged(object? sender, string query) => _viewModel.SetSearch(query);

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnViewCritical(object? sender, EventArgs e)
    {
        _viewModel.SetFilter(AlertsFilter.Critical);
        _viewModel.SetPage(1);
    }

    private void OnUndoAcknowledge(object? sender, EventArgs e)
    {
        if (_lastAcknowledgedId > 0)
        {
            InvokeAsync(() => _viewModel.ReopenAsync(_lastAcknowledgedId));
        }

        _feedbackCallout.IsOpen = false;
        _feedbackCallout.Visibility = Visibility.Collapsed;
    }

    private void RequestNavigation(string route)
    {
        if (!string.IsNullOrEmpty(route))
        {
            NavigationRequested?.Invoke(this, route);
        }
    }

    private string ClearLabel() => _localizer.GetString("common.clear", "Clear");

    private static Caption Dot() => new()
    {
        Value = "\u00B7",
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;
}
