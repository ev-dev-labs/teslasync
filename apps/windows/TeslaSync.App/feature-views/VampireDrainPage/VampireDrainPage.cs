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
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The native WinUI 3 <c>VampireDrainPage</c> — a parity port of the web page
/// <c>web/src/features/battery/pages/VampireDrainPage.tsx</c> (routes <c>/charging/vampire-drain</c> +
/// <c>/vampire-drain</c>, nav name <c>VampireDrain</c>). It binds to a <see cref="VampireDrainPageViewModel"/>
/// and renders every web region with Fluent components and design tokens: the page header (title + subtitle +
/// data-freshness chip), the loading shimmer, the retriable error surface, the page-level empty surface, and —
/// in the success state — the four summary metric cards (Avg Drain Rate / Total Phantom Loss / Worst Session /
/// Drain Score), the drain-score radial gauge ("GlassPanel5"), the Drain-Rate-Trend line chart
/// ("GlassPanel6"), the Daily-Drain-While-Parked bar chart ("GlassPanel7"), the drain-sessions table
/// ("GlassPanel8") and the Tips-to-Reduce-Vampire-Drain recommendations panel ("GlassPanel9"). The view is a
/// thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="VampireDrainDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class VampireDrainPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double GaugeDiameter = 160;
    private const double TrendChartHeight = 220;
    private const double DailyChartHeight = 260;

    private readonly VampireDrainPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = VampireDrainRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public VampireDrainPage()
        : this(EmptyVampireDrainFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The single-source phantom-drain data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public VampireDrainPage(IVampireDrainFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new VampireDrainPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>VampireDrain</c>).</summary>
    public static string RouteName => VampireDrainRegistration.RouteName;

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

        _freshness.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_freshness, 1);
        grid.Children.Add(_freshness);

        return grid;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(ColumnsGrid(4, 16, BuildSkeletonBlocks(4, 96)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = TrendChartHeight });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = DailyChartHeight });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 200 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 140 });
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

    private void Render(VampireDrainDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
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

    private static StackPanel BuildContent(VampireDrainDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildMetricCards(display.MetricCards) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildGaugeAndTrend(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildDailyChartPanel(display.DailyChart) });
        stack.Children.Add(new TsFadeIn { DelayMs = 300, Content = BuildSessionsPanel(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 400, Content = BuildTipsPanel(display) });
        return stack;
    }

    // ── Four summary metric cards (Avg Drain Rate / Total Phantom Loss / Worst Session / Drain Score) ─────
    private static Grid BuildMetricCards(IReadOnlyList<VampireMetricCardDisplay> cards)
    {
        var tiles = new List<FrameworkElement>(cards.Count);
        foreach (var card in cards)
        {
            var tile = new TsStatCard { Label = card.Label, Value = card.Value, Glyph = card.Glyph };
            AutomationProperties.SetName(tile, card.AutomationName);
            tiles.Add(tile);
        }

        return ColumnsGrid(4, 16, tiles);
    }

    // ── Drain-score radial gauge (GlassPanel5) + Drain-Rate-Trend line chart (GlassPanel6) ────────────────
    private static Grid BuildGaugeAndTrend(VampireDrainDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });

        var gauge = BuildGaugePanel(display);
        Grid.SetColumn(gauge, 0);
        grid.Children.Add(gauge);

        var trend = BuildTrendPanel(display.TrendChart);
        Grid.SetColumn(trend, 1);
        grid.Children.Add(trend);

        return grid;
    }

    private static TsGlassPanel BuildGaugePanel(VampireDrainDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(new TsRadialGauge
        {
            Value = display.GaugeValue,
            Max = display.GaugeMax,
            Label = display.GaugeLabel,
            Unit = display.GaugeUnit,
            Role = ChartRole.Battery,
            Decimals = 0,
            Diameter = GaugeDiameter,
        });

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, $"{display.GaugeLabel} {display.GaugeValue}{display.GaugeUnit}");
        return panel;
    }

    private static TsChartContainer BuildTrendPanel(VampireChartDisplay trend)
    {
        var chart = new TsLineChart
        {
            Title = trend.Title,
            Series = BuildSeries(trend.Series),
            ShowLegend = false,
            IncludeZero = true,
            MinHeight = TrendChartHeight,
        };

        return new TsChartContainer
        {
            Title = trend.Title,
            AccessibleSummary = trend.AriaLabel,
            State = trend.Visible ? ChartState.Ready : ChartState.Empty,
            Body = chart,
            EmptyMessage = trend.AriaLabel,
        };
    }

    // ── Daily-Drain-While-Parked bar chart (GlassPanel7) ──────────────────────────────────────────────────
    private static TsChartContainer BuildDailyChartPanel(VampireChartDisplay daily)
    {
        var chart = new TsBarChart
        {
            Title = daily.Title,
            Series = BuildSeries(daily.Series),
            ShowLegend = true,
            IncludeZero = true,
            MinHeight = DailyChartHeight,
        };

        return new TsChartContainer
        {
            Title = daily.Title,
            AccessibleSummary = daily.AriaLabel,
            State = daily.Visible ? ChartState.Ready : ChartState.Empty,
            Body = chart,
            EmptyMessage = daily.AriaLabel,
        };
    }

    // ── Drain-sessions table (GlassPanel8) ────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildSessionsPanel(VampireDrainDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };

        var titleRow = new Grid();
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = new SectionTitle { Value = display.SessionsTitle, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(heading, 0);
        titleRow.Children.Add(heading);

        var countBadge = new TsBadge
        {
            Status = StatusKind.Neutral,
            Content = new TextBlock { Text = display.SessionsCountLabel },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(countBadge, display.SessionsCountLabel);
        Grid.SetColumn(countBadge, 1);
        titleRow.Children.Add(countBadge);
        column.Children.Add(titleRow);

        if (display.TableRows.Count > 0)
        {
            column.Children.Add(BuildSessionsTable(display));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = VampireDrainProjection.BatteryWarningGlyph,
                Message = display.TableEmptyMessage,
            });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, display.SessionsTitle);
        return panel;
    }

    private static TsDataTable BuildSessionsTable(VampireDrainDisplay display)
    {
        var table = new TsDataTable { Selectable = false, EmptyMessage = display.TableEmptyMessage };
        table.Columns =
        [
            new TsDataColumn { Key = "date", Header = display.TableColumns[0], IsNumeric = false },
            new TsDataColumn { Key = "duration", Header = display.TableColumns[1], IsNumeric = true },
            new TsDataColumn { Key = "start", Header = display.TableColumns[2], IsNumeric = true },
            new TsDataColumn { Key = "end", Header = display.TableColumns[3], IsNumeric = true },
            new TsDataColumn { Key = "loss", Header = display.TableColumns[4], IsNumeric = true },
            new TsDataColumn { Key = "rate", Header = display.TableColumns[5], IsNumeric = true },
            new TsDataColumn { Key = "sentry", Header = display.TableColumns[6], IsNumeric = false },
        ];

        var rows = new List<TsDataRow>(display.TableRows.Count);
        foreach (var row in display.TableRows)
        {
            rows.Add(new TsDataRow(row.Id, new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["date"] = row.Date,
                ["duration"] = row.Duration,
                ["start"] = row.StartPct,
                ["end"] = row.EndPct,
                ["loss"] = row.LossPct,
                ["rate"] = row.Rate,
                ["sentry"] = row.Sentry,
            }));
        }

        table.Rows = rows;
        AutomationProperties.SetName(table, display.SessionsTitle);
        return table;
    }

    // ── Tips-to-Reduce-Vampire-Drain recommendations (GlassPanel9) ────────────────────────────────────────
    private static TsGlassPanel BuildTipsPanel(VampireDrainDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(new FontIcon
        {
            Glyph = VampireDrainProjection.LightbulbGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleRow.Children.Add(new SectionTitle { Value = display.TipsTitle, VerticalAlignment = VerticalAlignment.Center });
        column.Children.Add(titleRow);

        var list = new StackPanel { Spacing = 8 };
        foreach (var tip in display.Tips)
        {
            list.Children.Add(BuildTipRow(tip));
        }

        column.Children.Add(list);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, display.TipsTitle);
        return panel;
    }

    private static Grid BuildTipRow(VampireTipDisplay tip)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var icon = new FontIcon
        {
            Glyph = tip.Glyph,
            FontSize = 14,
            VerticalAlignment = VerticalAlignment.Top,
        };
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        var text = new Text { Value = tip.Text };
        Grid.SetColumn(text, 1);
        grid.Children.Add(text);

        AutomationProperties.SetName(grid, tip.Text);
        return grid;
    }

    // ── Shared primitives ────────────────────────────────────────────────────────────────────────────────
    private static List<ChartSeries> BuildSeries(IReadOnlyList<VampireSeriesDisplay> series)
    {
        var built = new List<ChartSeries>(series.Count);
        foreach (var item in series)
        {
            built.Add(new ChartSeries(item.Name, item.Points)
            {
                Kind = item.Kind,
                Role = item.Role,
                ColorIndex = item.ColorIndex,
            });
        }

        return built;
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

    protected override AutomationPeer OnCreateAutomationPeer() => new VampireDrainPageAutomationPeer(this);

    private sealed class VampireDrainPageAutomationPeer(VampireDrainPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
