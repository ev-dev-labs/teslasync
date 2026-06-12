using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System.Runtime.CompilerServices;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using Windows.Storage;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>The in-app navigation intent the page emits (web <c>navigate(path)</c>); the shell performs the routing.</summary>
public sealed class AutomationsListNavigationEventArgs(string path) : EventArgs
{
    /// <summary>The route path to navigate to (no leading slash), e.g. <c>automations/new</c>.</summary>
    public string Path { get; } = path;
}

/// <summary>
/// The native WinUI 3 <c>AutomationsListPage</c> — a parity port of the web page
/// <c>web/src/features/automations/pages/AutomationsListPage.tsx</c> (route <c>/automations</c>, nav name
/// <c>Automations</c>). It binds to an <see cref="AutomationsListPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the header (title / subtitle + Import / Create actions), the four stat
/// tiles (Total / Active / Disabled / Auto-Disabled), the auto-disabled warning banner, the filters panel (status
/// select + search + count badge), the collapsible Quick-Start-Templates preset panel (hosting the shared
/// <see cref="PresetGalleryView"/>), the automation cards region whose body switches between the loading spinner,
/// the query-error surface, the empty state, the no-match state and the <see cref="AutomationCard"/> list, and the
/// recent-activity feed. The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="AutomationsListDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class AutomationsListPage : UserControl, IDisposable
{
    private const string ImportGlyph = "\uE898";   // Segoe Fluent — Upload (web Upload)
    private const string CreateGlyph = "\uE710";    // Segoe Fluent — Add (web Plus)
    private const string PresetsGlyph = "\uE945";   // Segoe Fluent — Lightbulb (web Sparkles quick-start)
    private const string TotalGlyph = "\uE71C";     // Segoe Fluent — Filter (web ListFilter)
    private const string ActiveGlyph = "\uE7E8";    // Segoe Fluent — PowerButton (web Power)
    private const string DisabledGlyph = "\uE769";  // Segoe Fluent — Pause (web Pause)
    private const string AutoDisabledGlyph = "\uE7BA"; // Segoe Fluent — Warning (web ShieldOff)
    private const string EmptyGlyph = "\uE945";     // Segoe Fluent — Lightbulb (web Zap empty icon)
    private const string BuilderRoute = "automations/new"; // RouteTable AutomationBuilder

    private readonly AutomationsListPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsButton _importButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = ImportGlyph };
    private readonly TsButton _createButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small, IconGlyph = CreateGlyph };

    private readonly TsStatCard _totalCard = new() { Glyph = TotalGlyph };
    private readonly TsStatCard _activeCard = new() { Glyph = ActiveGlyph };
    private readonly TsStatCard _disabledCard = new() { Glyph = DisabledGlyph };
    private readonly TsStatCard _autoDisabledCard = new() { Glyph = AutoDisabledGlyph };

    private readonly TsAlertBanner _warningBanner = new() { Variant = CalloutVariant.Danger, Dismissible = false, IsOpen = false };

    private readonly TsSelect _statusSelect = new() { MinWidth = 180 };
    private readonly TsInput _searchInput = new() { MinWidth = 260 };
    private readonly TsBadge _filterCountBadge = new() { Status = StatusKind.Neutral, VerticalAlignment = VerticalAlignment.Center };

    private readonly Expander _presetsExpander = new() { HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly PanelTitle _presetsTitle = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _presetsHint = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _presetsToggleHint = new() { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Right };

    private readonly StackPanel _loadingPanel;
    private readonly Text _loadingText = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = EmptyGlyph };
    private readonly TsEmptyState _noMatchState = new() { IconGlyph = EmptyGlyph };
    private readonly StackPanel _cardsPanel = new() { Spacing = 12 };
    private readonly AutomationActivityFeed _activityFeed;

    private bool _suppressEvents;

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public AutomationsListPage()
        : this(EmptyAutomationsListFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The automations-hub data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public AutomationsListPage(IAutomationsListFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new AutomationsListPageViewModel(feed, localizer);
        _activityFeed = new AutomationActivityFeed(localizer, _viewModel.Display.ActivityFeed);

        _loadingPanel = BuildLoadingPanel();
        Content = BuildLayout();

        _importButton.Click += OnImportClick;
        _createButton.Click += OnCreateClick;
        _statusSelect.SelectionChanged += OnStatusFilterChanged;
        _searchInput.TextChanged += OnSearchChanged;
        _errorState.ActionInvoked += OnRetryInvoked;
        _emptyState.ActionInvoked += OnEmptyCreateInvoked;
        _noMatchState.ActionInvoked += OnResetFiltersInvoked;
        _presetsExpander.Expanding += OnPresetsExpanding;
        _presetsExpander.Collapsed += OnPresetsCollapsed;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when the page requests in-app navigation (web <c>navigate</c>); the shell performs the routing.</summary>
    public event EventHandler<AutomationsListNavigationEventArgs>? NavigationRequested;

    /// <summary>The diagnostics surface slug (<c>AutomationsListPage</c>).</summary>
    public static string Slug => AutomationsListRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(BuildStatsGrid());
        stack.Children.Add(_warningBanner);
        stack.Children.Add(BuildFiltersPanel());
        stack.Children.Add(BuildPresetsPanel());
        stack.Children.Add(BuildCardsPanel());
        stack.Children.Add(_activityFeed);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);
        Grid.SetColumn(heading, 0);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(_importButton);
        actions.Children.Add(_createButton);
        Grid.SetColumn(actions, 1);

        grid.Children.Add(heading);
        grid.Children.Add(actions);
        return grid;
    }

    private Grid BuildStatsGrid()
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int i = 0; i < 4; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var cards = new[] { _totalCard, _activeCard, _disabledCard, _autoDisabledCard };
        for (int i = 0; i < cards.Length; i++)
        {
            cards[i].HorizontalAlignment = HorizontalAlignment.Stretch;
            Grid.SetColumn(cards[i], i);
            grid.Children.Add(cards[i]);
        }

        return grid;
    }

    private TsGlassPanel BuildFiltersPanel()
    {
        _statusSelect.DisplayMemberPath = nameof(AutomationFilterOption.Label);
        _statusSelect.SelectedValuePath = nameof(AutomationFilterOption.Value);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(_statusSelect);
        row.Children.Add(_searchInput);
        row.Children.Add(_filterCountBadge);

        return new TsGlassPanel { Content = new Border { Padding = new Thickness(16), Child = row } };
    }

    private TsGlassPanel BuildPresetsPanel()
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        header.Children.Add(new FontIcon
        {
            Glyph = PresetsGlyph,
            FontSize = 16,
            Foreground = TsBrush("TsColorAccentBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        header.Children.Add(_presetsTitle);
        header.Children.Add(_presetsHint);

        var headerGrid = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(header, 0);
        Grid.SetColumn(_presetsToggleHint, 1);
        headerGrid.Children.Add(header);
        headerGrid.Children.Add(_presetsToggleHint);

        _presetsExpander.Header = headerGrid;
        _presetsExpander.Content = BuildPresetGallery();

        return new TsGlassPanel { Content = new Border { Padding = new Thickness(16), Child = _presetsExpander } };
    }

    // web <PresetGallery /> — the shared preset-gallery surface, wired to the page's default (empty) source so the
    // hub renders the gallery's own empty branch until a real presets read is injected (mirrors the empty feed).
    private PresetGalleryView BuildPresetGallery() =>
        new(EmptyPresetGallerySource.Instance, NullPresetGalleryNavigator.Instance, _localizer);

    private TsGlassPanel BuildCardsPanel()
    {
        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(_loadingPanel);
        body.Children.Add(_errorState);
        body.Children.Add(_emptyState);
        body.Children.Add(_noMatchState);
        body.Children.Add(_cardsPanel);

        return new TsGlassPanel { Content = new Border { Padding = new Thickness(16), Child = body } };
    }

    private StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel
        {
            Spacing = 8,
            Padding = new Thickness(32),
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        panel.Children.Add(new ProgressRing { IsActive = true, Width = 28, Height = 28 });
        panel.Children.Add(_loadingText);
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

    private void Render(AutomationsListDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _importButton.Text = display.ImportLabel;
        _createButton.Text = display.CreateLabel;
        AutomationProperties.SetName(_importButton, display.ImportLabel);
        AutomationProperties.SetName(_createButton, display.CreateLabel);

        _totalCard.Label = display.TotalLabel;
        _totalCard.Value = display.TotalValue;
        _activeCard.Label = display.ActiveLabel;
        _activeCard.Value = display.ActiveValue;
        _disabledCard.Label = display.DisabledLabel;
        _disabledCard.Value = display.DisabledValue;
        _autoDisabledCard.Label = display.AutoDisabledLabel;
        _autoDisabledCard.Value = display.AutoDisabledValue;

        _warningBanner.Message = display.AutoDisabledWarning;
        _warningBanner.IsOpen = display.ShowAutoDisabledWarning;

        _statusSelect.Header = display.FilterStatusLabel;
        AutomationProperties.SetName(_statusSelect, display.FilterStatusLabel);
        _statusSelect.ItemsSource = display.StatusFilterOptions;
        _statusSelect.SelectedValue = display.SelectedStatusFilter;

        _searchInput.Hint = display.SearchHint;
        AutomationProperties.SetName(_searchInput, display.SearchHint);

        _filterCountBadge.Content = display.FilterCountText;
        _filterCountBadge.Visibility = Show(display.ShowFilterCount);

        _presetsTitle.Value = display.PresetsTitle;
        _presetsHint.Value = display.PresetsHint;
        _presetsToggleHint.Value = _presetsExpander.IsExpanded ? display.PresetsCollapseLabel : display.PresetsExpandLabel;
        AutomationProperties.SetName(_presetsExpander, display.PresetsToggleAria);

        _loadingPanel.Visibility = Show(display.ShowLoading);
        _loadingText.Value = display.LoadingText;

        _errorState.Visibility = Show(display.HasError);
        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Message = display.EmptyMessage;
        _emptyState.ActionText = display.EmptyCtaLabel;

        _noMatchState.Visibility = Show(display.ShowNoMatch);
        _noMatchState.Message = display.NoMatchMessage;
        _noMatchState.ActionText = display.NoMatchCtaLabel;

        _cardsPanel.Visibility = Show(display.ShowCards);
        RebuildCards(display);

        _activityFeed.Model = display.ActivityFeed;

        _suppressEvents = false;
    }

    private void RebuildCards(AutomationsListDisplay display)
    {
        _cardsPanel.Children.Clear();
        if (!display.ShowCards)
        {
            return;
        }

        foreach (var model in display.Cards)
        {
            _cardsPanel.Children.Add(BuildCard(model));
        }
    }

    private AutomationCard BuildCard(AutomationCardModel model)
    {
        long id = model.Id;
        var card = new AutomationCard(_localizer, model);
        card.ToggleRequested += (_, enabled) => _ = _viewModel.ToggleAsync(id, enabled);
        card.ReEnableRequested += (_, _) => _ = _viewModel.ReEnableAsync(id);
        card.DeleteRequested += (_, _) => _ = _viewModel.DeleteAsync(id);
        card.TestRunRequested += (_, _) => _ = _viewModel.TestRunAsync(id);
        return card;
    }

    private void OnStatusFilterChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        if (_statusSelect.SelectedValue is string wire)
        {
            _viewModel.SetStatusFilter(wire);
        }
    }

    private void OnSearchChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetSearch(_searchInput.Text);
    }

    private async void OnRetryInvoked(object? sender, EventArgs e) =>
        await _viewModel.RefreshAsync().ConfigureAwait(true);

    private void OnEmptyCreateInvoked(object? sender, EventArgs e) => RequestNavigation(BuilderRoute);

    private void OnResetFiltersInvoked(object? sender, EventArgs e)
    {
        _suppressEvents = true;
        _searchInput.Text = string.Empty;
        _suppressEvents = false;
        _viewModel.ResetFilters();
    }

    private void OnCreateClick(object sender, RoutedEventArgs e) => RequestNavigation(BuilderRoute);

    private async void OnImportClick(object sender, RoutedEventArgs e) => await PickAndImportAsync().ConfigureAwait(true);

    private void OnPresetsExpanding(Expander sender, ExpanderExpandingEventArgs args) =>
        _presetsToggleHint.Value = _viewModel.Display.PresetsCollapseLabel;

    private void OnPresetsCollapsed(Expander sender, ExpanderCollapsedEventArgs args) =>
        _presetsToggleHint.Value = _viewModel.Display.PresetsExpandLabel;

    // web import handler: open a .json picker, read the file, hand the raw envelope to the view-model (which
    // validates the typed-envelope contract before posting) and surface any failure in a dialog.
    private async Task PickAndImportAsync()
    {
        var window = App.MainWindow;
        if (window is null)
        {
            return;
        }

        string text;
        try
        {
            var picker = new FileOpenPicker { SuggestedStartLocation = PickerLocationId.DocumentsLibrary };
            picker.FileTypeFilter.Add(".json");
            InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(window));

            StorageFile? file = await picker.PickSingleFileAsync();
            if (file is null)
            {
                return;
            }

            text = await FileIO.ReadTextAsync(file);
        }
        catch (Exception)
        {
            // A cancelled / denied pick must never crash the surface.
            return;
        }

        var result = await _viewModel.ImportAsync(text).ConfigureAwait(true);
        if (!result.Success && !string.IsNullOrEmpty(result.ErrorMessage))
        {
            await ShowImportErrorAsync(result.ErrorMessage).ConfigureAwait(true);
        }
    }

    private async Task ShowImportErrorAsync(string message)
    {
        if (XamlRoot is null)
        {
            return;
        }

        var dialog = new ContentDialog
        {
            Title = _viewModel.Display.ImportLabel,
            Content = message,
            CloseButtonText = _localizer.GetString("common.close", "Close"),
            XamlRoot = XamlRoot,
        };

        try
        {
            await dialog.ShowAsync();
        }
        catch (Exception)
        {
            // A dialog that cannot be shown (e.g. another is open) must never crash the surface.
        }
    }

    private void RequestNavigation(string path) =>
        NavigationRequested?.Invoke(this, new AutomationsListNavigationEventArgs(path));

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? TsBrush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;

    /// <summary>The page's default (empty) preset-gallery source — yields one resolved-empty snapshot.</summary>
    private sealed class EmptyPresetGallerySource : IPresetGallerySource
    {
        public static EmptyPresetGallerySource Instance { get; } = new();

        private EmptyPresetGallerySource()
        {
        }

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<AutomationPresetRow>>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Empty();
            await Task.CompletedTask.ConfigureAwait(false);
        }
    }

    /// <summary>The page's default preset-gallery navigator — the Install deep-link is a no-op until wired to the shell.</summary>
    private sealed class NullPresetGalleryNavigator : IPresetGalleryNavigator
    {
        public static NullPresetGalleryNavigator Instance { get; } = new();

        private NullPresetGalleryNavigator()
        {
        }

        public void OpenBuilder(PresetInstallTarget target)
        {
        }
    }
}
