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
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The native WinUI 3 <c>LifetimeStatsPage</c> — a parity port of the web page
/// <c>web/src/features/analytics/pages/LifetimeStatsPage.tsx</c> (route <c>/lifetime-stats</c>, nav name
/// <c>LifetimeStats</c>). It binds to a <see cref="LifetimeStatsPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle + data-freshness chip), the loading
/// shimmer, the retriable error surface, the page-level empty surface, and — in the success state — the hero
/// lifetime-distance counter (GlassPanel1), the four key-stat cards (Total Drives / Distance / Energy / Savings),
/// the fun-facts grid (GlassPanel6), the savings-vs-gasoline comparison (GlassPanel7), the environmental-impact
/// readouts (GlassPanel8), the personal-records grid (GlassPanel9), the activity summary (GlassPanel10) and the
/// achievement gallery (GlassPanel11). The view is a thin renderer: all branch selection, formatting and i18n
/// happen in the view-model's <see cref="LifetimeStatsDisplay"/> projection. State changes are marshalled onto the
/// UI thread.
/// </summary>
public sealed partial class LifetimeStatsPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double HeroPadding = 32;

    private const string FunFactsGlyph = "\uE734";      // Segoe Fluent — FavoriteStarOutline
    private const string SavingsGlyph = "\uE1D6";       // Segoe Fluent — Money
    private const string EnvironmentGlyph = "\uE909";   // Segoe Fluent — World
    private const string RecordsGlyph = "\uE735";       // Segoe Fluent — FavoriteStar
    private const string ActivityGlyph = "\uE917";      // Segoe Fluent — Clock
    private const string AchievementsGlyph = "\uE735";  // Segoe Fluent — FavoriteStar (trophy)

    private readonly LifetimeStatsPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = LifetimeStatsRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public LifetimeStatsPage()
        : this(EmptyLifetimeStatsFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The lifetime data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public LifetimeStatsPage(ILifetimeStatsFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new LifetimeStatsPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>LifetimeStats</c>).</summary>
    public static string RouteName => LifetimeStatsRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public LifetimeStatsPageViewModel ViewModel => _viewModel;

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

        Grid.SetColumn(_freshness, 1);
        grid.Children.Add(_freshness);

        return grid;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 150 });
        _loadingSkeleton.Children.Add(ColumnsGrid(4, 12, BuildSkeletonBlocks(4, 96)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 160 });
        _loadingSkeleton.Children.Add(ColumnsGrid(2, SectionSpacing, BuildSkeletonBlocks(2, 200)));
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
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
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

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RefreshAsync();

    private void Render(LifetimeStatsDisplay display)
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

    private StackPanel BuildContent(LifetimeStatsDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildHero(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildStatCards(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildFunFacts(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildSavings(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildEnvironment(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 250, Content = BuildRecords(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 300, Content = BuildActivity(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 350, Content = BuildAchievements(display) });
        return stack;
    }

    // ── Hero lifetime distance (web GlassPanel1) ───────────────────────────────────────────────────────────
    private static TsGlassPanel BuildHero(LifetimeStatsDisplay d)
    {
        var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };

        var headline = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        headline.Children.Add(new FontIcon { Glyph = LifetimeStatsProjection.CarGlyph, FontSize = 28 });
        headline.Children.Add(new TsAnimatedNumber
        {
            Value = d.HeroDistanceValue,
            Precision = 0,
            DurationSeconds = 1.5,
            VerticalAlignment = VerticalAlignment.Center,
        });
        headline.Children.Add(new Subhead { Value = d.HeroDistanceUnit, VerticalAlignment = VerticalAlignment.Bottom });
        AutomationProperties.SetName(headline, $"{d.HeroDistanceUnit}");
        column.Children.Add(headline);

        column.Children.Add(new Text { Value = d.HeroSubtitle, HorizontalAlignment = HorizontalAlignment.Center });

        if (!string.IsNullOrEmpty(d.HeroEarthCompare))
        {
            column.Children.Add(new Caption { Value = d.HeroEarthCompare, HorizontalAlignment = HorizontalAlignment.Center });
        }

        if (!string.IsNullOrEmpty(d.HeroSince))
        {
            column.Children.Add(new Caption { Value = d.HeroSince, HorizontalAlignment = HorizontalAlignment.Center });
        }

        return new TsGlassPanel { Padding = new Thickness(HeroPadding), Content = column };
    }

    // ── Key stat cards (web Total-Drives / Total-Distance / Total-Energy / Total-Savings) ────────────────────
    private static Grid BuildStatCards(LifetimeStatsDisplay d)
    {
        var cards = new List<FrameworkElement>(d.StatCards.Count);
        foreach (var card in d.StatCards)
        {
            var tile = new TsStatCard
            {
                Label = card.Label,
                Value = card.Value,
                Sublabel = card.Sublabel,
                Glyph = card.Glyph,
            };
            AutomationProperties.SetName(tile, $"{card.Label}: {card.Value}");
            cards.Add(tile);
        }

        return ColumnsGrid(4, 12, cards);
    }

    // ── Fun facts (web GlassPanel6) ──────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildFunFacts(LifetimeStatsDisplay d)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(PanelHeader(FunFactsGlyph, d.FunFactsTitle));

        if (d.HasStats && d.FunFacts.Count > 0)
        {
            var cells = new List<FrameworkElement>(d.FunFacts.Count);
            foreach (var fact in d.FunFacts)
            {
                cells.Add(BuildFunFact(fact));
            }

            column.Children.Add(ColumnsGrid(4, 12, cells));
        }
        else
        {
            column.Children.Add(new TsEmptyState { Message = d.FunFactsEmptyMessage });
        }

        return Panel(column);
    }

    private static StackPanel BuildFunFact(LifetimeFunFactDisplay fact)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(DecorativeEmoji(fact.Icon, 24));

        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(new MetricValue { Value = string.IsNullOrEmpty(fact.Unit) ? fact.Value : $"{fact.Value} {fact.Unit}" });
        text.Children.Add(new Caption { Value = fact.Label });
        row.Children.Add(text);

        AutomationProperties.SetName(row, $"{fact.Value} {fact.Unit} {fact.Label}".Trim());
        return row;
    }

    // ── Savings comparison (web GlassPanel7) ─────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildSavings(LifetimeStatsDisplay d)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(PanelHeader(SavingsGlyph, d.SavingsTitle));

        if (d.Savings.HasData)
        {
            var bars = new StackPanel { Spacing = 12 };
            bars.Children.Add(new TsMetricBar
            {
                Label = d.Savings.ElectricLabel,
                Value = d.Savings.ElectricValue,
                Max = d.Savings.MaxCost,
                ValueText = d.Savings.ElectricValueText,
                AccentBrushKey = "TsColorSuccessBrush",
            });
            bars.Children.Add(new TsMetricBar
            {
                Label = d.Savings.GasLabel,
                Value = d.Savings.GasValue,
                Max = d.Savings.MaxCost,
                ValueText = d.Savings.GasValueText,
                AccentBrushKey = "TsColorDangerBrush",
            });
            column.Children.Add(bars);

            var footer = new Grid();
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var saved = new Subhead { Value = $"{d.Savings.YouSavedLabel} {d.Savings.SavedValueText}" };
            Grid.SetColumn(saved, 0);
            footer.Children.Add(saved);

            var co2 = new Caption { Value = d.Savings.Co2Text, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(co2, 1);
            footer.Children.Add(co2);

            column.Children.Add(footer);
        }
        else
        {
            column.Children.Add(new TsEmptyState { Message = d.Savings.EmptyMessage });
        }

        return Panel(column);
    }

    // ── Environmental impact (web GlassPanel8) ───────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildEnvironment(LifetimeStatsDisplay d)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(PanelHeader(EnvironmentGlyph, d.EnvironmentTitle));

        if (d.HasStats)
        {
            var ringCell = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
            ringCell.Children.Add(new TsRadialGauge
            {
                Value = d.Environment.RingPercent,
                Max = 100,
                Unit = "%",
                Decimals = 0,
                Diameter = 72,
                Role = ChartRole.Battery,
            });
            var ringText = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
            var co2Value = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            co2Value.Children.Add(new TsAnimatedNumber { Value = d.Environment.Co2Kg, Precision = 0, Suffix = " kg" });
            ringText.Children.Add(co2Value);
            ringText.Children.Add(new Caption { Value = d.Environment.Co2Label });
            ringCell.Children.Add(ringText);
            AutomationProperties.SetName(ringCell, $"{d.Environment.Co2Label}");

            var cells = new List<FrameworkElement>
            {
                ringCell,
                BuildEnvComparison(LifetimeStatsProjection.TreesEmoji, d.Environment.TreesValue, d.Environment.TreesLabel),
                BuildEnvComparison(LifetimeStatsProjection.CoffeeEmoji, d.Environment.CoffeesValue, d.Environment.CoffeesLabel),
            };

            column.Children.Add(ColumnsGrid(3, 16, cells));
        }
        else
        {
            column.Children.Add(new TsEmptyState { Message = d.EnvironmentEmptyMessage });
        }

        return Panel(column);
    }

    private static StackPanel BuildEnvComparison(string emoji, string value, string label)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(DecorativeEmoji(emoji, 30));

        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(new MetricValue { Value = value });
        text.Children.Add(new Caption { Value = label });
        row.Children.Add(text);

        AutomationProperties.SetName(row, $"{value} {label}");
        return row;
    }

    // ── Personal records (web GlassPanel9) ───────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildRecords(LifetimeStatsDisplay d)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(PanelHeader(RecordsGlyph, d.RecordsTitle));

        if (d.HasStats && d.Records.Count > 0)
        {
            var cells = new List<FrameworkElement>(d.Records.Count);
            foreach (var record in d.Records)
            {
                cells.Add(BuildRecord(record));
            }

            column.Children.Add(ColumnsGrid(3, 16, cells));
        }
        else
        {
            column.Children.Add(new TsEmptyState { Message = d.RecordsEmptyMessage });
        }

        return Panel(column);
    }

    private static StackPanel BuildRecord(LifetimeRecordDisplay record)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new FontIcon { Glyph = record.Glyph, FontSize = 20, VerticalAlignment = VerticalAlignment.Center });

        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(new Caption { Value = record.Title });
        text.Children.Add(new MetricValue { Value = record.Value });
        if (!string.IsNullOrEmpty(record.Date))
        {
            text.Children.Add(new Caption { Value = record.Date });
        }

        row.Children.Add(text);
        AutomationProperties.SetName(row, $"{record.Title}: {record.Value}");
        return row;
    }

    // ── Activity summary (web GlassPanel10) ──────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildActivity(LifetimeStatsDisplay d)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(PanelHeader(ActivityGlyph, d.ActivityTitle));

        if (d.HasStats && d.Activity.Count > 0)
        {
            var cells = new List<FrameworkElement>(d.Activity.Count);
            foreach (var stat in d.Activity)
            {
                var cell = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
                cell.Children.Add(new Caption { Value = stat.Label, HorizontalAlignment = HorizontalAlignment.Center });
                cell.Children.Add(new MetricValue { Value = stat.Value, HorizontalAlignment = HorizontalAlignment.Center });
                AutomationProperties.SetName(cell, $"{stat.Label}: {stat.Value}");
                cells.Add(cell);
            }

            column.Children.Add(ColumnsGrid(4, 12, cells));
        }
        else
        {
            column.Children.Add(new TsEmptyState { Message = d.ActivityEmptyMessage });
        }

        return Panel(column);
    }

    // ── Achievement gallery (web GlassPanel11) ───────────────────────────────────────────────────────────────
    private TsGlassPanel BuildAchievements(LifetimeStatsDisplay d)
    {
        var column = new StackPanel { Spacing = 16 };

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var headerTitle = PanelHeader(AchievementsGlyph, d.AchievementsTitle);
        Grid.SetColumn(headerTitle, 0);
        header.Children.Add(headerTitle);
        var summary = new Caption { Value = d.AchievementsSummary, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(summary, 1);
        header.Children.Add(summary);
        column.Children.Add(header);

        if (d.Achievements.Count > 0)
        {
            var cells = new List<FrameworkElement>(d.Achievements.Count);
            foreach (var achievement in d.Achievements)
            {
                var model = AchievementBadgeModel.Ready(
                    new AchievementData(
                        achievement.Id,
                        achievement.Name,
                        achievement.Description,
                        achievement.Icon,
                        achievement.Unlocked,
                        achievement.UnlockedAt,
                        achievement.Progress,
                        achievement.Target,
                        achievement.Current),
                    AchievementBadgeSize.Medium);
                cells.Add(new AchievementBadge(_localizer, model));
            }

            column.Children.Add(ColumnsGrid(6, 12, cells));
        }
        else
        {
            column.Children.Add(new TsEmptyState { Message = d.AchievementsEmptyMessage });
        }

        return Panel(column);
    }

    // ── Shared layout helpers ────────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel Panel(FrameworkElement content) =>
        new() { Padding = new Thickness(PanelPadding), Content = content };

    private static StackPanel PanelHeader(string glyph, string title)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new FontIcon { Glyph = glyph, FontSize = 18, VerticalAlignment = VerticalAlignment.Center });
        row.Children.Add(new PanelTitle { Value = title, VerticalAlignment = VerticalAlignment.Center });
        AutomationProperties.SetName(row, title);
        return row;
    }

    private static TextBlock DecorativeEmoji(string emoji, double fontSize)
    {
        var text = new TextBlock
        {
            Text = emoji,
            FontSize = fontSize,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(text, AccessibilityView.Raw);
        return text;
    }

    private static Grid ColumnsGrid(int columns, double gap, List<FrameworkElement> items)
    {
        var grid = new Grid { ColumnSpacing = gap, RowSpacing = gap };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = items.Count == 0 ? 0 : (items.Count + columns - 1) / columns;
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < items.Count; i++)
        {
            var element = items[i];
            Grid.SetColumn(element, i % columns);
            Grid.SetRow(element, i / columns);
            grid.Children.Add(element);
        }

        return grid;
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
