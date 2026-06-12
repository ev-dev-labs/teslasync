using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Charging;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChargingDetailPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/charging/pages/ChargingDetailPage.tsx), the tolerant four-source parsers, the four-state
/// matrix (loading / empty / error / success), the SI energy / power / distance / temperature formatting at the
/// display boundary, the synthesized-vs-telemetry charge curve, and the generated-client feed's request shaping
/// (web <c>useChargingSessionDetail</c> + <c>useChargeTelemetry</c> + <c>useVehicle</c> +
/// <c>useChargingTelemetryLatest</c>). The WinUI view is exercised by the app build; its per-region visibility
/// is driven entirely by the <see cref="ChargingDetailDisplay"/> flags asserted here.
/// </summary>
public sealed class ChargingDetailPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 56 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "charging.detail.advanced", "charging.detail.advancedHint", "charging.detail.atRate",
        "charging.detail.avgPower", "charging.detail.avgRate", "charging.detail.batteryProgress",
        "charging.detail.batteryRange", "charging.detail.batteryTemp", "charging.detail.chargeCurve",
        "charging.detail.chargeEnergyAdded", "charging.detail.chargeMilesAdded", "charging.detail.chargeRate",
        "charging.detail.chargerActualCurrent", "charging.detail.chargerPhases", "charging.detail.chargerPilotCurrent",
        "charging.detail.chargerPowerKw", "charging.detail.chargerType", "charging.detail.chargerVoltage",
        "charging.detail.chargingState", "charging.detail.currency", "charging.detail.current",
        "charging.detail.duration", "charging.detail.endSoc", "charging.detail.ended", "charging.detail.energy",
        "charging.detail.energyAdded", "charging.detail.estCost", "charging.detail.estimated",
        "charging.detail.fromSettings", "charging.detail.insideTemp", "charging.detail.location",
        "charging.detail.milesAdded", "charging.detail.moreDetails", "charging.detail.noLiveData",
        "charging.detail.outsideTemp", "charging.detail.peakPower", "charging.detail.perKwh", "charging.detail.power",
        "charging.detail.range", "charging.detail.rangeGained", "charging.detail.soc", "charging.detail.socGained",
        "charging.detail.socOverTime", "charging.detail.socRange", "charging.detail.startSoc",
        "charging.detail.started", "charging.detail.status", "charging.detail.temperature", "charging.detail.title",
        "charging.detail.totalCost", "charging.detail.vehicle", "charging.detail.voltage",
        "charging.detail.voltageCurrent", "common.noData", "help.charging.chargeCurve.aria",
        "help.charging.socRange.aria",
    ];

    private static ChargingSessionData Session(
        string? chargerType = "Tesla",
        double? startSoc = 20,
        double? endSoc = 80,
        double totalEnergyWh = 30_000,
        double? peakPowerW = 120_000,
        double? avgPowerW = 30_000,
        double? costDecimal = 6.0,
        string? startPlace = "Supercharger - Fremont",
        double? odoStartMeters = 100_000,
        double? odoEndMeters = 100_000) =>
        new(
            Id: 42,
            VehicleId: 7,
            StartedAt: new DateTimeOffset(2026, 1, 1, 10, 0, 0, TimeSpan.Zero),
            EndedAt: new DateTimeOffset(2026, 1, 1, 11, 0, 0, TimeSpan.Zero),
            StartSocPct: startSoc,
            EndSocPct: endSoc,
            OdometerStartMeters: odoStartMeters,
            OdometerEndMeters: odoEndMeters,
            TotalEnergyAddedWh: totalEnergyWh,
            PeakPowerW: peakPowerW,
            AvgPowerW: avgPowerW,
            CostDecimal: costDecimal,
            CostCurrency: "USD",
            ChargerType: chargerType,
            StartPlace: startPlace,
            EndedStatus: "Complete");

    private static ChargeReadingData Reading(double soc, double powerKw, double rangeM = 320_000, double batteryTemp = 18, double voltage = 240, double current = 32) =>
        new(
            CreatedAt: new DateTimeOffset(2026, 1, 1, 10, 30, 0, TimeSpan.Zero),
            BatteryLevel: soc,
            Soc: soc,
            PowerKw: powerKw,
            EnergyAdded: 15.0,
            RatedRangeM: rangeM,
            BatteryTempC: batteryTemp,
            InsideTempC: 21,
            OutsideTempC: 14,
            Voltage: voltage,
            CurrentAmps: current);

    private static LiveChargingData Live() => new(
        ChargingState: "Charging",
        ChargerVoltage: 240,
        ChargerActualCurrent: 32,
        ChargerPilotCurrent: 40,
        ChargerPowerW: 11_000,
        ChargerPhases: 3,
        BatteryRangeM: 320_000,
        RangeAddedMetersPerHour: 48_000,
        ChargeEnergyAddedWh: 12_000);

    private static ChargingDetailModel SuccessModel(
        ChargingSessionData? session = null,
        IReadOnlyList<ChargeReadingData>? telemetry = null,
        ChargingVehicleData? vehicle = null,
        LiveChargingData? live = null) =>
        new(
            new ChargingDetailSnapshot(
                session ?? Session(),
                telemetry ?? Array.Empty<ChargeReadingData>(),
                vehicle ?? new ChargingVehicleData("Model 3"),
                live),
            false,
            null);

    private static ChargingDetailDisplay Project(ChargingDetailModel model, UnitPref? units = null) =>
        ChargingDetailProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now, 0.15, "$");

    // ---- i18n key coverage (all 56 manifest strings) -------------------------------

    [Fact]
    public void Required_string_key_set_has_exactly_fifty_six_unique_keys() =>
        Assert.Equal(56, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = ChargingDetailProjection.Project(SuccessModel(live: Live()), UnitPref.Metric, recorder, Now, 0.15, "$");

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = ChargingDetailProjection.Project(ChargingDetailModel.Initial, UnitPref.Metric, recorder, Now, 0.15, "$");

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_session_query_in_flight()
    {
        var display = Project(ChargingDetailModel.Initial);

        Assert.Equal(ChargingDetailState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_empty_when_resolved_without_a_session()
    {
        var display = Project(new ChargingDetailModel(ChargingDetailSnapshot.Empty, false, null));

        Assert.Equal(ChargingDetailState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.Equal("No data available", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_primary_read_failed()
    {
        var display = Project(new ChargingDetailModel(ChargingDetailSnapshot.Empty, false, "boom"));

        Assert.Equal(ChargingDetailState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Contains("boom", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_session_resolved()
    {
        var display = Project(SuccessModel());

        Assert.Equal(ChargingDetailState.Success, display.State);
        Assert.True(display.ShowContent);
    }

    // ---- Sections / panels ---------------------------------------------------------

    [Fact]
    public void Success_renders_five_hero_gauges()
    {
        var display = Project(SuccessModel());

        Assert.Equal(5, display.Gauges.Count);
        Assert.Equal("Energy Added", display.Gauges[0].Label);
        Assert.Equal("End SoC", display.Gauges[1].Label);
        Assert.Equal("Peak Power", display.Gauges[2].Label);
        Assert.Equal("Duration", display.Gauges[3].Label);
        Assert.Equal("Avg Power", display.Gauges[4].Label);
    }

    [Fact]
    public void Success_renders_eight_stat_cards()
    {
        var display = Project(SuccessModel());

        Assert.Equal(8, display.StatCards.Count);
        Assert.Equal("Energy", display.StatCards[0].Label);
        Assert.Equal("Total Cost", display.StatCards[4].Label);
        Assert.Equal("Per kWh", display.StatCards[5].Label);
    }

    [Fact]
    public void More_details_has_four_inline_metrics_and_three_rows()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.MoreDetailsInline.Count);
        Assert.Equal(3, display.MoreDetailsRows.Count);
        Assert.Equal("Vehicle", display.MoreDetailsRows[2].Key);
        Assert.Equal("Model 3", display.MoreDetailsRows[2].Value);
    }

    [Fact]
    public void Timestamps_render_started_and_ended()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Started", display.StartedLabel);
        Assert.Equal("Ended", display.EndedLabel);
        Assert.NotEqual("\u2014", display.StartedValue);
        Assert.NotEqual("\u2014", display.EndedValue);
    }

    // ---- Header chips / DC detection -----------------------------------------------

    [Fact]
    public void Dc_session_shows_dc_badge()
    {
        var display = Project(SuccessModel(Session(chargerType: "Tesla")));

        Assert.Equal("DC", display.AcDcBadge.Text);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Warning, display.AcDcBadge.Status);
    }

    [Fact]
    public void Ac_session_shows_ac_badge()
    {
        var display = Project(SuccessModel(Session(chargerType: null)));

        Assert.Equal("AC", display.AcDcBadge.Text);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Info, display.AcDcBadge.Status);
    }

    [Fact]
    public void Live_charging_state_drives_a_status_badge()
    {
        var display = Project(SuccessModel(live: Live()));

        Assert.NotNull(display.StateBadge);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Success, display.StateBadge!.Status);
    }

    // ---- Derived math (web helpers) ------------------------------------------------

    [Fact]
    public void DurationMinutes_rounds_the_span()
    {
        var session = Session();
        Assert.Equal(60, ChargingDetailProjection.DurationMinutes(session.StartedAt, session.EndedAt));
    }

    [Fact]
    public void DurationMinutes_is_zero_without_an_end()
    {
        var start = new DateTimeOffset(2026, 1, 1, 10, 0, 0, TimeSpan.Zero);
        Assert.Equal(0, ChargingDetailProjection.DurationMinutes(start, null));
    }

    [Fact]
    public void KwhPerHour_is_average_energy_rate()
    {
        Assert.Equal(30, ChargingDetailProjection.KwhPerHour(Session())!.Value, 3);
    }

    [Fact]
    public void DistanceAddedM_is_null_for_zero_delta()
    {
        Assert.Null(ChargingDetailProjection.DistanceAddedM(Session(odoStartMeters: 100_000, odoEndMeters: 100_000)));
        Assert.Equal(5_000, ChargingDetailProjection.DistanceAddedM(Session(odoStartMeters: 100_000, odoEndMeters: 105_000)));
    }

    [Theory]
    [InlineData("Tesla", true)]
    [InlineData("CCS", true)]
    [InlineData("", false)]
    [InlineData("<invalid>", false)]
    [InlineData("unknown", false)]
    [InlineData(null, false)]
    public void IsDc_matches_the_web_sentinel_rules(string? chargerType, bool expected) =>
        Assert.Equal(expected, ChargingDetailProjection.IsDc(chargerType));

    // ---- Charts --------------------------------------------------------------------

    [Fact]
    public void Charge_curve_is_synthesized_and_flagged_when_no_telemetry()
    {
        var display = Project(SuccessModel());

        Assert.True(display.ChargeCurve.HasData);
        Assert.Equal("estimated", display.ChargeCurve.EstimatedNote);
        Assert.Single(display.ChargeCurve.Series);
    }

    [Fact]
    public void Charge_curve_uses_telemetry_when_present()
    {
        var display = Project(SuccessModel(telemetry: [Reading(30, 100), Reading(50, 90)]));

        Assert.True(display.ChargeCurve.HasData);
        Assert.Null(display.ChargeCurve.EstimatedNote);
    }

    [Fact]
    public void Time_axis_charts_have_data_only_with_telemetry()
    {
        var withTelemetry = Project(SuccessModel(telemetry: [Reading(30, 100), Reading(50, 90)]));
        Assert.True(withTelemetry.SocOverTime.HasData);
        Assert.True(withTelemetry.Temperature.HasData);
        Assert.True(withTelemetry.VoltageCurrent.HasData);

        var withoutTelemetry = Project(SuccessModel());
        Assert.False(withoutTelemetry.SocOverTime.HasData);
        Assert.False(withoutTelemetry.Temperature.HasData);
        Assert.False(withoutTelemetry.VoltageCurrent.HasData);
        Assert.Equal("No data available", withoutTelemetry.SocOverTime.EmptyMessage);
    }

    // ---- Advanced live -------------------------------------------------------------

    [Fact]
    public void Advanced_panel_has_ten_rows_when_live_present()
    {
        var display = Project(SuccessModel(live: Live()));

        Assert.True(display.HasLive);
        Assert.Equal(10, display.AdvancedRows.Count);
        Assert.Equal("Charging State", display.AdvancedRows[0].Key);
    }

    [Fact]
    public void Advanced_panel_falls_back_when_no_live_data()
    {
        var display = Project(SuccessModel());

        Assert.False(display.HasLive);
        Assert.Empty(display.AdvancedRows);
        Assert.Equal("No live charging telemetry available.", display.NoLiveDataText);
    }

    // ---- Units at the display boundary ---------------------------------------------

    [Fact]
    public void Energy_gauge_unit_follows_the_user_preference()
    {
        Assert.Equal("Wh", Project(SuccessModel(), UnitPref.Metric).Gauges[0].Unit);
        Assert.Equal("kWh", Project(SuccessModel(), UnitPref.Imperial).Gauges[0].Unit);
    }

    [Fact]
    public void Energy_added_value_converts_to_the_display_unit()
    {
        var imperial = Project(SuccessModel(), UnitPref.Imperial);
        Assert.Contains("kWh", imperial.EnergyAddedValue, StringComparison.Ordinal);
    }

    // ---- Parsers -------------------------------------------------------------------

    [Fact]
    public void Session_parser_reads_snake_case_fields()
    {
        var json = Json("{\"id\":5,\"vehicle_id\":9,\"total_energy_added_wh\":42000,\"start_soc_pct\":10,\"end_soc_pct\":90,\"charger_type\":\"CCS\"}");

        var session = ChargingSessionData.FromJson(json);

        Assert.NotNull(session);
        Assert.Equal(5, session!.Id);
        Assert.Equal(9, session.VehicleId);
        Assert.Equal(42000, session.TotalEnergyAddedWh);
        Assert.Equal("CCS", session.ChargerType);
    }

    [Fact]
    public void Session_parser_returns_null_for_a_non_object()
    {
        Assert.Null(ChargingSessionData.FromJson(Json("null")));
        Assert.Null(ChargingSessionData.FromJson(Json("[]")));
    }

    [Fact]
    public void Live_parser_returns_null_for_a_json_null()
    {
        Assert.Null(LiveChargingData.FromJson(Json("null")));
        Assert.NotNull(LiveChargingData.FromJson(Json("{\"charging_state\":\"Charging\"}")));
    }

    [Fact]
    public void Reading_parser_reads_display_fields()
    {
        var reading = ChargeReadingData.FromJson(Json("{\"battery_level\":55,\"power_kw\":-90,\"voltage\":410,\"current_amps\":-120}"));

        Assert.Equal(55, reading.BatteryLevel);
        Assert.Equal(-90, reading.PowerKw);
        Assert.Equal(410, reading.Voltage);
        Assert.Equal(-120, reading.CurrentAmps);
    }

    // ---- Generated-client feed (web's four hooks) ----------------------------------

    [Fact]
    public async Task ClientFeed_issues_the_four_reads_with_the_right_ids_and_params()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"id\":42,\"vehicle_id\":7,\"total_energy_added_wh\":30000,\"charger_type\":\"Tesla\"}"));
        api.ReturnsValue(Json("[{\"battery_level\":40,\"power_kw\":80}]"));
        api.ReturnsValue(Json("{\"display_name\":\"Model 3\"}"));
        api.ReturnsValue(Json("{\"charging_state\":\"Charging\"}"));
        var feed = new ChargingDetailPageClientFeed(api);

        var snapshot = await feed.FetchAsync(42, default);

        Assert.True(snapshot.HasSession);
        Assert.Equal(42, snapshot.Session!.Id);
        Assert.Single(snapshot.Telemetry);
        Assert.Equal("Model 3", snapshot.Vehicle!.DisplayName);
        Assert.Equal("Charging", snapshot.Live!.ChargingState);

        Assert.Equal(4, api.Requests.Count);
        Assert.Equal("get_api_v1_charging_sessionID", api.Requests[0].OperationId);
        Assert.Equal("42", api.Requests[0].PathParams!["sessionID"]);
        Assert.Equal("get_api_v1_charging_sessionID_telemetry", api.Requests[1].OperationId);
        Assert.Equal("42", api.Requests[1].PathParams!["sessionID"]);
        Assert.Equal("get_api_v1_vehicles_vehicleID", api.Requests[2].OperationId);
        Assert.Equal("7", api.Requests[2].PathParams!["vehicleID"]);
        Assert.Equal("get_api_v1_charging_telemetry_latest", api.Requests[3].OperationId);
        Assert.Equal("7", api.Requests[3].Query!["vehicle_id"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_session_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new ChargingDetailPageClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(1, default));
    }

    [Fact]
    public async Task ClientFeed_degrades_when_supplementary_reads_fail()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"id\":1,\"vehicle_id\":2,\"total_energy_added_wh\":1000}"));
        api.Throws(new ApiException("telemetry down", 503));
        api.Throws(new ApiException("vehicle down", 503));
        api.Throws(new ApiException("live down", 503));
        var feed = new ChargingDetailPageClientFeed(api);

        var snapshot = await feed.FetchAsync(1, default);

        Assert.True(snapshot.HasSession);
        Assert.Empty(snapshot.Telemetry);
        Assert.Null(snapshot.Vehicle);
        Assert.Null(snapshot.Live);
    }

    // ---- View-model + diagnostics + registration -----------------------------------

    [Fact]
    public async Task ViewModel_loads_into_the_success_state()
    {
        var feed = new FakeChargingFeed(new ChargingDetailSnapshot(Session(), Array.Empty<ChargeReadingData>(), null, null));
        using var vm = new ChargingDetailPageViewModel(feed, Localizer, 42, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ChargingDetailState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.Equal(1, feed.FetchCount);
    }

    [Fact]
    public async Task ViewModel_surfaces_the_error_state_on_a_failed_load()
    {
        using var vm = new ChargingDetailPageViewModel(new ThrowingChargingFeed(), Localizer, 42, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ChargingDetailState.Error, vm.State);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeChargingFeed(new ChargingDetailSnapshot(Session(), Array.Empty<ChargeReadingData>(), null, null));
        using var vm = new ChargingDetailPageViewModel(feed, Localizer, 42, UnitPref.Metric, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new ChargingDetailPageDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargingDetailPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("ChargeDetail", ChargingDetailPageRegistration.RouteName);
        Assert.Equal("get_api_v1_charging_sessionID", ChargingDetailPageRegistration.SessionOperation);
        Assert.Equal("get_api_v1_charging_sessionID_telemetry", ChargingDetailPageRegistration.TelemetryOperation);
        Assert.Equal("get_api_v1_vehicles_vehicleID", ChargingDetailPageRegistration.VehicleOperation);
        Assert.Equal("get_api_v1_charging_telemetry_latest", ChargingDetailPageRegistration.LatestOperation);
        Assert.Equal("Charge Session", ChargingDetailPageRegistration.Title(Localizer));
    }

    [Fact]
    public void Registration_operation_ids_resolve_against_the_generated_table()
    {
        foreach (var op in new[]
                 {
                     ChargingDetailPageRegistration.SessionOperation,
                     ChargingDetailPageRegistration.TelemetryOperation,
                     ChargingDetailPageRegistration.VehicleOperation,
                     ChargingDetailPageRegistration.LatestOperation,
                 })
        {
            Assert.Contains(TeslaSync.Windows.Generated.Api.ApiEndpoints.All, e => e.OperationId == op);
        }
    }

    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();

    private sealed class FakeChargingFeed(ChargingDetailSnapshot snapshot) : IChargingDetailPageFeed
    {
        public int FetchCount { get; private set; }

        public Task<ChargingDetailSnapshot> FetchAsync(long sessionId, CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingChargingFeed : IChargingDetailPageFeed
    {
        public Task<ChargingDetailSnapshot> FetchAsync(long sessionId, CancellationToken cancellationToken) =>
            throw new ApiException("boom", 500);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
