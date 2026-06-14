using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Explore;

/// <summary>
/// The native WinUI 3 <c>ExplorePage</c> — a parity port of the web feature hub
/// (web/src/features/explore/pages/ExplorePage.tsx, route <c>/explore</c>, nav name <c>Explore</c>). It binds to an
/// <see cref="ExplorePageViewModel"/> and renders every web region with Fluent components and design tokens: the page
/// header (title + subtitle), the recently-visited strip, the sticky search panel (GlassPanel1 — the filter field +
/// the section anchor strip with match counts), the categorised feature-card section bands and the empty-result panel
/// (GlassPanel2 — the "did you mean" suggestions + the clear affordance). The view is a thin renderer: every branch,
/// label and count is decided by the view-model's <see cref="ExploreDisplay"/> projection; state changes are
/// marshalled onto the UI thread. Card / chip / suggestion activations raise <see cref="NavigationRequested"/> so the
/// shell router owns navigation, exactly as the web cards defer to the app router.
/// </summary>
public sealed partial class ExplorePage : UserControl, IDisposable
{
    private const string SearchGlyph = "\uE721";   // web Search icon
    private const int OemSlashKey = 0xBF;          // VK_OEM_2 — the "/" key on a standard layout

    private readonly ExplorePageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly Dictionary<string, FrameworkElement> _sectionBySlug = new(StringComparer.Ordinal);
    private bool _disposed;
    private bool _suppressEvents;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly StackPanel _recentSection = new() { Spacing = 8, Visibility = Visibility.Collapsed };
    private readonly Label _recentHeading = new();
    private readonly Caption _recentCount = new() { HorizontalAlignment = HorizontalAlignment.Right };
    private readonly StackPanel _recentChips = new() { Orientation = Orientation.Horizontal, Spacing = 8 };

    private readonly TsGlassPanel _searchPanel = new();
    private readonly TsInput _searchInput = new();
    private readonly StackPanel _anchorStrip = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly StackPanel _anchorRow;

    private readonly StackPanel _sectionsHost = new() { Spacing = 28 };

    private readonly TsGlassPanel _emptyPanel = new();
    private readonly FontIcon _emptyIcon = new() { Glyph = SearchGlyph, FontSize = 26, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly PanelTitle _emptyTitle = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Text _emptyBody = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Caption _didYouMean = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly StackPanel _suggestions = new() { Spacing = 4, MaxWidth = 460, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TsButton _clearButton = new() { Variant = ButtonVariant.Secondary, HorizontalAlignment = HorizontalAlignment.Center };

    /// <summary>Creates the page over the default empty feed, the shell resource localizer and the empty recent source.</summary>
    public ExplorePage()
        : this(EmptyExploreFeed.Instance, ShellLocalizer.Instance, EmptyExploreRecentSource.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed, localizer and recent source (used by tests / dependency injection).</summary>
    /// <param name="feed">The vehicle-count / forward-auth gating feed.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="recentSource">The recently-visited registry.</param>
    public ExplorePage(IExploreFeed feed, ILocalizer localizer, IExploreRecentSource recentSource)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(recentSource);

        _viewModel = new ExplorePageViewModel(feed, localizer, recentSource);
        _anchorRow = BuildAnchorRow();

        Content = BuildLayout();

        _searchInput.TextChanged += OnSearchTextChanged;
        _clearButton.Click += OnClearClick;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        KeyDown += OnKeyDown;

        Render(_viewModel.Display);
    }

    /// <summary>Raised with the destination route path when a card, recent chip or suggestion is activated.</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The diagnostics surface slug (<c>ExplorePage</c>).</summary>
    public static string Slug => ExploreRegistration.Slug;

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

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 20, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(BuildRecentStrip());
        stack.Children.Add(BuildSearchPanel());
        stack.Children.Add(_sectionsHost);
        stack.Children.Add(BuildEmptyPanel());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private StackPanel BuildHeader()
    {
        var heading = new StackPanel { Spacing = 4 };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);
        return heading;
    }

    private StackPanel BuildRecentStrip()
    {
        var headingRow = new Grid();
        headingRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headingRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_recentHeading, 0);
        Grid.SetColumn(_recentCount, 1);
        headingRow.Children.Add(_recentHeading);
        headingRow.Children.Add(_recentCount);

        var scroller = new ScrollViewer
        {
            Content = _recentChips,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
        };

        _recentSection.Children.Add(headingRow);
        _recentSection.Children.Add(scroller);
        AutomationProperties.SetAccessibilityView(_recentSection, AccessibilityView.Content);
        return _recentSection;
    }

