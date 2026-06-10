using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DrivingCoachSection</c> feature surface's UI-thread-free logic — the
/// per-state branch projection (loading / error / empty / stale / offline / ready), the web Badge score / style
/// / impact colour thresholds, the score gauge + drives-analyzed caption, the style-breakdown segments &amp;
/// legend, the two efficiency stat-cards' <c>fmtNumber</c> formatting, the weekly-trend gate (&gt;1 point), the
/// five driving-pattern indicators, the per-drive rows, the freshness chip copy, the accessible names, and the
/// PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/driving-dynamics/DrivingCoachSection.tsx). The WinUI view itself
/// (DrivingCoachSection.cs) is exercised by the app build.
/// </summary>
public sealed class DrivingCoachSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static DrivingCoachData Sample(
        double overall = 82,
        double avgEff = 152.3,
        double bestEff = 138.9,
        long total = 7,
        int efficient = 4,
        int moderate = 2,
        int aggressive = 1) =>
        new(
            overall,
            avgEff,
            bestEff,
            total,
            new CoachStyleBreakdown(efficient, moderate, aggressive),
            new CoachPatterns(15, 25, 60, 35, 18),
            new List<CoachWeeklyPoint>
            {
                new("W1", 70),
                new("W2", 78),
                new("W3", 82),
            },
            new List<CoachRecommendationItem>
            {
                new("high", "Ease off hard acceleration."),
                new("low", "Keep up the smooth braking."),
            },
            new List<CoachDriveScore>
            {
                new(101, new DateTimeOffset(2024, 4, 4, 0, 0, 0, TimeSpan.Zero), 88, "efficient", 150.5, 12.5),
                new(102, new DateTimeOffset(2024, 4, 5, 0, 0, 0, TimeSpan.Zero), 55, "moderate", 168.2, 8.0),
            });

    private static DrivingCoachSectionDisplay Project(DrivingCoachSectionModel model) =>
        DrivingCoachSectionProjection.Project(model, Localizer);

    private static DrivingCoachSectionDisplay Ready(DrivingCoachData? data = null) =>
        Project(DrivingCoachSectionModel.Ready(data ?? Sample()));

    // ── Branch precedence: loading → error → empty → freshness → ready ─────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(DrivingCoachSectionState.Loading, Project(DrivingCoachSectionModel.Loading).State);

    [Fact]
    public void Error_when_model_failed() =>
        Assert.Equal(DrivingCoachSectionState.Error, Project(DrivingCoachSectionModel.Failed()).State);

    [Fact]
    public void Empty_when_model_is_empty() =>
        Assert.Equal(DrivingCoachSectionState.Empty, Project(DrivingCoachSectionModel.Empty).State);

    [Fact]
    public void Ready_when_drives_analyzed_present() =>
        Assert.Equal(DrivingCoachSectionState.Ready, Ready().State);

    [Fact]
    public void Fresh_snapshot_with_no_analyzed_drives_collapses_to_empty()
    {
        // The coach story is derived entirely from analysed drives — a fresh snapshot with zero analysed
        // drives has nothing to coach on, so the section shows its friendly empty state.
        var data = Sample(total: 0, efficient: 0, moderate: 0, aggressive: 0);
        Assert.Equal(DrivingCoachSectionState.Empty, Project(DrivingCoachSectionModel.Ready(data)).State);
    }

    [Fact]
    public void Stale_keeps_its_branch_even_with_no_drives() =>
        Assert.Equal(
            DrivingCoachSectionState.Stale,
            Project(DrivingCoachSectionModel.Stale(DrivingCoachData.Empty)).State);

    [Fact]
    public void Offline_keeps_its_branch_even_with_no_drives() =>
        Assert.Equal(
            DrivingCoachSectionState.Offline,
            Project(DrivingCoachSectionModel.Offline(DrivingCoachData.Empty)).State);

    // ── Score gauge (web RadialGauge + drives-analyzed caption + band threshold) ───────────────────────

    [Fact]
    public void Score_value_and_label_come_from_the_data_and_facade()
    {
        var score = Ready(Sample(overall: 82)).Score;

        Assert.Equal(82, score.Value);
        Assert.Equal("Driving Score", score.Label);
        Assert.Equal("82", score.ValueText);
    }

    [Fact]
    public void Drives_analyzed_caption_interpolates_the_count()
    {
        Assert.Equal("7 drives analyzed", Ready(Sample(total: 7)).Score.DrivesAnalyzedText);
    }

    [Fact]
    public void Drives_analyzed_caption_groups_thousands()
    {
        Assert.Equal("1,234 drives analyzed", Ready(Sample(total: 1234)).Score.DrivesAnalyzedText);
    }

    [Theory]
    [InlineData(90, StatusKind.Success)]
    [InlineData(75, StatusKind.Success)]
    [InlineData(74, StatusKind.Warning)]
    [InlineData(50, StatusKind.Warning)]
    [InlineData(49, StatusKind.Danger)]
    [InlineData(0, StatusKind.Danger)]
    public void Score_band_follows_the_web_badge_threshold(double score, StatusKind expected)
    {
        Assert.Equal(expected, DrivingCoachSectionProjection.ScoreBand(score));
        Assert.Equal(expected, Ready(Sample(overall: score)).Score.Band);
    }

    // ── Style breakdown (stacked bar + legend) ─────────────────────────────────────────────────────────

    [Fact]
    public void Style_breakdown_has_data_when_drives_analyzed_positive()
    {
        Assert.True(Ready(Sample(total: 7)).StyleBreakdown.HasData);
    }

    [Fact]
    public void Style_breakdown_segments_are_count_over_total_and_skip_zero()
    {
        // efficient=4 moderate=2 aggressive=0 over total=6 → only two segments, fractions 4/6 and 2/6.
        var breakdown = Ready(Sample(total: 6, efficient: 4, moderate: 2, aggressive: 0)).StyleBreakdown;

        Assert.Collection(
            breakdown.Segments,
            s =>
            {
                Assert.Equal("efficient", s.Key);
                Assert.Equal(StatusKind.Success, s.Status);
                Assert.Equal(4.0 / 6.0, s.Fraction, 3);
            },
            s =>
            {
                Assert.Equal("moderate", s.Key);
                Assert.Equal(StatusKind.Warning, s.Status);
                Assert.Equal(2.0 / 6.0, s.Fraction, 3);
            });
    }

    [Fact]
    public void Style_breakdown_legend_always_lists_all_three_styles_with_counts()
    {
        var legend = Ready(Sample(efficient: 4, moderate: 2, aggressive: 1)).StyleBreakdown.Legend;

        Assert.Collection(
            legend,
            l => { Assert.Equal("Efficient", l.Label); Assert.Equal(StatusKind.Success, l.Status); Assert.Equal("4", l.CountText); },
            l => { Assert.Equal("Moderate", l.Label); Assert.Equal(StatusKind.Warning, l.Status); Assert.Equal("2", l.CountText); },
            l => { Assert.Equal("Aggressive", l.Label); Assert.Equal(StatusKind.Danger, l.Status); Assert.Equal("1", l.CountText); });
    }

    [Fact]
    public void Style_breakdown_empty_message_is_the_web_string()
    {
        var breakdown = Project(DrivingCoachSectionModel.Ready(
            Sample(total: 0, efficient: 0, moderate: 0, aggressive: 0))).StyleBreakdown;

        Assert.False(breakdown.HasData);
        Assert.Equal("Drive more to see your style breakdown.", breakdown.EmptyMessage);
    }

    // ── Efficiency stat-cards ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Efficiency_stats_are_avg_then_best_with_two_decimals_and_unit()
    {
        var stats = Ready(Sample(avgEff: 152.3, bestEff: 138.9)).EfficiencyStats;

        Assert.Collection(
            stats,
            s =>
            {
                Assert.Equal(CoachStatGlyph.AvgEfficiency, s.Glyph);
                Assert.Equal("Avg Efficiency", s.Label);
                Assert.Equal("152.30 Wh/km", s.Value);
            },
            s =>
            {
                Assert.Equal(CoachStatGlyph.BestEfficiency, s.Glyph);
                Assert.Equal("Best Efficiency", s.Label);
                Assert.Equal("138.90 Wh/km", s.Value);
            });
    }

    // ── Weekly trend (web: needs > 1 point) ────────────────────────────────────────────────────────────

    [Fact]
    public void Weekly_trend_has_data_with_more_than_one_point()
    {
        var trend = Ready().WeeklyTrend;

        Assert.True(trend.HasData);
        Assert.Equal(3, trend.Points.Count);
        Assert.Equal("W1", trend.Points[0].Week);
        Assert.Equal(70, trend.Points[0].Score);
        Assert.Equal("Score", trend.SeriesName);
    }

    [Fact]
    public void Weekly_trend_with_a_single_point_is_empty_with_the_web_message()
    {
        var data = Sample() with { WeeklyTrend = new List<CoachWeeklyPoint> { new("W1", 70) } };
        var trend = Ready(data).WeeklyTrend;

        Assert.False(trend.HasData);
        Assert.Equal("Need at least 2 weeks of data for trend analysis.", trend.EmptyMessage);
    }

    // ── Pattern indicators (label + percentage + threshold colour) ─────────────────────────────────────

    [Fact]
    public void Patterns_are_the_five_web_indicators_in_order()
    {
        var patterns = Ready().Patterns;

        Assert.Collection(
            patterns,
            p => Assert.Equal("Hard Acceleration", p.Label),
            p => Assert.Equal("Hard Braking", p.Label),
            p => Assert.Equal("Highway Driving", p.Label),
            p => Assert.Equal("Short Trips (<5 km)", p.Label),
            p => Assert.Equal("Cold Starts", p.Label));
    }

    [Fact]
    public void Pattern_value_text_is_two_decimals_with_percent()
    {
        // Sample hardAccel = 15.
        Assert.Equal("15.00%", Ready().Patterns[0].ValueText);
    }

    [Fact]
    public void Pattern_fraction_clamps_at_full()
    {
        var data = Sample() with { Patterns = new CoachPatterns(120, 0, 0, 0, 0) };
        Assert.Equal(1.0, Ready(data).Patterns[0].Fraction, 3);
    }

    [Theory]
    [InlineData(20, StatusKind.Success)]  // hardAccel lo=20
    [InlineData(40, StatusKind.Warning)]  // hardAccel hi=40
    [InlineData(41, StatusKind.Danger)]
    public void Pattern_status_follows_its_threshold(double value, StatusKind expected)
    {
        var data = Sample() with { Patterns = new CoachPatterns(value, 0, 0, 0, 0) };
        Assert.Equal(expected, Ready(data).Patterns[0].Status);
    }

    // ── Recommendations (impact badge mapping) ─────────────────────────────────────────────────────────

    [Fact]
    public void Recommendations_map_impact_to_the_web_badge_status()
    {
        var recs = Ready().Recommendations;

        Assert.True(Ready().HasRecommendations);
        Assert.Collection(
            recs,
            r => { Assert.Equal(StatusKind.Danger, r.ImpactStatus); Assert.Equal("Ease off hard acceleration.", r.Tip); },
            r => Assert.Equal(StatusKind.Success, r.ImpactStatus));
    }

    [Theory]
    [InlineData("high", StatusKind.Danger)]
    [InlineData("medium", StatusKind.Warning)]
    [InlineData("low", StatusKind.Success)]
    [InlineData("unknown", StatusKind.Success)]
    public void Recommendation_impact_status_matches_the_web_ternary(string impact, StatusKind expected)
    {
        var data = Sample() with
        {
            Recommendations = new List<CoachRecommendationItem> { new(impact, "tip") },
        };
        Assert.Equal(expected, Ready(data).Recommendations[0].ImpactStatus);
    }

    [Fact]
    public void Recommendations_empty_shows_the_web_message()
    {
        var data = Sample() with { Recommendations = [] };
        var display = Ready(data);

        Assert.False(display.HasRecommendations);
        Assert.Equal("Recommendations will appear after more drives.", display.RecommendationsEmptyMessage);
    }

    // ── Per-drive scores table ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Per_drive_headers_are_the_five_localized_columns()
    {
        Assert.Equal(
            new[] { "Date", "Score", "Style", "Wh/km", "Distance" },
            Ready().PerDrive.Headers);
    }

    [Fact]
    public void Per_drive_rows_format_each_cell_like_the_web()
    {
        var row = Ready().PerDrive.Rows[0];

        Assert.Equal("Apr 4", row.DateText);
        Assert.Equal("88", row.ScoreText);
        Assert.Equal(StatusKind.Success, row.ScoreStatus); // 88 >= 75
        Assert.Equal("Efficient", row.StyleText);
        Assert.Equal(StatusKind.Success, row.StyleStatus);
        Assert.Equal("150.50", row.EfficiencyText);
        Assert.Equal("12.50 km", row.DistanceText);
    }

    [Fact]
    public void Per_drive_second_row_uses_the_warning_bands()
    {
        var row = Ready().PerDrive.Rows[1];

        Assert.Equal("55", row.ScoreText);
        Assert.Equal(StatusKind.Warning, row.ScoreStatus); // 55 in [50,75)
        Assert.Equal("Moderate", row.StyleText);
        Assert.Equal(StatusKind.Warning, row.StyleStatus);
    }

    [Fact]
    public void Per_drive_row_key_is_the_drive_id()
    {
        Assert.Equal(101L, Ready().PerDrive.Rows[0].Key);
    }

    [Fact]
    public void Per_drive_empty_shows_the_web_message()
    {
        var data = Sample() with { PerDriveScores = [] };
        var perDrive = Ready(data).PerDrive;

        Assert.False(perDrive.HasData);
        Assert.Equal("Drive data will appear after your first trip.", perDrive.EmptyMessage);
    }

    [Fact]
    public void Per_drive_null_date_renders_an_em_dash()
    {
        var data = Sample() with
        {
            PerDriveScores = new List<CoachDriveScore> { new(1, null, 80, "efficient", 150, 10) },
        };
        Assert.Equal("\u2014", Ready(data).PerDrive.Rows[0].DateText);
    }

    // ── Titles + freshness chip ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Section_titles_resolve_from_the_facade()
    {
        var display = Ready();

        Assert.Equal("Driving Coach", display.Title);
        Assert.Equal("Style Breakdown", display.StyleBreakdownTitle);
        Assert.Equal("Weekly Score Trend", display.WeeklyTrendTitle);
        Assert.Equal("Driving Patterns", display.PatternsTitle);
        Assert.Equal("Recommendations", display.RecommendationsTitle);
        Assert.Equal("Per-Drive Scores", display.PerDriveTitle);
    }

    [Fact]
    public void Ready_has_no_freshness_chip() => Assert.False(Ready().ShowFreshnessChip);

    [Fact]
    public void Stale_shows_a_warning_stale_chip()
    {
        var display = Project(DrivingCoachSectionModel.Stale(Sample()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Stale", display.FreshnessChipText);
        Assert.Equal(StatusKind.Warning, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_shows_a_danger_offline_chip()
    {
        var display = Project(DrivingCoachSectionModel.Offline(Sample()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Offline", display.FreshnessChipText);
        Assert.Equal(StatusKind.Danger, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_keeps_the_cached_score_and_rows()
    {
        var display = Project(DrivingCoachSectionModel.Offline(Sample(overall: 82)));

        Assert.Equal("82", display.Score.ValueText);
        Assert.NotEmpty(display.PerDrive.Rows);
    }

    // ── Fixed copy (loading / empty / error / retry) ───────────────────────────────────────────────────

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(DrivingCoachSectionModel.Loading).LoadingLabel);

    [Fact]
    public void Section_empty_message_is_friendly() =>
        Assert.Equal(
            "Drive data will appear after your first trip.",
            Project(DrivingCoachSectionModel.Empty).EmptyMessage);

    [Fact]
    public void Error_title_is_resolved() =>
        Assert.Equal("Couldn't load driving coach", Project(DrivingCoachSectionModel.Failed()).ErrorTitle);

    [Fact]
    public void Error_message_falls_back_to_the_default_when_none_supplied() =>
        Assert.Equal(
            "We couldn't load your driving coach data. Please try again.",
            Project(DrivingCoachSectionModel.Failed()).ErrorMessage);

    [Fact]
    public void Error_message_uses_the_supplied_message() =>
        Assert.Equal(
            "Network unreachable",
            Project(DrivingCoachSectionModel.Failed("Network unreachable")).ErrorMessage);

    [Fact]
    public void Retry_label_uses_the_shared_common_retry_string() =>
        Assert.Equal("Retry", Project(DrivingCoachSectionModel.Failed()).RetryLabel);

    // ── Accessibility: every state exposes a meaningful Narrator name ──────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(DrivingCoachSectionModel.Loading),
                Project(DrivingCoachSectionModel.Empty),
                Project(DrivingCoachSectionModel.Failed()),
                Project(DrivingCoachSectionModel.Stale(Sample())),
                Project(DrivingCoachSectionModel.Offline(Sample())),
                Ready(),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_pairs_the_title_and_loading_label() =>
        Assert.Equal("Driving Coach. Loading", Project(DrivingCoachSectionModel.Loading).AutomationName);

    [Fact]
    public void Empty_automation_name_pairs_the_title_and_empty_message() =>
        Assert.Equal(
            "Driving Coach. Drive data will appear after your first trip.",
            Project(DrivingCoachSectionModel.Empty).AutomationName);

    [Fact]
    public void Error_automation_name_pairs_the_title_and_error_title() =>
        Assert.Equal(
            "Driving Coach. Couldn't load driving coach",
            Project(DrivingCoachSectionModel.Failed()).AutomationName);

    [Fact]
    public void Ready_automation_name_carries_title_and_score()
    {
        var display = Ready();

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.Score.AutomationName, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Stale_automation_name_includes_the_chip() =>
        Assert.Contains(
            "Stale",
            Project(DrivingCoachSectionModel.Stale(Sample())).AutomationName,
            StringComparison.Ordinal);

    // ── Diagnostics (P1/S11): view.opened slug=DrivingCoachSection, PII-safe ───────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new DrivingCoachSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DrivingCoachSection", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_driving_behaviour()
    {
        var captured = new List<string>();
        var diagnostics = new DrivingCoachSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=DrivingCoachSection", line);
        Assert.DoesNotContain('%', line);
        Assert.DoesNotContain("km", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("DrivingCoachSection", DrivingCoachSectionRegistration.Slug);

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => DrivingCoachSectionProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => DrivingCoachSectionProjection.Project(DrivingCoachSectionModel.Loading, null!));
}
