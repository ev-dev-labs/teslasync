using static TeslaSync.App.FeatureViews.FsmStateVariant;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Semantic colour variant for an FSM state — the native mirror of the web <c>BadgeVariant</c>
/// (web/src/types/fsm/types.ts). Each variant resolves to one design-token accent brush via
/// <see cref="FsmStateDiagramRegistry.BrushKeyFor(FsmStateVariant)"/>.
/// </summary>
public enum FsmStateVariant
{
    /// <summary>No semantic colour (web <c>neutral</c>) — muted text.</summary>
    Neutral,

    /// <summary>Informational (web <c>info</c>).</summary>
    Info,

    /// <summary>Success / healthy (web <c>success</c>).</summary>
    Success,

    /// <summary>Warning / transitional (web <c>warning</c>).</summary>
    Warning,

    /// <summary>Danger / terminal failure (web <c>danger</c>).</summary>
    Danger,
}

/// <summary>A directed transition edge between two FSM states (web <c>Edge</c> tuple).</summary>
/// <param name="From">The source state name.</param>
/// <param name="To">The destination state name.</param>
public readonly record struct FsmEdge(string From, string To);

/// <summary>
/// One FSM's diagram-relevant definition — the native mirror of a web <c>FSMDefinition</c>
/// (web/src/types/fsm), narrowed to what <see cref="FsmStateDiagramProjection"/> consumes:
/// the ordered <see cref="States"/> array (web <c>FSM_STATES[type]</c>), the de-duplicated
/// transition <see cref="Edges"/> (web <c>FSM_EDGES[type]</c>, i.e. <c>deriveEdges</c>) and the
/// per-state colour <see cref="Variants"/> (web <c>getStateColor</c> base resolution). Pure data.
/// </summary>
/// <param name="States">The ordered state names (diagram node order).</param>
/// <param name="Edges">The unique transition edges, in first-seen order.</param>
/// <param name="Variants">The colour variant per state name (ordinal-keyed).</param>
public sealed record FsmDefinition(
    IReadOnlyList<string> States,
    IReadOnlyList<FsmEdge> Edges,
    IReadOnlyDictionary<string, FsmStateVariant> Variants);

/// <summary>
/// Static, vehicle-agnostic FSM registry for the State Diagram surface — the native port of the web
/// FSM registry (web/src/types/fsm: <c>FSM_STATES</c>, <c>FSM_EDGES</c>, <c>getStateColor</c>). Every FSM
/// the web debugger can diagram is included (vehicle, drive_session, charge_session, command,
/// notification, alert_cooldown, automation, telemetry_connection) with the exact web state ordering and
/// the de-duplicated edge set the web <c>deriveEdges</c> produces.
/// <para>
/// Parity note on colour: the web theme tints some states with a non-default Tailwind colour within their
/// variant (e.g. <c>charge_session.active</c> is the <c>success</c> variant but rendered cyan) purely for
/// visual distinction. The native design system exposes only the semantic accent tokens, so — exactly like
/// the established <c>TsFSMBadge</c> / <c>TsStatusBadge</c> controls — each state resolves to its variant's
/// token. The variant recorded here is the web state entry's base <c>variant</c>.
/// </para>
/// </summary>
public static class FsmStateDiagramRegistry
{
    private static readonly (string State, FsmStateVariant Variant)[] VehicleStates =
    {
        ("online", Success), ("driving", Success), ("charging", Warning), ("parked", Info),
        ("updating", Info), ("asleep", Neutral), ("offline", Danger),
    };

    private static readonly (string From, string To)[] VehicleEdges =
    {
        ("online", "driving"), ("online", "charging"), ("online", "parked"), ("online", "asleep"), ("online", "offline"),
        ("driving", "parked"), ("driving", "charging"), ("driving", "online"), ("driving", "offline"),
        ("charging", "driving"), ("charging", "parked"), ("charging", "online"), ("charging", "asleep"), ("charging", "offline"),
        ("parked", "driving"), ("parked", "charging"), ("parked", "online"), ("parked", "asleep"), ("parked", "offline"),
        ("asleep", "online"), ("asleep", "charging"), ("asleep", "driving"), ("asleep", "parked"), ("asleep", "offline"),
        ("offline", "online"), ("offline", "charging"), ("offline", "driving"), ("offline", "parked"), ("offline", "asleep"),
    };

    private static readonly (string State, FsmStateVariant Variant)[] DriveSessionStates =
    {
        ("pending", Warning), ("active", Success), ("ending", Warning), ("completed", Info), ("recovered", Neutral),
    };