    private TsGlassPanel BuildSearchPanel()
    {
        var body = new StackPanel { Spacing = 12, Padding = new Thickness(16) };

        _searchInput.Hint = string.Empty;
        body.Children.Add(_searchInput);
        body.Children.Add(_anchorRow);

        _searchPanel.Content = body;
        return _searchPanel;
    }

    private StackPanel BuildAnchorRow()
    {
        var scroller = new ScrollViewer
        {
            Content = _anchorStrip,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
        };
        var row = new StackPanel { Spacing = 4 };
        row.Children.Add(scroller);
        return row;
    }

    private TsGlassPanel BuildEmptyPanel()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(28), HorizontalAlignment = HorizontalAlignment.Center, MaxWidth = 520 };
        _emptyIcon.Foreground = Brush("TsColorTextMutedBrush");
        AutomationProperties.SetAccessibilityView(_emptyIcon, AccessibilityView.Raw);
        column.Children.Add(_emptyIcon);
        column.Children.Add(_emptyTitle);
        column.Children.Add(_emptyBody);
        column.Children.Add(_didYouMean);
        column.Children.Add(_suggestions);
        column.Children.Add(_clearButton);

        _emptyPanel.Content = column;
        _emptyPanel.Visibility = Visibility.Collapsed;
        return _emptyPanel;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
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

    private void Render(ExploreDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Search field (web sticky GlassPanel1 filter).
        if (!string.Equals(_searchInput.Text, display.Query, StringComparison.Ordinal))
        {
            _searchInput.Text = display.Query;
        }

        _searchInput.Hint = display.SearchHint;
        AutomationProperties.SetName(_searchInput, display.SearchLabel);

        // Recently visited (web RecentStrip — only when not filtering).
        _recentHeading.Value = display.RecentHeading;
        _recentCount.Value = display.RecentEntries.Count.ToString(System.Globalization.CultureInfo.CurrentCulture);
        RebuildRecent(display.RecentEntries);
        _recentSection.Visibility = Show(display.ShowRecent);

        // Section anchor strip (web SectionAnchorStrip).
        RebuildAnchors(display.Anchors);
        _anchorRow.Visibility = Show(display.Anchors.Count > 0);
        AutomationProperties.SetName(_anchorRow, display.SectionsAriaLabel);

        // Section bands (web success — the categorised card grid).
        RebuildSections(display.Sections);
        _sectionsHost.Visibility = Show(display.ShowSections);

        // Empty result (web GlassPanel2 EmptyResult).
        _emptyPanel.Visibility = Show(display.ShowEmpty);
        _emptyTitle.Value = display.EmptyTitle;
        _emptyBody.Value = display.EmptyBody;
        _didYouMean.Value = display.EmptyDidYouMean;
        _didYouMean.Visibility = Show(display.ShowSuggestions);
        RebuildSuggestions(display.Suggestions);
        _suggestions.Visibility = Show(display.ShowSuggestions);
        _clearButton.Text = display.EmptyClear;
        AutomationProperties.SetName(_clearButton, display.EmptyClear);

        _suppressEvents = false;
    }

    private void RebuildRecent(IReadOnlyList<ExploreRecentEntry> entries)
    {
        _recentChips.Children.Clear();
        foreach (var entry in entries)
        {
            _recentChips.Children.Add(BuildChip(entry.Glyph, entry.Label, entry.AccentBrushKey, entry.Path));
        }
    }

    private void RebuildAnchors(IReadOnlyList<ExploreAnchor> anchors)
    {
        _anchorStrip.Children.Clear();
        foreach (var anchor in anchors)
        {
            _anchorStrip.Children.Add(BuildAnchorChip(anchor));
        }
    }

    private void RebuildSuggestions(IReadOnlyList<ExploreSuggestion> suggestions)
    {
        _suggestions.Children.Clear();
        foreach (var suggestion in suggestions)
        {
            _suggestions.Children.Add(BuildSuggestion(suggestion));
        }
    }

    private void RebuildSections(IReadOnlyList<ExploreSection> sections)
    {
        _sectionsHost.Children.Clear();
        _sectionBySlug.Clear();
        foreach (var section in sections)
        {
            var band = BuildSectionBand(section);
            _sectionBySlug[section.Slug] = band;
            _sectionsHost.Children.Add(band);
        }
    }

    private StackPanel BuildSectionBand(ExploreSection section)
    {
        var headerRow = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = new SectionTitle { Value = section.Title, VerticalAlignment = VerticalAlignment.Center };
        var count = new Caption
        {
            Value = section.Count.ToString(System.Globalization.CultureInfo.CurrentCulture),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        Grid.SetColumn(heading, 0);
        Grid.SetColumn(count, 1);
        headerRow.Children.Add(heading);
        headerRow.Children.Add(count);

        var grid = new VariableSizedWrapGrid
        {
            Orientation = Orientation.Horizontal,
            ItemWidth = 300,
            ItemHeight = 112,
        };
        foreach (var entry in section.Entries)
        {
            grid.Children.Add(BuildCard(entry));
        }

        var band = new StackPanel { Spacing = 4 };
        band.Children.Add(headerRow);
        band.Children.Add(grid);
        AutomationProperties.SetName(band, section.Title);
        return band;
    }

    private Button BuildCard(ExploreCatalogEntry entry)
    {
        var icon = new FontIcon
        {
            Glyph = entry.Glyph,
            FontSize = 18,
            Foreground = Brush(entry.AccentBrushKey),
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var label = new Text { Value = entry.Label };
        var description = new Caption { Value = entry.Description };

        var textColumn = new StackPanel { Spacing = 2 };
        textColumn.Children.Add(label);
        textColumn.Children.Add(description);

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        row.Children.Add(icon);
        row.Children.Add(textColumn);

        var card = new Button
        {
            Content = row,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Top,
            Padding = new Thickness(16),
            Margin = new Thickness(0, 0, 12, 12),
            CornerRadius = new CornerRadius(12),
        };
        AutomationProperties.SetName(card, entry.Label);
        AutomationProperties.SetHelpText(card, entry.Description);
        ToolTipService.SetToolTip(card, entry.Description);
        card.Click += (_, _) => RaiseNavigate(entry.Path);
        return card;
    }

    private Button BuildChip(string glyph, string label, string accentBrushKey, string path)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 14,
            Foreground = Brush(accentBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var text = new TextBlock { Text = label, VerticalAlignment = VerticalAlignment.Center };
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(icon);
        row.Children.Add(text);

        var chip = new Button
        {
            Content = row,
            Padding = new Thickness(12, 6, 12, 6),
            CornerRadius = new CornerRadius(999),
        };
        AutomationProperties.SetName(chip, label);
        chip.Click += (_, _) => RaiseNavigate(path);
        return chip;
    }

    private Button BuildAnchorChip(ExploreAnchor anchor)
    {
        var title = new TextBlock { Text = anchor.SectionTitle, VerticalAlignment = VerticalAlignment.Center };
        var count = new TextBlock
        {
            Text = anchor.Count.ToString(System.Globalization.CultureInfo.CurrentCulture),
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = Brush("TsColorTextMutedBrush"),
        };
        AutomationProperties.SetName(count, anchor.CountAria);

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(title);
        row.Children.Add(count);

        var chip = new Button
        {
            Content = row,
            Padding = new Thickness(12, 4, 12, 4),
            CornerRadius = new CornerRadius(999),
        };
        AutomationProperties.SetName(chip, anchor.SectionTitle);
        chip.Click += (_, _) => BringSectionIntoView(anchor.Slug);
        return chip;
    }

    private Button BuildSuggestion(ExploreSuggestion suggestion)
    {
        var label = new TextBlock { Text = suggestion.Label, VerticalAlignment = VerticalAlignment.Center };
        var path = new TextBlock
        {
            Text = suggestion.Path,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
            Foreground = Brush("TsColorTextMutedBrush"),
        };

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(label, 0);
        Grid.SetColumn(path, 1);
        grid.Children.Add(label);
        grid.Children.Add(path);

        var button = new Button
        {
            Content = grid,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(12, 8, 12, 8),
            CornerRadius = new CornerRadius(8),
        };
        AutomationProperties.SetName(button, suggestion.Label);
        button.Click += (_, _) => RaiseNavigate(suggestion.Path);
        return button;
    }

    private void BringSectionIntoView(string slug)
    {
        if (_sectionBySlug.TryGetValue(slug, out var element))
        {
            element.StartBringIntoView();
        }
    }

    private void OnSearchTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetQuery(_searchInput.Text);
    }

    private void OnClearClick(object sender, RoutedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.ClearQuery();
    }

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        // web: "/" focuses the search field (unless typing in a field already).
        if ((int)e.Key != OemSlashKey && e.Key != Windows.System.VirtualKey.Divide)
        {
            return;
        }

        if (XamlRoot is null || FocusManager.GetFocusedElement(XamlRoot) is TextBox)
        {
            return;
        }

        e.Handled = _searchInput.Focus(FocusState.Programmatic);
    }

    private void RaiseNavigate(string path) => NavigationRequested?.Invoke(this, path);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;
}
