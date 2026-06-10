using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>HealthGaugeGrid</c> feature surface's UI-thread-free logic — the per-state
/// branch projection (loading / ready / empty / error / stale / offline), the web <c>RadialGauge</c> clamp +
/// integer-precision readout and 0..1 sweep, the web <c>HEALTH_COLOR</c> → semantic-status mapping, the
/// first-letter capitalisation of the overall-health token, the active-sensor count, the SI → display drive-stat
/// conversion + <c>fmtInt</c> / <c>fmtNumber</c> formatting, the inline drive-stats skeleton fallback, the
/// freshness chip copy, the accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/drivetrain-health/HealthGaugeGrid.tsx). The WinUI view itself
/// (HealthGaugeGrid.cs) is exercised by the app build.
/// </summary>
public sealed class HealthGaugeGridTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static IReadOnlyList<double?> Sensors(params double?[] values) => values;

    private static HealthGaugeDriveStats Stats(
        double drives = 1234,
        double distanceKm = 50000,
        double avgKmh = 10,
        double topKmh = 30) =>
        new(drives, distanceKm, avgKmh, topKmh);

    private static HealthGaugeGridModel ReadyModel(
        DrivetrainHealthStatus health = DrivetrainHealthStatus.Good,
        double score = 95,
        string motor = "Driving",
        IReadOnlyList<double?>? sensors = null,
        HealthGaugeDriveStats? stats = null,
        UnitPref? units = null) =>
        HealthGaugeGridModel.Ready(
            health, score, motor, sensors ?? Sensors(40d, null, 55d, null), stats ?? Stats(), units);

    private static HealthGaugeGridDisplay Project(HealthGaugeGridModel model) =>
        HealthGaugeGridProjection.Project(model, Localizer);

    // ── Branch precedence: loading → error → empty → freshness → ready ─────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(HealthGaugeGridState.Loading, Project(HealthGaugeGridModel.Loading()).State);

    [Fact]
    public void Error_when_model_failed() =>
        Assert.Equal(HealthGaugeGridState.Error, Project(HealthGaugeGridModel.Failed()).State);

    [Fact]
    public void Empty_when_model_is_empty() =>
        Assert.Equal(HealthGaugeGridState.Empty, Project(HealthGaugeGridModel.Empty()).State);

    [Fact]
    public void Ready_when_model_is_ready() =>
        Assert.Equal(HealthGaugeGridState.Ready, Project(ReadyModel()).State);

    [Fact]
    public void Stale_keeps_its_branch()
    {
        var model = HealthGaugeGridModel.Stale(
            DrivetrainHealthStatus.Warning, 60, "Parked", Sensors(40d), Stats());
        Assert.Equal(HealthGaugeGridState.Stale, Project(model).State);
    }

    [Fact]
    public void Offline_keeps_its_branch()
    {
        var model = HealthGaugeGridModel.Offline(
            DrivetrainHealthStatus.Critical, 25, "Parked", Sensors(40d), Stats());
        Assert.Equal(HealthGaugeGridState.Offline, Project(model).State);
    }

    // ── Gauge: web HEALTH_COLOR → semantic severity ────────────────────────────────────────────────────────

    [Theory]
    [InlineData(DrivetrainHealthStatus.Good, StatusKind.Success)]
    [InlineData(DrivetrainHealthStatus.Warning, StatusKind.Warning)]
    [InlineData(DrivetrainHealthStatus.Critical, StatusKind.Danger)]
    public void Status_maps_to_the_web_health_colour(DrivetrainHealthStatus health, StatusKind expected)
    {
        Assert.Equal(expected, HealthGaugeGridProjection.StatusFor(health));
        Assert.Equal(expected, Project(ReadyModel(health: health)).Gauge.Severity);
    }

    // ── Gauge: web RadialGauge clamp / sweep / precision ───────────────────────────────────────────────────

    [Fact]
    public void Gauge_renders_integer_score_with_no_decimals_and_percent_unit()
    {
        var gauge = Project(ReadyModel(score: 95)).Gauge;

        Assert.Equal("95", gauge.ValueText);
        Assert.Equal("%", gauge.UnitLabel);
        Assert.Equal(0.95, gauge.Fraction, 3);
    }

    [Fact]
    public void Gauge_clamps_value_and_sweep_to_max_like_the_web()
    {
        var gauge = Project(ReadyModel(score: 120)).Gauge;

        Assert.Equal("100", gauge.ValueText);
        Assert.Equal(1.0, gauge.Fraction, 3);
    }

    [Fact]
    public void Gauge_clamps_negative_value_to_zero()
    {
        var gauge = Project(ReadyModel(score: -10)).Gauge;

        Assert.Equal("0", gauge.ValueText);
        Assert.Equal(0.0, gauge.Fraction, 3);
    }

    [Fact]
    public void Gauge_non_integer_uses_the_default_global_precision()
    {
        // web RadialGauge: Number.isInteger(clamped) ? 0 : getGlobalPrecision() (default 2).
        var gauge = Project(ReadyModel(score: 87.5)).Gauge;

        Assert.Equal("87.50", gauge.ValueText);
        Assert.Equal(0.875, gauge.Fraction, 3);
    }

    [Fact]
    public void Gauge_precision_honours_a_host_override()
    {
        var oneDecimal = UnitPref.Metric with { Precision = 1 };
        var gauge = Project(ReadyModel(score: 87.5, units: oneDecimal)).Gauge;

        Assert.Equal("87.5", gauge.ValueText);
    }

    [Fact]
    public void Gauge_label_and_description_resolve_from_the_facade()
    {
        var gauge = Project(ReadyModel()).Gauge;

        Assert.Equal("Health Score", gauge.Label);
        Assert.Equal("Overall drivetrain condition rating", gauge.Description);
    }

    // ── Motor details panel ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Motor_details_render_the_web_rows_in_order()
    {
        var display = Project(ReadyModel(
            health: DrivetrainHealthStatus.Good, score: 95, motor: "Driving",
            sensors: Sensors(40d, null, 55d, null)));

        Assert.Equal("Motor Details", display.MotorDetailsTitle);
        Assert.Collection(
            display.MotorDetails,
            r => AssertRow(r, "Motor Status", "Driving"),
            r => AssertRow(r, "Overall Health", "Good"),
            r => AssertRow(r, "Health Score", "95%"),
            r => AssertRow(r, "Active Sensors", "2"));
    }

    [Theory]
    [InlineData(DrivetrainHealthStatus.Good, "Good")]
    [InlineData(DrivetrainHealthStatus.Warning, "Warning")]
    [InlineData(DrivetrainHealthStatus.Critical, "Critical")]
    public void Overall_health_value_capitalises_the_status_token(DrivetrainHealthStatus health, string expected)
    {
        Assert.Equal(expected, HealthGaugeGridProjection.OverallHealthLabel(health));

        var row = Project(ReadyModel(health: health)).MotorDetails[1];
        Assert.Equal(expected, row.Value);
    }

    [Fact]
    public void Health_score_row_uses_the_raw_prop_value_not_the_clamped_gauge_readout()
    {
        // web: `${healthScore}%` interpolates the raw prop, while the gauge clamps to [0, 100].
        var display = Project(ReadyModel(score: 120));

        Assert.Equal("120%", display.MotorDetails[2].Value);
        Assert.Equal("100", display.Gauge.ValueText);
    }

    public static IEnumerable<object[]> SensorCases()
    {
        yield return new object[] { new double?[] { 40d, null, 55d, null }, "2" };
        yield return new object[] { new double?[] { 40d, 50d, 55d, 60d }, "4" };
        yield return new object[] { new double?[] { null, null }, "0" };
        yield return new object[] { Array.Empty<double?>(), "0" };
    }

    [Theory]
    [MemberData(nameof(SensorCases))]
    public void Active_sensor_count_matches_the_web_filter(double?[] sensors, string expected)
    {
        var display = Project(ReadyModel(sensors: sensors));
        Assert.Equal(expected, display.MotorDetails[3].Value);
    }

    [Fact]
    public void Real_time_caption_resolves_from_the_facade() =>
        Assert.Equal("Real-time telemetry active", Project(ReadyModel()).RealTimeText);

    // ── Drive statistics panel: SI → display conversion + formatting ───────────────────────────────────────

    [Fact]
    public void Drive_stats_render_metric_rows_like_the_web()
    {
        var display = Project(ReadyModel(stats: Stats(drives: 1234, distanceKm: 50000, avgKmh: 10, topKmh: 30)));

        Assert.Equal("Drive Statistics", display.DriveStatsTitle);
        Assert.False(display.ShowDriveStatsSkeleton);
        Assert.Collection(
            display.DriveStats,
            r => AssertRow(r, "Total Drives", "1,234"),
            r => AssertRow(r, "Total Distance", "50 km"),
            r => AssertRow(r, "Avg Speed", "36.0 km/h"),
            r => AssertRow(r, "Top Speed", "108.0 km/h"));
    }

    [Fact]
    public void Drive_stats_convert_to_imperial_like_the_web()
    {
        var display = Project(ReadyModel(
            stats: Stats(drives: 1234, distanceKm: 50000, avgKmh: 10, topKmh: 30), units: UnitPref.Imperial));

        Assert.Collection(
            display.DriveStats,
            r => AssertRow(r, "Total Drives", "1,234"),
            r => AssertRow(r, "Total Distance", "31 mi"),
            r => AssertRow(r, "Avg Speed", "22.4 mph"),
            r => AssertRow(r, "Top Speed", "67.1 mph"));
    }

    [Fact]
    public void Drive_stats_feed_the_raw_web_value_through_the_shared_converters()
    {
        // Parity guard: the web passes stats.totalDistanceKm / stats.avgSpeedKmh straight into
        // convertDistanceFromSI / convertSpeedFromSI, so the native port must reproduce the same numbers.
        var stats = Stats(distanceKm: 1609.344, avgKmh: 1);
        var metric = Project(ReadyModel(stats: stats)).DriveStats;
        var imperial = Project(ReadyModel(stats: stats, units: UnitPref.Imperial)).DriveStats;

        Assert.Equal("2 km", metric[1].Value);             // 1609.344 m → 1.609 km → fmtInt → "2"
        Assert.Equal("1 mi", imperial[1].Value);           // 1609.344 m → exactly 1 mi
        Assert.Equal("3.6 km/h", metric[2].Value);         // 1 m/s → 3.6 km/h
        Assert.Equal("2.2 mph", imperial[2].Value);        // 1 m/s → 2.237 mph → "2.2"
    }

    [Fact]
    public void Drive_stats_show_the_inline_skeleton_when_stats_are_null()
    {
        var model = HealthGaugeGridModel.Ready(
            DrivetrainHealthStatus.Good, 95, "Driving", Sensors(40d, null), stats: null);
        var display = Project(model);

        Assert.True(display.ShowDriveStatsSkeleton);
        Assert.Empty(display.DriveStats);
        // The rest of the grid still renders (the web only skeletons the drive-stats panel).
        Assert.Equal("95", display.Gauge.ValueText);
        Assert.NotEmpty(display.MotorDetails);
    }

    [Fact]
    public void Drive_stats_render_when_stats_are_present()
    {
        var display = Project(ReadyModel(stats: Stats()));

        Assert.False(display.ShowDriveStatsSkeleton);
        Assert.Equal(4, display.DriveStats.Count);
    }

    // ── Freshness chip ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Ready_has_no_freshness_chip() =>
        Assert.False(Project(ReadyModel()).ShowFreshnessChip);

    [Fact]
    public void Stale_shows_a_warning_stale_chip()
    {
        var display = Project(HealthGaugeGridModel.Stale(
            DrivetrainHealthStatus.Warning, 60, "Parked", Sensors(40d), Stats()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Stale", display.FreshnessChipText);
        Assert.Equal(StatusKind.Warning, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_shows_a_danger_offline_chip()
    {
        var display = Project(HealthGaugeGridModel.Offline(
            DrivetrainHealthStatus.Critical, 25, "Parked", Sensors(40d), Stats()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Offline", display.FreshnessChipText);
        Assert.Equal(StatusKind.Danger, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_keeps_the_cached_grid()
    {
        var display = Project(HealthGaugeGridModel.Offline(
            DrivetrainHealthStatus.Good, 95, "Driving", Sensors(40d, null, 55d, null), Stats()));

        Assert.Equal("95", display.Gauge.ValueText);
        Assert.Equal("Driving", display.MotorDetails[0].Value);
        Assert.Equal("50 km", display.DriveStats[1].Value);
    }

    // ── Fixed copy (loading / empty / error / retry) ───────────────────────────────────────────────────────

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(HealthGaugeGridModel.Loading()).LoadingLabel);

    [Fact]
    public void Empty_message_is_a_drivetrain_specific_string() =>
        Assert.Equal("No drivetrain data", Project(HealthGaugeGridModel.Empty()).EmptyMessage);

    [Fact]
    public void Error_title_is_resolved() =>
        Assert.Equal("Couldn't load drivetrain health", Project(HealthGaugeGridModel.Failed()).ErrorTitle);

    [Fact]
    public void Error_message_falls_back_to_the_default_when_none_supplied() =>
        Assert.Equal(
            "We couldn't load the drivetrain health. Please try again.",
            Project(HealthGaugeGridModel.Failed()).ErrorMessage);

    [Fact]
    public void Error_message_uses_the_supplied_message() =>
        Assert.Equal(
            "Network unreachable",
            Project(HealthGaugeGridModel.Failed("Network unreachable")).ErrorMessage);

    [Fact]
    public void Retry_label_uses_the_shared_common_retry_string() =>
        Assert.Equal("Retry", Project(HealthGaugeGridModel.Failed()).RetryLabel);

    // ── Accessibility: every state exposes a meaningful Narrator name ──────────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(HealthGaugeGridModel.Loading()),
                Project(HealthGaugeGridModel.Empty()),
                Project(HealthGaugeGridModel.Failed()),
                Project(HealthGaugeGridModel.Stale(DrivetrainHealthStatus.Warning, 60, "Parked", Sensors(40d), Stats())),
                Project(HealthGaugeGridModel.Offline(DrivetrainHealthStatus.Critical, 25, "Parked", Sensors(40d), Stats())),
                Project(ReadyModel()),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_pairs_the_title_and_loading_label() =>
        Assert.Equal("Health Score. Loading", Project(HealthGaugeGridModel.Loading()).AutomationName);

    [Fact]
    public void Empty_automation_name_pairs_the_title_and_empty_message() =>
        Assert.Equal("Health Score. No drivetrain data", Project(HealthGaugeGridModel.Empty()).AutomationName);

    [Fact]
    public void Error_automation_name_pairs_the_title_and_error_title() =>
        Assert.Equal(
            "Health Score. Couldn't load drivetrain health",
            Project(HealthGaugeGridModel.Failed()).AutomationName);

    [Fact]
    public void Gauge_automation_name_carries_label_and_value() =>
        Assert.Equal("Health Score, 95%", Project(ReadyModel(score: 95)).Gauge.AutomationName);

    [Fact]
    public void Ready_automation_name_carries_the_gauge_panel_titles_and_rows()
    {
        var display = Project(ReadyModel());

        Assert.Contains(display.Gauge.AutomationName, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.MotorDetailsTitle, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.DriveStatsTitle, display.AutomationName, StringComparison.Ordinal);
        foreach (var row in display.MotorDetails)
        {
            Assert.Contains($"{row.Label}: {row.Value}", display.AutomationName, StringComparison.Ordinal);
        }

        foreach (var row in display.DriveStats)
        {
            Assert.Contains($"{row.Label}: {row.Value}", display.AutomationName, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Ready_automation_name_announces_loading_for_the_drive_stats_skeleton()
    {
        var model = HealthGaugeGridModel.Ready(
            DrivetrainHealthStatus.Good, 95, "Driving", Sensors(40d), stats: null);
        var display = Project(model);

        Assert.Contains(display.DriveStatsTitle, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.LoadingLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Stale_automation_name_includes_the_chip() =>
        Assert.Contains(
            "Stale",
            Project(HealthGaugeGridModel.Stale(DrivetrainHealthStatus.Warning, 60, "Parked", Sensors(40d), Stats()))
                .AutomationName,
            StringComparison.Ordinal);

    // ── Diagnostics (P1/S11): view.opened slug=HealthGaugeGrid, PII-safe ───────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new HealthGaugeGridDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=HealthGaugeGrid", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_drivetrain_telemetry()
    {
        var captured = new List<string>();
        var diagnostics = new HealthGaugeGridDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=HealthGaugeGrid", line);
        Assert.DoesNotContain("95", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Driving", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("HealthGaugeGrid", HealthGaugeGridRegistration.Slug);

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => HealthGaugeGridProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => HealthGaugeGridProjection.Project(HealthGaugeGridModel.Loading(), null!));

    [Fact]
    public void Ready_rejects_a_null_motor_status() =>
        Assert.Throws<ArgumentNullException>(
            () => HealthGaugeGridModel.Ready(DrivetrainHealthStatus.Good, 95, null!, Sensors(40d), Stats()));

    [Fact]
    public void Ready_rejects_a_null_sensor_list() =>
        Assert.Throws<ArgumentNullException>(
            () => HealthGaugeGridModel.Ready(DrivetrainHealthStatus.Good, 95, "Driving", null!, Stats()));

    [Fact]
    public void Active_sensor_count_rejects_a_null_list() =>
        Assert.Throws<ArgumentNullException>(() => HealthGaugeGridProjection.ActiveSensorCount(null!));

    private static void AssertRow(HealthKeyValue row, string label, string value)
    {
        Assert.Equal(label, row.Label);
        Assert.Equal(value, row.Value);
    }
}
