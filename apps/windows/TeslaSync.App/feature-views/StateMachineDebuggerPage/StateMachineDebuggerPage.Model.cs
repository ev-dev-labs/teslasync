using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// Canonical metadata for the <c>StateMachineDebuggerPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/system/pages/StateMachineDebuggerPage.tsx</c> (route <c>/state-debugger</c>, nav name
/// <c>State Debugger</c>, <see cref="RouteName"/>). The shell page factory registers the surface under
/// <see cref="RouteName"/>; the title + subtitle resolve through the i18n facade with the web key names and the web
/// inline-default English copy. The five generated OpenAPI operation ids back the page's data sources (ADR-004).
/// </summary>
public static class StateMachineDebuggerRegistration
{
    /// <summary>The navigation route name the shell page factory registers this surface under (RouteTable <c>StateMachineDebugger</c>).</summary>
    public const string RouteName = "StateMachineDebugger";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "StateMachineDebuggerPage";

    /// <summary>The generated OpenAPI operation id for the vehicle list (web <c>useSelectedVehicle</c> vehicles).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>The generated OpenAPI operation id for the live vehicle state (web <c>useVehicleStateMachine</c>).</summary>
    public const string StateOperation = "get_api_v1_vehicles_vehicleID_state";

    /// <summary>The generated OpenAPI operation id for the FSM stats (web <c>useFSMStats</c>).</summary>
    public const string StatsOperation = "get_api_v1_fsm_stats";

    /// <summary>The generated OpenAPI operation id for the FSM transition log (web <c>useFSMTransitions</c>).</summary>
    public const string TransitionsOperation = "get_api_v1_fsm_transitions";

    /// <summary>The generated OpenAPI operation id for the per-transition signal snapshot (web <c>useSignalSnapshot</c>).</summary>
    public const string SnapshotOperation = "get_api_v1_signals_vehicleID_snapshot";

    /// <summary>Segoe Fluent "Refresh" glyph (web RefreshCw — the auto-refresh chip).</summary>
    public const string RefreshGlyph = "\uE72C";

    /// <summary>Segoe Fluent "Activity" glyph (web Activity — the transition stat cards).</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>Segoe Fluent "Lightning" glyph (web Zap — the current-state stat card).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent "Warning" glyph (web AlertTriangle — the flap-warning stat card).</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>The localized page title (web <c>fsm.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("fsm.title", "FSM Debugger");
    }

    /// <summary>The localized page subtitle (web <c>fsm.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "fsm.subtitle",
            "Multi-FSM transition analysis — vehicle, drive, charge, command, notification");
    }
}

/// <summary>
/// The full i18n surface of the State-Machine debugger page — every visible literal flows through one keyed call
/// site with the exact web <c>t()</c> key and the web inline-default English copy, the established windows
/// convention (the page renders correct English via key-fallback whether or not the resw carries the key). Unit
/// tests assert the keys; the resw resolves localized copy in the app.
/// </summary>
public sealed class StateMachineDebuggerStrings
{
    private readonly ILocalizer _localizer;

    /// <summary>Creates the resolver over the i18n facade.</summary>
    public StateMachineDebuggerStrings(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
    }

    /// <summary>web <c>fsm.title</c>.</summary>
    public string Title => _localizer.GetString("fsm.title", "FSM Debugger");

    /// <summary>web <c>fsm.subtitle</c>.</summary>
    public string Subtitle => _localizer.GetString("fsm.subtitle", "Multi-FSM transition analysis — vehicle, drive, charge, command, notification");

    /// <summary>web <c>debugger.share</c>.</summary>
    public string Share => _localizer.GetString("debugger.share", "Share permalink");

    /// <summary>web <c>fsm.autoRefresh</c>.</summary>
    public string AutoRefresh => _localizer.GetString("fsm.autoRefresh", "Live 10s");

    /// <summary>web <c>fsm.selectVehicle</c>.</summary>
    public string SelectVehicle => _localizer.GetString("fsm.selectVehicle", "Select vehicle");

