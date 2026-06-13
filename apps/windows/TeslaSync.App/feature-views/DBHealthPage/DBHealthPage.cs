using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Diagnostics;

/// <summary>
/// The native WinUI 3 <c>DBHealthPage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/DBHealthPage.tsx</c> (route <c>/db-health</c>, nav name
/// <c>DBHealthDashboard</c>). It binds to a <see cref="DBHealthPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle + the auto-refresh indicator), the top
/// "error loading data" banner (web <c>queryError</c>), the four summary stat cards (Total DB Size / Tables /
/// Large Tables &gt; 100&#160;MB / Migration Version), the Table-Sizes (Top 15) bar chart in a
/// <see cref="TsChartContainer"/>, the tables list panel (sort control + paginated <see cref="TsDataTable"/>), the
/// migration-status panel (current version, dirty/clean status, pending, recent migrations) and the connection-pool
/// panel (the six pool metrics + the usage bar). The view is a thin renderer: all branch selection, formatting and
/// i18n happen in the view-model's <see cref="DbHealthDisplay"/> projection. State changes are marshalled onto the
/// UI thread; an auto-refresh timer mirrors the web 30&#160;s refetch interval.
/// </summary>
public sealed partial class DBHealthPage : UserControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";     // Segoe Fluent — Refresh
    private const string SortGlyph = "\uE8CB";        // Segoe Fluent — Sort
    private const double ChartHeight = 300;           // web ChartContainer height={300}
    private const double BarHeight = 16;              // web Bar barSize={16}
    private const double CategoryWidth = 140;          // web YAxis width={140}
    private const int AutoRefreshSeconds = 30;        // web INTERVALS.STANDARD (Auto-refresh 30s)

    private readonly DBHealthPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private DispatcherQueueTimer? _autoRefresh;
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly FontIcon _refreshIcon = new() { Glyph = RefreshGlyph, FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _autoRefreshLabel = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };

    private readonly TsStatCard _totalSizeCard = new();
    private readonly TsStatCard _tablesCard = new();
    private readonly TsStatCard _largeTablesCard = new();
    private readonly TsStatCard _migrationCard = new();

    private readonly TsChartContainer _chartContainer = new();

    private readonly TsGlassPanel _tablesPanel = new();
    private readonly PanelTitle _tablesTitle = new();
    private readonly TsButton _sortSizeButton = new() { Size = ControlSize.Small };
    private readonly TsButton _sortRowsButton = new() { Size = ControlSize.Small };
    private readonly TsButton _sortNameButton = new() { Size = ControlSize.Small };
    private readonly ContentControl _tableHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsDataTable _table = new() { PageSize = 10 };
    private readonly TsDataColumn _colName = new() { Key = "name", Width = 220, CanSort = false };
    private readonly TsDataColumn _colRows = new() { Key = "rows", Width = 110, CanSort = false, IsNumeric = true };
    private readonly TsDataColumn _colSize = new() { Key = "size", Width = 100, CanSort = false, IsNumeric = true };
    private readonly TsDataColumn _colIndexes = new() { Key = "indexes", Width = 90, CanSort = false, IsNumeric = true };
    private readonly TsDataColumn _colVacuum = new() { Key = "vacuum", Width = 150, CanSort = false, IsNumeric = true };

    private readonly TsGlassPanel _migrationPanel = new();
    private readonly PanelTitle _migrationTitle = new();
    private readonly ContentControl _migrationHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    private readonly TsGlassPanel _poolPanel = new();
    private readonly PanelTitle _poolTitle = new();
    private readonly ContentControl _poolHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public DBHealthPage()
        : this(EmptyDbHealthFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The DB-health data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public DBHealthPage(IDbHealthFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new DBHealthPageViewModel(feed, localizer);

        BuildTablesPanel();
        BuildMigrationPanel();
        BuildPoolPanel();
        ConfigureTableColumns();

        Content = BuildLayout();

        _sortSizeButton.Click += (_, _) => _viewModel.SetSort(DbHealthSortKey.Size);
        _sortRowsButton.Click += (_, _) => _viewModel.SetSort(DbHealthSortKey.Rows);
        _sortNameButton.Click += (_, _) => _viewModel.SetSort(DbHealthSortKey.Name);

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>DBHealthPage</c>).</summary>
    public static string Slug => DbHealthRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_errorBanner);
        stack.Children.Add(BuildStatCards());
        stack.Children.Add(_chartContainer);
        stack.Children.Add(BuildBottomGrid());

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

        var topRow = new Grid();
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_title, 0);

        var refreshChip = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        refreshChip.Children.Add(_refreshIcon);
        refreshChip.Children.Add(_autoRefreshLabel);
        Grid.SetColumn(refreshChip, 1);

        topRow.Children.Add(_title);
        topRow.Children.Add(refreshChip);

        header.Children.Add(topRow);
        header.Children.Add(_subtitle);
        return header;
    }

    private Grid BuildStatCards() =>
        BuildEqualColumns(16, _totalSizeCard, _tablesCard, _largeTablesCard, _migrationCard);

    private Grid BuildBottomGrid()
    {
        var grid = new Grid { ColumnSpacing = 24 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        Grid.SetColumn(_tablesPanel, 0);
        grid.Children.Add(_tablesPanel);

        var sidebar = new StackPanel { Spacing = 16 };
        sidebar.Children.Add(_migrationPanel);
        sidebar.Children.Add(_poolPanel);
        Grid.SetColumn(sidebar, 1);
        grid.Children.Add(sidebar);

        return grid;
    }

    private void BuildTablesPanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(20) };

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _tablesTitle.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_tablesTitle, 0);

        var sortRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        sortRow.Children.Add(new FontIcon { Glyph = SortGlyph, FontSize = 14, VerticalAlignment = VerticalAlignment.Center });
        sortRow.Children.Add(_sortSizeButton);
        sortRow.Children.Add(_sortRowsButton);
        sortRow.Children.Add(_sortNameButton);
        Grid.SetColumn(sortRow, 1);

        headerRow.Children.Add(_tablesTitle);
        headerRow.Children.Add(sortRow);

        body.Children.Add(headerRow);
        body.Children.Add(_tableHost);

        _tablesPanel.Padding = new Thickness(0);
        _tablesPanel.Content = body;
    }

    private void BuildMigrationPanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(20) };
        body.Children.Add(_migrationTitle);
        body.Children.Add(_migrationHost);
        _migrationPanel.Padding = new Thickness(0);
        _migrationPanel.Content = body;
    }

    private void BuildPoolPanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(20) };
        body.Children.Add(_poolTitle);
        body.Children.Add(_poolHost);
        _poolPanel.Padding = new Thickness(0);
        _poolPanel.Content = body;
    }

    private void ConfigureTableColumns()
    {
        _table.Columns = [_colName, _colRows, _colSize, _colIndexes, _colVacuum];
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();

        _autoRefresh ??= CreateAutoRefreshTimer();
        _autoRefresh.Start();

        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private DispatcherQueueTimer CreateAutoRefreshTimer()
    {
        var timer = _dispatcher.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(AutoRefreshSeconds);
        timer.IsRepeating = true;
        timer.Tick += OnAutoRefreshTick;
        return timer;
    }

    private void OnAutoRefreshTick(DispatcherQueueTimer sender, object args) =>
        InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_autoRefresh is { } timer)
        {
            timer.Stop();
            timer.Tick -= OnAutoRefreshTick;
            _autoRefresh = null;
        }

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

    private void Render(DbHealthDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        _autoRefreshLabel.Value = display.AutoRefreshLabel;
        _refreshIcon.Opacity = _viewModel.IsFetching ? 1.0 : 0.5;
        AutomationProperties.SetName(this, display.AutomationName);

        // Top error banner (web queryError AlertBanner).
        _errorBanner.Title = display.ErrorBannerTitle;
        _errorBanner.Message = display.ErrorBannerMessage;
        _errorBanner.IsOpen = display.ShowErrorBanner;
        _errorBanner.Visibility = Show(display.ShowErrorBanner);

        // Summary stat cards.
        ApplyStatCard(_totalSizeCard, display.StatCards[0]);
        ApplyStatCard(_tablesCard, display.StatCards[1]);
        ApplyStatCard(_largeTablesCard, display.StatCards[2]);
        ApplyStatCard(_migrationCard, display.StatCards[3]);

        // Table-size bar chart.
        RenderChart(display);

        // Tables panel.
        _tablesTitle.Value = display.TablesTitle;
        _sortSizeButton.Text = display.SortSizeLabel;
        _sortRowsButton.Text = display.SortRowsLabel;
        _sortNameButton.Text = display.SortNameLabel;
        ApplySortVariant(_sortSizeButton, display.ActiveSort == DbHealthSortKey.Size);
        ApplySortVariant(_sortRowsButton, display.ActiveSort == DbHealthSortKey.Rows);
        ApplySortVariant(_sortNameButton, display.ActiveSort == DbHealthSortKey.Name);
        _tableHost.Content = BuildTableContent(display);

        // Migration status panel.
        _migrationTitle.Value = display.MigrationTitle;
        _migrationHost.Content = BuildMigrationContent(display);

        // Connection pool panel.
        _poolTitle.Value = display.PoolTitle;
        _poolHost.Content = BuildPoolContent(display);
    }

    private static void ApplyStatCard(TsStatCard card, DbHealthStatCardDisplay model)
    {
        card.Label = model.Label;
        card.Value = model.Value;
        card.Glyph = model.Glyph;
        AutomationProperties.SetName(card, $"{model.Label} {model.Value}");
    }

    private static void ApplySortVariant(TsButton button, bool active)
    {
        button.Variant = active ? ButtonVariant.Primary : ButtonVariant.Secondary;
        AutomationProperties.SetName(button, button.Text ?? string.Empty);
    }

    private void RenderChart(DbHealthDisplay display)
    {
        _chartContainer.Title = display.ChartTitle;
        _chartContainer.AccessibleSummary = display.ChartAriaLabel;
        _chartContainer.EmptyMessage = display.ChartEmptyMessage;
        _chartContainer.DataViewLabel = display.ChartTableColumnLabel;
        AutomationProperties.SetName(_chartContainer, display.ChartAriaLabel);

        if (display.ChartLoading)
        {
            _chartContainer.State = ChartState.Loading;
            _chartContainer.Body = null;
            return;
        }

        if (!display.ChartHasData)
        {
            _chartContainer.State = ChartState.Empty;
            _chartContainer.Body = null;
            return;
        }

        _chartContainer.State = ChartState.Ready;
        _chartContainer.Body = BuildBarChart(display);
        _chartContainer.DataView.XLabel = display.ChartTableColumnLabel;
        _chartContainer.DataView.Series = [BuildChartSeries(display)];
    }

    // The web horizontal BarChart (layout="vertical"): one row per top-15 table — the category name on the left and a
    // row-count bar (with its value) extending right — rendered with native WinUI primitives, never a web canvas.
    private static StackPanel BuildBarChart(DbHealthDisplay display)
    {
        var column = new StackPanel { Spacing = 8, MinHeight = ChartHeight };

        foreach (var bar in display.Bars)
        {
            var row = new Grid { ColumnSpacing = 8 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(CategoryWidth) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var name = new TextBlock
            {
                Text = bar.Name,
                FontSize = 11,
                Foreground = DisplayTokens.TextSecondary,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextAlignment = TextAlignment.Right,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(name, 0);
            row.Children.Add(name);

            var track = new Grid { VerticalAlignment = VerticalAlignment.Center };
            track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(bar.Ratio, 0.0001), GridUnitType.Star) });
            track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(1 - bar.Ratio, 0.0001), GridUnitType.Star) });

            var fill = new Border
            {
                Background = DisplayTokens.Accent,
                Height = BarHeight,
                MinWidth = 2,
                CornerRadius = new CornerRadius(0, 4, 4, 0), // web Bar radius={[0, 4, 4, 0]}
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            Grid.SetColumn(fill, 0);
            track.Children.Add(fill);

            var value = new TextBlock
            {
                Text = bar.RowsValue,
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(6, 0, 0, 0),
            };
            AutomationProperties.SetAccessibilityView(value, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);
            Grid.SetColumn(value, 1);
            track.Children.Add(value);

            Grid.SetColumn(track, 1);
            row.Children.Add(track);

            AutomationProperties.SetName(row, bar.AutomationName);
            column.Children.Add(row);
        }

        return column;
    }

    private static ChartSeries BuildChartSeries(DbHealthDisplay display)
    {
        var points = new List<ChartPoint>(display.Bars.Count);
        for (var i = 0; i < display.Bars.Count; i++)
        {
            var bar = display.Bars[i];
            points.Add(new ChartPoint(i, bar.RowCount, bar.Name));
        }

        return new ChartSeries(display.RowsSeriesName, points) { Kind = ChartSeriesKind.Bar };
    }

    private FrameworkElement BuildTableContent(DbHealthDisplay display)
    {
        if (display.TablesLoading)
        {
            return BuildSkeletonRows(6, 40);
        }

        _table.EmptyMessage = display.TablesEmptyMessage;
        _colName.Header = display.TableNameHeader;
        _colRows.Header = display.TableRowsHeader;
        _colSize.Header = display.TableSizeHeader;
        _colIndexes.Header = display.TableIndexesHeader;
        _colVacuum.Header = display.TableLastVacuumHeader;
        _table.Rows = BuildTableRows(display.TableRows);
        AutomationProperties.SetName(_table, display.TablesTitle);
        return _table;
    }

    private static List<TsDataRow> BuildTableRows(IReadOnlyList<DbHealthTableRowDisplay> rows)
    {
        var built = new List<TsDataRow>(rows.Count);
        var index = 0;
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["name"] = row.IsLarge ? $"\u26a0 {row.Name}" : row.Name,
                ["rows"] = row.RowsText,
                ["size"] = row.SizeText,
                ["indexes"] = row.IndexesText,
                ["vacuum"] = row.LastVacuumText,
            };
            built.Add(new TsDataRow($"{index}:{row.Name}", values));
            index++;
        }

        return built;
    }

    private static FrameworkElement BuildMigrationContent(DbHealthDisplay display)
    {
        if (display.MigrationLoading)
        {
            return new TsSkeleton { BlockHeight = 128 };
        }

        if (!display.MigrationHasData)
        {
            return new TsEmptyState { Message = display.NoMigrationDataMessage };
        }

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(BuildKeyValueRow(display.CurrentVersionLabel, display.CurrentVersionValue));
        body.Children.Add(BuildStatusRow(display));

        if (display.ShowPending)
        {
            body.Children.Add(BuildKeyValueRow(display.PendingLabel, display.PendingValue));
        }

        if (display.ShowMigrationEntries)
        {
            var divider = new Border
            {
                Height = 1,
                Background = DisplayTokens.Border,
                Margin = new Thickness(0, 4, 0, 4),
            };
            body.Children.Add(divider);
            body.Children.Add(new Caption { Value = display.RecentMigrationsLabel });

            var list = new StackPanel { Spacing = 6 };
            foreach (var entry in display.MigrationRows)
            {
                var entryRow = new Grid();
                entryRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                entryRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var label = new TextBlock
                {
                    Text = entry.Label,
                    FontSize = 12,
                    Foreground = DisplayTokens.TextSecondary,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    VerticalAlignment = VerticalAlignment.Center,
                };
                Grid.SetColumn(label, 0);
                entryRow.Children.Add(label);

                if (entry.ShowAppliedAt)
                {
                    var when = new TextBlock
                    {
                        Text = entry.AppliedAtText,
                        FontSize = 11,
                        Foreground = DisplayTokens.TextMuted,
                        VerticalAlignment = VerticalAlignment.Center,
                    };
                    Grid.SetColumn(when, 1);
                    entryRow.Children.Add(when);
                }

                list.Children.Add(entryRow);
            }

            body.Children.Add(list);
        }
        else
        {
            body.Children.Add(new TsEmptyState { Message = display.NoMigrationsMessage });
        }

        return body;
    }

    private static FrameworkElement BuildPoolContent(DbHealthDisplay display)
    {
        if (display.PoolLoading)
        {
            return new TsSkeleton { BlockHeight = 160 };
        }

        if (!display.PoolHasData)
        {
            return new TsEmptyState { Message = display.NoPoolDataMessage };
        }

        var body = new StackPanel { Spacing = 12 };
        foreach (var row in display.PoolRows)
        {
            body.Children.Add(BuildKeyValueRow(row.Label, row.Value));
        }

        // Pool-usage bar (web "Pool Usage" track + percentage readout).
        var usage = new StackPanel { Spacing = 4, Margin = new Thickness(0, 4, 0, 0) };
        var usageHeader = new Grid();
        usageHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        usageHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var usageLabel = new Caption { Value = display.PoolUsageLabel, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(usageLabel, 0);
        var usageValue = new Caption { Value = display.PoolUsageValue, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(usageValue, 1);
        usageHeader.Children.Add(usageLabel);
        usageHeader.Children.Add(usageValue);
        usage.Children.Add(usageHeader);

        var track = new Grid { Height = 8 };
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(display.PoolUsageRatio, 0.0001), GridUnitType.Star) });
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(1 - display.PoolUsageRatio, 0.0001), GridUnitType.Star) });

        var trackBg = new Border
        {
            Background = DisplayTokens.Surface,
            CornerRadius = new CornerRadius(4),
        };
        Grid.SetColumnSpan(trackBg, 2);
        track.Children.Add(trackBg);

        var fill = new Border
        {
            Background = display.PoolUsageHigh ? Brush("TsColorDangerBrush") : DisplayTokens.Accent,
            CornerRadius = new CornerRadius(4),
        };
        Grid.SetColumn(fill, 0);
        track.Children.Add(fill);

        usage.Children.Add(track);
        AutomationProperties.SetName(usage, $"{display.PoolUsageLabel} {display.PoolUsageValue}");
        body.Children.Add(usage);

        return body;
    }

    private static Grid BuildKeyValueRow(string label, string value)
    {
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var key = new Caption { Value = label, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(key, 0);
        row.Children.Add(key);

        var val = new TextBlock
        {
            Text = value,
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        Grid.SetColumn(val, 1);
        row.Children.Add(val);

        return row;
    }

    private static Grid BuildStatusRow(DbHealthDisplay display)
    {
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var key = new Caption { Value = display.StatusLabel, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(key, 0);
        row.Children.Add(key);

        var status = new TextBlock
        {
            Text = display.StatusValue,
            FontSize = 12,
            Foreground = display.StatusIsDirty ? Brush("TsColorDangerBrush") : Brush("TsColorSuccessBrush"),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        Grid.SetColumn(status, 1);
        row.Children.Add(status);

        return row;
    }

    private static StackPanel BuildSkeletonRows(int count, double height)
    {
        var stack = new StackPanel { Spacing = 8 };
        for (var i = 0; i < count; i++)
        {
            stack.Children.Add(new TsSkeleton { BlockHeight = height });
        }

        return stack;
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

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;
}