    private static readonly (string From, string To)[] DriveSessionEdges =
    {
        ("pending", "active"), ("pending", "recovered"), ("active", "ending"), ("active", "recovered"),
        ("ending", "completed"), ("recovered", "active"), ("recovered", "ending"),
    };

    private static readonly (string State, FsmStateVariant Variant)[] ChargeSessionStates =
    {
        ("pending", Warning), ("active", Success), ("completing", Info), ("done", Success), ("recovered", Neutral),
    };

    private static readonly (string From, string To)[] ChargeSessionEdges =
    {
        ("pending", "active"), ("pending", "recovered"), ("active", "completing"), ("active", "recovered"),
        ("completing", "done"), ("recovered", "active"), ("recovered", "completing"),
    };

    private static readonly (string State, FsmStateVariant Variant)[] CommandStates =
    {
        ("queued", Neutral), ("waking", Warning), ("wake_confirmed", Info), ("wake_timeout", Warning),
        ("sending", Info), ("succeeded", Success), ("failed", Danger), ("timed_out", Warning),
        ("retrying", Neutral), ("gave_up", Danger),
    };

    private static readonly (string From, string To)[] CommandEdges =
    {
        ("queued", "sending"), ("queued", "waking"), ("queued", "gave_up"),
        ("waking", "wake_confirmed"), ("waking", "wake_timeout"), ("wake_confirmed", "sending"),
        ("wake_timeout", "waking"), ("wake_timeout", "gave_up"),
        ("sending", "succeeded"), ("sending", "failed"), ("sending", "timed_out"),
        ("failed", "retrying"), ("failed", "gave_up"), ("timed_out", "retrying"), ("timed_out", "gave_up"),
        ("retrying", "sending"),
    };

    private static readonly (string State, FsmStateVariant Variant)[] NotificationStates =
    {
        ("created", Neutral), ("sending", Info), ("delivered", Success), ("partial", Warning),
        ("failed", Danger), ("retrying", Neutral), ("dead", Danger),
    };

    private static readonly (string From, string To)[] NotificationEdges =
    {
        ("created", "sending"), ("sending", "delivered"), ("sending", "partial"), ("sending", "failed"),
        ("partial", "sending"), ("partial", "dead"), ("failed", "retrying"), ("failed", "dead"),
        ("retrying", "sending"),
    };

    private static readonly (string State, FsmStateVariant Variant)[] AlertCooldownStates =
    {
        ("armed", Success), ("fired", Danger), ("suppressed", Warning),
    };

    private static readonly (string From, string To)[] AlertCooldownEdges =
    {
        ("armed", "fired"), ("fired", "suppressed"), ("fired", "armed"),
        ("suppressed", "suppressed"), ("suppressed", "armed"),
    };

    private static readonly (string State, FsmStateVariant Variant)[] AutomationStates =
    {
        ("idle", Neutral), ("evaluating", Info), ("executing", Warning), ("succeeded", Success),
        ("partial", Warning), ("failed", Danger), ("retrying", Warning), ("gave_up", Danger),
        ("skipped", Neutral), ("cooldown", Neutral), ("disabled", Danger),
    };

    private static readonly (string From, string To)[] AutomationEdges =
    {
        ("idle", "evaluating"), ("evaluating", "executing"), ("evaluating", "skipped"),
        ("executing", "succeeded"), ("executing", "partial"), ("executing", "failed"),
        ("failed", "retrying"), ("retrying", "executing"), ("retrying", "gave_up"),
        ("succeeded", "cooldown"), ("succeeded", "idle"), ("partial", "cooldown"), ("partial", "idle"),
        ("gave_up", "idle"), ("gave_up", "disabled"), ("skipped", "idle"), ("cooldown", "idle"), ("disabled", "idle"),
    };

    private static readonly (string State, FsmStateVariant Variant)[] TelemetryConnectionStates =
    {
        ("unknown", Neutral), ("connecting", Warning), ("streaming", Success), ("stale", Warning),
        ("disconnected", Danger), ("polling_only", Info),
    };

    private static readonly (string From, string To)[] TelemetryConnectionEdges =
    {
        ("unknown", "connecting"), ("unknown", "polling_only"), ("connecting", "streaming"),
        ("connecting", "stale"), ("connecting", "disconnected"), ("streaming", "stale"),
        ("streaming", "disconnected"), ("stale", "streaming"), ("stale", "disconnected"),
        ("disconnected", "streaming"), ("polling_only", "streaming"),
    };

    private static readonly Dictionary<string, FsmDefinition> Registry = Build();

    /// <summary>Every diagrammable FSM, keyed by its lower-case type id (web <c>FSM_REGISTRY</c> keys).</summary>
    public static IReadOnlyDictionary<string, FsmDefinition> All => Registry;