    /// <summary>web <c>fsm.noVehicles</c>.</summary>
    public string NoVehicles => _localizer.GetString("fsm.noVehicles", "No vehicles available");

    /// <summary>web <c>fsm.fsmType</c>.</summary>
    public string FsmType => _localizer.GetString("fsm.fsmType", "FSM Type");

    /// <summary>web <c>fsm.perPage</c>.</summary>
    public string PerPage => _localizer.GetString("fsm.perPage", "Per Page");

    /// <summary>web <c>help.fsm.type.aria</c>.</summary>
    public string HelpTypeAria => _localizer.GetString("help.fsm.type.aria", "More info about FSM types");

    /// <summary>The help tooltip body for the FSM-type help affordance (web inline default).</summary>
    public string HelpTypeBody => _localizer.GetString(
        "help.fsm.type",
        "Finite-state machine. Tracks vehicle high-level state (driving, charging, parked, online, asleep, offline) and the transitions between them. Sub-FSMs cover drive, charge, command, and notification lifecycles.");

    /// <summary>web <c>fsm.vehicleLiveState</c>.</summary>
    public string VehicleLiveState => _localizer.GetString("fsm.vehicleLiveState", "Vehicle Live State");

    /// <summary>web <c>help.fsm.liveState.aria</c>.</summary>
    public string HelpLiveStateAria => _localizer.GetString("help.fsm.liveState.aria", "More info about FSM live state");

    /// <summary>The help tooltip body for the live-state help affordance (web inline default).</summary>
    public string HelpLiveStateBody => _localizer.GetString(
        "help.fsm.liveState",
        "The current state the FSM resolved to from the most recent telemetry. The FSM stays in a terminal state until external evidence (telemetry or poll) triggers an explicit transition out.");

    /// <summary>web <c>fsm.type</c> (the "FSM Type:" label inside the live-state hero).</summary>
    public string Type => _localizer.GetString("fsm.type", "FSM Type");

    /// <summary>web <c>fsm.mode</c>.</summary>
    public string Mode => _localizer.GetString("fsm.mode", "Mode");

    /// <summary>web <c>fsm.since</c>.</summary>
    public string Since => _localizer.GetString("fsm.since", "Since");

    /// <summary>web <c>fsm.noState</c>.</summary>
    public string NoState => _localizer.GetString("fsm.noState", "No state data available");

    /// <summary>web <c>fsm.distributionByState</c>.</summary>
    public string DistributionByState => _localizer.GetString("fsm.distributionByState", "State Distribution");

    /// <summary>web <c>fsm.distributionByState.aria</c>.</summary>
    public string DistributionByStateAria => _localizer.GetString("fsm.distributionByState.aria", "FSM state distribution donut chart with per-state counts");

    /// <summary>web <c>fsm.col.state</c>.</summary>
    public string ColState => _localizer.GetString("fsm.col.state", "State");

    /// <summary>web <c>fsm.col.count</c>.</summary>
    public string ColCount => _localizer.GetString("fsm.col.count", "Count");

    /// <summary>web <c>fsm.transitionCounts</c>.</summary>
    public string TransitionCounts => _localizer.GetString("fsm.transitionCounts", "Transition Counts");

    /// <summary>web <c>fsm.state</c>.</summary>
    public string State => _localizer.GetString("fsm.state", "State");

    /// <summary>web <c>fsm.count</c>.</summary>
    public string Count => _localizer.GetString("fsm.count", "Transitions");

    /// <summary>web <c>fsm.avgInterval</c>.</summary>
    public string AvgInterval => _localizer.GetString("fsm.avgInterval", "Avg Interval");

    /// <summary>web <c>fsm.totalOnPage</c>.</summary>
    public string TotalOnPage => _localizer.GetString("fsm.totalOnPage", "Transitions (Page)");

