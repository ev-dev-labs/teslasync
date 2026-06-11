using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Telemetry Grid surface's UI-thread-free logic — the vehicle-state JSON parse
/// adapter (the web <c>useVehicleState</c> normalisation: canonical <c>state</c> object, plain-state fallback,
/// position + top-level reconstruction), the SI→display projection into the six web <c>InfoTile</c>s (Battery /
/// Speed / Inside / Odometer / Charger / Sentry) with the colour thresholds, unit conversion, "Full in {h}h"
/// sub-line and the em-dash fallbacks, the cache-then-network result mapper, the single-read repository source's
/// path-parameter request shape, the state-holder view-model's per-state matrix (loading / loaded / empty /
/// error / stale / offline), the registry metadata, the PII-safe diagnostics and the Narrator labels. Mirrors the
/// web spec (web/src/features/vehicles/components/telemetry-panels/TelemetryGrid.tsx).
/// </summary>
public sealed class TelemetryGridTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);
    private const string Dash = "\u2014";

    private static VehicleTelemetryReading Reading(
        double? battery = 82,
        double? ratedRange = 350_000,
        double? speed = 0,
        double? insideTemp = 21,
        double? outsideTemp = 15,
        double? odometer = 120_000,
        bool isCharging = false,
        double? chargerPower = null,
        double? timeToFull = null,
        bool sentry = false) =>
        new(battery, ratedRange, speed, insideTemp, outsideTemp, odometer, isCharging, chargerPower, timeToFull, sentry);

    // ---- Parse adapter (web useVehicleState normalisation) -------------------------

    [Fact]
    public void FromResponse_reads_canonical_state_object()
    {
        using var doc = JsonDocument.Parse("""
        {"state":{"vehicle_id":1,"battery_level":80,"rated_range":300000,"speed":12.5,"inside_temp":22,
                  "outside_temp":9,"odometer":150000,"is_charging":true,"charger_power":11,
                  "time_to_full_charge":1.5,"sentry_mode":true}}
        """);

        var r = VehicleTelemetryReading.FromResponse(doc.RootElement);

        Assert.NotNull(r);
        Assert.Equal(80, r!.BatteryLevel);
        Assert.Equal(300000, r.RatedRange);
        Assert.Equal(12.5, r.Speed);
        Assert.Equal(22, r.InsideTemp);
        Assert.Equal(9, r.OutsideTemp);
        Assert.Equal(150000, r.Odometer);
        Assert.True(r.IsCharging);
        Assert.Equal(11, r.ChargerPower);
        Assert.Equal(1.5, r.TimeToFullCharge);
        Assert.True(r.SentryMode);
    }

    [Fact]
    public void FromResponse_reconstructs_from_position_and_top_level_flags()
    {
        // No vehicle_id on state → reconstruct from position (range/speed/temps/odometer) + top-level flags.
        using var doc = JsonDocument.Parse("""
        {"vehicle":{"id":7},
         "position":{"battery_level":64,"ideal_range":250000,"speed":0,"inside_temp":20,"outside_temp":5,"odometer":99000},
         "is_charging":true,"charger_power":7,"time_to_full_charge":2,"sentry_mode":false}
        """);

        var r = VehicleTelemetryReading.FromResponse(doc.RootElement);

        Assert.NotNull(r);
        Assert.Equal(64, r!.BatteryLevel);
        Assert.Equal(250000, r.RatedRange); // rated_range absent → ideal_range fallback (web parity)
        Assert.Equal(99000, r.Odometer);
        Assert.True(r.IsCharging);
        Assert.Equal(7, r.ChargerPower);
        Assert.Equal(2, r.TimeToFullCharge);
        Assert.False(r.SentryMode);
    }

    [Fact]
    public void FromResponse_uses_plain_state_when_no_vehicle_or_position()
    {
        using var doc = JsonDocument.Parse("""{"state":{"battery_level":42,"speed":3}}""");

        var r = VehicleTelemetryReading.FromResponse(doc.RootElement);

        Assert.NotNull(r);
        Assert.Equal(42, r!.BatteryLevel);
        Assert.Equal(3, r.Speed);
    }

    [Fact]
    public void FromResponse_non_object_and_stateless_body_yield_null()
    {
        using var array = JsonDocument.Parse("[]");
        Assert.Null(VehicleTelemetryReading.FromResponse(array.RootElement));

        using var empty = JsonDocument.Parse("{}");
        Assert.Null(VehicleTelemetryReading.FromResponse(empty.RootElement));

        using var stateless = JsonDocument.Parse("""{"vehicle_id":1}""");
        Assert.Null(VehicleTelemetryReading.FromResponse(stateless.RootElement));
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_and_wrong_kind_fields()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"battery_level":"oops"}}""");

        var r = VehicleTelemetryReading.FromResponse(doc.RootElement);

        Assert.NotNull(r);
        Assert.Null(r!.BatteryLevel); // non-numeric string → null (em dash downstream)
        Assert.Null(r.Speed);
        Assert.Null(r.ChargerPower);
        Assert.False(r.IsCharging);
    }

    // ---- Projection (web TelemetryGrid / InfoTile composition) ---------------------

    [Fact]
    public void Project_builds_six_tiles_in_web_order()
    {
        var view = TelemetryGridProjection.Project(Reading(), UnitPref.Metric, Localizer);

        Assert.True(view.HasData);
        Assert.Equal(6, view.Tiles.Count);
        Assert.Equal(
            new[] { "battery", "speed", "inside", "odometer", "charger", "sentry" },
            view.Tiles.Select(t => t.Key).ToArray());
        Assert.Equal(
            new[] { "Battery", "Speed", "Inside", "Odometer", "Charger", "Sentry" },
            view.Tiles.Select(t => t.Label).ToArray());
    }

    [Theory]
    [InlineData(82, TelemetryTileAccent.Success)]
    [InlineData(30, TelemetryTileAccent.Warning)]
    [InlineData(10, TelemetryTileAccent.Danger)]
    public void Project_battery_value_uses_percent_and_threshold_tint(double level, TelemetryTileAccent expected)
    {
        var battery = TelemetryGridProjection.Project(Reading(battery: level), UnitPref.Metric, Localizer).Tiles[0];

        Assert.Equal(ScalarFormatters.FormatPercentage(level, 0), battery.ValueText);
        Assert.Equal(expected, battery.Accent);
    }

    [Fact]
    public void Project_battery_null_shows_dash_and_neutral_tint()
    {
        var battery = TelemetryGridProjection.Project(
            Reading(battery: null, ratedRange: null), UnitPref.Metric, Localizer).Tiles[0];

        Assert.Equal(Dash, battery.ValueText);
        Assert.Equal(TelemetryTileAccent.Primary, battery.Accent);
        Assert.Equal($"{Dash} range", battery.SubText); // formatDistance(null) → em dash
    }

    [Fact]
    public void Project_battery_sub_shows_rated_range_in_units()
    {
        var battery = TelemetryGridProjection.Project(Reading(ratedRange: 350_000), UnitPref.Metric, Localizer).Tiles[0];

        Assert.Equal($"{UnitFormatters.FormatDistance(350_000, UnitPref.Metric)} range", battery.SubText);
    }

    [Theory]
    [InlineData(0, "Parked")]
    [InlineData(15.5, "Driving")]
    public void Project_speed_sub_is_driving_or_parked(double speed, string expectedSub)
    {
        var tile = TelemetryGridProjection.Project(Reading(speed: speed), UnitPref.Metric, Localizer).Tiles[1];

        Assert.Equal(UnitFormatters.FormatSpeed(speed, UnitPref.Metric), tile.ValueText);
        Assert.Equal(expectedSub, tile.SubText);
        Assert.Equal(TelemetryTileAccent.Primary, tile.Accent);
    }

    [Fact]
    public void Project_inside_shows_temperature_with_outside_sub()
    {
        var tile = TelemetryGridProjection.Project(
            Reading(insideTemp: 21, outsideTemp: 15), UnitPref.Metric, Localizer).Tiles[2];

        Assert.Equal(UnitFormatters.FormatTemperature(21, UnitPref.Metric), tile.ValueText);
        Assert.Equal($"Outside: {UnitFormatters.FormatTemperature(15, UnitPref.Metric)}", tile.SubText);
    }

    [Fact]
    public void Project_odometer_uses_zero_precision_distance_and_no_sub()
    {
        var tile = TelemetryGridProjection.Project(Reading(odometer: 120_000), UnitPref.Metric, Localizer).Tiles[3];

        Assert.Equal(UnitFormatters.FormatDistance(120_000, UnitPref.Metric, 0), tile.ValueText);
        Assert.Null(tile.SubText);
    }

    [Fact]
    public void Project_charger_not_charging_shows_label_and_muted_tint()
    {
        var tile = TelemetryGridProjection.Project(Reading(isCharging: false), UnitPref.Metric, Localizer).Tiles[4];

        Assert.Equal("Not charging", tile.ValueText);
        Assert.Equal(TelemetryTileAccent.Muted, tile.Accent);
        Assert.Null(tile.SubText);
    }

    [Fact]
    public void Project_charger_charging_shows_kw_value_and_full_in_sub()
    {
        var tile = TelemetryGridProjection.Project(
            Reading(isCharging: true, chargerPower: 11, timeToFull: 1.5), UnitPref.Metric, Localizer).Tiles[4];

        Assert.Equal($"{ScalarFormatters.FormatNumber(11, 0)} kW", tile.ValueText);
        Assert.Equal(TelemetryTileAccent.Success, tile.Accent);
        Assert.Equal($"Full in {ScalarFormatters.FormatNumber(1.5, TelemetryGridProjection.DefaultDecimalPrecision)}h", tile.SubText);
    }

    [Fact]
    public void Project_charger_charging_without_eta_has_no_sub()
    {
        var tile = TelemetryGridProjection.Project(
            Reading(isCharging: true, chargerPower: 7, timeToFull: null), UnitPref.Metric, Localizer).Tiles[4];

        Assert.Equal($"{ScalarFormatters.FormatNumber(7, 0)} kW", tile.ValueText);
        Assert.Null(tile.SubText);
    }

    [Theory]
    [InlineData(true, "Active", TelemetryTileAccent.Danger)]
    [InlineData(false, "Off", TelemetryTileAccent.Muted)]
    public void Project_sentry_value_and_tint(bool sentry, string expected, TelemetryTileAccent accent)
    {
        var tile = TelemetryGridProjection.Project(Reading(sentry: sentry), UnitPref.Metric, Localizer).Tiles[5];

        Assert.Equal(expected, tile.ValueText);
        Assert.Equal(accent, tile.Accent);
    }

    [Fact]
    public void Project_converts_distance_speed_temperature_in_imperial()
    {
        var metric = TelemetryGridProjection.Project(Reading(), UnitPref.Metric, Localizer);
        var imperial = TelemetryGridProjection.Project(Reading(), UnitPref.Imperial, Localizer);

        Assert.NotEqual(metric.Tiles[1].ValueText, imperial.Tiles[1].ValueText);   // speed
        Assert.NotEqual(metric.Tiles[2].ValueText, imperial.Tiles[2].ValueText);   // inside temp
        Assert.NotEqual(metric.Tiles[3].ValueText, imperial.Tiles[3].ValueText);   // odometer
    }

    [Fact]
    public void Project_tile_automation_name_combines_label_value_and_sub()
    {
        var view = TelemetryGridProjection.Project(Reading(battery: 82, ratedRange: 350_000), UnitPref.Metric, Localizer);
        var battery = view.Tiles[0];
        var odometer = view.Tiles[3];

        Assert.Equal($"Battery: {battery.ValueText}, {battery.SubText}", battery.AutomationName);
        Assert.Equal($"Odometer: {odometer.ValueText}", odometer.AutomationName); // no sub
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"battery_level":80,"is_charging":true}}""");

        var cached = TelemetryGridResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(80, cached.Value!.BatteryLevel);
        Assert.True(cached.Value.IsCharging);

        var offline = TelemetryGridResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(80, offline.Value!.BatteryLevel);
    }

    [Fact]
    public void Map_maps_loaded_empty_failure_and_loading()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"battery_level":50}}""");

        Assert.Equal(LoadStatus.Loaded, TelemetryGridResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, TelemetryGridResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, TelemetryGridResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        Assert.Equal(LoadStatus.Loading, TelemetryGridResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleTelemetryReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(TelemetryGridState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_six_tiles()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        Assert.Equal(TelemetryGridState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(6, vm.Display.Tiles.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleTelemetryReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(TelemetryGridState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No telemetry data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleTelemetryReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(TelemetryGridState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleTelemetryReading>.Cached(Reading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(TelemetryGridState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleTelemetryReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(TelemetryGridState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleTelemetryReading>.Loading(),
            RepositoryResult<VehicleTelemetryReading>.Cached(Reading(), Now, stale: false),
            RepositoryResult<VehicleTelemetryReading>.Loaded(Reading(), Now));
        await vm.LoadAsync();

        Assert.Equal(TelemetryGridState.Loaded, vm.State);
        Assert.Equal(6, vm.Display.Tiles.Count);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_tiles()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();
        string metricSpeed = vm.Display.Tiles[1].ValueText;

        vm.Units = UnitPref.Imperial;

        Assert.NotEqual(metricSpeed, vm.Display.Tiles[1].ValueText);
        Assert.Equal(UnitFormatters.FormatSpeed(Reading().Speed, UnitPref.Imperial), vm.Display.Tiles[1].ValueText);
    }

    [Fact]
    public async Task ViewModel_title_empty_and_retry_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleTelemetryReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Vehicle Telemetry", vm.Title);
        Assert.Equal("No telemetry data available", vm.EmptyMessage);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TelemetryGridViewModel.State), changed);
        Assert.Contains(nameof(TelemetryGridViewModel.Display), changed);
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new TelemetryGridSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_state_by_path()
    {
        using var state = JsonDocument.Parse("""{"state":{"vehicle_id":7,"battery_level":55,"speed":0}}""");
        var api = new FakeApiClient().ReturnsValue(state.RootElement);
        var source = new TelemetryGridSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(55, results[^1].Value!.BatteryLevel);
        var request = Assert.Single(api.Requests);
        Assert.Equal(Operations.Vehicles.State, request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
        Assert.Null(request.Query);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var state = JsonDocument.Parse("""{"state":{"vehicle_id":42,"battery_level":12}}""");
        var api = new FakeApiClient().ReturnsValue(state.RootElement);
        var source = new TelemetryGridSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal("42", api.Requests[^1].PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_stateless_body_collapses_to_empty()
    {
        using var body = JsonDocument.Parse("{}");
        var api = new FakeApiClient().ReturnsValue(body.RootElement);
        var source = new TelemetryGridSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Contract / registration / diagnostics -------------------------------------

    [Fact]
    public void State_operation_resolves_against_generated_table()
    {
        var descriptor = GeneratedApi.ApiEndpoints.All.Single(e => e.OperationId == Operations.Vehicles.State);

        Assert.Equal("/vehicles/{vehicleID}/state", descriptor.Path);
        Assert.Equal(GeneratedApi.HttpMethod.Get, descriptor.Method);
    }

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("telemetry-grid", TelemetryGridRegistration.Id);
        Assert.Equal("TelemetryGrid", TelemetryGridRegistration.Slug);
        Assert.Equal("Vehicle Telemetry", TelemetryGridRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new TelemetryGridDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TelemetryGrid", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<VehicleTelemetryReading> Loaded(VehicleTelemetryReading reading) =>
        RepositoryResult<VehicleTelemetryReading>.Loaded(reading, Now);

    private static TelemetryGridViewModel NewViewModel(params RepositoryResult<VehicleTelemetryReading>[] emissions) =>
        new(new FakeSource(emissions), Localizer, UnitPref.Metric);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<VehicleTelemetryReading>>> Drain(ITelemetryGridSource source)
    {
        var list = new List<RepositoryResult<VehicleTelemetryReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<VehicleTelemetryReading>[] emissions)
        : ITelemetryGridSource
    {
        public async IAsyncEnumerable<RepositoryResult<VehicleTelemetryReading>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
