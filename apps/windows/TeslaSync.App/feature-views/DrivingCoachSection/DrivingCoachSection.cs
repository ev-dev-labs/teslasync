using Microsoft.UI.Text;
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
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>DrivingCoachSection</c> feature surface — a parity port of
/// web/src/features/driving/components/driving-dynamics/DrivingCoachSection.tsx. It is a presentational
/// section of the Driving-Dynamics experience: assign a <see cref="Model"/> (the web <c>coachData</c> prop plus
/// the parent-supplied lifecycle status) and it renders one of the contract's states —
/// <see cref="DrivingCoachSectionState.Loading"/> (skeleton chrome while the coach query is in flight),
/// <see cref="DrivingCoachSectionState.Empty"/> (a friendly empty state when no drives have been analysed),
/// <see cref="DrivingCoachSectionState.Error"/> (a retriable <see cref="TsQueryError"/>), or the populated
/// composition (<see cref="DrivingCoachSectionState.Ready"/> / <see cref="DrivingCoachSectionState.Stale"/> /
/// <see cref="DrivingCoachSectionState.Offline"/>) the web renders: the score radial gauge with its
/// drives-analyzed caption, the style-breakdown stacked bar + legend, the two efficiency stat-cards, the weekly
/// score-trend line chart, the five driving-pattern indicators, the recommendations list, and the per-drive
/// scores table — each with its own friendly empty surface and a stale / offline freshness chip layered on the
/// cached snapshot. The view never performs HTTP; all branch selection, label resolution and formatting happen
/// in the WinUI-free <see cref="DrivingCoachSectionProjection"/>. Entrances fade through <see cref="TsFadeIn"/>
/// (honouring reduce-motion), every string resolves through the i18n facade, and the surface plus each
/// interactive element carry a Narrator name. A failed snapshot's retry affordance raises
/// <see cref="RetryRequested"/> for the host to act on (the parent owns the query).
/// </summary>
public sealed partial class DrivingCoachSection : ContentControl
{
    private const string ZapGlyph = "\uE945";        // Segoe Fluent — LightningBolt (web lucide Zap)
    private const string ShieldGlyph = "\uEA18";     // Segoe Fluent — Shield (web lucide ShieldCheck)
    private const string LightbulbGlyph = "\uEA80";  // Segoe Fluent — Lightbulb (web lucide Lightbulb)
    private const string CoachGlyph = "\uE9D9";      // Segoe Fluent — Speed (web driving-coach mark)

    private const double ContentSpacing = 16;        // web stacked sections gap
    private const double PanelPadding = 24;          // web p-6
    private const double GaugeDiameter = 160;        // web size={160}
    private const double ChartHeight = 200;          // web height={200}
    private const double StackedBarHeight = 16;      // web h-4
    private const double PatternBarHeight = 6;       // web h-1.5
    private const double LegendDotSize = 8;          // web h-2 w-2
    private const int FadeDelayMs = 420;             // web <FadeIn delay={0.42}>

    private readonly ILocalizer _localizer;
    private readonly DrivingCoachSectionDiagnostics _diagnostics;