    /// <summary>web <c>fsm.totalTransitions</c>.</summary>
    public string TotalTransitions => _localizer.GetString("fsm.totalTransitions", "Total Transitions");

    /// <summary>web <c>fsm.flapCount</c>.</summary>
    public string FlapCount => _localizer.GetString("fsm.flapCount", "Flap Warnings");

    /// <summary>web <c>fsm.currentState</c>.</summary>
    public string CurrentState => _localizer.GetString("fsm.currentState", "Current State");

    /// <summary>web <c>fsm.timelineTitle</c>.</summary>
    public string TimelineTitle => _localizer.GetString("fsm.timelineTitle", "Transition Log");

    /// <summary>web <c>fsm.total</c>.</summary>
    public string Total => _localizer.GetString("fsm.total", "total");

    /// <summary>web <c>fsm.time</c>.</summary>
    public string Time => _localizer.GetString("fsm.time", "Time");

    /// <summary>web <c>fsm.from</c>.</summary>
    public string From => _localizer.GetString("fsm.from", "From");

    /// <summary>web <c>fsm.to</c>.</summary>
    public string To => _localizer.GetString("fsm.to", "To");

    /// <summary>web <c>fsm.trigger</c>.</summary>
    public string Trigger => _localizer.GetString("fsm.trigger", "Trigger");

    /// <summary>web <c>fsm.viewDetail</c>.</summary>
    public string ViewDetail => _localizer.GetString("fsm.viewDetail", "View detail");

    /// <summary>web <c>fsm.detailTitle</c>.</summary>
    public string DetailTitle => _localizer.GetString("fsm.detailTitle", "Transition Detail");

    /// <summary>web <c>fsm.detail.id</c>.</summary>
    public string DetailId => _localizer.GetString("fsm.detail.id", "Transition ID");

    /// <summary>web <c>fsm.detail.vehicleId</c>.</summary>
    public string DetailVehicleId => _localizer.GetString("fsm.detail.vehicleId", "Vehicle ID");

    /// <summary>web <c>fsm.detail.name</c>.</summary>
    public string DetailName => _localizer.GetString("fsm.detail.name", "FSM Name");

    /// <summary>web <c>fsm.detail.from</c>.</summary>
    public string DetailFrom => _localizer.GetString("fsm.detail.from", "From State");

    /// <summary>web <c>fsm.detail.to</c>.</summary>
    public string DetailTo => _localizer.GetString("fsm.detail.to", "To State");

    /// <summary>web <c>fsm.detail.trigger</c>.</summary>
    public string DetailTrigger => _localizer.GetString("fsm.detail.trigger", "Trigger");

    /// <summary>web <c>fsm.detail.guard</c>.</summary>
    public string DetailGuard => _localizer.GetString("fsm.detail.guard", "Guard");

    /// <summary>web <c>fsm.detail.duration</c>.</summary>
    public string DetailDuration => _localizer.GetString("fsm.detail.duration", "Duration in State");

    /// <summary>web <c>fsm.detail.timestamp</c>.</summary>
    public string DetailTimestamp => _localizer.GetString("fsm.detail.timestamp", "Timestamp");

    /// <summary>web <c>fsm.detail.context</c>.</summary>
    public string DetailContext => _localizer.GetString("fsm.detail.context", "Details");

    /// <summary>web <c>fsm.allTime</c> — the "all time" empty-range label.</summary>
    public string AllTime => _localizer.GetString("fsm.allTime", "All time");

    /// <summary>web <c>fsm.noTransitionsInRange</c> with the {range} token interpolated.</summary>
    public string NoTransitionsInRange(string range)
    {
        string template = _localizer.GetString(
            "fsm.noTransitionsInRange",
            "No transitions in {{range}}. Try expanding the time range.");
        return template.Replace("{{range}}", range, StringComparison.Ordinal);
    }

    /// <summary>The resolved "Vehicle" FSM-type value rendered in the live-state hero (web hard-coded literal).</summary>
    public string VehicleTypeValue => _localizer.GetString("fsm.typeValue.vehicle", "Vehicle");

