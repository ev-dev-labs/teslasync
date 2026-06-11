using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using GeneratedApi = TeslaSync.Windows.Generated.Api;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>FleetSummary</c> feature surface's UI-thread-free logic — the
/// <c>fetchVehicleState</c> parse adapter (canonical + position fallback + numeric-string tolerance), the
/// <c>useVehicles</c> id parse, the fleet rollup aggregation (avg battery / total range / charging / online),
/// the SI→display projection across unit preferences (the four tiles, their formatted count-up values, the
/// distance-unit label, the muted "/ online" trailing, the Segoe Fluent glyph + design-token accent mapping
/// and the composed Narrator names), the cache-then-network data source (vehicle list spine + per-vehicle
/// state fan-out with path-scoped reads + best-effort failure tolerance), the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline) and unit reprojection, the
/// registration metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/vehicles/components/FleetSummary.tsx). The WinUI view itself (feature-views\FleetSummary.cs)
/// is exercised by the app build.
/// </summary>
public sealed class FleetSummaryTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 10, 12, 0, 0, TimeSpan.Zero);

    // ── State parse adapter (web fetchVehicleState normalisation) ─────────────────────────────────────────

    [Fact]
    public void FromStateResponse_reads_canonical_state_object()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":7,"battery_level":72,"rated_range":402336,"is_charging":true},"live":true}""");

        var state = FleetVehicleStateLite.FromStateResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(72, state!.BatteryLevel);
        Assert.Equal(402_336, state.RatedRangeMeters);
        Assert.True(state.IsCharging);
    }

    [Fact]
    public void FromStateResponse_falls_back_to_position_and_top_level_charging()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle":{"id":7,"state":"online"},"position":{"battery_level":55,"rated_range":250000},"is_charging":false}""");

        var state = FleetVehicleStateLite.FromStateResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(55, state!.BatteryLevel);
        Assert.Equal(250_000, state.RatedRangeMeters);
        Assert.False(state.IsCharging);
    }

    [Fact]
    public void FromStateResponse_fallback_uses_ideal_range_when_rated_absent()
    {
        using var doc = JsonDocument.Parse(
            """{"position":{"battery_level":40,"ideal_range":180000},"is_charging":true}""");

        var state = FleetVehicleStateLite.FromStateResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(180_000, state!.RatedRangeMeters);
        Assert.True(state.IsCharging);
    }

    [Fact]
    public void FromStateResponse_uses_bare_state_object_without_vehicle_id()
    {
        using var doc = JsonDocument.Parse("""{"state":{"battery_level":30,"is_charging":true}}""");

        var state = FleetVehicleStateLite.FromStateResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(30, state!.BatteryLevel);
        Assert.Null(state.RatedRangeMeters);
        Assert.True(state.IsCharging);
    }

    [Fact]
    public void FromStateResponse_returns_null_when_no_state_or_snapshot()
    {
        using var doc = JsonDocument.Parse("""{"live":false}""");

        Assert.Null(FleetVehicleStateLite.FromStateResponse(doc.RootElement));
    }

    [Fact]
    public void FromStateResponse_tolerates_numeric_strings()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":1,"battery_level":"66","rated_range":"123456","is_charging":"true"}}""");

        var state = FleetVehicleStateLite.FromStateResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(66, state!.BatteryLevel);
        Assert.Equal(123_456, state.RatedRangeMeters);
        Assert.True(state.IsCharging);
    }

    // ── Vehicle-list id parse (web useVehicles) ──────────────────────────────────────────────────────────

    [Fact]
    public void ParseIds_reads_ids_in_order_and_tolerates_strings_and_gaps()
    {
        using var doc = JsonDocument.Parse("""[{"id":7},{"id":"42"},{"name":"x"},{"id":99}]""");

        var ids = FleetSummaryVehicles.ParseIds(doc.RootElement);

        Assert.Equal(new long[] { 7, 42, 99 }, ids);
    }

    [Fact]
    public void ParseIds_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"not":"an array"}""");

        Assert.Empty(FleetSummaryVehicles.ParseIds(doc.RootElement));
    }

    // ── Fleet rollup aggregation ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Aggregate_computes_online_charging_avg_and_total()
    {
        var states = new[]
        {
            new FleetVehicleStateLite(80, 300_000, IsCharging: true),
            new FleetVehicleStateLite(60, 200_000, IsCharging: false),
            new FleetVehicleStateLite(null, null, IsCharging: false),
        };

        var reading = FleetSummaryReading.Aggregate(vehicleCount: 4, states);

        Assert.Equal(4, reading.VehicleCount);
        Assert.Equal(3, reading.OnlineCount);
        Assert.Equal(1, reading.ChargingCount);
        Assert.Equal(140d / 3d, reading.AvgBatteryPercent, 6); // nulls coerce to 0 (web `?? 0`)
        Assert.Equal(500_000, reading.TotalRangeMeters);
    }

    [Fact]
    public void Aggregate_with_no_states_is_all_zero()
    {
        var reading = FleetSummaryReading.Aggregate(vehicleCount: 2, Array.Empty<FleetVehicleStateLite>());

        Assert.Equal(2, reading.VehicleCount);
        Assert.Equal(0, reading.OnlineCount);
        Assert.Equal(0, reading.ChargingCount);
        Assert.Equal(0, reading.AvgBatteryPercent);
        Assert.Equal(0, reading.TotalRangeMeters);
    }

    // ── Projection (web FleetSummary tiles) ──────────────────────────────────────────────────────────────

    private static FleetSummaryReading SampleReading() => new(
        VehicleCount: 4, OnlineCount: 3, ChargingCount: 1, AvgBatteryPercent: 140d / 3d, TotalRangeMeters: 500_000);

    [Fact]
    public void Project_builds_the_four_tiles_in_web_order()
    {
        var display = FleetSummaryProjection.Project(SampleReading(), UnitPref.Metric, Localizer);

        Assert.Equal(4, display.Tiles.Count);
        Assert.Equal("Vehicles", display.Tiles[0].Label);
        Assert.Equal("Avg Battery", display.Tiles[1].Label);
        Assert.Equal("Total Range km", display.Tiles[2].Label);
        Assert.Equal("Charging / Online", display.Tiles[3].Label);

        Assert.Equal(FleetSummaryRegistration.VehiclesGlyph, display.Tiles[0].Glyph);
        Assert.Equal(FleetSummaryRegistration.AvgBatteryGlyph, display.Tiles[1].Glyph);
        Assert.Equal(FleetSummaryRegistration.TotalRangeGlyph, display.Tiles[2].Glyph);
        Assert.Equal(FleetSummaryRegistration.ChargingOnlineGlyph, display.Tiles[3].Glyph);

        Assert.Equal(FleetSummaryRegistration.VehiclesColor, display.Tiles[0].ColorKey);
        Assert.Equal(FleetSummaryRegistration.AvgBatteryColor, display.Tiles[1].ColorKey);
        Assert.Equal(FleetSummaryRegistration.TotalRangeColor, display.Tiles[2].ColorKey);
        Assert.Equal(FleetSummaryRegistration.ChargingOnlineColor, display.Tiles[3].ColorKey);
    }

    [Fact]
    public void Project_metric_values_match_web_derivations()
    {
        var display = FleetSummaryProjection.Project(SampleReading(), UnitPref.Metric, Localizer);

        Assert.Equal(4, display.Tiles[0].Value);                 // vehicles.length
        Assert.Equal(47, display.Tiles[1].Value);                // Math.round(46.67)
        Assert.Equal(FleetSummaryRegistration.PercentSuffix, display.Tiles[1].Suffix);
        Assert.Equal(500, display.Tiles[2].Value);               // round(500000 / 1000) km
        Assert.Equal(1, display.Tiles[3].Value);                 // chargingCount
        Assert.Equal("/ 3", display.Tiles[3].TrailingText);      // "/ onlineCount"
        Assert.Null(display.Tiles[0].TrailingText);
    }

    [Fact]
    public void Project_imperial_converts_total_range_and_unit_label()
    {
        var display = FleetSummaryProjection.Project(SampleReading(), UnitPref.Imperial, Localizer);

        Assert.Equal("Total Range mi", display.Tiles[2].Label);
        Assert.Equal(311, display.Tiles[2].Value); // round(500000 / 1609.344) mi
    }

    [Fact]
    public void Project_composes_narrator_names_for_every_tile()
    {
        var display = FleetSummaryProjection.Project(SampleReading(), UnitPref.Metric, Localizer);

        Assert.Equal("Vehicles: 4", display.Tiles[0].AutomationName);
        Assert.Equal("Avg Battery: 47%", display.Tiles[1].AutomationName);
        Assert.Equal("Total Range km: 500", display.Tiles[2].AutomationName);
        Assert.Equal("Charging / Online: 1 / 3", display.Tiles[3].AutomationName);
    }

    [Fact]
    public void Project_groups_large_range_through_the_en_us_formatter()
    {
        var reading = SampleReading() with { TotalRangeMeters = 2_500_000 };

        var display = FleetSummaryProjection.Project(reading, UnitPref.Metric, Localizer);

        Assert.Equal(2500, display.Tiles[2].Value);
        Assert.Equal("Total Range km: 2,500", display.Tiles[2].AutomationName);
    }

    [Fact]
    public void Project_sets_has_data_from_vehicle_count()
    {
        Assert.True(FleetSummaryProjection.Project(SampleReading(), UnitPref.Metric, Localizer).HasData);
        Assert.False(FleetSummaryProjection.Project(FleetSummaryReading.Empty, UnitPref.Metric, Localizer).HasData);
    }

    [Fact]
    public void Project_resolves_region_and_loading_labels()
    {
        var display = FleetSummaryProjection.Project(SampleReading(), UnitPref.Metric, Localizer);

        Assert.Equal("Fleet summary", display.RegionLabel);
        Assert.Equal("Loading", display.LoadingLabel);
    }

    [Fact]
    public void EmptyDisplay_keeps_a_friendly_message_and_no_tiles()
    {
        var display = FleetSummaryDisplay.Empty(Localizer);

        Assert.Empty(display.Tiles);
        Assert.False(display.HasData);
        Assert.Equal("No vehicles in your fleet yet.", display.EmptyMessage);
        Assert.Equal("Fleet summary", display.RegionLabel);
    }

    // ── Data source: vehicle list spine + per-vehicle state fan-out ──────────────────────────────────────

    [Fact]
    public async Task Source_lists_vehicles_fans_out_state_and_aggregates()
    {
        using var list = JsonDocument.Parse("""[{"id":1},{"id":2}]""");
        using var s1 = JsonDocument.Parse("""{"state":{"vehicle_id":1,"battery_level":80,"rated_range":300000,"is_charging":true}}""");
        using var s2 = JsonDocument.Parse("""{"state":{"vehicle_id":2,"battery_level":60,"rated_range":200000,"is_charging":false}}""");

        var api = new FakeFleetApiClient()
            .List(list.RootElement)
            .State(1, s1.RootElement)
            .State(2, s2.RootElement);
        var source = new FleetSummarySource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(2, terminal.Value!.VehicleCount);
        Assert.Equal(2, terminal.Value.OnlineCount);
        Assert.Equal(1, terminal.Value.ChargingCount);
        Assert.Equal(70, terminal.Value.AvgBatteryPercent);
        Assert.Equal(500_000, terminal.Value.TotalRangeMeters);

        Assert.Contains(api.Requests, r => r.OperationId == Operations.Vehicles.List);
        var stateReqs = api.Requests.Where(r => r.OperationId == Operations.Vehicles.State).ToList();
        Assert.Equal(2, stateReqs.Count);
        Assert.Contains(stateReqs, r => r.PathParams![FleetSummaryRegistration.VehicleIdPathParam] == "1");
        Assert.Contains(stateReqs, r => r.PathParams![FleetSummaryRegistration.VehicleIdPathParam] == "2");
    }

    [Fact]
    public async Task Source_empty_list_short_circuits_to_empty()
    {
        using var list = JsonDocument.Parse("[]");
        var api = new FakeFleetApiClient().List(list.RootElement);
        var source = new FleetSummarySource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
        Assert.DoesNotContain(api.Requests, r => r.OperationId == Operations.Vehicles.State);
    }

    [Fact]
    public async Task Source_drops_vehicles_whose_state_read_fails()
    {
        using var list = JsonDocument.Parse("""[{"id":1},{"id":2}]""");
        using var s1 = JsonDocument.Parse("""{"state":{"vehicle_id":1,"battery_level":90,"rated_range":400000,"is_charging":false}}""");

        var api = new FakeFleetApiClient()
            .List(list.RootElement)
            .State(1, s1.RootElement)
            .StateThrows(2, new HttpRequestException("vehicle 2 down"));
        var source = new FleetSummarySource(api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(2, terminal.Value!.VehicleCount); // total fleet size unchanged
        Assert.Equal(1, terminal.Value.OnlineCount);    // only the resolved state counts (web try/catch → null)
        Assert.Equal(90, terminal.Value.AvgBatteryPercent);
        Assert.Equal(400_000, terminal.Value.TotalRangeMeters);
    }

    [Fact]
    public async Task Source_cached_then_loaded_projects_through_the_view_model()
    {
        using var list = JsonDocument.Parse("""[{"id":1}]""");
        using var s1 = JsonDocument.Parse("""{"state":{"vehicle_id":1,"battery_level":50,"rated_range":321869,"is_charging":true}}""");
        var cache = new InMemoryCacheStore();
        var clock = Now;
        var engine = new CacheThenNetworkEngine(cache, () => clock);

        // Seed the list cache so the engine emits Cached before the network Loaded (cache-then-network).
        cache.Seed("vehicles:list", "[{\"id\":1}]", Now.AddMinutes(-1));
        var api = new FakeFleetApiClient().List(list.RootElement).State(1, s1.RootElement);
        var source = new FleetSummarySource(api, engine, new ApiClientOptions());

        using var vm = new FleetSummaryViewModel(source, Localizer, UnitPref.Imperial);
        await vm.LoadAsync();

        Assert.Equal(FleetSummaryState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Tiles.Count);
        Assert.Equal(200, vm.Display.Tiles[2].Value); // 321869 m ≈ 200 mi, projected at the display boundary
    }

    // ── View-model state matrix ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<FleetSummaryReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(FleetSummaryState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_tiles()
    {
        using var vm = NewViewModel(RepositoryResult<FleetSummaryReading>.Loaded(SampleReading(), Now));
        await vm.LoadAsync();

        Assert.Equal(FleetSummaryState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Tiles.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty_with_friendly_message()
    {
        using var vm = NewViewModel(RepositoryResult<FleetSummaryReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(FleetSummaryState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No vehicles in your fleet yet.", vm.Display.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<FleetSummaryReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(FleetSummaryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_tiles()
    {
        using var vm = NewViewModel(RepositoryResult<FleetSummaryReading>.Cached(SampleReading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(FleetSummaryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Tiles.Count);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_tiles_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<FleetSummaryReading>.OfflineCached(
            SampleReading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(FleetSummaryState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<FleetSummaryReading>.Loading(),
            RepositoryResult<FleetSummaryReading>.Cached(SampleReading() with { ChargingCount = 0 }, Now, stale: false),
            RepositoryResult<FleetSummaryReading>.Loaded(SampleReading(), Now));
        await vm.LoadAsync();

        Assert.Equal(FleetSummaryState.Loaded, vm.State);
        Assert.Equal(1, vm.Display.Tiles[3].Value); // the fresh charging count won
    }

    [Fact]
    public async Task ViewModel_reprojects_tiles_when_units_change()
    {
        using var vm = NewViewModel(RepositoryResult<FleetSummaryReading>.Loaded(SampleReading(), Now));
        await vm.LoadAsync();
        Assert.Equal(500, vm.Display.Tiles[2].Value); // metric km

        vm.Units = UnitPref.Imperial;

        Assert.Equal("Total Range mi", vm.Display.Tiles[2].Label);
        Assert.Equal(311, vm.Display.Tiles[2].Value); // mi, no refetch
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<FleetSummaryReading>.Loaded(SampleReading(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(FleetSummaryViewModel.State), changed);
        Assert.Contains(nameof(FleetSummaryViewModel.Display), changed);
    }

    // ── Accessibility ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Every_tile_carries_a_non_empty_narrator_name()
    {
        var display = FleetSummaryProjection.Project(SampleReading(), UnitPref.Metric, Localizer);

        Assert.All(display.Tiles, tile =>
        {
            Assert.False(string.IsNullOrWhiteSpace(tile.AutomationName));
            Assert.Contains(tile.Label, tile.AutomationName);
        });
        Assert.False(string.IsNullOrWhiteSpace(display.RegionLabel));
    }

    // ── Registration metadata + diagnostics ──────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_web_keys_and_refresh_cadence()
    {
        Assert.Equal("FleetSummary", FleetSummaryRegistration.Slug);
        Assert.Equal("fleet.vehicles", FleetSummaryRegistration.VehiclesKey);
        Assert.Equal("fleet.avgBattery", FleetSummaryRegistration.AvgBatteryKey);
        Assert.Equal("fleet.totalRange", FleetSummaryRegistration.TotalRangeKey);
        Assert.Equal("fleet.chargingOnline", FleetSummaryRegistration.ChargingOnlineKey);
        Assert.Equal("Vehicles", FleetSummaryRegistration.VehiclesFallback);
        Assert.Equal("Avg Battery", FleetSummaryRegistration.AvgBatteryFallback);
        Assert.Equal("Total Range", FleetSummaryRegistration.TotalRangeFallback);
        Assert.Equal("Charging / Online", FleetSummaryRegistration.ChargingOnlineFallback);
        Assert.Equal(30_000, FleetSummaryRegistration.RefreshIntervalMs);
    }

    [Fact]
    public void Diagnostics_record_view_opened_emits_the_slug()
    {
        var log = new List<string>();
        var diagnostics = new FleetSummaryDiagnostics(log.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Contains("view.opened slug=FleetSummary", log);
    }

    // ── Harness ──────────────────────────────────────────────────────────────────────────────────────────

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static FleetSummaryViewModel NewViewModel(params RepositoryResult<FleetSummaryReading>[] results) =>
        new(new ScriptedSource(results), Localizer);

    private static async Task<List<RepositoryResult<FleetSummaryReading>>> Drain(IFleetSummarySource source)
    {
        var list = new List<RepositoryResult<FleetSummaryReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private sealed class ScriptedSource(params RepositoryResult<FleetSummaryReading>[] results) : IFleetSummarySource
    {
        public async IAsyncEnumerable<RepositoryResult<FleetSummaryReading>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in results)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
                await Task.Yield();
            }
        }
    }

    private sealed class FakeFleetApiClient : IApiClient
    {
        private readonly Dictionary<string, Func<JsonElement>> _states = new(StringComparer.Ordinal);
        private JsonElement _list;

        public List<ApiRequest> Requests { get; } = new();

        public FakeFleetApiClient List(JsonElement list)
        {
            _list = list;
            return this;
        }

        public FakeFleetApiClient State(long vehicleId, JsonElement state)
        {
            _states[vehicleId.ToString(CultureInfo.InvariantCulture)] = () => state;
            return this;
        }

        public FakeFleetApiClient StateThrows(long vehicleId, Exception exception)
        {
            _states[vehicleId.ToString(CultureInfo.InvariantCulture)] = () => throw exception;
            return this;
        }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            GeneratedApi.ApiEndpoints.All.First(e => e.OperationId == operationId);

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Requests.Add(request);

            if (request.OperationId == Operations.Vehicles.List)
            {
                return Task.FromResult((T)(object)_list);
            }

            if (request.OperationId == Operations.Vehicles.State)
            {
                string id = request.PathParams![FleetSummaryRegistration.VehicleIdPathParam];
                return Task.FromResult((T)(object)_states[id]());
            }

            throw new InvalidOperationException($"FakeFleetApiClient received an unexpected request: {request.OperationId}");
        }
    }
}