    private DrivingCoachSectionModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="DrivingCoachSectionModel.Loading"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DrivingCoachSection(
        ILocalizer localizer,
        DrivingCoachSectionModel? model = null,
        DrivingCoachSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? DrivingCoachSectionModel.Loading;
        _diagnostics = diagnostics ?? new DrivingCoachSectionDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs the query).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>DrivingCoachSection</c>).</summary>
    public static string Slug => DrivingCoachSectionRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public DrivingCoachSectionModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        var display = DrivingCoachSectionProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State switch
        {
            DrivingCoachSectionState.Loading => BuildLoading(display),
            DrivingCoachSectionState.Empty => BuildEmpty(display),
            DrivingCoachSectionState.Error => BuildError(display),
            _ => BuildContent(display),
        };
    }

    // ── Ready / Stale / Offline (web fall-through: every coach panel) ──────────────────────────────────
    private static TsFadeIn BuildContent(DrivingCoachSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildTopRow(display));
        stack.Children.Add(BuildWeeklyTrendPanel(display));
        stack.Children.Add(BuildPatternsPanel(display));
        stack.Children.Add(BuildRecommendationsPanel(display));
        stack.Children.Add(BuildPerDrivePanel(display));
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = stack };
    }

    private static Grid BuildHeader(DrivingCoachSectionDisplay display)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new SectionTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(title, 0);
        grid.Children.Add(title);

        if (display.ShowFreshnessChip)
        {
            var chip = BuildChip(display.FreshnessChipText, display.FreshnessChipStatus);
            Grid.SetColumn(chip, 1);
            grid.Children.Add(chip);
        }

        return grid;
    }

    private static TsBadge BuildChip(string text, StatusKind status)
    {
        var badge = new TsBadge
        {
            Status = status,
            Content = new TextBlock { Text = text, FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12) },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    // web: grid-cols-1 lg:grid-cols-3 — score gauge, style breakdown, efficiency stats.
    private static Grid BuildTopRow(DrivingCoachSectionDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        for (int c = 0; c < 3; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var gauge = BuildScorePanel(display.Score);
        Grid.SetColumn(gauge, 0);
        grid.Children.Add(gauge);

        var style = BuildStylePanel(display);
        Grid.SetColumn(style, 1);
        grid.Children.Add(style);

        var efficiency = BuildEfficiencyPanel(display);
        Grid.SetColumn(efficiency, 2);
        grid.Children.Add(efficiency);

        return grid;
    }

    // web: RadialGauge + "{n} drives analyzed" caption.
    private static TsGlassPanel BuildScorePanel(CoachScoreDisplay score)
    {
        var stack = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // TsRadialGauge tints its arc from a themed chart role (not arbitrary hex like the web gauge); the
        // web green / amber / red score band is conveyed by the per-drive Score / Style badges below.
        var gauge = new TsRadialGauge
        {
            Value = score.Value,
            Max = 100,
            Label = score.Label,
            Decimals = 0,
            Diameter = GaugeDiameter,
            Role = ChartRole.Battery,
        };
        AutomationProperties.SetName(gauge, $"{score.Label}, {score.ValueText}");
        stack.Children.Add(gauge);

        stack.Children.Add(new Caption
        {
            Value = score.DrivesAnalyzedText,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        AutomationProperties.SetName(panel, score.AutomationName);
        return panel;
    }

    // web: title + (stacked bar + legend | EmptyState).
    private static TsGlassPanel BuildStylePanel(DrivingCoachSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(new PanelTitle { Value = display.StyleBreakdownTitle });

        var breakdown = display.StyleBreakdown;
        if (breakdown.HasData)
        {
            stack.Children.Add(BuildStackedBar(breakdown.Segments));
            stack.Children.Add(BuildStyleLegend(breakdown.Legend));
        }
        else
        {
            stack.Children.Add(new TsEmptyState { IconGlyph = CoachGlyph, Message = breakdown.EmptyMessage });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
    }

    private static Border BuildStackedBar(IReadOnlyList<CoachStyleSegmentDisplay> segments)
    {
        var grid = new Grid { Height = StackedBarHeight };
        double consumed = 0;
        for (int i = 0; i < segments.Count; i++)
        {
            var segment = segments[i];
            double fraction = Math.Clamp(segment.Fraction, 0, 1);
            consumed += fraction;
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(fraction, GridUnitType.Star) });
            var fill = new Border { Background = StatusBrush(segment.Status) };
            AutomationProperties.SetAccessibilityView(fill, AccessibilityView.Raw);
            Grid.SetColumn(fill, i);
            grid.Children.Add(fill);
        }

        // web: an unfilled remainder stays empty rather than stretching the segments to full width.
        double remainder = Math.Max(0, 1 - consumed);
        if (remainder > 0)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(remainder, GridUnitType.Star) });
        }

        return new Border
        {
            Height = StackedBarHeight,
            CornerRadius = new CornerRadius(StackedBarHeight / 2),
            Background = DisplayTokens.Border,
            Child = grid,
        };
    }

    private static StackPanel BuildStyleLegend(IReadOnlyList<CoachStyleLegendDisplay> legend)
    {
        var stack = new StackPanel { Spacing = 8 };
        foreach (CoachStyleLegendDisplay item in legend)
        {
            var brush = StatusBrush(item.Status);
            var row = new Grid();
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var labelRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 8,
                VerticalAlignment = VerticalAlignment.Center,
            };
            var dot = new Border
            {
                Width = LegendDotSize,
                Height = LegendDotSize,
                CornerRadius = new CornerRadius(LegendDotSize / 2),
                Background = brush,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);
            labelRow.Children.Add(dot);
            labelRow.Children.Add(new Caption { Value = item.Label, Foreground = DisplayTokens.TextSecondary });
            Grid.SetColumn(labelRow, 0);
            row.Children.Add(labelRow);

            var count = new TextBlock
            {
                Text = item.CountText,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
                FontWeight = FontWeights.Bold,
                Foreground = brush,
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(count, 1);
            row.Children.Add(count);

            AutomationProperties.SetName(row, $"{item.Label}, {item.CountText}");
            stack.Children.Add(row);
        }

        return stack;
    }

    // web: two StatCards (Avg Efficiency / Best Efficiency).
    private static TsGlassPanel BuildEfficiencyPanel(DrivingCoachSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        foreach (CoachEfficiencyStatDisplay stat in display.EfficiencyStats)
        {
            var card = new TsStatCard
            {
                Label = stat.Label,
                Value = stat.Value,
                Glyph = stat.Glyph == CoachStatGlyph.AvgEfficiency ? ZapGlyph : ShieldGlyph,
            };
            AutomationProperties.SetName(card, stat.AutomationName);
            stack.Children.Add(card);
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
    }

    // web: title + (LineChart | EmptyState).
    private static TsGlassPanel BuildWeeklyTrendPanel(DrivingCoachSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(new PanelTitle { Value = display.WeeklyTrendTitle });

        var trend = display.WeeklyTrend;
        if (trend.HasData)
        {
            var points = new List<ChartPoint>(trend.Points.Count);
            for (int i = 0; i < trend.Points.Count; i++)
            {
                CoachWeeklyTrendPointDisplay point = trend.Points[i];
                points.Add(new ChartPoint(i, point.Score, point.Week));
            }

            var series = new ChartSeries(trend.SeriesName, points)
            {
                Kind = ChartSeriesKind.Line,
                Role = ChartRole.Battery,
            };
            var chart = new TsLineChart
            {
                Series = [series],
                ShowLegend = false,
                MinHeight = ChartHeight,
            };
            AutomationProperties.SetName(chart, $"{display.WeeklyTrendTitle}, {trend.SeriesName}");
            stack.Children.Add(chart);
        }
        else
        {
            stack.Children.Add(new TsEmptyState { IconGlyph = CoachGlyph, Message = trend.EmptyMessage });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
    }

    // web: title + five label/percentage/threshold-bar rows.
    private static TsGlassPanel BuildPatternsPanel(DrivingCoachSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(new PanelTitle { Value = display.PatternsTitle });

        var rows = new StackPanel { Spacing = 12 };
        foreach (CoachPatternDisplay pattern in display.Patterns)
        {
            rows.Children.Add(BuildPatternRow(pattern));
        }

        stack.Children.Add(rows);
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
    }

    private static StackPanel BuildPatternRow(CoachPatternDisplay pattern)
    {
        var brush = StatusBrush(pattern.Status);

        var labelRow = new Grid();
        labelRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        labelRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new Caption { Value = pattern.Label, Foreground = DisplayTokens.TextSecondary };
        Grid.SetColumn(label, 0);
        labelRow.Children.Add(label);

        var value = new TextBlock
        {
            Text = pattern.ValueText,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            FontWeight = FontWeights.Bold,
            Foreground = brush,
        };
        Grid.SetColumn(value, 1);
        labelRow.Children.Add(value);

        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(labelRow);
        stack.Children.Add(BuildProgressBar(pattern.Fraction, brush, PatternBarHeight));
        AutomationProperties.SetName(stack, pattern.AutomationName);
        return stack;
    }

    // web: Lightbulb-led title + (recommendation cards | EmptyState).
    private static TsGlassPanel BuildRecommendationsPanel(DrivingCoachSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        header.Children.Add(DecorativeIcon(LightbulbGlyph, 16, StatusBrush(StatusKind.Warning)));
        header.Children.Add(new PanelTitle { Value = display.RecommendationsTitle });
        stack.Children.Add(header);

        if (display.HasRecommendations)
        {
            var list = new StackPanel { Spacing = 12 };
            foreach (CoachRecommendationDisplay rec in display.Recommendations)
            {
                list.Children.Add(BuildRecommendationCard(rec));
            }

            stack.Children.Add(list);
        }
        else
        {
            stack.Children.Add(new TsEmptyState
            {
                IconGlyph = LightbulbGlyph,
                Message = display.RecommendationsEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
    }

    private static Border BuildRecommendationCard(CoachRecommendationDisplay rec)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var badge = BuildChip(rec.ImpactText, rec.ImpactStatus);
        badge.VerticalAlignment = VerticalAlignment.Top;
        Grid.SetColumn(badge, 0);
        grid.Children.Add(badge);

        var tip = new TextBlock
        {
            Text = rec.Tip,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(tip, 1);
        grid.Children.Add(tip);

        var card = new Border
        {
            Padding = new Thickness(12),
            CornerRadius = new CornerRadius(12),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Child = grid,
        };
        AutomationProperties.SetName(card, rec.AutomationName);
        return card;
    }

    // web: title + (DataTable | EmptyState).
    private static TsGlassPanel BuildPerDrivePanel(DrivingCoachSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(new PanelTitle { Value = display.PerDriveTitle });

        var perDrive = display.PerDrive;
        if (perDrive.HasData)
        {
            stack.Children.Add(BuildPerDriveTable(perDrive));
        }
        else
        {
            stack.Children.Add(new TsEmptyState { IconGlyph = CoachGlyph, Message = perDrive.EmptyMessage });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
    }

    private static StackPanel BuildPerDriveTable(CoachPerDriveDisplay perDrive)
    {
        var table = new StackPanel { Spacing = 4 };
        table.Children.Add(BuildPerDriveHeader(perDrive.Headers));

        var body = new StackPanel { Spacing = 4 };
        foreach (CoachDriveRowDisplay row in perDrive.Rows)
        {
            body.Children.Add(BuildPerDriveRow(row));
        }

        table.Children.Add(new ScrollViewer
        {
            Content = body,
            MaxHeight = 360,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollMode = ScrollMode.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
        });

        AutomationProperties.SetAccessibilityView(table, AccessibilityView.Content);
        return table;
    }

    private static Grid BuildPerDriveColumns()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        var widths = new[] { 1.4, 0.8, 1.0, 1.0, 1.0 };
        foreach (double width in widths)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(width, GridUnitType.Star) });
        }

        return grid;
    }

    private static Border BuildPerDriveHeader(IReadOnlyList<string> headers)
    {
        var grid = BuildPerDriveColumns();
        for (int i = 0; i < headers.Count; i++)
        {
            var cell = new Caption
            {
                Value = headers[i],
                HorizontalAlignment = i >= 3 ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            };
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        var border = new Border
        {
            Padding = new Thickness(0, 0, 0, 6),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Child = grid,
        };
        AutomationProperties.SetAccessibilityView(border, AccessibilityView.Raw);
        return border;
    }

    private static Grid BuildPerDriveRow(CoachDriveRowDisplay row)
    {
        var grid = BuildPerDriveColumns();

        var date = new TextBlock
        {
            Text = row.DateText,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(date, 0);
        grid.Children.Add(date);

        var score = BuildChip(row.ScoreText, row.ScoreStatus);
        score.HorizontalAlignment = HorizontalAlignment.Left;
        score.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(score, 1);
        grid.Children.Add(score);

        var style = BuildChip(row.StyleText, row.StyleStatus);
        style.HorizontalAlignment = HorizontalAlignment.Left;
        style.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(style, 2);
        grid.Children.Add(style);

        var efficiency = new TextBlock
        {
            Text = row.EfficiencyText,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(efficiency, 3);
        grid.Children.Add(efficiency);

        var distance = new TextBlock
        {
            Text = row.DistanceText,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(distance, 4);
        grid.Children.Add(distance);

        grid.Padding = new Thickness(0, 6, 0, 6);
        AutomationProperties.SetName(grid, row.AutomationName);
        return grid;
    }

    // ── Loading (parent still fetching the coach data) ─────────────────────────────────────────────────
    private static TsFadeIn BuildLoading(DrivingCoachSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(new TsSkeleton { BlockWidth = 160, BlockHeight = 24, ReduceMotion = MotionPreference.ReduceMotion });
        stack.Children.Add(SkeletonRow(3, GaugeDiameter));
        stack.Children.Add(new TsSkeleton { BlockHeight = ChartHeight, ReduceMotion = MotionPreference.ReduceMotion });
        stack.Children.Add(SkeletonRow(1, 160));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(panel, display.AutomationName);
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private static Grid SkeletonRow(int count, double height)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        for (int c = 0; c < count; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < count; i++)
        {
            var skeleton = new TsSkeleton { BlockHeight = height, ReduceMotion = MotionPreference.ReduceMotion };
            Grid.SetColumn(skeleton, i);
            grid.Children.Add(skeleton);
        }

        return grid;
    }

    // ── Empty (web parity: no analysed drives to coach on) ─────────────────────────────────────────────
    private static TsFadeIn BuildEmpty(DrivingCoachSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsEmptyState { IconGlyph = CoachGlyph, Message = display.EmptyMessage });

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    // ── Error (web QueryError equivalent with a retry affordance) ──────────────────────────────────────
    private TsFadeIn BuildError(DrivingCoachSectionDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));

        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
        };
        error.ActionInvoked += OnRetryInvoked;
        stack.Children.Add(error);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    // ── Shared primitives ──────────────────────────────────────────────────────────────────────────────
    private static Border BuildProgressBar(double fraction, Brush fill, double height)
    {
        double value = Math.Clamp(fraction, 0, 1);
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(value, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0, 1 - value), GridUnitType.Star) });

        var radius = new CornerRadius(height / 2);
        var fillBorder = new Border { Background = fill, CornerRadius = radius };
        Grid.SetColumn(fillBorder, 0);
        grid.Children.Add(fillBorder);

        var track = new Border
        {
            Height = height,
            CornerRadius = radius,
            Background = DisplayTokens.Border,
            Child = grid,
        };
        AutomationProperties.SetAccessibilityView(track, AccessibilityView.Raw);
        return track;
    }

    private static FontIcon DecorativeIcon(string glyph, double size, Brush foreground)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = size,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private static Brush StatusBrush(StatusKind status) =>
        DisplayTokens.Brush(StatusResources.AccentBrushKey(status));

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DrivingCoachSectionAutomationPeer(this);

    private sealed class DrivingCoachSectionAutomationPeer(DrivingCoachSection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