    /// <summary>The resolved live-mode label for the hero (web hard-coded Charging / Drive / Sleep / Idle literals).</summary>
    public string ModeLabel(VehicleLiveMode mode) => mode switch
    {
        VehicleLiveMode.Charging => _localizer.GetString("fsm.modeValue.charging", "Charging"),
        VehicleLiveMode.Drive => _localizer.GetString("fsm.modeValue.drive", "Drive"),
        VehicleLiveMode.Sleep => _localizer.GetString("fsm.modeValue.sleep", "Sleep"),
        _ => _localizer.GetString("fsm.modeValue.idle", "Idle"),
    };

    /// <summary>The localized label for a time-range preset (a native adaptation of the web RangePicker).</summary>
    public string RangePresetLabel(RangePreset preset) => preset switch
    {
        RangePreset.Last24h => _localizer.GetString("fsm.range.24h", "Last 24 hours"),
        RangePreset.Last7d => _localizer.GetString("fsm.range.7d", "Last 7 days"),
        RangePreset.Last30d => _localizer.GetString("fsm.range.30d", "Last 30 days"),
        _ => AllTime,
    };

    /// <summary>The em-dash sentinel rendered for absent values (web <c>'—'</c>).</summary>
    public const string Dash = "—";
}

/// <summary>The high-level "mode" the live-state hero derives from the current vehicle state (web hero <c>Mode</c> line).</summary>
public enum VehicleLiveMode
{
    /// <summary>Idle (web default).</summary>
    Idle,

    /// <summary>Charging (web <c>is_charging</c>).</summary>
    Charging,

    /// <summary>Drive (web <c>speed &gt; 0</c>).</summary>
    Drive,

    /// <summary>Sleep (web <c>state === 'asleep'</c>).</summary>
    Sleep,
}

/// <summary>The look-back windows the page offers — the native adaptation of the web canonical RangePicker presets.</summary>
public enum RangePreset
{
    /// <summary>The trailing 24 hours (web <c>24h</c>).</summary>
    Last24h,

    /// <summary>The trailing 7 days — the page default (web <c>7d</c>).</summary>
    Last7d,

    /// <summary>The trailing 30 days (web <c>30d</c>).</summary>
    Last30d,

    /// <summary>The whole history — an empty range, "all time" to the API (web empty range).</summary>
    AllTime,
}

/// <summary>Helpers mapping the look-back presets onto the API's <c>hours</c> window (web range → hours).</summary>
public static class RangePresets
{
    /// <summary>The presets in display order.</summary>
    public static IReadOnlyList<RangePreset> Ordered { get; } = new[]
    {
        RangePreset.Last24h, RangePreset.Last7d, RangePreset.Last30d, RangePreset.AllTime,
    };

    /// <summary>The <c>hours</c> the preset maps to (web derived <c>hours</c>); 0 means "all time" / empty range.</summary>
    public static int Hours(RangePreset preset) => preset switch
    {
        RangePreset.Last24h => 24,
        RangePreset.Last7d => 24 * 7,
        RangePreset.Last30d => 24 * 30,
        _ => 0,
    };
}

/// <summary>The catalog of the six FSM-type filter options (web <c>FSM_TYPE_OPTIONS</c>).</summary>
public static class FsmTypeCatalog
{
    /// <summary>The wire value "all" — the page default (web default).</summary>
    public const string All = "all";

    /// <summary>The ordered FSM type wire values (web <c>FSM_TYPE_OPTIONS</c> values).</summary>
    public static IReadOnlyList<string> Values { get; } = new[]
    {
        "all", "vehicle", "drive", "charge", "command", "notification",
    };

