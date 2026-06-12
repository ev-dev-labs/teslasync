using System;
using System.Collections.Generic;
using System.Linq;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the ActionBuilder feature-view's UI-thread-free logic — the action model factory and
/// value helpers, the command-parameters JSON validation (cleared / object / non-object / unparseable), the
/// per-kind projection (command / notify / set-setting / call-automation) with its localized labels, options and
/// states, the empty / no-channels / value-type branches, the i18n routing, the accessibility names, the
/// state-holder view-model transitions (add / remove / reorder / kind-change / field edits and the
/// <c>ActionsChanged</c> contract) and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/automations/pages/ActionBuilder.tsx). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class ActionBuilderTests
{
    private static readonly ILocalizer L = PassthroughLocalizer.Instance;

    private static readonly AutomationChannel[] Channels =
    {
        new(1, "Disabled Discord", "discord", false),
        new(2, "Slack Ops", "slack", true),
        new(3, "Email Team", "email", true),
    };

    private static ActionBuilderDisplay Project(
        IReadOnlyList<AutomationActionStepInput> actions,
        IReadOnlyList<AutomationChannel>? channels = null,
        IReadOnlyList<ActionRowEditState>? edits = null,
        ILocalizer? localizer = null)
    {
        edits ??= actions.Select(_ => ActionRowEditState.Empty).ToList();
        return ActionBuilderProjection.Project(actions, edits, channels ?? Array.Empty<AutomationChannel>(), localizer ?? L);
    }

    // ---- Wire mappings -------------------------------------------------------------

    [Theory]
    [InlineData(AutomationActionKind.Command, "action_command")]
    [InlineData(AutomationActionKind.Notify, "action_notify")]
    [InlineData(AutomationActionKind.SetSetting, "action_set_setting")]
    [InlineData(AutomationActionKind.CallAutomation, "action_call_automation")]
    public void ActionKind_round_trips_through_wire(AutomationActionKind kind, string wire)
    {
        Assert.Equal(wire, AutomationActionKinds.ToWire(kind));
        Assert.True(AutomationActionKinds.TryFromWire(wire, out AutomationActionKind parsed));
        Assert.Equal(kind, parsed);
    }

    [Fact]
    public void ActionKind_from_unknown_wire_is_false()
    {
        Assert.False(AutomationActionKinds.TryFromWire("action_unknown", out _));
        Assert.False(AutomationActionKinds.TryFromWire(null, out _));
    }

    [Theory]
    [InlineData(SettingValueKind.Text, "text")]
    [InlineData(SettingValueKind.Number, "number")]
    [InlineData(SettingValueKind.Boolean, "boolean")]
    public void SettingValueKind_round_trips_through_wire(SettingValueKind kind, string wire)
    {
        Assert.Equal(wire, SettingValueKinds.ToWire(kind));
        Assert.Equal(kind, SettingValueKinds.FromWire(wire));
    }

    [Fact]
    public void SettingValueKind_from_unknown_wire_is_text() =>
        Assert.Equal(SettingValueKind.Text, SettingValueKinds.FromWire("nope"));

    // ---- CreateDefault (web createDefaultAction) -----------------------------------

    [Fact]
    public void CreateDefault_command_defaults_to_climate_on()
    {
        AutomationActionStepInput action = AutomationActionStepInput.CreateDefault(AutomationActionKind.Command);
        Assert.Equal(AutomationActionKind.Command, action.Kind);
        Assert.Equal("climate_on", action.CommandName);
        Assert.Null(action.CommandParamsJson);
    }

    [Fact]
    public void CreateDefault_notify_uses_default_channel()
    {
        AutomationActionStepInput action = AutomationActionStepInput.CreateDefault(AutomationActionKind.Notify, 7);
        Assert.Equal(AutomationActionKind.Notify, action.Kind);
        Assert.Equal(7, action.ChannelId);
        Assert.Equal(string.Empty, action.Template);
    }

    [Fact]
    public void CreateDefault_set_setting_is_empty_text_value()
    {
        AutomationActionStepInput action = AutomationActionStepInput.CreateDefault(AutomationActionKind.SetSetting);
        Assert.Equal(string.Empty, action.SettingKey);
        Assert.Equal(SettingValueKind.Text, AutomationActionStepInput.SettingValueKindOf(action));
        Assert.Equal(string.Empty, action.ValueText);
    }

    [Fact]
    public void CreateDefault_call_automation_targets_zero() =>
        Assert.Equal(0, AutomationActionStepInput.CreateDefault(AutomationActionKind.CallAutomation).TargetAutomationId);

    // ---- settingValueKind / value string / WithSettingValue ------------------------

    [Fact]
    public void SettingValueKindOf_prefers_number_then_boolean_then_text()
    {
        Assert.Equal(SettingValueKind.Number, AutomationActionStepInput.SettingValueKindOf(
            new AutomationActionStepInput(AutomationActionKind.SetSetting) { ValueNum = 5 }));
        Assert.Equal(SettingValueKind.Boolean, AutomationActionStepInput.SettingValueKindOf(
            new AutomationActionStepInput(AutomationActionKind.SetSetting) { ValueBool = true }));
        Assert.Equal(SettingValueKind.Text, AutomationActionStepInput.SettingValueKindOf(
            new AutomationActionStepInput(AutomationActionKind.SetSetting) { ValueText = "x" }));
    }

    [Fact]
    public void SettingValueString_formats_each_shape()
    {
        Assert.Equal("80", AutomationActionStepInput.SettingValueString(
            new AutomationActionStepInput(AutomationActionKind.SetSetting) { ValueNum = 80 }));
        Assert.Equal("true", AutomationActionStepInput.SettingValueString(
            new AutomationActionStepInput(AutomationActionKind.SetSetting) { ValueBool = true }));
        Assert.Equal("false", AutomationActionStepInput.SettingValueString(
            new AutomationActionStepInput(AutomationActionKind.SetSetting) { ValueBool = false }));
        Assert.Equal("enabled", AutomationActionStepInput.SettingValueString(
            new AutomationActionStepInput(AutomationActionKind.SetSetting) { ValueText = "enabled" }));
    }

    [Fact]
    public void WithSettingValue_number_keeps_only_numeric_value()
    {
        var action = new AutomationActionStepInput(AutomationActionKind.SetSetting) { SettingKey = "charge_limit", ValueText = "old" };
        AutomationActionStepInput next = AutomationActionStepInput.WithSettingValue(action, SettingValueKind.Number, "80");

        Assert.Equal("charge_limit", next.SettingKey);
        Assert.Equal(80, next.ValueNum);
        Assert.Null(next.ValueText);
        Assert.Null(next.ValueBool);
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("false", false)]
    [InlineData("anything-else", false)]
    public void WithSettingValue_boolean_only_true_is_true(string value, bool expected)
    {
        var action = new AutomationActionStepInput(AutomationActionKind.SetSetting) { SettingKey = "k" };
        AutomationActionStepInput next = AutomationActionStepInput.WithSettingValue(action, SettingValueKind.Boolean, value);

        Assert.Equal(expected, next.ValueBool);
        Assert.Null(next.ValueNum);
        Assert.Null(next.ValueText);
    }

    [Fact]
    public void WithSettingValue_text_keeps_only_text_value()
    {
        var action = new AutomationActionStepInput(AutomationActionKind.SetSetting) { SettingKey = "k", ValueNum = 1 };
        AutomationActionStepInput next = AutomationActionStepInput.WithSettingValue(action, SettingValueKind.Text, "enabled");

        Assert.Equal("enabled", next.ValueText);
        Assert.Null(next.ValueNum);
        Assert.Null(next.ValueBool);
    }

    // ---- JS parse helpers ----------------------------------------------------------

    [Theory]
    [InlineData("80", 80)]
    [InlineData("80.5", 80.5)]
    [InlineData("-3", -3)]
    [InlineData("1e3", 1000)]
    [InlineData("80px", 80)]
    [InlineData("", 0)]
    [InlineData("abc", 0)]
    [InlineData(null, 0)]
    public void JsParseFloatOrZero_matches_parseFloat(string? value, double expected) =>
        Assert.Equal(expected, AutomationActionStepInput.JsParseFloatOrZero(value));

    [Theory]
    [InlineData("5", 5)]
    [InlineData("-7", -7)]
    [InlineData("42xyz", 42)]
    [InlineData("", 0)]
    [InlineData("abc", 0)]
    [InlineData(null, 0)]
    public void JsParseIntOrZero_matches_parseInt(string? value, long expected) =>
        Assert.Equal(expected, AutomationActionStepInput.JsParseIntOrZero(value));

    // ---- Command parameters validation (web onChange branch) -----------------------

    [Fact]
    public void ParseCommandParams_blank_clears()
    {
        CommandParamsParseResult result = ActionBuilderProjection.ParseCommandParams("   ", L);
        Assert.True(result.UpdateParams);
        Assert.Null(result.CommandParamsJson);
        Assert.Null(result.Error);
    }

    [Fact]
    public void ParseCommandParams_object_commits_compact_json()
    {
        CommandParamsParseResult result = ActionBuilderProjection.ParseCommandParams("{ \"temp\": 21 }", L);
        Assert.True(result.UpdateParams);
        Assert.Equal("{\"temp\":21}", result.CommandParamsJson);
        Assert.Null(result.Error);
    }

    [Fact]
    public void ParseCommandParams_non_object_is_object_error()
    {
        CommandParamsParseResult result = ActionBuilderProjection.ParseCommandParams("[1, 2, 3]", L);
        Assert.False(result.UpdateParams);
        Assert.Equal("Params must be a JSON object.", result.Error);
    }

    [Fact]
    public void ParseCommandParams_null_literal_is_object_error()
    {
        CommandParamsParseResult result = ActionBuilderProjection.ParseCommandParams("null", L);
        Assert.False(result.UpdateParams);
        Assert.Equal("Params must be a JSON object.", result.Error);
    }

    [Fact]
    public void ParseCommandParams_unparseable_is_invalid_json()
    {
        CommandParamsParseResult result = ActionBuilderProjection.ParseCommandParams("{bad", L);
        Assert.False(result.UpdateParams);
        Assert.Equal("Invalid JSON", result.Error);
    }

    [Fact]
    public void ParseCommandParams_routes_errors_through_localizer()
    {
        var loc = new PrefixLocalizer();
        Assert.Equal("L:automations.builder.invalidJson", ActionBuilderProjection.ParseCommandParams("{bad", loc).Error);
        Assert.Equal("L:automations.builder.commandParamsObjectError", ActionBuilderProjection.ParseCommandParams("[1]", loc).Error);
    }

    [Fact]
    public void ParseCommandParams_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => ActionBuilderProjection.ParseCommandParams("{}", null!));

    [Fact]
    public void FormatCommandParams_pretty_prints_or_empty()
    {
        Assert.Equal(string.Empty, ActionBuilderProjection.FormatCommandParams(null));
        Assert.Equal(string.Empty, ActionBuilderProjection.FormatCommandParams("   "));
        Assert.Equal(string.Empty, ActionBuilderProjection.FormatCommandParams("{bad"));
        Assert.Contains("\"temp\": 21", ActionBuilderProjection.FormatCommandParams("{\"temp\":21}"), StringComparison.Ordinal);
    }

    // ---- Projection: empty ---------------------------------------------------------

    [Fact]
    public void Project_empty_shows_friendly_empty_state()
    {
        ActionBuilderDisplay display = Project(Array.Empty<AutomationActionStepInput>());

        Assert.True(display.IsEmpty);
        Assert.Empty(display.Rows);
        Assert.False(string.IsNullOrWhiteSpace(display.EmptyMessage));
        Assert.Equal("Add Action", display.AddActionLabel);
        Assert.Equal("Action Builder", display.RegionName);
    }

    // ---- Projection: command -------------------------------------------------------

    [Fact]
    public void Project_command_row_exposes_command_selector_and_params()
    {
        var actions = new[] { AutomationActionStepInput.CreateDefault(AutomationActionKind.Command) };
        var edits = new[] { new ActionRowEditState("{\"a\":1}", null) };
        ActionBuilderDisplay display = Project(actions, edits: edits);

        Assert.False(display.IsEmpty);
        CommandFieldsDisplay command = Assert.IsType<CommandFieldsDisplay>(display.Rows[0].Fields);
        Assert.Equal("Command", command.CommandLabel);
        Assert.Equal("climate_on", command.CommandValue);
        Assert.Equal("{\"a\":1}", command.ParamsText);
        Assert.Equal("Params (JSON, optional)", command.ParamsLabel);
        Assert.Null(command.ParamsError);
    }

    [Fact]
    public void Project_command_options_lead_with_select_prompt_and_group_commands()
    {
        var actions = new[] { AutomationActionStepInput.CreateDefault(AutomationActionKind.Command) };
        CommandFieldsDisplay command = Assert.IsType<CommandFieldsDisplay>(Project(actions).Rows[0].Fields);

        Assert.Equal(30, command.CommandOptions.Count);
        Assert.Equal(string.Empty, command.CommandOptions[0].Value);
        Assert.Equal("Select command...", command.CommandOptions[0].Label);
        Assert.Contains(command.CommandOptions, option => option.Value == "climate_on" && option.Label == "Climate - Climate On");
        Assert.Contains(command.CommandOptions, option => option.Value == "lock" && option.Label == "Security & Access - Lock Doors");
    }

    [Fact]
    public void Project_command_row_surfaces_edit_state_error()
    {
        var actions = new[] { AutomationActionStepInput.CreateDefault(AutomationActionKind.Command) };
        var edits = new[] { new ActionRowEditState("{bad", "Invalid JSON") };
        CommandFieldsDisplay command = Assert.IsType<CommandFieldsDisplay>(Project(actions, edits: edits).Rows[0].Fields);

        Assert.Equal("{bad", command.ParamsText);
        Assert.Equal("Invalid JSON", command.ParamsError);
    }

    // ---- Projection: notify --------------------------------------------------------

    [Fact]
    public void Project_notify_with_channels_lists_them_and_disables_inactive()
    {
        var actions = new[] { AutomationActionStepInput.CreateDefault(AutomationActionKind.Notify, 2) };
        NotifyFieldsDisplay notify = Assert.IsType<NotifyFieldsDisplay>(Project(actions, Channels).Rows[0].Fields);

        Assert.Equal(3, notify.ChannelOptions.Count);
        Assert.Equal("Disabled Discord (discord)", notify.ChannelOptions[0].Label);
        Assert.True(notify.ChannelOptions[0].Disabled);
        Assert.False(notify.ChannelOptions[1].Disabled);
        Assert.Equal("2", notify.ChannelValue);
        Assert.Equal("Message", notify.MessageLabel);
    }

    [Fact]
    public void Project_notify_without_channels_falls_back_to_single_option()
    {
        var actions = new[] { AutomationActionStepInput.CreateDefault(AutomationActionKind.Notify) };
        NotifyFieldsDisplay notify = Assert.IsType<NotifyFieldsDisplay>(Project(actions).Rows[0].Fields);

        OptionItem only = Assert.Single(notify.ChannelOptions);
        Assert.Equal("0", only.Value);
        Assert.Equal("No channels configured", only.Label);
    }

    // ---- Projection: set-setting ---------------------------------------------------

    [Fact]
    public void Project_set_setting_text_uses_text_placeholder()
    {
        var actions = new[] { AutomationActionStepInput.CreateDefault(AutomationActionKind.SetSetting) };
        SetSettingFieldsDisplay setting = Assert.IsType<SetSettingFieldsDisplay>(Project(actions).Rows[0].Fields);

        Assert.False(setting.ValueIsBoolean);
        Assert.False(setting.ValueIsNumber);
        Assert.Equal("text", setting.ValueTypeValue);
        Assert.Equal("enabled", setting.ValueHint);
        Assert.Equal(3, setting.ValueTypeOptions.Count);
        Assert.Equal("Setting Key", setting.SettingKeyLabel);
        Assert.Equal("charge_limit", setting.SettingKeyHint);
    }

    [Fact]
    public void Project_set_setting_number_uses_number_placeholder_and_value()
    {
        var actions = new[] { new AutomationActionStepInput(AutomationActionKind.SetSetting) { SettingKey = "charge_limit", ValueNum = 80 } };
        SetSettingFieldsDisplay setting = Assert.IsType<SetSettingFieldsDisplay>(Project(actions).Rows[0].Fields);

        Assert.True(setting.ValueIsNumber);
        Assert.False(setting.ValueIsBoolean);
        Assert.Equal("number", setting.ValueTypeValue);
        Assert.Equal("80", setting.ValueHint);
        Assert.Equal("80", setting.ValueValue);
    }

    [Fact]
    public void Project_set_setting_boolean_exposes_true_false_options()
    {
        var actions = new[] { new AutomationActionStepInput(AutomationActionKind.SetSetting) { SettingKey = "k", ValueBool = true } };
        SetSettingFieldsDisplay setting = Assert.IsType<SetSettingFieldsDisplay>(Project(actions).Rows[0].Fields);

        Assert.True(setting.ValueIsBoolean);
        Assert.Equal("boolean", setting.ValueTypeValue);
        Assert.Equal("true", setting.ValueValue);
        Assert.Equal(2, setting.ValueBooleanOptions.Count);
        Assert.Equal("True", setting.ValueBooleanOptions[0].Label);
        Assert.Equal("False", setting.ValueBooleanOptions[1].Label);
    }

    // ---- Projection: call-automation -----------------------------------------------

    [Fact]
    public void Project_call_automation_empty_target_renders_blank()
    {
        var actions = new[] { AutomationActionStepInput.CreateDefault(AutomationActionKind.CallAutomation) };
        CallAutomationFieldsDisplay call = Assert.IsType<CallAutomationFieldsDisplay>(Project(actions).Rows[0].Fields);

        Assert.Equal("Target Automation ID", call.TargetLabel);
        Assert.Equal(string.Empty, call.TargetValue);
    }

    [Fact]
    public void Project_call_automation_shows_target_id()
    {
        var actions = new[] { new AutomationActionStepInput(AutomationActionKind.CallAutomation) { TargetAutomationId = 42 } };
        CallAutomationFieldsDisplay call = Assert.IsType<CallAutomationFieldsDisplay>(Project(actions).Rows[0].Fields);
        Assert.Equal("42", call.TargetValue);
    }

    // ---- Projection: row metadata + accessibility ----------------------------------

    [Fact]
    public void Project_rows_carry_number_move_and_label_metadata()
    {
        var actions = new[]
        {
            AutomationActionStepInput.CreateDefault(AutomationActionKind.Command),
            AutomationActionStepInput.CreateDefault(AutomationActionKind.Notify),
        };
        ActionBuilderDisplay display = Project(actions, Channels);

        Assert.Equal("1.", display.Rows[0].NumberLabel);
        Assert.Equal("2.", display.Rows[1].NumberLabel);

        Assert.True(display.Rows[0].ShowActionTypeLabel);
        Assert.False(display.Rows[1].ShowActionTypeLabel);

        Assert.False(display.Rows[0].CanMoveUp);
        Assert.True(display.Rows[0].CanMoveDown);
        Assert.True(display.Rows[1].CanMoveUp);
        Assert.False(display.Rows[1].CanMoveDown);

        foreach (ActionRowDisplay row in display.Rows)
        {
            Assert.Equal("Action Type", row.ActionTypeLabel);
            Assert.Equal("Move up", row.MoveUpLabel);
            Assert.Equal("Move down", row.MoveDownLabel);
            Assert.Equal("Remove action", row.RemoveLabel);
            Assert.Equal(4, row.ActionTypeOptions.Count);
        }
    }

    // ---- i18n routing --------------------------------------------------------------

    [Fact]
    public void Project_routes_owned_strings_through_localizer()
    {
        var actions = new[] { AutomationActionStepInput.CreateDefault(AutomationActionKind.Command) };
        ActionBuilderDisplay display = Project(actions, localizer: new PrefixLocalizer());

        Assert.Equal("L:automations.builder.addAction", display.AddActionLabel);
        Assert.Equal("L:automations.builder.region", display.RegionName);
        Assert.Equal("L:automations.builder.actionType", display.Rows[0].ActionTypeLabel);
        Assert.Equal("L:automations.builder.removeAction", display.Rows[0].RemoveLabel);
        CommandFieldsDisplay command = Assert.IsType<CommandFieldsDisplay>(display.Rows[0].Fields);
        Assert.Equal("L:automations.builder.command", command.CommandLabel);
        Assert.Equal("L:automations.builder.commandParams", command.ParamsLabel);
    }

    [Fact]
    public void Project_rejects_null_arguments()
    {
        var actions = Array.Empty<AutomationActionStepInput>();
        var edits = Array.Empty<ActionRowEditState>();
        var channels = Array.Empty<AutomationChannel>();

        Assert.Throws<ArgumentNullException>(() => ActionBuilderProjection.Project(null!, edits, channels, L));
        Assert.Throws<ArgumentNullException>(() => ActionBuilderProjection.Project(actions, null!, channels, L));
        Assert.Throws<ArgumentNullException>(() => ActionBuilderProjection.Project(actions, edits, null!, L));
        Assert.Throws<ArgumentNullException>(() => ActionBuilderProjection.Project(actions, edits, channels, null!));
    }

    // ---- View-model: seeding -------------------------------------------------------

    [Fact]
    public void ViewModel_seeds_empty()
    {
        var vm = new ActionBuilderViewModel(L);

        Assert.True(vm.IsEmpty);
        Assert.Equal(ActionBuilderState.Empty, vm.State);
        Assert.Empty(vm.Actions);
        Assert.True(vm.Display.IsEmpty);
    }

    [Fact]
    public void ViewModel_seeds_from_initial_actions_and_default_channel()
    {
        var initial = new[] { AutomationActionStepInput.CreateDefault(AutomationActionKind.Command) };
        var vm = new ActionBuilderViewModel(L, Channels, initial);

        Assert.Single(vm.Actions);
        Assert.Equal(ActionBuilderState.Populated, vm.State);
        Assert.Equal(2, vm.DefaultChannelId); // first enabled channel
    }

    [Fact]
    public void ViewModel_seeds_command_params_editor_buffer_from_action()
    {
        var initial = new[] { new AutomationActionStepInput(AutomationActionKind.Command) { CommandName = "set_temps", CommandParamsJson = "{\"temp\":21}" } };
        var vm = new ActionBuilderViewModel(L, null, initial);

        CommandFieldsDisplay command = Assert.IsType<CommandFieldsDisplay>(vm.Display.Rows[0].Fields);
        Assert.Contains("\"temp\": 21", command.ParamsText, StringComparison.Ordinal);
    }

    [Fact]
    public void ViewModel_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => new ActionBuilderViewModel(null!));

    // ---- View-model: structural mutations ------------------------------------------

    [Fact]
    public void ViewModel_add_appends_default_command_and_raises()
    {
        var vm = new ActionBuilderViewModel(L);
        int changed = 0;
        vm.ActionsChanged += (_, _) => changed++;

        vm.AddAction();

        Assert.Single(vm.Actions);
        Assert.Equal(AutomationActionKind.Command, vm.Actions[0].Kind);
        Assert.Equal(ActionBuilderState.Populated, vm.State);
        Assert.Equal(1, changed);
    }

    [Fact]
    public void ViewModel_remove_drops_the_row()
    {
        var vm = new ActionBuilderViewModel(L);
        vm.AddAction();
        vm.AddAction();

        vm.RemoveAction(0);

        Assert.Single(vm.Actions);
    }

    [Fact]
    public void ViewModel_remove_out_of_range_is_noop()
    {
        var vm = new ActionBuilderViewModel(L);
        int changed = 0;
        vm.ActionsChanged += (_, _) => changed++;

        vm.RemoveAction(5);

        Assert.True(vm.IsEmpty);
        Assert.Equal(0, changed);
    }

    [Fact]
    public void ViewModel_move_swaps_rows_and_clamps_to_bounds()
    {
        var vm = new ActionBuilderViewModel(L, Channels);
        vm.AddAction();
        vm.ChangeKind(0, AutomationActionKind.Notify);
        vm.AddAction(); // row 1 is a command

        vm.MoveAction(0, 1);

        Assert.Equal(AutomationActionKind.Command, vm.Actions[0].Kind);
        Assert.Equal(AutomationActionKind.Notify, vm.Actions[1].Kind);

        // Moving the top row up, or the bottom row down, is a no-op.
        vm.MoveAction(0, -1);
        Assert.Equal(AutomationActionKind.Command, vm.Actions[0].Kind);
    }

    [Fact]
    public void ViewModel_change_kind_seeds_default_channel()
    {
        var vm = new ActionBuilderViewModel(L, Channels);
        vm.AddAction();

        vm.ChangeKind(0, AutomationActionKind.Notify);

        Assert.Equal(AutomationActionKind.Notify, vm.Actions[0].Kind);
        Assert.Equal(2, vm.Actions[0].ChannelId);
    }

    // ---- View-model: field edits ---------------------------------------------------

    [Fact]
    public void ViewModel_set_command_name_updates_action()
    {
        var vm = new ActionBuilderViewModel(L);
        vm.AddAction();

        vm.SetCommandName(0, "lock");

        Assert.Equal("lock", vm.Actions[0].CommandName);
    }

    [Fact]
    public void ViewModel_set_command_params_valid_commits_and_raises()
    {
        var vm = new ActionBuilderViewModel(L);
        vm.AddAction();
        int changed = 0;
        vm.ActionsChanged += (_, _) => changed++;

        vm.SetCommandParamsText(0, "{ \"temp\": 21 }");

        Assert.Equal("{\"temp\":21}", vm.Actions[0].CommandParamsJson);
        CommandFieldsDisplay command = Assert.IsType<CommandFieldsDisplay>(vm.Display.Rows[0].Fields);
        Assert.Null(command.ParamsError);
        Assert.Equal(1, changed);
    }

    [Fact]
    public void ViewModel_set_command_params_invalid_keeps_action_and_shows_error_without_raising()
    {
        var vm = new ActionBuilderViewModel(L);
        vm.AddAction();
        int changed = 0;
        vm.ActionsChanged += (_, _) => changed++;

        vm.SetCommandParamsText(0, "{bad");

        Assert.Null(vm.Actions[0].CommandParamsJson);
        CommandFieldsDisplay command = Assert.IsType<CommandFieldsDisplay>(vm.Display.Rows[0].Fields);
        Assert.Equal("{bad", command.ParamsText);
        Assert.Equal("Invalid JSON", command.ParamsError);
        Assert.Equal(0, changed);
    }

    [Fact]
    public void ViewModel_set_command_params_blank_clears()
    {
        var vm = new ActionBuilderViewModel(L);
        vm.AddAction();
        vm.SetCommandParamsText(0, "{\"a\":1}");

        vm.SetCommandParamsText(0, "   ");

        Assert.Null(vm.Actions[0].CommandParamsJson);
        CommandFieldsDisplay command = Assert.IsType<CommandFieldsDisplay>(vm.Display.Rows[0].Fields);
        Assert.Null(command.ParamsError);
    }

    [Fact]
    public void ViewModel_set_channel_template_message()
    {
        var vm = new ActionBuilderViewModel(L, Channels);
        vm.AddAction();
        vm.ChangeKind(0, AutomationActionKind.Notify);

        vm.SetChannelId(0, "3");
        vm.SetTemplate(0, "Car is warming up!");

        Assert.Equal(3, vm.Actions[0].ChannelId);
        Assert.Equal("Car is warming up!", vm.Actions[0].Template);
    }

    [Fact]
    public void ViewModel_set_setting_key_value_type_and_value()
    {
        var vm = new ActionBuilderViewModel(L);
        vm.AddAction();
        vm.ChangeKind(0, AutomationActionKind.SetSetting);

        vm.SetSettingKey(0, "charge_limit");
        vm.SetValueKind(0, SettingValueKind.Number);
        vm.SetValue(0, "80");

        Assert.Equal("charge_limit", vm.Actions[0].SettingKey);
        Assert.Equal(80, vm.Actions[0].ValueNum);
        Assert.Null(vm.Actions[0].ValueText);
    }

    [Fact]
    public void ViewModel_set_value_kind_boolean_then_value()
    {
        var vm = new ActionBuilderViewModel(L);
        vm.AddAction();
        vm.ChangeKind(0, AutomationActionKind.SetSetting);

        vm.SetValueKind(0, SettingValueKind.Boolean);
        vm.SetValue(0, "true");

        Assert.True(vm.Actions[0].ValueBool);
        SetSettingFieldsDisplay setting = Assert.IsType<SetSettingFieldsDisplay>(vm.Display.Rows[0].Fields);
        Assert.True(setting.ValueIsBoolean);
        Assert.Equal("true", setting.ValueValue);
    }

    [Fact]
    public void ViewModel_set_target_automation_id_parses_int()
    {
        var vm = new ActionBuilderViewModel(L);
        vm.AddAction();
        vm.ChangeKind(0, AutomationActionKind.CallAutomation);

        vm.SetTargetAutomationId(0, "42");

        Assert.Equal(42, vm.Actions[0].TargetAutomationId);
    }

    [Fact]
    public void ViewModel_field_setters_ignore_wrong_kind()
    {
        var vm = new ActionBuilderViewModel(L);
        vm.AddAction(); // command

        vm.SetTemplate(0, "ignored");
        vm.SetSettingKey(0, "ignored");
        vm.SetTargetAutomationId(0, "5");

        Assert.Equal(AutomationActionKind.Command, vm.Actions[0].Kind);
        Assert.Equal(string.Empty, vm.Actions[0].Template);
        Assert.Equal(0, vm.Actions[0].TargetAutomationId);
    }

    [Fact]
    public void ViewModel_raises_display_property_changed_on_mutation()
    {
        var vm = new ActionBuilderViewModel(L);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.AddAction();

        Assert.Contains(nameof(ActionBuilderViewModel.Display), raised);
        Assert.Contains(nameof(ActionBuilderViewModel.State), raised);
        Assert.Contains(nameof(ActionBuilderViewModel.Actions), raised);
    }

    [Fact]
    public void ViewModel_reload_reprojects()
    {
        var vm = new ActionBuilderViewModel(L);
        vm.AddAction();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Reload();

        Assert.Contains(nameof(ActionBuilderViewModel.Display), raised);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ActionBuilderDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ActionBuilder", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new ActionBuilderDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("ActionBuilder", ActionBuilderRegistration.Slug);

    // ---- Parity: every manifest string key is resolved (web key names, verbatim) ---

    // The 27 i18n keys the W7 parity manifest requires the surface to resolve, with the web key names
    // (web/src/features/automations/pages/ActionBuilder.tsx). Pins the placeholder keys to the web
    // *Placeholder names — guarding against any regression back to non-web *Hint keys.
    private static readonly string[] ManifestStringKeys =
    {
        "automations.builder.actionType",
        "automations.builder.addAction",
        "automations.builder.channel",
        "automations.builder.command",
        "automations.builder.commandParams",
        "automations.builder.commandParamsObjectError",
        "automations.builder.commandParamsPlaceholder",
        "automations.builder.invalidJson",
        "automations.builder.moveDown",
        "automations.builder.moveUp",
        "automations.builder.noChannels",
        "automations.builder.notifyMessage",
        "automations.builder.notifyPlaceholder",
        "automations.builder.removeAction",
        "automations.builder.selectCommand",
        "automations.builder.settingKey",
        "automations.builder.settingKeyPlaceholder",
        "automations.builder.targetAutomationId",
        "automations.builder.value",
        "automations.builder.valueBoolean",
        "automations.builder.valueNumber",
        "automations.builder.valueNumberPlaceholder",
        "automations.builder.valueText",
        "automations.builder.valueTextPlaceholder",
        "automations.builder.valueType",
        "common.true",
        "common.false",
    };

    [Fact]
    public void Surface_resolves_every_manifest_string_key()
    {
        var recorder = new RecordingLocalizer();

        // One row of each kind (with both numeric and text set-setting values) and no channels, so every
        // owned label, option and placeholder key flows through the localizer at least once.
        var actions = new[]
        {
            AutomationActionStepInput.CreateDefault(AutomationActionKind.Command),
            AutomationActionStepInput.CreateDefault(AutomationActionKind.Notify),
            new AutomationActionStepInput(AutomationActionKind.SetSetting) { ValueText = "enabled" },
            new AutomationActionStepInput(AutomationActionKind.SetSetting) { ValueNum = 80 },
            new AutomationActionStepInput(AutomationActionKind.SetSetting) { ValueBool = true },
            AutomationActionStepInput.CreateDefault(AutomationActionKind.CallAutomation),
        };
        var edits = actions.Select(_ => ActionRowEditState.Empty).ToArray();

        ActionBuilderProjection.Project(actions, edits, Array.Empty<AutomationChannel>(), recorder);

        // The two command-params validation messages are resolved by the parser (the error data state).
        ActionBuilderProjection.ParseCommandParams("[1]", recorder);
        ActionBuilderProjection.ParseCommandParams("{bad", recorder);

        foreach (string key in ManifestStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Helpers -------------------------------------------------------------------

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
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
