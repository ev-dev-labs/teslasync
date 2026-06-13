using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The native WinUI 3 <c>SafetySettingsPage</c> — a parity port of the web page
/// <c>web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx</c> (route <c>/safety-settings</c>, nav name
/// <c>SafetySettings</c>). It binds to a <see cref="SafetySettingsPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle + data-freshness chip), the loading shimmer,
/// the retriable error surface, the page-level empty surface, and — in the success state — the safety-score radial gauge
/// with its enabled/total badge, the four summary metric cards, the Live Safety Signals row, the Driving Statistics
/// cards, the nine ADAS feature cards, the Safety-States-Over-Time step chart and the safety-history table. The view is a
/// thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="SafetySettingsDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class SafetySettingsPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 20;
    private const double CardRadius = 12;
    private const double CardPadding = 16;

    private readonly SafetySettingsPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = SafetySettingsRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public SafetySettingsPage()
        : this(EmptySafetySettingsFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The three-source safety data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SafetySettingsPage(ISafetySettingsFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SafetySettingsPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>SafetySettingsPage</c>).</summary>
    public static string Slug => SafetySettingsRegistration.Slug;

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
        _loadingSkeleton.Children.Add(ColumnsGrid(4, 16, BuildSkeletonBlocks(4, 80)));
        _loadingSkeleton.Children.Add(ColumnsGrid(3, 16, BuildSkeletonBlocks(9, 96)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 300 });
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

    private void Render(SafetySettingsDisplay display)
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
        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;

        _contentHost.Visibility = Show(display.ShowContent);
        _contentHost.Content = display.ShowContent ? BuildContent(display) : null;
    }

    private static StackPanel BuildContent(SafetySettingsDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildScoreRow(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildLiveSignals(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildDrivingStats(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildFeatureCards(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildChart(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 300, Content = BuildHistory(display) });
        return stack;
    }

    // ── Safety-score gauge + four summary metrics ────────────────────────────────────────────────────────
    private static Grid BuildScoreRow(SafetySettingsDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var gauge = BuildGaugePanel(display);
        Grid.SetColumn(gauge, 0);
        grid.Children.Add(gauge);

        var metrics = BuildSummaryMetrics(display.SummaryMetrics);
        Grid.SetColumn(metrics, 1);
        grid.Children.Add(metrics);

        return grid;
    }

    private static TsGlassPanel BuildGaugePanel(SafetySettingsDisplay display)
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
            Decimals = 0,
            ColorIndex = display.GaugeColorIndex,
            Diameter = 140,
        });

        var badge = new TsBadge
        {
            Status = display.EnabledBadgeStatus,
            Content = new TextBlock { Text = display.EnabledBadgeText },
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.EnabledBadgeText);
        column.Children.Add(badge);

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static Grid BuildSummaryMetrics(IReadOnlyList<SafetyMetricDisplay> metrics)
    {
        var cards = new List<FrameworkElement>(metrics.Count);
        foreach (var metric in metrics)
        {
            var card = new TsMetricCard
            {
                Label = metric.Label,
                Value = metric.Value,
                AccentBrushKey = metric.AccentBrushKey,
            };
            AutomationProperties.SetName(card, metric.AutomationName);
            cards.Add(card);
        }

        return ColumnsGrid(4, 16, cards);
    }

    // ── Live Safety Signals (four polarity-tinted tiles) ─────────────────────────────────────────────────
    private static TsGlassPanel BuildLiveSignals(SafetySettingsDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new PanelTitle { Value = display.LiveSignalsTitle });

        var cards = new List<FrameworkElement>(display.SignalCards.Count);
        foreach (var signal in display.SignalCards)
        {
            cards.Add(BuildSignalCard(signal));
        }

        column.Children.Add(ColumnsGrid(4, 16, cards));
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static Border BuildSignalCard(SafetySignalDisplay signal)
    {
        Brush tone = signal.Tone is { } kind ? DisplayTokens.Brush(StatusResources.AccentBrushKey(kind)) : DisplayTokens.TextMuted;

        var column = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon { Glyph = signal.Glyph, FontSize = 22, Foreground = tone, HorizontalAlignment = HorizontalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        column.Children.Add(icon);

        column.Children.Add(new TextBlock
        {
            Text = signal.Value,
            FontWeight = FontWeights.Bold,
            Foreground = tone,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        });

        column.Children.Add(new Caption { Value = signal.Label, HorizontalAlignment = HorizontalAlignment.Center });

        var border = new Border
        {
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(CardRadius),
            Padding = new Thickness(CardPadding),
            Child = column,
        };
        AutomationProperties.SetName(border, signal.AutomationName);
        AutomationProperties.SetAccessibilityView(border, AccessibilityView.Content);
        return border;
    }

    // ── Driving Statistics (two icon + subtitle tiles) ───────────────────────────────────────────────────
    private static TsGlassPanel BuildDrivingStats(SafetySettingsDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new PanelTitle { Value = display.DrivingStatsTitle });

        var cards = new List<FrameworkElement>(display.DrivingStats.Count);
        foreach (var stat in display.DrivingStats)
        {
            var card = new TsStatCard
            {
                Label = stat.Label,
                Value = stat.Value,
                Sublabel = stat.Sublabel,
                Glyph = stat.Glyph,
            };
            AutomationProperties.SetName(card, stat.AutomationName);
            cards.Add(card);
        }

        column.Children.Add(ColumnsGrid(2, 16, cards));
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── ADAS feature cards (nine, three-column grid) ─────────────────────────────────────────────────────
    private static TsGlassPanel BuildFeatureCards(SafetySettingsDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(TitleRow(SafetySettingsProjection.ShieldGlyph, display.AdasTitle));

        var cards = new List<FrameworkElement>(display.FeatureCards.Count);
        foreach (var feature in display.FeatureCards)
        {
            cards.Add(BuildFeatureCard(feature));
        }

        column.Children.Add(ColumnsGrid(3, 12, cards));
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static TsGlassPanel BuildFeatureCard(SafetyFeatureDisplay feature)
    {
        Brush accent = feature.Enabled ? DisplayTokens.Brush("TsColorSuccessBrush") : DisplayTokens.TextMuted;

        var column = new StackPanel { Spacing = 8 };

        var header = new Grid { ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var chip = new Border
        {
            Background = Tint(accent, 0.10),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(8),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon { Glyph = SafetySettingsProjection.ShieldGlyph, FontSize = 16, Foreground = accent },
        };
        AutomationProperties.SetAccessibilityView(chip, AccessibilityView.Raw);
        Grid.SetColumn(chip, 0);
        header.Children.Add(chip);

        var textColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        textColumn.Children.Add(new TextBlock
        {
            Text = feature.Label,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        textColumn.Children.Add(new Caption { Value = feature.Description });
        Grid.SetColumn(textColumn, 1);
        header.Children.Add(textColumn);

        var dot = new Ellipse
        {
            Width = 8,
            Height = 8,
            Fill = feature.Enabled ? DisplayTokens.Brush("TsColorSuccessBrush") : DisplayTokens.Border,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);
        Grid.SetColumn(dot, 2);
        header.Children.Add(dot);
        column.Children.Add(header);

        column.Children.Add(new TextBlock
        {
            Text = feature.ValueText,
            FontWeight = FontWeights.SemiBold,
            Foreground = feature.Enabled ? DisplayTokens.Brush("TsColorSuccessBrush") : DisplayTokens.TextMuted,
        });

        var panel = new TsGlassPanel { Padding = new Thickness(CardPadding), Content = column };
        AutomationProperties.SetName(panel, feature.AutomationName);
        return panel;
    }

    // ── Safety States Over Time (step line chart) ────────────────────────────────────────────────────────
    private static TsGlassPanel BuildChart(SafetySettingsDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new PanelTitle { Value = display.ChartTitle });

        if (display.ChartState == ChartState.Ready)
        {
            var chart = new TsLineChart
            {
                Title = display.ChartTitle,
                Series = BuildSeries(display.ChartSeries),
                ShowLegend = true,
                IncludeZero = true,
                MinHeight = 300,
            };
            AutomationProperties.SetName(chart, display.ChartAccessibleSummary);

            column.Children.Add(new TsChartContainer
            {
                Title = display.ChartTitle,
                AccessibleSummary = display.ChartAccessibleSummary,
                State = ChartState.Ready,
                Body = chart,
                EmptyMessage = display.ChartEmptyMessage,
            });
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = SafetySettingsProjection.ShieldGlyph,
                Message = display.ChartEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Safety Settings History (data table) ─────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildHistory(SafetySettingsDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new PanelTitle { Value = display.HistoryTitle });

        if (display.HistoryRows.Count > 0)
        {
            var table = new TsDataTable { Selectable = false, EmptyMessage = display.HistoryEmptyMessage };

            var columns = new List<TsDataColumn>(display.HistoryColumns.Count);
            foreach (var col in display.HistoryColumns)
            {
                columns.Add(new TsDataColumn { Key = col.Key, Header = col.Header, IsNumeric = col.IsNumeric });
            }

            table.Columns = columns;

            var rows = new List<TsDataRow>(display.HistoryRows.Count);
            foreach (var row in display.HistoryRows)
            {
                rows.Add(new TsDataRow(row.Id, new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["time"] = row.Time,
                    ["aeb"] = row.Aeb,
                    ["bsc"] = row.Bsc,
                    ["bscw"] = row.Bscw,
                    ["fcw"] = row.Fcw,
                    ["lda"] = row.Lda,
                    ["elda"] = row.Elda,
                    ["cfd"] = row.Cfd,
                    ["slw"] = row.Slw,
                    ["pin"] = row.Pin,
                }));
            }

            table.Rows = rows;
            AutomationProperties.SetName(table, display.HistoryTitle);
            column.Children.Add(table);
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = SafetySettingsProjection.ShieldGlyph,
                Message = display.HistoryEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Shared primitives ────────────────────────────────────────────────────────────────────────────────
    private static List<ChartSeries> BuildSeries(IReadOnlyList<SafetyChartSeriesDisplay> series)
    {
        var built = new List<ChartSeries>(series.Count);
        foreach (var s in series)
        {
            built.Add(new ChartSeries(s.Name, s.Points)
            {
                Kind = ChartSeriesKind.Line,
                ColorIndex = s.ColorIndex,
            });
        }

        return built;
    }

    private static StackPanel TitleRow(string glyph, string title)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new FontIcon
        {
            Glyph = glyph,
            FontSize = 16,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new SectionTitle { Value = title });
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

    private static Brush Tint(Brush brush, double opacity) =>
        brush is SolidColorBrush solid ? new SolidColorBrush(solid.Color) { Opacity = opacity } : brush;

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SafetySettingsPageAutomationPeer(this);

    private sealed class SafetySettingsPageAutomationPeer(SafetySettingsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
