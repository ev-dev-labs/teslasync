using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Automations;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AutomationBuilderPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/automations/pages/AutomationBuilderPage.tsx), the typed-graph codec (parse + serialize +
/// validate, the native port of <c>normalizeTriggerInput</c> / <c>normalizeConditionInput</c> /
/// <c>normalizeActionInput</c> / <c>formToPayload</c> / <c>validate</c>), the tolerant snapshot parsers (incl. the
/// platform <c>{data:…}</c> envelope), the view-model's four-state matrix (loading / not-found empty / load-error /
/// success) plus the save / test-run flows, and the generated-client feed's request shaping for all seven web hooks.
/// The WinUI view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="AutomationBuilderDisplay"/> flags asserted here.
/// </summary>
public sealed class AutomationBuilderPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static readonly string[] RequiredStringKeys =
    [
        "automations.builder.allVehicles", "automations.builder.backToList", "automations.builder.cancel",
        "automations.builder.create", "automations.builder.createTitle", "automations.builder.description",
        "automations.builder.descriptionPlaceholder", "automations.builder.editBreadcrumb",
        "automations.builder.editTitle", "automations.builder.emptyTrigger", "automations.builder.enabled",
        "automations.builder.errorActionDetails", "automations.builder.errorActions",
        "automations.builder.errorConditionPlace", "automations.builder.errorName", "automations.builder.errorTrigger",
        "automations.builder.errorTriggerPlace", "automations.builder.general", "automations.builder.name",
        "automations.builder.namePlaceholder", "automations.builder.notFound", "automations.builder.onlyIf",
        "automations.builder.onlyIfDesc", "automations.builder.presetHint", "automations.builder.presetTitle",
        "automations.builder.save", "automations.builder.saveError", "automations.builder.selectTrigger",
        "automations.builder.subtitle", "automations.builder.testRun", "automations.builder.testRunStarted",
        "automations.builder.then", "automations.builder.thenDesc", "automations.builder.triggerType",
        "automations.builder.vehicle", "automations.builder.vehicleFallback", "automations.builder.when",
        "automations.builder.whenDesc", "draft.noun.automation", "editConflict.resource.automation",
        "forms.unsavedAutomation",
    ];

    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();

    // ---- i18n key coverage (all 41 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = AutomationBuilderProjection.Project(AutomationBuilderModel.InitialCreate(), recorder);

        Assert.Equal(41, RequiredStringKeys.Length);
        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_keys_in_every_mode()
    {
        foreach (var mode in new[] { AutomationBuilderMode.Create, AutomationBuilderMode.Preset, AutomationBuilderMode.Edit })
        {
            var recorder = new RecordingLocalizer();
            var model = AutomationBuilderModel.InitialCreate() with { Mode = mode, AutomationFound = true };
            _ = AutomationBuilderProjection.Project(model, recorder);
            foreach (var key in RequiredStringKeys)
            {
                Assert.Contains(key, recorder.Keys);
            }
        }
    }

    // ---- Data states (loading / empty / error / success) ----------------------------

    [Fact]
    public void State_success_in_create_mode()
    {
        var display = AutomationBuilderProjection.Project(AutomationBuilderModel.InitialCreate(), Localizer);
        Assert.Equal(AutomationBuilderState.Success, display.State);
        Assert.True(display.ShowForm);
        Assert.False(display.ShowLoading);
        Assert.Equal("Create Automation", display.Title);
        Assert.Equal("Create", display.PrimaryActionLabel);
    }

    [Fact]
    public void State_loading_when_edit_query_in_flight()
    {
        var model = AutomationBuilderModel.InitialCreate() with
        {
            Mode = AutomationBuilderMode.Edit,
            IsLoadingAutomation = true,
        };
        var display = AutomationBuilderProjection.Project(model, Localizer);
        Assert.Equal(AutomationBuilderState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowForm);
        Assert.Equal("Edit Automation", display.Title);
    }

    [Fact]
    public void State_error_when_edit_load_failed()
    {
        var model = AutomationBuilderModel.InitialCreate() with
        {
            Mode = AutomationBuilderMode.Edit,
            HasLoadError = true,
            LoadErrorDetail = "boom",
        };
        var display = AutomationBuilderProjection.Project(model, Localizer);
        Assert.Equal(AutomationBuilderState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Equal("boom", display.LoadErrorDetail);
        Assert.False(display.ShowForm);
    }

    [Fact]
    public void State_empty_when_edit_automation_not_found()
    {
        var model = AutomationBuilderModel.InitialCreate() with
        {
            Mode = AutomationBuilderMode.Edit,
            AutomationFound = false,
        };
        var display = AutomationBuilderProjection.Project(model, Localizer);
        Assert.Equal(AutomationBuilderState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.Equal("Automation not found", display.NotFoundMessage);
    }

    [Fact]
    public void State_success_when_edit_automation_found()
    {
        var model = AutomationBuilderModel.InitialCreate() with
        {
            Mode = AutomationBuilderMode.Edit,
            AutomationFound = true,
            AutomationName = "Commute",
        };
        var display = AutomationBuilderProjection.Project(model, Localizer);
        Assert.Equal(AutomationBuilderState.Success, display.State);
        Assert.True(display.ShowForm);
        Assert.Equal("Save", display.PrimaryActionLabel);
        Assert.Equal("Edit: Commute", display.BreadcrumbLabel);
    }

    // ---- Panels (GlassPanel1 / GlassPanel2 / GlassPanel3) ---------------------------

    [Fact]
    public void Panel_trigger_configurator_shows_when_trigger_chosen()
    {
        var form = AutomationBuilderForm.InitialCreate() with
        {
            Trigger = AutomationTrigger.CreateDefault(AutomationTriggerKind.Signal),
        };
        var display = AutomationBuilderProjection.Project(AutomationBuilderModel.InitialCreate() with { Form = form }, Localizer);
        Assert.True(display.HasTrigger);
        Assert.Equal("trigger_signal", display.SelectedTriggerWire);
    }

    [Fact]
    public void Panel_empty_trigger_shows_when_no_trigger()
    {
        var display = AutomationBuilderProjection.Project(AutomationBuilderModel.InitialCreate(), Localizer);
        Assert.False(display.HasTrigger);
        Assert.Equal(string.Empty, display.SelectedTriggerWire);
        Assert.Equal(
            "Select a supported trigger type to configure when this automation starts.",
            display.EmptyTriggerMessage);
    }

    [Fact]
    public void Panel_preset_hint_shows_in_create_and_preset_but_not_edit()
    {
        Assert.True(AutomationBuilderProjection.Project(AutomationBuilderModel.InitialCreate(), Localizer).ShowPresetHint);
        Assert.True(AutomationBuilderProjection
            .Project(AutomationBuilderModel.InitialCreate() with { Mode = AutomationBuilderMode.Preset }, Localizer)
            .ShowPresetHint);
        Assert.False(AutomationBuilderProjection
            .Project(AutomationBuilderModel.InitialCreate() with { Mode = AutomationBuilderMode.Edit, AutomationFound = true }, Localizer)
            .ShowPresetHint);
    }

    [Fact]
    public void Vehicle_options_lead_with_all_vehicles_and_use_fallback()
    {
        var model = AutomationBuilderModel.InitialCreate() with
        {
            Vehicles = new[] { new VehicleOptionRow(7, "Model 3"), new VehicleOptionRow(9, null) },
        };
        var display = AutomationBuilderProjection.Project(model, Localizer);
        Assert.Equal(3, display.VehicleOptions.Count);
        Assert.Equal(string.Empty, display.VehicleOptions[0].Value);
        Assert.Equal("All Vehicles", display.VehicleOptions[0].Label);
        Assert.Equal("Model 3", display.VehicleOptions[1].Label);
        Assert.Equal("Vehicle 9", display.VehicleOptions[2].Label);
    }

    [Fact]
    public void Trigger_options_lead_with_placeholder_then_the_four_kinds()
    {
        var display = AutomationBuilderProjection.Project(AutomationBuilderModel.InitialCreate(), Localizer);
        Assert.Equal(5, display.TriggerOptions.Count);
        Assert.Equal(string.Empty, display.TriggerOptions[0].Wire);
        Assert.Equal(
            new[] { "trigger_schedule", "trigger_event", "trigger_geofence", "trigger_signal" },
            display.TriggerOptions.Skip(1).Select(o => o.Wire).ToArray());
    }

    // ---- Validation (web validate() chain) ------------------------------------------

    private static AutomationValidationCopy ValidationCopy() =>
        AutomationBuilderProjection.Project(AutomationBuilderModel.InitialCreate(), Localizer).Validation;

    [Fact]
    public void Validate_requires_a_name()
    {
        var form = AutomationBuilderForm.InitialCreate();
        Assert.Equal("Name is required", AutomationValidator.Validate(form, ValidationCopy()));
    }

    [Fact]
    public void Validate_requires_a_trigger()
    {
        var form = AutomationBuilderForm.InitialCreate() with { Name = "X" };
        Assert.Equal("Trigger type is required", AutomationValidator.Validate(form, ValidationCopy()));
    }

    [Fact]
    public void Validate_requires_a_geofence_place_on_the_trigger()
    {
        var form = AutomationBuilderForm.InitialCreate() with
        {
            Name = "X",
            Trigger = new GeofenceTrigger(0, AutomationGeofenceEvent.Enter),
        };
        Assert.Equal("Select a geofence for the trigger", AutomationValidator.Validate(form, ValidationCopy()));
    }

    [Fact]
    public void Validate_requires_a_geofence_place_on_each_condition()
    {
        var form = AutomationBuilderForm.InitialCreate() with
        {
            Name = "X",
            Trigger = AutomationTrigger.CreateDefault(AutomationTriggerKind.Signal),
            Conditions = new AutomationCondition[] { new AutomationCondition.GeofenceCondition(0, AutomationGeofenceState.Inside) },
        };
        Assert.Equal("Select a geofence for each geofence condition", AutomationValidator.Validate(form, ValidationCopy()));
    }

    [Fact]
    public void Validate_requires_at_least_one_action()
    {
        var form = AutomationBuilderForm.InitialCreate() with
        {
            Name = "X",
            Trigger = AutomationTrigger.CreateDefault(AutomationTriggerKind.Signal),
            Actions = System.Array.Empty<AutomationActionStepInput>(),
        };
        Assert.Equal("At least one action is required", AutomationValidator.Validate(form, ValidationCopy()));
    }

    [Fact]
    public void Validate_requires_complete_actions()
    {
        var form = AutomationBuilderForm.InitialCreate() with
        {
            Name = "X",
            Trigger = AutomationTrigger.CreateDefault(AutomationTriggerKind.Signal),
            Actions = new[] { new AutomationActionStepInput(AutomationActionKind.Command) { CommandName = string.Empty } },
        };
        Assert.Equal("Complete every action before saving", AutomationValidator.Validate(form, ValidationCopy()));
    }

    [Fact]
    public void Validate_passes_for_a_complete_form()
    {
        var form = AutomationBuilderForm.InitialCreate() with
        {
            Name = "Commute",
            Trigger = AutomationTrigger.CreateDefault(AutomationTriggerKind.Signal),
        };
        Assert.Null(AutomationValidator.Validate(form, ValidationCopy()));
    }

    [Theory]
    [InlineData(AutomationActionKind.Notify)]
    [InlineData(AutomationActionKind.SetSetting)]
    [InlineData(AutomationActionKind.CallAutomation)]
    public void Incomplete_actions_are_detected(AutomationActionKind kind)
    {
        var action = new AutomationActionStepInput(kind);
        Assert.True(AutomationValidator.IsActionIncomplete(action));
    }

    // ---- Graph codec: parse (web normalize* on load) --------------------------------

    [Fact]
    public void Parse_hydrates_a_full_automation()
    {
        var automation = Json("""
        {
          "id": 12, "name": "Commute", "description": "morning", "vehicle_id": 4, "enabled": false,
          "triggers": [ { "kind": "trigger_signal", "signal": "battery_level", "op": "<", "value_num": 30 } ],
          "conditions": [ { "kind": "condition_geofence", "place_id": 8, "state": "outside" } ],
          "actions": [ { "kind": "action_notify", "channel_id": 3, "template": "go" } ]
        }
        """);

        var snapshot = AutomationDetailSnapshot.FromJson(automation);

        Assert.True(snapshot.Found);
        Assert.Equal("Commute", snapshot.Name);
        Assert.Equal("morning", snapshot.Form.Description);
        Assert.Equal(4L, snapshot.Form.VehicleId!.Value);
        Assert.False(snapshot.Form.Enabled);

        var trigger = Assert.IsType<SignalTrigger>(snapshot.Form.Trigger);
        Assert.Equal("battery_level", trigger.Signal);
        Assert.Equal(AutomationTriggerSignalOp.LessThan, trigger.Op);
        Assert.Equal(30d, trigger.ValueNum!.Value);

        var condition = Assert.IsType<AutomationCondition.GeofenceCondition>(Assert.Single(snapshot.Form.Conditions));
        Assert.Equal(8L, condition.PlaceId);
        Assert.Equal(AutomationGeofenceState.Outside, condition.State);

        var action = Assert.Single(snapshot.Form.Actions);
        Assert.Equal(AutomationActionKind.Notify, action.Kind);
        Assert.Equal(3L, action.ChannelId);
        Assert.Equal("go", action.Template);
    }

    [Fact]
    public void Parse_unwraps_the_data_envelope_and_handles_not_found()
    {
        var wrapped = Json("""{ "data": { "id": 5, "name": "Wrapped", "triggers": [], "actions": [] } }""");
        Assert.True(AutomationDetailSnapshot.FromJson(wrapped).Found);

        var empty = Json("""{ "error": "nope" }""");
        Assert.False(AutomationDetailSnapshot.FromJson(empty).Found);
    }

    [Fact]
    public void Parse_preset_scopes_to_all_vehicles_and_enabled()
    {
        var preset = Json("""
        { "id": "sentry", "name": "Sentry Alert", "description": "watch",
          "triggers": [ { "kind": "trigger_event", "event_type": "sentry_alert" } ],
          "actions": [ { "kind": "action_command", "command_name": "honk" } ] }
        """);

        var snapshot = AutomationPresetSnapshot.FromJson(preset);
        Assert.True(snapshot.Found);
        Assert.Null(snapshot.Form.VehicleId);
        Assert.True(snapshot.Form.Enabled);
        Assert.IsType<EventTrigger>(snapshot.Form.Trigger);
    }

    [Fact]
    public void Parse_vehicles_and_channels_tolerate_envelopes()
    {
        var vehicles = VehicleOptionRow.ParseList(Json("""{ "data": [ { "id": 1, "display_name": "Red" }, { "id": 2 } ] }"""));
        Assert.Equal(2, vehicles.Count);
        Assert.Equal("Red", vehicles[0].DisplayName);
        Assert.Null(vehicles[1].DisplayName);

        var channels = AutomationChannelList.ParseList(Json("""[ { "id": 3, "name": "Email", "type": "email", "enabled": true } ]"""));
        var channel = Assert.Single(channels);
        Assert.Equal(3L, channel.Id);
        Assert.Equal("Email", channel.Name);
        Assert.Equal("email", channel.Kind);
    }

    // ---- Graph codec: serialize (web formToPayload) ---------------------------------

    [Fact]
    public void Serialize_produces_the_snake_case_envelope()
    {
        var form = new AutomationBuilderForm(
            Name: "  Commute  ",
            Description: " prep ",
            VehicleId: 4,
            Enabled: true,
            Trigger: new SignalTrigger("battery_level", AutomationTriggerSignalOp.LessThan, ValueNum: 20),
            Conditions: new AutomationCondition[]
            {
                new AutomationCondition.TimeWindowCondition("08:00", "09:00", "UTC", new[] { 1, 2, 3 }),
            },
            Actions: new[]
            {
                new AutomationActionStepInput(AutomationActionKind.Notify) { ChannelId = 3, Template = "go" },
            });

        var payload = AutomationGraphCodec.SerializePayload(form);

        Assert.Equal("Commute", payload["name"]!.GetValue<string>());
        Assert.Equal("prep", payload["description"]!.GetValue<string>());
        Assert.Equal(4L, payload["vehicle_id"]!.GetValue<long>());
        Assert.True(payload["enabled"]!.GetValue<bool>());

        var trigger = Assert.IsType<JsonArray>(payload["triggers"]);
        Assert.Equal("trigger_signal", trigger[0]!["kind"]!.GetValue<string>());
        Assert.Equal("<", trigger[0]!["op"]!.GetValue<string>());
        Assert.Equal(20d, trigger[0]!["value_num"]!.GetValue<double>());

        var condition = Assert.IsType<JsonArray>(payload["conditions"]);
        Assert.Equal("condition_time_window", condition[0]!["kind"]!.GetValue<string>());
        Assert.Equal(3, condition[0]!["days_of_week"]!.AsArray().Count);

        var action = Assert.IsType<JsonArray>(payload["actions"]);
        Assert.Equal("action_notify", action[0]!["kind"]!.GetValue<string>());
        Assert.Equal(3L, action[0]!["channel_id"]!.GetValue<long>());
    }

    [Fact]
    public void Serialize_omits_the_trigger_when_none_and_nulls_the_vehicle()
    {
        var payload = AutomationGraphCodec.SerializePayload(AutomationBuilderForm.InitialCreate());
        Assert.Empty(payload["triggers"]!.AsArray());
        Assert.Null(payload["vehicle_id"]);
        Assert.Single(payload["actions"]!.AsArray());
    }

    [Fact]
    public void Serialize_round_trips_through_parse()
    {
        var original = AutomationBuilderForm.InitialCreate() with
        {
            Name = "Commute",
            Trigger = new GeofenceTrigger(8, AutomationGeofenceEvent.Enter, DwellMinutes: 5),
        };
        var payload = AutomationGraphCodec.SerializePayload(original);

        // Wrap the payload as an automation object with an id so the snapshot is "found".
        var asAutomation = new JsonObject
        {
            ["id"] = 1,
            ["name"] = payload["name"]!.GetValue<string>(),
            ["triggers"] = JsonNode.Parse(payload["triggers"]!.ToJsonString()),
            ["conditions"] = JsonNode.Parse(payload["conditions"]!.ToJsonString()),
            ["actions"] = JsonNode.Parse(payload["actions"]!.ToJsonString()),
        };
        var snapshot = AutomationDetailSnapshot.FromJson(Json(asAutomation.ToJsonString()));
        var geofence = Assert.IsType<GeofenceTrigger>(snapshot.Form.Trigger);
        Assert.Equal(8L, geofence.PlaceId);
        Assert.Equal(5, geofence.DwellMinutes!.Value);
    }

    // ---- Generated-client feed request shaping (the seven web hooks) -----------------

    [Fact]
    public async Task ClientFeed_loads_automation_with_the_detail_operation_and_id()
    {
        var api = new FakeApiClient().ReturnsValue(Json("""{ "id": 7, "name": "X", "triggers": [], "actions": [] }"""));
        var feed = new AutomationBuilderClientFeed(api);

        var snapshot = await feed.LoadAutomationAsync(7, CancellationToken.None);

        Assert.True(snapshot.Found);
        var request = Assert.Single(api.Requests);
        Assert.Equal(AutomationBuilderRegistration.DetailOperation, request.OperationId);
        Assert.Equal("7", request.PathParams!["id"]);
    }

    [Fact]
    public async Task ClientFeed_loads_preset_vehicles_and_channels()
    {
        var api = new FakeApiClient()
            .ReturnsValue(Json("""{ "id": "p", "name": "Preset", "triggers": [], "actions": [] }"""))
            .ReturnsValue(Json("""[ { "id": 1 } ]"""))
            .ReturnsValue(Json("""[ { "id": 2, "name": "Email", "type": "email" } ]"""));
        var feed = new AutomationBuilderClientFeed(api);

        await feed.LoadPresetAsync("p", CancellationToken.None);
        await feed.LoadVehiclesAsync(CancellationToken.None);
        await feed.LoadChannelsAsync(CancellationToken.None);

        Assert.Equal(AutomationBuilderRegistration.PresetOperation, api.Requests[0].OperationId);
        Assert.Equal("p", api.Requests[0].PathParams!["presetId"]);
        Assert.Equal(AutomationBuilderRegistration.VehiclesOperation, api.Requests[1].OperationId);
        Assert.Equal(AutomationBuilderRegistration.ChannelsOperation, api.Requests[2].OperationId);
    }

    [Fact]
    public async Task ClientFeed_creates_with_the_create_operation_and_body()
    {
        var api = new FakeApiClient().ReturnsValue(Json("""{ "id": 42 }"""));
        var feed = new AutomationBuilderClientFeed(api);
        var form = AutomationBuilderForm.InitialCreate() with { Name = "New" };

        long id = await feed.CreateAsync(form, CancellationToken.None);

        Assert.Equal(42L, id);
        var request = Assert.Single(api.Requests);
        Assert.Equal(AutomationBuilderRegistration.CreateOperation, request.OperationId);
        var body = Assert.IsType<JsonObject>(request.Body);
        Assert.Equal("New", body["name"]!.GetValue<string>());
    }

    [Fact]
    public async Task ClientFeed_updates_with_the_update_operation_id_and_body()
    {
        var api = new FakeApiClient().ReturnsValue(Json("""{ "id": 9 }"""));
        var feed = new AutomationBuilderClientFeed(api);

        long id = await feed.UpdateAsync(9, AutomationBuilderForm.InitialCreate() with { Name = "Edit" }, CancellationToken.None);

        Assert.Equal(9L, id);
        var request = Assert.Single(api.Requests);
        Assert.Equal(AutomationBuilderRegistration.UpdateOperation, request.OperationId);
        Assert.Equal("9", request.PathParams!["id"]);
        Assert.IsType<JsonObject>(request.Body);
    }

    [Fact]
    public async Task ClientFeed_test_runs_with_the_test_run_operation_and_id()
    {
        var api = new FakeApiClient().ReturnsValue(Json("""{ "ok": true }"""));
        var feed = new AutomationBuilderClientFeed(api);

        await feed.TestRunAsync(15, CancellationToken.None);

        var request = Assert.Single(api.Requests);
        Assert.Equal(AutomationBuilderRegistration.TestRunOperation, request.OperationId);
        Assert.Equal("15", request.PathParams!["id"]);
    }

    // ---- Empty feed defaults --------------------------------------------------------

    [Fact]
    public async Task Empty_feed_resolves_not_found_and_empty_lists()
    {
        var feed = EmptyAutomationBuilderFeed.Instance;
        Assert.False((await feed.LoadAutomationAsync(1, CancellationToken.None)).Found);
        Assert.False((await feed.LoadPresetAsync("p", CancellationToken.None)).Found);
        Assert.Empty(await feed.LoadVehiclesAsync(CancellationToken.None));
        Assert.Empty(await feed.LoadChannelsAsync(CancellationToken.None));
        Assert.Equal(0L, await feed.CreateAsync(AutomationBuilderForm.InitialCreate(), CancellationToken.None));
    }

    // ---- View-model state matrix ----------------------------------------------------

    [Fact]
    public void ViewModel_create_mode_starts_in_success()
    {
        using var vm = new AutomationBuilderPageViewModel(new FakeAutomationFeed(), Localizer);
        Assert.Equal(AutomationBuilderState.Success, vm.State);
        Assert.Equal(AutomationBuilderMode.Create, vm.Mode);
    }

    [Fact]
    public async Task ViewModel_edit_load_hydrates_the_form()
    {
        var feed = new FakeAutomationFeed
        {
            Automation = new AutomationDetailSnapshot(true, "Commute", AutomationBuilderForm.InitialCreate() with { Name = "Commute" }),
        };
        using var vm = new AutomationBuilderPageViewModel(feed, Localizer, automationId: 5);

        await vm.LoadAsync();

        Assert.Equal(AutomationBuilderState.Success, vm.State);
        Assert.Equal("Commute", vm.Form.Name);
        Assert.Equal(5L, feed.LoadedId!.Value);
    }

    [Fact]
    public async Task ViewModel_edit_not_found_is_the_empty_state()
    {
        var feed = new FakeAutomationFeed { Automation = AutomationDetailSnapshot.NotFound };
        using var vm = new AutomationBuilderPageViewModel(feed, Localizer, automationId: 5);

        await vm.LoadAsync();

        Assert.Equal(AutomationBuilderState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_edit_load_failure_is_the_error_state()
    {
        var feed = new FakeAutomationFeed { LoadError = new ApiException("nope", 500) };
        using var vm = new AutomationBuilderPageViewModel(feed, Localizer, automationId: 5);

        await vm.LoadAsync();

        Assert.Equal(AutomationBuilderState.Error, vm.State);
        Assert.Equal("nope", vm.Display.LoadErrorDetail);
    }

    [Fact]
    public async Task ViewModel_save_blocks_on_validation_error()
    {
        var feed = new FakeAutomationFeed();
        using var vm = new AutomationBuilderPageViewModel(feed, Localizer);

        bool saved = await vm.SaveAsync();

        Assert.False(saved);
        Assert.True(vm.Display.ShowSaveError);
        Assert.Equal("Name is required", vm.Display.SaveErrorDetail);
        Assert.False(feed.CreateCalled);
    }

    [Fact]
    public async Task ViewModel_save_creates_a_valid_automation()
    {
        var feed = new FakeAutomationFeed { CreateId = 99 };
        using var vm = new AutomationBuilderPageViewModel(feed, Localizer);
        bool raised = false;
        vm.SaveSucceeded += (_, _) => raised = true;

        vm.SetName("Commute");
        vm.SetTriggerKind("trigger_signal");
        bool saved = await vm.SaveAsync();

        Assert.True(saved);
        Assert.True(feed.CreateCalled);
        Assert.True(raised);
        Assert.True(vm.Display.ShowTestRun);
    }

    [Fact]
    public async Task ViewModel_save_updates_in_edit_mode()
    {
        var feed = new FakeAutomationFeed
        {
            Automation = new AutomationDetailSnapshot(true, "Commute", AutomationBuilderForm.InitialCreate() with
            {
                Name = "Commute",
                Trigger = AutomationTrigger.CreateDefault(AutomationTriggerKind.Signal),
            }),
        };
        using var vm = new AutomationBuilderPageViewModel(feed, Localizer, automationId: 5);
        await vm.LoadAsync();

        bool saved = await vm.SaveAsync();

        Assert.True(saved);
        Assert.Equal(5L, feed.UpdatedId!.Value);
    }

    [Fact]
    public async Task ViewModel_test_run_marks_started()
    {
        var feed = new FakeAutomationFeed();
        using var vm = new AutomationBuilderPageViewModel(feed, Localizer, automationId: 8);

        await vm.TestRunAsync();

        Assert.Equal(8L, feed.TestRunId!.Value);
        Assert.True(vm.Display.ShowTestRunStarted);
    }

    [Fact]
    public void ViewModel_set_trigger_kind_toggles_the_panel()
    {
        using var vm = new AutomationBuilderPageViewModel(new FakeAutomationFeed(), Localizer);
        Assert.False(vm.Display.HasTrigger);

        vm.SetTriggerKind("trigger_geofence");
        Assert.True(vm.Display.HasTrigger);
        Assert.Equal("trigger_geofence", vm.Display.SelectedTriggerWire);

        vm.SetTriggerKind(string.Empty);
        Assert.False(vm.Display.HasTrigger);
    }

    private sealed class FakeAutomationFeed : IAutomationBuilderFeed
    {
        public AutomationDetailSnapshot Automation { get; set; } = AutomationDetailSnapshot.NotFound;

        public AutomationPresetSnapshot Preset { get; set; } = AutomationPresetSnapshot.None;

        public IReadOnlyList<VehicleOptionRow> Vehicles { get; set; } = System.Array.Empty<VehicleOptionRow>();

        public IReadOnlyList<AutomationChannel> Channels { get; set; } = System.Array.Empty<AutomationChannel>();

        public ApiException? LoadError { get; set; }

        public long CreateId { get; set; } = 1;

        public long? LoadedId { get; private set; }

        public bool CreateCalled { get; private set; }

        public long? UpdatedId { get; private set; }

        public long? TestRunId { get; private set; }

        public Task<AutomationDetailSnapshot> LoadAutomationAsync(long id, CancellationToken cancellationToken)
        {
            LoadedId = id;
            if (LoadError is not null)
            {
                throw LoadError;
            }

            return Task.FromResult(Automation);
        }

        public Task<AutomationPresetSnapshot> LoadPresetAsync(string presetId, CancellationToken cancellationToken) =>
            Task.FromResult(Preset);

        public Task<IReadOnlyList<VehicleOptionRow>> LoadVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(Vehicles);

        public Task<IReadOnlyList<AutomationChannel>> LoadChannelsAsync(CancellationToken cancellationToken) =>
            Task.FromResult(Channels);

        public Task<long> CreateAsync(AutomationBuilderForm form, CancellationToken cancellationToken)
        {
            CreateCalled = true;
            return Task.FromResult(CreateId);
        }

        public Task<long> UpdateAsync(long id, AutomationBuilderForm form, CancellationToken cancellationToken)
        {
            UpdatedId = id;
            return Task.FromResult(id);
        }

        public Task TestRunAsync(long id, CancellationToken cancellationToken)
        {
            TestRunId = id;
            return Task.CompletedTask;
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
