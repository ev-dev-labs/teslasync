using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the EnergyFlowWidget's UI-thread-free logic — the JSON parse adapter (the
/// useVehicleState normalisation), the power/percent formatters, the diagram geometry (position coordinates,
/// stroke-width scaling, arrow offsetting), the consume / regenerate / standby / charging projection across
/// states, the result mapper, the single-endpoint per-vehicle data source (primary resolution, the path-scoped
/// state read, the stateless-body collapse), the registry metadata, the diagnostics, the per-state view-model
/// transitions (loading / loaded / empty / error / stale / offline), and the accessibility names on every node
/// and on the diagram. Mirrors the web spec (web/src/features/dashboard/widgets/EnergyFlowWidget.tsx).
/// </summary>
public sealed class EnergyFlowWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string ConsumingStateJson =
        """{"state":{"vehicle_id":7,"power":25.5,"is_charging":false,"charger_power":0,"battery_level":80}}""";

    // ---- Parse adapter (web useVehicleState normalisation) -------------------------

    [Fact]
    public void FromResponse_reads_primary_state_object_with_all_fields()
    {
        using var doc = JsonDocument.Parse(ConsumingStateJson);

        var state = EnergyFlowVehicleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(25.5, state!.Power);
        Assert.False(state.IsCharging);
        Assert.Equal(0, state.ChargerPowerKw);
        Assert.Equal(80, state.BatteryLevel);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1}}""");

        var state = EnergyFlowVehicleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(0, state!.Power);
        Assert.False(state.IsCharging);
        Assert.Equal(0, state.ChargerPowerKw);
        Assert.Equal(0, state.BatteryLevel);
    }

    [Fact]
    public void FromResponse_falls_back_to_position_battery_and_top_level_fields()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle":{"id":3},"position":{"battery_level":64},"power":-6.5,"is_charging":true,"charger_power":7.7}""");

        var state = EnergyFlowVehicleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(-6.5, state!.Power);
        Assert.True(state.IsCharging);
        Assert.Equal(7.7, state.ChargerPowerKw);
        Assert.Equal(64, state.BatteryLevel);
    }

    [Fact]
    public void FromResponse_uses_plain_state_object_when_no_vehicle_or_position()
    {
        using var doc = JsonDocument.Parse("""{"state":{"power":12,"battery_level":42}}""");

        var state = EnergyFlowVehicleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(12, state!.Power);
        Assert.Equal(42, state.BatteryLevel);
    }

    [Fact]
    public void FromResponse_returns_null_when_no_state()
    {
        using var doc = JsonDocument.Parse("""{"live":false}""");
        Assert.Null(EnergyFlowVehicleState.FromResponse(doc.RootElement));
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("\"text\"")]
    [InlineData("42")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(EnergyFlowVehicleState.FromResponse(doc.RootElement));
    }

    // ---- Formatters (web fmtNumber + `${batteryLevel}%`) ---------------------------

    [Theory]
    [InlineData(25.5, "25.5 kW")]
    [InlineData(7.249, "7.2 kW")]
    [InlineData(0, "0.0 kW")]
    [InlineData(11, "11.0 kW")]
    public void FormatPowerKw_matches_web_one_decimal(double value, string expected) =>
        Assert.Equal(expected, EnergyFlowProjection.FormatPowerKw(value));

    [Theory]
    [InlineData(80, "80%")]
    [InlineData(80.5, "80.5%")]
    [InlineData(0, "0%")]
    public void FormatPercent_matches_web_interpolation(double value, string expected) =>
        Assert.Equal(expected, EnergyFlowProjection.FormatPercent(value));

    // ---- Geometry (web POSITION_COORDS / strokeForValue / endpoints) ---------------

    [Theory]
    [InlineData(FlowNodePosition.Top, 50, 12)]
    [InlineData(FlowNodePosition.Bottom, 50, 88)]
    [InlineData(FlowNodePosition.Left, 12, 50)]
    [InlineData(FlowNodePosition.Right, 88, 50)]
    [InlineData(FlowNodePosition.Center, 50, 50)]
    public void Coords_match_web_position_table(FlowNodePosition position, double cx, double cy)
    {
        var (gotCx, gotCy) = EnergyFlowGeometry.Coords(position);
        Assert.Equal(cx, gotCx);
        Assert.Equal(cy, gotCy);
    }

    [Fact]
    public void MaxArrowValue_is_floored_at_one()
    {
        var inactive = new List<EnergyFlowArrow>
        {
            new("a", "b", 0, false, "#000"),
            new("b", "a", 0, false, "#000"),
        };
        Assert.Equal(1, EnergyFlowGeometry.MaxArrowValue(inactive));

        var charging = new List<EnergyFlowArrow>
        {
            new("a", "b", 0, false, "#000"),
            new("c", "b", 11, true, "#000"),
        };
        Assert.Equal(11, EnergyFlowGeometry.MaxArrowValue(charging));
    }

    [Theory]
    [InlineData(0, 0, EnergyFlowGeometry.MinStroke)]
    [InlineData(5, 10, 2.5)]
    [InlineData(10, 10, EnergyFlowGeometry.MaxStroke)]
    [InlineData(-10, 10, EnergyFlowGeometry.MaxStroke)]
    public void StrokeForValue_scales_between_min_and_max(double value, double maxValue, double expected) =>
        Assert.Equal(expected, EnergyFlowGeometry.StrokeForValue(value, maxValue), 6);

    [Fact]
    public void ArrowEndpoints_offset_by_node_radius()
    {
        var (x1, y1, x2, y2) = EnergyFlowGeometry.ArrowEndpoints(
            FlowNodePosition.Left, FlowNodePosition.Right, EnergyFlowGeometry.NodeRadius);

        Assert.Equal(26, x1, 6);  // 12 + 14
        Assert.Equal(50, y1, 6);
        Assert.Equal(74, x2, 6);  // 88 - 14
        Assert.Equal(50, y2, 6);
    }

    // ---- Projection (web nodes / arrows memos) -------------------------------------

    [Fact]
    public void Project_consuming_builds_battery_and_motor_with_active_consume_arrow()
    {
        var display = EnergyFlowProjection.Project(Consuming(), Localizer);

        Assert.Equal(2, display.Nodes.Count);
        Assert.Equal(2, display.Arrows.Count);

        var battery = Node(display, EnergyFlowProjection.BatteryNodeId);
        Assert.Equal("Battery", battery.Label);
        Assert.Equal(80, battery.Value);
        Assert.Equal("80%", battery.FormattedValue);
        Assert.Equal(FlowNodePosition.Left, battery.Position);
        Assert.Equal(EnergyFlowProjection.EmeraldHex, battery.IconColorHex);

        var motor = Node(display, EnergyFlowProjection.MotorNodeId);
        Assert.Equal("Consuming", motor.Label);
        Assert.Equal(25.5, motor.Value);
        Assert.Equal("25.5 kW", motor.FormattedValue);
        Assert.Equal(FlowNodePosition.Right, motor.Position);

        var consume = Arrow(display, EnergyFlowProjection.BatteryNodeId, EnergyFlowProjection.MotorNodeId);
        Assert.True(consume.Active);
        Assert.Equal(25.5, consume.Value);
        Assert.Equal(EnergyFlowProjection.CyanHex, consume.ColorHex);

        var regen = Arrow(display, EnergyFlowProjection.MotorNodeId, EnergyFlowProjection.BatteryNodeId);
        Assert.False(regen.Active);
        Assert.Equal(0, regen.Value);
    }

    [Fact]
    public void Project_regenerating_activates_the_regen_arrow()
    {
        var display = EnergyFlowProjection.Project(Snapshot(power: -8.2), Localizer);

        var motor = Node(display, EnergyFlowProjection.MotorNodeId);
        Assert.Equal("Regenerating", motor.Label);
        Assert.Equal(8.2, motor.Value);
        Assert.Equal("8.2 kW", motor.FormattedValue);

        var consume = Arrow(display, EnergyFlowProjection.BatteryNodeId, EnergyFlowProjection.MotorNodeId);
        Assert.False(consume.Active);

        var regen = Arrow(display, EnergyFlowProjection.MotorNodeId, EnergyFlowProjection.BatteryNodeId);
        Assert.True(regen.Active);
        Assert.Equal(8.2, regen.Value);
        Assert.Equal(EnergyFlowProjection.EmeraldHex, regen.ColorHex);
    }

    [Fact]
    public void Project_standby_labels_motor_standby_and_dashes_the_value()
    {
        var display = EnergyFlowProjection.Project(Snapshot(power: 0), Localizer);

        var motor = Node(display, EnergyFlowProjection.MotorNodeId);
        Assert.Equal("Standby", motor.Label);
        Assert.Equal(0, motor.Value);
        Assert.Equal("\u2014", motor.FormattedValue);

        Assert.All(display.Arrows, a => Assert.False(a.Active));
    }

    [Fact]
    public void Project_charging_adds_charger_node_and_active_charge_arrow()
    {
        var display = EnergyFlowProjection.Project(Charging(), Localizer);

        Assert.Equal(3, display.Nodes.Count);
        Assert.Equal(3, display.Arrows.Count);

        var charger = Node(display, EnergyFlowProjection.ChargerNodeId);
        Assert.Equal("Charger", charger.Label);
        Assert.Equal(11.0, charger.Value);
        Assert.Equal("11.0 kW", charger.FormattedValue);
        Assert.Equal(FlowNodePosition.Top, charger.Position);
        Assert.Equal(EnergyFlowProjection.AmberHex, charger.IconColorHex);
        Assert.Equal(EnergyFlowProjection.PlugGlyph, charger.Glyph);

        var charge = Arrow(display, EnergyFlowProjection.ChargerNodeId, EnergyFlowProjection.BatteryNodeId);
        Assert.True(charge.Active);
        Assert.Equal(11.0, charge.Value);
        Assert.Equal(EnergyFlowProjection.AmberHex, charge.ColorHex);
    }

    [Fact]
    public void Project_not_charging_omits_charger_node()
    {
        var display = EnergyFlowProjection.Project(Consuming(), Localizer);
        Assert.DoesNotContain(display.Nodes, n => n.Id == EnergyFlowProjection.ChargerNodeId);
        Assert.DoesNotContain(display.Arrows, a => a.FromId == EnergyFlowProjection.ChargerNodeId);
    }

    [Fact]
    public void Project_nodes_carry_label_and_value_automation_names()
    {
        var display = EnergyFlowProjection.Project(Charging(), Localizer);

        Assert.Equal("Battery, 55%", Node(display, EnergyFlowProjection.BatteryNodeId).AutomationName);
        Assert.Equal("Standby, \u2014", Node(display, EnergyFlowProjection.MotorNodeId).AutomationName);
        Assert.Equal("Charger, 11.0 kW", Node(display, EnergyFlowProjection.ChargerNodeId).AutomationName);
    }

    [Fact]
    public void Project_diagram_automation_name_is_localized_title()
    {
        var display = EnergyFlowProjection.Project(Consuming(), Localizer);
        Assert.Equal("Energy Flow", display.DiagramAutomationName);
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_for_each_freshness_state()
    {
        using var doc = JsonDocument.Parse(ConsumingStateJson);
        var el = doc.RootElement;

        Assert.Equal(LoadStatus.Loading, EnergyFlowResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Cached, EnergyFlowResultMapper.Map(RepositoryResult<JsonElement>.Cached(el, Now, false)).Status);
        Assert.Equal(LoadStatus.Refreshing, EnergyFlowResultMapper.Map(RepositoryResult<JsonElement>.Refreshing(el, Now, true)).Status);
        Assert.Equal(LoadStatus.Loaded, EnergyFlowResultMapper.Map(RepositoryResult<JsonElement>.Loaded(el, Now)).Status);
        Assert.Equal(LoadStatus.Empty, EnergyFlowResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(LoadStatus.Offline, EnergyFlowResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(el, Now, new RepositoryError(RepositoryErrorKind.Network, "down"))).Status);
        Assert.Equal(LoadStatus.Error, EnergyFlowResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_parses_state_into_snapshot()
    {
        using var doc = JsonDocument.Parse(ConsumingStateJson);
        var mapped = EnergyFlowResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.Equal(25.5, mapped.Value!.State.Power);
        Assert.Equal(80, mapped.Value.State.BatteryLevel);
    }

    [Fact]
    public void Mapper_collapses_stateless_loaded_body_to_empty()
    {
        using var doc = JsonDocument.Parse("""{"live":false}""");
        var mapped = EnergyFlowResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model per-state transitions ------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        var vm = NewViewModel(RepositoryResult<EnergyFlowSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Loading, vm.State);
        Assert.Null(vm.Display);
        Assert.True(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_diagram_display()
    {
        var vm = NewViewModel(Loaded(Consuming()));
        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Loaded, vm.State);
        Assert.True(vm.HasState);
        Assert.NotNull(vm.Display);
        Assert.Equal(2, vm.Display!.Nodes.Count);
        Assert.False(vm.IsFetching);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        var vm = NewViewModel(RepositoryResult<EnergyFlowSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Empty, vm.State);
        Assert.False(vm.HasState);
        Assert.Null(vm.Display);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        var vm = NewViewModel(RepositoryResult<EnergyFlowSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
        Assert.Equal(1, vm.Attempts);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        var vm = NewViewModel(RepositoryResult<EnergyFlowSnapshot>.Cached(Consuming(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.NotNull(vm.Display);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        var vm = NewViewModel(RepositoryResult<EnergyFlowSnapshot>.OfflineCached(
            Consuming(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Offline, vm.State);
        Assert.NotNull(vm.Display);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        var vm = NewViewModel(
            RepositoryResult<EnergyFlowSnapshot>.Loading(),
            RepositoryResult<EnergyFlowSnapshot>.Cached(Consuming(), Now, false),
            Loaded(Consuming()));
        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Loaded, vm.State);
        Assert.NotNull(vm.Display);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        var vm = NewViewModel(RepositoryResult<EnergyFlowSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Energy Flow", vm.Title);
        Assert.Equal("No energy data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        var vm = NewViewModel(Loaded(Consuming()));
        var changed = new List<string>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName ?? string.Empty);

        await vm.LoadAsync();

        Assert.Contains(nameof(EnergyFlowViewModel.State), changed);
        Assert.Contains(nameof(EnergyFlowViewModel.Display), changed);
    }

    // ---- Registration --------------------------------------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("energy-flow", EnergyFlowRegistration.Id);
        Assert.Equal("battery", EnergyFlowRegistration.Category);
        Assert.Equal("EnergyFlowWidget", EnergyFlowRegistration.Slug);
        Assert.Equal(new EnergyFlowSize(2, 4), EnergyFlowRegistration.DefaultSize);
        Assert.Equal(new EnergyFlowSize(2, 4), EnergyFlowRegistration.MinSize);
        Assert.Equal(new EnergyFlowSize(4, 40), EnergyFlowRegistration.MaxSize);
        Assert.Equal("Energy Flow", EnergyFlowRegistration.Name(Localizer));
        Assert.Equal("Live power flow diagram", EnergyFlowRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(2, 4, true)]    // min == default
    [InlineData(4, 40, true)]   // max
    [InlineData(3, 20, true)]   // inside
    [InlineData(1, 4, false)]   // below min cols
    [InlineData(2, 3, false)]   // below min rows
    [InlineData(5, 4, false)]   // above max cols
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, EnergyFlowRegistration.IsWithinBounds(new EnergyFlowSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new EnergyFlowSize(2, 4), EnergyFlowRegistration.Clamp(new EnergyFlowSize(0, 0)));
        Assert.Equal(new EnergyFlowSize(4, 40), EnergyFlowRegistration.Clamp(new EnergyFlowSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new EnergyFlowDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EnergyFlowWidget", Assert.Single(lines));
    }

    // ---- Source (single-endpoint per-vehicle adapter) ------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new EnergyFlowSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_state()
    {
        using var state = JsonDocument.Parse(ConsumingStateJson);
        var api = new FakeApiClient().ReturnsValue(state.RootElement);
        var source = new EnergyFlowSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(25.5, terminal.Value!.State.Power);
        Assert.Equal(80, terminal.Value.State.BatteryLevel);

        Assert.Equal("get_api_v1_vehicles_vehicleID_state", Assert.Single(api.Requests).OperationId);
        Assert.Equal("7", api.Requests[0].PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var state = JsonDocument.Parse("""{"state":{"vehicle_id":42,"power":3,"battery_level":50}}""");
        var api = new FakeApiClient().ReturnsValue(state.RootElement);
        var source = new EnergyFlowSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal("42", api.Requests[^1].PathParams!["vehicleID"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_stateless_body_collapses_to_empty()
    {
        using var state = JsonDocument.Parse("""{"live":false}""");
        var api = new FakeApiClient().ReturnsValue(state.RootElement);
        var source = new EnergyFlowSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static EnergyFlowSnapshot Consuming() => Snapshot(power: 25.5, batteryLevel: 80);

    private static EnergyFlowSnapshot Charging() =>
        new(new EnergyFlowVehicleState(Power: 0, IsCharging: true, ChargerPowerKw: 11.0, BatteryLevel: 55));

    private static EnergyFlowSnapshot Snapshot(double power, bool isCharging = false, double chargerPower = 0, double batteryLevel = 70) =>
        new(new EnergyFlowVehicleState(power, isCharging, chargerPower, batteryLevel));

    private static EnergyFlowNode Node(EnergyFlowDisplay display, string id) =>
        display.Nodes.First(n => n.Id == id);

    private static EnergyFlowArrow Arrow(EnergyFlowDisplay display, string from, string to) =>
        display.Arrows.First(a => a.FromId == from && a.ToId == to);

    private static RepositoryResult<EnergyFlowSnapshot> Loaded(EnergyFlowSnapshot snapshot) =>
        RepositoryResult<EnergyFlowSnapshot>.Loaded(snapshot, Now);

    private static async Task<List<RepositoryResult<EnergyFlowSnapshot>>> Drain(IEnergyFlowSource source)
    {
        var list = new List<RepositoryResult<EnergyFlowSnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static EnergyFlowViewModel NewViewModel(params RepositoryResult<EnergyFlowSnapshot>[] emissions) =>
        new(new FakeEnergyFlowSource(emissions), Localizer);

    private sealed class FakeEnergyFlowSource(params RepositoryResult<EnergyFlowSnapshot>[] emissions) : IEnergyFlowSource
    {
        public async IAsyncEnumerable<RepositoryResult<EnergyFlowSnapshot>> StreamAsync(
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
            Task.FromResult<WidgetVehicleSnapshot?>(null);
    }
}