    /// <summary>The localized label for an FSM type value (web <c>FSM_TYPE_OPTIONS</c> labels).</summary>
    public static string Label(ILocalizer localizer, string value)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return value switch
        {
            "all" => localizer.GetString("fsm.typeOption.all", "All FSMs"),
            "vehicle" => localizer.GetString("fsm.typeOption.vehicle", "Vehicle"),
            "drive" => localizer.GetString("fsm.typeOption.drive", "Drive"),
            "charge" => localizer.GetString("fsm.typeOption.charge", "Charge"),
            "command" => localizer.GetString("fsm.typeOption.command", "Command"),
            "notification" => localizer.GetString("fsm.typeOption.notification", "Notification"),
            _ => value,
        };
    }

    /// <summary>Resolve the FSM type used for colour / sub-FSM context (web <c>fsmType === 'all' ? 'vehicle' : fsmType</c>).</summary>
    public static string Resolve(string fsmType) =>
        string.Equals(fsmType, All, StringComparison.OrdinalIgnoreCase) ? "vehicle" : fsmType;
}

/// <summary>A vehicle option for the sticky vehicle picker (web <c>useSelectedVehicle</c> vehicles).</summary>
/// <param name="Id">The vehicle id (web <c>v.id</c>).</param>
/// <param name="Label">The display label — display name or VIN (web <c>v.display_name || v.vin</c>).</param>
public sealed record VehicleOptionRecord(long Id, string Label)
{
    /// <summary>Parse the <c>GET /vehicles/</c> list into picker options (tolerant of partial rows).</summary>
    public static IReadOnlyList<VehicleOptionRecord> ParseList(JsonElement element)
    {
        var list = new List<VehicleOptionRecord>();
        if (element.ValueKind != JsonValueKind.Array)
        {
            return list;
        }

        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long id = StateMachineJson.GetInt64(item, "id");
            if (id <= 0)
            {
                continue;
            }

            string label = StateMachineJson.GetString(item, "display_name")
                ?? StateMachineJson.GetString(item, "vin")
                ?? id.ToString(CultureInfo.InvariantCulture);
            list.Add(new VehicleOptionRecord(id, label));
        }

        return list;
    }
}

