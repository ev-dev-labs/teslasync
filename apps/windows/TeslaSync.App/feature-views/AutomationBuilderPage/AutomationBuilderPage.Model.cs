using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>AutomationBuilderPage</c> surface — the native mirror of the
/// data states the web page renders (web/src/features/automations/pages/AutomationBuilderPage.tsx). In edit mode the
/// page runs the <c>useAutomation</c> query and renders, in precedence order, the loading shimmer
/// (web <c>isEdit &amp;&amp; isLoadingAutomation</c>), the load-failure surface (web <c>isEdit &amp;&amp; loadError</c>),
/// the "Automation not found" empty state (web <c>isEdit &amp;&amp; !existingAutomation</c>) or the builder form
/// (web success / create / preset). This enum is the top-level summary the ledger/Narrator key off; per-region
/// visibility is still driven by the projected flags so each branch renders exactly as the web composes it.
/// </summary>
public enum AutomationBuilderState
{
    /// <summary>The edit-mode automation query is in flight (web <c>isLoadingAutomation</c>) — the shimmer shows.</summary>
    Loading,

    /// <summary>The edit-mode automation was not found (web <c>!existingAutomation</c>) — the not-found empty state shows.</summary>
    Empty,

    /// <summary>The edit-mode automation query failed (web <c>loadError</c>) — the failure surface + retry shows.</summary>
    Error,

    /// <summary>The builder form renders (web edit success, or create / preset mode).</summary>
    Success,
}

/// <summary>
/// How the builder was entered — the native mirror of the web route discrimination
/// (<c>isEdit = id != null</c>, <c>presetId = searchParams.get('preset')</c>). Drives the page title and whether the
/// preset-hint panel shows.
/// </summary>
public enum AutomationBuilderMode
{
    /// <summary>A brand-new automation (web no <c>id</c>, no <c>preset</c>) — title "Create Automation".</summary>
    Create,

    /// <summary>Installing a preset (web <c>?preset=…</c>) — title "Install Preset".</summary>
    Preset,

    /// <summary>Editing an existing automation (web <c>/automations/:id/edit</c>) — title "Edit Automation".</summary>
    Edit,
}

/// <summary>
/// The full editable automation graph the builder holds — the native, UI-free analogue of the web page's
/// <c>FormState</c> (web/src/features/automations/pages/AutomationBuilderPage.tsx). The web tracks a single trigger
/// (it edits <c>triggers[0]</c>), an ordered condition list and an ordered action list, plus the scalar name /
/// description / vehicle / enabled fields. Immutable so the view-model can raise change notifications by reference.
/// </summary>
/// <param name="Name">The automation name (web <c>name</c>).</param>
/// <param name="Description">The optional description (web <c>description</c>).</param>
/// <param name="VehicleId">The scoped vehicle id, or <see langword="null"/> for all vehicles (web <c>vehicle_id</c>).</param>
/// <param name="Enabled">Whether the automation is enabled (web <c>enabled</c>).</param>
/// <param name="Trigger">The single configured trigger, or <see langword="null"/> when none is chosen (web <c>triggers[0]</c>).</param>
/// <param name="Conditions">The ordered optional conditions (web <c>conditions</c>).</param>
/// <param name="Actions">The ordered actions executed in sequence (web <c>actions</c>).</param>
public sealed record AutomationBuilderForm(
    string Name,
    string Description,
    long? VehicleId,
    bool Enabled,
    AutomationTrigger? Trigger,
    IReadOnlyList<AutomationCondition> Conditions,
    IReadOnlyList<AutomationActionStepInput> Actions)
{
    /// <summary>The initial form for a brand-new automation — the native port of the web <c>getInitialForm</c>
    /// (empty name/description, all vehicles, enabled, no trigger, no conditions, a single <c>climate_on</c> command).</summary>
    public static AutomationBuilderForm InitialCreate() => new(
        Name: string.Empty,
        Description: string.Empty,
        VehicleId: null,
        Enabled: true,
        Trigger: null,
        Conditions: System.Array.Empty<AutomationCondition>(),
        Actions: new[] { AutomationActionStepInput.CreateDefault(AutomationActionKind.Command) });
}

/// <summary>
/// One vehicle option for the scope dropdown — the native mirror of the fields the web <c>useVehicles</c> rows expose
/// (<c>id</c> + optional <c>display_name</c>). Pure data; parsing is null-tolerant.
/// </summary>
/// <param name="Id">The vehicle id (web <c>vehicle.id</c>).</param>
/// <param name="DisplayName">The vehicle display name, or <see langword="null"/> (web <c>vehicle.display_name</c>).</param>
public sealed record VehicleOptionRow(long Id, string? DisplayName)
{
    /// <summary>Parse the vehicles array (the platform <c>{data:[…]}</c> envelope tolerated) into option rows.</summary>
    public static IReadOnlyList<VehicleOptionRow> ParseList(JsonElement root)
    {
        var array = AutomationJson.Unwrap(root);
        if (array.ValueKind != JsonValueKind.Array)
        {
            return System.Array.Empty<VehicleOptionRow>();
        }

        var rows = new List<VehicleOptionRow>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long id = AutomationJson.Long(item, "id") ?? 0;
            if (id <= 0)
            {
                continue;
            }

            rows.Add(new VehicleOptionRow(id, AutomationJson.Str(item, "display_name")));
        }

        return rows;
    }
}

/// <summary>
/// The parsed result of the edit-mode automation read (<c>GET /automations/{id}</c>, web <c>useAutomation</c>): whether
/// the automation was found and, when it was, its name + the hydrated <see cref="AutomationBuilderForm"/> (the native
/// port of the web <c>automationToForm</c>). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Found">True when the response carried a usable automation object.</param>
/// <param name="Name">The loaded automation name (for the breadcrumb), or empty.</param>
/// <param name="Form">The hydrated builder form (the initial create form when not found).</param>
public sealed record AutomationDetailSnapshot(bool Found, string Name, AutomationBuilderForm Form)
{
    /// <summary>The "not found" snapshot — the web edit-mode empty branch.</summary>
    public static AutomationDetailSnapshot NotFound { get; } = new(false, string.Empty, AutomationBuilderForm.InitialCreate());

