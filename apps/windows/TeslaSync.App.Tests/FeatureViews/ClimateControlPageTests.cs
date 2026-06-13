using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.VehicleSystems;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ClimateControlPage</c> surface's Microsoft.UI-free logic — the tolerant
/// climate-latest / climate-history parsers, the page projection
/// (web/src/features/vehicle-systems/pages/ClimateControlPage.tsx) with its loading / empty / error / success matrix,
/// the ported <c>comfortBadge</c> / <c>keeperLabel</c> / <c>heatStyle</c> / <c>comfortScore</c> helpers, the full
/// manifest i18n key set (84 web key names, verbatim, in the resw <c>translation.*</c> catalog form), the view-model
/// state holder, and the generated-client feed's request shaping (web <c>useClimate</c> + <c>useClimateHistory</c> +
/// <c>useChargingTelemetryLatest</c>). The WinUI view is exercised by the app build; its per-region visibility is
/// driven entirely by the <see cref="ClimateControlDisplay"/> flags asserted here.
/// </summary>
public sealed class ClimateControlPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly UnitPref Metric = UnitPref.Metric;

    private static readonly ClimateReading AllNull = new(
        null, null, null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null, null, null);

    // The 84 i18n strings the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStrings =
    [
        "AC", "AC On Time", "AC On/Off", "AC State & Fan Speed", "Above Target", "Active", "Auto",
        "Auto Climate (Left)", "Auto Climate (Right)", "Auto Conditioning", "Avg Fan Speed", "Battery Heater",
        "Below Target", "Clearing rear window", "Clearing windshield before drive", "Climate Control",
        "Climate Efficiency", "Climate History", "Climate Keeper", "Code", "Comfort Score", "Comfortable", "Defrost",
        "Defrost Mode", "Defrost for Preconditioning", "Disabled", "Driver Set Temp", "Enabled", "Excellent", "Fan",
        "Fan Level", "Fan Speed", "Fan Status", "HVAC", "HVAC Power", "HVAC System",
        "HVAC status, temperatures, and seat heaters", "Heating windshield wipers", "Idle", "Inactive", "Inside",
        "Inside Temp", "Insufficient Power to Heat", "Level", "Level 0-10", "Manual", "Moderate", "N/A", "Near Target",
        "No HVAC history available.", "No history records found.", "No temperature history available.", "Off", "On",
        "Outside", "Outside Temp", "Overheat Protection", "Overheat Temp Limit", "Passenger Setting", "Peak Fan Speed",
        "Poor", "Rear Defrost", "Rear Display HVAC", "Rear passengers can control HVAC", "Refresh", "Running",
        "Seat Cooling", "Seat Heaters", "Set Temp", "State", "Status", "Steering Wheel Heat Auto",
        "Steering Wheel Heat Level", "Steering Wheel Heater", "Temp Delta", "Temperature History", "Thermal Comfort",
        "Time", "Too Cold", "Too Warm", "Unknown", "Ventilation", "Wiper Heater", "of samples",
    ];

    // ---- Latest snapshot parsing ---------------------------------------------------

    [Fact]
    public void Reading_parses_the_snake_case_wire_fields()
    {
        var reading = ClimateReading.FromJson(Json(
            "{\"inside_temp\":21.5,\"outside_temp\":12.0,\"driver_temp_setting\":22,\"is_ac_on\":true," +
            "\"hvac_power\":\"On\",\"fan_speed\":4,\"climate_keeper_mode\":\"On\",\"defrost_mode\":\"Front\"," +
            "\"battery_heater\":true,\"seat_heater_left\":2,\"hvac_steering_wheel_heat_level\":3}"));

        Assert.NotNull(reading);
        Assert.Equal(21.5, reading!.InsideTempC);
        Assert.Equal(12.0, reading.OutsideTempC);
        Assert.Equal(22, reading.DriverTempSettingC);
        Assert.True(reading.IsAcOn);
        Assert.Equal("On", reading.HvacPower);
        Assert.Equal(4, reading.FanSpeed);
        Assert.Equal("Front", reading.DefrostMode);
        Assert.True(reading.BatteryHeater);
        Assert.Equal(2, reading.SeatHeaterLeft);
        Assert.Equal(3, reading.HvacSteeringWheelHeatLevel);
    }

    [Fact]
    public void Reading_non_object_is_null()
    {
        Assert.Null(ClimateReading.FromJson(Json("[]")));
        Assert.Null(ClimateReading.FromJson(Json("\"x\"")));
    }

    [Fact]
    public void Reading_tolerates_missing_fields()
    {
        var reading = ClimateReading.FromJson(Json("{}"));

        Assert.NotNull(reading);
        Assert.Null(reading!.InsideTempC);
        Assert.Null(reading.IsAcOn);
        Assert.Null(reading.ClimateKeeperMode);
    }

    [Fact]
    public void History_parses_rows_and_falls_back_to_index_ids()
    {
        var rows = ClimateClientFeed.ParseHistory(Json(
            "[{\"timestamp\":\"2026-06-01T10:00:00Z\",\"inside_temp\":20,\"fan_speed\":3,\"is_ac_on\":true}," +
            "{\"inside_temp\":19}]"));

        Assert.Equal(2, rows.Count);
        Assert.Equal(1, rows[0].Id);
        Assert.Equal(20, rows[0].InsideTempC);
        Assert.True(rows[0].IsAcOn);
        Assert.Equal(2, rows[1].Id);
    }

    [Fact]
    public void History_non_array_is_empty() =>
        Assert.Empty(ClimateClientFeed.ParseHistory(Json("{}")));

    // ---- Data-state matrix ---------------------------------------------------------

    [Fact]
    public void Loading_model_is_the_loading_state()
    {
        var display = Project(new ClimateControlModel(ClimateSnapshot.Empty, true, null));

        Assert.Equal(ClimateControlState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void Empty_snapshot_is_the_empty_state()
    {
        var display = Project(new ClimateControlModel(ClimateSnapshot.Empty, false, null));

        Assert.Equal(ClimateControlState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.Equal("No history records found.", display.EmptyMessage);
    }

    [Fact]
    public void Error_detail_is_the_error_state()
    {
        var display = Project(new ClimateControlModel(ClimateSnapshot.Empty, false, "boom"));

        Assert.Equal(ClimateControlState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Equal("boom", display.ErrorText);
    }

    [Fact]
    public void Latest_object_is_the_success_state()
    {
        var display = Project(new ClimateControlModel(new ClimateSnapshot(AllNull, Array.Empty<ClimateHistoryRow>(), false), false, null));

        Assert.Equal(ClimateControlState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.Equal(3, display.Gauges.Count);
        Assert.Equal(13, display.StatusCards.Count);
        Assert.Equal(4, display.ProtectionCards.Count);
        Assert.Equal(3, display.ComfortTiles.Count);
        Assert.Equal(4, display.EfficiencyCards.Count);
    }

    [Fact]
    public void Success_renders_history_charts_and_table_when_history_present()
    {
        var reading = AllNull with { InsideTempC = 22, OutsideTempC = 14, DriverTempSettingC = 21, FanSpeed = 4, IsAcOn = true };
        var rows = new[]
        {
            new ClimateHistoryRow(1, new DateTimeOffset(2026, 6, 1, 10, 0, 0, TimeSpan.Zero), 22, 14, 21, 4, true, "On"),
            new ClimateHistoryRow(2, new DateTimeOffset(2026, 6, 1, 11, 0, 0, TimeSpan.Zero), 23, 15, 21, 5, false, "Off"),
        };
        var display = Project(new ClimateControlModel(new ClimateSnapshot(reading, rows, false), false, null));

        Assert.True(display.HasTempHistory);
        Assert.True(display.HasAcFanHistory);
        Assert.NotEmpty(display.TempHistorySeries);
        Assert.NotEmpty(display.AcFanSeries);
        Assert.Equal(2, display.HistoryRows.Count);
        Assert.Equal(7, display.HistoryColumns.Count);
    }

    [Fact]
    public void History_rows_are_newest_first()
    {
        var rows = new[]
        {
            new ClimateHistoryRow(1, new DateTimeOffset(2026, 6, 1, 10, 0, 0, TimeSpan.Zero), 20, null, null, null, null, null),
            new ClimateHistoryRow(2, new DateTimeOffset(2026, 6, 1, 12, 0, 0, TimeSpan.Zero), 22, null, null, null, null, null),
        };
        var display = Project(new ClimateControlModel(new ClimateSnapshot(AllNull, rows, false), false, null));

        Assert.Equal(2, display.HistoryRows[0].Id);
        Assert.Equal(1, display.HistoryRows[1].Id);
    }

    // ---- i18n key coverage (the 84 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_manifest_string_in_the_translation_catalog_form()
    {
        var recorder = new RecordingLocalizer();
        foreach (var model in BranchCoveringModels())
        {
            _ = ClimateControlProjection.Project(model, Metric, recorder);
        }

        foreach (var phrase in RequiredStrings)
        {
            Assert.Contains("translation." + phrase, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_set_has_exactly_eighty_four_unique_keys() =>
        Assert.Equal(84, RequiredStrings.Distinct(StringComparer.Ordinal).Count());

    [Fact]
    public void Every_resolved_key_uses_the_translation_namespace()
    {
        var recorder = new RecordingLocalizer();
        foreach (var model in BranchCoveringModels())
        {
            _ = ClimateControlProjection.Project(model, Metric, recorder);
        }

        Assert.All(recorder.Keys, key => Assert.StartsWith("translation.", key, StringComparison.Ordinal));
    }

    // ---- Ported helpers ------------------------------------------------------------

    [Theory]
    [InlineData(21.0, 21.0, "Comfortable")]
    [InlineData(23.0, 21.0, "Adjusting")]
    [InlineData(30.0, 21.0, "Far from target")]
    public void ComfortBadge_matches_the_web_helper(double inside, double target, string expected) =>
        Assert.Equal(expected, ClimateControlProjection.ComfortBadge(inside, target, Identity).Text);

    [Theory]
    [InlineData("On", "On")]
    [InlineData("Dog Mode", "Dog Mode")]
    [InlineData("Camp Mode", "Camp Mode")]
    [InlineData("Off", "Off")]
    [InlineData(null, "Off")]
    public void KeeperLabel_matches_the_web_helper(string? mode, string expected) =>
        Assert.Equal(expected, ClimateControlProjection.KeeperLabel(mode));

    [Theory]
    [InlineData(0, "Off")]
    [InlineData(1, "Low")]
    [InlineData(2, "Medium")]
    [InlineData(3, "High")]
    [InlineData(9, "High")]
    public void HeatLabel_clamps_like_the_web_helper(int level, string expected) =>
        Assert.Equal(expected, ClimateControlProjection.HeatLabel(level));

    [Fact]
    public void ComfortScore_matches_the_web_memo()
    {
        Assert.Equal(95, ClimateControlProjection.ComfortScore(21.5, 21.0));
        Assert.Equal(0, ClimateControlProjection.ComfortScore(40, 21));
        Assert.Null(ClimateControlProjection.ComfortScore(null, 21));
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_a_snapshot_into_the_success_state()
    {
        var reading = AllNull with { InsideTempC = 21, DriverTempSettingC = 21 };
        var feed = new FakeClimateFeed(new ClimateSnapshot(reading, Array.Empty<ClimateHistoryRow>(), false));
        using var vm = new ClimateControlPageViewModel(feed, Localizer, Metric, () => DateTimeOffset.UnixEpoch);

        await vm.LoadAsync();

        Assert.Equal(ClimateControlState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.Equal(DateTimeOffset.UnixEpoch, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new ClimateControlPageViewModel(EmptyClimateFeed.Instance, Localizer, Metric);

        await vm.LoadAsync();

        Assert.Equal(ClimateControlState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new ClimateControlPageViewModel(new ThrowingClimateFeed(), Localizer, Metric);

        await vm.LoadAsync();

        Assert.Equal(ClimateControlState.Error, vm.State);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeClimateFeed(ClimateSnapshot.Empty);
        using var vm = new ClimateControlPageViewModel(feed, Localizer, Metric);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web useClimate / useClimateHistory / useChargingTelemetryLatest) ----------

    [Fact]
    public async Task ClientFeed_sends_the_three_reads_scoped_to_the_vehicle()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"inside_temp\":21,\"is_ac_on\":true}"));
        api.ReturnsValue(Json("[{\"inside_temp\":21,\"fan_speed\":3}]"));
        api.ReturnsValue(Json("{\"not_enough_power_to_heat\":true}"));
        var feed = new ClimateClientFeed(api, vehicleId: 9);

        var snapshot = await feed.FetchAsync(default);

        Assert.NotNull(snapshot.Latest);
        Assert.Single(snapshot.History);
        Assert.True(snapshot.NotEnoughPowerToHeat);
        Assert.Equal(3, api.Requests.Count);
        Assert.Equal("get_api_v1_climate_latest", api.Requests[0].OperationId);
        Assert.Equal("get_api_v1_climate", api.Requests[1].OperationId);
        Assert.Equal("get_api_v1_charging_telemetry_latest", api.Requests[2].OperationId);
        Assert.Equal("9", api.Requests[0].Query!["vehicle_id"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_degrades_when_history_and_charging_reads_fail()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"inside_temp\":21}"));
        api.Throws(new ApiException("history down", 500));
        api.Throws(new ApiException("charging down", 500));
        var feed = new ClimateClientFeed(api, vehicleId: 1);

        var snapshot = await feed.FetchAsync(default);

        Assert.NotNull(snapshot.Latest);
        Assert.Empty(snapshot.History);
        Assert.False(snapshot.NotEnoughPowerToHeat);
    }

    // ---- Registration --------------------------------------------------------------

    [Fact]
    public void Registration_exposes_the_route_and_operations()
    {
        Assert.Equal("ClimateControl", ClimateControlRegistration.RouteName);
        Assert.Equal("ClimateControlPage", ClimateControlRegistration.Slug);
        Assert.Equal("get_api_v1_climate_latest", ClimateControlRegistration.LatestOperation);
        Assert.Equal("get_api_v1_climate", ClimateControlRegistration.HistoryOperation);
        Assert.Equal("get_api_v1_charging_telemetry_latest", ClimateControlRegistration.ChargingTelemetryOperation);
    }

    // ---- Fixtures ------------------------------------------------------------------

    private static ClimateControlDisplay Project(ClimateControlModel model) =>
        ClimateControlProjection.Project(model, Metric, Localizer);

    private static string Identity(string value) => value;

    // Models crafted to exercise every conditional value branch the projection localizes, so the union of their
    // resolved keys covers all 84 manifest strings.
    private static IEnumerable<ClimateControlModel> BranchCoveringModels()
    {
        var warm = AllNull with
        {
            InsideTempC = 30,
            OutsideTempC = 15,
            DriverTempSettingC = 21,
            PassengerTempSettingC = 22,
            HvacPower = "On",
            IsAcOn = true,
            HvacAutoMode = "On",
            FanSpeed = 5,
            HvacFanStatus = 2,
            ClimateKeeperMode = "On",
            DefrostMode = "Front",
            DefrostForPreconditioning = true,
            RearDefrostEnabled = true,
            WiperHeatEnabled = true,
            RearDisplayHvacEnabled = true,
            BatteryHeater = true,
            OverheatProtection = "On",
            CabinOverheatProtectionTempLimit = "Low",
            HvacSteeringWheelHeatAuto = true,
            HvacSteeringWheelHeatLevel = 2,
            SeatHeaterLeft = 2,
            SeatHeaterRight = 1,
            SeatHeaterRearLeft = 3,
            AutoSeatClimateLeft = true,
            AutoSeatClimateRight = true,
            ClimateSeatCoolingFrontLeft = 1,
            ClimateSeatCoolingFrontRight = 2,
            SeatVentEnabled = true,
        };
        var warmRows = new[]
        {
            new ClimateHistoryRow(1, new DateTimeOffset(2026, 6, 1, 10, 0, 0, TimeSpan.Zero), 30, 15, 21, 5, true, "On"),
        };
        yield return new ClimateControlModel(new ClimateSnapshot(warm, warmRows, true), false, null);

        var cold = AllNull with
        {
            InsideTempC = 16,
            DriverTempSettingC = 21,
            IsAcOn = false,
            HvacAutoMode = "Off",
            HvacFanStatus = 0,
            DefrostMode = "Off",
            DefrostForPreconditioning = false,
            RearDefrostEnabled = false,
            WiperHeatEnabled = false,
            RearDisplayHvacEnabled = false,
            HvacSteeringWheelHeatAuto = false,
            HvacSteeringWheelHeatLevel = 0,
            AutoSeatClimateLeft = false,
            AutoSeatClimateRight = false,
            SeatVentEnabled = false,
        };
        yield return new ClimateControlModel(new ClimateSnapshot(cold, Array.Empty<ClimateHistoryRow>(), false), false, null);

        var near = AllNull with { InsideTempC = 21.5, DriverTempSettingC = 21 };
        yield return new ClimateControlModel(new ClimateSnapshot(near, Array.Empty<ClimateHistoryRow>(), false), false, null);

        yield return new ClimateControlModel(new ClimateSnapshot(AllNull, Array.Empty<ClimateHistoryRow>(), false), false, null);
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

    private sealed class FakeClimateFeed(ClimateSnapshot snapshot) : IClimateFeed
    {
        public int FetchCount { get; private set; }

        public Task<ClimateSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingClimateFeed : IClimateFeed
    {
        public Task<ClimateSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
