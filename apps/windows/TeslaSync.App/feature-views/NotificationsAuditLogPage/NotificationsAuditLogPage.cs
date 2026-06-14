using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The native WinUI 3 notifications <c>AuditLogPage</c> — a parity port of the web page
/// <c>web/src/features/notifications/pages/AuditLogPage.tsx</c> (route <c>/notifications/audit</c>, nav name
/// <c>NotificationsAudit</c>). It binds to a <see cref="NotificationsAuditLogPageViewModel"/> and mounts the shared
/// <see cref="PageContainer"/> chrome (localized title + subtitle) over a single glass panel (web <c>GlassPanel</c>)
/// whose body switches between the loading skeleton, the inline failure surface, the "no audit entries found" empty
/// state and the searchable entries table (a search box + active-filter chip over a four-column Time / Action /
/// Resource / Details <see cref="TsDataTable"/>, collapsing to a "no matches" sentence when the search filters every
/// row away). The view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="NotificationsAuditLogDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class NotificationsAuditLogPage : UserControl, IDisposable
{
    private readonly NotificationsAuditLogPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();

    private readonly PageContainer _pageContainer;
    private readonly TsGlassPanel _panel = new();

    private readonly FontIcon _clockIcon = new()
    {
        Glyph = NotificationsAuditLogRegistration.ClockGlyph,
        FontSize = 16,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly PanelTitle _recentTitle = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly StackPanel _loadingPanel = new() { Spacing = 8 };

    private readonly StackPanel _errorPanel = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly FontIcon _errorIcon = new() { Glyph = "\uE7BA", FontSize = 16, VerticalAlignment = VerticalAlignment.Center };
    private readonly ErrorText _errorText = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly TsEmptyState _emptyState = new();

    private readonly StackPanel _contentPanel = new() { Spacing = 12 };
    private readonly TsSearchInput _searchInput = new() { HorizontalAlignment = HorizontalAlignment.Left, MaxWidth = 320 };
    private readonly TsActiveFilterChips _chips = new();
    private readonly TsDataTable _table = new() { Selectable = false, Expandable = false, PageSize = NotificationsAuditLogRegistration.PageSize };
    private readonly Text _noMatchesText = new();

    private readonly TsDataColumn _colTime = new() { Key = "time", CanSort = false, Width = 180, MinWidth = 120 };
    private readonly TsDataColumn _colAction = new() { Key = "action", CanSort = false, Width = 180, MinWidth = 100 };
    private readonly TsDataColumn _colResource = new() { Key = "resource", CanSort = false, Width = 180, MinWidth = 100 };
    private readonly TsDataColumn _colDetails = new() { Key = "details", CanSort = false, Width = 280, MinWidth = 120 };

    private bool _started;
    private bool _disposed;
    private bool _suppressSearch;

    /// <summary>Creates the page over the inert audit feed and the shell resource localizer (the shell entry point).</summary>
    public NotificationsAuditLogPage()
        : this(EmptyAuditLogsFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The audit-log data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public NotificationsAuditLogPage(
        IAuditLogsFeed feed,
        ILocalizer localizer,
        NotificationsAuditLogDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new NotificationsAuditLogPageViewModel(feed, localizer, diagnostics);

        TintWithDanger(_errorIcon);
        AccentClock(_clockIcon);
        MuteForeground(_noMatchesText);

        _errorPanel.Children.Add(_errorIcon);
        _errorPanel.Children.Add(_errorText);

        AutomationProperties.SetName(_loadingPanel, "Loading");

        BuildLoadingPanel();
        BuildContentPanel();

        _panel.Content = new Border { Padding = new Thickness(24), Child = BuildPanelBody() };

        _pageContainer = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Display.Subtitle,
            PageContent = _panel,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _table.Columns = new List<TsDataColumn> { _colTime, _colAction, _colResource, _colDetails };

        _searchInput.QueryChanged += OnSearchChanged;
        _chips.FilterRemoved += OnSearchCleared;
        _chips.Cleared += OnSearchCleared;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _pageContainer;
        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>NotificationsAuditLogPage</c>).</summary>
    public static string Slug => NotificationsAuditLogRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public NotificationsAuditLogPageViewModel ViewModel => _viewModel;

    private void BuildLoadingPanel()
    {
        for (var i = 0; i < 5; i++)
        {
            _loadingPanel.Children.Add(new TsSkeleton { BlockHeight = 32 });
        }
    }

    private void BuildContentPanel()
    {
        _contentPanel.Children.Add(_searchInput);
        _contentPanel.Children.Add(_chips);
        _contentPanel.Children.Add(_table);
        _contentPanel.Children.Add(_noMatchesText);
    }

    private StackPanel BuildPanelBody()
    {
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(_clockIcon);
        header.Children.Add(_recentTitle);

        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(header);
        body.Children.Add(_loadingPanel);
        body.Children.Add(_errorPanel);
        body.Children.Add(_emptyState);
        body.Children.Add(_contentPanel);
        return body;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnSearchChanged(object? sender, string query)
    {
        if (_suppressSearch)
        {
            return;
        }

        _viewModel.SetSearch(query);
    }

    private void OnSearchCleared(object? sender, EventArgs e) => _viewModel.ClearSearch();

    private void OnSearchCleared(object? sender, string key) => _viewModel.ClearSearch();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName is not null
            && e.PropertyName != nameof(NotificationsAuditLogPageViewModel.Display))
        {
            return;
        }

        var display = _viewModel.Display;
        if (_dispatcher.HasThreadAccess)
        {
            Render(display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(display));
        }
    }

    private void Render(NotificationsAuditLogDisplay display)
    {
        _recentTitle.Value = display.RecentActivityTitle;

        _loadingPanel.Visibility = display.ShowLoading ? Visibility.Visible : Visibility.Collapsed;

        _errorText.Value = display.ErrorText;
        _errorPanel.Visibility = display.ShowError ? Visibility.Visible : Visibility.Collapsed;

        _emptyState.Title = display.EmptyText;
        _emptyState.Visibility = display.ShowEmpty ? Visibility.Visible : Visibility.Collapsed;

        _contentPanel.Visibility = display.ShowContent ? Visibility.Visible : Visibility.Collapsed;

        _searchInput.PromptText = display.SearchPrompt;
        AutomationProperties.SetName(_searchInput, display.SearchPrompt);
        _suppressSearch = true;
        _searchInput.Query = display.SearchValue;
        _suppressSearch = false;

        _chips.ClearAllText = display.ClearAllLabel;
        _chips.Filters = display.ShowSearchChip
            ? new List<FilterChip> { new("q", display.SearchChipLabel, display.SearchChipValue) }
            : Array.Empty<FilterChip>();

        _colTime.Header = display.TimeHeader;
        _colAction.Header = display.ActionHeader;
        _colResource.Header = display.ResourceHeader;
        _colDetails.Header = display.DetailsHeader;
        _table.EmptyMessage = display.NoMatchesText;
        _table.Rows = BuildRows(display.Rows);
        _table.Visibility = display.ShowTable ? Visibility.Visible : Visibility.Collapsed;

        _noMatchesText.Value = display.NoMatchesText;
        _noMatchesText.Visibility = display.ShowNoMatches ? Visibility.Visible : Visibility.Collapsed;

        AutomationProperties.SetName(this, display.AutomationName);
    }

    private static List<TsDataRow> BuildRows(IReadOnlyList<AuditLogRowDisplay> rows)
    {
        var result = new List<TsDataRow>(rows.Count);
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["time"] = row.Time,
                ["action"] = row.Action,
                ["resource"] = row.Resource,
                ["details"] = row.Details,
            };
            result.Add(new TsDataRow(row.Id, values));
        }

        return result;
    }

    private static void TintWithDanger(FontIcon icon)
    {
        if (Application.Current.Resources.TryGetValue("TsColorDangerBrush", out var value) && value is Brush brush)
        {
            icon.Foreground = brush;
        }
    }

    private static void AccentClock(FontIcon icon)
    {
        if (Application.Current.Resources.TryGetValue("TsChartSpeedBrush", out var value) && value is Brush brush)
        {
            icon.Foreground = brush;
        }
    }

    private static void MuteForeground(Text text)
    {
        if (Application.Current.Resources.TryGetValue("TsColorTextMutedBrush", out var value) && value is Brush brush)
        {
            text.Foreground = brush;
        }
    }

    /// <summary>Unsubscribe from and dispose the owned surfaces (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _searchInput.QueryChanged -= OnSearchChanged;
        _chips.FilterRemoved -= OnSearchCleared;
        _chips.Cleared -= OnSearchCleared;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;

        _pageContainer.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new NotificationsAuditLogPageAutomationPeer(this);

    private sealed class NotificationsAuditLogPageAutomationPeer(NotificationsAuditLogPage owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
