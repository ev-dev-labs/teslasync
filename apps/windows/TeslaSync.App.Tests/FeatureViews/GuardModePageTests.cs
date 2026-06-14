using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.VehicleSystems;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>GuardModePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/vehicle-systems/pages/GuardModePage.tsx), the tolerant parsers, the generated-client
/// feed's request shaping (web <c>useGuardConfig</c> / <c>useGuardEvents</c> / <c>useVehicleState</c> /
/// <c>useGeofences</c> / <c>useSetGuardConfig</c> / <c>useGuardPanic</c> / <c>useAcknowledgeGuardEvent</c>) and
/// the view-model's four-state matrix (loading / empty / error / success) plus its mutations. The WinUI view
/// is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="GuardModeDisplay"/> flags asserted here.
/// </summary>
public sealed class GuardModePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 14, 12, 0, 0, TimeSpan.Zero);

    // The 38 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "guard.acknowledge", "guard.acknowledgedBy", "guard.alertTriggered", "guard.armed", "guard.armedSince",
        "guard.autoPanic", "guard.autoPanicHelp", "guard.disarmed", "guard.emergency", "guard.enableGuard",
        "guard.eventTimeline", "guard.homeGeofence", "guard.homeGeofenceHelp", "guard.liveMap", "guard.locked",
        "guard.noEvents", "guard.noGeofence", "guard.noLocation", "guard.notArmed", "guard.panicButton",
        "guard.panicConfirmLabel", "guard.panicConfirmMessage", "guard.panicConfirmTitle", "guard.panicDesc",
        "guard.panicking", "guard.saveSettings", "guard.sensitivity", "guard.sentryOff", "guard.sentryOn",
        "guard.settings", "guard.status", "guard.subtitle", "guard.title", "guard.triggered", "guard.unack",
        "guard.unackEvents", "guard.unlocked", "guard.updating",
    ];

    // Every operation the feed binds that must resolve against the generated endpoint table (ADR-004). The
    // guard-config WRITE is deliberately excluded: the backend route + the OpenAPI contract expose only the
    // GET, so the write id is not in the generated table (asserted separately).
    public static IEnumerable<object[]> ResolvableOperationIds() =>
    [
        [GuardModeRegistration.ConfigOperation],
        [GuardModeRegistration.EventsOperation],
        [GuardModeRegistration.StateOperation],
        [GuardModeRegistration.GeofencesOperation],
        [GuardModeRegistration.VehiclesOperation],
        [GuardModeRegistration.PanicOperation],
        [GuardModeRegistration.AcknowledgeOperation],
    ];

    private static GuardEvent SampleEvent(
        long id = 5,
        string type = "vehicle_moved",
        string? acknowledgedAt = null,
        string? acknowledgedBy = null,
        string ts = "2026-06-14T11:30:00Z") =>
        new(id, ts, type, FromState: "armed", ToState: "triggered", acknowledgedAt, acknowledgedBy);

    private static GuardModeModel RichModel(
        bool enabled = true,
        IReadOnlyList<GuardEvent>? events = null,
        GuardVehicleState? state = null,
        IReadOnlyList<GuardGeofence>? geofences = null) =>
        GuardModeModel.Initial with
        {
            VehicleId = 7,
            Config = new GuardConfig(7, enabled, HomeGeofenceId: 3, Sensitivity: "high", AutoPanic: true, UpdatedAt: "2026-06-14T10:00:00Z"),
            Events = events ?? [SampleEvent()],
            VehicleState = state ?? new GuardVehicleState(37.5, -122.3, IsLocked: true, SentryMode: true),
            Geofences = geofences ?? [new GuardGeofence(3, "Home", 37.5, -122.3, 150)],
            VehicleName = "My Tesla",
            Loading = false,
        };

    // ── i18n key coverage (all 38 manifest strings) ──────────────────────────────────

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = GuardModeProjection.Project(RichModel(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings are resolved on every projection regardless of data state (visibility is gated separately).
        _ = GuardModeProjection.Project(GuardModeModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ── Four data states ─────────────────────────────────────────────────────────────

    [Fact]
    public void State_loading_when_initial_with_no_data()
    {
        var display = GuardModeProjection.Project(GuardModeModel.Initial, Localizer, Now);

        Assert.Equal(GuardModeState.Loading, display.State);
        Assert.True(display.IsLoading);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_empty_when_no_vehicle_and_no_data()
    {
        var model = GuardModeModel.Initial with { Loading = false, VehicleId = 0 };

        var display = GuardModeProjection.Project(model, Localizer, Now);

        Assert.Equal(GuardModeState.Empty, display.State);
        Assert.False(display.IsLoading);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_error_when_read_failed_with_nothing_to_show()
    {
        var model = GuardModeModel.Initial with { Loading = false, HasError = true, VehicleId = 7 };

        var display = GuardModeProjection.Project(model, Localizer, Now);

        Assert.Equal(GuardModeState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(string.IsNullOrEmpty(display.ErrorMessage));
    }

    [Fact]
    public void State_success_when_configuration_resolved()
    {
        var display = GuardModeProjection.Project(RichModel(), Localizer, Now);

        Assert.Equal(GuardModeState.Success, display.State);
        Assert.False(display.IsLoading);
        Assert.False(display.ShowError);
    }

    // ── Status / shield derived values ───────────────────────────────────────────────

    [Fact]
    public void Armed_configuration_shows_armed_shield_and_headline()
    {
        var display = GuardModeProjection.Project(
            RichModel(enabled: true, events: []), Localizer, Now);

        Assert.True(display.IsArmed);
        Assert.Equal(GuardShieldState.Armed, display.Shield);
        Assert.Equal("Armed", display.StatusHeadline);
    }

    [Fact]
    public void Disarmed_configuration_shows_disarmed_shield()
    {
        var display = GuardModeProjection.Project(
            RichModel(enabled: false, events: []), Localizer, Now);

        Assert.False(display.IsArmed);
        Assert.Equal(GuardShieldState.Disarmed, display.Shield);
        Assert.Equal("Disarmed", display.StatusHeadline);
    }

    [Fact]
    public void Unacknowledged_non_test_event_triggers_alert()
    {
        var display = GuardModeProjection.Project(
            RichModel(events: [SampleEvent(type: "unauthorized_unlock")]), Localizer, Now);

        Assert.Equal(GuardShieldState.Triggered, display.Shield);
        Assert.Equal("TRIGGERED", display.StatusHeadline);
        Assert.True(display.ShowTriggeredAlert);
    }

    [Fact]
    public void Test_alert_does_not_trigger()
    {
        var display = GuardModeProjection.Project(
            RichModel(events: [SampleEvent(type: "test_alert")]), Localizer, Now);

        Assert.NotEqual(GuardShieldState.Triggered, display.Shield);
        Assert.False(display.ShowTriggeredAlert);
    }

    [Fact]
    public void Acknowledged_event_does_not_trigger()
    {
        var display = GuardModeProjection.Project(
            RichModel(events: [SampleEvent(acknowledgedAt: "2026-06-14T11:31:00Z", acknowledgedBy: "admin")]), Localizer, Now);

        Assert.False(display.ShowTriggeredAlert);
        Assert.Equal(0, display.UnacknowledgedCount);
        Assert.False(display.ShowUnackBadge);
    }

    [Fact]
    public void Unacknowledged_events_drive_the_count_badge()
    {
        var display = GuardModeProjection.Project(
            RichModel(events: [SampleEvent(id: 1), SampleEvent(id: 2)]), Localizer, Now);

        Assert.Equal(2, display.UnacknowledgedCount);
        Assert.True(display.ShowUnackBadge);
        Assert.Contains("2", display.UnackSummaryText);
    }

    // ── Settings derived values ──────────────────────────────────────────────────────

    [Fact]
    public void Sensitivity_options_cover_the_three_tiers()
    {
        var display = GuardModeProjection.Project(RichModel(), Localizer, Now);

        Assert.Equal(new[] { "low", "medium", "high" }, display.SensitivityOptions.Select(o => o.Value));
    }

    [Fact]
    public void Effective_sensitivity_prefers_the_form_edit_over_config()
    {
        var model = RichModel() with { FormSensitivity = "low" };

        var display = GuardModeProjection.Project(model, Localizer, Now);

        Assert.Equal("low", display.SelectedSensitivity);
    }

    [Fact]
    public void Effective_sensitivity_falls_back_to_config_then_medium()
    {
        var fromConfig = GuardModeProjection.Project(RichModel(), Localizer, Now);
        Assert.Equal("high", fromConfig.SelectedSensitivity);

        var noConfig = GuardModeProjection.Project(
            GuardModeModel.Initial with { Loading = false, VehicleId = 7 }, Localizer, Now);
        Assert.Equal("medium", noConfig.SelectedSensitivity);
    }

    [Fact]
    public void Geofence_options_lead_with_the_no_geofence_sentinel()
    {
        var display = GuardModeProjection.Project(RichModel(), Localizer, Now);

        Assert.Equal(string.Empty, display.GeofenceOptions[0].Value);
        Assert.Contains(display.GeofenceOptions, o => o.Value == "3");
        Assert.Equal("3", display.SelectedGeofenceId);
    }

    [Fact]
    public void Auto_panic_checkbox_is_form_or_config()
    {
        var fromConfig = GuardModeProjection.Project(RichModel(), Localizer, Now);
        Assert.True(fromConfig.AutoPanicChecked);

        var off = GuardModeProjection.Project(
            RichModel() with { Config = new GuardConfig(7, true, 3, "high", AutoPanic: false, "2026-06-14T10:00:00Z") },
            Localizer,
            Now);
        Assert.False(off.AutoPanicChecked);
    }

    // ── Live map derived values ──────────────────────────────────────────────────────

    [Fact]
    public void Map_renders_with_a_valid_location()
    {
        var display = GuardModeProjection.Project(RichModel(), Localizer, Now);

        Assert.True(display.HasLocation);
        Assert.Equal(37.5, display.VehicleLat);
        Assert.Equal(-122.3, display.VehicleLng);
        Assert.Equal("My Tesla", display.MarkerLabel);
        Assert.Contains("37.5", display.MarkerPopupCoords);
    }

    [Fact]
    public void Map_empty_when_position_is_zero_or_missing()
    {
        var zero = GuardModeProjection.Project(
            RichModel(state: new GuardVehicleState(0, 0, false, false)), Localizer, Now);
        Assert.False(zero.HasLocation);

        var missing = GuardModeProjection.Project(
            GuardModeModel.Initial with
            {
                Loading = false,
                VehicleId = 7,
                Config = new GuardConfig(7, true, null, "high", true, "2026-06-14T10:00:00Z"),
            },
            Localizer,
            Now);
        Assert.False(missing.HasLocation);
    }

    [Fact]
    public void Home_geofence_circle_resolves_from_the_selected_geofence()
    {
        var display = GuardModeProjection.Project(RichModel(), Localizer, Now);

        Assert.True(display.HasHomeGeofence);
        Assert.Equal(37.5, display.HomeGeofenceLat);
        Assert.Equal(150, display.HomeGeofenceRadius);
    }

    // ── Event row projection ─────────────────────────────────────────────────────────

    [Fact]
    public void Unacknowledged_event_row_shows_the_ack_button()
    {
        var display = GuardModeProjection.Project(
            RichModel(events: [SampleEvent(id: 9, type: "manual_panic")]), Localizer, Now);

        var row = Assert.Single(display.Events);
        Assert.True(row.ShowAckButton);
        Assert.False(row.Acknowledged);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Danger, row.BadgeStatus);
        Assert.NotNull(row.TransitionText);
    }

    [Fact]
    public void Acknowledged_event_row_hides_the_ack_button_and_shows_who()
    {
        var display = GuardModeProjection.Project(
            RichModel(events: [SampleEvent(acknowledgedAt: "2026-06-14T11:31:00Z", acknowledgedBy: "admin@local")]),
            Localizer,
            Now);

        var row = Assert.Single(display.Events);
        Assert.False(row.ShowAckButton);
        Assert.True(row.Acknowledged);
        Assert.NotNull(row.AcknowledgedByText);
        Assert.Contains("admin@local", row.AcknowledgedByText);
    }

    [Fact]
    public void Unknown_event_type_falls_back_to_the_raw_token()
    {
        var display = GuardModeProjection.Project(
            RichModel(events: [SampleEvent(type: "brand_new_kind")]), Localizer, Now);

        var row = Assert.Single(display.Events);
        Assert.Equal("brand_new_kind", row.BadgeLabel);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Info, row.BadgeStatus);
    }

    [Fact]
    public void No_events_drives_the_timeline_empty_surface()
    {
        var display = GuardModeProjection.Project(RichModel(events: []), Localizer, Now);

        Assert.False(display.HasEvents);
        Assert.Empty(display.Events);
        Assert.False(string.IsNullOrEmpty(display.NoEventsMessage));
    }

    // ── Tolerant parsers ─────────────────────────────────────────────────────────────

    [Fact]
    public void GuardConfig_parses_the_snake_case_body()
    {
        var config = GuardConfig.FromJson(Json(
            "{\"vehicle_id\":7,\"enabled\":true,\"home_geofence_id\":3,\"sensitivity\":\"high\",\"auto_panic\":true,\"updated_at\":\"2026-06-14T10:00:00Z\"}"));

        Assert.NotNull(config);
        Assert.True(config!.Enabled);
        Assert.Equal(3, config.HomeGeofenceId);
        Assert.Equal("high", config.Sensitivity);
        Assert.True(config.AutoPanic);
    }

    [Fact]
    public void GuardConfig_is_null_for_a_non_object_body()
    {
        Assert.Null(GuardConfig.FromJson(Json("null")));
        Assert.Null(GuardConfig.FromJson(Json("[]")));
    }

    [Fact]
    public void GuardEvents_unwrap_the_envelope_like_safeArray()
    {
        var events = GuardEvent.ParseEnvelope(Json(
            "{\"vehicle_id\":7,\"events\":[{\"id\":1,\"ts\":\"2026-06-14T11:00:00Z\",\"event_type\":\"locked\"},{\"id\":2,\"event_type\":\"sentry_mode\"}]}"));

        Assert.Equal(2, events.Count);
        Assert.Equal(1, events[0].Id);
        Assert.Equal("locked", events[0].EventType);
    }

    [Fact]
    public void GuardEvents_tolerate_a_missing_array()
    {
        Assert.Empty(GuardEvent.ParseEnvelope(Json("{\"vehicle_id\":7}")));
        Assert.Empty(GuardEvent.ParseEnvelope(Json("[]")));
    }

    [Fact]
    public void GuardEvent_acknowledgement_is_derived_from_the_timestamp()
    {
        var acked = GuardEvent.FromJson(Json("{\"id\":1,\"event_type\":\"locked\",\"acknowledged_at\":\"2026-06-14T11:31:00Z\"}"));
        var open = GuardEvent.FromJson(Json("{\"id\":2,\"event_type\":\"locked\"}"));

        Assert.True(acked.IsAcknowledged);
        Assert.False(open.IsAcknowledged);
    }

    [Fact]
    public void Geofences_parse_a_bare_array_and_an_envelope()
    {
        var bare = GuardGeofence.ParseList(Json("[{\"id\":3,\"name\":\"Home\",\"latitude\":37.5,\"longitude\":-122.3,\"radius\":150}]"));
        Assert.Single(bare);
        Assert.Equal("Home", bare[0].Name);

        var enveloped = GuardGeofence.ParseList(Json("{\"geofences\":[{\"id\":4,\"name\":\"Work\",\"latitude\":1,\"longitude\":2,\"radius\":10}]}"));
        Assert.Single(enveloped);
        Assert.Equal(4, enveloped[0].Id);
    }

    [Fact]
    public void VehicleState_unwraps_nested_state_and_flat_object()
    {
        var nested = GuardVehicleState.FromJson(Json("{\"state\":{\"latitude\":1.5,\"longitude\":2.5,\"is_locked\":true,\"sentry_mode\":true}}"));
        Assert.NotNull(nested);
        Assert.True(nested!.IsLocked);
        Assert.True(nested.HasLocation);

        var flat = GuardVehicleState.FromJson(Json("{\"latitude\":3.5,\"longitude\":4.5,\"is_locked\":false,\"sentry_mode\":false}"));
        Assert.NotNull(flat);
        Assert.Equal(3.5, flat!.Latitude);
    }

    // ── Generated-client feed request shaping ────────────────────────────────────────

    [Fact]
    public async Task Feed_config_read_targets_the_guard_endpoint()
    {
        var api = new FakeApiClient().ReturnsValue(Json("{\"vehicle_id\":7,\"enabled\":true}"));
        var feed = new GuardModeClientFeed(api);

        var config = await feed.FetchConfigAsync(7, default);

        Assert.NotNull(config);
        var request = Assert.Single(api.Requests);
        Assert.Equal(GuardModeRegistration.ConfigOperation, request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Feed_events_read_targets_the_events_endpoint()
    {
        var api = new FakeApiClient().ReturnsValue(Json("{\"events\":[]}"));
        var feed = new GuardModeClientFeed(api);

        await feed.FetchEventsAsync(7, default);

        Assert.Equal(GuardModeRegistration.EventsOperation, api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Feed_state_and_geofence_and_vehicle_reads_target_their_endpoints()
    {
        var state = new FakeApiClient().ReturnsValue(Json("{\"latitude\":1,\"longitude\":2}"));
        await new GuardModeClientFeed(state).FetchVehicleStateAsync(7, default);
        Assert.Equal(GuardModeRegistration.StateOperation, state.Requests[0].OperationId);

        var geofences = new FakeApiClient().ReturnsValue(Json("[]"));
        await new GuardModeClientFeed(geofences).FetchGeofencesAsync(default);
        Assert.Equal(GuardModeRegistration.GeofencesOperation, geofences.Requests[0].OperationId);

        var vehicles = new FakeApiClient().ReturnsValue(Json("[{\"id\":7,\"display_name\":\"My Tesla\"}]"));
        var parsed = await new GuardModeClientFeed(vehicles).FetchVehiclesAsync(default);
        Assert.Equal(GuardModeRegistration.VehiclesOperation, vehicles.Requests[0].OperationId);
        Assert.Equal("My Tesla", parsed[0].DisplayName);
    }

    [Fact]
    public async Task Feed_set_config_posts_the_snake_case_body()
    {
        var api = new FakeApiClient().ReturnsValue(Json("{}"));
        var feed = new GuardModeClientFeed(api);

        await feed.SetConfigAsync(7, new GuardConfigWrite(Enabled: true, HomeGeofenceId: 3, Sensitivity: "high", AutoPanic: false), default);

        var request = Assert.Single(api.Requests);
        Assert.Equal(GuardModeRegistration.SetConfigOperation, request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
        var body = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(request.Body);
        Assert.Equal(true, body["enabled"]);
        Assert.Equal("high", body["sensitivity"]);
    }

    [Fact]
    public async Task Feed_panic_and_acknowledge_post_with_the_right_path_params()
    {
        var panic = new FakeApiClient().ReturnsValue(Json("{}"));
        await new GuardModeClientFeed(panic).PanicAsync(7, default);
        Assert.Equal(GuardModeRegistration.PanicOperation, panic.Requests[0].OperationId);
        Assert.Equal("7", panic.Requests[0].PathParams!["vehicleID"]);

        var ack = new FakeApiClient().ReturnsValue(Json("{}"));
        await new GuardModeClientFeed(ack).AcknowledgeAsync(7, 42, default);
        Assert.Equal(GuardModeRegistration.AcknowledgeOperation, ack.Requests[0].OperationId);
        Assert.Equal("7", ack.Requests[0].PathParams!["vehicleID"]);
        Assert.Equal("42", ack.Requests[0].PathParams!["eventID"]);
    }

    // ── Operation ids resolve against the generated contract (ADR-004) ───────────────

    [Theory]
    [MemberData(nameof(ResolvableOperationIds))]
    public void Read_and_command_operations_resolve_in_the_generated_table(string operationId)
    {
        Assert.True(
            GeneratedApi.ApiEndpoints.All.Any(e => e.OperationId == operationId),
            $"Operation '{operationId}' is not in the generated endpoint table.");
    }

    [Fact]
    public void Set_config_write_is_a_web_parity_write_absent_from_the_generated_contract()
    {
        // The backend (internal/api/router.go) + the OpenAPI spec expose only GET /vehicles/{id}/guard; the web
        // page still POSTs to it via useSetGuardConfig, so the page wires the write and a non-2xx / missing
        // endpoint degrades to the error toast (mirrored by the view-model's mutation error handling).
        Assert.DoesNotContain(GeneratedApi.ApiEndpoints.All, e => e.OperationId == GuardModeRegistration.SetConfigOperation);
    }

    // ── View-model state matrix + mutations ──────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loads_into_success_with_a_resolved_configuration()
    {
        var feed = new FakeGuardModeFeed
        {
            Vehicles = [new VehicleOption(7, "My Tesla")],
            Config = new GuardConfig(7, true, 3, "high", true, "2026-06-14T10:00:00Z"),
            Events = [SampleEvent()],
            VehicleState = new GuardVehicleState(37.5, -122.3, true, true),
            Geofences = [new GuardGeofence(3, "Home", 37.5, -122.3, 150)],
        };
        using var vm = new GuardModePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(GuardModeState.Success, vm.State);
        Assert.Equal(7, vm.SelectedVehicleId);
    }

    [Fact]
    public async Task ViewModel_loads_into_empty_without_a_vehicle()
    {
        using var vm = new GuardModePageViewModel(EmptyGuardModeFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(GuardModeState.Empty, vm.State);
        Assert.Null(vm.SelectedVehicleId);
    }

    [Fact]
    public async Task ViewModel_surfaces_error_when_the_config_read_fails_with_no_data()
    {
        var feed = new FakeGuardModeFeed
        {
            Vehicles = [new VehicleOption(7, "My Tesla")],
            ConfigThrows = true,
        };
        using var vm = new GuardModePageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(GuardModeState.Error, vm.State);
    }

    [Fact]
    public async Task ViewModel_toggle_writes_the_inverted_enabled_flag()
    {
        var feed = new FakeGuardModeFeed
        {
            Vehicles = [new VehicleOption(7, "My Tesla")],
            Config = new GuardConfig(7, Enabled: true, 3, "high", false, "2026-06-14T10:00:00Z"),
            Events = [SampleEvent()],
        };
        using var vm = new GuardModePageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.ToggleGuardAsync();

        Assert.NotNull(feed.LastWrite);
        Assert.False(feed.LastWrite!.Enabled);
        Assert.Equal("high", feed.LastWrite.Sensitivity);
        Assert.True(feed.SetConfigCount >= 1);
    }

    [Fact]
    public async Task ViewModel_save_keeps_the_armed_state_and_posts_the_form()
    {
        var feed = new FakeGuardModeFeed
        {
            Vehicles = [new VehicleOption(7, "My Tesla")],
            Config = new GuardConfig(7, Enabled: true, 3, "medium", false, "2026-06-14T10:00:00Z"),
        };
        using var vm = new GuardModePageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.SetSensitivity("low");

        await vm.SaveSettingsAsync();

        Assert.NotNull(feed.LastWrite);
        Assert.True(feed.LastWrite!.Enabled);
        Assert.Equal("low", feed.LastWrite.Sensitivity);
    }

    [Fact]
    public async Task ViewModel_panic_invokes_the_feed_and_pushes_a_toast()
    {
        var feed = new FakeGuardModeFeed { Vehicles = [new VehicleOption(7, "My Tesla")], Config = new GuardConfig(7, true, null, "high", false, null) };
        using var vm = new GuardModePageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        int beforeToast = vm.ToastSequence;

        await vm.PanicAsync();

        Assert.Equal(1, feed.PanicCount);
        Assert.True(vm.ToastSequence > beforeToast);
        Assert.False(vm.ToastIsError);
    }

    [Fact]
    public async Task ViewModel_acknowledge_invokes_the_feed_with_the_event_id()
    {
        var feed = new FakeGuardModeFeed
        {
            Vehicles = [new VehicleOption(7, "My Tesla")],
            Config = new GuardConfig(7, true, null, "high", false, null),
            Events = [SampleEvent(id: 99)],
        };
        using var vm = new GuardModePageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.AcknowledgeAsync(99);

        Assert.Equal(99, feed.LastAcknowledgedEventId);
    }

    [Fact]
    public async Task ViewModel_mutation_failure_pushes_an_error_toast()
    {
        var feed = new FakeGuardModeFeed
        {
            Vehicles = [new VehicleOption(7, "My Tesla")],
            Config = new GuardConfig(7, true, null, "high", false, null),
            SetConfigThrows = true,
        };
        using var vm = new GuardModePageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.SaveSettingsAsync();

        Assert.True(vm.ToastIsError);
    }

    [Fact]
    public void ViewModel_setters_reproject_without_a_reload()
    {
        var feed = new FakeGuardModeFeed { Vehicles = [new VehicleOption(7, "My Tesla")] };
        using var vm = new GuardModePageViewModel(feed, Localizer, () => Now);

        vm.SetAutoPanic(true);

        Assert.True(vm.Display.AutoPanicChecked);
        Assert.Equal(0, feed.SetConfigCount);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────

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

    private sealed class FakeGuardModeFeed : IGuardModeFeed
    {
        public IReadOnlyList<VehicleOption> Vehicles { get; set; } = Array.Empty<VehicleOption>();

        public GuardConfig? Config { get; set; }

        public IReadOnlyList<GuardEvent> Events { get; set; } = Array.Empty<GuardEvent>();

        public GuardVehicleState? VehicleState { get; set; }

        public IReadOnlyList<GuardGeofence> Geofences { get; set; } = Array.Empty<GuardGeofence>();

        public bool ConfigThrows { get; set; }

        public bool SetConfigThrows { get; set; }

        public GuardConfigWrite? LastWrite { get; private set; }

        public int SetConfigCount { get; private set; }

        public int PanicCount { get; private set; }

        public long? LastAcknowledgedEventId { get; private set; }

        public Task<GuardConfig?> FetchConfigAsync(long vehicleId, CancellationToken cancellationToken)
        {
            if (ConfigThrows)
            {
                throw new InvalidOperationException("config read failed");
            }

            return Task.FromResult(Config);
        }

        public Task<IReadOnlyList<GuardEvent>> FetchEventsAsync(long vehicleId, CancellationToken cancellationToken) =>
            Task.FromResult(Events);

        public Task<GuardVehicleState?> FetchVehicleStateAsync(long vehicleId, CancellationToken cancellationToken) =>
            Task.FromResult(VehicleState);

        public Task<IReadOnlyList<GuardGeofence>> FetchGeofencesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(Geofences);

        public Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(Vehicles);

        public Task SetConfigAsync(long vehicleId, GuardConfigWrite write, CancellationToken cancellationToken)
        {
            SetConfigCount++;
            LastWrite = write;
            if (SetConfigThrows)
            {
                throw new InvalidOperationException("set config failed");
            }

            return Task.CompletedTask;
        }

        public Task PanicAsync(long vehicleId, CancellationToken cancellationToken)
        {
            PanicCount++;
            return Task.CompletedTask;
        }

        public Task AcknowledgeAsync(long vehicleId, long eventId, CancellationToken cancellationToken)
        {
            LastAcknowledgedEventId = eventId;
            return Task.CompletedTask;
        }
    }
}