    /// <summary>Parse the automation detail response (tolerating the platform <c>{data:…}</c> envelope).</summary>
    public static AutomationDetailSnapshot FromJson(JsonElement root)
    {
        var o = AutomationJson.Unwrap(root);
        if (o.ValueKind != JsonValueKind.Object || AutomationJson.Long(o, "id") is null)
        {
            return NotFound;
        }

        string name = AutomationJson.Str(o, "name") ?? string.Empty;
        var form = new AutomationBuilderForm(
            Name: name,
            Description: AutomationJson.Str(o, "description") ?? string.Empty,
            VehicleId: AutomationJson.Long(o, "vehicle_id"),
            Enabled: AutomationJson.Bool(o, "enabled") ?? true,
            Trigger: AutomationGraphCodec.ParseFirstTrigger(o),
            Conditions: AutomationGraphCodec.ParseConditions(o),
            Actions: AutomationGraphCodec.ParseActions(o));

        return new AutomationDetailSnapshot(true, name, form);
    }
}

/// <summary>
/// The parsed result of the preset read (<c>GET /automations/presets/{id}</c>, web <c>useAutomationPreset</c>): the
/// preset hydrated into a builder form (the native port of the web preset-install effect — name + description +
/// graph, scoped to all vehicles and enabled). Pure data.
/// </summary>
/// <param name="Found">True when the response carried a usable preset object.</param>
/// <param name="Form">The hydrated builder form.</param>
public sealed record AutomationPresetSnapshot(bool Found, AutomationBuilderForm Form)
{
    /// <summary>The "no preset" snapshot.</summary>
    public static AutomationPresetSnapshot None { get; } = new(false, AutomationBuilderForm.InitialCreate());

    /// <summary>Parse the preset response (tolerating the platform <c>{data:…}</c> envelope).</summary>
    public static AutomationPresetSnapshot FromJson(JsonElement root)
    {
        var o = AutomationJson.Unwrap(root);
        if (o.ValueKind != JsonValueKind.Object || AutomationJson.Str(o, "name") is null)
        {
            return None;
        }

        var form = new AutomationBuilderForm(
            Name: AutomationJson.Str(o, "name") ?? string.Empty,
            Description: AutomationJson.Str(o, "description") ?? string.Empty,
            VehicleId: null,
            Enabled: true,
            Trigger: AutomationGraphCodec.ParseFirstTrigger(o),
            Conditions: AutomationGraphCodec.ParseConditions(o),
            Actions: AutomationGraphCodec.ParseActions(o));

        return new AutomationPresetSnapshot(true, form);
    }
}

/// <summary>
/// Parser for the notification-channel list (<c>GET /notifications</c>, web <c>useNotificationChannels</c>) into the
/// shared <see cref="AutomationChannel"/> read-model the <see cref="ActionBuilder"/> notify-action selector binds.
/// Tolerates the platform <c>{data:[…]}</c> envelope and missing / null fields.
/// </summary>
public static class AutomationChannelList
{
    /// <summary>Parse the notification-channels array into channel rows.</summary>
    public static IReadOnlyList<AutomationChannel> ParseList(JsonElement root)
    {
        var array = AutomationJson.Unwrap(root);
        if (array.ValueKind != JsonValueKind.Array)
        {
            return System.Array.Empty<AutomationChannel>();
        }

        var rows = new List<AutomationChannel>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long id = AutomationJson.Long(item, "id") ?? 0;
            if (id <= 0)
            {
                continue;
            }

            rows.Add(new AutomationChannel(
                id,
                AutomationJson.Str(item, "name") ?? string.Empty,
                AutomationJson.Str(item, "type") ?? AutomationJson.Str(item, "kind") ?? string.Empty,
                AutomationJson.Bool(item, "enabled") ?? true));
        }

        return rows;
    }
}

/// <summary>
/// The typed-graph codec — parses an automation/preset JSON object into the strongly-typed trigger / condition /
/// action models the builder edits, and serialises a <see cref="AutomationBuilderForm"/> back to the exact snake-case
/// wire envelope <c>POST /automations</c> / <c>PUT /automations/{id}</c> accept (the native port of the web
/// <c>normalizeTriggerInput</c> / <c>normalizeConditionInput</c> / <c>normalizeActionInput</c> + <c>formToPayload</c>).
/// Pure — no WinUI types — so the round-trip is unit-tested headlessly. Reuses the kind/operator/state wire mappers
/// the sibling builders already own (<see cref="TriggerWire"/>, <see cref="ConditionCatalog"/>,
/// <see cref="AutomationActionKinds"/>).
/// </summary>
public static class AutomationGraphCodec
{
    /// <summary>Parse the first trigger of an automation/preset object (web <c>triggers[0]</c>), or <see langword="null"/>.</summary>
    public static AutomationTrigger? ParseFirstTrigger(JsonElement obj)
    {
        if (!AutomationJson.TryArray(obj, "triggers", out var triggers))
        {
            return null;
        }

        foreach (var t in triggers.EnumerateArray())
        {
            if (t.ValueKind == JsonValueKind.Object)
            {
                return ParseTrigger(t);
            }
        }

        return null;
    }

    /// <summary>Parse one trigger object into the typed union (web <c>normalizeTriggerInput</c>); unknown kinds yield <see langword="null"/>.</summary>
    public static AutomationTrigger? ParseTrigger(JsonElement t)
    {
        switch (AutomationJson.Str(t, "kind"))
        {
            case "trigger_schedule":
                return new ScheduleTrigger(
                    AutomationJson.Str(t, "cron_expr") ?? "0 8 * * *",
                    AutomationJson.Str(t, "timezone") ?? "UTC");
            case "trigger_event":
                _ = TriggerWire.TryParseEventType(AutomationJson.Str(t, "event_type"), out var ev);
                return new EventTrigger(ev);
            case "trigger_geofence":
                _ = TriggerWire.TryParseGeofenceEvent(AutomationJson.Str(t, "event"), out var gev);
                return new GeofenceTrigger(
                    AutomationJson.Long(t, "place_id") ?? 0,
                    gev,
                    AutomationJson.Int(t, "dwell_minutes"));
            case "trigger_signal":
                _ = TriggerWire.TryParseSignalOp(AutomationJson.Str(t, "op"), out var op);
                return new SignalTrigger(
                    AutomationJson.Str(t, "signal") ?? "battery_level",
                    op,
                    AutomationJson.Double(t, "value_num"),
                    AutomationJson.Str(t, "value_text"),
                    AutomationJson.Bool(t, "value_bool"));
            default:
                return null;
        }
    }

