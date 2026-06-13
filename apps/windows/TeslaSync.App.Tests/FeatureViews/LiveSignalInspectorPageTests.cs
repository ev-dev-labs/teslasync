using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Admin;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>LiveSignalInspectorPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/LiveSignalInspectorPage.tsx): the three web data states (loading / empty /
/// success), the always-on controls panel (GlassPanel1 — the vehicle picker), the no-vehicle empty guard
/// (GlassPanel2 — web <c>vehicleId === null</c>), the live snapshot panel (GlassPanel3), the tolerant
/// <c>GET /vehicles</c> parser, the view-model's selection state machine, the page's seven i18n keys, the
/// diagnostics contract and the empty live-signals source the default page composes. The WinUI view is exercised
/// by the app build; its per-region visibility is driven entirely by the <see cref="LiveSignalInspectorDisplay"/>
/// flags asserted here.
/// </summary>
public sealed class LiveSignalInspectorPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The seven i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "admin.liveSignals.controls.selectVehicle",
        "admin.liveSignals.controls.vehicleAria",
        "admin.liveSignals.noVehicle.message",
        "admin.liveSignals.noVehicle.title",
        "admin.liveSignals.pageTitle",
        "admin.liveSignals.panels.snapshot",
        "admin.liveSignals.subtitle",
    ];

    private static IReadOnlyList<VehicleOption> Fleet() =>
    [
        new VehicleOption(7, "Model 3"),
        new VehicleOption(9, DisplayName: null, Vin: "5YJ3000"),
        new VehicleOption(11),
    ];

    private static LiveSignalInspectorModel Model(
        IReadOnlyList<VehicleOption>? vehicles = null,
        long? selected = null,
        bool loading = false) =>
        new(
            Vehicles: vehicles ?? Fleet(),
            SelectedVehicleId: selected,
            Loading: loading);

    // ---- i18n key coverage (all 7 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = LiveSignalInspectorProjection.Project(Model(selected: 7), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = LiveSignalInspectorProjection.Project(Model(vehicles: Array.Empty<VehicleOption>(), loading: true), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Three data states ---------------------------------------------------------

    [Fact]
    public void State_loading_when_fleet_fetch_in_flight()
    {
        var display = LiveSignalInspectorProjection.Project(
            Model(vehicles: Array.Empty<VehicleOption>(), loading: true),
            Localizer);

        Assert.Equal(LiveSignalInspectorState.Loading, display.State);
        Assert.True(display.ShowVehicleLoading);
        Assert.False(display.ShowNoVehicle);
        Assert.False(display.ShowSnapshot);
        Assert.False(display.ShowLiveIndicator);
    }

    [Fact]
    public void State_empty_when_no_vehicle_selected()
    {
        var display = LiveSignalInspectorProjection.Project(Model(selected: null), Localizer);

        Assert.Equal(LiveSignalInspectorState.Empty, display.State);
        Assert.True(display.ShowNoVehicle);
        Assert.False(display.ShowVehicleLoading);
        Assert.False(display.ShowSnapshot);
        Assert.Equal("Select a vehicle", display.NoVehicleTitle);
        Assert.Equal(
            "Pick a vehicle from the dropdown above to start streaming its live signal cache.",
            display.NoVehicleMessage);
    }

    [Fact]
    public void State_success_when_a_vehicle_is_selected()
    {
        var display = LiveSignalInspectorProjection.Project(Model(selected: 7), Localizer);

        Assert.Equal(LiveSignalInspectorState.Success, display.State);
        Assert.True(display.ShowSnapshot);
        Assert.True(display.ShowLiveIndicator);
        Assert.False(display.ShowNoVehicle);
        Assert.False(display.ShowVehicleLoading);
        Assert.Equal(7, display.SelectedVehicleId);
        Assert.Equal("Live snapshot", display.SnapshotTitle);
    }

    [Fact]
    public void Empty_fleet_resolved_renders_the_no_vehicle_guard_not_loading()
    {
        var display = LiveSignalInspectorProjection.Project(
            Model(vehicles: Array.Empty<VehicleOption>(), loading: false),
            Localizer);

        Assert.Equal(LiveSignalInspectorState.Empty, display.State);
        Assert.True(display.ShowNoVehicle);
        Assert.False(display.ShowVehicleLoading);
        Assert.Empty(display.VehicleOptions);
    }

    // ---- Panels --------------------------------------------------------------------

    [Fact]
    public void Controls_panel_always_exposes_the_picker_prompt_and_aria()
    {
        var display = LiveSignalInspectorProjection.Project(Model(), Localizer);

        Assert.Equal("Select vehicle\u2026", display.SelectVehiclePrompt);
        Assert.Equal("Vehicle", display.VehicleAriaLabel);
    }

    [Fact]
    public void Vehicle_options_use_display_name_then_vin_then_numeric_fallback()
    {
        var display = LiveSignalInspectorProjection.Project(Model(), Localizer);

        Assert.Collection(
            display.VehicleOptions,
            o => { Assert.Equal(7, o.Id); Assert.Equal("Model 3", o.Label); },
            o => { Assert.Equal(9, o.Id); Assert.Equal("5YJ3000", o.Label); },
            o => { Assert.Equal(11, o.Id); Assert.Equal("Vehicle 11", o.Label); });
    }

    // ---- GET /vehicles parser ------------------------------------------------------

    [Fact]
    public void ParseList_reads_id_display_name_and_vin_tolerantly()
    {
        using var doc = JsonDocument.Parse(
            """
            [
              { "id": 7, "display_name": "Model 3", "vin": "5YJ3ABC" },
              { "id": "9", "displayName": "Model Y" },
              { "id": 11 },
              { "display_name": "no id dropped" },
              "not an object"
            ]
            """);

        var vehicles = LiveSignalInspectorVehicles.ParseList(doc.RootElement);

        Assert.Collection(
            vehicles,
            v => { Assert.Equal(7, v.Id); Assert.Equal("Model 3", v.DisplayName); Assert.Equal("5YJ3ABC", v.Vin); },
            v => { Assert.Equal(9, v.Id); Assert.Equal("Model Y", v.DisplayName); },
            v => Assert.Equal(11, v.Id));
    }

    [Fact]
    public void ParseList_returns_empty_for_a_non_array_body()
    {
        using var doc = JsonDocument.Parse("""{ "error": "nope" }""");

        Assert.Empty(LiveSignalInspectorVehicles.ParseList(doc.RootElement));
    }

    // ---- View-model state machine --------------------------------------------------

    [Fact]
    public async Task LoadAsync_fills_the_picker_and_stays_empty_until_a_pick()
    {
        var vm = new LiveSignalInspectorPageViewModel(new FakeFeed(Fleet()), Localizer);

        await vm.LoadAsync();

        Assert.Equal(LiveSignalInspectorState.Empty, vm.State);
        Assert.Null(vm.SelectedVehicleId);
        Assert.True(vm.Display.ShowNoVehicle);
        Assert.Equal(3, vm.Display.VehicleOptions.Count);
    }

    [Fact]
    public async Task SelectVehicle_moves_to_the_success_snapshot()
    {
        var vm = new LiveSignalInspectorPageViewModel(new FakeFeed(Fleet()), Localizer);
        await vm.LoadAsync();

        vm.SelectVehicle(9);

        Assert.Equal(LiveSignalInspectorState.Success, vm.State);
        Assert.Equal(9, vm.SelectedVehicleId);
        Assert.True(vm.Display.ShowSnapshot);
        Assert.True(vm.Display.ShowLiveIndicator);
    }

    [Fact]
    public async Task SelectVehicle_null_clears_back_to_the_no_vehicle_guard()
    {
        var vm = new LiveSignalInspectorPageViewModel(new FakeFeed(Fleet()), Localizer);
        await vm.LoadAsync();
        vm.SelectVehicle(7);

        vm.SelectVehicle(null);

        Assert.Equal(LiveSignalInspectorState.Empty, vm.State);
        Assert.Null(vm.SelectedVehicleId);
        Assert.True(vm.Display.ShowNoVehicle);
    }

    [Fact]
    public async Task LoadAsync_degrades_to_an_empty_fleet_when_the_feed_fails()
    {
        var vm = new LiveSignalInspectorPageViewModel(new ThrowingFeed(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(LiveSignalInspectorState.Empty, vm.State);
        Assert.Empty(vm.Display.VehicleOptions);
        Assert.True(vm.Display.ShowNoVehicle);
    }

    [Fact]
    public async Task LoadAsync_drops_a_selection_that_left_the_fleet()
    {
        var vm = new LiveSignalInspectorPageViewModel(new FakeFeed(Fleet()), Localizer);
        await vm.LoadAsync();
        vm.SelectVehicle(7);

        // A vehicle that is no longer present must not survive a reload.
        var reduced = new LiveSignalInspectorPageViewModel(
            new FakeFeed([new VehicleOption(99, "New Car")]),
            Localizer);
        await reduced.LoadAsync();
        reduced.SelectVehicle(7);
        await reduced.LoadAsync();

        Assert.Null(reduced.SelectedVehicleId);
        Assert.Equal(LiveSignalInspectorState.Empty, reduced.State);
    }

    // ---- Diagnostics ---------------------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_the_view_opened_event()
    {
        var lines = new List<string>();
        var diagnostics = new LiveSignalInspectorDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LiveSignalInspectorPage", Assert.Single(lines));
    }

    // ---- Composed live-signals source (default page) -------------------------------

    [Fact]
    public async Task EmptyLiveSignalsTableSource_yields_a_single_empty_snapshot()
    {
        var results = new List<RepositoryResult<IReadOnlyList<LiveSignalRow>>>();

        await foreach (var result in EmptyLiveSignalsTableSource.Instance.StreamLiveSignalsAsync(7))
        {
            results.Add(result);
        }

        var only = Assert.Single(results);
        Assert.Equal(LoadStatus.Empty, only.Status);
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

    private sealed class FakeFeed : ILiveSignalInspectorFeed
    {
        private readonly IReadOnlyList<VehicleOption> _vehicles;

        public FakeFeed(IReadOnlyList<VehicleOption> vehicles) => _vehicles = vehicles;

        public Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(_vehicles);
    }

    private sealed class ThrowingFeed : ILiveSignalInspectorFeed
    {
        public Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load vehicles");
    }
}
