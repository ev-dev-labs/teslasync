using System;
using System.ComponentModel;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The native WinUI 3 <c>CommandHistoryPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/CommandHistoryPage.tsx</c> (route <c>/command-history</c>, nav name
/// <c>CommandHistory</c>). It binds to a <see cref="CommandHistoryPageViewModel"/> and renders every web region
/// with Fluent components and design tokens: the page header (title + subtitle), the actions row (vehicle picker +
/// back-to-commands link), the failure banner (web <c>error</c>), the full-page loading scaffold, the four stat
/// tiles (Commands-24h / Success-Rate / Most-Used / Last-Sent), the filters panel (status TabNav + command search)
/// and the command-timeline panel whose body switches between the timeline rows and the empty state — plus the
/// pagination footer. The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="CommandHistoryDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class CommandHistoryPage : UserControl, IDisposable
{
    private const string HistoryGlyph = "\uE81C";  // History (web History icon)
    private const string SearchGlyph = "\uE721";   // Search
    private const string CommandsGlyph = "\uE7FC";  // Game (web Gamepad2 — back to Commands)

    private readonly CommandHistoryPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressEvents;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsSelect _vehicleSelect = new() { MinWidth = 200 };
    private readonly TsButton _backButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = CommandsGlyph };

    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };
    private readonly TsPageLoadSkeleton _loadingSkeleton = new();
    private readonly StackPanel _content = new() { Spacing = 12 };

    private readonly TsStatCard _total24hCard = new();
    private readonly TsStatCard _successRateCard = new();
    private readonly TsStatCard _mostUsedCard = new();
    private readonly TsStatCard _lastSentCard = new();

    private readonly TsGlassPanel _filtersPanel = new();
    private readonly TsButton _allTab = new() { Size = ControlSize.Small };
    private readonly TsButton _successTab = new() { Size = ControlSize.Small };
    private readonly TsButton _failedTab = new() { Size = ControlSize.Small };
    private readonly TsInput _searchInput = new() { MinWidth = 220 };
    private readonly ProgressRing _searchPending = new()
    {
        Width = 14,
        Height = 14,
        IsActive = true,
        Visibility = Visibility.Collapsed,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsGlassPanel _timelinePanel = new();
    private readonly PanelTitle _timelineTitle = new();
    private readonly Caption _showingText = new() { HorizontalAlignment = HorizontalAlignment.Right };
    private readonly TsTimeline _timeline = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = HistoryGlyph };

    private readonly TsPagination _pagination = new() { PageSize = CommandHistoryRegistration.PageSize };

    private readonly TsButton[] _statusTabs;
    private readonly CommandStatusFilter[] _statusKeys = { CommandStatusFilter.All, CommandStatusFilter.Success, CommandStatusFilter.Failed };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public CommandHistoryPage()
        : this(EmptyCommandHistoryFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The vehicles / command-history data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public CommandHistoryPage(ICommandHistoryFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new CommandHistoryPageViewModel(feed, localizer);
        _statusTabs = new[] { _allTab, _successTab, _failedTab };

        BuildContent();
        Content = BuildLayout();

        _vehicleSelect.SelectionChanged += OnVehicleChanged;
        _backButton.Click += OnBackClick;
        _searchInput.TextChanged += OnSearchChanged;
        _pagination.PageChanged += OnPageChanged;
        for (int i = 0; i < _statusTabs.Length; i++)
        {
            var key = _statusKeys[i];
            _statusTabs[i].Click += (_, _) => OnStatusTab(key);
        }

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when an in-page link asks the shell to navigate (web <c>Link to="/commands"</c>).</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The diagnostics surface slug (<c>CommandHistoryPage</c>).</summary>
    public static string Slug => CommandHistoryRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_errorBanner);
        stack.Children.Add(_loadingSkeleton);
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

        _vehicleSelect.DisplayMemberPath = nameof(CommandVehicleOption.Label);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(_vehicleSelect);
        actions.Children.Add(_backButton);

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
        _content.Children.Add(BuildStatsGrid());
        _content.Children.Add(BuildFiltersPanel());
        _content.Children.Add(BuildTimelinePanel());
        _content.Children.Add(_pagination);
        _pagination.HorizontalAlignment = HorizontalAlignment.Center;
    }

    private Grid BuildStatsGrid()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        var cards = new[] { _total24hCard, _successRateCard, _mostUsedCard, _lastSentCard };
        for (int i = 0; i < cards.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            cards[i].HorizontalAlignment = HorizontalAlignment.Stretch;
            Grid.SetColumn(cards[i], i);
            grid.Children.Add(cards[i]);
        }

        return grid;
    }

    private TsGlassPanel BuildFiltersPanel()
    {
        var tabRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        foreach (var tab in _statusTabs)
        {
            tabRow.Children.Add(tab);
        }

        var searchIcon = new FontIcon { Glyph = SearchGlyph, FontSize = 14, Foreground = Brush("TsColorTextMutedBrush"), VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(searchIcon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);
        _searchInput.HorizontalAlignment = HorizontalAlignment.Stretch;

        var searchRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        searchRow.Children.Add(searchIcon);
        searchRow.Children.Add(_searchInput);
        searchRow.Children.Add(_searchPending);

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(tabRow, 0);
        Grid.SetColumn(searchRow, 1);
        grid.Children.Add(tabRow);
        grid.Children.Add(searchRow);

        _filtersPanel.Content = new Border { Padding = new Thickness(16), Child = grid };
        return _filtersPanel;
    }

    private TsGlassPanel BuildTimelinePanel()
    {
        var icon = new FontIcon { Glyph = HistoryGlyph, FontSize = 14, Foreground = Brush("TsColorTextSecondaryBrush"), VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);
        _timelineTitle.VerticalAlignment = VerticalAlignment.Center;
        _showingText.VerticalAlignment = VerticalAlignment.Center;

        var header = new Grid { ColumnSpacing = 8, Margin = new Thickness(0, 0, 0, 12) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(_timelineTitle, 1);
        Grid.SetColumn(_showingText, 2);
        header.Children.Add(icon);
        header.Children.Add(_timelineTitle);
        header.Children.Add(_showingText);

        var body = new StackPanel { Spacing = 0, Padding = new Thickness(24) };
        body.Children.Add(header);
        body.Children.Add(_timeline);
        body.Children.Add(_emptyState);

        _timelinePanel.Content = body;
        return _timelinePanel;
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
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, PropertyChangedEventArgs e)
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

    private void Render(CommandHistoryDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Actions row — vehicle picker + back-to-commands.
        _vehicleSelect.ItemsSource = display.VehicleOptions;
        _vehicleSelect.SelectedItem = display.VehicleOptions.FirstOrDefault(o => o.Id == display.SelectedVehicleId);
        _vehicleSelect.Visibility = Show(display.VehicleOptions.Count > 0);
        AutomationProperties.SetName(_vehicleSelect, display.SelectVehicleLabel);
        _backButton.Text = display.BackToCommandsLabel;
        AutomationProperties.SetName(_backButton, display.BackToCommandsLabel);

        // Failure banner (web error) — shown above the panels.
        _errorBanner.IsOpen = display.HasError;
        _errorBanner.Visibility = Show(display.HasError);
        _errorBanner.Message = display.ErrorBannerText;

        // Full-page loading scaffold vs the panels.
        _loadingSkeleton.Visibility = Show(display.ShowLoading);
        _content.Visibility = Show(!display.ShowLoading);

        // Section 1 — stat tiles.
        ApplyStatCard(_total24hCard, display.StatCards[0]);
        ApplyStatCard(_successRateCard, display.StatCards[1]);
        ApplyStatCard(_mostUsedCard, display.StatCards[2]);
        ApplyStatCard(_lastSentCard, display.StatCards[3]);

        // Section 2 — filters panel (GlassPanel5).
        for (int i = 0; i < _statusTabs.Length; i++)
        {
            ApplyStatusTab(_statusTabs[i], display.StatusTabs[i]);
        }

        _searchInput.Hint = display.SearchPlaceholder; // parity:allow mirrors the web search-input placeholder (commandHistory.searchPlaceholder)
        AutomationProperties.SetName(_searchInput, display.SearchAria);
        if (_searchInput.FocusState == FocusState.Unfocused && _searchInput.Text != display.SearchQuery)
        {
            _searchInput.Text = display.SearchQuery;
        }

        _searchPending.Visibility = Show(display.IsSearchPending);
        AutomationProperties.SetName(_searchPending, display.SearchPendingLabel);
        ToolTipService.SetToolTip(_searchPending, display.SearchPendingLabel);

        // Section 3 — command timeline panel (GlassPanel6).
        _timelineTitle.Value = display.TimelineTitle;
        _showingText.Value = display.ShowingText;
        AutomationProperties.SetName(_timelinePanel, display.TimelineTitle);
        _timeline.Visibility = Show(display.ShowTimeline);
        if (display.ShowTimeline)
        {
            _timeline.Items = display.TimelineRows
                .Select(r => new TsActivityEntry(r.Title, r.Subtitle, r.Timestamp, r.Severity))
                .ToList();
        }

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Message = display.EmptyMessage;

        // Section 4 — pagination.
        _pagination.Visibility = Show(display.ShowPagination);
        _pagination.PageSize = display.PageSize;
        _pagination.TotalItems = display.FilteredTotal;
        _pagination.Page = display.Page;

        _suppressEvents = false;
    }

    private static void ApplyStatCard(TsStatCard card, CommandStatCardDisplay model)
    {
        card.Label = model.Label;
        card.Value = model.Value;
        card.Glyph = model.Glyph;
        AutomationProperties.SetName(card, model.AutomationName);
    }

    private static void ApplyStatusTab(TsButton button, CommandStatusTabDisplay model)
    {
        button.Text = model.Label;
        button.IconGlyph = model.Glyph;
        button.Variant = model.IsActive ? ButtonVariant.Secondary : ButtonVariant.Subtle;
        AutomationProperties.SetName(button, model.Label);
    }

    private void OnVehicleChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents || _vehicleSelect.SelectedItem is not CommandVehicleOption option)
        {
            return;
        }

        if (option.Id != _viewModel.SelectedVehicleId)
        {
            InvokeAsync(() => _viewModel.SelectVehicleAsync(option.Id));
        }
    }

    private void OnStatusTab(CommandStatusFilter filter)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetStatusFilter(filter);
    }

    private void OnSearchChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetSearchQuery(_searchInput.Text);
    }

    private void OnPageChanged(object? sender, int page)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetPage(page);
    }

    private void OnBackClick(object sender, RoutedEventArgs e) => NavigationRequested?.Invoke(this, "commands");

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Microsoft.UI.Xaml.Media.Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Microsoft.UI.Xaml.Media.Brush brush ? brush : null;
}