    /// <summary>Parse the conditions array of an automation/preset object (web <c>conditions.map(normalizeConditionInput)</c>).</summary>
    public static IReadOnlyList<AutomationCondition> ParseConditions(JsonElement obj)
    {
        if (!AutomationJson.TryArray(obj, "conditions", out var conditions))
        {
            return System.Array.Empty<AutomationCondition>();
        }

        var list = new List<AutomationCondition>(conditions.GetArrayLength());
        foreach (var c in conditions.EnumerateArray())
        {
            if (c.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var parsed = ParseCondition(c);
            if (parsed is not null)
            {
                list.Add(parsed);
            }
        }

        return list;
    }

    /// <summary>Parse one condition object into the typed union (web <c>normalizeConditionInput</c>).</summary>
    public static AutomationCondition? ParseCondition(JsonElement c)
    {
        switch (AutomationJson.Str(c, "kind"))
        {
            case "condition_time_window":
                return new AutomationCondition.TimeWindowCondition(
                    AutomationJson.Str(c, "start_time") ?? "00:00",
                    AutomationJson.Str(c, "end_time") ?? "23:59",
                    AutomationJson.Str(c, "timezone") ?? "UTC",
                    AutomationJson.IntList(c, "days_of_week"));
            case "condition_geofence":
                return new AutomationCondition.GeofenceCondition(
                    AutomationJson.Long(c, "place_id") ?? 0,
                    ConditionCatalog.GeofenceStateFromWire(AutomationJson.Str(c, "state")));
            case "condition_other_automation":
                return new AutomationCondition.OtherAutomationCondition(
                    AutomationJson.Long(c, "other_automation_id") ?? 0,
                    ConditionCatalog.OtherAutomationStateFromWire(AutomationJson.Str(c, "state")));
            case "condition_signal":
            default:
                return new AutomationCondition.SignalCondition(
                    AutomationJson.Str(c, "signal") ?? "battery_level",
                    ConditionCatalog.OperatorFromWire(AutomationJson.Str(c, "op")),
                    AutomationJson.Double(c, "value_num"),
                    AutomationJson.Str(c, "value_text"),
                    AutomationJson.Bool(c, "value_bool"),
                    AutomationJson.Double(c, "value_min"),
                    AutomationJson.Double(c, "value_max"));
        }
    }

    /// <summary>Parse the actions array of an automation/preset object (web <c>actions.map(normalizeActionInput)</c>).</summary>
    public static IReadOnlyList<AutomationActionStepInput> ParseActions(JsonElement obj)
    {
        if (!AutomationJson.TryArray(obj, "actions", out var actions))
        {
            return System.Array.Empty<AutomationActionStepInput>();
        }

        var list = new List<AutomationActionStepInput>(actions.GetArrayLength());
        foreach (var a in actions.EnumerateArray())
        {
            if (a.ValueKind == JsonValueKind.Object)
            {
                list.Add(ParseAction(a));
            }
        }

        return list;
    }

    /// <summary>Parse one action object into the typed model (web <c>normalizeActionInput</c>).</summary>
    public static AutomationActionStepInput ParseAction(JsonElement a)
    {
        _ = AutomationActionKinds.TryFromWire(AutomationJson.Str(a, "kind"), out var kind);
        return kind switch
        {
            AutomationActionKind.Notify => new AutomationActionStepInput(AutomationActionKind.Notify)
            {
                ChannelId = AutomationJson.Long(a, "channel_id") ?? 0,
                Template = AutomationJson.Str(a, "template") ?? string.Empty,
            },
            AutomationActionKind.SetSetting => new AutomationActionStepInput(AutomationActionKind.SetSetting)
            {
                SettingKey = AutomationJson.Str(a, "setting_key") ?? string.Empty,
                ValueText = AutomationJson.Str(a, "value_text"),
                ValueNum = AutomationJson.Double(a, "value_num"),
                ValueBool = AutomationJson.Bool(a, "value_bool"),
            },
            AutomationActionKind.CallAutomation => new AutomationActionStepInput(AutomationActionKind.CallAutomation)
            {
                TargetAutomationId = AutomationJson.Long(a, "target_automation_id") ?? 0,
            },
            _ => new AutomationActionStepInput(AutomationActionKind.Command)
            {
                CommandName = AutomationJson.Str(a, "command_name") ?? string.Empty,
                CommandParamsJson = AutomationJson.RawObject(a, "command_params"),
            },
        };
    }

    /// <summary>
    /// Serialise a form into the wire envelope <c>POST /automations</c> / <c>PUT /automations/{id}</c> accept — the
    /// native port of the web <c>formToPayload</c>: trimmed name/description, the vehicle id (or null), enabled, and
    /// the per-step normalised trigger / condition / action arrays in snake-case.
    /// </summary>
    public static JsonObject SerializePayload(AutomationBuilderForm form)
    {
        System.ArgumentNullException.ThrowIfNull(form);

        var triggers = new JsonArray();
        if (form.Trigger is not null)
        {
            triggers.Add(SerializeTrigger(form.Trigger));
        }

        var conditions = new JsonArray();
        foreach (var condition in form.Conditions)
        {
            conditions.Add(SerializeCondition(condition));
        }

        var actions = new JsonArray();
        foreach (var action in form.Actions)
        {
            actions.Add(SerializeAction(action));
        }

        return new JsonObject
        {
            ["name"] = form.Name.Trim(),
            ["description"] = form.Description.Trim(),
            ["vehicle_id"] = form.VehicleId.HasValue ? JsonValue.Create(form.VehicleId.Value) : null,
            ["enabled"] = form.Enabled,
            ["triggers"] = triggers,
            ["conditions"] = conditions,
            ["actions"] = actions,
        };
    }

    private static JsonObject SerializeTrigger(AutomationTrigger trigger) => trigger switch
    {
        ScheduleTrigger s => new JsonObject
        {
            ["kind"] = "trigger_schedule",
            ["cron_expr"] = s.CronExpr,
            ["timezone"] = s.Timezone,
        },
        EventTrigger e => new JsonObject
        {
            ["kind"] = "trigger_event",
            ["event_type"] = e.EventType.ToWire(),
        },
        GeofenceTrigger g => BuildGeofenceTrigger(g),
        SignalTrigger sig => BuildSignalTrigger(sig),
        _ => new JsonObject { ["kind"] = trigger.Kind.ToWire() },
    };

    private static JsonObject BuildGeofenceTrigger(GeofenceTrigger g)
    {
        var obj = new JsonObject
        {
            ["kind"] = "trigger_geofence",
            ["place_id"] = g.PlaceId,
            ["event"] = g.GeofenceEvent.ToWire(),
        };
        if (g.DwellMinutes is not null)
        {
            obj["dwell_minutes"] = g.DwellMinutes.Value;
        }

        return obj;
    }

    private static JsonObject BuildSignalTrigger(SignalTrigger sig)
    {
        var obj = new JsonObject
        {
            ["kind"] = "trigger_signal",
            ["signal"] = sig.Signal,
            ["op"] = sig.Op.ToWire(),
        };
        if (sig.ValueNum is not null)
        {
            obj["value_num"] = sig.ValueNum.Value;
        }

        if (sig.ValueText is not null)
        {
            obj["value_text"] = sig.ValueText;
        }

        if (sig.ValueBool is not null)
        {
            obj["value_bool"] = sig.ValueBool.Value;
        }

        return obj;
    }

    private static JsonObject SerializeCondition(AutomationCondition condition) => condition switch
    {
        AutomationCondition.TimeWindowCondition tw => new JsonObject
        {
            ["kind"] = "condition_time_window",
            ["start_time"] = tw.StartTime,
            ["end_time"] = tw.EndTime,
            ["timezone"] = tw.Timezone,
            ["days_of_week"] = ToJsonArray(tw.DaysOfWeek),
        },
        AutomationCondition.GeofenceCondition g => new JsonObject
        {
            ["kind"] = "condition_geofence",
            ["place_id"] = g.PlaceId,
            ["state"] = ConditionCatalog.GeofenceStateWire(g.State),
        },
        AutomationCondition.OtherAutomationCondition oa => new JsonObject
        {
            ["kind"] = "condition_other_automation",
            ["other_automation_id"] = oa.OtherAutomationId,
            ["state"] = ConditionCatalog.OtherAutomationStateWire(oa.State),
        },
        AutomationCondition.SignalCondition sc => BuildSignalCondition(sc),
        _ => new JsonObject { ["kind"] = "condition_signal" },
    };

    private static JsonObject BuildSignalCondition(AutomationCondition.SignalCondition sc)
    {
        var obj = new JsonObject
        {
            ["kind"] = "condition_signal",
            ["signal"] = sc.Signal,
            ["op"] = ConditionCatalog.OperatorWire(sc.Op),
        };
        if (sc.ValueNum is not null)
        {
            obj["value_num"] = sc.ValueNum.Value;
        }

        if (sc.ValueText is not null)
        {
            obj["value_text"] = sc.ValueText;
        }

        if (sc.ValueBool is not null)
        {
            obj["value_bool"] = sc.ValueBool.Value;
        }

        if (sc.ValueMin is not null)
        {
            obj["value_min"] = sc.ValueMin.Value;
        }

        if (sc.ValueMax is not null)
        {
            obj["value_max"] = sc.ValueMax.Value;
        }

        return obj;
    }

    private static JsonObject SerializeAction(AutomationActionStepInput action) => action.Kind switch
    {
        AutomationActionKind.Notify => new JsonObject
        {
            ["kind"] = "action_notify",
            ["channel_id"] = action.ChannelId,
            ["template"] = action.Template,
        },
        AutomationActionKind.SetSetting => BuildSetSettingAction(action),
        AutomationActionKind.CallAutomation => new JsonObject
        {
            ["kind"] = "action_call_automation",
            ["target_automation_id"] = action.TargetAutomationId,
        },
        _ => BuildCommandAction(action),
    };

    private static JsonObject BuildCommandAction(AutomationActionStepInput action)
    {
        var obj = new JsonObject
        {
            ["kind"] = "action_command",
            ["command_name"] = action.CommandName,
        };
        if (!string.IsNullOrEmpty(action.CommandParamsJson))
        {
            try
            {
                obj["command_params"] = JsonNode.Parse(action.CommandParamsJson);
            }
            catch (JsonException)
            {
                // Malformed buffered JSON is dropped rather than corrupting the payload (the editor guards this).
            }
        }

        return obj;
    }

    private static JsonObject BuildSetSettingAction(AutomationActionStepInput action)
    {
        var obj = new JsonObject
        {
            ["kind"] = "action_set_setting",
            ["setting_key"] = action.SettingKey,
        };
        if (action.ValueNum is not null)
        {
            obj["value_num"] = action.ValueNum.Value;
        }
        else if (action.ValueBool is not null)
        {
            obj["value_bool"] = action.ValueBool.Value;
        }
        else if (action.ValueText is not null)
        {
            obj["value_text"] = action.ValueText;
        }

        return obj;
    }

    private static JsonArray ToJsonArray(IReadOnlyList<int> values)
    {
        var array = new JsonArray();
        foreach (var value in values)
        {
            array.Add(value);
        }

        return array;
    }
}

/// <summary>
/// The validation outcome for a save attempt — the native port of the web <c>validate()</c> guard chain
/// (name → trigger → trigger-place → condition-place → actions → action-details). Carries the first failing message
/// (already localized) or <see langword="null"/> when the form is valid.
/// </summary>
public static class AutomationValidator
{
    /// <summary>Validate the form against the pre-resolved <paramref name="messages"/>; returns the first error or <see langword="null"/>.</summary>
    public static string? Validate(AutomationBuilderForm form, AutomationValidationCopy messages)
    {
        System.ArgumentNullException.ThrowIfNull(form);
        System.ArgumentNullException.ThrowIfNull(messages);

        if (string.IsNullOrWhiteSpace(form.Name))
        {
            return messages.ErrorName;
        }

        if (form.Trigger is null)
        {
            return messages.ErrorTrigger;
        }

        if (form.Trigger is GeofenceTrigger gt && gt.PlaceId <= 0)
        {
            return messages.ErrorTriggerPlace;
        }

        if (form.Conditions.OfType<AutomationCondition.GeofenceCondition>().Any(g => g.PlaceId <= 0))
        {
            return messages.ErrorConditionPlace;
        }

        if (form.Actions.Count == 0)
        {
            return messages.ErrorActions;
        }

        if (form.Actions.Any(IsActionIncomplete))
        {
            return messages.ErrorActionDetails;
        }

        return null;
    }

