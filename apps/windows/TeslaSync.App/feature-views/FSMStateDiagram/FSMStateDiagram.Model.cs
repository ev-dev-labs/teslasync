using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The i18n keys (and English fallbacks) the State Diagram surface resolves through the
/// <see cref="ILocalizer"/> facade. The two diagram strings are extracted verbatim from the web source
/// (web/src/features/system/components/FSMStateDiagram.tsx: <c>fsm.stateDiagram</c>, <c>fsm.selectFsmType</c>);
/// the remaining keys label the native self-contained surface's freshness/error chrome and the
/// accessibility (Narrator) names the prop-only web child never needed.
/// </summary>
public static class FsmStateDiagramText
{
    /// <summary>Web <c>fsm.stateDiagram</c> — the panel title.</summary>
    public const string TitleKey = "fsm.stateDiagram";

    /// <summary>English fallback for <see cref="TitleKey"/>.</summary>
    public const string TitleFallback = "State Diagram";

    /// <summary>Web <c>fsm.selectFsmType</c> — the empty-state message for an undiagrammed FSM type.</summary>
    public const string SelectFsmTypeKey = "fsm.selectFsmType";

    /// <summary>English fallback for <see cref="SelectFsmTypeKey"/>.</summary>
    public const string SelectFsmTypeFallback = "Select a specific FSM type to view its state diagram";

    /// <summary>Hard-failure message key.</summary>
    public const string ErrorKey = "fsm.stateDiagram.error";

    /// <summary>English fallback for <see cref="ErrorKey"/>.</summary>
    public const string ErrorFallback = "Couldn't load FSM transitions";

    /// <summary>Offline (cached) message key.</summary>
    public const string OfflineKey = "fsm.stateDiagram.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "You're offline — showing the last cached transitions";

    /// <summary>Loading announcement key.</summary>
    public const string LoadingKey = "fsm.stateDiagram.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading state diagram\u2026";

    /// <summary>Per-node "{0} transitions" Narrator fragment key.</summary>
    public const string TransitionsA11yKey = "fsm.stateDiagram.a11y.transitions";

    /// <summary>English fallback for <see cref="TransitionsA11yKey"/>.</summary>
    public const string TransitionsA11yFallback = "{0} transitions";

    /// <summary>Per-node "current state" Narrator fragment key.</summary>
    public const string CurrentA11yKey = "fsm.stateDiagram.a11y.current";

    /// <summary>English fallback for <see cref="CurrentA11yKey"/>.</summary>
    public const string CurrentA11yFallback = "current state";

    /// <summary>Edge-summary "{0} to {1}, {2} transitions" Narrator fragment key.</summary>
    public const string EdgeA11yKey = "fsm.stateDiagram.a11y.edge";

    /// <summary>English fallback for <see cref="EdgeA11yKey"/>.</summary>
    public const string EdgeA11yFallback = "{0} to {1}, {2} transitions";

    /// <summary>Surface-level "{0} states" Narrator fragment key.</summary>
    public const string StatesA11yKey = "fsm.stateDiagram.a11y.states";

    /// <summary>English fallback for <see cref="StatesA11yKey"/>.</summary>
    public const string StatesA11yFallback = "{0} states";
}

/// <summary>
/// One parsed FSM transition row — the native mirror of the web <c>FSMTransition</c>
/// (web/src/types/fsm/ui-types.ts), narrowed to the fields the diagram reads. <see cref="Timestamp"/> is the
/// parsed <c>ts</c> instant (null when absent/unparseable, mirroring the web <c>new Date(ts)</c> NaN guard).
/// </summary>
/// <param name="Timestamp">The parsed transition instant, or null.</param>
/// <param name="FsmName">The owning FSM name (web <c>fsm_name</c>).</param>
/// <param name="FromState">The source state (web <c>from_state</c>).</param>
/// <param name="ToState">The destination state (web <c>to_state</c>).</param>
public sealed record FsmTransition(DateTimeOffset? Timestamp, string FsmName, string FromState, string ToState)
{
    /// <summary>
    /// Parse the <c>/fsm/transitions</c> response into transition rows. Accepts the canonical paged shape
    /// (<c>{ "data": [ … ] }</c>, web <c>FSMTransitionResponse</c>) and a bare array; any other shape yields an
    /// empty list. Non-object array items are skipped.
    /// </summary>
    /// <param name="element">The decoded JSON response body.</param>
    public static IReadOnlyList<FsmTransition> ParseList(JsonElement element)
    {
        JsonElement array;
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Array)
        {
            array = data;
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            array = element;
        }
        else
        {
            return Array.Empty<FsmTransition>();
        }

