using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Analytics;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DrivingTab</c> feature surface's UI-thread-free logic — the state
/// projection (loading / empty / error / stale / offline / ready), the seven chart sections' data/empty
/// branches + series shapes, the boundary unit conversions for the performance + temperature grids and the
/// temp-vs-efficiency scatter, the accessible names, and the diagnostics. Mirrors the web spec
/// (<c>web/src/features/analytics/components/analytics/DrivingTab.tsx</c> + its <c>DrivingPerformanceCards</c>
/// and <c>DrivingTemperatureStats</c> children). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class DrivingTabTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static DrivingTabDisplay Project(DrivingTabModel model, UnitPref? units = null) =>
        DrivingTabProjection.Project(model, units ?? UnitPref.Metric, Localizer);

    private static DriveAnalytics Populated() => new(
        SpeedDistribution: new[] { new DriveBucket("0-30", 4), new DriveBucket("30-60", 9) },
        DistanceDistribution: new[] { new DriveBucket("0-10", 3), new DriveBucket("10-20", 5) },
        DurationDistribution: new[] { new DriveBucket("0-15m", 6) },
        HourlyPattern: new[] { new DriveHourPoint(8, 3, 42), new DriveHourPoint(17, 5, 60) },
        TempVsEfficiency: new[] { new DriveTempEffPoint(10, 150, 20), new DriveTempEffPoint(25, 140, 35) },
        DailyTrend: new[]
        {
            new DriveDailyPoint("2026-06-01", 50, 4, 150),
            new DriveDailyPoint("2026-06-02", 60, 5, 0),
        },
        SpeedStats: new DriveStat(0, 65, 200),
        PowerStats: new DriveStat(0, 30, 120),
        RegenStats: new DriveStat(0, 10, 45),
        DistanceStats: new DriveStat(2, 50, 180),
        Temperature: new DriveTemperature(new DriveStat(10, 21, 30), new DriveStat(-5, 12, 28)));

    private static DriveChartSection Chart(DrivingTabDisplay display, string key) =>
        display.Charts.Single(c => c.Key == key);

    // ── State projection (parent-owned phase → rendered state) ───────────────────────────────────────

    [Fact]
    public void Loading_phase_projects_loading()
    {
        Assert.Equal(DrivingTabState.Loading, Project(DrivingTabModel.Pending).State);
    }

    [Fact]
    public void Error_phase_projects_error()
    {
        var display = Project(new DrivingTabModel(DriveLoadPhase.Error, null));

        Assert.Equal(DrivingTabState.Error, display.State);
        Assert.Equal("Failed to load data", display.ErrorMessage);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void Ready_phase_without_payload_projects_empty()
    {
        Assert.Equal(DrivingTabState.Empty, Project(DrivingTabModel.Empty).State);
    }

    [Fact]
    public void Ready_phase_with_payload_projects_ready()
    {
        Assert.Equal(DrivingTabState.Ready, Project(DrivingTabModel.Ready(Populated())).State);
    }

    [Fact]
    public void Stale_phase_projects_stale_with_a_stale_chip()
    {
        var display = Project(new DrivingTabModel(DriveLoadPhase.Stale, Populated()));

        Assert.Equal(DrivingTabState.Stale, display.State);
        Assert.Equal(DriveStatusChip.Stale, display.StatusChip);
        Assert.Equal("Stale", display.StatusChipLabel);
        Assert.True(display.HasContent);
    }

    [Fact]
    public void Offline_phase_projects_offline_with_an_offline_chip()
    {
        var display = Project(new DrivingTabModel(DriveLoadPhase.Offline, Populated()));

        Assert.Equal(DrivingTabState.Offline, display.State);
        Assert.Equal(DriveStatusChip.Offline, display.StatusChip);
        Assert.Equal("Offline", display.StatusChipLabel);
        Assert.True(display.HasContent);
    }

    [Fact]
    public void Content_states_carry_no_chip_when_fresh()
    {
        Assert.Equal(DriveStatusChip.None, Project(DrivingTabModel.Ready(Populated())).StatusChip);
        Assert.Equal(DriveStatusChip.None, Project(DrivingTabModel.Empty).StatusChip);
    }

    // ── Section scaffold is always present (web parity: every section renders) ───────────────────────

    [Fact]
    public void Always_projects_the_seven_chart_sections_in_source_order()
    {
        var keys = Project(DrivingTabModel.Ready(Populated())).Charts.Select(c => c.Key).ToArray();

        Assert.Equal(
            new[]
            {
                DrivingTabProjection.Sections.SpeedDistribution,
                DrivingTabProjection.Sections.DistanceDistribution,
                DrivingTabProjection.Sections.HourlyPattern,
                DrivingTabProjection.Sections.TempVsEfficiency,
                DrivingTabProjection.Sections.DailyTrend,
                DrivingTabProjection.Sections.DurationDistribution,
                DrivingTabProjection.Sections.EfficiencyTrend,
            },
            keys);
    }

    [Fact]
    public void Empty_payload_renders_every_chart_section_empty_with_the_web_messages()
    {
        var display = Project(DrivingTabModel.Empty);

        Assert.All(display.Charts, c => Assert.False(c.HasData));
        Assert.Equal("No speed data", Chart(display, "speedDist").EmptyMessage);
        Assert.Equal("No distance distribution data", Chart(display, "distDist").EmptyMessage);
        Assert.Equal("No hourly data", Chart(display, "hourly").EmptyMessage);
        Assert.Equal("No temperature data", Chart(display, "tempEff").EmptyMessage);
        Assert.Equal("No daily trend data", Chart(display, "dailyTrend").EmptyMessage);
        Assert.Equal("Not enough drive data for distribution chart", Chart(display, "durationDist").EmptyMessage);
        Assert.Equal("No efficiency trend data", Chart(display, "effTrend").EmptyMessage);
    }

    [Fact]
    public void Empty_chart_sections_keep_their_localized_titles()
    {
        var display = Project(DrivingTabModel.Empty);

        Assert.Equal("Speed Distribution", Chart(display, "speedDist").Title);
        Assert.Equal("Trip Distance Distribution", Chart(display, "distDist").Title);
        Assert.Equal("Hourly Driving Pattern", Chart(display, "hourly").Title);
        Assert.Equal("Temperature vs Efficiency", Chart(display, "tempEff").Title);
        Assert.Equal("Daily Driving Trend", Chart(display, "dailyTrend").Title);
        Assert.Equal("Drive Duration Distribution", Chart(display, "durationDist").Title);
        Assert.Equal("Efficiency Trend", Chart(display, "effTrend").Title);
    }

    // ── Chart series shapes (kinds, palette indices, labels) ─────────────────────────────────────────

    [Fact]
    public void Speed_distribution_is_a_single_bar_series_carrying_range_labels()
    {
        var section = Chart(Project(DrivingTabModel.Ready(Populated())), "speedDist");

        Assert.True(section.HasData);
        var series = Assert.Single(section.Series);
        Assert.Equal(ChartSeriesKind.Bar, series.Kind);
        Assert.Equal("Trips", series.Name);
        Assert.Equal(2, series.Points.Count);
        Assert.Equal(4, series.Points[0].Y);
        Assert.Equal("0-30", series.Points[0].Label);
        Assert.Equal("30-60", series.Points[1].Label);
    }

    [Fact]
    public void Distance_distribution_uses_the_third_palette_colour()
    {
        var section = Chart(Project(DrivingTabModel.Ready(Populated())), "distDist");

        Assert.Equal(2, Assert.Single(section.Series).ColorIndex);
    }

    [Fact]
    public void Hourly_pattern_is_a_drives_bar_plus_a_distance_line()
    {
        var section = Chart(Project(DrivingTabModel.Ready(Populated())), "hourly");

        Assert.Equal(2, section.Series.Count);
        Assert.Equal(ChartSeriesKind.Bar, section.Series[0].Kind);
        Assert.Equal("Drives", section.Series[0].Name);
        Assert.Equal(ChartSeriesKind.Line, section.Series[1].Kind);
        Assert.Equal("Distance", section.Series[1].Name);

        // Web parity: the hourly distance overlay renders raw (km), unconverted, even under imperial units.
        var imperial = Chart(Project(DrivingTabModel.Ready(Populated()), UnitPref.Imperial), "hourly");
        Assert.Equal(42, imperial.Series[1].Points[0].Y);
    }

    [Fact]
    public void Hourly_x_axis_is_the_hour_with_a_clock_label()
    {
        var section = Chart(Project(DrivingTabModel.Ready(Populated())), "hourly");

        Assert.Equal(8, section.Series[0].Points[0].X);
        Assert.Equal("8:00", section.Series[0].Points[0].Label);
        Assert.Equal("17:00", section.Series[0].Points[1].Label);
    }

    [Fact]
    public void Temp_vs_efficiency_is_a_single_scatter_series()
    {
        var section = Chart(Project(DrivingTabModel.Ready(Populated())), "tempEff");

        Assert.Equal(ChartSeriesKind.Scatter, Assert.Single(section.Series).Kind);
        Assert.Equal(2, section.Series[0].Points.Count);
    }

    [Fact]
    public void Daily_trend_is_a_distance_area_plus_a_drives_line()
    {
        var section = Chart(Project(DrivingTabModel.Ready(Populated())), "dailyTrend");

        Assert.Equal(2, section.Series.Count);
        Assert.Equal(ChartSeriesKind.Area, section.Series[0].Kind);
        Assert.Equal(ChartSeriesKind.Line, section.Series[1].Kind);
        Assert.Equal("Drives", section.Series[1].Name);

        // Web parity: the X tickFormatter slices the "YYYY-" prefix to a MM-DD label.
        Assert.Equal("06-01", section.Series[0].Points[0].Label);
    }

    [Fact]
    public void Daily_trend_area_series_is_named_for_the_distance_unit()
    {
        Assert.Equal("km", Chart(Project(DrivingTabModel.Ready(Populated())), "dailyTrend").Series[0].Name);
        Assert.Equal("mi", Chart(Project(DrivingTabModel.Ready(Populated()), UnitPref.Imperial), "dailyTrend").Series[0].Name);
    }

    [Fact]
    public void Duration_distribution_uses_the_drives_name_and_fifth_palette_colour()
    {
        var section = Chart(Project(DrivingTabModel.Ready(Populated())), "durationDist");

        var series = Assert.Single(section.Series);
        Assert.Equal(ChartSeriesKind.Bar, series.Kind);
        Assert.Equal("Drives", series.Name);
        Assert.Equal(4, series.ColorIndex);
    }

    [Fact]
    public void Efficiency_trend_filters_daily_points_to_positive_efficiency()
    {
        // Populated daily_trend has efficiency 150 then 0 → only the first point survives the filter.
        var section = Chart(Project(DrivingTabModel.Ready(Populated())), "effTrend");

        Assert.True(section.HasData);
        var series = Assert.Single(section.Series);
        Assert.Equal(ChartSeriesKind.Area, series.Kind);
        Assert.Equal(150, Assert.Single(series.Points).Y);
        Assert.Equal("Wh/km", series.Name);
    }

    [Fact]
    public void Efficiency_trend_is_empty_when_no_day_has_positive_efficiency()
    {
        var analytics = Populated() with
        {
            DailyTrend = new[] { new DriveDailyPoint("2026-06-01", 50, 4, 0) },
        };

        var section = Chart(Project(DrivingTabModel.Ready(analytics)), "effTrend");

        Assert.False(section.HasData);
        Assert.Empty(section.Series);
    }

    // ── Performance grid (web DrivingPerformanceCards) ───────────────────────────────────────────────

    [Fact]
    public void Performance_grid_always_has_six_cards()
    {
        var cards = Project(DrivingTabModel.Empty).PerformanceCards.Cards;

        Assert.Equal(6, cards.Count);
        Assert.True(Project(DrivingTabModel.Empty).PerformanceCards.HasData);
    }

    [Fact]
    public void Performance_cards_em_dash_when_their_stat_is_absent()
    {
        var cards = Project(DrivingTabModel.Empty).PerformanceCards.Cards;

        Assert.All(cards, c => Assert.Equal(EmDash, c.Value));
    }

    [Fact]
    public void Top_speed_renders_in_kmh_under_metric_and_mph_under_imperial()
    {
        var metric = Project(DrivingTabModel.Ready(Populated())).PerformanceCards.Cards;
        var imperial = Project(DrivingTabModel.Ready(Populated()), UnitPref.Imperial).PerformanceCards.Cards;

        // speed_stats.max = 200 km/h → 200 km/h, or 200 / 1.609344 = 124 mph.
        Assert.Equal("200", metric[0].Value);
        Assert.Equal("km/h", metric[0].Unit);
        Assert.Equal("124", imperial[0].Value);
        Assert.Equal("mph", imperial[0].Unit);
    }

    [Fact]
    public void Power_and_regen_cards_show_raw_kilowatts()
    {
        var cards = Project(DrivingTabModel.Ready(Populated())).PerformanceCards.Cards;

        Assert.Equal("120", cards[2].Value);
        Assert.Equal("kW", cards[2].Unit);
        Assert.Equal("45", cards[3].Value);
        Assert.Equal("kW", cards[3].Unit);
    }

    [Fact]
    public void Distance_cards_convert_km_to_the_display_unit_with_one_decimal()
    {
        var metric = Project(DrivingTabModel.Ready(Populated())).PerformanceCards.Cards;
        var imperial = Project(DrivingTabModel.Ready(Populated()), UnitPref.Imperial).PerformanceCards.Cards;

        // distance_stats.avg = 50 km → 50.0 km, or 50 / 1.609344 = 31.1 mi.
        Assert.Equal("50.0", metric[4].Value);
        Assert.Equal("31.1", imperial[4].Value);
        // distance_stats.max = 180 km → 180.0 km, or 111.8 mi.
        Assert.Equal("180.0", metric[5].Value);
        Assert.Equal("111.8", imperial[5].Value);
    }

    // ── Temperature-vs-efficiency boundary conversion ────────────────────────────────────────────────

    [Fact]
    public void Temp_efficiency_converts_temp_and_rescales_efficiency_for_miles()
    {
        var metric = Chart(Project(DrivingTabModel.Ready(Populated())), "tempEff").Series[0];
        var imperial = Chart(Project(DrivingTabModel.Ready(Populated()), UnitPref.Imperial), "tempEff").Series[0];

        // Metric: temp stays °C, efficiency stays Wh/km.
        Assert.Equal(10, metric.Points[0].X);
        Assert.Equal(150, metric.Points[0].Y);

        // Imperial: 10°C → 50°F; 150 Wh/km × 1.609344 = 241.4016 Wh/mi.
        Assert.Equal(50, imperial.Points[0].X);
        Assert.Equal(241.4016, imperial.Points[0].Y, 4);
        Assert.Equal("Wh/mi", imperial.Unit);
    }

    // ── Temperature-stats grid (web DrivingTemperatureStats) ─────────────────────────────────────────

    [Fact]
    public void Temperature_stats_is_empty_when_neither_cabin_side_reported()
    {
        var section = Project(DrivingTabModel.Empty).TemperatureStats;

        Assert.False(section.HasData);
        Assert.Equal("Temperature Stats", section.Title);
        Assert.Equal("No temperature stats", section.EmptyMessage);
        Assert.All(section.Cards, c => Assert.Equal(EmDash, c.Value));
    }

    [Fact]
    public void Temperature_stats_converts_celsius_to_the_display_unit()
    {
        var metric = Project(DrivingTabModel.Ready(Populated())).TemperatureStats;
        var imperial = Project(DrivingTabModel.Ready(Populated()), UnitPref.Imperial).TemperatureStats;

        Assert.True(metric.HasData);
        Assert.Equal(6, metric.Cards.Count);
        // temperature.inside.min = 10 °C → 10.0 °C, or 50.0 °F.
        Assert.Equal("10.0", metric.Cards[0].Value);
        Assert.Equal("\u00B0C", metric.Cards[0].Unit);
        Assert.Equal("50.0", imperial.Cards[0].Value);
        Assert.Equal("\u00B0F", imperial.Cards[0].Unit);
    }

    [Fact]
    public void Temperature_stats_em_dashes_only_the_absent_side()
    {
        var analytics = Populated() with { Temperature = new DriveTemperature(new DriveStat(10, 21, 30), null) };

        var cards = Project(DrivingTabModel.Ready(analytics)).TemperatureStats.Cards;

        Assert.Equal("10.0", cards[0].Value);   // inside present
        Assert.Equal(EmDash, cards[3].Value);    // outside min absent
        Assert.Equal(EmDash, cards[5].Value);    // outside max absent
    }

    // ── Accessibility: every surface exposes Narrator names ──────────────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(DrivingTabModel.Pending),
                Project(new DrivingTabModel(DriveLoadPhase.Error, null)),
                Project(DrivingTabModel.Empty),
                Project(DrivingTabModel.Ready(Populated())),
                Project(new DrivingTabModel(DriveLoadPhase.Stale, Populated())),
                Project(new DrivingTabModel(DriveLoadPhase.Offline, Populated())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Every_chart_section_and_metric_card_exposes_an_automation_name()
    {
        var display = Project(DrivingTabModel.Ready(Populated()));

        Assert.All(display.Charts, c => Assert.False(string.IsNullOrWhiteSpace(c.AutomationName)));
        Assert.All(display.PerformanceCards.Cards, c => Assert.False(string.IsNullOrWhiteSpace(c.AutomationName)));
        Assert.All(display.TemperatureStats.Cards, c => Assert.False(string.IsNullOrWhiteSpace(c.AutomationName)));
    }

    [Fact]
    public void Card_automation_name_includes_the_label_value_and_unit()
    {
        var card = Project(DrivingTabModel.Ready(Populated())).PerformanceCards.Cards[0];

        Assert.Equal("Top Speed: 200 km/h", card.AutomationName);
    }

    [Fact]
    public void Ready_chart_section_accessible_summary_names_the_series()
    {
        var section = Chart(Project(DrivingTabModel.Ready(Populated())), "speedDist");

        Assert.Contains("Speed Distribution", section.AccessibleSummary, StringComparison.Ordinal);
        Assert.Contains("Trips", section.AccessibleSummary, StringComparison.Ordinal);
    }

    [Fact]
    public void Loading_automation_name_carries_the_loading_label()
    {
        var display = Project(DrivingTabModel.Pending);

        Assert.Contains("Loading", display.AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=DrivingTab, PII-safe ──────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new DrivingTabDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DrivingTab", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_drive_metrics()
    {
        var captured = new List<string>();
        var diagnostics = new DrivingTabDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("200", line, StringComparison.Ordinal);
        Assert.Equal("view.opened slug=DrivingTab", line);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("DrivingTab", DrivingTabRegistration.Slug);
    }
}
