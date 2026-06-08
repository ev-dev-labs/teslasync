using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Vehicles;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the DigitalTwinWidget's UI-thread-free logic — the Tesla signal parsers + the
/// buildTwinState merge (doors / windows / lock / sentry / lights / charge / drive), the badge-cluster projection,
/// the three-source combine mapper, the concurrent per-vehicle data source (primary resolution, the three scoped
/// reads), the registry metadata, the diagnostics, and the state-holder view-model's per-state transitions
/// (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/DigitalTwinWidget.tsx + web/src/lib/vehicleState.ts).
/// </summary>
public sealed class DigitalTwinWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);
    private static readonly DigitalTwinIdentity Identity = new("Model 3", "5YJ3VIN", null);

    private const string SecurityOperation = "get_api_v1_security_latest";

    private const string SecuritySecure =
        """{"locked":true,"sentry_mode":false,"door_state":"closed","windows_open":"closed","fd_window":"closed","fp_window":"closed","rd_window":"closed","rp_window":"closed","lights_high_beams":false,"lights_hazards_active":false}""";

    private const string SecurityActive =
        """{"locked":false,"sentry_mode":true,"door_state":{"DriverFront":true,"PassengerFront":false,"DriverRear":false,"PassengerRear":false,"TrunkFront":true,"TrunkRear":false},"windows_open":"fd","fd_window":"open","fp_window":"closed","rd_window":"closed","rp_window":"closed","lights_high_beams":true,"lights_hazards_active":true,"lights_turn_signal":"left"}""";

    private const string StateParked =
        """{"state":{"vehicle_id":7,"state":"online","is_charging":false,"is_locked":true,"sentry_mode":false,"speed":0,"charger_power":0}}""";

    private const string StateDriving =
        """{"state":{"vehicle_id":7,"state":"driving","is_charging":true,"speed":35,"charger_power":0}}""";

    private const string ChargingIdle =
        """{"charging_state":"Disconnected","charger_power_kw":0,"charge_port_door_open":false}""";

    private const string ChargingActive =
        """{"charging_state":"Charging","charger_power_kw":11,"charge_port_door_open":true}""";

    // ---- Door parser (web parseDoorState) ------------------------------------------

    [Fact]
    public void ParseDoorState_reads_object_payload()
    {
        using var doc = JsonDocument.Parse("""{"DriverFront":true,"PassengerRear":false,"TrunkFront":true}""");
        var doors = DigitalTwinSignals.ParseDoorState(doc.RootElement);

        Assert.True(doors.DriverFront);
        Assert.False(doors.PassengerRear);
        Assert.True(doors.TrunkFront);
        Assert.Null(doors.DriverRear);
    }

    [Fact]
    public void ParseDoorState_closed_shorthand_is_all_closed_with_unknown_lids()
    {
        using var doc = JsonDocument.Parse("\"closed\"");
        var doors = DigitalTwinSignals.ParseDoorState(doc.RootElement);

        Assert.False(doors.DriverFront);
        Assert.False(doors.PassengerFront);
        Assert.False(doors.DriverRear);
        Assert.False(doors.PassengerRear);
        Assert.Null(doors.TrunkFront);
        Assert.Null(doors.TrunkRear);
    }

    [Fact]
    public void ParseDoorState_descriptive_string_matches_positions()
    {
        using var doc = JsonDocument.Parse("\"OpenDriverFront\"");
        var doors = DigitalTwinSignals.ParseDoorState(doc.RootElement);

        Assert.True(doors.DriverFront);
        Assert.Null(doors.PassengerFront);
    }

    [Fact]
    public void ParseDoorState_json_string_payload_is_parsed()
    {
        using var doc = JsonDocument.Parse("""{"door_state":"{\"DriverRear\":true}"}""");
        var doors = DigitalTwinSignals.ParseDoorState(doc.RootElement.GetProperty("door_state"));

        Assert.True(doors.DriverRear);
        Assert.Null(doors.DriverFront);
    }

    [Fact]
    public void ParseDoorState_non_string_is_all_unknown()
    {
        using var doc = JsonDocument.Parse("123");
        var doors = DigitalTwinSignals.ParseDoorState(doc.RootElement);

        Assert.Null(doors.DriverFront);
        Assert.Null(doors.TrunkRear);
    }

    // ---- Window parser (web parseWindowState / parseWindowOpenSummary) --------------

    [Theory]
    [InlineData("\"Closed\"", WindowPosition.Closed)]
    [InlineData("\"WindowStateOpened\"", WindowPosition.Open)]
    [InlineData("\"PartiallyOpen\"", WindowPosition.Partial)]
    [InlineData("\"vent\"", WindowPosition.Partial)]
    [InlineData("\"0\"", WindowPosition.Closed)]
    public void ParseWindow_normalises_enum_values(string json, WindowPosition expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, DigitalTwinSignals.ParseWindow(doc.RootElement));
    }

    [Fact]
    public void ParseWindow_unrecognised_is_null()
    {
        using var doc = JsonDocument.Parse("\"???\"");
        Assert.Null(DigitalTwinSignals.ParseWindow(doc.RootElement));
    }

    [Fact]
    public void ParseWindowSummary_matches_alias_or_closed()
    {
        using var open = JsonDocument.Parse("\"fd\"");
        using var closed = JsonDocument.Parse("\"closed\"");

        Assert.Equal(WindowPosition.Open, DigitalTwinSignals.ParseWindowSummary(open.RootElement, new[] { "fd" }));
        Assert.Equal(WindowPosition.Closed, DigitalTwinSignals.ParseWindowSummary(closed.RootElement, new[] { "fd" }));
        Assert.Null(DigitalTwinSignals.ParseWindowSummary(open.RootElement, new[] { "rp" }));
    }

    // ---- Drive / charge predicates (web isVehicleDriving / isChargingActive) --------

    [Theory]
    [InlineData("""{"state":"driving","speed":0}""", true)]
    [InlineData("""{"state":"online","speed":42}""", true)]
    [InlineData("""{"state":"online","speed":0}""", false)]
    public void IsDriving_matches_state_or_speed(string json, bool expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, DigitalTwinSignals.IsDriving(doc.RootElement));
    }

    [Fact]
    public void IsChargingActive_reads_state_or_telemetry()
    {
        using var stateOn = JsonDocument.Parse("""{"is_charging":true}""");
        using var statePower = JsonDocument.Parse("""{"charger_power":5}""");
        using var chargingKw = JsonDocument.Parse("""{"charger_power_kw":11}""");
        using var chargingState = JsonDocument.Parse("""{"charging_state":"Charging"}""");
        using var idle = JsonDocument.Parse("""{"charging_state":"Disconnected","charger_power_kw":0}""");

        Assert.True(DigitalTwinSignals.IsChargingActive(stateOn.RootElement, null));
        Assert.True(DigitalTwinSignals.IsChargingActive(statePower.RootElement, null));
        Assert.True(DigitalTwinSignals.IsChargingActive(null, chargingKw.RootElement));
        Assert.True(DigitalTwinSignals.IsChargingActive(null, chargingState.RootElement));
        Assert.False(DigitalTwinSignals.IsChargingActive(null, idle.RootElement));
    }

    // ---- Merge (web buildTwinState) ------------------------------------------------

    [Fact]
    public void Merge_secure_parked_vehicle_is_locked_closed_idle()
    {
        var reading = MergeJson(StateParked, SecuritySecure, ChargingIdle);
        var model = reading.Model;

        Assert.True(model.Locked);
        Assert.False(model.SentryMode);
        Assert.False(model.IsCharging);
        Assert.False(model.IsDriving);
        Assert.Equal(WindowPosition.Closed, model.WindowDriverFront);
        Assert.False(model.ChargePortOpen);
        Assert.False(reading.Hazards);
        Assert.Equal("Model 3", reading.Caption);
    }

    [Fact]
    public void Merge_active_vehicle_reflects_every_signal()
    {
        var reading = MergeJson(StateDriving, SecurityActive, ChargingActive);
        var model = reading.Model;

        Assert.False(model.Locked);
        Assert.True(model.SentryMode);
        Assert.True(model.IsCharging);
        Assert.True(model.IsDriving);
        Assert.True(model.DoorDriverFront);
        Assert.True(model.FrunkOpen);
        Assert.False(model.TrunkOpen);
        Assert.Equal(WindowPosition.Open, model.WindowDriverFront);
        Assert.True(model.Headlights);
        Assert.True(model.ChargePortOpen);
        Assert.Equal(TurnSignal.Left, model.TurnSignal);
        Assert.True(reading.Hazards);
    }

    [Fact]
    public void Merge_lock_falls_back_to_vehicle_state_when_security_absent()
    {
        var reading = MergeJson(StateParked, security: null, charging: null);
        Assert.True(reading.Model.Locked); // from state.is_locked
    }

    [Fact]
    public void Merge_all_absent_is_all_unknown_twin()
    {
        var reading = MergeJson(state: null, security: null, charging: null);
        var model = reading.Model;

        Assert.Null(model.Locked);
        Assert.Null(model.SentryMode);
        Assert.False(model.IsCharging);
        Assert.False(model.IsDriving);
        Assert.Equal(WindowPosition.Unknown, model.WindowDriverFront);
        Assert.Null(model.FrunkOpen);
        Assert.Equal("Model 3", reading.Caption);
    }

    [Fact]
    public void Merge_caption_falls_back_to_vin_then_empty()
    {
        var vinOnly = DigitalTwinSignals.Merge(new DigitalTwinIdentity("", "5YJVIN", null), null, null, null);
        Assert.Equal("5YJVIN", vinOnly.Caption);

        var neither = DigitalTwinSignals.Merge(new DigitalTwinIdentity("", null, null), null, null, null);
        Assert.Equal(string.Empty, neither.Caption);
    }

    [Fact]
    public void ExtractState_unwraps_nested_state_object()
    {
        using var wrapped = JsonDocument.Parse(StateParked);
        var inner = DigitalTwinSignals.ExtractState(wrapped.RootElement);
        Assert.NotNull(inner);
        Assert.True(inner!.Value.TryGetProperty("is_locked", out _));
    }

    // ---- Projection: badge cluster (web Badge cluster) -----------------------------

    [Fact]
    public void Project_secure_parked_shows_lock_and_windows_only()
    {
        var display = Project(MergeJson(StateParked, SecuritySecure, ChargingIdle));

        Assert.Equal(2, display.Badges.Count);
        Assert.Equal("lock", display.Badges[0].Kind);
        Assert.Equal("Locked", display.Badges[0].Text);
        Assert.Equal(StatusKind.Success, display.Badges[0].Variant);
        Assert.Equal("windows", display.Badges[1].Kind);
        Assert.Equal("Windows Closed", display.Badges[1].Text);
        Assert.Equal(StatusKind.Success, display.Badges[1].Variant);
    }

    [Fact]
    public void Project_active_vehicle_shows_full_ordered_cluster()
    {
        var display = Project(MergeJson(StateDriving, SecurityActive, ChargingActive));
        var kinds = display.Badges.Select(b => b.Kind).ToArray();

        Assert.Equal(
            new[] { "lock", "windows", "driving", "charging", "sentry", "headlights", "hazards", "doors", "frunk" },
            kinds);

        Assert.Equal("Unlocked", display.Badges[0].Text);
        Assert.Equal(StatusKind.Danger, display.Badges[0].Variant);
        Assert.Equal(DigitalTwinProjection.UnlockGlyph, display.Badges[0].Glyph);
        Assert.Equal("1 Open", display.Badges[1].Text);
        Assert.Equal(StatusKind.Warning, display.Badges[1].Variant);
        Assert.Equal("1 Doors Open", display.Badges.Single(b => b.Kind == "doors").Text);
        Assert.Equal("Frunk Open", display.Badges.Single(b => b.Kind == "frunk").Text);
        Assert.DoesNotContain(display.Badges, b => b.Kind == "trunk");
    }

    [Fact]
    public void Project_lock_unknown_uses_neutral_variant()
    {
        var display = Project(MergeJson(state: null, security: null, charging: null));

        var lockBadge = display.Badges[0];
        Assert.Equal("Lock Unknown", lockBadge.Text);
        Assert.Equal(StatusKind.Neutral, lockBadge.Variant);
        Assert.Equal(DigitalTwinProjection.LockGlyph, lockBadge.Glyph);

        var windowBadge = display.Badges[1];
        Assert.Equal("Windows Unknown", windowBadge.Text);
        Assert.Equal(StatusKind.Neutral, windowBadge.Variant);
    }

    [Fact]
    public void Project_dot_badges_are_marked_for_driving_charging_sentry_lights_hazards()
    {
        var display = Project(MergeJson(StateDriving, SecurityActive, ChargingActive));

        foreach (var kind in new[] { "driving", "charging", "sentry", "headlights", "hazards" })
        {
            Assert.True(display.Badges.Single(b => b.Kind == kind).Dot, kind);
        }

        Assert.False(display.Badges.Single(b => b.Kind == "doors").Dot);
    }

    [Fact]
    public void Project_automation_name_contains_caption_and_chip_labels()
    {
        var display = Project(MergeJson(StateDriving, SecurityActive, ChargingActive));

        Assert.Contains("Model 3", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Unlocked", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Charging", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Frunk Open", display.AutomationName, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(2, 4, false)]
    [InlineData(3, 4, true)]
    [InlineData(2, 5, true)]
    public void Project_large_twin_threshold_matches_web(int cols, int rows, bool large)
    {
        var display = DigitalTwinProjection.Project(MergeJson(StateParked, SecuritySecure, ChargingIdle), new DigitalTwinSize(cols, rows), Localizer);
        Assert.Equal(large, display.LargeTwin);
    }

    // ---- Combine mapper (three-source merge + freshness) ---------------------------

    [Fact]
    public void Combine_all_loaded_is_loaded_with_merged_reading()
    {
        using var state = JsonDocument.Parse(StateDriving);
        using var security = JsonDocument.Parse(SecurityActive);
        using var charging = JsonDocument.Parse(ChargingActive);

        var result = DigitalTwinResultMapper.Combine(
            Identity,
            RepositoryResult<JsonElement>.Loaded(state.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(security.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(charging.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.NotNull(result.Value);
        Assert.False(result.Value!.Model.Locked);
        Assert.True(result.Value.Model.IsCharging);
    }

    [Fact]
    public void Combine_stale_contributor_is_cached_stale()
    {
        using var security = JsonDocument.Parse(SecuritySecure);

        var result = DigitalTwinResultMapper.Combine(
            Identity,
            RepositoryResult<JsonElement>.Cached(security.RootElement, Now, stale: true),
            RepositoryResult<JsonElement>.Cached(security.RootElement, Now, stale: true),
            charging: null);

        Assert.Equal(LoadStatus.Cached, result.Status);
        Assert.True(result.IsStale);
        Assert.NotNull(result.Value);
    }

    [Fact]
    public void Combine_offline_contributor_is_offline_with_twin()
    {
        using var security = JsonDocument.Parse(SecuritySecure);

        var result = DigitalTwinResultMapper.Combine(
            Identity,
            RepositoryResult<JsonElement>.OfflineCached(security.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
            RepositoryResult<JsonElement>.Loaded(security.RootElement, Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Offline, result.Status);
        Assert.NotNull(result.Value);
        Assert.True(result.Value!.Model.Locked);
    }

    [Fact]
    public void Combine_state_error_with_security_content_renders_twin_offline()
    {
        using var security = JsonDocument.Parse(SecuritySecure);

        var result = DigitalTwinResultMapper.Combine(
            Identity,
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            RepositoryResult<JsonElement>.Loaded(security.RootElement, Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Offline, result.Status);
        Assert.NotNull(result.Value);
    }

    [Fact]
    public void Combine_all_empty_still_renders_unknown_twin_as_loaded()
    {
        var result = DigitalTwinResultMapper.Combine(
            Identity,
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.NotNull(result.Value);
        Assert.Null(result.Value!.Model.Locked);
    }

    [Fact]
    public void Combine_all_hard_error_collapses_to_failure()
    {
        var result = DigitalTwinResultMapper.Combine(
            Identity,
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "a")),
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "b")),
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "c")));

        Assert.Equal(LoadStatus.Error, result.Status);
        Assert.Null(result.Value);
    }

    [Fact]
    public void Combine_charging_still_loading_uses_state_and_security_only()
    {
        using var state = JsonDocument.Parse(StateParked);
        using var security = JsonDocument.Parse(SecuritySecure);

        var result = DigitalTwinResultMapper.Combine(
            Identity,
            RepositoryResult<JsonElement>.Loaded(state.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(security.RootElement, Now),
            charging: null);

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.NotNull(result.Value);
        Assert.False(result.Value!.Model.IsCharging);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<DigitalTwinReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(DigitalTwinState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_twin_display()
    {
        using var vm = NewViewModel(Loaded(SampleReading()));
        await vm.LoadAsync();

        Assert.Equal(DigitalTwinState.Loaded, vm.State);
        Assert.True(vm.HasTwin);
        Assert.NotNull(vm.Display);
        Assert.Equal("Locked", vm.Display!.Badges[0].Text);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_no_vehicle_surface()
    {
        using var vm = NewViewModel(RepositoryResult<DigitalTwinReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(DigitalTwinState.Empty, vm.State);
        Assert.False(vm.HasTwin);
        Assert.Null(vm.Display);
        Assert.Equal("No vehicle data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<DigitalTwinReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(DigitalTwinState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_twin()
    {
        using var vm = NewViewModel(
            RepositoryResult<DigitalTwinReading>.Cached(SampleReading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(DigitalTwinState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasTwin);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_twin_and_error_chip()
    {
        using var vm = NewViewModel(RepositoryResult<DigitalTwinReading>.OfflineCached(
            SampleReading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(DigitalTwinState.Offline, vm.State);
        Assert.True(vm.HasTwin);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<DigitalTwinReading>.Loading(),
            RepositoryResult<DigitalTwinReading>.Cached(SampleReading(), Now, stale: false),
            RepositoryResult<DigitalTwinReading>.Loaded(SampleReading(), Now));
        await vm.LoadAsync();

        Assert.Equal(DigitalTwinState.Loaded, vm.State);
        Assert.True(vm.HasTwin);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_large_twin()
    {
        using var vm = new DigitalTwinViewModel(
            new FakeDigitalTwinSource(Loaded(SampleReading())), Localizer, new DigitalTwinSize(2, 4));
        await vm.LoadAsync();
        Assert.False(vm.Display!.LargeTwin);

        vm.Size = new DigitalTwinSize(3, 4);
        Assert.True(vm.Display!.LargeTwin);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<DigitalTwinReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Digital Twin", vm.Title);
        Assert.Equal("No vehicle data", vm.EmptyMessage);
        Assert.Equal("Open", vm.OpenLabel);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(SampleReading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DigitalTwinViewModel.State), changed);
        Assert.Contains(nameof(DigitalTwinViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("vehicle-twin", DigitalTwinRegistration.Id);
        Assert.Equal("vehicle", DigitalTwinRegistration.Category);
        Assert.Equal("DigitalTwinWidget", DigitalTwinRegistration.Slug);
        Assert.Equal(new DigitalTwinSize(2, 4), DigitalTwinRegistration.DefaultSize);
        Assert.Equal(new DigitalTwinSize(2, 4), DigitalTwinRegistration.MinSize);
        Assert.Equal(new DigitalTwinSize(3, 40), DigitalTwinRegistration.MaxSize);
        Assert.Equal("Digital Twin", DigitalTwinRegistration.Name(Localizer));
        Assert.Contains("doors", DigitalTwinRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void RegistryId_is_exposed_on_the_view_type() =>
        Assert.Equal("vehicle-twin", DigitalTwinRegistration.Id);

    [Theory]
    [InlineData(2, 4, true)]   // min
    [InlineData(3, 40, true)]  // max
    [InlineData(2, 20, true)]  // inside
    [InlineData(1, 4, false)]  // below min cols
    [InlineData(2, 3, false)]  // below min rows
    [InlineData(4, 4, false)]  // above max cols
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, DigitalTwinRegistration.IsWithinBounds(new DigitalTwinSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new DigitalTwinSize(2, 4), DigitalTwinRegistration.Clamp(new DigitalTwinSize(0, 0)));
        Assert.Equal(new DigitalTwinSize(3, 40), DigitalTwinRegistration.Clamp(new DigitalTwinSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DigitalTwinDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DigitalTwinWidget", Assert.Single(lines));
    }

    // ---- Source (concurrent three-endpoint per-vehicle adapter) --------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new KeyedFakeApiClient();
        var source = new DigitalTwinSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_then_merges_three_reads()
    {
        using var state = JsonDocument.Parse(StateDriving);
        using var security = JsonDocument.Parse(SecurityActive);
        using var charging = JsonDocument.Parse(ChargingActive);
        var api = new KeyedFakeApiClient()
            .Returns(Operations.Vehicles.State, state.RootElement)
            .Returns(SecurityOperation, security.RootElement)
            .Returns(Operations.Charging.TelemetryLatest, charging.RootElement);

        var source = new DigitalTwinSource(
            new FakeWidgetVehicleSource(Snapshot(7, "Model 3", "5YJVIN")),
            api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);
        var terminal = results[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.False(terminal.Value!.Model.Locked);
        Assert.True(terminal.Value.Model.IsCharging);
        Assert.Equal("Model 3", terminal.Value.Caption);

        Assert.Equal("7", StateRequest(api).PathParams!["vehicleID"]);
        Assert.Equal(7L, Convert.ToInt64(SecurityRequest(api).Query!["vehicle_id"], System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(7L, Convert.ToInt64(ChargingRequest(api).Query!["vehicle_id"], System.Globalization.CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_scopes_every_read()
    {
        using var state = JsonDocument.Parse(StateParked);
        using var security = JsonDocument.Parse(SecuritySecure);
        using var charging = JsonDocument.Parse(ChargingIdle);
        var api = new KeyedFakeApiClient()
            .Returns(Operations.Vehicles.State, state.RootElement)
            .Returns(SecurityOperation, security.RootElement)
            .Returns(Operations.Charging.TelemetryLatest, charging.RootElement);

        var source = new DigitalTwinSource(
            new FakeWidgetVehicleSource(Snapshot(42, "Garage Car", null)),
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await DrainAsync(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal("42", StateRequest(api).PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_total_failure_collapses_to_error()
    {
        var api = new KeyedFakeApiClient()
            .Throws(Operations.Vehicles.State, new HttpRequestException("down"))
            .Throws(SecurityOperation, new HttpRequestException("down"))
            .Throws(Operations.Charging.TelemetryLatest, new HttpRequestException("down"));

        var source = new DigitalTwinSource(
            new FakeWidgetVehicleSource(Snapshot(7, "Model 3", null)),
            api, NewEngine(), new ApiClientOptions());

        var results = await DrainAsync(source);

        Assert.Equal(LoadStatus.Error, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static WidgetVehicleSnapshot Snapshot(long id, string name, string? vin) =>
        new() { VehicleId = id, DisplayName = name, Vin = vin };

    private static DigitalTwinReading MergeJson(string? state, string? security, string? charging)
    {
        using var s = state is null ? null : JsonDocument.Parse(state);
        using var u = security is null ? null : JsonDocument.Parse(security);
        using var c = charging is null ? null : JsonDocument.Parse(charging);
        return DigitalTwinSignals.Merge(Identity, s?.RootElement, u?.RootElement, c?.RootElement);
    }

    private static DigitalTwinDisplay Project(DigitalTwinReading reading) =>
        DigitalTwinProjection.Project(reading, DigitalTwinSize.Default, Localizer);

    private static DigitalTwinReading SampleReading() => MergeJson(StateParked, SecuritySecure, ChargingIdle);

    private static RepositoryResult<DigitalTwinReading> Loaded(DigitalTwinReading reading) =>
        RepositoryResult<DigitalTwinReading>.Loaded(reading, Now);

    private static DigitalTwinViewModel NewViewModel(params RepositoryResult<DigitalTwinReading>[] emissions) =>
        new(new FakeDigitalTwinSource(emissions), Localizer, DigitalTwinSize.Default);

    private static async Task<List<RepositoryResult<DigitalTwinReading>>> DrainAsync(IDigitalTwinSource source)
    {
        var list = new List<RepositoryResult<DigitalTwinReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static ApiRequest StateRequest(KeyedFakeApiClient api) =>
        api.Requests.First(r => r.OperationId == Operations.Vehicles.State);

    private static ApiRequest SecurityRequest(KeyedFakeApiClient api) =>
        api.Requests.First(r => r.OperationId == SecurityOperation);

    private static ApiRequest ChargingRequest(KeyedFakeApiClient api) =>
        api.Requests.First(r => r.OperationId == Operations.Charging.TelemetryLatest);

    private sealed class FakeDigitalTwinSource(params RepositoryResult<DigitalTwinReading>[] emissions) : IDigitalTwinSource
    {
        public async IAsyncEnumerable<RepositoryResult<DigitalTwinReading>> StreamAsync(
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

    private sealed class KeyedFakeApiClient : IApiClient
    {
        private readonly Dictionary<string, Func<object?>> _responses = new(StringComparer.Ordinal);
        private readonly object _gate = new();

        public List<ApiRequest> Requests { get; } = new();

        public KeyedFakeApiClient Returns<T>(string operationId, T value)
        {
            _responses[operationId] = () => value;
            return this;
        }

        public KeyedFakeApiClient Throws(string operationId, Exception exception)
        {
            _responses[operationId] = () => throw exception;
            return this;
        }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            GeneratedApi.ApiEndpoints.All.First(e => e.OperationId == operationId);

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            lock (_gate)
            {
                Requests.Add(request);
            }

            if (!_responses.TryGetValue(request.OperationId, out var factory))
            {
                throw new InvalidOperationException($"No scripted response for {request.OperationId}");
            }

            return Task.FromResult((T)factory()!);
        }
    }
}
