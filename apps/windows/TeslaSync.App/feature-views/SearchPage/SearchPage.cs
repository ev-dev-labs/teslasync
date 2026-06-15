using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The native WinUI 3 <c>SearchPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/SearchPage.tsx</c> (route <c>/search</c>, nav name <c>Search</c>). It binds
/// to a <see cref="SearchPageViewModel"/> and renders every web region with Fluent components and design
/// tokens. The seven web <c>GlassPanel</c> regions map 1:1 onto Mica/glass cards: the sticky search + facet
/// filter panel (GlassPanel1), the five mutually-exclusive state surfaces — too-short (GlassPanel2), the
/// start-typing prompt (GlassPanel3), the search-failed error (GlassPanel4), the loading skeleton (GlassPanel5)
/// and no-results (GlassPanel6) — and the repeated grouped-results panel (GlassPanel7). The search field and the
/// facet rail are persistent so typing never loses focus; only the data-driven regions (facet toggle states,
/// result groups, rows) are rebuilt. The view is a thin renderer: every branch, label and count is decided by
/// the view-model's <see cref="SearchDisplay"/> projection; state changes are marshalled onto the UI thread.
/// Row / facet activations raise <see cref="NavigationRequested"/> so the shell router owns navigation, exactly
/// as the web rows defer to the app router.
/// </summary>
public sealed partial class SearchPage : UserControl, IDisposable
{
    private const double SectionSpacing = 20;
    private const double PanelPadding = 24;
    private const string ChevronGlyph = "\uE76C";

    private readonly SearchPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressEvents;

    private readonly PageTitle _title = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    // GlassPanel1 — search + facet rail.
    private readonly TsGlassPanel _searchPanel = new();
    private readonly TsInput _searchInput = new();
    private readonly StackPanel _facetRail = new() { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _clearButton = new() { Variant = ButtonVariant.Secondary, VerticalAlignment = VerticalAlignment.Center };

    // GlassPanel2-6 — the five mutually-exclusive state surfaces.
    private readonly TsGlassPanel _tooShortPanel = new() { Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _tooShortState = new() { IconGlyph = SearchRegistration.SearchGlyph };
    private readonly TsGlassPanel _emptyPanel = new() { Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = SearchRegistration.SearchGlyph };
    private readonly TsGlassPanel _errorPanel = new() { Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _errorState = new() { IconGlyph = SearchRegistration.SearchGlyph };
    private readonly TsGlassPanel _loadingPanel = new() { Visibility = Visibility.Collapsed };
    private readonly TsGlassPanel _noResultsPanel = new() { Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _noResultsState = new() { IconGlyph = SearchRegistration.SearchGlyph };

    // GlassPanel7 — repeated grouped-results panel.
    private readonly StackPanel _groupsHost = new() { Spacing = 16, Visibility = Visibility.Collapsed };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public SearchPage()
        : this(EmptySearchFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The unified-search data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SearchPage(ISearchFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SearchPageViewModel(feed, localizer);

        Content = BuildLayout();

        _searchInput.TextChanged += OnSearchTextChanged;
        _clearButton.Click += OnClearFiltersClick;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised with the destination route path when a result row or facet activation navigates.</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The navigation route name the shell registers this page under (<c>Search</c>).</summary>
    public static string RouteName => SearchRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SearchPageViewModel ViewModel => _viewModel;

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _searchInput.TextChanged -= OnSearchTextChanged;
        _clearButton.Click -= OnClearFiltersClick;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(PanelPadding) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(BuildSearchPanel());
        stack.Children.Add(BuildResultsRegion());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(_title, 0);
        grid.Children.Add(_title);

        Grid.SetColumn(_freshness, 1);
        grid.Children.Add(_freshness);
        return grid;
    }

    private TsGlassPanel BuildSearchPanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(PanelPadding) };

        _searchInput.HorizontalAlignment = HorizontalAlignment.Stretch;
        body.Children.Add(_searchInput);

        var railScroller = new ScrollViewer
        {
            Content = _facetRail,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
        };
        body.Children.Add(railScroller);

        _searchPanel.Content = body;
        return _searchPanel;
    }

    private StackPanel BuildResultsRegion()
    {
        var region = new StackPanel { Spacing = 16 };

        _tooShortPanel.Content = WrapState(_tooShortState);
        _emptyPanel.Content = WrapState(_emptyState);
        _errorPanel.Content = WrapState(_errorState);
        _loadingPanel.Content = BuildLoadingBody();
        _noResultsPanel.Content = WrapState(_noResultsState);

        region.Children.Add(_tooShortPanel);
        region.Children.Add(_emptyPanel);
        region.Children.Add(_errorPanel);
        region.Children.Add(_loadingPanel);
        region.Children.Add(_noResultsPanel);
        region.Children.Add(_groupsHost);
        return region;
    }

    private static Border WrapState(TsEmptyState state) =>
        new() { Padding = new Thickness(PanelPadding), Child = state };

    private static StackPanel BuildLoadingBody()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(PanelPadding) };
        column.Children.Add(new TsSkeleton { BlockHeight = 16, BlockWidth = 160, HorizontalAlignment = HorizontalAlignment.Left });
        for (int i = 0; i < 5; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 48 });
        }