    /// <summary>True when <paramref name="fsmType"/> has a registered diagram (web <c>FSM_STATES[type] &amp;&amp; FSM_EDGES[type]</c>).</summary>
    /// <param name="fsmType">The FSM type id (e.g. <c>vehicle</c>); <c>all</c> / unknown types are unsupported.</param>
    public static bool HasDiagram(string? fsmType) =>
        fsmType is not null && Registry.ContainsKey(Normalize(fsmType));

    /// <summary>Resolve the definition for <paramref name="fsmType"/>, or null when unsupported.</summary>
    /// <param name="fsmType">The FSM type id.</param>
    public static FsmDefinition? Get(string? fsmType) =>
        fsmType is not null && Registry.TryGetValue(Normalize(fsmType), out var def) ? def : null;

    /// <summary>The ordered states for <paramref name="fsmType"/> (web <c>FSM_STATES[type]</c>), or null.</summary>
    /// <param name="fsmType">The FSM type id.</param>
    public static IReadOnlyList<string>? States(string? fsmType) => Get(fsmType)?.States;

    /// <summary>The transition edges for <paramref name="fsmType"/> (web <c>FSM_EDGES[type]</c>), or null.</summary>
    /// <param name="fsmType">The FSM type id.</param>
    public static IReadOnlyList<FsmEdge>? Edges(string? fsmType) => Get(fsmType)?.Edges;

    /// <summary>
    /// The colour variant for a state (web <c>getStateColor(fsmType, state).variant</c>). Unknown
    /// fsmType/state falls back to <see cref="FsmStateVariant.Neutral"/> (web <c>DEFAULT_STATE</c>).
    /// </summary>
    /// <param name="fsmType">The FSM type id.</param>
    /// <param name="state">The state name (case-insensitive, web <c>state.toLowerCase()</c>).</param>
    public static FsmStateVariant VariantFor(string? fsmType, string? state)
    {
        FsmDefinition? def = Get(fsmType);
        if (def is not { } definition || string.IsNullOrWhiteSpace(state))
        {
            return FsmStateVariant.Neutral;
        }

        return definition.Variants.TryGetValue(Normalize(state), out var variant) ? variant : FsmStateVariant.Neutral;
    }

    /// <summary>The design-token accent brush key for a colour variant.</summary>
    /// <param name="variant">The colour variant.</param>
    public static string BrushKeyFor(FsmStateVariant variant) => variant switch
    {
        FsmStateVariant.Success => "TsColorSuccessBrush",
        FsmStateVariant.Warning => "TsColorWarningBrush",
        FsmStateVariant.Danger => "TsColorDangerBrush",
        FsmStateVariant.Info => "TsColorInfoBrush",
        _ => "TsColorTextMutedBrush",
    };

    /// <summary>The design-token accent brush key for a state (variant resolution then token map).</summary>
    /// <param name="fsmType">The FSM type id.</param>
    /// <param name="state">The state name.</param>
    public static string BrushKeyFor(string? fsmType, string? state) => BrushKeyFor(VariantFor(fsmType, state));

    private static string Normalize(string value) => value.Trim().ToLowerInvariant();

    private static FsmDefinition Define(
        (string State, FsmStateVariant Variant)[] states,
        (string From, string To)[] edges)
    {
        var order = new string[states.Length];
        var variants = new Dictionary<string, FsmStateVariant>(states.Length, StringComparer.Ordinal);
        for (int i = 0; i < states.Length; i++)
        {
            order[i] = states[i].State;
            variants[states[i].State] = states[i].Variant;
        }

        var resolved = new FsmEdge[edges.Length];
        for (int i = 0; i < edges.Length; i++)
        {
            resolved[i] = new FsmEdge(edges[i].From, edges[i].To);
        }

        return new FsmDefinition(order, resolved, variants);
    }

    private static Dictionary<string, FsmDefinition> Build() =>
        new Dictionary<string, FsmDefinition>(StringComparer.Ordinal)
        {
            ["vehicle"] = Define(VehicleStates, VehicleEdges),
            ["drive_session"] = Define(DriveSessionStates, DriveSessionEdges),
            ["charge_session"] = Define(ChargeSessionStates, ChargeSessionEdges),
            ["command"] = Define(CommandStates, CommandEdges),
            ["notification"] = Define(NotificationStates, NotificationEdges),
            ["alert_cooldown"] = Define(AlertCooldownStates, AlertCooldownEdges),
            ["automation"] = Define(AutomationStates, AutomationEdges),
            ["telemetry_connection"] = Define(TelemetryConnectionStates, TelemetryConnectionEdges),
        };
}