    /// <summary>True when an action is missing required fields — the native port of the web <c>actionIsIncomplete</c>.</summary>
    public static bool IsActionIncomplete(AutomationActionStepInput action)
    {
        System.ArgumentNullException.ThrowIfNull(action);
        return action.Kind switch
        {
            AutomationActionKind.Command => string.IsNullOrWhiteSpace(action.CommandName),
            AutomationActionKind.Notify => action.ChannelId <= 0 || string.IsNullOrWhiteSpace(action.Template),
            AutomationActionKind.SetSetting => string.IsNullOrWhiteSpace(action.SettingKey) || SetSettingValueCount(action) != 1,
            AutomationActionKind.CallAutomation => action.TargetAutomationId <= 0,
            _ => true,
        };
    }

    private static int SetSettingValueCount(AutomationActionStepInput action)
    {
        int count = 0;
        if (action.ValueText is not null)
        {
            count++;
        }

        if (action.ValueNum is not null)
        {
            count++;
        }

        if (action.ValueBool is not null)
        {
            count++;
        }

        return count;
    }
}

/// <summary>The six pre-resolved validation messages (web <c>validate()</c> branches), surfaced by the projection.</summary>
/// <param name="ErrorName">Web <c>automations.builder.errorName</c>.</param>
/// <param name="ErrorTrigger">Web <c>automations.builder.errorTrigger</c>.</param>
/// <param name="ErrorTriggerPlace">Web <c>automations.builder.errorTriggerPlace</c>.</param>
/// <param name="ErrorConditionPlace">Web <c>automations.builder.errorConditionPlace</c>.</param>
/// <param name="ErrorActions">Web <c>automations.builder.errorActions</c>.</param>
/// <param name="ErrorActionDetails">Web <c>automations.builder.errorActionDetails</c>.</param>
public sealed record AutomationValidationCopy(
    string ErrorName,
    string ErrorTrigger,
    string ErrorTriggerPlace,
    string ErrorConditionPlace,
    string ErrorActions,
    string ErrorActionDetails);

/// <summary>One trigger-type dropdown option (web <c>triggerOptions</c> entry): the wire kind + localized label.</summary>
/// <param name="Wire">The trigger kind wire literal (empty for the "Select trigger type…" prompt option).</param>
/// <param name="Label">The localized option label.</param>
public sealed record AutomationTriggerOption(string Wire, string Label);

/// <summary>One vehicle-scope dropdown option (web <c>vehicleOptions</c> entry): the id value + localized label.</summary>
/// <param name="Value">The vehicle id as a string ("" for "All Vehicles").</param>
/// <param name="Label">The localized option label.</param>
public sealed record AutomationVehicleOption(string Value, string Label);

/// <summary>
/// The UI-free inputs the <see cref="AutomationBuilderProjection"/> turns into render-ready copy + flags — the native
/// mirror of the web page's derived render state. Pure data so the projection is unit-tested headlessly.
/// </summary>
/// <param name="Mode">How the builder was entered (create / preset / edit).</param>
/// <param name="IsLoadingAutomation">Edit-mode automation query in flight (web <c>isLoadingAutomation</c>).</param>
/// <param name="HasLoadError">Edit-mode automation query failed (web <c>loadError</c>).</param>
/// <param name="LoadErrorDetail">The load failure detail to surface, or <see langword="null"/>.</param>
/// <param name="AutomationFound">Edit-mode automation resolved with a usable object (web <c>existingAutomation</c>).</param>
/// <param name="AutomationName">The loaded automation name for the breadcrumb (edit mode).</param>
/// <param name="Form">The current builder form.</param>
/// <param name="Vehicles">The vehicle options (web <c>useVehicles</c>).</param>
/// <param name="HasConflicts">Whether the conflict-warnings region renders (web <c>conflicts.length &gt; 0</c>).</param>
/// <param name="SaveErrorDetail">The save-failure detail, or <see langword="null"/> (web <c>saveError</c>).</param>
/// <param name="IsSaving">Whether a save is in flight (web <c>isSaving</c>).</param>
/// <param name="CanTestRun">Whether the test-run button shows (web <c>savedId ?? automationId</c>).</param>
/// <param name="TestRunStarted">Whether the test-run success note shows (web <c>testRunMutation.isSuccess</c>).</param>
public sealed record AutomationBuilderModel(
    AutomationBuilderMode Mode,
    bool IsLoadingAutomation,
    bool HasLoadError,
    string? LoadErrorDetail,
    bool AutomationFound,
    string AutomationName,
    AutomationBuilderForm Form,
    IReadOnlyList<VehicleOptionRow> Vehicles,
    bool HasConflicts,
    string? SaveErrorDetail,
    bool IsSaving,
    bool CanTestRun,
    bool TestRunStarted)
{
    /// <summary>The initial create-mode model.</summary>
    public static AutomationBuilderModel InitialCreate() => new(
        Mode: AutomationBuilderMode.Create,
        IsLoadingAutomation: false,
        HasLoadError: false,
        LoadErrorDetail: null,
        AutomationFound: false,
        AutomationName: string.Empty,
        Form: AutomationBuilderForm.InitialCreate(),
        Vehicles: System.Array.Empty<VehicleOptionRow>(),
        HasConflicts: false,
        SaveErrorDetail: null,
        IsSaving: false,
        CanTestRun: false,
        TestRunStarted: false);
}

/// <summary>
/// The render-ready projection of an <see cref="AutomationBuilderModel"/> — every visible literal pre-resolved
/// through the i18n facade and every region's visibility decided, so the WinUI view is a thin renderer. The native
/// mirror of the web page's JSX: the header (title / subtitle / breadcrumb), the four data-state flags, the General
/// section fields, the When section (trigger-type select + the trigger-configurator panel or the empty panel), the
/// Only-If and Then section headers, the conflict / save-error / preset-hint regions and the action row. Pure data.
/// </summary>
public sealed record AutomationBuilderDisplay
{
    /// <summary>The top-level lifecycle state (loading / empty / error / success).</summary>
    public AutomationBuilderState State { get; init; } = AutomationBuilderState.Success;

