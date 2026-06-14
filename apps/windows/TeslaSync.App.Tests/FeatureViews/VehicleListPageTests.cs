using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Vehicles;
using TeslaSync.App.Tests.Data;
using GeneratedApi = TeslaSync.Windows.Generated.Api;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>VehicleListPage</c> surface's UI-thread-free logic — the roster + state parse
/// adapters, the pinned parse, the fleet rollup aggregation, the status / battery palette derivation, the
/// pinned-first sort, the SI→display projection (the four summary tiles, the Fleet Battery Status rows and the
/// vehicle cards), the cache-then-network data source (roster spine + per-vehicle state fan-out + pinned read
/// with best-effort failure tolerance), the view-model state matrix (loading / empty / error / success) plus the
/// sync + remove mutations and unit reprojection, the registration metadata and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/features/vehicles/pages/VehicleListPage.tsx). The WinUI view itself
/// (feature-views\VehicleListPage\VehicleListPage.cs) is exercised by the app build.
/// </summary>
public sealed class VehicleListPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // ── Roster parse (web useVehicles) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void FromArray_reads_vehicles_in_order_and_tolerates_strings_and_gaps()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":7,"display_name":"Red","vin":"V7","model":"Model 3","trim_badging":"P"},{"id":"42","vin":"V42"},{"name":"x"}]""");

        var vehicles = VehicleListVehicle.FromArray(doc.RootElement);

        Assert.Equal(2, vehicles.Count);
        Assert.Equal(7, vehicles[0].Id);
        Assert.Equal("Red", vehicles[0].Name);
        Assert.Equal("Model 3 P", vehicles[0].ModelTrim);
        Assert.Equal(42, vehicles[1].Id);
        Assert.Equal("V42", vehicles[1].Name); // display_name absent → falls back to vin
    }

    [Fact]
    public void FromArray_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Empty(VehicleListVehicle.FromArray(doc.RootElement));
    }

    // ── State parse (web fetchVehicleState normalisation) ────────────────────────────────────────────────

    [Fact]
    public void FromResponse_reads_canonical_state_object()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":7,"battery_level":72,"rated_range":402336,"odometer":100000,"is_charging":true,"charger_power":11,"is_locked":true,"sentry_mode":true}}""");

        var state = VehicleListVehicleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(72, state!.BatteryLevel);
        Assert.Equal(402_336, state.RatedRangeMeters);
        Assert.True(state.IsCharging);
        Assert.Equal(11, state.ChargerPowerKw);
        Assert.True(state.IsLocked);
        Assert.True(state.SentryMode);
    }

    [Fact]
    public void FromResponse_falls_back_to_position_and_top_level_charging()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle":{"id":7,"state":"online"},"position":{"battery_level":55,"rated_range":250000,"is_locked":true},"is_charging":false}""");

        var state = VehicleListVehicleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(55, state!.BatteryLevel);
        Assert.Equal(250_000, state.RatedRangeMeters);
        Assert.False(state.IsCharging);
        Assert.True(state.IsLocked);
    }

    [Fact]
    public void FromResponse_returns_null_when_no_state_or_snapshot()
    {
        using var doc = JsonDocument.Parse("""{"live":false}""");
        Assert.Null(VehicleListVehicleState.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_tolerates_numeric_strings()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":1,"battery_level":"66","rated_range":"123456","is_charging":"true"}}""");

        var state = VehicleListVehicleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(66, state!.BatteryLevel);
        Assert.Equal(123_456, state.RatedRangeMeters);
        Assert.True(state.IsCharging);
    }

    // ── Pinned parse (web usePinned) ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Pins_FromArray_reads_item_id_and_position()
    {
        using var doc = JsonDocument.Parse("""[{"item_id":3,"position":0},{"item_id":"7","position":1}]""");

        var pins = VehicleListPin.FromArray(doc.RootElement);

        Assert.Equal(2, pins.Count);
        Assert.Equal("3", pins[0].ItemId);
        Assert.Equal(0, pins[0].Position);
        Assert.Equal("7", pins[1].ItemId);
        Assert.Equal(1, pins[1].Position);
    }

    // ── Fleet rollup aggregation (web fleet memo) ────────────────────────────────────────────────────────

    [Fact]
    public void Reading_aggregates_avg_total_charging_online()
    {
        var reading = new VehicleListReading(
            new[]
            {
                Entry(1, battery: 80, range: 300_000, charging: true),
                Entry(2, battery: 60, range: 200_000, charging: false),
                Asleep(3),
            },
            Array.Empty<VehicleListPin>());

        Assert.Equal(3, reading.VehicleCount);
        Assert.Equal(2, reading.OnlineCount);
        Assert.Equal(1, reading.ChargingCount);
        Assert.Equal(70, reading.AvgBatteryPercent);
        Assert.Equal(500_000, reading.TotalRangeMeters);
    }

    [Fact]
    public void Reading_avg_is_zero_when_no_state_resolved()
    {
        var reading = new VehicleListReading(new[] { Asleep(1) }, Array.Empty<VehicleListPin>());
        Assert.Equal(0, reading.AvgBatteryPercent);
        Assert.Equal(0, reading.OnlineCount);
    }

    // ── Status + battery palette derivation (web deriveVehicleStatus / statusVariant / batteryColor) ──────

    [Fact]
    public void DeriveStatus_offline_when_no_state()
    {
        Assert.Equal("offline", VehicleListStatus.DeriveStatus(null));
        Assert.Equal(StatusKind.Danger, VehicleListStatus.StatusKindFor("offline"));
    }

    [Fact]
    public void DeriveStatus_charging_wins_then_driving_then_fsm()
    {
        Assert.Equal("charging", VehicleListStatus.DeriveStatus(State(charging: true)));
        Assert.Equal("driving", VehicleListStatus.DeriveStatus(State(speed: 12)));
        Assert.Equal("online", VehicleListStatus.DeriveStatus(State(fsm: "unknown")));
        Assert.Equal("parked", VehicleListStatus.DeriveStatus(State(fsm: "parked")));
    }

    [Theory]
    [InlineData(90, "TsChartBatteryBrush")]
    [InlineData(40, "TsChartEnergyBrush")]
    [InlineData(10, "TsColorDangerBrush")]
    public void BatteryBrushKey_maps_thresholds(double level, string expected)
    {
        Assert.Equal(expected, VehicleListStatus.BatteryBrushKey(level));
    }

    // ── Pinned-first sort (web sortedVehicleList) ────────────────────────────────────────────────────────

    [Fact]
    public void SortByPins_floats_pinned_vehicles_to_the_top_in_position_order()
    {
        var entries = new[] { Asleep(1), Asleep(2), Asleep(3) };
        var pins = new[] { new VehicleListPin("3", 0), new VehicleListPin("1", 1) };

        var ordered = VehicleListProjection.SortByPins(entries, pins);

        Assert.Equal(new long[] { 3, 1, 2 }, ordered.Select(e => e.Vehicle.Id).ToArray());
    }

    [Fact]
    public void SortByPins_returns_input_unchanged_when_no_pins()
    {
        var entries = new[] { Asleep(1), Asleep(2) };
        Assert.Same(entries, VehicleListProjection.SortByPins(entries, Array.Empty<VehicleListPin>()));
    }

    // ── Projection (web section stack) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_success_builds_four_tiles_battery_rows_and_cards()
    {
        var reading = new VehicleListReading(
            new[]
            {
                Entry(1, battery: 80, range: 300_000, charging: true),
                Entry(2, battery: 60, range: 200_000, charging: false),
            },
            Array.Empty<VehicleListPin>());

        var display = VehicleListProjection.Project(reading, VehicleListState.Success, UnitPref.Metric, Localizer);

        Assert.Equal(VehicleListState.Success, display.State);
        Assert.Equal(4, display.Metrics.Count);
        Assert.Equal("total-vehicles", display.Metrics[0].Key);
        Assert.Equal(2, display.Metrics[0].Value);                 // vehicle count
        Assert.Equal(70, display.Metrics[1].Value);                // avg battery
        Assert.Equal(500, display.Metrics[2].Value);               // 500 km total range (metric)
        Assert.Equal(1, display.Metrics[3].Value);                 // charging count
        Assert.Equal("/ 2", display.Metrics[3].TrailingText);      // online trailing
        Assert.Equal(2, display.BatteryRows.Count);
        Assert.Equal(2, display.VehicleRows.Count);
        Assert.All(display.Metrics, t => Assert.False(string.IsNullOrWhiteSpace(t.AutomationName)));
    }

    [Fact]
    public void Project_total_range_label_carries_the_distance_unit()
    {
        var reading = new VehicleListReading(new[] { Entry(1, 50, 100_000, false) }, Array.Empty<VehicleListPin>());

        var metric = VehicleListProjection.Project(reading, VehicleListState.Success, UnitPref.Imperial, Localizer);

        Assert.Contains("(", metric.Metrics[2].Label, StringComparison.Ordinal); // "Total Range (mi)"
        Assert.Contains("mi", metric.Metrics[2].Label, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_vehicle_card_carries_status_battery_and_charge_power()
    {
        var reading = new VehicleListReading(
            new[] { Entry(5, battery: 44, range: 150_000, charging: true, power: 7) },
            Array.Empty<VehicleListPin>());

        var card = VehicleListProjection.Project(reading, VehicleListState.Success, UnitPref.Metric, Localizer).VehicleRows[0];

        Assert.Equal(5, card.Id);
        Assert.Equal("charging", card.Status);
        Assert.Equal(StatusKind.Warning, card.StatusKind);
        Assert.Equal(44, card.Level);
        Assert.True(card.HasState);
        Assert.NotNull(card.ChargerPowerText);
        Assert.Equal("/vehicles/5", card.DetailRoute);
    }

    [Fact]
    public void Project_loading_and_error_return_no_tiles()
    {
        var reading = new VehicleListReading(new[] { Entry(1, 50, 100_000, false) }, Array.Empty<VehicleListPin>());

        Assert.Empty(VehicleListProjection.Project(reading, VehicleListState.Loading, UnitPref.Metric, Localizer).Metrics);
        Assert.Empty(VehicleListProjection.Project(reading, VehicleListState.Error, UnitPref.Metric, Localizer).Metrics);
    }

    // ── Data source: roster spine + state fan-out + pinned read ──────────────────────────────────────────

    [Fact]
    public async Task Source_lists_fans_out_state_reads_pins_and_aggregates()
    {
        using var list = JsonDocument.Parse("""[{"id":1,"display_name":"A"},{"id":2,"display_name":"B"}]""");
        using var s1 = JsonDocument.Parse("""{"state":{"vehicle_id":1,"battery_level":80,"rated_range":300000,"is_charging":true}}""");
        using var s2 = JsonDocument.Parse("""{"state":{"vehicle_id":2,"battery_level":60,"rated_range":200000,"is_charging":false}}""");
        using var pins = JsonDocument.Parse("""[{"item_id":2,"position":0}]""");

        var api = new FakeVehicleListApiClient()
            .List(list.RootElement)
            .State(1, s1.RootElement)
            .State(2, s2.RootElement)
            .Pins(pins.RootElement);
        var source = new VehicleListSource(api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(2, terminal.Value!.VehicleCount);
        Assert.Equal(1, terminal.Value.ChargingCount);
        Assert.Equal(70, terminal.Value.AvgBatteryPercent);
        Assert.Single(terminal.Value.Pins);
        Assert.Equal("2", terminal.Value.Pins[0].ItemId);

        Assert.Contains(api.Requests, r => r.OperationId == Operations.Vehicles.List);
        Assert.Equal(2, api.Requests.Count(r => r.OperationId == VehicleListPageRegistration.StateOperation));
        Assert.Contains(api.Requests, r => r.OperationId == VehicleListPageRegistration.PinnedOperation);
    }

    [Fact]
    public async Task Source_empty_roster_short_circuits_to_empty()
    {
        using var list = JsonDocument.Parse("[]");
        var api = new FakeVehicleListApiClient().List(list.RootElement);
        var source = new VehicleListSource(api, NewEngine(), new ApiClientOptions());

        Assert.Equal(LoadStatus.Empty, (await Drain(source))[^1].Status);
        Assert.DoesNotContain(api.Requests, r => r.OperationId == VehicleListPageRegistration.StateOperation);
    }

    [Fact]
    public async Task Source_drops_vehicles_whose_state_read_fails_and_tolerates_pin_failure()
    {
        using var list = JsonDocument.Parse("""[{"id":1},{"id":2}]""");
        using var s1 = JsonDocument.Parse("""{"state":{"vehicle_id":1,"battery_level":90,"rated_range":400000,"is_charging":false}}""");

        var api = new FakeVehicleListApiClient()
            .List(list.RootElement)
            .State(1, s1.RootElement)
            .StateThrows(2, new HttpRequestException("vehicle 2 down"))
            .PinsThrows(new HttpRequestException("pins down"));
        var source = new VehicleListSource(api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(2, terminal.Value!.VehicleCount); // total fleet size unchanged
        Assert.Equal(1, terminal.Value.OnlineCount);    // only the resolved state counts
        Assert.Empty(terminal.Value.Pins);              // pin failure leaves the roster unsorted
    }

    // ── View-model state matrix + mutations ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleListReading>.Loading());
        await vm.LoadAsync();
        Assert.Equal(VehicleListState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty_state()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleListReading>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal(VehicleListState.Empty, vm.State);
        Assert.False(vm.HasVehicles);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleListReading>.Failure(new RepositoryError(RepositoryErrorKind.Network, "down")));
        await vm.LoadAsync();
        Assert.Equal(VehicleListState.Error, vm.State);
        Assert.False(string.IsNullOrEmpty(vm.Display.LoadErrorMessage));
    }

    [Fact]
    public async Task ViewModel_loaded_projects_and_enables_compare()
    {
        var reading = new VehicleListReading(
            new[] { Entry(1, 80, 300_000, true), Entry(2, 60, 200_000, false) },
            Array.Empty<VehicleListPin>());
        using var vm = NewViewModel(RepositoryResult<VehicleListReading>.Loaded(reading, Now));

        await vm.LoadAsync();

        Assert.Equal(VehicleListState.Success, vm.State);
        Assert.True(vm.HasVehicles);
        Assert.True(vm.CanCompare);
        Assert.Equal((1, 2), vm.CompareIds);
        Assert.Equal(4, vm.Display.Metrics.Count);
    }

    [Fact]
    public async Task ViewModel_unit_change_reprojects_without_refetch()
    {
        var reading = new VehicleListReading(new[] { Entry(1, 50, 321_869, false) }, Array.Empty<VehicleListPin>());
        using var vm = NewViewModel(RepositoryResult<VehicleListReading>.Loaded(reading, Now));
        await vm.LoadAsync();

        vm.Units = UnitPref.Imperial;

        Assert.Equal(200, vm.Display.Metrics[2].Value); // 321869 m ≈ 200 mi
    }

    [Fact]
    public async Task ViewModel_sync_success_sets_banner_and_notice()
    {
        var reading = new VehicleListReading(new[] { Entry(1, 50, 100_000, false) }, Array.Empty<VehicleListPin>());
        var mutations = new FakeMutations();
        using var vm = new VehicleListPageViewModel(
            new ScriptedSource(RepositoryResult<VehicleListReading>.Loaded(reading, Now)), mutations, Localizer);
        await vm.LoadAsync();

        await vm.SyncAsync();

        Assert.Equal(1, mutations.SyncCalls);
        Assert.Equal(VehicleListSyncFeedback.Success, vm.SyncFeedback);
        Assert.False(string.IsNullOrEmpty(vm.SyncBannerMessage));
        Assert.False(string.IsNullOrEmpty(vm.Notice));
        Assert.False(vm.NoticeIsError);
    }

    [Fact]
    public async Task ViewModel_sync_failure_sets_error_feedback()
    {
        var mutations = new FakeMutations { SyncError = new HttpRequestException("sync failed") };
        using var vm = new VehicleListPageViewModel(
            new ScriptedSource(RepositoryResult<VehicleListReading>.Empty(Now)), mutations, Localizer);
        await vm.LoadAsync();

        await vm.SyncAsync();

        Assert.Equal(VehicleListSyncFeedback.Error, vm.SyncFeedback);
        Assert.True(vm.NoticeIsError);
    }

    [Fact]
    public async Task ViewModel_delete_invokes_mutation_and_notices_success()
    {
        var mutations = new FakeMutations();
        using var vm = new VehicleListPageViewModel(
            new ScriptedSource(RepositoryResult<VehicleListReading>.Empty(Now)), mutations, Localizer);
        await vm.LoadAsync();

        bool ok = await vm.DeleteAsync(7);

        Assert.True(ok);
        Assert.Equal(7, mutations.DeletedId);
        Assert.False(vm.NoticeIsError);
    }

    // ── Registration + diagnostics ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_web_keys_and_route()
    {
        Assert.Equal("Vehicles", VehicleListPageRegistration.RouteName);
        Assert.Equal("VehicleListPage", VehicleListPageRegistration.Slug);
        Assert.Equal("nav.vehicles", VehicleListPageRegistration.NavVehiclesKey);
        Assert.Equal("Fleet", VehicleListPageRegistration.NavVehiclesFallback);
        Assert.Equal("vehicles.totalVehicles", VehicleListPageRegistration.TotalVehiclesKey);
        Assert.Equal("vehicles.chargingOnline", VehicleListPageRegistration.ChargingOnlineKey);
        Assert.Equal("common.delete", VehicleListPageRegistration.DeleteKey);
        Assert.Equal("Remove", VehicleListPageRegistration.DeleteFallback);
        Assert.Equal(30_000, VehicleListPageRegistration.RefreshIntervalMs);
    }

    [Fact]
    public void Registration_remove_message_substitutes_the_vehicle_name()
    {
        string message = VehicleListPageRegistration.RemoveMessage(Localizer, "Red Model 3");
        Assert.Contains("Red Model 3", message, StringComparison.Ordinal);
        Assert.DoesNotContain("{name}", message, StringComparison.Ordinal);
    }

    [Fact]
    public void Diagnostics_record_view_opened_emits_the_slug()
    {
        var log = new List<string>();
        var diagnostics = new VehicleListPageDiagnostics(log.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Contains("view.opened slug=VehicleListPage", log);
    }

    // ── Harness ──────────────────────────────────────────────────────────────────────────────────────────

    private static VehicleListVehicleState State(string fsm = "online", double speed = 0, bool charging = false) =>
        new(fsm, 50, 100_000, 1_000, speed, charging, 0, true, false);

    private static VehicleListEntry Entry(long id, double battery, double range, bool charging, double power = 0) =>
        new(
            new VehicleListVehicle(id, $"V{id}", $"VIN{id}", "Model 3", string.Empty),
            new VehicleListVehicleState("online", battery, range, 50_000, 0, charging, power, true, false));

    private static VehicleListEntry Asleep(long id) =>
        new(new VehicleListVehicle(id, $"V{id}", $"VIN{id}", "Model 3", string.Empty), null);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static VehicleListPageViewModel NewViewModel(params RepositoryResult<VehicleListReading>[] results) =>
        new(new ScriptedSource(results), new FakeMutations(), Localizer);

    private static async Task<List<RepositoryResult<VehicleListReading>>> Drain(IVehicleListSource source)
    {
        var list = new List<RepositoryResult<VehicleListReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private sealed class ScriptedSource(params RepositoryResult<VehicleListReading>[] results) : IVehicleListSource
    {
        public async IAsyncEnumerable<RepositoryResult<VehicleListReading>> StreamAsync(
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

    private sealed class FakeMutations : IVehicleListMutations
    {
        public int SyncCalls { get; private set; }

        public long? DeletedId { get; private set; }

        public Exception? SyncError { get; init; }

        public Exception? DeleteError { get; init; }

        public Task<int> SyncAsync(CancellationToken cancellationToken = default)
        {
            SyncCalls++;
            return SyncError is not null ? Task.FromException<int>(SyncError) : Task.FromResult(3);
        }

        public Task DeleteAsync(long vehicleId, CancellationToken cancellationToken = default)
        {
            DeletedId = vehicleId;
            return DeleteError is not null ? Task.FromException(DeleteError) : Task.CompletedTask;
        }
    }

    private sealed class FakeVehicleListApiClient : IApiClient
    {
        private readonly Dictionary<string, Func<JsonElement>> _states = new(StringComparer.Ordinal);
        private JsonElement _list;
        private Func<JsonElement>? _pins;

        public List<ApiRequest> Requests { get; } = new();

        public FakeVehicleListApiClient List(JsonElement list)
        {
            _list = list;
            return this;
        }

        public FakeVehicleListApiClient State(long vehicleId, JsonElement state)
        {
            _states[vehicleId.ToString(CultureInfo.InvariantCulture)] = () => state;
            return this;
        }

        public FakeVehicleListApiClient StateThrows(long vehicleId, Exception exception)
        {
            _states[vehicleId.ToString(CultureInfo.InvariantCulture)] = () => throw exception;
            return this;
        }

        public FakeVehicleListApiClient Pins(JsonElement pins)
        {
            _pins = () => pins;
            return this;
        }

        public FakeVehicleListApiClient PinsThrows(Exception exception)
        {
            _pins = () => throw exception;
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

            if (request.OperationId == VehicleListPageRegistration.StateOperation)
            {
                string id = request.PathParams![VehicleListPageRegistration.VehicleIdPathParam];
                return Task.FromResult((T)(object)_states[id]());
            }

            if (request.OperationId == VehicleListPageRegistration.PinnedOperation)
            {
                using var empty = JsonDocument.Parse("[]");
                return Task.FromResult((T)(object)(_pins?.Invoke() ?? empty.RootElement.Clone()));
            }

            throw new InvalidOperationException($"FakeVehicleListApiClient received an unexpected request: {request.OperationId}");
        }
    }
}