/// <summary>
/// One FSM transition row — the native, WinUI-free analogue of a web <c>FSMTransition</c> object (a row of
/// <c>GET /fsm/transitions</c>). Carries everything the page's tables, charts, health panel, timeline and detail
/// panel derive, plus the raw JSON text the snapshot inspector's "Copy snapshot" payload reproduces.
/// </summary>
/// <param name="Id">The stable transition id (web <c>tr.id</c>).</param>
/// <param name="VehicleId">The owning vehicle id (web <c>tr.vehicle_id</c>).</param>
/// <param name="TsRaw">The raw ISO-8601 transition timestamp (web <c>tr.ts</c>).</param>
/// <param name="Timestamp">The parsed instant, or null when unparseable.</param>
/// <param name="FsmName">The FSM name (web <c>tr.fsm_name</c>); null falls back to "vehicle".</param>
/// <param name="FromState">The source state (web <c>tr.from_state</c>).</param>
/// <param name="ToState">The destination state (web <c>tr.to_state</c>).</param>
/// <param name="Trigger">The trigger label (web <c>tr.trigger</c>).</param>
/// <param name="Guard">The optional guard (web <c>tr.details.guard</c>).</param>
/// <param name="DurationMs">The optional duration-in-state in ms (web <c>tr.details.duration_in_state_ms</c>).</param>
/// <param name="Details">The flattened details map (web <c>tr.details</c>) as display strings.</param>
/// <param name="RawJson">The transition's raw JSON text (snapshot copy payload).</param>
public sealed record FsmTransitionRecord(
    long Id,
    long VehicleId,
    string? TsRaw,
    DateTimeOffset? Timestamp,
    string? FsmName,
    string FromState,
    string ToState,
    string Trigger,
    string? Guard,
    double? DurationMs,
    IReadOnlyList<KeyValuePair<string, string>> Details,
    string RawJson)
{
    /// <summary>Parse the paged <c>{ data: [...], total }</c> transitions body (or a bare array) into rows + total.</summary>
    public static FsmTransitionsPage ParsePage(JsonElement element)
    {
        JsonElement array = element;
        int total = 0;

        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty("data", out var data))
            {
                array = data;
            }

            if (element.TryGetProperty("total", out var totalEl) && totalEl.ValueKind == JsonValueKind.Number
                && totalEl.TryGetInt32(out var t))
            {
                total = t;
            }
        }

        var rows = new List<FsmTransitionRecord>();
        if (array.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in array.EnumerateArray())
            {
                var parsed = Parse(item);
                if (parsed is not null)
                {
                    rows.Add(parsed);
                }
            }
        }

        if (total == 0)
        {
            total = rows.Count;
        }

        return new FsmTransitionsPage(rows, total);
    }

    private static FsmTransitionRecord? Parse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        string? tsRaw = StateMachineJson.GetString(element, "ts");
        var details = new List<KeyValuePair<string, string>>();
        string? guard = null;
        double? durationMs = null;

        if (element.TryGetProperty("details", out var detailsEl) && detailsEl.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in detailsEl.EnumerateObject())
            {
                string value = StateMachineJson.Stringify(prop.Value);
                details.Add(new KeyValuePair<string, string>(prop.Name, value));

                if (string.Equals(prop.Name, "guard", StringComparison.Ordinal) && prop.Value.ValueKind == JsonValueKind.String)
                {
                    guard = prop.Value.GetString();
                }

                if (string.Equals(prop.Name, "duration_in_state_ms", StringComparison.Ordinal)
                    && prop.Value.ValueKind == JsonValueKind.Number && prop.Value.TryGetDouble(out var d))
                {
                    durationMs = d;
                }
            }
        }

        return new FsmTransitionRecord(
            StateMachineJson.GetInt64(element, "id"),
            StateMachineJson.GetInt64(element, "vehicle_id"),
            tsRaw,
            StateMachineJson.TryParseTimestamp(tsRaw),
            StateMachineJson.GetString(element, "fsm_name"),
            StateMachineJson.GetString(element, "from_state") ?? string.Empty,
            StateMachineJson.GetString(element, "to_state") ?? string.Empty,
            StateMachineJson.GetString(element, "trigger") ?? string.Empty,
            guard,
            durationMs,
            details,
            element.GetRawText());
    }
}

/// <summary>The result of parsing a transitions page — the rows plus the server total (web <c>{ data, total }</c>).</summary>
/// <param name="Rows">The transition rows on this page.</param>
/// <param name="Total">The server-reported total row count.</param>
public sealed record FsmTransitionsPage(IReadOnlyList<FsmTransitionRecord> Rows, int Total)
{
    /// <summary>An empty page.</summary>
    public static FsmTransitionsPage Empty { get; } = new(Array.Empty<FsmTransitionRecord>(), 0);
}

/// <summary>
/// The current resolved vehicle state for the live-state hero — the native analogue of the web
/// <c>useVehicleStateMachine</c> response's <c>state</c> object. Tolerant of both the wrapped (<c>{ state: {...} }</c>)
/// and the flat (<c>{ state: "driving", ... }</c>) response shapes the web defensively handles.
/// </summary>
/// <param name="State">The high-level state name (web <c>state.state</c>); null when unknown.</param>
/// <param name="IsCharging">Whether the vehicle is charging (web <c>state.is_charging</c>).</param>
/// <param name="Speed">The current speed in SI (web <c>state.speed</c>); only its sign is consulted for the mode.</param>
/// <param name="Since">When the state was entered (web <c>state.since</c>); null when unknown.</param>
public sealed record CurrentStateInfo(string? State, bool IsCharging, double Speed, DateTimeOffset? Since)
{
    /// <summary>The high-level mode the hero derives (web <c>is_charging ? Charging : speed &gt; 0 ? Drive : asleep ? Sleep : Idle</c>).</summary>
    public VehicleLiveMode Mode =>
        IsCharging ? VehicleLiveMode.Charging
        : Speed > 0 ? VehicleLiveMode.Drive
        : string.Equals(State, "asleep", StringComparison.OrdinalIgnoreCase) ? VehicleLiveMode.Sleep
        : VehicleLiveMode.Idle;