    /// <summary>True while the edit-mode automation query is in flight — the loading shimmer shows.</summary>
    public bool ShowLoading { get; init; }

    /// <summary>True when the edit-mode automation query failed — the failure surface + retry shows.</summary>
    public bool ShowError { get; init; }

    /// <summary>True when the edit-mode automation was not found — the not-found empty state shows.</summary>
    public bool ShowEmpty { get; init; }

    /// <summary>True when the builder form renders (edit success, or create / preset mode).</summary>
    public bool ShowForm { get; init; }

    /// <summary>The localized page title (edit / create / preset).</summary>
    public string Title { get; init; } = string.Empty;

    /// <summary>The localized page subtitle.</summary>
    public string Subtitle { get; init; } = string.Empty;

    /// <summary>The localized edit breadcrumb label (formatted with the loaded automation name).</summary>
    public string BreadcrumbLabel { get; init; } = string.Empty;

    /// <summary>The loaded automation name (Narrator context / breadcrumb).</summary>
    public string AutomationName { get; init; } = string.Empty;

    /// <summary>The "back to list" button label.</summary>
    public string BackLabel { get; init; } = string.Empty;

    /// <summary>The cancel button label.</summary>
    public string CancelLabel { get; init; } = string.Empty;

    /// <summary>The edit-mode save button label.</summary>
    public string SaveLabel { get; init; } = string.Empty;