        var list = new List<FsmTransition>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new FsmTransition(
                ReadTimestamp(item, "ts", "timestamp"),
                ReadString(item, "fsm_name", "fsmName"),
                ReadString(item, "from_state", "fromState"),
                ReadString(item, "to_state", "toState")));
        }

        return list;
    }

    private static string ReadString(JsonElement obj, string snake, string camel)
    {
        if ((obj.TryGetProperty(snake, out var v) || obj.TryGetProperty(camel, out v)) &&
            v.ValueKind == JsonValueKind.String)
        {
            return v.GetString() ?? string.Empty;
        }

        return string.Empty;
    }

    private static DateTimeOffset? ReadTimestamp(JsonElement obj, string snake, string camel)
    {
        if ((obj.TryGetProperty(snake, out var v) || obj.TryGetProperty(camel, out v)) &&
            v.ValueKind == JsonValueKind.String &&
            DateTimeOffset.TryParse(
                v.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                out var parsed))
        {
            return parsed;
        }

        return null;
    }
}

/// <summary>
/// A render-ready state node in the diagram — the native projection of one web state box
/// (the <c>states.map(...)</c> body in FSMStateDiagram.tsx). Carries the resolved accent
/// <see cref="BrushKey"/>, the observed <see cref="Count"/> (web <c>stateCounts</c>), whether it is the most
/// recent <see cref="IsCurrent"/> state (web <c>latestState</c>), and the optional trailing-arrow edge count
/// to the next node (web's per-arrow <c>edgeCounts</c> lookup).
/// </summary>
/// <param name="State">The state name (rendered verbatim, as the web does).</param>
/// <param name="BrushKey">The design-token accent brush key for the dot and label.</param>
/// <param name="Count">The number of transitions touching this state (from + to).</param>
/// <param name="IsCurrent">True when this is the latest <c>to_state</c> by timestamp.</param>
/// <param name="HasNext">True when a trailing arrow to the next node should render.</param>
/// <param name="NextEdgeCount">The observed count for the edge to the next node, or null.</param>
/// <param name="AutomationName">The composed Narrator name.</param>
public sealed record FsmStateNode(
    string State,
    string BrushKey,
    int Count,
    bool IsCurrent,
    bool HasNext,
    int? NextEdgeCount,
    string AutomationName)
{
    /// <summary>True when the state was observed at least once (web <c>count &gt; 0</c>); inactive nodes dim.</summary>
    public bool IsActive => Count > 0;
}

/// <summary>
/// One row of the edge-frequency summary beneath the diagram — the native projection of a web edge-summary
/// chip (the <c>Array.from(edgeCounts.entries()).sort(...).slice(0,10)</c> run in FSMStateDiagram.tsx).
/// </summary>
/// <param name="From">The edge source state.</param>
/// <param name="To">The edge destination state.</param>
/// <param name="FromBrushKey">The accent brush key for <paramref name="From"/>.</param>
/// <param name="ToBrushKey">The accent brush key for <paramref name="To"/>.</param>
/// <param name="Count">The observed transition count for this edge.</param>
/// <param name="AutomationName">The composed Narrator name.</param>
public sealed record FsmEdgeSummaryItem(
    string From,
    string To,
    string FromBrushKey,
    string ToBrushKey,
    int Count,
    string AutomationName);