    /// <summary>Parse the <c>GET /vehicles/{id}/state</c> body — wrapped or flat — into a tolerant snapshot, or null.</summary>
    public static CurrentStateInfo? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // The web casts the response as { state?: VehicleState, ... }; resolve the nested state object when present,
        // otherwise treat the root as the flat VehicleState (the generated client's declared shape).
        JsonElement state = element;
        if (element.TryGetProperty("state", out var nested) && nested.ValueKind == JsonValueKind.Object)
        {
            state = nested;
        }
        else if (!element.TryGetProperty("state", out _))
        {
            return null;
        }

        string? name = StateMachineJson.GetString(state, "state");
        bool isCharging = StateMachineJson.GetBool(state, "is_charging");
        double speed = StateMachineJson.GetDouble(state, "speed") ?? 0;
        DateTimeOffset? since = StateMachineJson.TryParseTimestamp(StateMachineJson.GetString(state, "since"));
        return new CurrentStateInfo(name, isCharging, speed, since);
    }
}

/// <summary>The parsed FSM stats body — the active sub-FSMs the sub-FSM panel renders (web <c>useFSMStats</c> <c>active_subs</c>).</summary>
public static class FsmStatsParser
{
    /// <summary>Parse the <c>GET /fsm/stats</c> body into the active sub-FSM list (web <c>statsData.active_subs</c>).</summary>
    public static IReadOnlyList<ActiveSubFSM> ParseActiveSubs(JsonElement element)
    {
        var list = new List<ActiveSubFSM>();
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty("active_subs", out var subs)
            || subs.ValueKind != JsonValueKind.Array)
        {
            return list;
        }

        foreach (var item in subs.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string type = StateMachineJson.GetString(item, "type") ?? string.Empty;
            SubFSMKind kind = string.Equals(type, "charge", StringComparison.OrdinalIgnoreCase)
                ? SubFSMKind.Charge
                : SubFSMKind.Drive;
            string state = StateMachineJson.GetString(item, "state") ?? string.Empty;
            DateTimeOffset? start = StateMachineJson.TryParseTimestamp(StateMachineJson.GetString(item, "start_time"));
            long? driveId = StateMachineJson.GetOptionalInt64(item, "drive_id");
            long? sessionId = StateMachineJson.GetOptionalInt64(item, "session_id");
            list.Add(new ActiveSubFSM(kind, state, start, driveId, sessionId));
        }

        return list;
    }
}

/// <summary>Tolerant JSON accessors shared by the page's parsers (mirrors the sibling surfaces' helpers).</summary>
internal static class StateMachineJson
{
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    public static long GetInt64(JsonElement obj, string name) => GetOptionalInt64(obj, name) ?? 0;

    public static long? GetOptionalInt64(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v))
        {
            if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n))
            {
                return n;
            }

            if (v.ValueKind == JsonValueKind.String && long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s))
            {
                return s;
            }
        }

        return null;
    }

    public static double? GetDouble(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d)
            ? d
            : null;

    public static bool GetBool(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    public static string Stringify(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString() ?? string.Empty,
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null => "null",
        _ => value.GetRawText(),
    };

    public static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var ts)
            ? ts
            : null;
    }
}

/// <summary>
/// PII-safe diagnostics for the State-Machine debugger page (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id or any signal value.
/// </summary>
public sealed class StateMachineDebuggerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public StateMachineDebuggerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => System.Threading.Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=StateMachineDebuggerPage</c>.</summary>
    public void RecordViewOpened()
    {
        System.Threading.Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={StateMachineDebuggerRegistration.Slug}");
    }
}
