using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// The native WinUI 3 <c>NavigationRoutePage</c> — a parity port of the web page
/// <c>web/src/features/maps/pages/NavigationRoutePage.tsx</c> (route <c>/navigation</c>, nav name
/// <c>NavigationRoute</c>). It binds to a <see cref="NavigationRoutePageViewModel"/> and renders every web region
/// with Fluent components and design tokens: the page header (title + subtitle + data-freshness chip + refresh),
/// the loading shimmer, the retriable error surface, the page-level empty surface, and — in the success state —
/// the GPS-warning callout, the navigation-status panel (GlassPanel1), the five location-status cards
/// (GlassPanel2), the five route-metric cards (Distance / ETA / Traffic-Delay / Avg-Speed / Energy-at-Arrival),
/// the speed-profile area chart (GlassPanel8), the waypoints table (GlassPanel9), the route-traffic-delay panel
/// (GlassPanel10), the recent-destinations table (GlassPanel11), the home/work presence line chart (GlassPanel12)
/// and the location-history table (GlassPanel13). The view is a thin renderer: all branch selection, SI
/// conversion, formatting and i18n happen in the view-model's <see cref="NavigationDisplay"/> projection. State
/// changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class NavigationRoutePage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 20;
    private const string RefreshGlyph = "\uE72C";

    private readonly NavigationRoutePageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly TsButton _refresh = new() { IconGlyph = RefreshGlyph, Variant = ButtonVariant.Subtle, Size = ControlSize.Small };

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = NavigationRouteRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public NavigationRoutePage()
        : this(EmptyNavigationRouteFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The navigation-route data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public NavigationRoutePage(INavigationRouteFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new NavigationRoutePageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _refresh.Click += OnRefreshClick;
        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>NavigationRoutePage</c>).</summary>
    public static string Slug => NavigationRouteRegistration.Slug;

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
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 140 });
        _loadingSkeleton.Children.Add(ColumnsGrid(5, 16, BuildSkeletonBlocks(5, 96)));
        _loadingSkeleton.Children.Add(ColumnsGrid(5, 16, BuildSkeletonBlocks(5, 96)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 260 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 200 });
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
        _refresh.Click -= OnRefreshClick;
        _errorState.ActionInvoked -= OnRetryInvoked;
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

    private void OnRefreshClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void Render(NavigationDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        _refresh.Text = display.RefreshLabel;
        AutomationProperties.SetName(this, display.AutomationName);
        AutomationProperties.SetName(_refresh, display.RefreshLabel);

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

    private static StackPanel BuildContent(NavigationDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };

        if (display.ShowGpsWarning)
        {
            stack.Children.Add(BuildGpsWarning(display.GpsWarningText));
        }

        stack.Children.Add(new TsFadeIn { Content = BuildStatus(display.Status) });
        stack.Children.Add(new TsFadeIn { DelayMs = 60, Content = BuildLocationCards(display.LocationCards) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildMetrics(display.Metrics) });
        stack.Children.Add(new TsFadeIn { DelayMs = 140, Content = BuildChart(display.SpeedChart, area: true) });
        stack.Children.Add(new TsFadeIn { DelayMs = 160, Content = BuildWaypoints(display.Waypoints) });
        stack.Children.Add(new TsFadeIn { DelayMs = 180, Content = BuildTraffic(display.Traffic) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildTableSection(display.RecentDestinations) });
        stack.Children.Add(new TsFadeIn { DelayMs = 220, Content = BuildChart(display.PresenceChart, area: false) });
        stack.Children.Add(new TsFadeIn { DelayMs = 240, Content = BuildTableSection(display.LocationHistory) });

        return stack;
    }

    // ── GPS warning callout (web nav.noGps AlertBanner) ──────────────────────────────────────────────────
    private static TsAlertBanner BuildGpsWarning(string message)
    {
        var banner = new TsAlertBanner { Variant = CalloutVariant.Info, Message = message, IsOpen = true };
        AutomationProperties.SetName(banner, message);
        return banner;
    }

    // ── Navigation status (GlassPanel1) ──────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildStatus(NavStatusDisplay status)
    {
        var column = new StackPanel { Spacing = 12 };

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = new SectionTitle { Value = status.Title, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(heading, 0);
        headerRow.Children.Add(heading);

        var badge = new TsBadge { Status = status.BadgeStatus, Dot = true, Content = status.BadgeText, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(badge, 1);
        headerRow.Children.Add(badge);
        column.Children.Add(headerRow);

        column.Children.Add(new Caption { Value = $"{status.LastUpdatedLabel}: {status.LastUpdatedValue}" });

        if (status.HasActiveRoute)
        {
            var fields = new List<FrameworkElement>
            {
                FieldStack(status.Destination.Label, status.Destination.Value),
                FieldStack(status.Eta.Label, status.Eta.Value),
                FieldStack(status.Distance.Label, status.Distance.Value),
                TrafficField(status.TrafficLabel, status.Traffic),
            };
            column.Children.Add(ColumnsGrid(4, 16, fields));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = NavigationRouteRegistration.EmptyGlyph,
                Message = status.NoActiveMessage,
            });
        }

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Glow = status.IsActive ? GlassGlow.Cyan : GlassGlow.None,
            Content = column,
        };
        AutomationProperties.SetName(panel, $"{status.Title}. {status.BadgeText}");
        return panel;
    }

    private static StackPanel FieldStack(string label, string value)
    {
        var stack = new StackPanel { Spacing = 2 };
        stack.Children.Add(new Caption { Value = label });
        stack.Children.Add(new Text { Value = value });
        AutomationProperties.SetName(stack, $"{label}: {value}");
        return stack;
    }

    private static StackPanel TrafficField(string label, TrafficDelayDisplay traffic)
    {
        var stack = new StackPanel { Spacing = 2 };
        stack.Children.Add(new Caption { Value = label });
        stack.Children.Add(new TsBadge
        {
            Status = traffic.BadgeStatus,
            Dot = true,
            Content = traffic.BadgeText,
            HorizontalAlignment = HorizontalAlignment.Left,
        });
        AutomationProperties.SetName(stack, $"{label}: {traffic.BadgeText}");
        return stack;
    }

    // ── Location status cards (GlassPanel2) ──────────────────────────────────────────────────────────────
    private static Grid BuildLocationCards(IReadOnlyList<NavLocationCardDisplay> cards)
    {
        var built = new List<FrameworkElement>(cards.Count);
        foreach (var card in cards)
        {
            built.Add(BuildLocationCard(card));
        }

        return ColumnsGrid(5, 16, built);
    }

    private static TsGlassPanel BuildLocationCard(NavLocationCardDisplay card)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };

        var icon = new FontIcon { Glyph = card.Glyph, FontSize = 18, Foreground = DisplayTokens.Accent, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        row.Children.Add(icon);

        var labels = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        labels.Children.Add(new Caption { Value = card.Label });
        labels.Children.Add(new Text { Value = card.Value });
        row.Children.Add(labels);

        var badge = new TsBadge
        {
            Status = card.Active ? StatusKind.Success : StatusKind.Neutral,
            Content = card.Active ? "\u2713" : "\u2014",
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(badge);

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(16),
            Glow = card.Active ? GlassGlow.Green : GlassGlow.None,
            Content = row,
        };
        AutomationProperties.SetName(panel, card.AutomationName);
        return panel;
    }

    // ── Route metrics (Distance / ETA / Traffic-Delay / Avg-Speed / Energy-at-Arrival) ───────────────────
    private static Grid BuildMetrics(IReadOnlyList<NavMetricDisplay> metrics)
    {
        var built = new List<FrameworkElement>(metrics.Count);
        foreach (var metric in metrics)
        {
            var card = new TsMetricCard
            {
                Label = metric.Label,
                Value = metric.Value,
                AccentBrushKey = metric.AccentBrushKey,
            };
            AutomationProperties.SetName(card, metric.AutomationName);
            built.Add(card);
        }

        return ColumnsGrid(5, 16, built);
    }

    // ── Charts (speed-profile area, presence line) ───────────────────────────────────────────────────────
    private static TsChartContainer BuildChart(NavChartDisplay chart, bool area)
    {
        TsCartesianChart body = area ? new TsAreaChart() : new TsLineChart();
        body.Series = BuildSeries(chart.Series);
        body.ShowLegend = true;
        body.MinHeight = 260;
        body.Title = chart.Title;

        var container = new TsChartContainer
        {
            Title = chart.Title,
            AccessibleSummary = chart.AriaLabel,
            State = chart.Visible ? ChartState.Ready : ChartState.Empty,
            Body = body,
            EmptyMessage = chart.EmptyMessage,
        };
        AutomationProperties.SetName(container, chart.AriaLabel);
        return container;
    }

    private static List<ChartSeries> BuildSeries(IReadOnlyList<NavSeriesDisplay> series)
    {
        var built = new List<ChartSeries>(series.Count);
        foreach (var s in series)
        {
            if (s.Points.Count == 0)
            {
                continue;
            }

            built.Add(new ChartSeries(s.Name, s.Points)
            {
                Kind = s.Kind,
                ColorIndex = s.ColorIndex,
            });
        }

        return built;
    }

    // ── Waypoints (GlassPanel9) ──────────────────────────────────────────────────────────────────────────
    private static FrameworkElement BuildWaypoints(NavWaypointsDisplay waypoints)
    {
        if (!waypoints.Active)
        {
            return new TsEmptyState
            {
                IconGlyph = NavigationRouteRegistration.EmptyGlyph,
                Message = waypoints.NoRouteMessage,
            };
        }

        return BuildTablePanel(waypoints.Title, waypoints.Glyph, waypoints.Table);
    }

    // ── Route traffic delay (GlassPanel10) ───────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildTraffic(NavTrafficDisplay traffic)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(SectionHeader(traffic.Glyph, traffic.Title));

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new MetricValue { Value = traffic.Delay.ValueText, VerticalAlignment = VerticalAlignment.Center });
        row.Children.Add(new TsBadge
        {
            Status = traffic.Delay.BadgeStatus,
            Dot = true,
            Content = traffic.Delay.BadgeText,
            VerticalAlignment = VerticalAlignment.Center,
        });
        column.Children.Add(row);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, $"{traffic.Title}: {traffic.Delay.ValueText}");
        return panel;
    }

    // ── Recent destinations / location history tables (GlassPanel11 / GlassPanel13) ──────────────────────
    private static TsGlassPanel BuildTableSection(NavTableSectionDisplay section) =>
        BuildTablePanel(section.Title, section.Glyph, section.Table);

    private static TsGlassPanel BuildTablePanel(string title, string glyph, NavTableDisplay table)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(SectionHeader(glyph, title));
        column.Children.Add(BuildTable(table));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, title);
        return panel;
    }

    private static TsDataTable BuildTable(NavTableDisplay table)
    {
        var columns = new List<TsDataColumn>(table.Columns.Count);
        foreach (var c in table.Columns)
        {
            columns.Add(new TsDataColumn { Key = c.Key, Header = c.Header, IsNumeric = c.Numeric });
        }

        var rows = new List<TsDataRow>(table.Rows.Count);
        foreach (var r in table.Rows)
        {
            var values = new Dictionary<string, object?>(r.Values.Count, StringComparer.Ordinal);
            foreach (var kv in r.Values)
            {
                values[kv.Key] = kv.Value;
            }

            rows.Add(new TsDataRow(r.Key, values));
        }

        return new TsDataTable { Columns = columns, Rows = rows, EmptyMessage = table.EmptyMessage };
    }

    // ── Shared primitives ────────────────────────────────────────────────────────────────────────────────
    private static StackPanel SectionHeader(string glyph, string title)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        var icon = new FontIcon { Glyph = glyph, FontSize = 16, Foreground = DisplayTokens.Accent, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        row.Children.Add(icon);
        row.Children.Add(new SectionTitle { Value = title, VerticalAlignment = VerticalAlignment.Center });
        return row;
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

    protected override AutomationPeer OnCreateAutomationPeer() => new NavigationRoutePageAutomationPeer(this);

    private sealed class NavigationRoutePageAutomationPeer(NavigationRoutePage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
