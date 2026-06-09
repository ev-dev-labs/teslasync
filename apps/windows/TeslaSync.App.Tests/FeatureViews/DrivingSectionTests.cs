using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.WeeklyDigest;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DrivingSection</c> feature surface's UI-thread-free logic — the tolerant
/// cached-props parse adapter (<c>DrivingSectionModel.FromJson</c> / <c>DigestTopDrive.ParseNullable</c>),
/// the loading/ready branch projection with the within-section daily-distance and top-drive empties, the
/// daily-distance bar math (height ratio + one-decimal formatting + day ticks), the four efficiency
/// mini-stats (the <c>fmtNumber</c>/<c>fmtInt</c> values, the hour/minute split, the <c>pctChange</c>
/// percentage, the em-dash gate and the TrendingDown/Up choice), the accessible Day/Distance fallback
/// table, the top-drive fields + <c>formatDate</c>, the per-state Narrator names, and the diagnostics.
/// Mirrors the web spec (web/src/features/analytics/components/weekly-digest/DrivingSection.tsx). The WinUI
/// view itself (feature-views\DrivingSection\DrivingSection.cs) is exercised by the app build.
/// </summary>
public sealed class DrivingSectionTests
{
    private const string EmDash = "\u2014";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // A fixed clock for the (date-variant) top-drive date — the Date variant ignores it, but keep it stable.
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 8, 0, 0, TimeSpan.Zero);

    private static DailyDistanceEntry Day(string day, double distance) => new(day, distance);

    private static DrivingSectionModel Ready(
        double avgEfficiency = 150,
        double prevAvgEfficiency = 160,
        double totalDurationMinutes = 125,
        long totalDrives = 7,
        DigestTopDrive? topDrive = null,
        params DailyDistanceEntry[] daily) =>
        new(false, avgEfficiency, prevAvgEfficiency, totalDurationMinutes, totalDrives, topDrive, daily);

    private static DrivingSectionDisplay Project(DrivingSectionModel model) =>
        DrivingSectionProjection.Project(model, Localizer, Now);

    // ── Parse adapter (cached props JSON → model) ────────────────────────────────────────────────────

    [Fact]
    public void FromJson_reads_metrics_daily_distance_and_top_drive()
    {
        const string json = """
        {
          "metrics": {
            "avgEfficiency": 152.3,
            "prevAvgEfficiency": 160,
            "totalDuration": 125,
            "totalDrives": 7,
            "topDrive": {
              "start_date": "2026-04-15T12:00:00Z",
              "distance": 88.5,
              "duration_min": 95,
              "efficiency_wh_km": 150
            }
          },
          "dailyDistanceData": [
            { "day": "Mon", "distance": 12.3 },
            { "day": "Tue", "distance": 4 }
          ]
        }
        """;

        var model = DrivingSectionModel.FromJson(JsonDocument.Parse(json).RootElement);

        Assert.False(model.Loading);
        Assert.Equal(152.3, model.AvgEfficiency);
        Assert.Equal(160, model.PrevAvgEfficiency);
        Assert.Equal(125, model.TotalDurationMinutes);
        Assert.Equal(7, model.TotalDrives);
        Assert.NotNull(model.TopDrive);
        Assert.Equal(88.5, model.TopDrive!.DistanceKm);
        Assert.Equal(95, model.TopDrive.DurationMin);
        Assert.Equal(150, model.TopDrive.EfficiencyWhKm);
        Assert.Equal("2026-04-15T12:00:00Z", model.TopDrive.StartDate);
        Assert.Collection(
            model.DailyDistance,
            d => Assert.Equal(("Mon", 12.3), (d.Day, d.Distance)),
            d => Assert.Equal(("Tue", 4.0), (d.Day, d.Distance)));
    }

    [Fact]
    public void FromJson_maps_null_top_drive_to_no_card()
    {
        const string json = """{ "metrics": { "topDrive": null }, "dailyDistanceData": [] }""";

        var model = DrivingSectionModel.FromJson(JsonDocument.Parse(json).RootElement);

        Assert.Null(model.TopDrive);
        Assert.Empty(model.DailyDistance);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        var model = DrivingSectionModel.FromJson(JsonDocument.Parse("{}").RootElement);

        Assert.Equal(0, model.AvgEfficiency);
        Assert.Equal(0, model.TotalDrives);
        Assert.Null(model.TopDrive);
        Assert.Empty(model.DailyDistance);
    }

    [Fact]
    public void FromJson_carries_the_loading_flag()
    {
        var model = DrivingSectionModel.FromJson(JsonDocument.Parse("{}").RootElement, loading: true);

        Assert.True(model.Loading);
        Assert.Equal(DrivingSectionState.Loading, Project(model).State);
    }

    [Fact]
    public void DigestTopDrive_parse_nullable_ignores_non_objects()
    {
        Assert.Null(DigestTopDrive.ParseNullable(JsonDocument.Parse("null").RootElement));
        Assert.Null(DigestTopDrive.ParseNullable(JsonDocument.Parse("42").RootElement));
        Assert.NotNull(DigestTopDrive.ParseNullable(JsonDocument.Parse("""{ "distance": 5 }""").RootElement));
    }

    // ── Branch precedence: loading → ready ───────────────────────────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading()
    {
        Assert.Equal(DrivingSectionState.Loading, Project(DrivingSectionModel.Pending).State);
    }

    [Fact]
    public void Ready_when_resolved()
    {
        Assert.Equal(DrivingSectionState.Ready, Project(DrivingSectionModel.Empty).State);
    }

    [Fact]
    public void Title_resolves_from_the_facade()
    {
        Assert.Equal("Driving", Project(DrivingSectionModel.Empty).Title);
    }

    // ── Daily-distance chart + within-section empty ──────────────────────────────────────────────────

    [Fact]
    public void Daily_distance_empty_when_no_entries()
    {
        var display = Project(DrivingSectionModel.Empty);

        Assert.False(display.HasDailyDistance);
        Assert.Empty(display.Bars);
        Assert.Empty(display.Rows);
        Assert.Equal("No driving distance data is available for this week.", display.NoDailyDistanceMessage);
    }

    [Fact]
    public void Daily_distance_label_resolves_from_the_facade()
    {
        Assert.Equal("Daily Distance (km)", Project(DrivingSectionModel.Empty).DailyDistanceLabel);
    }

    [Fact]
    public void Bar_height_ratio_is_relative_to_the_busiest_day()
    {
        var display = Project(Ready(daily: [Day("Mon", 12), Day("Tue", 6), Day("Wed", 0)]));

        Assert.True(display.HasDailyDistance);
        Assert.Equal(1.0, display.Bars[0].HeightRatio);
        Assert.Equal(0.5, display.Bars[1].HeightRatio);
        Assert.Equal(0.0, display.Bars[2].HeightRatio);
    }

    [Fact]
    public void Bar_distance_text_uses_one_decimal_and_day_tick()
    {
        var bar = Assert.Single(Project(Ready(daily: [Day("Fri", 42.25)])).Bars);

        Assert.Equal("Fri", bar.DayLabel);
        Assert.Equal("42.3", bar.DistanceText);
        Assert.Contains("Fri", bar.AutomationName, StringComparison.Ordinal);
        Assert.Contains("42.3", bar.AutomationName, StringComparison.Ordinal);
        Assert.Contains("km", bar.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Bar_non_finite_distance_is_coerced_to_zero()
    {
        var display = Project(Ready(daily: [Day("Mon", double.NaN), Day("Tue", double.PositiveInfinity)]));

        Assert.All(display.Bars, bar => Assert.Equal(0.0, bar.Distance));
        Assert.All(display.Bars, bar => Assert.Equal(0.0, bar.HeightRatio));
    }

    // ── Accessible fallback table (Day / Distance) ───────────────────────────────────────────────────

    [Fact]
    public void Columns_match_the_day_and_distance_columns()
    {
        var columns = Project(Ready(daily: [Day("Mon", 1)])).Columns;

        Assert.Collection(
            columns,
            c => Assert.Equal((DrivingSectionProjection.DayKey, "Date"), (c.Key, c.Header)),
            c => Assert.Equal((DrivingSectionProjection.DistanceKey, "Distance"), (c.Key, c.Header)));
    }

    [Fact]
    public void Row_carries_the_day_label_and_unit_suffixed_distance()
    {
        var row = Assert.Single(Project(Ready(daily: [Day("Wed", 9.5)])).Rows);

        Assert.Equal("Wed", row.Cells[DrivingSectionProjection.DayKey]);
        Assert.Equal("9.5 km", row.Cells[DrivingSectionProjection.DistanceKey]);
    }

    [Fact]
    public void Rows_have_stable_unique_keys()
    {
        var rows = Project(Ready(daily: [Day("Mon", 1), Day("Tue", 2), Day("Wed", 3)])).Rows;

        Assert.Equal(3, rows.Count);
        Assert.Equal(rows.Count, rows.Select(r => r.RowKey).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Chart_table_label_interpolates_the_chart_label()
    {
        Assert.Equal(
            "Daily Distance (km) \u2014 data table",
            Project(Ready(daily: [Day("Mon", 1)])).ChartTableLabel);
    }

    // ── Mini-stats: values, formatting, trend ────────────────────────────────────────────────────────

    [Fact]
    public void Four_mini_stats_in_web_order()
    {
        var stats = Project(Ready()).Stats;

        Assert.Equal(4, stats.Count);
        Assert.Equal("Avg Efficiency", stats[0].Label);
        Assert.Equal("Total Driving Time", stats[1].Label);
        Assert.Equal("Efficiency Change", stats[2].Label);
        Assert.Equal("Drives", stats[3].Label);
    }

    [Fact]
    public void Avg_efficiency_value_is_one_decimal_with_unit()
    {
        Assert.Equal("152.3 Wh/km", Project(Ready(avgEfficiency: 152.34)).Stats[0].Value);
    }

    [Fact]
    public void Total_driving_time_splits_hours_and_minutes()
    {
        // 125 minutes → 2h 5m (web Math.floor(totalDuration / 60) + (totalDuration % 60)).
        Assert.Equal("2h 5m", Project(Ready(totalDurationMinutes: 125)).Stats[1].Value);
    }

    [Fact]
    public void Total_driving_time_rounds_the_minute_remainder_like_fmtInt()
    {
        // 125.7 minutes → 2h, remainder 5.7 → fmtInt rounds half-up to 6.
        Assert.Equal("2h 6m", Project(Ready(totalDurationMinutes: 125.7)).Stats[1].Value);
    }

    [Fact]
    public void Drives_count_is_a_grouped_integer()
    {
        Assert.Equal("1,234", Project(Ready(totalDrives: 1234)).Stats[3].Value);
    }

    [Fact]
    public void Efficiency_change_shows_percent_and_improving_trend_when_efficiency_fell()
    {
        // avg (80) <= prev (100) → improvement (green TrendingDown); pctChange = -20%.
        var stat = Project(Ready(avgEfficiency: 80, prevAvgEfficiency: 100)).Stats[2];

        Assert.Equal("-20.0%", stat.Value);
        Assert.Equal(DrivingTrend.Down, stat.Trend);
        Assert.Equal(DrivingSectionRegistration.TrendingDownGlyph, stat.Glyph);
    }

    [Fact]
    public void Efficiency_change_shows_regressing_trend_when_efficiency_rose()
    {
        // avg (120) > prev (100) → regression (red TrendingUp); pctChange = +20%.
        var stat = Project(Ready(avgEfficiency: 120, prevAvgEfficiency: 100)).Stats[2];

        Assert.Equal("20.0%", stat.Value);
        Assert.Equal(DrivingTrend.Up, stat.Trend);
        Assert.Equal(DrivingSectionRegistration.TrendingUpGlyph, stat.Glyph);
    }

    [Fact]
    public void Efficiency_change_is_an_em_dash_without_a_previous_baseline()
    {
        var stat = Project(Ready(avgEfficiency: 150, prevAvgEfficiency: 0)).Stats[2];

        Assert.Equal(EmDash, stat.Value);
    }

    [Fact]
    public void Equal_efficiency_counts_as_an_improvement()
    {
        // avg == prev → web `<=` test holds → improvement (TrendingDown).
        Assert.Equal(DrivingTrend.Down, Project(Ready(avgEfficiency: 100, prevAvgEfficiency: 100)).Stats[2].Trend);
    }

    [Theory]
    [InlineData(120, 100, 20)]
    [InlineData(80, 100, -20)]
    [InlineData(150, 0, 100)]
    [InlineData(0, 0, 0)]
    public void Percent_change_matches_the_web_helper(double current, double previous, double expected)
    {
        Assert.Equal(expected, DrivingSectionProjection.PercentChange(current, previous));
    }

    // ── Top drive card + within-section empty ────────────────────────────────────────────────────────

    [Fact]
    public void Top_drive_empty_when_absent()
    {
        var display = Project(DrivingSectionModel.Empty);

        Assert.False(display.HasTopDrive);
        Assert.Empty(display.TopDriveFields);
        Assert.Equal("No top drive is available for this week yet.", display.NoTopDriveMessage);
    }

    [Fact]
    public void Top_drive_badge_resolves_from_the_facade()
    {
        Assert.Equal("Top Drive", Project(DrivingSectionModel.Empty).TopDriveBadge);
    }

    [Fact]
    public void Top_drive_fields_are_labelled_and_unit_suffixed()
    {
        var drive = new DigestTopDrive("2026-04-15T12:00:00Z", 88.5, 95, 150);
        var display = Project(Ready(topDrive: drive));

        Assert.True(display.HasTopDrive);
        Assert.Collection(
            display.TopDriveFields,
            f => Assert.Equal("Date", f.Label),
            f => Assert.Equal(("Distance", "88.5 km"), (f.Label, f.Value)),
            f => Assert.Equal(("Duration", "95 min"), (f.Label, f.Value)),
            f => Assert.Equal(("Efficiency", "150.0 Wh/km"), (f.Label, f.Value)));
    }

    [Fact]
    public void Top_drive_date_formats_the_iso_timestamp()
    {
        var drive = new DigestTopDrive("2026-04-15T12:00:00Z", 10, 10, 10);
        string date = Project(Ready(topDrive: drive)).TopDriveFields[0].Value;

        // Noon-UTC keeps the calendar day stable across realistic time zones → "Apr __, 2026".
        Assert.Contains("Apr", date, StringComparison.Ordinal);
        Assert.Contains("2026", date, StringComparison.Ordinal);
    }

    [Fact]
    public void Top_drive_date_is_an_em_dash_for_an_unparseable_timestamp()
    {
        var drive = new DigestTopDrive(string.Empty, 10, 10, 10);

        Assert.Equal(EmDash, Project(Ready(topDrive: drive)).TopDriveFields[0].Value);
    }

    // ── Accessibility: every state exposes a non-empty Narrator name ─────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(DrivingSectionModel.Pending),
                Project(DrivingSectionModel.Empty),
                Project(Ready(topDrive: new DigestTopDrive("2026-04-15T12:00:00Z", 10, 20, 30), daily: [Day("Mon", 5)])),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_is_the_loading_string()
    {
        Assert.Equal("Loading", Project(DrivingSectionModel.Pending).AutomationName);
    }

    [Fact]
    public void Ready_automation_name_is_the_title()
    {
        Assert.Equal("Driving", Project(DrivingSectionModel.Empty).AutomationName);
    }

    [Fact]
    public void Every_mini_stat_exposes_a_descriptive_automation_name()
    {
        var stats = Project(Ready(avgEfficiency: 150, prevAvgEfficiency: 160)).Stats;

        Assert.All(stats, stat => Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName)));
        Assert.All(stats, stat => Assert.Contains(stat.Label, stat.AutomationName, StringComparison.Ordinal));
        Assert.All(stats, stat => Assert.Contains(stat.Value, stat.AutomationName, StringComparison.Ordinal));
    }

    [Fact]
    public void Each_bar_exposes_a_descriptive_automation_name()
    {
        var bar = Assert.Single(Project(Ready(daily: [Day("Sun", 33)])).Bars);

        Assert.Contains("Sun", bar.AutomationName, StringComparison.Ordinal);
        Assert.Contains("33", bar.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Each_row_exposes_a_descriptive_automation_name()
    {
        var rows = Project(Ready(daily: [Day("Mon", 3), Day("Tue", 9)])).Rows;

        Assert.All(rows, row => Assert.False(string.IsNullOrWhiteSpace(row.AutomationName)));
        Assert.Contains("9", rows[1].AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=DrivingSection, PII-safe ──────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new DrivingSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DrivingSection", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_driving_figures()
    {
        var captured = new List<string>();
        var diagnostics = new DrivingSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("152", line, StringComparison.Ordinal);
        Assert.DoesNotContain("km", line, StringComparison.Ordinal);
        Assert.Equal("view.opened slug=DrivingSection", line);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("DrivingSection", DrivingSectionRegistration.Slug);
    }

    [Fact]
    public void Registration_exposes_distinct_glyphs_for_each_icon()
    {
        var glyphs = new[]
        {
            DrivingSectionRegistration.CarGlyph,
            DrivingSectionRegistration.AvgEfficiencyGlyph,
            DrivingSectionRegistration.ClockGlyph,
            DrivingSectionRegistration.TrendingDownGlyph,
            DrivingSectionRegistration.TrendingUpGlyph,
            DrivingSectionRegistration.DrivesGlyph,
        };

        Assert.All(glyphs, g => Assert.False(string.IsNullOrEmpty(g)));
        Assert.Equal(glyphs.Length, glyphs.Distinct(StringComparer.Ordinal).Count());
    }
}
