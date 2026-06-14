using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Dashboard;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>GlancePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/dashboard/pages/GlancePage.tsx), the four-state matrix (loading / error / empty / success), the
/// SI-display-boundary unit formatting, the battery-colour threshold (web <c>batteryColor</c>), the
/// <c>getLocationLabel</c> resolution, the quick-action gating, and the view-model's load + command flow over its
/// four data ports (<c>useVehicles</c> + <c>useVehicleState</c> + <c>useLocationSnapshotLatest</c> +
/// <c>useVehicleCommand</c>). The WinUI view is exercised by the app build; its per-region visibility is driven
/// entirely by the <see cref="GlanceDisplay"/> flags asserted here.
/// </summary>
public sealed class GlancePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    /// <summary>Every visible literal the page renders (web key names) — the 20 manifest parity strings.</summary>
    private static readonly string[] RequiredStringKeys =
    [
        "glance.action.climateOff", "glance.action.climateOn", "glance.action.horn", "glance.action.lock",
        "glance.action.unlock", "glance.battery", "glance.defaultName", "glance.location.favorite",
        "glance.location.home", "glance.location.work", "glance.locationLabel", "glance.locked",
        "glance.noVehicle", "glance.openApp", "glance.range", "glance.security",
        "glance.temp", "glance.title", "glance.unknown", "glance.unlocked",
    ];

    private static GlanceModel Model(
        GlanceVehicle? vehicle = null,
        GlanceVehicleState? state = null,
        GlanceLocation? location = null,
        bool loading = false,
        bool loadFailed = false,
        UnitPref? units = null,
        string? activeCommand = null,
        bool commandPending = false) =>
        new(
            Vehicle: vehicle,
            State: state,
            Location: location,
            Loading: loading,
            LoadFailed: loadFailed,
            Units: units ?? UnitPref.Metric,
            ActiveCommand: activeCommand,
            CommandPending: commandPending);

    private static GlanceVehicle Vehicle(string name = "My Tesla") => new(1, name, "Model 3");

    private static GlanceVehicleState State(
        string? text = "online",
        double? battery = 73,
        double? range = 400000,
        double? temp = 21.5,
        bool locked = true,
        bool climate = false) =>
        new(text, battery, range, temp, locked, climate);

    // ---- i18n key coverage (all 20 manifest strings) -------------------------------

    [Fact]
    public void Manifest_requires_twenty_strings()
    {
        Assert.Equal(20, RequiredStringKeys.Length);
        Assert.Equal(RequiredStringKeys.Length, RequiredStringKeys.Distinct().Count());
    }

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        // One projection run references every manifest key regardless of the model branch.
        _ = GlanceProjection.Project(
            Model(vehicle: Vehicle(), state: State(), location: new GlanceLocation(true, false, false, null)),
            recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- four-state matrix ---------------------------------------------------------

    [Fact]
    public void Loading_model_projects_loading_state()
    {
        var display = GlanceProjection.Project(Model(loading: true), Localizer);
        Assert.Equal(GlanceState.Loading, display.State);
    }

    [Fact]
    public void Failed_model_projects_error_state()
    {
        var display = GlanceProjection.Project(Model(loadFailed: true), Localizer);
        Assert.Equal(GlanceState.Error, display.State);
    }

    [Fact]
    public void No_vehicle_projects_empty_state()
    {
        var display = GlanceProjection.Project(Model(vehicle: null), Localizer);
        Assert.Equal(GlanceState.Empty, display.State);
        Assert.Equal("No vehicle found", display.NoVehicleMessage);
    }

    [Fact]
    public void Resolved_vehicle_projects_success_state()
    {
        var display = GlanceProjection.Project(Model(vehicle: Vehicle(), state: State()), Localizer);
        Assert.Equal(GlanceState.Success, display.State);
        Assert.Equal("My Tesla", display.VehicleName);
    }

    [Fact]
    public void Vehicle_name_falls_back_to_default()
    {
        var display = GlanceProjection.Project(Model(vehicle: new GlanceVehicle(1, string.Empty, string.Empty)), Localizer);
        Assert.Equal("Tesla", display.VehicleName);
    }

    // ---- status badge --------------------------------------------------------------

    [Theory]
    [InlineData("online", true)]
    [InlineData("parked", true)]
    [InlineData("asleep", false)]
    [InlineData("offline", false)]
    public void Online_state_drives_badge_and_command_gate(string stateText, bool online)
    {
        var display = GlanceProjection.Project(Model(vehicle: Vehicle(), state: State(text: stateText)), Localizer);
        Assert.Equal(online, display.IsOnline);
        Assert.Equal(online ? StatusKind.Success : StatusKind.Neutral, display.StatusKind);
        Assert.All(display.QuickActions, a => Assert.Equal(!online, a.Disabled));
    }

    [Fact]
    public void Unknown_state_uses_unknown_label()
    {
        var display = GlanceProjection.Project(Model(vehicle: Vehicle(), state: State(text: null)), Localizer);
        Assert.Equal("Unknown", display.StatusText);
    }

    // ---- battery gauge -------------------------------------------------------------

    [Theory]
    [InlineData(80, StatusKind.Success)]
    [InlineData(35, StatusKind.Warning)]
    [InlineData(10, StatusKind.Danger)]
    public void Battery_threshold_maps_to_status(double level, StatusKind expected)
    {
        Assert.Equal(expected, GlanceProjection.BatteryStatusFor(level));
        var display = GlanceProjection.Project(Model(vehicle: Vehicle(), state: State(battery: level)), Localizer);
        Assert.Equal(expected, display.BatteryStatus);
        Assert.True(display.HasBatteryReading);
    }

    [Fact]
    public void Missing_battery_reading_is_neutral()
    {
        var display = GlanceProjection.Project(Model(vehicle: Vehicle(), state: State(battery: null)), Localizer);
        Assert.False(display.HasBatteryReading);
        Assert.Equal(StatusKind.Neutral, display.BatteryStatus);
        Assert.Equal(0, display.BatteryValue);
    }

    // ---- metric cards (SI display boundary) ----------------------------------------

    [Fact]
    public void Range_and_interior_convert_at_display_boundary()
    {
        var metric = GlanceProjection.Project(Model(vehicle: Vehicle(), state: State(), units: UnitPref.Metric), Localizer);
        var imperial = GlanceProjection.Project(Model(vehicle: Vehicle(), state: State(), units: UnitPref.Imperial), Localizer);

        Assert.NotEqual("\u2014", metric.Range.Value);
        Assert.NotEqual("\u2014", metric.Interior.Value);
        // Unit conversion happens at the boundary — metric and imperial render different strings.
        Assert.NotEqual(metric.Range.Value, imperial.Range.Value);
        Assert.NotEqual(metric.Interior.Value, imperial.Interior.Value);
        Assert.Equal("Range", metric.Range.Label);
        Assert.Equal("Interior", metric.Interior.Label);
    }

    [Fact]
    public void Missing_range_and_temp_show_em_dash()
    {
        var display = GlanceProjection.Project(
            Model(vehicle: Vehicle(), state: State(range: null, temp: null)),
            Localizer);
        Assert.Equal("\u2014", display.Range.Value);
        Assert.Equal("\u2014", display.Interior.Value);
    }

    [Theory]
    [InlineData(true, "Locked")]
    [InlineData(false, "Unlocked")]
    public void Security_card_reflects_lock_state(bool locked, string expected)
    {
        var display = GlanceProjection.Project(Model(vehicle: Vehicle(), state: State(locked: locked)), Localizer);
        Assert.Equal(expected, display.Security.Value);
        Assert.Equal(locked ? "TsColorSuccessBrush" : "TsColorDangerBrush", display.Security.AccentBrushKey);
    }

    // ---- location label (web getLocationLabel) -------------------------------------

    [Fact]
    public void Location_label_prefers_home_then_work_then_favorite_then_destination()
    {
        Assert.Equal("Home", GlanceProjection.LocationLabel(new GlanceLocation(true, true, true, "X"), "Home", "Work", "Saved"));
        Assert.Equal("Work", GlanceProjection.LocationLabel(new GlanceLocation(false, true, true, "X"), "Home", "Work", "Saved"));
        Assert.Equal("Saved", GlanceProjection.LocationLabel(new GlanceLocation(false, false, true, "X"), "Home", "Work", "Saved"));
        Assert.Equal("Pier 39", GlanceProjection.LocationLabel(new GlanceLocation(false, false, false, "Pier 39"), "Home", "Work", "Saved"));
        Assert.Equal("\u2014", GlanceProjection.LocationLabel(new GlanceLocation(false, false, false, null), "Home", "Work", "Saved"));
        Assert.Equal("\u2014", GlanceProjection.LocationLabel(null, "Home", "Work", "Saved"));
    }

    // ---- quick actions -------------------------------------------------------------

    [Fact]
    public void Lock_action_is_dynamic_and_spins_only_active_command()
    {
        var locked = GlanceProjection.Project(Model(vehicle: Vehicle(), state: State(locked: true)), Localizer);
        Assert.Equal("unlock", locked.QuickActions[0].Command);
        Assert.Equal("Unlock", locked.QuickActions[0].Label);

        var unlocked = GlanceProjection.Project(Model(vehicle: Vehicle(), state: State(locked: false)), Localizer);
        Assert.Equal("lock", unlocked.QuickActions[0].Command);

        var pending = GlanceProjection.Project(
            Model(vehicle: Vehicle(), state: State(locked: true), activeCommand: "unlock", commandPending: true),
            Localizer);
        Assert.True(pending.QuickActions[0].IsLoading);
        Assert.False(pending.QuickActions[2].IsLoading);
        // Every tile is disabled while a command is in flight.
        Assert.All(pending.QuickActions, a => Assert.True(a.Disabled));
    }

    [Fact]
    public void Climate_and_horn_commands_are_correct()
    {
        var climateOff = GlanceProjection.Project(Model(vehicle: Vehicle(), state: State(climate: false)), Localizer);
        Assert.Equal("climate_on", climateOff.QuickActions[1].Command);
        Assert.Equal("Climate On", climateOff.QuickActions[1].Label);

        var climateOn = GlanceProjection.Project(Model(vehicle: Vehicle(), state: State(climate: true)), Localizer);
        Assert.Equal("climate_off", climateOn.QuickActions[1].Command);
        Assert.Equal("Climate Off", climateOn.QuickActions[1].Label);

        Assert.Equal("honk_horn", climateOff.QuickActions[2].Command);
        Assert.Equal("Horn", climateOff.QuickActions[2].Label);
    }

    // ---- JSON parsing --------------------------------------------------------------

    [Fact]
    public void Vehicle_resolves_first_or_explicit()
    {
        using var doc = JsonDocument.Parse("[{\"id\":7,\"display_name\":\"A\"},{\"id\":9,\"display_name\":\"B\"}]");
        Assert.Equal(7, GlanceVehicle.Resolve(doc.RootElement, null)!.Id);
        Assert.Equal(9, GlanceVehicle.Resolve(doc.RootElement, 9)!.Id);
    }

    [Fact]
    public void Empty_vehicle_list_resolves_null()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(GlanceVehicle.Resolve(doc.RootElement, null));
    }

    [Fact]
    public void Vehicle_state_parses_canonical_state_object()
    {
        const string json = "{\"state\":{\"vehicle_id\":1,\"state\":\"online\",\"battery_level\":73,\"rated_range\":400000,\"inside_temp\":21.5,\"is_locked\":true,\"is_climate_on\":false}}";
        using var doc = JsonDocument.Parse(json);
        var state = GlanceVehicleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal("online", state!.StateText);
        Assert.Equal(73, state.BatteryLevel);
        Assert.Equal(400000, state.RatedRangeMeters);
        Assert.Equal(21.5, state.InsideTempCelsius);
        Assert.True(state.IsLocked);
        Assert.False(state.IsClimateOn);
        Assert.True(state.IsOnline);
    }

    [Fact]
    public void Vehicle_state_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("\"nope\"");
        Assert.Null(GlanceVehicleState.FromResponse(doc.RootElement));
    }

    [Fact]
    public void Location_parses_flags_and_destination()
    {
        using var doc = JsonDocument.Parse("{\"located_at_home\":false,\"located_at_work\":true,\"destination_name\":\"Office\"}");
        var location = GlanceLocation.FromResponse(doc.RootElement);
        Assert.NotNull(location);
        Assert.False(location!.AtHome);
        Assert.True(location.AtWork);
        Assert.Equal("Office", location.DestinationName);
    }

    // ---- view-model flow -----------------------------------------------------------

    [Fact]
    public async Task ViewModel_load_populates_success_with_state_and_location()
    {
        var vm = NewViewModel(
            vehicles: RepositoryResult<GlanceVehicle>.Loaded(Vehicle(), DateTimeOffset.UtcNow),
            state: RepositoryResult<GlanceVehicleState>.Loaded(State(), DateTimeOffset.UtcNow),
            location: RepositoryResult<GlanceLocation>.Loaded(new GlanceLocation(true, false, false, null), DateTimeOffset.UtcNow));
        using var disposable = vm.Vm;

        await vm.Vm.LoadAsync();

        Assert.Equal(GlanceState.Success, vm.Vm.State);
        Assert.Equal("My Tesla", vm.Vm.Display.VehicleName);
        Assert.Equal("Home", vm.Vm.Display.Location.Value);
        Assert.NotNull(vm.Vm.UpdatedAt);
        Assert.Equal(1, vm.State.VehicleIdSeen);
    }

    [Fact]
    public async Task ViewModel_load_failure_sets_error_state()
    {
        var vm = NewViewModel(
            vehicles: RepositoryResult<GlanceVehicle>.Failure(new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var disposable = vm.Vm;

        await vm.Vm.LoadAsync();

        Assert.Equal(GlanceState.Error, vm.Vm.State);
        Assert.True(vm.Vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.Vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_empty_fleet_sets_empty_state()
    {
        var vm = NewViewModel(vehicles: RepositoryResult<GlanceVehicle>.Empty());
        using var disposable = vm.Vm;

        await vm.Vm.LoadAsync();

        Assert.Equal(GlanceState.Empty, vm.Vm.State);
    }

    [Fact]
    public async Task ViewModel_command_sends_then_reloads_state()
    {
        var vm = NewViewModel(
            vehicles: RepositoryResult<GlanceVehicle>.Loaded(Vehicle(), DateTimeOffset.UtcNow),
            state: RepositoryResult<GlanceVehicleState>.Loaded(State(), DateTimeOffset.UtcNow),
            location: RepositoryResult<GlanceLocation>.Loaded(new GlanceLocation(true, false, false, null), DateTimeOffset.UtcNow));
        using var disposable = vm.Vm;

        await vm.Vm.LoadAsync();
        var outcome = await vm.Vm.SendCommandAsync("lock");

        Assert.True(outcome.Success);
        Assert.Equal(1, vm.Command.Calls);
        Assert.Equal("lock", vm.Command.LastCommand);
        Assert.Equal(1, vm.Command.LastVehicleId);
        // The command re-reads the state (web invalidates the query): two state streams total.
        Assert.Equal(2, vm.State.Streams);
        Assert.False(vm.Vm.IsCommandPending);
    }

    [Fact]
    public async Task ViewModel_command_without_vehicle_fails()
    {
        var vm = NewViewModel(vehicles: RepositoryResult<GlanceVehicle>.Empty());
        using var disposable = vm.Vm;

        await vm.Vm.LoadAsync();
        var outcome = await vm.Vm.SendCommandAsync("lock");

        Assert.False(outcome.Success);
        Assert.Equal(0, vm.Command.Calls);
    }

    // ---- registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_route_and_slug()
    {
        Assert.Equal("Glance", GlanceRegistration.RouteName);
        Assert.Equal("GlancePage", GlanceRegistration.Slug);
        Assert.Equal("Quick Glance", GlanceRegistration.Title(Localizer));
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        string? captured = null;
        var diagnostics = new GlanceDiagnostics(line => captured = line);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=GlancePage", captured);
    }

    // ---- test doubles --------------------------------------------------------------

    private static Harness NewViewModel(
        RepositoryResult<GlanceVehicle> vehicles,
        RepositoryResult<GlanceVehicleState>? state = null,
        RepositoryResult<GlanceLocation>? location = null)
    {
        var vehiclesSource = new StubVehiclesSource(vehicles);
        var stateSource = new StubStateSource(state ?? RepositoryResult<GlanceVehicleState>.Empty());
        var locationSource = new StubLocationSource(location ?? RepositoryResult<GlanceLocation>.Empty());
        var command = new StubCommandSender();
        var vm = new GlancePageViewModel(vehiclesSource, stateSource, locationSource, command, Localizer);
        return new Harness(vm, stateSource, command);
    }

    private sealed record Harness(GlancePageViewModel Vm, StubStateSource State, StubCommandSender Command);

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class StubVehiclesSource(RepositoryResult<GlanceVehicle> result) : IGlanceVehiclesSource
    {
        public async IAsyncEnumerable<RepositoryResult<GlanceVehicle>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return result;
            await Task.CompletedTask.ConfigureAwait(false);
        }
    }

    private sealed class StubStateSource(RepositoryResult<GlanceVehicleState> result) : IGlanceVehicleStateSource
    {
        public int Streams { get; private set; }

        public long VehicleIdSeen { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<GlanceVehicleState>> StreamAsync(
            long vehicleId,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Streams++;
            VehicleIdSeen = vehicleId;
            yield return result;
            await Task.CompletedTask.ConfigureAwait(false);
        }
    }

    private sealed class StubLocationSource(RepositoryResult<GlanceLocation> result) : IGlanceLocationSource
    {
        public async IAsyncEnumerable<RepositoryResult<GlanceLocation>> StreamAsync(
            long vehicleId,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return result;
            await Task.CompletedTask.ConfigureAwait(false);
        }
    }

    private sealed class StubCommandSender : IGlanceCommandSender
    {
        public int Calls { get; private set; }

        public long LastVehicleId { get; private set; }

        public string? LastCommand { get; private set; }

        public Task<GlanceCommandOutcome> SendAsync(long vehicleId, string command, CancellationToken cancellationToken = default)
        {
            Calls++;
            LastVehicleId = vehicleId;
            LastCommand = command;
            return Task.FromResult(GlanceCommandOutcome.Ok);
        }
    }
}