        return column;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        _ = _searchInput.Focus(FocusState.Programmatic); // web autoFocus
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

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

    private void OnSearchTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _ = _viewModel.SetQueryAsync(_searchInput.Text);
    }

    private void OnClearFiltersClick(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _ = _viewModel.ClearFiltersAsync();
    }

    private void Render(SearchDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        AutomationProperties.SetName(this, display.AutomationName);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        // GlassPanel1 — search field + facet rail.
        if (!string.Equals(_searchInput.Text, display.Query, StringComparison.Ordinal))
        {
            _searchInput.Text = display.Query;
        }

        _searchInput.Hint = display.SearchHint;
        AutomationProperties.SetName(_searchInput, display.SearchLabel);

        RebuildFacets(display.Facets, display.ShowClearFilters, display.ClearFiltersLabel);

        // GlassPanel2 — too-short.
        _tooShortPanel.Visibility = Show(display.ShowTooShort);
        _tooShortState.Title = display.TooShortTitle;
        _tooShortState.Message = display.TooShortMessage;

        // GlassPanel3 — start-typing prompt.
        _emptyPanel.Visibility = Show(display.ShowEmpty);
        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;

        // GlassPanel4 — error.
        _errorPanel.Visibility = Show(display.ShowError);
        _errorState.Title = display.ErrorTitle;
        _errorState.Message = display.ErrorMessage;

        // GlassPanel5 — loading skeleton.
        _loadingPanel.Visibility = Show(display.ShowLoading);

        // GlassPanel6 — no results.
        _noResultsPanel.Visibility = Show(display.ShowNoResults);
        _noResultsState.Title = display.NoResultsTitle;
        _noResultsState.Message = display.NoResultsMessage;

        // GlassPanel7 — repeated grouped-results panel.
        _groupsHost.Visibility = Show(display.ShowResults);
        if (display.ShowResults)
        {
            RebuildGroups(display.Groups);
        }

        _suppressEvents = false;
    }

    private void RebuildFacets(IReadOnlyList<SearchFacetDisplay> facets, bool showClear, string clearLabel)
    {
        _facetRail.Children.Clear();
        foreach (var facet in facets)
        {
            _facetRail.Children.Add(BuildFacetChip(facet));
        }

        if (showClear)
        {
            _clearButton.Text = clearLabel;
            AutomationProperties.SetName(_clearButton, clearLabel);
            _facetRail.Children.Add(_clearButton);
        }
    }

    private ToggleButton BuildFacetChip(SearchFacetDisplay facet)
    {
        var icon = new FontIcon { Glyph = facet.Glyph, FontSize = 14, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var text = new TextBlock { Text = facet.Label, VerticalAlignment = VerticalAlignment.Center };
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        row.Children.Add(icon);
        row.Children.Add(text);

        var chip = new ToggleButton
        {
            Content = row,
            IsChecked = facet.Active,
            Padding = new Thickness(12, 4, 12, 4),
            MinWidth = 0,
            MinHeight = 0,
            CornerRadius = new CornerRadius(999),
        };
        AutomationProperties.SetName(chip, facet.Label);
        chip.Click += (_, _) =>
        {
            if (!_suppressEvents)
            {
                _ = _viewModel.ToggleTypeAsync(facet.Type);
            }
        };
        return chip;
    }

    private void RebuildGroups(IReadOnlyList<SearchGroupDisplay> groups)
    {
        _groupsHost.Children.Clear();
        foreach (var group in groups)
        {
            _groupsHost.Children.Add(new TsFadeIn { Content = BuildGroupPanel(group) });
        }
    }

    private TsGlassPanel BuildGroupPanel(SearchGroupDisplay group)
    {
        var column = new StackPanel { Spacing = 8, Padding = new Thickness(16) };

        var headerRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 0, 0, 4) };
        var headerIcon = new FontIcon { Glyph = group.Glyph, FontSize = 14, VerticalAlignment = VerticalAlignment.Center, Foreground = DisplayTokens.TextSecondary };
        AutomationProperties.SetAccessibilityView(headerIcon, AccessibilityView.Raw);
        headerRow.Children.Add(headerIcon);
        headerRow.Children.Add(new SectionTitle { Value = group.Label, VerticalAlignment = VerticalAlignment.Center });

        var countChip = new Border
        {
            Padding = new Thickness(8, 1, 8, 1),
            CornerRadius = new CornerRadius(999),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock { Text = group.CountText, FontSize = 11, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center },
        };
        headerRow.Children.Add(countChip);
        column.Children.Add(headerRow);

        foreach (var row in group.Rows)
        {
            column.Children.Add(BuildRow(row));
        }

        AutomationProperties.SetName(column, $"{group.Label}: {group.Count}");
        return new TsGlassPanel { Content = column };
    }

    private Button BuildRow(SearchRowDisplay row)
    {
        var grid = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = new FontIcon { Glyph = row.Glyph, FontSize = 16, VerticalAlignment = VerticalAlignment.Center, Foreground = DisplayTokens.TextMuted };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        var details = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        details.Children.Add(new TextBlock
        {
            Text = row.Title,
            FontSize = 14,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Foreground = DisplayTokens.TextPrimary,
        });
        if (row.HasSubtitle)
        {
            details.Children.Add(new TextBlock
            {
                Text = row.Subtitle,
                FontSize = 12,
                TextTrimming = TextTrimming.CharacterEllipsis,
                Foreground = DisplayTokens.TextMuted,
            });
        }

        Grid.SetColumn(details, 1);
        grid.Children.Add(details);

        if (row.HasWhen)
        {
            var when = new TextBlock
            {
                Text = row.WhenText,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(when, 2);
            grid.Children.Add(when);
        }

        var chevron = new FontIcon { Glyph = ChevronGlyph, FontSize = 12, VerticalAlignment = VerticalAlignment.Center, Foreground = DisplayTokens.TextMuted };
        AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);
        Grid.SetColumn(chevron, 3);
        grid.Children.Add(chevron);

        var button = new Button
        {
            Content = grid,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(8, 10, 8, 10),
            CornerRadius = new CornerRadius(8),
            Background = DisplayTokens.Brush("TsColorTransparentBrush"),
        };
        AutomationProperties.SetName(button, row.AutomationName);
        button.Click += (_, _) => RaiseNavigate(row.Url);
        return button;
    }

    private void RaiseNavigate(string path)
    {
        if (!string.IsNullOrEmpty(path))
        {
            NavigationRequested?.Invoke(this, path);
        }
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