    /// <summary>The create-mode create button label.</summary>
    public string CreateLabel { get; init; } = string.Empty;

    /// <summary>The active primary-action label (save in edit mode, create otherwise).</summary>
    public string PrimaryActionLabel { get; init; } = string.Empty;

    /// <summary>The not-found empty-state message.</summary>
    public string NotFoundMessage { get; init; } = string.Empty;

    /// <summary>The edit-mode load failure detail (exception message), or empty.</summary>
    public string LoadErrorDetail { get; init; } = string.Empty;

    /// <summary>The General section title.</summary>
    public string GeneralTitle { get; init; } = string.Empty;

    /// <summary>The name field label.</summary>
    public string NameLabel { get; init; } = string.Empty;

    /// <summary>The name field hint text.</summary>
    public string NameHint { get; init; } = string.Empty;

    /// <summary>The description field label.</summary>
    public string DescriptionLabel { get; init; } = string.Empty;

    /// <summary>The description field hint text.</summary>
    public string DescriptionHint { get; init; } = string.Empty;

    /// <summary>The vehicle field label.</summary>
    public string VehicleLabel { get; init; } = string.Empty;

    /// <summary>The enabled toggle label.</summary>
    public string EnabledLabel { get; init; } = string.Empty;

    /// <summary>The current name field value (hydrated from the loaded automation in edit mode).</summary>
    public string NameValue { get; init; } = string.Empty;

    /// <summary>The current description field value.</summary>
    public string DescriptionValue { get; init; } = string.Empty;

    /// <summary>The current enabled toggle value.</summary>
    public bool EnabledValue { get; init; } = true;

    /// <summary>The vehicle-scope dropdown options (first is "All Vehicles").</summary>
    public IReadOnlyList<AutomationVehicleOption> VehicleOptions { get; init; } = System.Array.Empty<AutomationVehicleOption>();

    /// <summary>The selected vehicle option value ("" for all vehicles).</summary>
    public string SelectedVehicleValue { get; init; } = string.Empty;

    /// <summary>The When section title.</summary>
    public string WhenTitle { get; init; } = string.Empty;

    /// <summary>The When section description.</summary>
    public string WhenDescription { get; init; } = string.Empty;

    /// <summary>The trigger-type field label.</summary>
    public string TriggerTypeLabel { get; init; } = string.Empty;

    /// <summary>The "select trigger type…" prompt option label.</summary>
    public string TriggerPrompt { get; init; } = string.Empty;

    /// <summary>The empty-trigger panel message (web GlassPanel empty state).</summary>
    public string EmptyTriggerMessage { get; init; } = string.Empty;

    /// <summary>The trigger-type dropdown options (first is the prompt option).</summary>
    public IReadOnlyList<AutomationTriggerOption> TriggerOptions { get; init; } = System.Array.Empty<AutomationTriggerOption>();

    /// <summary>The selected trigger kind wire literal ("" when no trigger is chosen).</summary>
    public string SelectedTriggerWire { get; init; } = string.Empty;

    /// <summary>True when a trigger is configured — the trigger-configurator panel (GlassPanel1) shows; otherwise the empty panel (GlassPanel2).</summary>
    public bool HasTrigger { get; init; }

    /// <summary>The Only-If (conditions) section title.</summary>
    public string OnlyIfTitle { get; init; } = string.Empty;

    /// <summary>The Only-If section description.</summary>
    public string OnlyIfDescription { get; init; } = string.Empty;

    /// <summary>The Then (actions) section title.</summary>
    public string ThenTitle { get; init; } = string.Empty;

    /// <summary>The Then section description.</summary>
    public string ThenDescription { get; init; } = string.Empty;

    /// <summary>True when the conflict-warnings region renders.</summary>
    public bool ShowConflicts { get; init; }

    /// <summary>The save-error banner title.</summary>
    public string SaveErrorTitle { get; init; } = string.Empty;

    /// <summary>The save-error detail message, or empty.</summary>
    public string SaveErrorDetail { get; init; } = string.Empty;

    /// <summary>True when the save-error banner shows.</summary>
    public bool ShowSaveError { get; init; }

    /// <summary>True while a save is in flight (the primary action shows its busy state).</summary>
    public bool IsSaving { get; init; }

    /// <summary>The test-run button label.</summary>
    public string TestRunLabel { get; init; } = string.Empty;

    /// <summary>True when the test-run button shows (a saved or existing automation id is available).</summary>
    public bool ShowTestRun { get; init; }

    /// <summary>The "test run started!" success note.</summary>
    public string TestRunStartedMessage { get; init; } = string.Empty;

    /// <summary>True when the test-run success note shows.</summary>
    public bool ShowTestRunStarted { get; init; }

    /// <summary>The preset-hint panel text (GlassPanel3).</summary>
    public string PresetHint { get; init; } = string.Empty;

    /// <summary>True when the preset-hint panel shows (create / preset mode — web <c>!isEdit</c>).</summary>
    public bool ShowPresetHint { get; init; }

    /// <summary>The already-localized edit-conflict resource noun (web <c>editConflict.resource.automation</c>).</summary>
    public string EditConflictResourceLabel { get; init; } = string.Empty;

    /// <summary>The draft-recovery item noun (web <c>draft.noun.automation</c>).</summary>
    public string DraftNoun { get; init; } = string.Empty;

    /// <summary>The unsaved-changes guard message (web <c>forms.unsavedAutomation</c>).</summary>
    public string UnsavedMessage { get; init; } = string.Empty;

