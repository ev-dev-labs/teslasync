using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The native WinUI 3 <c>ClimateControlPage</c> — a parity port of the web page
/// <c>web/src/features/vehicle-systems/pages/ClimateControlPage.tsx</c> (route <c>/climate</c>, nav name
/// <c>ClimateControl</c>). It binds to a <see cref="ClimateControlPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle + data-freshness chip + refresh button);
/// the loading shimmer; the retriable error surface; the page-level empty surface; and — in the success state — the
/// HVAC status banner, the three temperature gauges, the HVAC status-card grid, the protection &amp; safety row, the
/// thermal-comfort tiles, the climate-efficiency cards, the seat-heater grid, the temperature-history line chart, the
/// AC-state / fan-speed area chart and the climate-history table. The view is a thin renderer: all branch selection,
/// formatting and i18n happen in the view-model's <see cref="ClimateControlDisplay"/> projection. State changes are
/// marshalled onto the UI thread.
/// </summary>
public sealed partial class ClimateControlPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double ColumnGap = 16;
    private const double ChartHeight = 320;
    private const double GaugeDiameter = 120;

    private const string RefreshGlyph = "\uE72C";
    private const string PowerGlyph = "\uE7E8";
    private const string ThermometerGlyph = "\uE9CA";

    private readonly ClimateControlPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly TsButton _refresh = new() { Variant = ButtonVariant.Subtle, IconGlyph = RefreshGlyph };

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = ClimateControlRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public ClimateControlPage()
        : this(EmptyClimateFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The composed climate data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public ClimateControlPage(IClimateFeed feed, ILocalizer localizer)
        : this(feed, localizer, UnitPref.Metric)
    {
    }

    /// <summary>Creates the page over an explicit feed, localizer and unit preference.</summary>
    /// <param name="feed">The composed climate data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit-display preference (temperature unit + locale).</param>
    public ClimateControlPage(IClimateFeed feed, ILocalizer localizer, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(units);

        _viewModel = new ClimateControlPageViewModel(feed, localizer, units);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _refresh.Click += OnRefreshClicked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>ClimateControlPage</c>).</summary>
    public static string Slug => ClimateControlRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(PanelPadding) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_emptyState);
        stack.Children.Add(_contentHost);

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

        var titles = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        Grid.SetColumn(titles, 0);
        grid.Children.Add(titles);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);
        Grid.SetColumn(actions, 1);
        grid.Children.Add(actions);

        return grid;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 72 });
        _loadingSkeleton.Children.Add(ColumnsGrid(3, ColumnGap, BuildSkeletonBlocks(3, 180)));
        _loadingSkeleton.Children.Add(ColumnsGrid(3, ColumnGap, BuildSkeletonBlocks(6, 96)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = ChartHeight });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = ChartHeight });
    }

    private static List<FrameworkElement> BuildSkeletonBlocks(int count, double height)
    {
        var blocks = new List<FrameworkElement>(count);
        for (int i = 0; i < count; i++)
        {
            blocks.Add(new TsSkeleton { BlockHeight = height });
        }

        return blocks;
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
        _errorState.ActionInvoked -= OnRetryInvoked;
        _refresh.Click -= OnRefreshClicked;
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

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnRefreshClicked(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void Render(ClimateControlDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        _refresh.Text = display.RefreshLabel;
        AutomationProperties.SetName(_refresh, display.RefreshLabel);
        AutomationProperties.SetName(this, display.AutomationName);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Message = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Message = display.EmptyMessage;

        _contentHost.Visibility = Show(display.ShowContent);
        _contentHost.Content = display.ShowContent ? BuildContent(display) : null;
    }

    private static StackPanel BuildContent(ClimateControlDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildBanner(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildGauges(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildStatusCards(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 130, Content = BuildProtectionCards(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildComfort(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 170, Content = BuildEfficiency(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildSeats(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 230, Content = BuildTempChart(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 260, Content = BuildAcFanChart(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 300, Content = BuildHistoryTable(display) });
        return stack;
    }

    // ── HVAC status banner (GlassPanel1) ─────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildBanner(ClimateControlDisplay display)
    {
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(new FontIcon { Glyph = PowerGlyph, FontSize = 22, Foreground = display.HvacActive ? DisplayTokens.Accent : DisplayTokens.TextMuted });
        left.Children.Add(new Text { Value = display.HvacSystemLabel, VerticalAlignment = VerticalAlignment.Center });
        left.Children.Add(Chip(display.HvacStatusChip));
        left.Children.Add(Chip(display.ComfortChip));
        Grid.SetColumn(left, 0);
        row.Children.Add(left);

        var rightChips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        foreach (var chip in display.BannerChips)
        {
            rightChips.Children.Add(Chip(chip));
        }

        Grid.SetColumn(rightChips, 1);
        row.Children.Add(rightChips);

        var panel = new TsGlassPanel
        {
            Glow = display.HvacActive ? GlassGlow.Cyan : GlassGlow.None,
            Padding = new Thickness(PanelPadding),
            Content = row,
        };
        AutomationProperties.SetName(panel, $"{display.HvacSystemLabel}. {display.HvacStatusChip.Text}");
        return panel;
    }

    // ── Temperature gauges (GlassPanel2/3/4) ─────────────────────────────────────────────────────────────
    private static Grid BuildGauges(ClimateControlDisplay display)
    {
        var tiles = new List<FrameworkElement>(display.Gauges.Count);
        foreach (var gauge in display.Gauges)
        {
            tiles.Add(BuildGaugePanel(gauge));
        }

        return ColumnsGrid(3, ColumnGap, tiles);
    }

    private static TsGlassPanel BuildGaugePanel(ClimateGaugeDisplay gauge)
    {
        var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
        if (gauge.HasValue)
        {
            column.Children.Add(new TsRadialGauge
            {
                Value = gauge.Value,
                Max = gauge.Max,
                Label = gauge.Label,
                Unit = gauge.Unit,
                Decimals = 1,
                Diameter = GaugeDiameter,
            });
            column.Children.Add(new MetricValue { Value = gauge.ValueText, HorizontalAlignment = HorizontalAlignment.Center });
        }
        else
        {
            column.Children.Add(new TsEmptyState { IconGlyph = ThermometerGlyph, Message = gauge.Label });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, $"{gauge.Label}. {gauge.ValueText}");
        return panel;
    }

    // ── HVAC status-card grid (GlassPanel5 — HVAC-Power … Rear-Display-HVAC) ──────────────────────────────
    private static Grid BuildStatusCards(ClimateControlDisplay display) =>
        ColumnsGrid(3, ColumnGap, MetricCards(display.StatusCards));

    // ── Protection & safety row (GlassPanel6 — Overheat-Protection … Passenger-Setting) ──────────────────
    private static Grid BuildProtectionCards(ClimateControlDisplay display) =>
        ColumnsGrid(4, ColumnGap, MetricCards(display.ProtectionCards));

    private static List<FrameworkElement> MetricCards(IReadOnlyList<ClimateCard> cards)
    {
        var tiles = new List<FrameworkElement>(cards.Count);
        foreach (var card in cards)
        {
            var tile = new TsMetricCard
            {
                Label = card.Label,
                Value = card.Value,
                AccentBrushKey = card.AccentBrushKey,
                DeltaText = card.Subtitle ?? string.Empty,
            };
            AutomationProperties.SetName(tile, $"{card.Label}: {card.Value}");
            tiles.Add(tile);
        }

        return tiles;
    }

    // ── Thermal comfort (GlassPanel24..26) ───────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildComfort(ClimateControlDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new SectionTitle { Value = display.ThermalComfortTitle });

        var tiles = new List<FrameworkElement>(display.ComfortTiles.Count);
        foreach (var tile in display.ComfortTiles)
        {
            tiles.Add(BuildComfortTile(tile));
        }

        column.Children.Add(ColumnsGrid(3, ColumnGap, tiles));
        return Panel(column);
    }

    private static TsGlassPanel BuildComfortTile(ClimateComfortTile tile)
    {
        var brush = StatusBrush(tile.Variant);
        var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(new Caption { Value = tile.Label, HorizontalAlignment = HorizontalAlignment.Center });

        var ring = new Border
        {
            Width = 80,
            Height = 80,
            CornerRadius = new CornerRadius(40),
            BorderThickness = new Thickness(2),
            BorderBrush = brush,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        if (string.IsNullOrEmpty(tile.Value))
        {
            ring.Child = new FontIcon { Glyph = tile.Glyph, FontSize = 28, Foreground = brush, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        }
        else
        {
            ring.Child = new MetricValue { Value = tile.Value, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        }

        column.Children.Add(ring);
        column.Children.Add(new TsBadge { Status = tile.Variant, Content = tile.Caption });

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, $"{tile.Label}: {(string.IsNullOrEmpty(tile.Value) ? tile.Caption : tile.Value)}");
        return panel;
    }

    // ── Climate efficiency (GlassPanel27 — Avg-Fan-Speed … Comfort-Score) ────────────────────────────────
    private static TsGlassPanel BuildEfficiency(ClimateControlDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new SectionTitle { Value = display.EfficiencyTitle });
        column.Children.Add(ColumnsGrid(4, ColumnGap, MetricCards(display.EfficiencyCards)));
        return Panel(column);
    }

    // ── Seat heaters (GlassPanel28) ──────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildSeats(ClimateControlDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new SectionTitle { Value = display.SeatHeadersTitle });

        var front = new List<FrameworkElement>(display.FrontSeats.Count);
        foreach (var seat in display.FrontSeats)
        {
            front.Add(BuildSeatTile(seat));
        }

        column.Children.Add(ColumnsGrid(2, 12, front));

        var autoRow = new Grid { ColumnSpacing = 12 };
        autoRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        autoRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var autoLeft = AutoSeatRow(display.AutoSeatLeftLabel, display.AutoSeatLeftChip);
        var autoRight = AutoSeatRow(display.AutoSeatRightLabel, display.AutoSeatRightChip);
        Grid.SetColumn(autoLeft, 0);
        Grid.SetColumn(autoRight, 1);
        autoRow.Children.Add(autoLeft);
        autoRow.Children.Add(autoRight);
        column.Children.Add(autoRow);

        var rear = new List<FrameworkElement>(display.RearSeats.Count);
        foreach (var seat in display.RearSeats)
        {
            rear.Add(BuildSeatTile(seat));
        }

        column.Children.Add(ColumnsGrid(3, 12, rear));

        var coolingHeader = new Grid();
        coolingHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        coolingHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var coolingTitle = new Subhead { Value = display.SeatCoolingTitle, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(coolingTitle, 0);
        coolingHeader.Children.Add(coolingTitle);
        var vent = Chip(display.SeatVentChip);
        Grid.SetColumn(vent, 1);
        coolingHeader.Children.Add(vent);
        column.Children.Add(coolingHeader);

        var cooling = new List<FrameworkElement>(display.CoolingSeats.Count);
        foreach (var seat in display.CoolingSeats)
        {
            cooling.Add(BuildSeatTile(seat));
        }

        column.Children.Add(ColumnsGrid(2, 12, cooling));
        column.Children.Add(BuildSeatLegend(display.SeatLegend));

        return Panel(column);
    }

    private static StackPanel AutoSeatRow(string label, ClimateChip chip)
    {
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var caption = new Caption { Value = label, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(caption, 0);
        row.Children.Add(caption);
        var badge = Chip(chip);
        Grid.SetColumn(badge, 1);
        row.Children.Add(badge);

        var wrapper = new StackPanel { Padding = new Thickness(12, 8, 12, 8) };
        wrapper.Children.Add(row);
        return wrapper;
    }

    private static TsGlassPanel BuildSeatTile(ClimateSeatTile seat)
    {
        var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center, Padding = new Thickness(8) };
        column.Children.Add(new FontIcon { Glyph = seat.Glyph, FontSize = 22, Foreground = StatusBrush(seat.Variant), HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new Caption { Value = seat.Label, HorizontalAlignment = HorizontalAlignment.Center });
        if (seat.HasBadge)
        {
            column.Children.Add(new TsBadge { Status = seat.Variant, Content = seat.BadgeText });
        }
        else
        {
            column.Children.Add(new Caption { Value = seat.BadgeText, HorizontalAlignment = HorizontalAlignment.Center });
        }

        var panel = new TsGlassPanel { Content = column };
        AutomationProperties.SetName(panel, $"{seat.Label}: {seat.BadgeText}");
        return panel;
    }

    private static StackPanel BuildSeatLegend(IReadOnlyList<ClimateLegendItem> items)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16, HorizontalAlignment = HorizontalAlignment.Center };
        foreach (var item in items)
        {
            var cell = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
            cell.Children.Add(new FontIcon { Glyph = item.Glyph, FontSize = 14, Foreground = DisplayTokens.TextMuted });
            cell.Children.Add(new Caption { Value = item.Text, VerticalAlignment = VerticalAlignment.Center });
            row.Children.Add(cell);
        }

        return row;
    }

    // ── Temperature history line chart (GlassPanel33) ────────────────────────────────────────────────────
    private static TsGlassPanel BuildTempChart(ClimateControlDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new SectionTitle { Value = display.TempHistoryTitle });

        if (display.HasTempHistory)
        {
            column.Children.Add(new TsLineChart
            {
                Title = display.TempHistoryTitle,
                Series = display.TempHistorySeries,
                ShowLegend = true,
                IncludeZero = false,
                MinHeight = ChartHeight,
            });
        }
        else
        {
            column.Children.Add(new TsEmptyState { IconGlyph = ThermometerGlyph, Message = display.TempHistoryEmptyMessage });
        }

        return Panel(column);
    }

    // ── AC state & fan speed area chart (GlassPanel34) ───────────────────────────────────────────────────
    private static TsGlassPanel BuildAcFanChart(ClimateControlDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new SectionTitle { Value = display.AcFanTitle });

        if (display.HasAcFanHistory)
        {
            column.Children.Add(new TsComposedChart
            {
                Title = display.AcFanTitle,
                Series = display.AcFanSeries,
                ShowLegend = true,
                IncludeZero = true,
                MinHeight = ChartHeight,
            });
            column.Children.Add(new Caption { Value = display.AcFanAxisCaption });
        }
        else
        {
            column.Children.Add(new TsEmptyState { IconGlyph = ThermometerGlyph, Message = display.AcFanEmptyMessage });
        }

        return Panel(column);
    }

    // ── Climate history table (GlassPanel35) ─────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildHistoryTable(ClimateControlDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new SectionTitle { Value = display.HistoryTitle });

        if (display.HistoryRows.Count == 0)
        {
            column.Children.Add(new TsEmptyState { IconGlyph = ThermometerGlyph, Message = display.HistoryEmptyMessage });
            return Panel(column);
        }

        string[] keys = ["time", "inside", "outside", "setTemp", "fan", "hvac", "keeper"];
        var table = new TsDataTable { Selectable = false, EmptyMessage = display.HistoryEmptyMessage };
        var columns = new List<TsDataColumn>(keys.Length);
        for (int i = 0; i < keys.Length; i++)
        {
            columns.Add(new TsDataColumn { Key = keys[i], Header = display.HistoryColumns[i] });
        }

        table.Columns = columns;

        var rows = new List<TsDataRow>(display.HistoryRows.Count);
        foreach (var row in display.HistoryRows)
        {
            rows.Add(new TsDataRow(row.Id, new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["time"] = row.Time,
                ["inside"] = row.Inside,
                ["outside"] = row.Outside,
                ["setTemp"] = row.SetTemp,
                ["fan"] = row.Fan,
                ["hvac"] = row.Hvac,
                ["keeper"] = row.Keeper,
            }));
        }

        table.Rows = rows;
        AutomationProperties.SetName(table, display.HistoryTitle);
        column.Children.Add(table);
        return Panel(column);
    }

    // ── Shared primitives ────────────────────────────────────────────────────────────────────────────────
    private static TsBadge Chip(ClimateChip chip)
    {
        var badge = new TsBadge { Status = chip.Variant, Dot = chip.Dot, Content = chip.Text };
        AutomationProperties.SetName(badge, chip.Text);
        return badge;
    }

    private static TsGlassPanel Panel(UIElement content) =>
        new() { Padding = new Thickness(PanelPadding), Content = content };

    private static Brush StatusBrush(StatusKind kind)
    {
        var key = StatusResources.AccentBrushKey(kind);
        return Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush
            ? brush
            : DisplayTokens.TextMuted;
    }

    private static Grid ColumnsGrid(int columns, double spacing, List<FrameworkElement> children)
    {
        int cols = Math.Max(1, columns);
        int rows = (int)Math.Ceiling(children.Count / (double)cols);

        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < Math.Max(1, rows); r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < children.Count; i++)
        {
            var child = children[i];
            Grid.SetColumn(child, i % cols);
            Grid.SetRow(child, i / cols);
            grid.Children.Add(child);
        }

        return grid;
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ClimateControlPageAutomationPeer(this);

    private sealed class ClimateControlPageAutomationPeer(ClimateControlPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
