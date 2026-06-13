using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Vehicles;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DigitalTwinPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/vehicles/pages/DigitalTwinPage.tsx), the Tesla signal merge into the door / window / security
/// rows and the status badge, the view-model's three-state matrix (loading / empty / success) with the fleet-load +
/// 5 s readings poll + selection change, and the generated-client feed's request shaping (web <c>useVehicles</c> +
/// <c>useVehicleState</c> + <c>useSecurityLatest</c> + <c>useChargingTelemetryLatest</c>). The WinUI view is exercised
/// by the app build; its per-region visibility is driven entirely by the <see cref="DigitalTwinPageDisplay"/> flags
/// asserted here.
/// </summary>
public sealed class DigitalTwinPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 37 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "common.active", "common.closed", "common.inactive", "common.no", "common.off", "common.on",
        "common.open", "common.yes", "digitalTwin.chargePort", "digitalTwin.charging",
        "digitalTwin.doorDriverFront", "digitalTwin.doorDriverRear", "digitalTwin.doorPassengerFront",
        "digitalTwin.doorPassengerRear", "digitalTwin.doorsTitle", "digitalTwin.driverSeat",
        "digitalTwin.driving", "digitalTwin.empty", "digitalTwin.frunk", "digitalTwin.hazards",
        "digitalTwin.headlights", "digitalTwin.lastUpdated", "digitalTwin.locked", "digitalTwin.noDoorData",
        "digitalTwin.noVehicles", "digitalTwin.noWindowData", "digitalTwin.occupied", "digitalTwin.securityTitle",
        "digitalTwin.sentryMode", "digitalTwin.subtitle", "digitalTwin.title", "digitalTwin.trunk",
        "digitalTwin.windowFD", "digitalTwin.windowFP", "digitalTwin.windowRD", "digitalTwin.windowRP",
        "digitalTwin.windowsTitle",
    ];

    private const string SecurityJson =
        """
        {"door_state":{"DriverFront":true,"PassengerFront":false,"DriverRear":false,"PassengerRear":false,"TrunkFront":true,"TrunkRear":false},
         "fd_window":"open","fp_window":"closed","rd_window":"closed","rp_window":"closed",
         "locked":true,"sentry_mode":false,"lights_high_beams":true,"lights_hazards_active":false,
         "driver_seat_occupied":true,"created_at":"2026-06-12T10:30:00Z"}
        """;

    private const string OnlineStateJson =
        """{"state":{"vehicle_id":1,"state":"online","speed":0,"is_charging":false},"live":true}""";

    private const string IdleChargingJson =
        """{"charging_state":"Disconnected","charge_port_door_open":false}""";

    private static DigitalTwinVehicle SampleVehicle(long id = 1) =>
        new(id, "Model 3", "5YJ3E1EA7[…]ABCD", "MIDNIGHT_SILVER");

    private static DigitalTwinReadings Readings(string? state, string? security, string? charging, bool live = false) =>
        new(
            state is null ? null : Json(state),
            security is null ? null : Json(security),
            charging is null ? null : Json(charging),
            live);

    private static DigitalTwinPageModel SuccessModel(DigitalTwinReadings? readings = null) =>
        new(
            Vehicles: [SampleVehicle()],
            SelectedVehicle: SampleVehicle(),
            Readings: readings ?? Readings(OnlineStateJson, SecurityJson, IdleChargingJson, live: true),
            Loading: false);

    // ---- i18n key coverage (all 37 manifest strings) ------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = DigitalTwinPageProjection.Project(SuccessModel(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome + value strings are resolved on every projection regardless of data state; visibility is gated
        // separately. This keeps the i18n contract intact in the loading / empty surfaces.
        _ = DigitalTwinPageProjection.Project(DigitalTwinPageModel.Initial, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Data-state matrix (loading / empty / success) ----------------------------

    [Fact]
    public void Loading_state_shows_the_skeleton()
    {
        var display = DigitalTwinPageProjection.Project(DigitalTwinPageModel.Initial, Localizer);

        Assert.Equal(DigitalTwinPageState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void Empty_state_shows_the_no_vehicles_panel()
    {
        var model = new DigitalTwinPageModel([], null, DigitalTwinReadings.Empty, Loading: false);

        var display = DigitalTwinPageProjection.Project(model, Localizer);

        Assert.Equal(DigitalTwinPageState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.Equal("No vehicles found. Add a vehicle to see its digital twin.", display.NoVehiclesMessage);
        Assert.False(display.ShowBadge);
    }

    [Fact]
    public void Success_state_shows_the_content_and_badge()
    {
        var display = DigitalTwinPageProjection.Project(SuccessModel(), Localizer);

        Assert.Equal(DigitalTwinPageState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.True(display.ShowBadge);
        Assert.Equal(1, display.SelectedVehicleId);
    }

    // ---- Panels & rows (web doorItems / windowItems / securityItems) --------------

    [Fact]
    public void Door_rows_map_each_opening_to_its_localized_state()
    {
        var display = DigitalTwinPageProjection.Project(SuccessModel(), Localizer);

        Assert.True(display.ShowDoorItems);
        Assert.Equal(6, display.DoorItems.Count);
        Assert.Equal("Driver Front", display.DoorItems[0].Label);
        Assert.Equal("Open", display.DoorItems[0].Value);
        Assert.Equal("Closed", display.DoorItems[1].Value);
        Assert.Equal("Open", display.DoorItems[4].Value);   // frunk (TrunkFront = true)
        Assert.Equal("Closed", display.DoorItems[5].Value); // trunk (TrunkRear = false)
    }

    [Fact]
    public void Window_rows_map_each_window_to_its_localized_position()
    {
        var display = DigitalTwinPageProjection.Project(SuccessModel(), Localizer);

        Assert.True(display.ShowWindowItems);
        Assert.Equal(4, display.WindowItems.Count);
        Assert.Equal("Open", display.WindowItems[0].Value);
        Assert.Equal("Closed", display.WindowItems[1].Value);
        Assert.Equal("Closed", display.WindowItems[2].Value);
        Assert.Equal("Closed", display.WindowItems[3].Value);
    }

    [Fact]
    public void Security_rows_mirror_the_web_security_items()
    {
        var display = DigitalTwinPageProjection.Project(SuccessModel(), Localizer);

        Assert.Equal(8, display.SecurityItems.Count);
        Assert.Equal("Yes", Value(display, "Locked"));
        Assert.Equal("No", Value(display, "Driving"));
        Assert.Equal("No", Value(display, "Charging"));
        Assert.Equal("Inactive", Value(display, "Sentry Mode"));
        Assert.Equal("Closed", Value(display, "Charge Port"));
        Assert.Equal("Occupied", Value(display, "Driver Seat"));
        Assert.Equal("On", Value(display, "Headlights"));
        Assert.Equal("Off", Value(display, "Hazards"));
    }

    [Fact]
    public void Side_panels_show_their_empty_states_when_no_security_data()
    {
        var model = SuccessModel(Readings(OnlineStateJson, security: null, charging: null, live: true));

        var display = DigitalTwinPageProjection.Project(model, Localizer);

        Assert.False(display.ShowDoorItems);
        Assert.False(display.ShowWindowItems);
        Assert.Equal("No door data available", display.NoDoorMessage);
        Assert.Equal("No window data available", display.NoWindowMessage);
    }

    [Fact]
    public void Unknown_fields_fall_back_to_the_em_dash()
    {
        var model = SuccessModel(Readings(state: null, security: "{}", charging: null));

        var display = DigitalTwinPageProjection.Project(model, Localizer);

        Assert.Equal(DigitalTwinPageProjection.EmDash, display.DoorItems[0].Value);
        Assert.Equal(DigitalTwinPageProjection.EmDash, Value(display, "Locked"));
        Assert.Equal(DigitalTwinPageProjection.EmDash, Value(display, "Driver Seat"));
    }

    [Fact]
    public void Last_updated_stamp_shows_when_the_security_read_carries_created_at()
    {
        var withStamp = DigitalTwinPageProjection.Project(SuccessModel(), Localizer);
        Assert.True(withStamp.ShowLastUpdated);
        Assert.NotEmpty(withStamp.LastUpdatedValue);

        var withoutStamp = DigitalTwinPageProjection.Project(
            SuccessModel(Readings(OnlineStateJson, "{}", IdleChargingJson)), Localizer);
        Assert.False(withoutStamp.ShowLastUpdated);
    }

    // ---- Status badge (web badgeStatus) -------------------------------------------

    [Fact]
    public void Badge_reads_online_from_the_state_string()
    {
        var display = DigitalTwinPageProjection.Project(SuccessModel(), Localizer);

        Assert.Equal("online", display.BadgeStatus);
    }

    [Fact]
    public void Badge_prefers_charging_then_driving()
    {
        var charging = DigitalTwinPageProjection.Project(
            SuccessModel(Readings(OnlineStateJson, SecurityJson, """{"charging_state":"Charging","charge_port_door_open":true}""")),
            Localizer);
        Assert.Equal("charging", charging.BadgeStatus);
        Assert.Equal("Charging", Value(charging, "Charge Port"));

        var driving = DigitalTwinPageProjection.Project(
            SuccessModel(Readings("""{"state":{"state":"online","speed":35},"live":true}""", SecurityJson, IdleChargingJson)),
            Localizer);
        Assert.Equal("driving", driving.BadgeStatus);
        Assert.Equal("Yes", Value(driving, "Driving"));
    }

    [Fact]
    public void Badge_falls_back_to_online_when_a_live_read_exists_but_the_state_is_offline()
    {
        // No state read, but a security read flowed — web promotes 'offline' to 'online'.
        var model = SuccessModel(Readings(state: null, security: SecurityJson, charging: null));

        var display = DigitalTwinPageProjection.Project(model, Localizer);

        Assert.Equal("online", display.BadgeStatus);
    }

    [Fact]
    public void Badge_is_offline_with_no_reads_at_all()
    {
        var model = SuccessModel(DigitalTwinReadings.Empty);

        var display = DigitalTwinPageProjection.Project(model, Localizer);

        Assert.Equal("offline", display.BadgeStatus);
    }

    // ---- View-model orchestration --------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_the_fleet_defaults_to_the_first_vehicle_and_reads_it()
    {
        var feed = new FakeFeed
        {
            Vehicles = [SampleVehicle(7), SampleVehicle(9)],
            Readings = Readings(OnlineStateJson, SecurityJson, IdleChargingJson, live: true),
        };
        using var vm = new DigitalTwinPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(DigitalTwinPageState.Success, vm.State);
        Assert.Equal(7, vm.SelectState.SelectedId);
        Assert.Equal(7, feed.LastReadingsVehicleId);
        Assert.True(vm.Display.ShowContent);
    }

    [Fact]
    public async Task ViewModel_empty_fleet_resolves_to_the_empty_state()
    {
        var feed = new FakeFeed { Vehicles = [] };
        using var vm = new DigitalTwinPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(DigitalTwinPageState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_refresh_rereads_the_selected_vehicle()
    {
        var feed = new FakeFeed
        {
            Vehicles = [SampleVehicle(7)],
            Readings = Readings(OnlineStateJson, SecurityJson, IdleChargingJson, live: true),
        };
        using var vm = new DigitalTwinPageViewModel(feed, Localizer);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.ReadingsFetchCount);
    }

    [Fact]
    public async Task ViewModel_select_vehicle_switches_the_read_target()
    {
        var feed = new FakeFeed
        {
            Vehicles = [SampleVehicle(7), SampleVehicle(9)],
            Readings = Readings(OnlineStateJson, SecurityJson, IdleChargingJson, live: true),
        };
        using var vm = new DigitalTwinPageViewModel(feed, Localizer);

        await vm.LoadAsync();
        await vm.SelectVehicleAsync(9);

        Assert.Equal(9, vm.SelectState.SelectedId);
        Assert.Equal(9, feed.LastReadingsVehicleId);
    }

    // ---- Generated-client feed (web hook trio) ------------------------------------

    [Fact]
    public async Task ClientFeed_parses_the_fleet_from_the_vehicles_operation()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("""[{"id":7,"display_name":"Model 3","vin":"V7","exterior_color":"RED_MULTICOAT"},{"id":0}]"""));
        var feed = new DigitalTwinPageClientFeed(api);

        var vehicles = await feed.FetchVehiclesAsync(default);

        var vehicle = Assert.Single(vehicles);          // the id=0 row is dropped
        Assert.Equal(7, vehicle.Id);
        Assert.Equal("RED_MULTICOAT", vehicle.ExteriorColor);
        Assert.Equal(DigitalTwinPageRegistration.VehiclesOperation, Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_reads_state_security_and_charging_with_snake_case_params()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json(OnlineStateJson))
           .ReturnsValue(Json(SecurityJson))
           .ReturnsValue(Json(IdleChargingJson));
        var feed = new DigitalTwinPageClientFeed(api);

        var readings = await feed.FetchReadingsAsync(7, default);

        Assert.True(readings.Live);
        Assert.True(readings.HasSecurity);
        Assert.True(readings.HasCharging);

        Assert.Equal(3, api.Requests.Count);
        Assert.Equal(DigitalTwinPageRegistration.StateOperation, api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].PathParams!["vehicleID"]);
        Assert.Equal(DigitalTwinPageRegistration.SecurityOperation, api.Requests[1].OperationId);
        Assert.Equal(7L, api.Requests[1].Query!["vehicle_id"]);
        Assert.Equal(DigitalTwinPageRegistration.ChargingOperation, api.Requests[2].OperationId);
        Assert.Equal(7L, api.Requests[2].Query!["vehicle_id"]);
    }

    [Fact]
    public async Task ClientFeed_tolerates_a_failed_read_per_slice()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("state unavailable", 503))
           .ReturnsValue(Json(SecurityJson))
           .ReturnsValue(Json(IdleChargingJson));
        var feed = new DigitalTwinPageClientFeed(api);

        var readings = await feed.FetchReadingsAsync(7, default);

        Assert.Null(readings.State);          // the failed state read collapses to unknown…
        Assert.True(readings.HasSecurity);    // …while the others still render the twin.
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new DigitalTwinPageDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DigitalTwinPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("DigitalTwin", DigitalTwinPageRegistration.RouteName);
        Assert.Equal("get_api_v1_vehicles", DigitalTwinPageRegistration.VehiclesOperation);
        Assert.Equal("get_api_v1_vehicles_vehicleID_state", DigitalTwinPageRegistration.StateOperation);
        Assert.Equal("get_api_v1_security_latest", DigitalTwinPageRegistration.SecurityOperation);
        Assert.Equal("get_api_v1_charging_telemetry_latest", DigitalTwinPageRegistration.ChargingOperation);
        Assert.Equal("Digital Twin", DigitalTwinPageRegistration.Title(Localizer));
    }

    private static string Value(DigitalTwinPageDisplay display, string label) =>
        display.SecurityItems.First(i => i.Label == label).Value;

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
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

    private sealed class FakeFeed : IDigitalTwinPageFeed
    {
        public IReadOnlyList<DigitalTwinVehicle> Vehicles { get; set; } = [];

        public DigitalTwinReadings Readings { get; set; } = DigitalTwinReadings.Empty;

        public int VehiclesFetchCount { get; private set; }

        public int ReadingsFetchCount { get; private set; }

        public long? LastReadingsVehicleId { get; private set; }

        public Task<IReadOnlyList<DigitalTwinVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
        {
            VehiclesFetchCount++;
            return Task.FromResult(Vehicles);
        }

        public Task<DigitalTwinReadings> FetchReadingsAsync(long vehicleId, CancellationToken cancellationToken)
        {
            ReadingsFetchCount++;
            LastReadingsVehicleId = vehicleId;
            return Task.FromResult(Readings);
        }
    }
}
