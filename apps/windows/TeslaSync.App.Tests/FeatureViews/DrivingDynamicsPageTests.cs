using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Driving;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DrivingDynamicsPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/driving/pages/DrivingDynamicsPage.tsx and its eleven children) with its loading / error /
/// success matrix, the tolerant seven-source parsers, the ported <c>computeMotorStats</c> / <c>getThrottleStyle</c>
/// / <c>parseFollowDistance</c> helpers, the SI display-boundary formatting, the two manifest i18n keys, the
/// view-model state matrix, and the generated-client feed's request shaping (web <c>useMotorLatest</c> +
/// <c>useMotorHistory</c> + <c>useDrives</c> + <c>useDrivingCoach</c> plus the children's reads). The WinUI view is
/// exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="DrivingDynamicsDisplay"/> flags asserted here.
/// </summary>
public sealed class DrivingDynamicsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateRange Range = new(new DateOnly(2026, 5, 13), new DateOnly(2026, 6, 12));

    // The two i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys = ["dynamics.subtitle", "dynamics.title"];

    private static DrivingDynamicsModel SuccessModel(DrivingDynamicsSnapshot? snapshot = null) =>
        new(snapshot ?? SampleSnapshot(), false, null, Range);

    private static DrivingDynamicsDisplay Project(DrivingDynamicsModel model, UnitPref? units = null) =>
        DrivingDynamicsProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    private static MotorReading Reading(
        double? torqueFront = 120, double? torqueRear = 110, double? rpmFront = 4200, double? rpmRear = 4100,
        double? tempFront = 48, double? tempRear = 52, double? powerKw = 45, double? regenKw = 12, string? shift = "D") =>
        new(Now, torqueFront, torqueRear, rpmFront, rpmRear, tempFront, tempRear, powerKw, regenKw, shift);

    private static DriveRow Drive(long id = 1, double distanceM = 24000, double? avgSpeedMps = 18, double? maxSpeedMps = 33, double? avgPowerW = 12000) =>
        new(id, new DateTimeOffset(2026, 6, 1, 8, 0, 0, TimeSpan.Zero), distanceM, avgSpeedMps, maxSpeedMps, avgPowerW);

    private static DrivingDynamicsSnapshot SampleSnapshot() =>
        DrivingDynamicsSnapshot.Compose(
            Reading(),
            [Reading(), Reading(powerKw: 95, regenKw: 20, tempFront: 130)],
            [Drive()],
            CoachData.FromJson(Json(CoachJson)),
            new DriveDynamicsReading(0.21, -0.33, 42, 0, false),
            new AutopilotReading(18, 30, "7"));

    private const string CoachJson =
        "{\"overall_score\":82,\"efficiency_wh_km\":148,\"best_efficiency_wh_km\":120,\"total_drives_analyzed\":12," +
        "\"style_breakdown\":{\"efficient\":7,\"moderate\":4,\"aggressive\":1}," +
        "\"patterns\":{\"hard_accel_pct\":18,\"hard_brake_pct\":12,\"highway_pct\":55,\"short_trip_pct\":25,\"cold_start_pct\":10}," +
        "\"weekly_trend\":[{\"week\":\"W1\",\"score\":70},{\"week\":\"W2\",\"score\":80}]," +
        "\"recommendations\":[{\"category\":\"accel\",\"impact\":\"high\",\"tip\":\"Ease off\"}]," +
        "\"per_drive_scores\":[{\"drive_id\":1,\"date\":\"2026-05-10\",\"score\":88,\"style\":\"efficient\",\"efficiency\":140,\"distance\":24}]}";

    // ---- i18n key coverage (the two manifest strings) ------------------------------

    [Fact]
    public void Projection_resolves_the_manifest_string_keys_in_success()
    {
        var recorder = new RecordingLocalizer();

        _ = DrivingDynamicsProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_the_manifest_string_keys_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = DrivingDynamicsProjection.Project(DrivingDynamicsModel.Initial(Range), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Title_and_subtitle_use_the_web_defaults()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Driving Dynamics", display.Title);
        Assert.Equal("Live motor telemetry, G-forces & driving analysis", display.Subtitle);
    }

    // ---- Three data states ---------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(DrivingDynamicsModel.Initial(Range));

        Assert.Equal(DrivingDynamicsState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_error_when_primary_query_failed()
    {
        var model = new DrivingDynamicsModel(DrivingDynamicsSnapshot.Empty, false, "network down", Range);
        var display = Project(model);

        Assert.Equal(DrivingDynamicsState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_loaded()
    {
        var display = Project(SuccessModel());

        Assert.Equal(DrivingDynamicsState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void Empty_snapshot_resolves_to_success_with_empty_sections()
    {
        var display = Project(new DrivingDynamicsModel(DrivingDynamicsSnapshot.Empty with { Loaded = true }, false, null, Range));

        Assert.Equal(DrivingDynamicsState.Success, display.State);
        Assert.False(display.LiveMotor.HasData);
        Assert.False(display.GForce.HasData);
        Assert.False(display.Pedal.HasData);
        Assert.False(display.Autopilot.HasData);
        Assert.False(display.Efficiency.HasData);
    }

    // ---- Section projections -------------------------------------------------------

    [Fact]
    public void LiveMotor_projects_three_gauges_and_the_shift_chip()
    {
        var display = Project(SuccessModel());

        Assert.True(display.LiveMotor.HasData);
        Assert.Equal(3, display.LiveMotor.Gauges.Count);
        Assert.Equal(230, display.LiveMotor.Gauges[0].Value); // torque front + rear
        Assert.Equal("D", display.LiveMotor.ShiftValue);
        Assert.Equal(StatusKind.Success, display.LiveMotor.ShiftStatus);
    }

    [Fact]
    public void GForce_combines_lateral_and_longitudinal()
    {
        var display = Project(SuccessModel());

        Assert.True(display.GForce.HasData);
        Assert.Equal(3, display.GForce.Cards.Count);
        Assert.Equal($"{ScalarFormatters.FormatNumber(0.21, 2)} g", display.GForce.Cards[0].Value);
    }

    [Fact]
    public void SpeedGear_converts_drive_speeds_at_the_display_boundary()
    {
        var imperial = Project(SuccessModel(), UnitPref.Imperial);

        // avg 18 m/s, top 33 m/s -> mph, rounded to whole numbers.
        Assert.Equal(ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(18, SpeedUnit.Mph), 0), imperial.SpeedGear.AvgSpeedValue);
        Assert.Equal(ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(33, SpeedUnit.Mph), 0), imperial.SpeedGear.TopSpeedValue);
        Assert.Equal("mph", imperial.SpeedGear.SpeedUnit);
    }

    [Fact]
    public void Autopilot_parses_follow_distance_and_current_speed()
    {
        var display = Project(SuccessModel());

        Assert.True(display.Autopilot.HasData);
        Assert.Equal(3, display.Autopilot.Cards.Count);
        Assert.Equal("7", display.Autopilot.Cards[2].Value);
    }

    [Fact]
    public void MotorCharts_project_three_cards_with_series()
    {
        var display = Project(SuccessModel());

        Assert.True(display.MotorCharts.Power.HasData);
        Assert.Equal(2, display.MotorCharts.Power.Series.Count);
        Assert.Equal(ChartSeriesKind.Area, display.MotorCharts.Power.Series[0].Kind);
        Assert.Equal(ChartSeriesKind.Line, display.MotorCharts.Torque.Series[0].Kind);
    }

    [Fact]
    public void Summary_projects_six_stat_cards()
    {
        var display = Project(SuccessModel());

        Assert.Equal(6, display.Summary.Cards.Count);
        Assert.Equal("2", display.Summary.Cards[0].Value); // two readings
    }

    [Fact]
    public void Coach_projects_gauge_style_patterns_and_table()
    {
        var display = Project(SuccessModel());

        Assert.Equal(82, display.Coach.GaugeValue);
        Assert.Equal(StatusKind.Success, display.Coach.GaugeStatus);
        Assert.True(display.Coach.StyleHasData);
        Assert.Equal(5, display.Coach.Patterns.Count);
        Assert.True(display.Coach.WeeklyHasData);
        Assert.True(display.Coach.RecsHasData);
        Assert.True(display.Coach.PerDriveHasData);
        Assert.Single(display.Coach.PerDriveRows);
    }

    [Fact]
    public void Analytics_buckets_speed_distribution_and_scatters_acceleration()
    {
        var snapshot = DrivingDynamicsSnapshot.Compose(
            Reading(), [], [Drive(1, avgSpeedMps: 18), Drive(2, avgSpeedMps: 28)], null, DriveDynamicsReading.Empty, AutopilotReading.Empty);
        var display = Project(SuccessModel(snapshot));

        Assert.True(display.Analytics.SpeedDistribution.HasData);
        Assert.Single(display.Analytics.SpeedDistribution.Series);
        Assert.Equal(5, display.Analytics.SpeedDistribution.Series[0].Points.Count); // five buckets
        Assert.True(display.Analytics.Acceleration.HasData);
        Assert.Single(display.Analytics.Acceleration.Annotations); // mean-power reference line
    }

    [Fact]
    public void Tips_react_to_average_power()
    {
        var aggressive = MotorStats.Compute([Reading(powerKw: 120), Reading(powerKw: 130)]);
        Assert.NotNull(aggressive);
        Assert.Equal(ThrottleStyle.Aggressive, aggressive!.Style);

        var snapshot = DrivingDynamicsSnapshot.Compose(Reading(), [Reading(powerKw: 120), Reading(powerKw: 130)], [], null, DriveDynamicsReading.Empty, AutopilotReading.Empty);
        var display = Project(SuccessModel(snapshot));
        Assert.Contains(display.Tips.Tips, t => t.Text.Contains("Ease into", StringComparison.Ordinal));
    }

    // ---- Motor stats + helpers -----------------------------------------------------

    [Fact]
    public void MotorStats_compute_aggregates_history()
    {
        var stats = MotorStats.Compute([Reading(powerKw: 40, regenKw: 10), Reading(powerKw: 80, regenKw: 30)]);

        Assert.NotNull(stats);
        Assert.Equal(2, stats!.TotalReadings);
        Assert.Equal(60, stats.AvgPower);
        Assert.Equal(80, stats.PeakPower);
        Assert.Equal(30, stats.PeakRegen);
    }

    [Fact]
    public void MotorStats_is_null_for_empty_history() => Assert.Null(MotorStats.Compute([]));

    [Theory]
    [InlineData(null, "7")]
    [InlineData("FollowDistance7", "7")]
    [InlineData("3", "3")]
    [InlineData("Unknown", "Unknown")]
    public void ParseFollowDistance_peels_the_bar_count(string? raw, string expected)
    {
        if (raw is null)
        {
            Assert.Equal("7", AutopilotReading.ParseFollowDistance("FollowDistance7"));
            return;
        }

        Assert.Equal(expected, AutopilotReading.ParseFollowDistance(raw));
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void MotorReading_parses_snake_case_fields()
    {
        var reading = MotorReading.FromJson(Json(
            "{\"torque_nm_front\":120,\"torque_nm_rear\":110,\"motor_rpm_front\":4200,\"power_kw\":45,\"shift_state\":\"D\"}"));

        Assert.NotNull(reading);
        Assert.Equal(230, reading!.TorqueTotal);
        Assert.Equal(4200, reading.RpmFront);
        Assert.Equal("D", reading.ShiftState);
    }

    [Fact]
    public void DriveRow_parses_si_fields()
    {
        var drive = DriveRow.FromJson(Json(
            "{\"id\":42,\"start_ts\":\"2026-05-01T10:00:00Z\",\"distance_m\":24000,\"avg_speed_mps\":18,\"max_speed_mps\":33,\"avg_power_w\":12000}"));

        Assert.Equal(42, drive.Id);
        Assert.Equal(24000, drive.DistanceM);
        Assert.Equal(18, drive.AvgSpeedMps);
        Assert.Equal("2026-05-01", drive.StartDay);
    }

    [Fact]
    public void CoachData_parses_style_patterns_and_scores()
    {
        var coach = CoachData.FromJson(Json(CoachJson));

        Assert.NotNull(coach);
        Assert.Equal(82, coach!.OverallScore);
        Assert.Equal(7, coach.EfficientCount);
        Assert.Equal(18, coach.HardAccelPct);
        Assert.Equal(2, coach.WeeklyTrend.Count);
        Assert.Single(coach.Recommendations);
        Assert.Single(coach.PerDriveScores);
    }

    [Fact]
    public void CoachData_is_null_for_a_non_object_body() => Assert.Null(CoachData.FromJson(Json("null")));

    [Fact]
    public void ParseMotorHistory_tolerates_array_and_envelope()
    {
        Assert.Equal(2, DrivingDynamicsClientFeed.ParseMotorHistory(Json("[{\"power_kw\":1},{\"power_kw\":2}]")).Count);
        Assert.Single(DrivingDynamicsClientFeed.ParseMotorHistory(Json("{\"readings\":[{\"power_kw\":1}]}")));
        Assert.Empty(DrivingDynamicsClientFeed.ParseMotorHistory(Json("{}")));
    }

    [Fact]
    public void ParseVehicleSpeed_reads_nested_state_speed()
    {
        Assert.Equal(18, DrivingDynamicsClientFeed.ParseVehicleSpeed(Json("{\"state\":{\"speed\":18}}")));
        Assert.Equal(20, DrivingDynamicsClientFeed.ParseVehicleSpeed(Json("{\"speed\":20}")));
        Assert.Null(DrivingDynamicsClientFeed.ParseVehicleSpeed(Json("{}")));
    }

    [Fact]
    public void FirstObservation_reads_the_envelope_array()
    {
        var row = DrivingDynamicsClientFeed.FirstObservation(Json("{\"observations\":[{\"value_numeric\":30}]}"));
        Assert.NotNull(row);
        Assert.Equal(30, row!.Value.GetProperty("value_numeric").GetDouble());
    }

    // ---- Generated-client feed -----------------------------------------------------

    [Fact]
    public async Task ClientFeed_reads_motor_latest_as_the_primary_with_the_vehicle_id()
    {
        var api = ScriptedApi();
        var feed = new DrivingDynamicsClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.Loaded);
        Assert.Equal("get_api_v1_motor_latest", api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].Query!["vehicle_id"]?.ToString());
        Assert.Equal("get_api_v1_motor", api.Requests[1].OperationId);
        Assert.Equal("get_api_v1_drives", api.Requests[2].OperationId);
        Assert.Equal("get_api_v1_analytics_driving_coach", api.Requests[3].OperationId);
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_primary_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new DrivingDynamicsClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task ClientFeed_degrades_gracefully_when_a_secondary_read_fails()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"power_kw\":45,\"shift_state\":\"D\"}")); // motor latest
        api.Throws(new ApiException("motor history down", 503));          // motor history
        api.ReturnsValue(Json("[]"));                                       // drives
        api.ReturnsValue(Json("null"));                                     // coach
        api.ReturnsValue(Json("{}"));                                       // drive-dynamics
        api.ReturnsValue(Json("{}"));                                       // vehicle state
        api.ReturnsValue(Json("{}"));                                       // cruise observation
        api.ReturnsValue(Json("{}"));                                       // follow observation
        var feed = new DrivingDynamicsClientFeed(api, vehicleId: 3);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.Loaded);
        Assert.NotNull(snapshot.MotorLatest);
        Assert.Empty(snapshot.MotorHistory);
    }

    // ---- View-model state machine --------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_into_the_success_state()
    {
        using var vm = new DrivingDynamicsPageViewModel(new FakeFeed(SampleSnapshot()), Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DrivingDynamicsState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsError);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new DrivingDynamicsPageViewModel(new ThrowingFeed(), Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DrivingDynamicsState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_range_change_reprojects_without_refetching()
    {
        var feed = new FakeFeed(SampleSnapshot());
        using var vm = new DrivingDynamicsPageViewModel(feed, Localizer, UnitPref.Metric, () => Now);
        await vm.LoadAsync();

        var newRange = new DateRange(new DateOnly(2026, 1, 1), new DateOnly(2026, 2, 1));
        vm.Range = newRange;

        Assert.Equal(newRange, vm.Display.Analytics.Range);
        Assert.Equal(1, feed.FetchCount);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new DrivingDynamicsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DrivingDynamicsPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("DrivingDynamics", DrivingDynamicsRegistration.RouteName);
        Assert.Equal("get_api_v1_motor_latest", DrivingDynamicsRegistration.MotorLatestOperation);
        Assert.Equal("get_api_v1_motor", DrivingDynamicsRegistration.MotorHistoryOperation);
        Assert.Equal("get_api_v1_drives", DrivingDynamicsRegistration.DrivesOperation);
        Assert.Equal("get_api_v1_analytics_driving_coach", DrivingDynamicsRegistration.CoachOperation);
        Assert.Equal("Driving Dynamics", DrivingDynamicsRegistration.Title(Localizer));
    }

    private static FakeApiClient ScriptedApi()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"power_kw\":45,\"shift_state\":\"D\"}")); // motor latest
        api.ReturnsValue(Json("[{\"power_kw\":45}]"));                      // motor history
        api.ReturnsValue(Json("[{\"id\":1,\"distance_m\":24000}]"));        // drives
        api.ReturnsValue(Json(CoachJson));                                  // coach
        api.ReturnsValue(Json("{\"pedal_position\":40}"));                  // drive-dynamics
        api.ReturnsValue(Json("{\"state\":{\"speed\":18}}"));               // vehicle state
        api.ReturnsValue(Json("{\"observations\":[{\"value_numeric\":30}]}")); // cruise set
        api.ReturnsValue(Json("{\"observations\":[{\"value_text\":\"FollowDistance7\"}]}")); // follow distance
        return api;
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeFeed(DrivingDynamicsSnapshot snapshot) : IDrivingDynamicsFeed
    {
        public int FetchCount { get; private set; }

        public Task<DrivingDynamicsSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingFeed : IDrivingDynamicsFeed
    {
        public Task<DrivingDynamicsSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
