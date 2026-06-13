using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The native WinUI 3 <c>MaintenancePage</c> — a parity port of the web page
/// <c>web/src/features/vehicle-systems/pages/MaintenancePage.tsx</c> (route <c>/maintenance</c>, nav name
/// <c>Maintenance</c>). It binds to a <see cref="MaintenancePageViewModel"/> and renders every web region with Fluent
/// components and design tokens: the page header (title + subtitle), the failure banner (web <c>anyError</c>), the
/// loading shimmer, the four summary stat cards (Total Items / Due Soon / Overdue / Completed), the category + sort
/// toolbar with the Schedule affordance, the maintenance item grid (cards or empty), the estimated-annual-cost panel
/// (cost cards + note or empty), the service-projections panel (rows or empty) and the service-records panel (table or
/// empty). The view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="MaintenanceDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class MaintenancePage : UserControl, IDisposable
{
    private const string GlyphCost = "\uE825";       // Money / wallet
    private const string GlyphProjections = "\uE9D2"; // Trend
    private const string GlyphTag = "\uE8EC";        // Tag
    private const string GlyphMileage = "\uE9D9";    // Gauge
    private const string GlyphLastService = "\uE823"; // Recent / clock
    private const string GlyphSchedule = "\uE787";   // Calendar

    private readonly MaintenancePageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };

    private readonly StackPanel _loadingSkeleton = new() { Spacing = 24 };
    private readonly StackPanel _contentRoot = new() { Spacing = 24 };

    private readonly TsMetricCard _totalItemsCard = new();
    private readonly TsMetricCard _dueSoonCard = new();
    private readonly TsMetricCard _overdueCard = new();
    private readonly TsMetricCard _completedCard = new();

    private readonly TsSelect _categorySelect = new();
    private readonly TsSelect _sortSelect = new();
    private readonly TsButton _scheduleButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Medium, IconGlyph = GlyphSchedule };

    private readonly ContentControl _itemsHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsEmptyState _itemsEmpty = new() { IconGlyph = MaintenanceRegistration.WrenchGlyph };

    private readonly TsGlassPanel _costPanel = new();
    private readonly PanelTitle _costTitle = new();
    private readonly ContentControl _costBodyHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsMetricCard _totalSpentCard = new();
    private readonly TsMetricCard _annualEstCard = new();
    private readonly TsMetricCard _avgServiceCard = new();
    private readonly Text _costNote = new();
    private readonly TsEmptyState _costEmpty = new();

    private readonly TsGlassPanel _projectionsPanel = new();
    private readonly PanelTitle _projectionsTitle = new();
    private readonly ContentControl _projectionsHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsEmptyState _projectionsEmpty = new();

    private readonly TsGlassPanel _recordsPanel = new();
    private readonly PanelTitle _recordsTitle = new();
    private readonly ContentControl _recordsHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsDataTable _recordsTable = new() { Selectable = false, PageSize = 10 };
    private readonly TsEmptyState _recordsEmpty = new() { IconGlyph = MaintenanceRegistration.WrenchGlyph };

    private readonly List<string> _categoryValues = new();
    private readonly List<string> _sortValues = new();
    private bool _sortOptionsPopulated;
    private bool _suppressSelectionChange;

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public MaintenancePage()
        : this(EmptyMaintenanceFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The maintenance data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public MaintenancePage(IMaintenanceFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new MaintenancePageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        BuildContent();

        Content = BuildLayout();

        _categorySelect.SelectionChanged += OnCategoryChanged;
        _sortSelect.SelectionChanged += OnSortChanged;
        _scheduleButton.Click += OnScheduleInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>MaintenancePage</c>).</summary>
    public static string Slug => MaintenanceRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_errorBanner);
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_contentRoot);

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
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        return header;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(new TsStatGridSkeleton(4));
        _loadingSkeleton.Children.Add(new TsTableSkeleton());
    }

    private void BuildContent()
    {
        // GlassPanel1 — summary stat cards (web MetricCard grid).
        var summary = BuildEqualColumns(16, _totalItemsCard, _dueSoonCard, _overdueCard, _completedCard);
        AutomationProperties.SetName(summary, "Maintenance summary");
        _contentRoot.Children.Add(summary);

        // Filter / sort toolbar (web Select + Schedule Button).
        _contentRoot.Children.Add(BuildToolbar());

        // Maintenance item grid (web filteredItems / EmptyState).
        _contentRoot.Children.Add(_itemsHost);

        // Cost + projections row (web two-column GlassPanel grid).
        BuildCostPanel();
        BuildProjectionsPanel();
        _contentRoot.Children.Add(BuildEqualColumns(16, _costPanel, _projectionsPanel));

        // GlassPanel11 — service records (web DataTable).
        BuildRecordsPanel();
        _contentRoot.Children.Add(_recordsPanel);
    }

    private Grid BuildToolbar()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        _categorySelect.MinWidth = 180;
        _sortSelect.MinWidth = 160;
        Grid.SetColumn(_categorySelect, 0);
        Grid.SetColumn(_sortSelect, 1);

        _scheduleButton.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(_scheduleButton, 2);

        grid.Children.Add(_categorySelect);
        grid.Children.Add(_sortSelect);
        grid.Children.Add(_scheduleButton);
        return grid;
    }

    private void BuildCostPanel()
    {
        _costPanel.Padding = new Thickness(24);

        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(BuildPanelHeader(GlyphCost, _costTitle, "TsColorSuccessBrush"));
        column.Children.Add(_costBodyHost);
        _costPanel.Content = column;
    }

    private void BuildProjectionsPanel()
    {
        _projectionsPanel.Padding = new Thickness(24);

        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(BuildPanelHeader(GlyphProjections, _projectionsTitle, "TsColorAccentBrush"));
        column.Children.Add(_projectionsHost);
        _projectionsPanel.Content = column;
    }

    private void BuildRecordsPanel()
    {
        _recordsPanel.Padding = new Thickness(24);

        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(_recordsTitle);
        column.Children.Add(_recordsHost);
        _recordsPanel.Content = column;
    }

    private static StackPanel BuildPanelHeader(string glyph, PanelTitle title, string accentBrushKey)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new FontIcon { Glyph = glyph, FontSize = 16, Foreground = Brush(accentBrushKey), VerticalAlignment = VerticalAlignment.Center });
        title.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(title);
        return row;
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
        _categorySelect.SelectionChanged -= OnCategoryChanged;
        _sortSelect.SelectionChanged -= OnSortChanged;
        _scheduleButton.Click -= OnScheduleInvoked;
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

    private void Render(MaintenanceDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Failure banner (web anyError AlertBanner).
        _errorBanner.Message = display.ErrorText;
        _errorBanner.IsOpen = display.ShowError;
        _errorBanner.Visibility = Show(display.ShowError);
        AutomationProperties.SetName(_errorBanner, display.ErrorText);

        // Loading shimmer.
        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        // Content region.
        _contentRoot.Visibility = Show(display.ShowContent);

        RenderSummary(display.SummaryCards);
        RenderToolbar(display);
        RenderItems(display);
        RenderCost(display);
        RenderProjections(display);
        RenderRecords(display);
    }

    private void RenderSummary(IReadOnlyList<MaintenanceMetric> cards)
    {
        ApplyMetric(_totalItemsCard, cards[0]);
        ApplyMetric(_dueSoonCard, cards[1]);
        ApplyMetric(_overdueCard, cards[2]);
        ApplyMetric(_completedCard, cards[3]);
    }

    private void RenderToolbar(MaintenanceDisplay display)
    {
        _scheduleButton.Text = display.ScheduleLabel;
        AutomationProperties.SetName(_scheduleButton, display.ScheduleLabel);

        _suppressSelectionChange = true;
        try
        {
            RenderCategoryOptions(display.CategoryOptions);
            RenderSortOptions(display.SortOptions);
        }
        finally
        {
            _suppressSelectionChange = false;
        }
    }

    private void RenderCategoryOptions(IReadOnlyList<MaintenanceOption> options)
    {
        var labels = new List<string>(options.Count);
        _categoryValues.Clear();
        int selected = -1;
        for (var i = 0; i < options.Count; i++)
        {
            labels.Add(options[i].Label);
            _categoryValues.Add(options[i].Value);
            if (options[i].IsSelected)
            {
                selected = i;
            }
        }

        _categorySelect.ItemsSource = labels;
        _categorySelect.SelectedIndex = selected;
    }

    private void RenderSortOptions(IReadOnlyList<MaintenanceOption> options)
    {
        if (!_sortOptionsPopulated)
        {
            var labels = new List<string>(options.Count);
            foreach (var option in options)
            {
                labels.Add(option.Label);
                _sortValues.Add(option.Value);
            }

            _sortSelect.ItemsSource = labels;
            _sortOptionsPopulated = true;
        }

        for (var i = 0; i < options.Count; i++)
        {
            if (options[i].IsSelected)
            {
                _sortSelect.SelectedIndex = i;
                break;
            }
        }
    }

    private void RenderItems(MaintenanceDisplay display)
    {
        if (display.ShowItems)
        {
            _itemsHost.Content = BuildItemsGrid(display.ItemCards);
        }
        else
        {
            _itemsEmpty.Title = display.ItemsEmptyTitle;
            _itemsEmpty.Message = display.ItemsEmptyMessage;
            AutomationProperties.SetName(_itemsEmpty, display.ItemsEmptyTitle);
            _itemsHost.Content = _itemsEmpty;
        }
    }

    private void RenderCost(MaintenanceDisplay display)
    {
        _costTitle.Value = display.CostTitle;
        AutomationProperties.SetName(_costPanel, display.CostTitle);

        if (display.ShowCostCards)
        {
            ApplyMetric(_totalSpentCard, display.CostCards[0]);
            ApplyMetric(_annualEstCard, display.CostCards[1]);
            ApplyMetric(_avgServiceCard, display.CostCards[2]);
            _costNote.Value = display.CostNote;
            _costBodyHost.Content = BuildCostBody();
        }
        else
        {
            _costEmpty.Message = display.CostEmptyMessage;
            AutomationProperties.SetName(_costEmpty, display.CostEmptyMessage);
            _costBodyHost.Content = _costEmpty;
        }
    }

    private StackPanel BuildCostBody()
    {
        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(BuildEqualColumns(12, _totalSpentCard, _annualEstCard, _avgServiceCard));

        var note = new Border
        {
            Padding = new Thickness(12),
            CornerRadius = new CornerRadius(8),
            BorderThickness = new Thickness(1),
            BorderBrush = Brush("TsColorSuccessBrush"),
            Background = Brush("TsColorSurfaceBrush"),
            Child = _costNote,
        };
        body.Children.Add(note);
        return body;
    }

    private void RenderProjections(MaintenanceDisplay display)
    {
        _projectionsTitle.Value = display.ProjectionsTitle;
        AutomationProperties.SetName(_projectionsPanel, display.ProjectionsTitle);

        if (display.ShowProjections)
        {
            _projectionsHost.Content = BuildProjectionList(display.ProjectionRows);
        }
        else
        {
            _projectionsEmpty.Message = display.ProjectionsEmptyMessage;
            AutomationProperties.SetName(_projectionsEmpty, display.ProjectionsEmptyMessage);
            _projectionsHost.Content = _projectionsEmpty;
        }
    }

    private void RenderRecords(MaintenanceDisplay display)
    {
        _recordsTitle.Value = display.RecordsTitle;
        AutomationProperties.SetName(_recordsPanel, display.RecordsTitle);

        if (display.ShowRecords)
        {
            _recordsTable.Columns = BuildColumns(display.RecordColumns);
            _recordsTable.Rows = BuildRows(display.RecordRows);
            _recordsTable.EmptyMessage = display.RecordsEmptyTableMessage;
            AutomationProperties.SetName(_recordsTable, display.RecordsTitle);
            _recordsHost.Content = _recordsTable;
        }
        else
        {
            _recordsEmpty.Message = display.RecordsEmptyMessage;
            AutomationProperties.SetName(_recordsEmpty, display.RecordsEmptyMessage);
            _recordsHost.Content = _recordsEmpty;
        }
    }

    private static Grid BuildItemsGrid(IReadOnlyList<MaintenanceItemCardDisplay> cards)
    {
        const int columns = 3;
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        for (var c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (cards.Count + columns - 1) / columns;
        for (var r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (var i = 0; i < cards.Count; i++)
        {
            var card = BuildItemCard(cards[i]);
            Grid.SetRow(card, i / columns);
            Grid.SetColumn(card, i % columns);
            grid.Children.Add(card);
        }

        return grid;
    }

    private static TsGlassPanel BuildItemCard(MaintenanceItemCardDisplay card)
    {
        var column = new StackPanel { Spacing = 12 };

        var chips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        chips.Children.Add(BuildCategoryChip(card.CategoryLabel, card.CategoryAccentBrushKey));
        chips.Children.Add(BuildStatusBadge(card.StatusLabel, card.StatusKind));
        column.Children.Add(chips);

        column.Children.Add(new PanelTitle { Value = card.Name });
        if (!string.IsNullOrEmpty(card.Description))
        {
            column.Children.Add(new Caption { Value = card.Description });
        }

        if (card.ShowProgress)
        {
            var progressHeader = new Grid();
            progressHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            progressHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var pct = new Caption { Value = card.ProgressPercentText };
            Grid.SetColumn(pct, 0);
            progressHeader.Children.Add(pct);

            if (card.HasDue)
            {
                var due = new Caption { Value = card.DueText, HorizontalAlignment = HorizontalAlignment.Right };
                Grid.SetColumn(due, 1);
                progressHeader.Children.Add(due);
            }

            var bar = new StackPanel { Spacing = 4 };
            bar.Children.Add(progressHeader);
            bar.Children.Add(BuildProgressBar(card.ProgressFraction, card.ProgressColorBrushKey));
            column.Children.Add(bar);
        }

        if (card.HasMileage || card.HasLastService)
        {
            var footer = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16 };
            if (card.HasMileage)
            {
                footer.Children.Add(BuildFooterChip(GlyphMileage, card.MileageText));
            }

            if (card.HasLastService)
            {
                footer.Children.Add(BuildFooterChip(GlyphLastService, card.LastServiceText));
            }

            column.Children.Add(footer);
        }

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = column };
        AutomationProperties.SetName(panel, $"{card.Name} {card.StatusLabel}");
        return panel;
    }

    private static Border BuildCategoryChip(string label, string accentBrushKey)
    {
        var accent = Brush(accentBrushKey);
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new FontIcon { Glyph = GlyphTag, FontSize = 12, Foreground = accent, VerticalAlignment = VerticalAlignment.Center });
        row.Children.Add(new TextBlock { Text = label, Foreground = accent, VerticalAlignment = VerticalAlignment.Center });

        return new Border
        {
            Padding = new Thickness(8, 2, 8, 2),
            CornerRadius = new CornerRadius(6),
            BorderThickness = new Thickness(1),
            BorderBrush = accent,
            Background = Brush("TsColorSurfaceBrush"),
            Child = row,
        };
    }

    private static TsBadge BuildStatusBadge(string label, StatusKind kind)
    {
        var badge = new TsBadge { Status = kind };
        badge.Content = new TextBlock { Text = label };
        AutomationProperties.SetName(badge, label);
        return badge;
    }

    private static Grid BuildProgressBar(double fraction, string colorBrushKey)
    {
        double filled = Math.Min(Math.Max(fraction, 0.0), 1.0);
        double remaining = 1.0 - filled;

        var track = new Grid { Height = 8 };
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(filled, GridUnitType.Star) });
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(remaining, GridUnitType.Star) });

        var background = new Border
        {
            CornerRadius = new CornerRadius(4),
            Background = Brush("TsColorSurfaceBrush"),
        };
        Grid.SetColumnSpan(background, 2);

        var fill = new Border
        {
            CornerRadius = new CornerRadius(4),
            Background = Brush(colorBrushKey),
        };
        Grid.SetColumn(fill, 0);

        track.Children.Add(background);
        track.Children.Add(fill);
        return track;
    }

    private static StackPanel BuildFooterChip(string glyph, string text)
    {
        var chip = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        chip.Children.Add(new FontIcon { Glyph = glyph, FontSize = 12, Foreground = Brush("TsColorTextSecondaryBrush"), VerticalAlignment = VerticalAlignment.Center });
        chip.Children.Add(new Caption { Value = text, VerticalAlignment = VerticalAlignment.Center });
        return chip;
    }

    private static StackPanel BuildProjectionList(IReadOnlyList<MaintenanceProjectionRow> rows)
    {
        var list = new StackPanel { Spacing = 10 };
        foreach (var row in rows)
        {
            var grid = new Grid { ColumnSpacing = 12 };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var name = new Text { Value = row.Name, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(name, 0);

            var trailing = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Right };
            if (row.HasDetail)
            {
                trailing.Children.Add(new Caption { Value = row.DetailText, VerticalAlignment = VerticalAlignment.Center });
            }

            trailing.Children.Add(BuildStatusBadge(row.BadgeLabel, row.BadgeStatus));
            Grid.SetColumn(trailing, 1);

            grid.Children.Add(name);
            grid.Children.Add(trailing);
            AutomationProperties.SetName(grid, $"{row.Name} {row.BadgeLabel}");
            list.Children.Add(grid);
        }

        return list;
    }

    private static List<TsDataColumn> BuildColumns(IReadOnlyList<MaintenanceColumn> columns)
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

    private static List<TsDataRow> BuildRows(IReadOnlyList<MaintenanceRecordRow> rows)
    {
        var built = new List<TsDataRow>(rows.Count);
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["date"] = row.Date,
                ["description"] = row.Description,
                ["mileage"] = row.Mileage,
                ["cost"] = row.Cost,
                ["provider"] = row.Provider,
            };
            built.Add(new TsDataRow(row.Id, values));
        }

        return built;
    }

    private static void ApplyMetric(TsMetricCard card, MaintenanceMetric metric)
    {
        card.Label = metric.Label;
        card.Value = metric.Value;
        card.AccentBrushKey = metric.AccentBrushKey;
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

    private void OnCategoryChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressSelectionChange)
        {
            return;
        }

        int index = _categorySelect.SelectedIndex;
        if (index < 0 || index >= _categoryValues.Count)
        {
            return;
        }

        _viewModel.SetCategoryFilter(_categoryValues[index]);
    }

    private void OnSortChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressSelectionChange)
        {
            return;
        }

        int index = _sortSelect.SelectedIndex;
        if (index < 0 || index >= _sortValues.Count)
        {
            return;
        }

        _viewModel.SetSort(_sortValues[index]);
    }

    // The web Schedule affordance opens a scheduling modal that is outside this surface's parity scope; the button
    // stays present and accessible so the toolbar matches the web layout.
    private void OnScheduleInvoked(object sender, RoutedEventArgs e)
    {
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;

    protected override AutomationPeer OnCreateAutomationPeer() => new MaintenancePageAutomationPeer(this);

    private sealed class MaintenancePageAutomationPeer(MaintenancePage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