    /// <summary>The six pre-resolved validation messages used by <see cref="AutomationValidator"/>.</summary>
    public AutomationValidationCopy Validation { get; init; } =
        new(string.Empty, string.Empty, string.Empty, string.Empty, string.Empty, string.Empty);
}

/// <summary>
/// Projects an <see cref="AutomationBuilderModel"/> into a render-ready <see cref="AutomationBuilderDisplay"/> — the
/// single place every <c>automations.builder.*</c> literal (plus the three cross-cutting draft / conflict / unsaved
/// strings) resolves through the i18n facade, and where the four data states + per-region visibility are decided.
/// Resolves every string unconditionally so the catalog coverage is deterministic regardless of the active state.
/// </summary>
public static class AutomationBuilderProjection
{
    /// <summary>Project the model into render-ready copy + flags using <paramref name="localizer"/>.</summary>
    public static AutomationBuilderDisplay Project(AutomationBuilderModel model, ILocalizer localizer)
    {
        System.ArgumentNullException.ThrowIfNull(model);
        System.ArgumentNullException.ThrowIfNull(localizer);

        string editTitle = localizer.GetString("automations.builder.editTitle", "Edit Automation");
        string createTitle = localizer.GetString("automations.builder.createTitle", "Create Automation");
        string presetTitle = localizer.GetString("automations.builder.presetTitle", "Install Preset");
        string vehicleFallbackTemplate = localizer.GetString("automations.builder.vehicleFallback", "Vehicle {0}");
        string allVehicles = localizer.GetString("automations.builder.allVehicles", "All Vehicles");
        string editBreadcrumbTemplate = localizer.GetString("automations.builder.editBreadcrumb", "Edit: {0}");
        string saveLabel = localizer.GetString("automations.builder.save", "Save");
        string createLabel = localizer.GetString("automations.builder.create", "Create");

        var validation = new AutomationValidationCopy(
            ErrorName: localizer.GetString("automations.builder.errorName", "Name is required"),
            ErrorTrigger: localizer.GetString("automations.builder.errorTrigger", "Trigger type is required"),
            ErrorTriggerPlace: localizer.GetString("automations.builder.errorTriggerPlace", "Select a geofence for the trigger"),
            ErrorConditionPlace: localizer.GetString("automations.builder.errorConditionPlace", "Select a geofence for each geofence condition"),
            ErrorActions: localizer.GetString("automations.builder.errorActions", "At least one action is required"),
            ErrorActionDetails: localizer.GetString("automations.builder.errorActionDetails", "Complete every action before saving"));

        var state = ResolveState(model);
        bool showForm = state == AutomationBuilderState.Success;

        string title = model.Mode switch
        {
            AutomationBuilderMode.Edit => editTitle,
            AutomationBuilderMode.Preset => presetTitle,
            _ => createTitle,
        };

        return new AutomationBuilderDisplay
        {
            State = state,
            ShowLoading = state == AutomationBuilderState.Loading,
            ShowError = state == AutomationBuilderState.Error,
            ShowEmpty = state == AutomationBuilderState.Empty,
            ShowForm = showForm,

            Title = title,
            Subtitle = localizer.GetString(
                "automations.builder.subtitle",
                "Configure supported typed triggers, conditions, and actions for your automation."),
            BreadcrumbLabel = Format(editBreadcrumbTemplate, model.AutomationName),
            AutomationName = model.AutomationName,

            BackLabel = localizer.GetString("automations.builder.backToList", "Back to Automations"),
            CancelLabel = localizer.GetString("automations.builder.cancel", "Cancel"),
            SaveLabel = saveLabel,
            CreateLabel = createLabel,
            PrimaryActionLabel = model.Mode == AutomationBuilderMode.Edit ? saveLabel : createLabel,

            NotFoundMessage = localizer.GetString("automations.builder.notFound", "Automation not found"),
            LoadErrorDetail = model.LoadErrorDetail ?? string.Empty,

            GeneralTitle = localizer.GetString("automations.builder.general", "General"),
            NameLabel = localizer.GetString("automations.builder.name", "Name"),
            NameHint = localizer.GetString("automations.builder.namePlaceholder", "Morning Commute Prep"), // parity:allow web 'namePlaceholder' i18n key (input hint text), not a stub
            DescriptionLabel = localizer.GetString("automations.builder.description", "Description"),
            DescriptionHint = localizer.GetString(
                "automations.builder.descriptionPlaceholder", // parity:allow web 'descriptionPlaceholder' i18n key (input hint text), not a stub
                "Prepare the car for the morning commute"),
            VehicleLabel = localizer.GetString("automations.builder.vehicle", "Vehicle"),
            EnabledLabel = localizer.GetString("automations.builder.enabled", "Enabled"),

            NameValue = model.Form.Name,
            DescriptionValue = model.Form.Description,
            EnabledValue = model.Form.Enabled,
            VehicleOptions = BuildVehicleOptions(model.Vehicles, allVehicles, vehicleFallbackTemplate),
            SelectedVehicleValue = model.Form.VehicleId?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,

            WhenTitle = localizer.GetString("automations.builder.when", "When (Trigger)"),
            WhenDescription = localizer.GetString(
                "automations.builder.whenDesc",
                "Choose the supported typed contract that starts this automation."),
            TriggerTypeLabel = localizer.GetString("automations.builder.triggerType", "Trigger Type"),
            TriggerPrompt = localizer.GetString("automations.builder.selectTrigger", "Select trigger type..."),
            EmptyTriggerMessage = localizer.GetString(
                "automations.builder.emptyTrigger",
                "Select a supported trigger type to configure when this automation starts."),
            TriggerOptions = BuildTriggerOptions(localizer),
            SelectedTriggerWire = model.Form.Trigger?.Kind.ToWire() ?? string.Empty,
            HasTrigger = model.Form.Trigger is not null,

            OnlyIfTitle = localizer.GetString("automations.builder.onlyIf", "Only If (Conditions)"),
            OnlyIfDescription = localizer.GetString(
                "automations.builder.onlyIfDesc",
                "Optional checks that must pass before actions run."),

            ThenTitle = localizer.GetString("automations.builder.then", "Then (Actions)"),
            ThenDescription = localizer.GetString("automations.builder.thenDesc", "Actions are executed in order."),

            ShowConflicts = model.HasConflicts,

            SaveErrorTitle = localizer.GetString("automations.builder.saveError", "Save Error"),
            SaveErrorDetail = model.SaveErrorDetail ?? string.Empty,
            ShowSaveError = !string.IsNullOrEmpty(model.SaveErrorDetail),
            IsSaving = model.IsSaving,

            TestRunLabel = localizer.GetString("automations.builder.testRun", "Test Run"),
            ShowTestRun = model.CanTestRun,
            TestRunStartedMessage = localizer.GetString("automations.builder.testRunStarted", "Test run started!"),
            ShowTestRunStarted = model.TestRunStarted,

            PresetHint = localizer.GetString(
                "automations.builder.presetHint",
                "Not sure where to start? Browse typed automation templates."),
            ShowPresetHint = model.Mode != AutomationBuilderMode.Edit,

            EditConflictResourceLabel = localizer.GetString("editConflict.resource.automation", "This automation"),
            DraftNoun = localizer.GetString("draft.noun.automation", "Automation"),
            UnsavedMessage = localizer.GetString("forms.unsavedAutomation", "You have an unsaved automation."),

            Validation = validation,
        };
    }

