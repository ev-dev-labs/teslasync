using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets.EnergyFlowAnimated;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the EnergyFlowAnimatedWidget's UI-thread-free logic — the JSON parse adapter (the
/// useVehicleState normalisation reading power/charger_power/battery_level/is_charging), the percent / power
/// formatters, the flow geometry (coords, stroke width, arrow segments), the compact / diagram projection
/// across footprints, the result mapper, the single-endpoint per-vehicle data source, the registry metadata,
/// the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline). Mirrors the web spec (web/src/features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx).
/// </summary>
public sealed class EnergyFlowAnimatedWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string DrivingStateJson =
        """{"state":{"vehicle_id":7,"power":25.5,"charger_power":0,"battery_level":72,"is_charging":false}}""";

    private const string RegenStateJson =
        """{"state":{"vehicle_id":7,"power":-15,"charger_power":0,"battery_level":80,"is_charging":false}}""";

    private const string ChargingStateJson =
        """{"state":{"vehicle_id":7,"power":0,"charger_power":11,"battery_level":55,"is_charging":true}}""";

    private const string IdleStateJson =
        """{"state":{"vehicle_id":7,"power":0,"charger_power":0,"battery_level":60,"is_charging":false}}""";

    // ---- Parse adapter (web useVehicleState normalisation) -------------------------

    [Fact]
    public void FromResponse_reads_primary_state_object_with_all_flow_fields()
    {
        using var doc = JsonDocument.Parse(DrivingStateJson);

        var state = VehicleEnergyFlowState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(25.5, state!.PowerKw);
        Assert.Equal(0, state.ChargerPowerKw);
        Assert.Equal(72, state.BatteryLevel);
        Assert.False(state.IsCharging);
    }

    [Fact]
    public void FromResponse_reads_charging_fields()
    {
        using var doc = JsonDocument.Parse(ChargingStateJson);

        var state = VehicleEnergyFlowState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(11, state!.ChargerPowerKw);
        Assert.True(state.IsCharging);
        Assert.Equal(55, state.BatteryLevel);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1}}""");

        var state = VehicleEnergyFlowState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(0, state!.PowerKw);
        Assert.Equal(0, state.ChargerPowerKw);
        Assert.Equal(0, state.BatteryLevel);
        Assert.False(state.IsCharging);
    }

    [Fact]
    public void FromResponse_falls_back_to_position_power_battery_and_top_level_charging()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle":{"id":5},"position":{"power":-8,"battery_level":33},"is_charging":true,"charger_power":7}""");

        var state = VehicleEnergyFlowState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(-8, state!.PowerKw);
        Assert.Equal(33, state.BatteryLevel);
        Assert.True(state.IsCharging);
        Assert.Equal(7, state.ChargerPowerKw);
    }

    [Fact]
    public void FromResponse_uses_plain_state_object_when_no_vehicle_or_position()
    {
        using var doc = JsonDocument.Parse("""{"state":{"power":12,"battery_level":42,"is_charging":false}}""");

        var state = VehicleEnergyFlowState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(12, state!.PowerKw);
        Assert.Equal(42, state.BatteryLevel);
    }

    [Fact]
    public void FromResponse_returns_null_when_no_state()
    {
        using var doc = JsonDocument.Parse("""{"live":true}""");
        Assert.Null(VehicleEnergyFlowState.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(VehicleEnergyFlowState.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_reads_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"power":"18.5","battery_level":"64","is_charging":"true"}}""");

        var state = VehicleEnergyFlowState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(18.5, state!.PowerKw);
        Assert.Equal(64, state.BatteryLevel);
        Assert.True(state.IsCharging);
    }

    // ---- Scalar formatters ---------------------------------------------------------

    [Theory]
    [InlineData(72, "72%")]
    [InlineData(72.5, "72.5%")]
    [InlineData(0, "0%")]
    public void FormatPercent_matches_web_interpolation(double value, string expected) =>
        Assert.Equal(expected, EnergyFlowProjection.FormatPercent(value));

    [Theory]
    [InlineData(25.5, 1, "25.5 kW")]
    [InlineData(7.2, 1, "7.2 kW")]
    [InlineData(0, 1, "0.0 kW")]
    [InlineData(11, 0, "11 kW")]
    [InlineData(7.2, 0, "7 kW")]
    public void FormatPower_matches_web(double value, int precision, string expected) =>
        Assert.Equal(expected, EnergyFlowProjection.FormatPower(value, precision));

    // ---- Geometry (web WidgetFlowDiagram math) -------------------------------------

    [Theory]
    [InlineData(EnergyFlowPosition.Top, 50, 12)]
    [InlineData(EnergyFlowPosition.Bottom, 50, 88)]
    [InlineData(EnergyFlowPosition.Left, 12, 50)]
    [InlineData(EnergyFlowPosition.Right, 88, 50)]
    [InlineData(EnergyFlowPosition.Center, 50, 50)]
    public void Geometry_coord_matches_web_position_coords(EnergyFlowPosition position, double x, double y)
    {
        var point = EnergyFlowGeometry.Coord(position);
        Assert.Equal(x, point.X);
        Assert.Equal(y, point.Y);
    }

    [Fact]
    public void Geometry_stroke_scales_between_min_and_max()
    {
        Assert.Equal(EnergyFlowGeometry.MinStroke, EnergyFlowGeometry.StrokeForValue(0, 25));
        Assert.Equal(EnergyFlowGeometry.MaxStroke, EnergyFlowGeometry.StrokeForValue(25, 25));
        Assert.Equal(EnergyFlowGeometry.MinStroke, EnergyFlowGeometry.StrokeForValue(10, 0)); // web maxValue===0 guard
        Assert.Equal(2.5, EnergyFlowGeometry.StrokeForValue(12.5, 25)); // 1 + 0.5*(4-1)
    }

    [Fact]
    public void Geometry_max_arrow_value_is_at_least_one()
    {
        var arrows = new[]
        {
            new EnergyFlowArrow("battery", "drive", 0, false, StatusKind.Info),
            new EnergyFlowArrow("drive", "battery", 0, false, StatusKind.Success),
        };
        Assert.Equal(1, EnergyFlowGeometry.MaxArrowValue(arrows));

        var busy = new[] { new EnergyFlowArrow("a", "b", 18, true, StatusKind.Warning) };
        Assert.Equal(18, EnergyFlowGeometry.MaxArrowValue(busy));
    }

    [Fact]
    public void Geometry_segment_offsets_endpoints_by_node_radius()
    {
        var from = EnergyFlowGeometry.Coord(EnergyFlowPosition.Left);  // (12, 50)
        var to = EnergyFlowGeometry.Coord(EnergyFlowPosition.Right);   // (88, 50)

        var seg = EnergyFlowGeometry.Segment(from, to, EnergyFlowGeometry.NodeRadius);

        Assert.Equal(26, seg.X1); // 12 + 14
        Assert.Equal(50, seg.Y1);
        Assert.Equal(74, seg.X2); // 88 - 14
        Assert.Equal(50, seg.Y2);
    }

    // ---- Size flags (web isCompact = cols < 2) -------------------------------------

    [Theory]
    [InlineData(2, 4, false)] // default
    [InlineData(1, 4, true)]  // compact (below min, but the branch still exists in the web source)
    [InlineData(3, 40, false)] // max footprint
    public void Size_compact_flag_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new EnergyFlowSize(cols, rows).IsCompact);

    // ---- Projection: driving (consuming) -------------------------------------------

    [Fact]
    public void Project_driving_builds_consuming_flow()
    {
        var view = Project(DrivingStateJson, EnergyFlowSize.Default);

        Assert.False(view.IsCompact);
        Assert.True(view.IsConsuming);
        Assert.False(view.IsRegen);
        Assert.False(view.IsCharging);
        Assert.False(view.IsIdle);
        Assert.Equal("72%", view.BatteryPercentText);

        var drive = Node(view, EnergyFlowProjection.DriveNodeId);
        Assert.Equal("Drive", drive.Label);
        Assert.Equal("25.5 kW", drive.FormattedValue);
        Assert.Equal(25.5, drive.Value);

        var batteryToDrive = Arrow(view, EnergyFlowProjection.BatteryNodeId, EnergyFlowProjection.DriveNodeId);
        Assert.True(batteryToDrive.Active);
        Assert.Equal(25.5, batteryToDrive.Value);
        Assert.Equal(StatusKind.Info, batteryToDrive.Color);

        Assert.False(Arrow(view, EnergyFlowProjection.ChargerNodeId, EnergyFlowProjection.BatteryNodeId).Active);
    }

    [Fact]
    public void Project_driving_charger_node_is_em_dash()
    {
        var view = Project(DrivingStateJson, EnergyFlowSize.Default);
        var charger = Node(view, EnergyFlowProjection.ChargerNodeId);

        Assert.Equal("Charger", charger.Label);
        Assert.Equal(EnergyFlowProjection.EmDash, charger.FormattedValue);
    }

    // ---- Projection: regen ---------------------------------------------------------

    [Fact]
    public void Project_regen_builds_drive_to_battery_flow()
    {
        var view = Project(RegenStateJson, EnergyFlowSize.Default);

        Assert.True(view.IsRegen);
        Assert.False(view.IsConsuming);

        var drive = Node(view, EnergyFlowProjection.DriveNodeId);
        Assert.Equal("Regen", drive.Label);
        Assert.Equal("15.0 kW", drive.FormattedValue); // |−15|
        Assert.Equal(15, drive.Value);

        var driveToBattery = Arrow(view, EnergyFlowProjection.DriveNodeId, EnergyFlowProjection.BatteryNodeId);
        Assert.True(driveToBattery.Active);
        Assert.Equal(15, driveToBattery.Value);
        Assert.Equal(StatusKind.Success, driveToBattery.Color);
    }

    // ---- Projection: charging ------------------------------------------------------

    [Fact]
    public void Project_charging_builds_charger_to_battery_flow()
    {
        var view = Project(ChargingStateJson, EnergyFlowSize.Default);

        Assert.True(view.IsCharging);
        Assert.False(view.IsConsuming);
        Assert.False(view.IsRegen);

        var charger = Node(view, EnergyFlowProjection.ChargerNodeId);
        Assert.Equal("11 kW", charger.FormattedValue); // fmtNumber(chargerPower, 0)
        Assert.Equal(11, charger.Value);

        var chargerToBattery = Arrow(view, EnergyFlowProjection.ChargerNodeId, EnergyFlowProjection.BatteryNodeId);
        Assert.True(chargerToBattery.Active);
        Assert.Equal(11, chargerToBattery.Value);
        Assert.Equal(StatusKind.Warning, chargerToBattery.Color);

        // Web parity: drive node falls back to the "Idle" label + em dash when neither consuming nor regen.
        var drive = Node(view, EnergyFlowProjection.DriveNodeId);
        Assert.Equal("Idle", drive.Label);
        Assert.Equal(EnergyFlowProjection.EmDash, drive.FormattedValue);
    }

    // ---- Projection: idle ----------------------------------------------------------

    [Fact]
    public void Project_idle_has_no_active_arrows()
    {
        var view = Project(IdleStateJson, EnergyFlowSize.Default);

        Assert.False(view.IsConsuming);
        Assert.False(view.IsRegen);
        Assert.False(view.IsCharging);
        Assert.True(view.IsIdle);
        Assert.Empty(view.CompactLines);
        Assert.All(view.Arrows, a => Assert.False(a.Active));

        var drive = Node(view, EnergyFlowProjection.DriveNodeId);
        Assert.Equal("Idle", drive.Label);
        Assert.Equal(EnergyFlowProjection.EmDash, drive.FormattedValue);
    }

    [Fact]
    public void Project_battery_node_always_present_with_percent()
    {
        var view = Project(IdleStateJson, EnergyFlowSize.Default);
        var battery = Node(view, EnergyFlowProjection.BatteryNodeId);

        Assert.Equal("Battery", battery.Label);
        Assert.Equal("60%", battery.FormattedValue);
        Assert.Equal(EnergyFlowPosition.Left, battery.Position);
    }

    [Fact]
    public void Project_node_positions_match_web()
    {
        var view = Project(DrivingStateJson, EnergyFlowSize.Default);
        Assert.Equal(EnergyFlowPosition.Left, Node(view, EnergyFlowProjection.BatteryNodeId).Position);
        Assert.Equal(EnergyFlowPosition.Right, Node(view, EnergyFlowProjection.DriveNodeId).Position);
        Assert.Equal(EnergyFlowPosition.Top, Node(view, EnergyFlowProjection.ChargerNodeId).Position);
    }

    // ---- Projection: compact rows (web CompactView) --------------------------------

    [Fact]
    public void Project_compact_driving_shows_single_cyan_row()
    {
        var view = Project(DrivingStateJson, new EnergyFlowSize(1, 4));

        Assert.True(view.IsCompact);
        var line = Assert.Single(view.CompactLines);
        Assert.Equal(StatusKind.Info, line.Color);
        Assert.Equal("25.5 kW", line.Value);
        Assert.Equal(EnergyFlowProjection.ZapGlyph, line.Glyph);
    }

    [Fact]
    public void Project_compact_charging_uses_one_decimal_power()
    {
        // Web parity: CompactView uses fmtNumber(chargerPower, 1) (vs. the diagram's 0 decimals).
        var view = Project(ChargingStateJson, new EnergyFlowSize(1, 4));

        var line = Assert.Single(view.CompactLines);
        Assert.Equal(StatusKind.Warning, line.Color);
        Assert.Equal("11.0 kW", line.Value);
        Assert.Equal(EnergyFlowProjection.PlugGlyph, line.Glyph);
    }

    [Fact]
    public void Project_compact_combined_charging_and_driving_shows_both_rows()
    {
        const string json =
            """{"state":{"vehicle_id":7,"power":20,"charger_power":11,"battery_level":50,"is_charging":true}}""";
        var view = Project(json, new EnergyFlowSize(1, 4));

        Assert.Equal(2, view.CompactLines.Count);
        Assert.Equal(StatusKind.Warning, view.CompactLines[0].Color); // charging first (web order)
        Assert.Equal(StatusKind.Info, view.CompactLines[1].Color);    // then consuming
        Assert.False(view.IsIdle);
    }

    [Fact]
    public void Project_compact_idle_has_no_rows()
    {
        var view = Project(IdleStateJson, new EnergyFlowSize(1, 4));
        Assert.Empty(view.CompactLines);
        Assert.True(view.IsIdle);
    }

    // ---- Accessibility (Narrator names) --------------------------------------------

    [Fact]
    public void Project_automation_name_summarises_driving()
    {
        var view = Project(DrivingStateJson, EnergyFlowSize.Default);
        Assert.Contains("Battery 72%", view.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Drive 25.5 kW", view.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_automation_name_summarises_charging()
    {
        var view = Project(ChargingStateJson, EnergyFlowSize.Default);
        Assert.Contains("Battery 55%", view.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Charger 11 kW", view.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_automation_name_summarises_idle()
    {
        var view = Project(IdleStateJson, EnergyFlowSize.Default);
        Assert.Contains("Battery 60%", view.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Idle", view.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_nodes_and_compact_lines_carry_automation_names()
    {
        var view = Project(DrivingStateJson, EnergyFlowSize.Default);
        Assert.Equal("Battery 72%", Node(view, EnergyFlowProjection.BatteryNodeId).AutomationName);
        Assert.Equal("Drive 25.5 kW", Node(view, EnergyFlowProjection.DriveNodeId).AutomationName);

        var compact = Project(DrivingStateJson, new EnergyFlowSize(1, 4));
        Assert.Equal("Drive 25.5 kW", Assert.Single(compact.CompactLines).AutomationName);
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_state()
    {
        using var doc = JsonDocument.Parse(DrivingStateJson);

        var cached = EnergyFlowResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(25.5, cached.Value!.State.PowerKw);

        var offline = EnergyFlowResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(72, offline.Value!.State.BatteryLevel);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(DrivingStateJson);

        Assert.Equal(LoadStatus.Loaded, EnergyFlowResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, EnergyFlowResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, EnergyFlowResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_stateless_loaded_body_to_empty()
    {
        // Web parity: a successful response with no `state` makes stateData?.state undefined -> the empty surface.
        using var doc = JsonDocument.Parse("""{"live":false}""");

        var mapped = EnergyFlowResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<EnergyFlowSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_flow_display()
    {
        using var vm = NewViewModel(Loaded(DrivingSnapshot()));
        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Loaded, vm.State);
        Assert.True(vm.HasState);
        Assert.NotNull(vm.Display);
        Assert.True(vm.Display!.IsConsuming);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<EnergyFlowSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Empty, vm.State);
        Assert.False(vm.HasState);
        Assert.Null(vm.Display);
        Assert.Equal("No energy data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<EnergyFlowSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<EnergyFlowSnapshot>.Cached(DrivingSnapshot(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasState);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<EnergyFlowSnapshot>.OfflineCached(
            IdleSnapshot(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Offline, vm.State);
        Assert.True(vm.HasState);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display!.IsIdle);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<EnergyFlowSnapshot>.Loading(),
            RepositoryResult<EnergyFlowSnapshot>.Cached(IdleSnapshot(), Now, stale: false),
            RepositoryResult<EnergyFlowSnapshot>.Loaded(DrivingSnapshot(), Now));
        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Loaded, vm.State);
        Assert.True(vm.Display!.IsConsuming);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(EnergyFlowSize.Default, Loaded(DrivingSnapshot()));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);

        vm.Size = new EnergyFlowSize(1, 4);
        Assert.True(vm.Display!.IsCompact);
        Assert.Equal(EnergyFlowState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<EnergyFlowSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Energy Flow", vm.Title);
        Assert.Equal("No energy data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(DrivingSnapshot()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(EnergyFlowAnimatedViewModel.State), changed);
        Assert.Contains(nameof(EnergyFlowAnimatedViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("energy-flow-animated", EnergyFlowAnimatedRegistration.Id);
        Assert.Equal("energy", EnergyFlowAnimatedRegistration.Category);
        Assert.Equal("EnergyFlowAnimatedWidget", EnergyFlowAnimatedRegistration.Slug);
        Assert.Equal(new EnergyFlowSize(2, 4), EnergyFlowAnimatedRegistration.DefaultSize);
        Assert.Equal(new EnergyFlowSize(2, 4), EnergyFlowAnimatedRegistration.MinSize);
        Assert.Equal(new EnergyFlowSize(3, 40), EnergyFlowAnimatedRegistration.MaxSize);
        Assert.Equal("Energy Flow Animated", EnergyFlowAnimatedRegistration.Name(Localizer));
        Assert.Contains("energy flow", EnergyFlowAnimatedRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]    // min/default
    [InlineData(3, 40, true)]   // max
    [InlineData(2, 10, true)]   // inside
    [InlineData(1, 4, false)]   // below min cols
    [InlineData(4, 4, false)]   // above max cols
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, EnergyFlowAnimatedRegistration.IsWithinBounds(new EnergyFlowSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new EnergyFlowSize(2, 4), EnergyFlowAnimatedRegistration.Clamp(new EnergyFlowSize(0, 0)));
        Assert.Equal(new EnergyFlowSize(3, 40), EnergyFlowAnimatedRegistration.Clamp(new EnergyFlowSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new EnergyFlowAnimatedDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EnergyFlowAnimatedWidget", Assert.Single(lines));
    }

    // ---- Source (single-endpoint per-vehicle adapter) ------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new EnergyFlowAnimatedSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_state()
    {
        using var state = JsonDocument.Parse(DrivingStateJson);
        var api = new FakeApiClient().ReturnsValue(state.RootElement);
        var source = new EnergyFlowAnimatedSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(72, terminal.Value!.State.BatteryLevel);
        Assert.Equal(25.5, terminal.Value.State.PowerKw);

        Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_state", api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var state = JsonDocument.Parse("""{"state":{"vehicle_id":42,"power":0,"battery_level":50,"is_charging":false}}""");
        var api = new FakeApiClient().ReturnsValue(state.RootElement);
        var source = new EnergyFlowAnimatedSource(
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
        var source = new EnergyFlowAnimatedSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static EnergyFlowDisplay Project(string json, EnergyFlowSize size)
    {
        using var doc = JsonDocument.Parse(json);
        var state = VehicleEnergyFlowState.FromResponse(doc.RootElement);
        Assert.NotNull(state);
        return EnergyFlowProjection.Project(new EnergyFlowSnapshot(state!), size, Localizer);
    }

    private static EnergyFlowNode Node(EnergyFlowDisplay view, string id) =>
        view.Nodes.Single(n => n.Id == id);

    private static EnergyFlowArrow Arrow(EnergyFlowDisplay view, string from, string to) =>
        view.Arrows.Single(a => a.From == from && a.To == to);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static EnergyFlowSnapshot DrivingSnapshot() => new(new VehicleEnergyFlowState(25.5, 0, 72, false));

    private static EnergyFlowSnapshot IdleSnapshot() => new(new VehicleEnergyFlowState(0, 0, 60, false));

    private static async Task<List<RepositoryResult<EnergyFlowSnapshot>>> Drain(IEnergyFlowAnimatedSource source)
    {
        var list = new List<RepositoryResult<EnergyFlowSnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<EnergyFlowSnapshot> Loaded(EnergyFlowSnapshot snapshot) =>
        RepositoryResult<EnergyFlowSnapshot>.Loaded(snapshot, Now);

    private static EnergyFlowAnimatedViewModel NewViewModel(params RepositoryResult<EnergyFlowSnapshot>[] emissions) =>
        NewViewModel(EnergyFlowSize.Default, emissions);

    private static EnergyFlowAnimatedViewModel NewViewModel(
        EnergyFlowSize size,
        params RepositoryResult<EnergyFlowSnapshot>[] emissions) =>
        new(new FakeEnergyFlowAnimatedSource(emissions), Localizer, size);

    private sealed class FakeEnergyFlowAnimatedSource(params RepositoryResult<EnergyFlowSnapshot>[] emissions) : IEnergyFlowAnimatedSource
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
            Task.FromResult(primary);
    }
}