/// <summary>
/// The render-ready projection a <see cref="FsmStateDiagramViewModel"/> hands the view — the native analogue
/// of everything FSMStateDiagram.tsx computes from its <c>fsmType</c> + <c>transitions</c> props.
/// <see cref="IsSupported"/> mirrors the web <c>states &amp;&amp; edges</c> gate: when false the surface shows the
/// <see cref="EmptyMessage"/> empty state, otherwise it renders the <see cref="Nodes"/> flow and the
/// <see cref="EdgeSummary"/> chips.
/// </summary>
/// <param name="IsSupported">True when the FSM type has a registered diagram.</param>
/// <param name="Title">The localized panel title (web <c>fsm.stateDiagram</c>).</param>
/// <param name="EmptyMessage">The localized "select a type" message (web <c>fsm.selectFsmType</c>).</param>
/// <param name="Nodes">The ordered diagram nodes.</param>
/// <param name="EdgeSummary">The top edge-frequency chips (≤ 10, count-descending).</param>
/// <param name="AutomationName">The surface-level Narrator name.</param>
public sealed record FsmStateDiagramDisplay(
    bool IsSupported,
    string Title,
    string EmptyMessage,
    IReadOnlyList<FsmStateNode> Nodes,
    IReadOnlyList<FsmEdgeSummaryItem> EdgeSummary,
    string AutomationName)
{
    /// <summary>True when there is at least one node to render.</summary>
    public bool HasNodes => Nodes.Count > 0;

    /// <summary>True when the edge-frequency summary has at least one chip (web <c>edgeCounts.size &gt; 0</c>).</summary>
    public bool HasEdgeSummary => EdgeSummary.Count > 0;

    /// <summary>The unsupported-FSM display (web's <c>!states || !edges</c> empty branch).</summary>
    /// <param name="localizer">The i18n facade resolving the title and message.</param>
    public static FsmStateDiagramDisplay Empty(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string title = localizer.GetString(FsmStateDiagramText.TitleKey, FsmStateDiagramText.TitleFallback);
        string message = localizer.GetString(FsmStateDiagramText.SelectFsmTypeKey, FsmStateDiagramText.SelectFsmTypeFallback);
        return new FsmStateDiagramDisplay(
            false, title, message, Array.Empty<FsmStateNode>(), Array.Empty<FsmEdgeSummaryItem>(), message);
    }
}

/// <summary>
/// The pure, UI-thread-free projection that turns an FSM type plus a transition window into a
/// <see cref="FsmStateDiagramDisplay"/> — the native port of the <c>useMemo</c> + render computation in
/// FSMStateDiagram.tsx. It tallies per-state counts (from + to), per-edge counts, and the latest state by
/// timestamp, then emits one node per registered state (in web order) and the count-descending edge summary.
/// </summary>
public static class FsmStateDiagramProjection
{
    private const int MaxEdgeSummary = 10;

    /// <summary>
    /// Project <paramref name="transitions"/> for <paramref name="fsmType"/>. Unsupported types yield
    /// <see cref="FsmStateDiagramDisplay.Empty(ILocalizer)"/>; supported types always yield the full node flow
    /// (dimmed when a state has no activity), exactly as the web component renders.
    /// </summary>
    /// <param name="fsmType">The FSM type id (e.g. <c>vehicle</c>).</param>
    /// <param name="transitions">The transition window (already server-filtered; re-filtered defensively).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static FsmStateDiagramDisplay Project(
        string fsmType,
        IReadOnlyList<FsmTransition> transitions,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(transitions);
        ArgumentNullException.ThrowIfNull(localizer);

        if (FsmStateDiagramRegistry.Get(fsmType) is not { } definition)
        {
            return FsmStateDiagramDisplay.Empty(localizer);
        }

        var stateCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        var edgeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        var edgeOrder = new List<FsmEdge>();
        string latest = string.Empty;
        DateTimeOffset? latestTime = null;
        bool isAll = string.Equals(fsmType.Trim(), "all", StringComparison.OrdinalIgnoreCase);

        foreach (var transition in transitions)
        {
            // web: if (fsmType !== 'all' && tr.fsm_name !== fsmType) continue;
            if (!isAll && !string.Equals(transition.FsmName, fsmType, StringComparison.Ordinal))
            {
                continue;
            }

            Increment(stateCounts, transition.ToState);
            Increment(stateCounts, transition.FromState);

            string edgeKey = EdgeKey(transition.FromState, transition.ToState);
            if (!edgeCounts.ContainsKey(edgeKey))
            {
                edgeOrder.Add(new FsmEdge(transition.FromState, transition.ToState));
            }

            edgeCounts[edgeKey] = (edgeCounts.TryGetValue(edgeKey, out var ec) ? ec : 0) + 1;

            if (transition.Timestamp is { } ts && (latestTime is null || ts > latestTime))
            {
                latestTime = ts;
                latest = transition.ToState;
            }
        }

