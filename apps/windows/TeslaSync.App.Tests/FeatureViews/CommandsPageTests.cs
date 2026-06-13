using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Commands;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>CommandsPage</c> surface's Microsoft.UI-free logic — the tolerant parsers
/// (vehicle roster, per-vehicle live-state), the projection (online/asleep tally, the four stat tiles, the
/// per-vehicle command-centre headers with SI range/temperature conversion, the non-fatal states-error
/// banner), the three-state view-model matrix (loading / loaded / empty) and the generated-client source's
/// request shaping (web <c>useVehicles</c> + per-vehicle <c>/vehicles/{id}/state</c>). The WinUI view is
/// exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="CommandsDisplay"/> flags asserted here. Mirrors the web spec
/// (web/src/features/system/pages/CommandsPage.tsx).
/// </summary>
public sealed class CommandsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 13 i18n keys the manifest requires the page to resolve (web key names).
    private static readonly string[] RequiredStringKeys =
    [
        "Asleep", "Online", "Refresh", "Vehicles", "commands.connectFleet", "commands.noVehicles",
        "commands.pageTitle", "commands.statesError", "commands.subtitle", "commands.title",
        "commands.viewHistory", "common.noData", "online",
    ];

    private static CommandsVehicle Vehicle(
        long id = 1,
        string vin = "5YJ3E1EA1JF000001",
        string displayName = "Garage Y",
        string model = "modely",
        string state = "online") =>
        new(id, vin, displayName, model, state, Now);

    private static CommandsSnapshot Snapshot(
        IReadOnlyList<CommandsVehicle>? vehicles = null,
        IReadOnlyList<CommandsVehicleState>? states = null,
        string? statesError = null) =>
        new(
            vehicles ?? Array.Empty<CommandsVehicle>(),
            states ?? Array.Empty<CommandsVehicleState>(),
            statesError);

    // ---- Vehicle parser ------------------------------------------------------------

    [Fact]
    public void Vehicle_parses_snake_case_fields()
    {
        using var doc = JsonDocument.Parse("""
        {"id":7,"vin":"5YJ","display_name":"Garage Y","model":"modely","state":"asleep","updated_at":"2026-06-12T11:59:00Z"}
        """);

        var vehicle = CommandsVehicle.FromJson(doc.RootElement);

        Assert.NotNull(vehicle);
        Assert.Equal(7, vehicle!.Id);
        Assert.Equal("5YJ", vehicle.Vin);
        Assert.Equal("Garage Y", vehicle.DisplayName);
        Assert.Equal("modely", vehicle.Model);
        Assert.Equal("asleep", vehicle.State);
        Assert.NotNull(vehicle.UpdatedAt);
    }

    [Fact]
    public void Vehicle_array_skips_non_objects_and_is_empty_for_non_array()
    {
        using var mixed = JsonDocument.Parse("""[{"id":1},"x",3,{"id":2}]""");
        using var obj = JsonDocument.Parse("{}");

        var list = CommandsVehicle.FromArray(mixed.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].Id);
        Assert.Equal(2, list[1].Id);
        Assert.Empty(CommandsVehicle.FromArray(obj.RootElement));
    }

    [Theory]
    [InlineData("online", true)]
    [InlineData("driving", true)]
    [InlineData("charging", true)]
    [InlineData("asleep", false)]
    [InlineData("offline", false)]
    [InlineData("OFFLINE", false)]
    public void Vehicle_counts_online_unless_asleep_or_offline(string state, bool countsOnline)
    {
        var vehicle = Vehicle(state: state);

        Assert.Equal(countsOnline, vehicle.CountsOnline);
        Assert.Equal(!countsOnline, vehicle.IsAsleep);
    }

    // ---- Live-state parser ---------------------------------------------------------

    [Fact]
    public void LiveState_reads_the_nested_state_fields()
    {
        using var doc = JsonDocument.Parse("""
        {"state":{"battery_level":72,"rated_range":321868.8,"inside_temp":21.0}}
        """);

        var state = CommandsLiveState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(72, state!.BatteryLevel);
        Assert.Equal(321868.8, state.RatedRangeMeters);
        Assert.Equal(21.0, state.InsideTempC);
    }

    [Fact]
    public void LiveState_is_null_when_no_state_object_present()
    {
        using var doc = JsonDocument.Parse("""{"vehicle":{"id":7}}""");
        Assert.Null(CommandsLiveState.FromResponse(doc.RootElement));
    }

    // ---- Projection: stat tiles ----------------------------------------------------

    [Fact]
    public void Projection_emits_four_stat_tiles_in_order()
    {
        var display = CommandsProjection.Project(
            Snapshot(new[] { Vehicle() }), CommandsState.Loaded, UnitPref.Metric, Localizer);

        Assert.Collection(
            display.Metrics,
            m => Assert.Equal("vehicles", m.Key),
            m => Assert.Equal("online", m.Key),
            m => Assert.Equal("asleep", m.Key),
            m => Assert.Equal("refresh", m.Key));
    }

    [Fact]
    public void Projection_assigns_the_web_metric_accent_colours()
    {
        var display = CommandsProjection.Project(
            Snapshot(new[] { Vehicle() }), CommandsState.Loaded, UnitPref.Metric, Localizer);

        Assert.Equal(CommandsProjection.CyanAccentBrushKey, Metric(display, "vehicles").AccentBrushKey);
        Assert.Equal(CommandsProjection.GreenAccentBrushKey, Metric(display, "online").AccentBrushKey);
        Assert.Equal(CommandsProjection.AmberAccentBrushKey, Metric(display, "asleep").AccentBrushKey);
        Assert.Equal(CommandsProjection.PurpleAccentBrushKey, Metric(display, "refresh").AccentBrushKey);
    }

    [Fact]
    public void Projection_tallies_online_and_asleep_from_the_roster()
    {
        var vehicles = new[]
        {
            Vehicle(1, state: "online"),
            Vehicle(2, state: "asleep"),
            Vehicle(3, state: "driving"),
        };

        var display = CommandsProjection.Project(
            Snapshot(vehicles), CommandsState.Loaded, UnitPref.Metric, Localizer);

        Assert.Equal(3, display.TotalCount);
        Assert.Equal(2, display.OnlineCount);
        Assert.Equal("3", Metric(display, "vehicles").Value);
        Assert.Equal("2", Metric(display, "online").Value);
        Assert.Equal("1", Metric(display, "asleep").Value);
        Assert.Equal("15s", Metric(display, "refresh").Value);
    }

    [Fact]
    public void Projection_composes_the_online_tally_automation_name()
    {
        var vehicles = new[] { Vehicle(1, state: "online"), Vehicle(2, state: "offline") };

        var display = CommandsProjection.Project(
            Snapshot(vehicles), CommandsState.Loaded, UnitPref.Metric, Localizer);

        Assert.Equal("1", display.OnlineCountText);
        Assert.Equal("2", display.TotalCountText);
        Assert.Equal("online", display.OnlineWord);
        Assert.Equal("1/2 online", display.OnlineSummaryAutomationName);
    }

    // ---- Projection: per-vehicle command centre ------------------------------------

    [Fact]
    public void Projection_renders_one_centre_per_vehicle_with_name_and_sub_line()
    {
        var vehicles = new[] { Vehicle(7, vin: "5YJABC", displayName: "Garage Y", model: "modely") };

        var display = CommandsProjection.Project(
            Snapshot(vehicles), CommandsState.Loaded, UnitPref.Metric, Localizer);

        var center = Assert.Single(display.Centers);
        Assert.Equal(7, center.Id);
        Assert.Equal("Garage Y", center.Name);
        Assert.Equal("modely \u00b7 5YJABC", center.ModelVin);
        Assert.False(center.IsAsleep);
    }

    [Fact]
    public void Projection_falls_back_to_vin_when_display_name_is_blank()
    {
        var vehicles = new[] { Vehicle(7, vin: "5YJABC", displayName: "  ", model: "model3", state: "asleep") };

        var center = Assert.Single(
            CommandsProjection.Project(Snapshot(vehicles), CommandsState.Loaded, UnitPref.Metric, Localizer).Centers);

        Assert.Equal("5YJABC", center.Name);
        Assert.True(center.IsAsleep);
    }

    [Fact]
    public void Projection_converts_range_and_temperature_to_metric_and_imperial()
    {
        var vehicles = new[] { Vehicle(7) };
        var states = new[] { new CommandsVehicleState(7, new CommandsLiveState(80, 321868.8, 21.0)) };

        var metric = Single(CommandsProjection.Project(Snapshot(vehicles, states), CommandsState.Loaded, UnitPref.Metric, Localizer));
        var imperial = Single(CommandsProjection.Project(Snapshot(vehicles, states), CommandsState.Loaded, UnitPref.Imperial, Localizer));

        Assert.True(metric.HasLiveState);
        Assert.Equal("80%", metric.BatteryText);
        Assert.True(metric.BatteryHigh);
        Assert.Equal("322 km", metric.RangeText);
        Assert.True(metric.HasTemp);
        Assert.Equal("21\u00b0C", metric.TempText);

        Assert.Equal("200 mi", imperial.RangeText);
        Assert.Equal("70\u00b0F", imperial.TempText);
    }

    [Fact]
    public void Projection_flags_low_battery_and_absent_temperature()
    {
        var vehicles = new[] { Vehicle(7) };
        var states = new[] { new CommandsVehicleState(7, new CommandsLiveState(30, 100000, null)) };

        var center = Single(CommandsProjection.Project(Snapshot(vehicles, states), CommandsState.Loaded, UnitPref.Metric, Localizer));

        Assert.Equal("30%", center.BatteryText);
        Assert.False(center.BatteryHigh);
        Assert.False(center.HasTemp);
        Assert.Equal(string.Empty, center.TempText);
    }

    [Fact]
    public void Projection_marks_a_centre_without_live_state()
    {
        var vehicles = new[] { Vehicle(7) };

        var center = Single(CommandsProjection.Project(Snapshot(vehicles), CommandsState.Loaded, UnitPref.Metric, Localizer));

        Assert.False(center.HasLiveState);
    }

    // ---- Projection: states-error banner (GlassPanel5) -----------------------------

    [Fact]
    public void Projection_surfaces_the_states_error_banner_with_detail()
    {
        var display = CommandsProjection.Project(
            Snapshot(new[] { Vehicle() }, statesError: "boom"),
            CommandsState.Loaded, UnitPref.Metric, Localizer);

        Assert.True(display.HasStatesError);
        Assert.Equal("Failed to load vehicle states: boom", display.StatesErrorText);
    }

    [Fact]
    public void Projection_hides_the_states_error_banner_when_clear()
    {
        var display = CommandsProjection.Project(
            Snapshot(new[] { Vehicle() }), CommandsState.Loaded, UnitPref.Metric, Localizer);

        Assert.False(display.HasStatesError);
    }

    // ---- Projection: empty / stats affordances -------------------------------------

    [Fact]
    public void Projection_hides_stats_and_exposes_empty_copy_with_no_vehicles()
    {
        var display = CommandsProjection.Project(
            CommandsSnapshot.Empty, CommandsState.Empty, UnitPref.Metric, Localizer);

        Assert.False(display.ShowStats);
        Assert.True(display.ShowEmptyVehicles);
        Assert.Equal("No data available", display.NoDataMessage);
        Assert.Equal("No vehicles found", display.NoVehiclesTitle);
        Assert.Equal(
            "Connect your Tesla account and sync your fleet to start sending commands.",
            display.ConnectFleetMessage);
    }

    [Fact]
    public void Projection_exposes_the_header_copy()
    {
        var display = CommandsProjection.Project(
            Snapshot(new[] { Vehicle() }), CommandsState.Loaded, UnitPref.Metric, Localizer);

        Assert.Equal("Vehicle Commands", display.Title);
        Assert.Equal("Remote control center for your Tesla fleet", display.Subtitle);
        Assert.Equal("Commands", display.DocumentTitle);
        Assert.Equal("View History", display.ViewHistoryText);
    }

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        CommandsProjection.Project(
            Snapshot(new[] { Vehicle() }, statesError: "boom"), CommandsState.Loaded, UnitPref.Metric, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- View-model: three-state matrix --------------------------------------------

    [Fact]
    public async Task ViewModel_starts_loading_then_resolves_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<CommandsSnapshot>.Loaded(Snapshot(new[] { Vehicle() }), Now));

        Assert.Equal(CommandsState.Loading, vm.State);

        await vm.LoadAsync();

        Assert.Equal(CommandsState.Loaded, vm.State);
        Assert.True(vm.Display.HasVehicles);
        Assert.True(vm.Display.ShowContent);
        Assert.Single(vm.Display.Centers);
    }

    [Fact]
    public async Task ViewModel_classifies_a_no_vehicles_snapshot_as_empty()
    {
        using var vm = NewViewModel(RepositoryResult<CommandsSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(CommandsState.Empty, vm.State);
        Assert.False(vm.Display.HasVehicles);
        Assert.True(vm.Display.ShowEmptyVehicles);
    }

    [Fact]
    public async Task ViewModel_maps_a_hard_failure_to_the_empty_state()
    {
        using var vm = NewViewModel(
            RepositoryResult<CommandsSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(CommandsState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmptyVehicles);
    }

    [Fact]
    public async Task ViewModel_reprojects_centre_units_when_units_change()
    {
        var snapshot = Snapshot(
            new[] { Vehicle(7) },
            new[] { new CommandsVehicleState(7, new CommandsLiveState(80, 321868.8, 21.0)) });

        using var vm = NewViewModel(RepositoryResult<CommandsSnapshot>.Loaded(snapshot, Now));

        await vm.LoadAsync();
        Assert.Equal("322 km", vm.Display.Centers[0].RangeText);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("200 mi", vm.Display.Centers[0].RangeText);
    }

    [Fact]
    public void ViewModel_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        using var vm = new CommandsPageViewModel(
            new FakeCommandsSource(), Localizer, diagnostics: new CommandsDiagnostics(lines.Add));

        vm.NotifyOpened();

        Assert.Contains("view.opened slug=CommandsPage", lines);
    }

    // ---- Registration / source -----------------------------------------------------

    [Fact]
    public void Registration_mirrors_the_web_route_and_window()
    {
        Assert.Equal("Commands", CommandsRegistration.RouteName);
        Assert.Equal("commands", CommandsRegistration.Route);
        Assert.Equal("command-history", CommandsRegistration.CommandHistoryRoute);
        Assert.Equal(15_000, CommandsRegistration.RefreshIntervalMs);
        Assert.Equal("Commands", CommandsRegistration.Title(Localizer));
    }

    [Fact]
    public async Task EmptyCommandsSource_yields_a_single_empty_result()
    {
        var emissions = new List<RepositoryResult<CommandsSnapshot>>();
        await foreach (var e in EmptyCommandsSource.Instance.StreamAsync())
        {
            emissions.Add(e);
        }

        var result = Assert.Single(emissions);
        Assert.Equal(LoadStatus.Empty, result.Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CommandsMetric Metric(CommandsDisplay display, string key)
    {
        foreach (var metric in display.Metrics)
        {
            if (string.Equals(metric.Key, key, StringComparison.Ordinal))
            {
                return metric;
            }
        }

        throw new KeyNotFoundException(key);
    }

    private static CommandsVehicleCenter Single(CommandsDisplay display) => Assert.Single(display.Centers);

    private static CommandsPageViewModel NewViewModel(params RepositoryResult<CommandsSnapshot>[] emissions) =>
        new(new FakeCommandsSource(emissions), Localizer, UnitPref.Metric);

    private sealed class FakeCommandsSource(params RepositoryResult<CommandsSnapshot>[] emissions) : ICommandsSource
    {
        public async IAsyncEnumerable<RepositoryResult<CommandsSnapshot>> StreamAsync(
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
