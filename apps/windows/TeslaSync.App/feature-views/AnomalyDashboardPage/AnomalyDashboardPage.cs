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

namespace TeslaSync.App.FeatureViews.Diagnostics;

/// <summary>
/// The native WinUI 3 <c>AnomalyDashboardPage</c> — a parity port of the web page
/// <c>web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx</c> (route <c>/analytics/anomalies</c>, nav name
/// <c>AnomalyDashboard</c>). It binds to an <see cref="AnomalyDashboardPageViewModel"/> and renders every web
/// region with Fluent components and design tokens: the page header (title + subtitle + data-freshness chip), the
/// loading shimmer, the retriable error surface, the page-level empty surface, and — in the success state — the
/// four summary stat tiles ("Signals-Monitored" / "Anomalies-7d" / "Anomalies-24h" / "Health-Categories"), the
/// system-health card grid ("GlassPanel5"), the anomaly timeline ("GlassPanel6") and the most-frequent-anomalies
/// bar chart ("GlassPanel7" / <c>BarChart</c>). The view is a thin renderer: all branch selection, formatting and
/// i18n happen in the view-model's <see cref="AnomalyDashboardDisplay"/> projection. State changes are marshalled
/// onto the UI thread.
/// </summary>
public sealed partial class AnomalyDashboardPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const string AlertGlyph = "\uE7BA";     // AlertTriangle (timeline header)
    private const string ChevronGlyph = "\uE76C";   // ChevronRight (timeline row trailing)

    private readonly AnomalyDashboardPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = AnomalyDashboardRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public AnomalyDashboardPage()
        : this(EmptyAnomaliesFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The anomaly data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public AnomalyDashboardPage(IAnomaliesFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new AnomalyDashboardPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>AnomalyDashboardPage</c>).</summary>
    public static string Slug => AnomalyDashboardRegistration.Slug;

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
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 160 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 280 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 220 });
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

    private void Render(AnomalyDashboardDisplay display)
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

    private static StackPanel BuildContent(AnomalyDashboardDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildSummary(display.SummaryStats) });
        stack.Children.Add(new TsFadeIn { DelayMs = 80, Content = BuildHealthPanel(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 160, Content = BuildTimelinePanel(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 240, Content = BuildFrequencyPanel(display) });
        return stack;
    }

    // ── Summary stat tiles (Signals-Monitored / Anomalies-7d / Anomalies-24h / Health-Categories) ───────────
    private static Grid BuildSummary(IReadOnlyList<AnomalyStatDisplay> stats)
    {
        var tiles = new List<FrameworkElement>(stats.Count);
        foreach (var stat in stats)
        {
            var card = new TsStatCard { Label = stat.Label, Value = stat.ValueText, Glyph = stat.Glyph };
            AutomationProperties.SetName(card, stat.AutomationName);
            tiles.Add(card);
        }

        return ColumnsGrid(4, 16, tiles);
    }

    // ── System Health card grid (GlassPanel5) ───────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildHealthPanel(AnomalyDashboardDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new PanelTitle { Value = display.HealthTitle });

        if (display.HealthCards.Count > 0)
        {
            var cards = new List<FrameworkElement>(display.HealthCards.Count);
            foreach (var card in display.HealthCards)
            {
                cards.Add(BuildHealthCard(card));
            }

            column.Children.Add(ColumnsGrid(5, 12, cards));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = AnomalyDashboardRegistration.EmptyGlyph,
                Message = display.HealthEmptyMessage,
            });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, display.HealthTitle);
        return panel;
    }

    private static Border BuildHealthCard(AnomalyHealthCardDisplay card)
    {
        var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };

        var brush = DisplayTokens.Brush(StatusResources.AccentBrushKey(card.StatusKind));
        column.Children.Add(new FontIcon
        {
            Glyph = card.Glyph,
            FontSize = 22,
            Foreground = brush,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(new Text { Value = Capitalize(card.Category), HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TsBadge
        {
            Status = card.StatusKind,
            Content = card.Status,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var border = new Border
        {
            Padding = new Thickness(16),
            CornerRadius = new CornerRadius(12),
            BorderThickness = new Thickness(1),
            BorderBrush = brush,
            Child = column,
        };
        AutomationProperties.SetName(border, card.AutomationName);
        return border;
    }

    // ── Anomaly Timeline (GlassPanel6) ──────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildTimelinePanel(AnomalyDashboardDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        var alertIcon = new FontIcon
        {
            Glyph = AlertGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Warning)),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(alertIcon, AccessibilityView.Raw);
        titleRow.Children.Add(alertIcon);
        titleRow.Children.Add(new SectionTitle { Value = display.TimelineTitle, VerticalAlignment = VerticalAlignment.Center });
        column.Children.Add(titleRow);

        if (display.TimelineRows.Count > 0)
        {
            var rows = new StackPanel { Spacing = 12 };
            foreach (var row in display.TimelineRows)
            {
                rows.Children.Add(BuildTimelineRow(row));
            }

            column.Children.Add(new ScrollViewer
            {
                Content = rows,
                MaxHeight = 500,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            });
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = AnomalyDashboardRegistration.EmptyGlyph,
                Message = display.TimelineEmptyMessage,
            });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, display.TimelineTitle);
        return panel;
    }

    private static Border BuildTimelineRow(AnomalyTimelineRowDisplay row)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var badge = new TsBadge { Status = row.SeverityStatus, Content = row.Severity, VerticalAlignment = VerticalAlignment.Top };
        Grid.SetColumn(badge, 0);
        grid.Children.Add(badge);

        var body = new StackPanel { Spacing = 4 };

        var identity = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        identity.Children.Add(new Text { Value = row.Signal, VerticalAlignment = VerticalAlignment.Center });
        identity.Children.Add(BuildTypeChip(row.TypeLabel));
        if (row.ShowZScore)
        {
            identity.Children.Add(new Caption { Value = row.ZScoreText, VerticalAlignment = VerticalAlignment.Center });
        }

        body.Children.Add(identity);
        body.Children.Add(new Caption { Value = row.Message });

        var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16 };
        meta.Children.Add(new Caption { Value = row.ValueText });
        meta.Children.Add(new Caption { Value = row.BaselineText });
        if (row.DetectedAt is { } detected)
        {
            meta.Children.Add(new TsDateTime { Value = detected, Variant = DateTimeVariant.Relative });
        }
        else if (!string.IsNullOrWhiteSpace(row.DetectedAtText))
        {
            meta.Children.Add(new Caption { Value = row.DetectedAtText });
        }

        body.Children.Add(meta);
        Grid.SetColumn(body, 1);
        grid.Children.Add(body);

        var chevron = new FontIcon
        {
            Glyph = ChevronGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);
        Grid.SetColumn(chevron, 2);
        grid.Children.Add(chevron);

        var border = new Border
        {
            Padding = new Thickness(16),
            CornerRadius = new CornerRadius(12),
            BorderThickness = new Thickness(1),
            BorderBrush = DisplayTokens.Border,
            Child = grid,
        };
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private static Border BuildTypeChip(string label)
    {
        return new Border
        {
            Padding = new Thickness(6, 2, 6, 2),
            CornerRadius = new CornerRadius(8),
            Background = DisplayTokens.Surface,
            VerticalAlignment = VerticalAlignment.Center,
            Child = new Caption { Value = label },
        };
    }

    // ── Most-Frequent-Anomalies bar chart (GlassPanel7) ─────────────────────────────────────────────────────
    private static TsGlassPanel BuildFrequencyPanel(AnomalyDashboardDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new PanelTitle { Value = display.FrequencyTitle });

        var frequency = display.Frequency;
        if (frequency.HasData)
        {
            var chart = new TsBarChart
            {
                Series = frequency.Series,
                ShowLegend = false,
                IncludeZero = true,
                MinHeight = Math.Max(200, frequency.Rows.Count * 35),
            };
            AutomationProperties.SetName(chart, frequency.AriaLabel);
            column.Children.Add(chart);
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = AnomalyDashboardRegistration.EmptyGlyph,
                Message = frequency.EmptyMessage,
            });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, display.FrequencyTitle);
        return panel;
    }

    // ── Shared primitives ───────────────────────────────────────────────────────────────────────────────────
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

    private static string Capitalize(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return value;
        }

        return char.ToUpperInvariant(value[0]) + value[1..];
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    protected override AutomationPeer OnCreateAutomationPeer() => new AnomalyDashboardPageAutomationPeer(this);

    private sealed class AnomalyDashboardPageAutomationPeer(AnomalyDashboardPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
