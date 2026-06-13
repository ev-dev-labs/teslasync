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

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 <c>RegenEfficiencyPage</c> — a parity port of the web page
/// <c>web/src/features/driving/pages/RegenEfficiencyPage.tsx</c> (route <c>/regen-efficiency</c>, nav name
/// <c>RegenEfficiency</c>). It binds to a <see cref="RegenEfficiencyPageViewModel"/> and renders every web
/// region with Fluent components and design tokens: the page header (title + subtitle + data-freshness chip),
/// the loading shimmer, the retriable error surface, the page-level empty surface, and — in the success state —
/// the hero regen-ratio radial gauge with its recovery summary ("GlassPanel1"), the six summary stat cards
/// ("GlassPanel2".."GlassPanel7"), the Monthly-Regen-Trend composed chart ("Monthly-Regen-Trend"), the
/// regen-metrics strip with its four metric bars and help affordance ("GlassPanel9") and the recent-regen-drives
/// table ("GlassPanel10"). The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="RegenEfficiencyDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class RegenEfficiencyPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double GaugeDiameter = 180;

    private readonly RegenEfficiencyPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = RegenEfficiencyRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public RegenEfficiencyPage()
        : this(EmptyRegenEfficiencyFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The two-source regen data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public RegenEfficiencyPage(IRegenEfficiencyFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new RegenEfficiencyPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>RegenEfficiencyPage</c>).</summary>
    public static string Slug => RegenEfficiencyRegistration.Slug;

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
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 220 });
        _loadingSkeleton.Children.Add(ColumnsGrid(6, 12, BuildSkeletonBlocks(6, 96)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 260 });
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

    private void Render(RegenEfficiencyDisplay display)
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

    private static StackPanel BuildContent(RegenEfficiencyDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildHeroGauge(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildStatCards(display.StatCards) });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildTrendChart(display.Trend) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildMetricsStrip(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 250, Content = BuildRecentDrives(display) });
        return stack;
    }

    // ── Hero regen-ratio gauge + recovery summary (GlassPanel1) ──────────────────────────────────────────
    private static TsGlassPanel BuildHeroGauge(RegenEfficiencyDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        column.Children.Add(new TsRadialGauge
        {
            Value = display.GaugeValue,
            Max = display.GaugeMax,
            Label = display.GaugeLabel,
            Unit = display.GaugeUnit,
            Role = ChartRole.Regen,
            Decimals = 0,
            Diameter = GaugeDiameter,
        });

        var recovered = new Caption { Value = display.RecoveredInfo, HorizontalAlignment = HorizontalAlignment.Center };
        AutomationProperties.SetName(recovered, display.RecoveredInfo);
        column.Children.Add(recovered);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, $"{display.GaugeLabel} {display.GaugeValue}{display.GaugeUnit}");
        return panel;
    }

    // ── Six summary stat cards (GlassPanel2..GlassPanel7) ─────────────────────────────────────────────────
    private static Grid BuildStatCards(IReadOnlyList<RegenStatCardDisplay> cards)
    {
        var tiles = new List<FrameworkElement>(cards.Count);
        foreach (var card in cards)
        {
            var tile = new TsStatCard { Label = card.Label, Value = card.Value, Glyph = card.Glyph };
            AutomationProperties.SetName(tile, card.AutomationName);
            tiles.Add(tile);
        }

        return ColumnsGrid(6, 12, tiles);
    }

    // ── Monthly-Regen-Trend (composed chart) ─────────────────────────────────────────────────────────────
    private static TsChartContainer BuildTrendChart(RegenTrendChartDisplay trend)
    {
        var chart = new TsComposedChart
        {
            Title = trend.Title,
            Series = BuildSeries(trend.Series),
            ShowLegend = true,
            IncludeZero = true,
            MinHeight = 260,
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

    // ── Regen-metrics strip with help affordance + four metric bars (GlassPanel9) ────────────────────────
    private static TsGlassPanel BuildMetricsStrip(RegenEfficiencyDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(new FontIcon
        {
            Glyph = RegenEfficiencyProjection.ActivityGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleRow.Children.Add(new SectionTitle { Value = display.MetricsTitle, VerticalAlignment = VerticalAlignment.Center });

        var help = new TsHelpTooltip { Hint = display.MetricsHelpHint, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(help, display.MetricsHelpLabel);
        titleRow.Children.Add(help);
        column.Children.Add(titleRow);

        var bars = new List<FrameworkElement>(display.MetricBars.Count);
        foreach (var bar in display.MetricBars)
        {
            bars.Add(BuildMetricBar(bar));
        }

        column.Children.Add(ColumnsGrid(4, 16, bars));
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static StackPanel BuildMetricBar(RegenMetricBarDisplay bar)
    {
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(new TsMetricBar
        {
            Label = bar.Label,
            Value = bar.Value,
            Max = bar.Max,
            AccentBrushKey = bar.AccentBrushKey,
        });
        column.Children.Add(new Caption { Value = bar.ValueText });
        AutomationProperties.SetName(column, $"{bar.Label}: {bar.ValueText}");
        return column;
    }

    // ── Recent-regen-drives table (GlassPanel10) ─────────────────────────────────────────────────────────
    private static TsGlassPanel BuildRecentDrives(RegenEfficiencyDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(new FontIcon
        {
            Glyph = RegenEfficiencyProjection.ZapGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleRow.Children.Add(new SectionTitle { Value = display.RecentTitle, VerticalAlignment = VerticalAlignment.Center });
        column.Children.Add(titleRow);

        if (display.TableRows.Count > 0)
        {
            column.Children.Add(BuildDriveTable(display));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = RegenEfficiencyProjection.ActivityGlyph,
                Message = display.TableEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static TsDataTable BuildDriveTable(RegenEfficiencyDisplay display)
    {
        var table = new TsDataTable { Selectable = false, EmptyMessage = display.TableEmptyMessage };
        table.Columns =
        [
            new TsDataColumn { Key = "date", Header = display.TableColumns[0], IsNumeric = false },
            new TsDataColumn { Key = "distance", Header = display.TableColumns[1], IsNumeric = true },
            new TsDataColumn { Key = "maxRegen", Header = display.TableColumns[2], IsNumeric = true },
            new TsDataColumn { Key = "ratio", Header = display.TableColumns[3], IsNumeric = true },
        ];

        var rows = new List<TsDataRow>(display.TableRows.Count);
        foreach (var row in display.TableRows)
        {
            rows.Add(new TsDataRow(row.Id, new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["date"] = row.Date,
                ["distance"] = row.Distance,
                ["maxRegen"] = row.MaxRegen,
                ["ratio"] = row.Ratio,
            }));
        }

        table.Rows = rows;
        AutomationProperties.SetName(table, display.RecentTitle);
        return table;
    }

    // ── Shared primitives ────────────────────────────────────────────────────────────────────────────────
    private static List<ChartSeries> BuildSeries(IReadOnlyList<RegenSeriesDisplay> series)
    {
        var built = new List<ChartSeries>(series.Count);
        foreach (var s in series)
        {
            built.Add(new ChartSeries(s.Name, s.Points)
            {
                Kind = s.Kind,
                Role = s.Role,
                ColorIndex = s.ColorIndex,
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

    protected override AutomationPeer OnCreateAutomationPeer() => new RegenEfficiencyPageAutomationPeer(this);

    private sealed class RegenEfficiencyPageAutomationPeer(RegenEfficiencyPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
