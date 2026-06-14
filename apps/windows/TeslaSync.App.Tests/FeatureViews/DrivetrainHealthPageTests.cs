using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Driving;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DrivetrainHealthPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/driving/pages/DrivetrainHealthPage.tsx), the five-source snapshot parsing, the four-state
/// matrix (loading / empty / error / success), the recent-drive <c>chartData</c> / <c>peakPower</c> /
/// <c>avgPowerMax</c> aggregates, the four temperature sensors, the <c>motorChartData</c> series, the
/// conditional live-motor gate, the twelve child models / snapshots, and the three required i18n keys
/// (<c>drivetrain.title</c> / <c>drivetrain.subtitle</c> / <c>drivetrain.noData</c>). The WinUI view is
/// exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="DrivetrainHealthDisplay"/> flags asserted here.
/// </summary>
public sealed class DrivetrainHealthPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The three i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "drivetrain.noData",
        "drivetrain.subtitle",
        "drivetrain.title",
    ];

    private static DrivetrainHealthPageModel Model(
        DrivetrainHealthPageData data, bool loading = false, string? err = null) =>
        new(data, loading, err);

    private static DrivetrainHealthDisplay Project(DrivetrainHealthPageModel model) =>
        DrivetrainHealthProjection.Project(model, UnitPref.Metric, Localizer, Now);

    private static DrivetrainHealthPageData Health(
        DrivetrainHealth overall = DrivetrainHealth.Good,
        double? front = 70,
        double? rear = 72,
        double? inverter = 55,
        double? battery = 30,
        string motorStatus = "Drive",
        IReadOnlyList<DrivetrainDriveSample>? drives = null,
        DrivetrainStatsSlice? stats = null,
        IReadOnlyList<DrivetrainMotorSample>? motor = null,
        TeslaSync.App.FeatureViews.MotorLiveReading? motorLatest = null) =>
        new(
            true,
            front,
            rear,
            inverter,
            battery,
            motorStatus,
            overall,
            drives ?? Array.Empty<DrivetrainDriveSample>(),
            stats,
            motor ?? Array.Empty<DrivetrainMotorSample>(),
            motorLatest);

    // ── Four data states (the parity matrix) ────────────────────────────────────────────────────────────

    [Fact]
    public void State_loading_when_query_in_flight_with_no_data()
    {
        var display = Project(Model(DrivetrainHealthPageData.Empty, loading: true));

        Assert.Equal(DrivetrainHealthPageState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_empty_when_no_health_body()
    {
        var display = Project(Model(DrivetrainHealthPageData.Empty));

        Assert.Equal(DrivetrainHealthPageState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_error_when_feed_failed()
    {
        var display = Project(Model(DrivetrainHealthPageData.Empty, err: "network down"));

        Assert.Equal(DrivetrainHealthPageState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_health_present()
    {
        var display = Project(Model(Health()));

        Assert.Equal(DrivetrainHealthPageState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    [Fact]
    public void Error_precedes_empty_when_both_apply()
    {
        var display = Project(Model(DrivetrainHealthPageData.Empty, err: "boom"));

        Assert.Equal(DrivetrainHealthPageState.Error, display.State);
    }

    // ── Three required i18n keys (resolved through the facade, web key names) ──────────────────────────────

    [Fact]
    public void Resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();
        DrivetrainHealthProjection.Project(Model(Health()), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.RequestedKeys);
        }
    }

    [Fact]
    public void Page_chrome_uses_the_drivetrain_strings()
    {
        var display = Project(Model(Health()));

        Assert.Equal("Drivetrain Health", display.Title);
        Assert.Equal("Motor, inverter, and battery thermal status", display.Subtitle);
        Assert.Equal("No drivetrain health data available yet", display.EmptyMessage);
    }

    // ── Twelve child regions (every web region reproduced) ────────────────────────────────────────────────

    [Fact]
    public void Success_builds_every_child_model()
    {
        var display = Project(Model(Health(
            drives: [Drive(Now.AddDays(-1), avgPowerW: 30_000, outsideTempC: 18)],
            stats: new DrivetrainStatsSlice(42, 1234, 55, 160, 0.32, 5000, 12),
            motor: [Motor(Now.AddDays(-1), front: 80, rear: 82, inverter: 60, torqueFront: 410)])));

        // Model-driven children are in their resolved (Ready) state.
        Assert.Equal(HealthOverviewState.Ready, display.HealthOverview.Status);
        Assert.Equal(HealthGaugeGridState.Ready, display.HealthGaugeGrid.Status);
        Assert.Equal(TemperatureGaugesState.Ready, display.TemperatureGauges.Status);
        Assert.Equal(ThermalLoadPanelState.Ready, display.ThermalLoadPanel.Status);

        // Four temperature sensors (web sensors useMemo: front / rear / inverter / battery).
        Assert.Equal(4, display.TemperatureGauges.Sensors.Count);
        Assert.Equal(4, display.HealthGaugeGrid.SensorValues.Count);

        // Charts carry the projected series.
        Assert.False(display.StatorTempChart.Loading);
        Assert.Single(display.StatorTempChart.Samples);
        Assert.Single(display.TemperatureTrendChart.Samples);
        Assert.Equal(PowerOutputPhase.Ready, display.PowerOutputChart.Phase);
        Assert.Single(display.PowerOutputChart.Data);

        // Source-driven snapshots carry the page data.
        Assert.Single(display.TorqueSamples);
        Assert.Equal(DrivetrainHealthStatus.Good, display.TemperatureMetricCards.OverallHealth);
        Assert.Equal(DrivetrainHealth.Good, display.HealthRecommendations.OverallHealth);
        Assert.NotNull(display.DetailCards.Stats);
    }

    [Fact]
    public void Health_score_follows_the_web_HEALTH_SCORE_map()
    {
        Assert.Equal(95, Project(Model(Health(DrivetrainHealth.Good))).HealthOverview.HealthScore);
        Assert.Equal(60, Project(Model(Health(DrivetrainHealth.Warning))).HealthOverview.HealthScore);
        Assert.Equal(25, Project(Model(Health(DrivetrainHealth.Critical))).HealthOverview.HealthScore);
    }

    // ── Live-motor gate (web {motorLatest && <LiveMotorStatus/>}) ──────────────────────────────────────────

    [Fact]
    public void Live_motor_is_hidden_when_no_reading()
    {
        var display = Project(Model(Health()));

        Assert.False(display.ShowLiveMotor);
        Assert.Null(display.MotorLatest);
    }

    [Fact]
    public void Live_motor_is_shown_when_a_reading_is_present()
    {
        var reading = new TeslaSync.App.FeatureViews.MotorLiveReading(
            "D", 42, 5, "telemetry", 1200, 1180, 410, 400, 80, 82, 60, 30);
        var display = Project(Model(Health(motorLatest: reading)));

        Assert.True(display.ShowLiveMotor);
        Assert.NotNull(display.MotorLatest);
    }

    // ── Recent-drive aggregates (web chartData / peakPower / avgPowerMax memos) ────────────────────────────

    [Fact]
    public void Power_summary_aggregates_the_windowed_drives()
    {
        var display = Project(Model(Health(drives:
        [
            Drive(Now.AddDays(-2), avgPowerW: 30_000),
            Drive(Now.AddDays(-1), avgPowerW: 50_000),
        ])));

        // peak = max(powerMax) = 50 kW, avg = mean(30, 50) = 40 kW; minRegen always 0 (web powerMin: 0).
        Assert.Equal(50, display.DetailCards.Power.PeakKw);
        Assert.Equal(40, display.DetailCards.Power.AvgKw);
        Assert.Equal(0, display.DetailCards.Power.MinRegenKw);
        Assert.Equal(50, display.TemperatureMetricCards.PeakPowerKw);
        Assert.Equal(2, display.PowerOutputChart.Data.Count);
    }

    [Fact]
    public void Drives_outside_the_window_are_excluded()
    {
        var display = Project(Model(Health(drives:
        [
            Drive(Now.AddDays(-60), avgPowerW: 99_000),
            Drive(Now.AddDays(-1), avgPowerW: 20_000),
        ])));

        Assert.Single(display.PowerOutputChart.Data);
        Assert.Equal(20, display.DetailCards.Power.PeakKw);
    }

    [Fact]
    public void Temperature_trend_keeps_only_points_with_an_outside_reading()
    {
        var display = Project(Model(Health(drives:
        [
            Drive(Now.AddDays(-2), avgPowerW: 10_000, outsideTempC: null),
            Drive(Now.AddDays(-1), avgPowerW: 10_000, outsideTempC: 21),
        ])));

        Assert.Single(display.TemperatureTrendChart.Samples);
        Assert.Equal(21, display.TemperatureTrendChart.Samples[0].OutsideTempC);
    }

    // ── Five-source snapshot parsing (the client feed's tolerant readers) ──────────────────────────────────

    [Fact]
    public void Compose_parses_the_health_body_and_gates_success()
    {
        var data = Parse(
            health: """{"front_motor_temp_c":70,"rear_motor_temp_c":72,"inverter_temp_c":55,"battery_temp_c":30,"motor_status":"Drive","overall_health":"warning"}""",
            drives: "[]",
            stats: "null",
            motor: "[]",
            motorLatest: "null");

        Assert.True(data.HasHealth);
        Assert.Equal(70, data.FrontMotorTempC);
        Assert.Equal(DrivetrainHealth.Warning, data.OverallHealth);
        Assert.Equal("Drive", data.MotorStatus);
        Assert.Equal(DrivetrainHealthPageState.Success, Project(Model(data)).State);
    }

    [Fact]
    public void Compose_treats_a_null_health_body_as_empty()
    {
        var data = Parse("null", "[]", "null", "[]", "null");

        Assert.False(data.HasHealth);
        Assert.Equal(DrivetrainHealthPageState.Empty, Project(Model(data)).State);
    }

    [Fact]
    public void Compose_parses_drives_stats_motor_and_live_reading()
    {
        var data = Parse(
            health: """{"overall_health":"good"}""",
            drives: """[{"start_ts":"2026-06-11T10:00:00Z","distance_m":12000,"avg_power_w":24000,"outside_temp_avg_c":19}]""",
            stats: """{"total_drives":7,"total_distance_km":900,"avg_speed_kmh":50,"top_speed_kmh":120,"regen_ratio":0.3,"regen_energy_wh":4000,"co2_saved_kg":9}""",
            motor: """[{"ts":"2026-06-11T10:05:00Z","motor_temp_c_front":81,"motor_temp_c_rear":83,"inverter_temp_c":61,"torque_nm_front":405}]""",
            motorLatest: """{"power_kw":40,"regen_kw":3,"motor_temp_c_front":80,"inverter_temp_c":60,"battery_temp_c":31}""");

        Assert.Single(data.Drives);
        Assert.Equal(24000, data.Drives[0].AvgPowerW);
        Assert.NotNull(data.Stats);
        Assert.Equal(7, data.Stats!.TotalDrives);
        Assert.Single(data.MotorHistory);
        Assert.Equal(405, data.MotorHistory[0].TorqueNmFront);
        Assert.NotNull(data.MotorLatest);
        Assert.Equal(40, data.MotorLatest!.PowerKw);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

    private static DrivetrainDriveSample Drive(
        DateTimeOffset start, double avgPowerW, double? outsideTempC = 20, double distanceM = 50_000) =>
        new(start, distanceM, outsideTempC, avgPowerW);

    private static DrivetrainMotorSample Motor(
        DateTimeOffset ts, double? front, double? rear, double? inverter, double? torqueFront) =>
        new(ts.ToString("O"), front, rear, inverter, torqueFront, null);

    private static DrivetrainHealthPageData Parse(
        string health, string drives, string stats, string motor, string motorLatest)
    {
        using var h = JsonDocument.Parse(health);
        using var d = JsonDocument.Parse(drives);
        using var s = JsonDocument.Parse(stats);
        using var m = JsonDocument.Parse(motor);
        using var l = JsonDocument.Parse(motorLatest);
        return DrivetrainHealthPageData.Compose(
            h.RootElement, d.RootElement, s.RootElement, m.RootElement, l.RootElement);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> RequestedKeys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }
}