        var states = definition.States;
        var nodes = new List<FsmStateNode>(states.Count);
        for (int i = 0; i < states.Count; i++)
        {
            string state = states[i];
            int count = stateCounts.TryGetValue(state, out var c) ? c : 0;
            bool isCurrent = latest.Length > 0 && string.Equals(state, latest, StringComparison.Ordinal);
            bool hasNext = i < states.Count - 1;
            int? nextEdgeCount = null;
            if (hasNext && edgeCounts.TryGetValue(EdgeKey(state, states[i + 1]), out var nec))
            {
                nextEdgeCount = nec;
            }

            nodes.Add(new FsmStateNode(
                state,
                FsmStateDiagramRegistry.BrushKeyFor(fsmType, state),
                count,
                isCurrent,
                hasNext,
                nextEdgeCount,
                NodeAutomation(localizer, state, count, isCurrent)));
        }

        var summary = new List<FsmEdgeSummaryItem>(Math.Min(MaxEdgeSummary, edgeOrder.Count));
        foreach (var edge in edgeOrder.OrderByDescending(e => edgeCounts[EdgeKey(e.From, e.To)]).Take(MaxEdgeSummary))
        {
            int count = edgeCounts[EdgeKey(edge.From, edge.To)];
            summary.Add(new FsmEdgeSummaryItem(
                edge.From,
                edge.To,
                FsmStateDiagramRegistry.BrushKeyFor(fsmType, edge.From),
                FsmStateDiagramRegistry.BrushKeyFor(fsmType, edge.To),
                count,
                EdgeAutomation(localizer, edge.From, edge.To, count)));
        }

        string title = localizer.GetString(FsmStateDiagramText.TitleKey, FsmStateDiagramText.TitleFallback);
        string emptyMessage = localizer.GetString(FsmStateDiagramText.SelectFsmTypeKey, FsmStateDiagramText.SelectFsmTypeFallback);
        string automation = string.Format(
            CultureInfo.CurrentCulture,
            "{0}, {1}",
            title,
            string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(FsmStateDiagramText.StatesA11yKey, FsmStateDiagramText.StatesA11yFallback),
                states.Count));

        return new FsmStateDiagramDisplay(true, title, emptyMessage, nodes, summary, automation);
    }

    private static void Increment(Dictionary<string, int> map, string key)
    {
        if (string.IsNullOrEmpty(key))
        {
            return;
        }

        map[key] = (map.TryGetValue(key, out var v) ? v : 0) + 1;
    }

    private static string EdgeKey(string from, string to) => from + "->" + to;

    private static string NodeAutomation(ILocalizer localizer, string state, int count, bool isCurrent)
    {
        var parts = new List<string> { state };
        if (count > 0)
        {
            parts.Add(string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(FsmStateDiagramText.TransitionsA11yKey, FsmStateDiagramText.TransitionsA11yFallback),
                count));
        }

        if (isCurrent)
        {
            parts.Add(localizer.GetString(FsmStateDiagramText.CurrentA11yKey, FsmStateDiagramText.CurrentA11yFallback));
        }

        return string.Join(", ", parts);
    }

    private static string EdgeAutomation(ILocalizer localizer, string from, string to, int count) =>
        string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(FsmStateDiagramText.EdgeA11yKey, FsmStateDiagramText.EdgeA11yFallback),
            from,
            to,
            count);
}

/// <summary>
/// Canonical metadata for the State Diagram surface — the native mirror of the web component at
/// web/src/features/system/components/FSMStateDiagram.tsx.
/// </summary>
public static class FsmStateDiagramRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "fsm-state-diagram";

    /// <summary>Surface category.</summary>
    public const string Category = "system";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "FSMStateDiagram";

    /// <summary>Localized surface name (the web panel title).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(FsmStateDiagramText.TitleKey, FsmStateDiagramText.TitleFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the State Diagram surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a VIN, state value or transition
/// timestamp — so a diagnostics line can never leak vehicle data. Thread-safe.
/// </summary>
public sealed class FsmStateDiagramDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or <see langword="null"/>.</param>
    public FsmStateDiagramDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FSMStateDiagram</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FsmStateDiagramRegistration.Slug}");
    }
}
