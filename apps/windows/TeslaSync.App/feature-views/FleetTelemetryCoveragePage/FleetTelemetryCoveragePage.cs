using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>FleetTelemetryCoveragePage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx</c> (route <c>/admin/telemetry/coverage</c>, nav name
/// <c>FleetTelemetryCoverage</c>). It binds to a <see cref="FleetTelemetryCoveragePageViewModel"/> and renders every web
/// region with Fluent components and design tokens: the page header (title + subtitle + Refresh), the five summary stat
/// tiles (Categories / Routed fields / Subscribed / Routed-not-subscribed / Orphan fields), the legend "Reading this
/// page" panel, the destination-breakdown panel, the conditional orphan-fields warning panel, the filter panel, and the
/// bottom data-state region whose body switches between the loading spinner, the failure panel, the empty / filter-empty
/// states and the per-category sections — each section carrying its destination chips and the per-field table (field,
/// destination, column, dual-write, subscribed). The view is a thin renderer: all branch selection, formatting and i18n
/// happen in the view-model's <see cref="FleetTelemetryCoverageDisplay"/> projection. State changes are marshalled onto
/// the UI thread.
/// </summary>
public sealed partial class FleetTelemetryCoveragePage : UserControl, IDisposable
{
    private const double PanelPadding = 20;

    private readonly FleetTelemetryCoveragePageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsButton _refreshButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE72C" };

    private readonly TsStatCard _categoriesCard = new();
    private readonly TsStatCard _routedFieldsCard = new();
    private readonly TsStatCard _subscribedCard = new();
    private readonly TsStatCard _routedNotSubscribedCard = new();
    private readonly TsStatCard _orphansCard = new();

    private readonly TsGlassPanel _legendPanel = new();
    private readonly PanelTitle _legendTitle = new();
    private readonly Caption _legendIntro = new();
    private readonly TextBlock _legendColumn = new() { TextWrapping = TextWrapping.Wrap };
    private readonly TextBlock _legendDualWrite = new() { TextWrapping = TextWrapping.Wrap };
    private readonly TextBlock _legendSubscribed = new() { TextWrapping = TextWrapping.Wrap };

    private readonly TsGlassPanel _destinationsPanel = new();
    private readonly PanelTitle _destinationsTitle = new();
    private readonly Caption _destinationsHelp = new();
    private readonly Caption _destinationsEmpty = new();
    private readonly StackPanel _destinationsChips = new() { Orientation = Orientation.Horizontal, Spacing = 8 };

    private readonly TsGlassPanel _orphansPanel = new();
    private readonly PanelTitle _orphansTitle = new();
    private readonly Caption _orphansHelp = new();
    private readonly StackPanel _orphansList = new() { Spacing = 2, Margin = new Thickness(24, 8, 0, 0) };

    private readonly TsGlassPanel _filterPanel = new();
    private readonly TsInput _filterInput = new();

    private readonly StackPanel _loadingPanel;
    private readonly TsSpinner _spinner = new() { Size = ControlSize.Small };
    private readonly Text _loadingText = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly TsGlassPanel _errorPanel = new();
    private readonly ErrorText _errorText = new();

    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uE9D9" };

    private readonly StackPanel _categoriesPanel = new() { Spacing = 16 };

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public FleetTelemetryCoveragePage()
        : this(EmptyFleetTelemetryCoverageFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The coverage data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public FleetTelemetryCoveragePage(IFleetTelemetryCoverageFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new FleetTelemetryCoveragePageViewModel(feed, localizer);

        _loadingPanel = BuildLoadingPanel();

        BuildLegendPanel();
        BuildDestinationsPanel();
        BuildOrphansPanel();
        BuildFilterPanel();
        BuildErrorPanel();

        Content = BuildLayout();

        _refreshButton.Click += OnRefreshClick;
        _filterInput.TextChanged += OnFilterChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>FleetTelemetryCoveragePage</c>).</summary>
    public static string Slug => FleetTelemetryCoverageRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(BuildStatsGrid());
        stack.Children.Add(_legendPanel);
        stack.Children.Add(_destinationsPanel);
        stack.Children.Add(_orphansPanel);
        stack.Children.Add(_filterPanel);
        stack.Children.Add(_loadingPanel);
        stack.Children.Add(_errorPanel);
        stack.Children.Add(_emptyState);
        stack.Children.Add(_categoriesPanel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var header = new Grid { ColumnSpacing = 16 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = new StackPanel { Spacing = 4 };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);
        Grid.SetColumn(heading, 0);

        _refreshButton.VerticalAlignment = VerticalAlignment.Top;
        Grid.SetColumn(_refreshButton, 1);

        header.Children.Add(heading);
        header.Children.Add(_refreshButton);
        return header;
    }

    private Grid BuildStatsGrid() => BuildEqualColumns(
        12,
        _categoriesCard,
        _routedFieldsCard,
        _subscribedCard,
        _routedNotSubscribedCard,
        _orphansCard);

    private void BuildLegendPanel()
    {
        var body = new StackPanel { Spacing = 8, Padding = new Thickness(PanelPadding) };
        body.Children.Add(_legendTitle);
        body.Children.Add(_legendIntro);

        var items = new StackPanel { Spacing = 8 };
        items.Children.Add(_legendColumn);
        items.Children.Add(_legendDualWrite);
        items.Children.Add(_legendSubscribed);
        body.Children.Add(items);

        _legendPanel.Content = body;
    }

    private void BuildDestinationsPanel()
    {
        var body = new StackPanel { Spacing = 8, Padding = new Thickness(PanelPadding) };
        body.Children.Add(_destinationsTitle);
        body.Children.Add(_destinationsHelp);
        _destinationsEmpty.Visibility = Visibility.Collapsed;
        body.Children.Add(_destinationsEmpty);
        body.Children.Add(_destinationsChips);

        _destinationsPanel.Content = body;
    }

    private void BuildOrphansPanel()
    {
        var body = new StackPanel { Spacing = 4, Padding = new Thickness(PanelPadding) };

        var headerRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        headerRow.Children.Add(new FontIcon
        {
            Glyph = "\uE7BA",
            FontSize = 16,
            VerticalAlignment = VerticalAlignment.Top,
            Foreground = Brush("TsColorWarningBrush"),
        });

        var headerText = new StackPanel { Spacing = 4 };
        headerText.Children.Add(_orphansTitle);
        headerText.Children.Add(_orphansHelp);
        headerRow.Children.Add(headerText);

        body.Children.Add(headerRow);
        body.Children.Add(_orphansList);

        _orphansPanel.BorderBrush = Brush("TsColorWarningBrush");
        _orphansPanel.Content = body;
    }

    private void BuildFilterPanel()
    {
        var body = new StackPanel { Padding = new Thickness(PanelPadding) };
        _filterInput.HorizontalAlignment = HorizontalAlignment.Stretch;
        body.Children.Add(_filterInput);
        _filterPanel.Content = body;
    }

    private void BuildErrorPanel()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, Padding = new Thickness(16) };
        row.Children.Add(new FontIcon
        {
            Glyph = "\uEA39",
            FontSize = 16,
            VerticalAlignment = VerticalAlignment.Top,
            Foreground = Brush("TsColorDangerBrush"),
        });
        _errorText.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(_errorText);

        _errorPanel.BorderBrush = Brush("TsColorDangerBrush");
        _errorPanel.Content = row;
    }

    private StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            Padding = new Thickness(0, 24, 0, 24),
            VerticalAlignment = VerticalAlignment.Center,
        };
        panel.Children.Add(_spinner);
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
        _refreshButton.Click -= OnRefreshClick;
        _filterInput.TextChanged -= OnFilterChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnFilterChanged(object sender, TextChangedEventArgs e) => _viewModel.SetFilter(_filterInput.Text);

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

    private void Render(FleetTelemetryCoverageDisplay display)
    {
        // ── Header ──────────────────────────────────────────────────────────────────────────────────────────
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        _refreshButton.Text = display.RefreshLabel;
        _refreshButton.IsLoading = _viewModel.IsFetching && !display.ShowLoading;
        AutomationProperties.SetName(_refreshButton, display.RefreshLabel);
        AutomationProperties.SetName(this, display.AutomationName);

        // ── Summary stat tiles ──────────────────────────────────────────────────────────────────────────────
        _categoriesCard.Label = display.StatCategoriesLabel;
        _categoriesCard.Value = display.StatCategoriesValue;
        _routedFieldsCard.Label = display.StatRoutedFieldsLabel;
        _routedFieldsCard.Value = display.StatRoutedFieldsValue;
        _subscribedCard.Label = display.StatSubscribedLabel;
        _subscribedCard.Value = display.StatSubscribedValue;
        _routedNotSubscribedCard.Label = display.StatRoutedNotSubscribedLabel;
        _routedNotSubscribedCard.Value = display.StatRoutedNotSubscribedValue;
        _orphansCard.Label = display.StatOrphansLabel;
        _orphansCard.Value = display.StatOrphansValue;

        // ── Legend panel ────────────────────────────────────────────────────────────────────────────────────
        _legendTitle.Value = display.LegendTitle;
        _legendIntro.Value = display.LegendIntro;
        SetLegendItem(_legendColumn, display.LegendColumnLabel, display.LegendColumnHelp);
        SetLegendItem(_legendDualWrite, display.LegendDualWriteLabel, display.LegendDualWriteHelp);
        SetLegendItem(_legendSubscribed, display.LegendSubscribedLabel, display.LegendSubscribedHelp);
        AutomationProperties.SetName(_legendPanel, display.LegendTitle);

        // ── Destination breakdown ───────────────────────────────────────────────────────────────────────────
        _destinationsTitle.Value = display.DestinationsTitle;
        _destinationsHelp.Value = display.DestinationsHelp;
        _destinationsEmpty.Value = display.DestinationsEmptyText;
        _destinationsEmpty.Visibility = Show(!display.HasDestinations);
        _destinationsChips.Visibility = Show(display.HasDestinations);
        _destinationsChips.Children.Clear();
        foreach (var chip in display.DestinationChips)
        {
            _destinationsChips.Children.Add(BuildChip(chip));
        }

        AutomationProperties.SetName(_destinationsPanel, display.DestinationsTitle);

        // ── Orphan-fields warning panel (conditional) ───────────────────────────────────────────────────────
        _orphansPanel.Visibility = Show(display.ShowOrphans);
        _orphansTitle.Value = display.OrphansTitle;
        _orphansHelp.Value = display.OrphansHelp;
        _orphansList.Children.Clear();
        foreach (var orphan in display.Orphans)
        {
            _orphansList.Children.Add(BuildOrphanRow(orphan));
        }

        AutomationProperties.SetName(_orphansPanel, display.OrphansTitle);

        // ── Filter panel (hint only; the filter text is user-owned) ─────────────────────────────────────────
        _filterInput.Hint = display.FilterHint;
        AutomationProperties.SetName(_filterInput, display.FilterHint);

        // ── Bottom data-state region ────────────────────────────────────────────────────────────────────────
        _loadingPanel.Visibility = Show(display.ShowLoading);
        _loadingText.Value = display.LoadingText;

        _errorPanel.Visibility = Show(display.ShowError);
        _errorText.Value = display.ErrorText;
        AutomationProperties.SetName(_errorPanel, display.ErrorText);

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Message = display.EmptyText;

        _categoriesPanel.Visibility = Show(display.ShowCategories);
        _categoriesPanel.Children.Clear();
        if (display.ShowCategories)
        {
            foreach (var category in display.Categories)
            {
                _categoriesPanel.Children.Add(BuildCategorySection(category, display));
            }
        }
    }

    // web CategorySection: a GlassPanel with the category name + total-fields caption, the per-destination chips,
    // and either the per-field table or the "no match" copy.
    private static TsGlassPanel BuildCategorySection(CoverageCategoryDisplay category, FleetTelemetryCoverageDisplay display)
    {
        var body = new StackPanel { Spacing = 12, Padding = new Thickness(PanelPadding) };

        var headerRow = new Grid { ColumnSpacing = 12 };
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleStack = new StackPanel { Spacing = 4 };
        titleStack.Children.Add(new PanelTitle { Value = category.Category });
        titleStack.Children.Add(new Caption { Value = category.TotalFieldsCaption });
        Grid.SetColumn(titleStack, 0);
        headerRow.Children.Add(titleStack);

        var headerChips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        foreach (var chip in category.DestinationChips)
        {
            headerChips.Children.Add(BuildChip(chip));
        }

        Grid.SetColumn(headerChips, 1);
        headerRow.Children.Add(headerChips);
        body.Children.Add(headerRow);

        if (category.HasFields)
        {
            body.Children.Add(BuildFieldTable(category, display));
        }
        else
        {
            body.Children.Add(new Caption { Value = category.EmptyFieldsText });
        }

        var panel = new TsGlassPanel { Content = body };
        AutomationProperties.SetName(panel, category.AutomationName);
        return panel;
    }

    // web buildFieldColumns: field (mono) · destination (badge) · column (mono / em-dash) · dual write (badge / em-dash)
    // · subscribed (yes/no badge). Rendered as a token-aligned grid table with a header row.
    private static StackPanel BuildFieldTable(CoverageCategoryDisplay category, FleetTelemetryCoverageDisplay display)
    {
        var table = new StackPanel { Spacing = 0 };

        var header = NewRowGrid();
        AddCell(header, 0, new Caption { Value = display.ColumnFieldHeader });
        AddCell(header, 1, new Caption { Value = display.ColumnDestinationHeader });
        AddCell(header, 2, new Caption { Value = display.ColumnColumnHeader });
        AddCell(header, 3, new Caption { Value = display.ColumnDualWriteHeader });
        AddCell(header, 4, new Caption { Value = display.ColumnSubscribedHeader });
        header.BorderBrush = Brush("TsColorBorderBrush");
        header.BorderThickness = new Thickness(0, 0, 0, 1);
        header.Padding = new Thickness(0, 0, 0, 6);
        table.Children.Add(header);

        foreach (var row in category.Fields)
        {
            table.Children.Add(BuildFieldRow(row));
        }

        return table;
    }

    private static Grid BuildFieldRow(CoverageFieldRowDisplay row)
    {
        var grid = NewRowGrid();
        grid.Padding = new Thickness(0, 6, 0, 6);

        AddCell(grid, 0, new Code { Value = row.Field, VerticalAlignment = VerticalAlignment.Center });
        AddCell(grid, 1, BadgeCell(row.Destination, StatusKind.Info));
        AddCell(grid, 2, row.HasColumn
            ? new Code { Value = row.ColumnText, VerticalAlignment = VerticalAlignment.Center }
            : new Caption { Value = row.ColumnText, VerticalAlignment = VerticalAlignment.Center });
        AddCell(grid, 3, row.AlsoSignalLog
            ? BadgeCell(row.DualWriteText, StatusKind.Warning)
            : new Caption { Value = "\u2014", VerticalAlignment = VerticalAlignment.Center });
        AddCell(grid, 4, BadgeCell(row.SubscribedText, row.Subscribed ? StatusKind.Success : StatusKind.Neutral));

        AutomationProperties.SetName(grid, $"{row.Field} {row.Destination} {row.SubscribedText}");
        return grid;
    }

    private static TsBadge BadgeCell(string content, StatusKind tone) => new()
    {
        Status = tone,
        Content = content,
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static TsBadge BuildChip(CoverageDestinationChip chip) => new()
    {
        Status = chip.Tone,
        Content = chip.Label,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildOrphanRow(string orphan)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(new TextBlock
        {
            Text = "\u2022",
            Foreground = Brush("TsColorWarningBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new Code { Value = orphan, VerticalAlignment = VerticalAlignment.Center });
        return row;
    }

    private static void SetLegendItem(TextBlock target, string label, string help)
    {
        target.Inlines.Clear();
        target.Foreground = Brush("TsColorTextSecondaryBrush");
        target.Inlines.Add(new Run
        {
            Text = label,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = Brush("TsColorTextPrimaryBrush"),
        });
        target.Inlines.Add(new Run { Text = " " + help });
    }

    // A grid of equal-width star columns hosting each child, matching the web responsive card grid.
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

    // The 5-column field-table row template (field / destination / column / dual-write / subscribed).
    private static Grid NewRowGrid()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        double[] weights = [2.0, 1.5, 2.0, 1.2, 1.0];
        foreach (var weight in weights)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(weight, GridUnitType.Star) });
        }

        return grid;
    }

    private static void AddCell(Grid grid, int column, FrameworkElement content)
    {
        Grid.SetColumn(content, column);
        grid.Children.Add(content);
    }

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;
}