    private static AutomationBuilderState ResolveState(AutomationBuilderModel model)
    {
        if (model.Mode != AutomationBuilderMode.Edit)
        {
            return AutomationBuilderState.Success;
        }

        if (model.IsLoadingAutomation)
        {
            return AutomationBuilderState.Loading;
        }

        if (model.HasLoadError)
        {
            return AutomationBuilderState.Error;
        }

        return model.AutomationFound ? AutomationBuilderState.Success : AutomationBuilderState.Empty;
    }

    private static List<AutomationVehicleOption> BuildVehicleOptions(
        IReadOnlyList<VehicleOptionRow> vehicles,
        string allVehicles,
        string fallbackTemplate)
    {
        var options = new List<AutomationVehicleOption>(vehicles.Count + 1)
        {
            new(string.Empty, allVehicles),
        };

        foreach (var vehicle in vehicles)
        {
            string label = !string.IsNullOrEmpty(vehicle.DisplayName)
                ? vehicle.DisplayName!
                : Format(fallbackTemplate, vehicle.Id.ToString(CultureInfo.InvariantCulture));
            options.Add(new AutomationVehicleOption(vehicle.Id.ToString(CultureInfo.InvariantCulture), label));
        }

        return options;
    }

    private static List<AutomationTriggerOption> BuildTriggerOptions(ILocalizer localizer)
    {
        var options = new List<AutomationTriggerOption>
        {
            new(string.Empty, localizer.GetString("automations.builder.selectTrigger", "Select trigger type...")),
        };

        foreach (var type in TriggerEventCatalog.TriggerTypes)
        {
            options.Add(new AutomationTriggerOption(type.Value.ToWire(), localizer.GetString(type.LabelKey, type.Fallback)));
        }

        return options;
    }

    private static string Format(string template, string value)
    {
        if (string.IsNullOrEmpty(template) || !template.Contains("{0}", System.StringComparison.Ordinal))
        {
            return template;
        }

        return string.Format(CultureInfo.CurrentCulture, template, value);
    }
}

/// <summary>
/// Identity + generated-client metadata for the <c>AutomationBuilderPage</c> surface — the route name the W4 shell
/// page-factory keys off (<c>AutomationBuilder</c>, the route-table entry for <c>automations/new</c> and
/// <c>automations/:id/edit</c>), the diagnostics slug and the seven generated OpenAPI operation ids the page's data
/// sources bind to (ADR-004).
/// </summary>
public static class AutomationBuilderRegistration
{
    /// <summary>The diagnostics surface slug.</summary>
    public const string Slug = "AutomationBuilderPage";

    /// <summary>The W4 route name (shared by <c>automations/new</c> and <c>automations/:id/edit</c>).</summary>
    public const string RouteName = "AutomationBuilder";

    /// <summary>Empty-state glyph (Segoe Fluent — Lightning / automation).</summary>
    public const string EmptyGlyph = "\uE945";

    /// <summary>Warning glyph for the not-found empty state (Segoe Fluent — Warning).</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>Back-button glyph (Segoe Fluent — Back).</summary>
    public const string BackGlyph = "\uE72B";

    /// <summary><c>useAutomation → GET /automations/{id}</c>.</summary>
    public const string DetailOperation = "get_api_v1_automations_id";

    /// <summary><c>useAutomationPreset → GET /automations/presets/{id}</c>.</summary>
    public const string PresetOperation = "get_api_v1_automations_presets_presetId";

    /// <summary><c>useCreateAutomationFull → POST /automations</c>.</summary>
    public const string CreateOperation = "post_api_v1_automations";

    /// <summary><c>useUpdateAutomationFull → PUT /automations/{id}</c>.</summary>
    public const string UpdateOperation = "put_api_v1_automations_id";

    /// <summary><c>useTestRunAutomation → POST /automations/{id}/test-run</c>.</summary>
    public const string TestRunOperation = "post_api_v1_automations_id_test_run";

    /// <summary><c>useNotificationChannels → GET /notifications</c>.</summary>
    public const string ChannelsOperation = "get_api_v1_notifications";

    /// <summary><c>useVehicles → GET /vehicles</c>.</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";
}

/// <summary>
/// PII-safe diagnostics for the <c>AutomationBuilderPage</c> surface — records only that the view was opened (a
/// counter), never any automation content, vehicle id, channel id or place id. Mirrors the lightweight diagnostics
/// the sibling W7 surfaces carry.
/// </summary>
public sealed class AutomationBuilderDiagnostics
{
    /// <summary>The number of times the surface recorded a <c>view.opened</c> event.</summary>
    public int OpenedCount { get; private set; }

    /// <summary>Record that the surface was opened.</summary>
    public void RecordViewOpened() => OpenedCount++;
}

/// <summary>
/// Null-tolerant JSON readers for the builder's tolerant parsers — unwraps the platform <c>{data:…}</c> envelope and
/// reads typed scalar / array fields without throwing on missing or mistyped values. Internal to the surface so it
/// stays self-contained.
/// </summary>
internal static class AutomationJson
{
    public static JsonElement Unwrap(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data) &&
            data.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
        {
            return data;
        }

        return root;
    }

    public static string? Str(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object &&
        obj.TryGetProperty(name, out var v) &&
        v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var l) => l,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var l) => l,
            _ => null,
        };
    }

    public static int? Int(JsonElement obj, string name)
    {
        long? value = Long(obj, name);
        return value.HasValue ? (int)value.Value : null;
    }

    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var d) => d,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) => d,
            _ => null,
        };
    }

    public static bool? Bool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    public static bool TryArray(JsonElement obj, string name, out JsonElement array)
    {
        if (obj.ValueKind == JsonValueKind.Object &&
            obj.TryGetProperty(name, out var v) &&
            v.ValueKind == JsonValueKind.Array)
        {
            array = v;
            return true;
        }

        array = default;
        return false;
    }

    public static IReadOnlyList<int> IntList(JsonElement obj, string name)
    {
        if (!TryArray(obj, name, out var array))
        {
            return System.Array.Empty<int>();
        }

        var list = new List<int>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Number && item.TryGetInt32(out var n))
            {
                list.Add(n);
            }
        }

        return list;
    }

    public static string? RawObject(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object &&
            obj.TryGetProperty(name, out var v) &&
            v.ValueKind == JsonValueKind.Object)
        {
            return v.GetRawText();
        }

        return null;
    }
}
