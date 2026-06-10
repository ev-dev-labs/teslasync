using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state the Snapshot Inspector surface can render. Every branch maps onto a visible
/// surface — none is ever hidden. The web component
/// (web/src/features/system/components/state-machine/SnapshotInspector.tsx) is a presentational right-rail
/// fed by the FSM debugger page; it renders <see cref="Loading"/> (no transition, fetch in flight),
/// <see cref="OutsideWindow"/> (no transition selectable in the active window but a last transition exists),
/// <see cref="Empty"/> (no transition — pick one), <see cref="NoSignals"/> (a transition with an empty
/// snapshot) and <see cref="Populated"/> (the transition header + signal list). The native surface adds the
/// explicit <see cref="Error"/> / <see cref="Stale"/> / <see cref="Offline"/> branches the parent state
/// holder can drive — a strict superset of the web that satisfies the prompt's mandated state set.
/// </summary>
public enum SnapshotInspectorState
{
    /// <summary>No transition selected and a fetch is in flight — the centred "Loading…" chrome.</summary>
    Loading,

    /// <summary>No transition selected — the "Select a transition to inspect its snapshot" prompt.</summary>
    Empty,

    /// <summary>
    /// No transition selectable in the active window but a <c>lastTransition</c> exists outside it — the
    /// "Nothing in the current window" message plus the "Jump to last transition" affordance.
    /// </summary>
    OutsideWindow,

    /// <summary>A transition is selected but its snapshot captured no signals — the header + empty note.</summary>
    NoSignals,

    /// <summary>A transition is selected with signals — the full header + signal list.</summary>
    Populated,

    /// <summary>The parent's snapshot fetch failed with nothing to show — a retriable error surface.</summary>
    Error,

    /// <summary>A populated snapshot older than the freshness window — the list plus a stale chip.</summary>
    Stale,

    /// <summary>Connectivity lost but a cached snapshot remains — the list plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One parsed FSM transition — the native analogue of the web <c>FSMTransition</c> (web/src/types/fsm).
/// Holds the from / to / trigger / timestamp and the <c>duration_in_state_ms</c> detail the inspector header
/// renders, plus the original JSON text so the "Copy snapshot" payload reproduces the web's
/// <c>JSON.stringify(transition)</c> byte-for-byte. Pure data — produced by <see cref="Parse"/> and
/// unit-tested without a UI host.
/// </summary>
public sealed record SnapshotTransition(
    long Id,
    long VehicleId,
    string? TsRaw,
    string FsmName,
    string FromState,
    string ToState,
    string Trigger,
    double? DurationInStateMs,
    string RawJson)
{
    /// <summary>The transition timestamp parsed to a UTC instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? Timestamp => SnapshotJson.TryParseTimestamp(TsRaw);

    /// <summary>
    /// Parse a <c>FSMTransition</c> object (a row of <c>GET /system/fsm/transitions</c>) into a tolerant
    /// record. Every field falls back rather than throwing so a partial / schema-drifted transition never
    /// aborts the inspector. A non-object element yields a null transition (the "no transition selected"
    /// branch).
    /// </summary>
    public static SnapshotTransition? Parse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new SnapshotTransition(
            SnapshotJson.GetInt64(element, "id"),
            SnapshotJson.GetInt64(element, "vehicle_id"),
            SnapshotJson.GetString(element, "ts"),
            SnapshotJson.GetString(element, "fsm_name") ?? string.Empty,
            SnapshotJson.GetString(element, "from_state") ?? string.Empty,
            SnapshotJson.GetString(element, "to_state") ?? string.Empty,
            SnapshotJson.GetString(element, "trigger") ?? string.Empty,
            SnapshotJson.GetDetailNumber(element, "details", "duration_in_state_ms"),
            element.GetRawText());
    }
}

/// <summary>
/// One parsed signal value from a transition snapshot — the native analogue of the web
/// <c>SignalSnapshotEntry</c>. <see cref="HasValue"/> distinguishes an explicit <c>value</c> (even a JSON
/// <c>null</c>, which the web still surfaces in the diff) from an absent one (a bare scalar / object without a
/// <c>value</c> key, which the web reads as <c>undefined</c>). <see cref="ValueDisplay"/> is the web
/// <c>formatValue</c> coercion and <see cref="ValueRaw"/> is the <c>JSON.stringify(value ?? null)</c> form the
/// diff comparison uses. Pure data.
/// </summary>
public sealed record SignalSnapshotEntry(bool HasValue, string ValueDisplay, string ValueRaw, string? Source, double? AgeMs);

/// <summary>
/// A parsed transition snapshot — the native analogue of the web <c>SignalSnapshotResponse</c>. Holds the
/// per-signal <see cref="Signals"/> map, the original <c>at</c> string and the raw signals JSON (both used to
/// reproduce the "Copy snapshot" payload exactly). Produced by <see cref="Parse"/>; unit-tested without a UI
/// host.
/// </summary>
public sealed record SignalSnapshot(
    IReadOnlyDictionary<string, SignalSnapshotEntry> Signals,
    string? AtRaw,
    string RawSignalsJson)
{
    /// <summary>An empty snapshot (resolved with no signals) — the projection fallback.</summary>
    public static SignalSnapshot Empty { get; } =
        new(new Dictionary<string, SignalSnapshotEntry>(StringComparer.Ordinal), null, "{}");

    /// <summary>The number of captured signals.</summary>
    public int Count => Signals.Count;

    /// <summary>
    /// Parse a <c>SignalSnapshotResponse</c> body — <c>{ vehicle_id, at?, count, signals: { name: { value,
    /// source?, age_ms? } } }</c> — into a tolerant snapshot. Each entry is normalised through
    /// <see cref="EntryFrom"/>; a non-object body or a missing / non-object <c>signals</c> map yields an empty
    /// snapshot (the surface then renders its "No signals captured" state).
    /// </summary>
    public static SignalSnapshot Parse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty("signals", out var signals)
            || signals.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var map = new Dictionary<string, SignalSnapshotEntry>(StringComparer.Ordinal);
        foreach (var entry in signals.EnumerateObject())
        {
            map[entry.Name] = EntryFrom(entry.Value);
        }

        return new SignalSnapshot(map, SnapshotJson.GetString(element, "at"), signals.GetRawText());
    }

    /// <summary>
    /// Normalise one <c>signals</c> entry. The snapshot endpoint returns a <c>{ value, source?, age_ms? }</c>
    /// envelope; the web reads <c>entry?.value</c>, so an entry that is not an object (or an object without a
    /// <c>value</c> key) is treated as having no value (display "—", diff "null") exactly as the web does.
    /// </summary>
    public static SignalSnapshotEntry EntryFrom(JsonElement raw)
    {
        if (raw.ValueKind == JsonValueKind.Object && raw.TryGetProperty("value", out var value))
        {
            return new SignalSnapshotEntry(
                HasValue: true,
                ValueDisplay: SnapshotInspectorProjection.FormatValue(value),
                ValueRaw: value.GetRawText(),
                Source: SnapshotJson.GetString(raw, "source"),
                AgeMs: SnapshotJson.GetNumber(raw, "age_ms"));
        }

        return new SignalSnapshotEntry(
            HasValue: false,
            ValueDisplay: SnapshotInspectorProjection.EmDash,
            ValueRaw: "null",
            Source: null,
            AgeMs: null);
    }
}

/// <summary>
/// One projected, render-ready inspector row — a signal name, its display value, the source-layer badge
/// inputs and the diff metadata (whether it changed versus the previous snapshot and the previous display
/// value). The native port of the web component's <c>rows</c> <c>useMemo</c> entries. Pure data.
/// </summary>
public sealed record SnapshotInspectorRow(
    string Name,
    string ValueDisplay,
    string? Source,
    double? AgeMs,
    bool Changed,
    string? PreviousDisplay);

/// <summary>
/// Pure projection from the parsed transition + snapshot to the render-ready inspector model — the native
/// port of the web component's <c>formatValue</c>, the <c>rows</c> / <c>copyPayload</c> <c>useMemo</c> chains
/// and the conditional-render branch selection. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class SnapshotInspectorProjection
{
    /// <summary>Em-dash fallback for an absent / null value (web parity '—').</summary>
    public const string EmDash = "\u2014";

    /// <summary>
    /// Coerce a JSON value to its display string — the native port of the web <c>formatValue</c>: an absent
    /// value or explicit <c>null</c> renders the em-dash, a boolean its literal, a (finite) number its literal
    /// text, a string verbatim, and any object / array as compact JSON so a typed compound value never crashes
    /// the row.
    /// </summary>
    public static string FormatValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Undefined => EmDash,
        JsonValueKind.Null => EmDash,
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.String => value.GetString() ?? string.Empty,
        JsonValueKind.Object => value.GetRawText(),
        JsonValueKind.Array => value.GetRawText(),
        _ => EmDash,
    };

    /// <summary>
    /// Project the snapshot signals into sorted, diff-annotated rows — the native port of the web
    /// <c>rows</c> <c>useMemo</c>. A signal is <c>Changed</c> only when a <paramref name="previousSnapshot"/>
    /// is supplied and its serialised value differs (web <c>JSON.stringify(prev?.value ?? null) !==
    /// JSON.stringify(value ?? null)</c>); the previous display value is surfaced only when the previous
    /// snapshot actually carried a value for that signal. Rows are sorted by signal name (ordinal —
    /// deterministic and equivalent to the web <c>localeCompare</c> for the PascalCase signal identifiers).
    /// </summary>
    public static IReadOnlyList<SnapshotInspectorRow> ProjectRows(SignalSnapshot? snapshot, SignalSnapshot? previousSnapshot)
    {
        if (snapshot is null || snapshot.Signals.Count == 0)
        {
            return Array.Empty<SnapshotInspectorRow>();
        }

        bool hasPrevious = previousSnapshot is not null;
        var previous = previousSnapshot?.Signals;

        var rows = new List<SnapshotInspectorRow>(snapshot.Signals.Count);
        foreach (var (name, entry) in snapshot.Signals)
        {
            SignalSnapshotEntry? prevEntry = null;
            if (previous is not null && previous.TryGetValue(name, out var found))
            {
                prevEntry = found;
            }

            string previousRaw = prevEntry?.ValueRaw ?? "null";
            bool changed = hasPrevious && !string.Equals(previousRaw, entry.ValueRaw, StringComparison.Ordinal);
            string? previousDisplay = prevEntry is { HasValue: true } ? prevEntry.ValueDisplay : null;

            rows.Add(new SnapshotInspectorRow(name, entry.ValueDisplay, entry.Source, entry.AgeMs, changed, previousDisplay));
        }

        rows.Sort((a, b) => string.CompareOrdinal(a.Name, b.Name));
        return rows;
    }

    /// <summary>
    /// Build the "Copy snapshot" clipboard payload — the native port of the web <c>copyPayload</c>
    /// <c>useMemo</c>: a pretty-printed <c>{ transition, snapshot: signals, at }</c> object reproducing the
    /// original transition and signal JSON. Returns the empty string when either the transition or the
    /// snapshot is absent (the web renders no copy button in that case).
    /// </summary>
    public static string BuildCopyPayload(SnapshotTransition? transition, SignalSnapshot? snapshot)
    {
        if (transition is null || snapshot is null)
        {
            return string.Empty;
        }

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = true }))
        {
            writer.WriteStartObject();

            writer.WritePropertyName("transition");
            WriteRawOrNull(writer, transition.RawJson);

            writer.WritePropertyName("snapshot");
            WriteRawOrNull(writer, snapshot.RawSignalsJson);

            writer.WritePropertyName("at");
            if (snapshot.AtRaw is { } at)
            {
                writer.WriteStringValue(at);
            }
            else
            {
                writer.WriteNullValue();
            }

            writer.WriteEndObject();
        }

        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    /// <summary>
    /// Format the <c>duration_in_state_ms</c> detail for the header — the web <c>fmtInt(...) + ' ms'</c>: a
    /// thousands-grouped integer, or an em-dash when the detail is absent, always suffixed with " ms".
    /// </summary>
    public static string FormatDuration(double? durationMs)
    {
        string value = durationMs is { } ms
            ? Math.Round(ms).ToString("N0", CultureInfo.CurrentCulture)
            : EmDash;
        return value + " ms";
    }

    /// <summary>
    /// Resolve the semantic severity for an FSM state — the native analogue of the web
    /// <c>getStateColor(fsmType, state)</c> variant, driving the from / to state badge accent. Maps the
    /// canonical vehicle and telemetry-connection states (the FSM types the debugger exposes) and falls back
    /// to a keyword heuristic, then to <see cref="SeverityLevel.Info"/>.
    /// </summary>
    public static SeverityLevel StateSeverity(string state)
    {
        string s = (state ?? string.Empty).Trim().ToLowerInvariant();
        return s switch
        {
            "online" or "connected" or "completed" or "complete" or "sent" => SeverityLevel.Success,
            "charging" or "reconnecting" or "tapering" or "retrying" or "paused" or "stale" => SeverityLevel.Warn,
            "offline" or "failed" or "disconnected" or "error" or "cancelled" => SeverityLevel.Critical,
            "" or "unknown" or "asleep" or "driving" or "idle" or "connecting" or "pending" => SeverityLevel.Info,
            _ => Heuristic(s),
        };
    }

    private static SeverityLevel Heuristic(string s)
    {
        if (s.Contains("error", StringComparison.Ordinal) || s.Contains("fail", StringComparison.Ordinal)
            || s.Contains("offline", StringComparison.Ordinal) || s.Contains("disconnect", StringComparison.Ordinal))
        {
            return SeverityLevel.Critical;
        }

        if (s.Contains("warn", StringComparison.Ordinal) || s.Contains("stale", StringComparison.Ordinal)
            || s.Contains("reconnect", StringComparison.Ordinal) || s.Contains("pending", StringComparison.Ordinal))
        {
            return SeverityLevel.Warn;
        }

        if (s.Contains("online", StringComparison.Ordinal) || s.Contains("connect", StringComparison.Ordinal)
            || s.Contains("complete", StringComparison.Ordinal) || s.Contains("success", StringComparison.Ordinal)
            || s.Contains("active", StringComparison.Ordinal) || s.Contains("ready", StringComparison.Ordinal))
        {
            return SeverityLevel.Success;
        }

        return SeverityLevel.Info;
    }

    private static void WriteRawOrNull(Utf8JsonWriter writer, string? rawJson)
    {
        if (string.IsNullOrWhiteSpace(rawJson))
        {
            writer.WriteNullValue();
            return;
        }

        try
        {
            using var doc = JsonDocument.Parse(rawJson);
            doc.RootElement.WriteTo(writer);
        }
        catch (JsonException)
        {
            writer.WriteStringValue(rawJson);
        }
    }
}

/// <summary>
/// The fully-resolved, render-ready model the parent assigns to the <c>SnapshotInspector</c> view. Carries
/// the resolved <see cref="State"/> plus every datum a branch needs, so the view is a pure renderer with no
/// branch logic of its own. Build the web-faithful branches with <see cref="Create"/>; the parent state
/// holder layers the explicit <see cref="SnapshotInspectorState.Error"/> / <c>Stale</c> / <c>Offline</c>
/// branches with <see cref="ToError"/> / <see cref="ToStale"/> / <see cref="ToOffline"/>.
/// </summary>
public sealed record SnapshotInspectorModel
{
    private SnapshotInspectorModel(SnapshotInspectorState state)
    {
        State = state;
        Rows = Array.Empty<SnapshotInspectorRow>();
    }

    /// <summary>The resolved lifecycle state to render.</summary>
    public SnapshotInspectorState State { get; private init; }

    /// <summary>The FSM type whose state palette colours the from / to badges.</summary>
    public string FsmType { get; private init; } = string.Empty;

    /// <summary>The selected transition (null in the no-transition branches).</summary>
    public SnapshotTransition? Transition { get; private init; }

    /// <summary>The projected, diff-annotated signal rows (empty unless Populated / Stale / Offline).</summary>
    public IReadOnlyList<SnapshotInspectorRow> Rows { get; private init; }

    /// <summary>The "Copy snapshot" clipboard payload (empty when there is nothing to copy).</summary>
    public string CopyPayload { get; private init; } = string.Empty;

    /// <summary>Relative age of the last transition, for the <c>OutsideWindow</c> message interpolation.</summary>
    public string LastTransitionRelative { get; private init; } = string.Empty;

    /// <summary>The last-update timestamp surfaced on the stale / offline freshness chip.</summary>
    public DateTimeOffset? UpdatedAt { get; private init; }

    /// <summary>The error message shown in the <c>Error</c> branch.</summary>
    public string? ErrorMessage { get; private init; }

    /// <summary>The load-attempt count surfaced by the <c>Error</c> branch's retry affordance.</summary>
    public int Attempts { get; private init; }

    /// <summary>The "no transition selected, fetch in flight" loading model.</summary>
    public static SnapshotInspectorModel Loading() => new(SnapshotInspectorState.Loading);

    /// <summary>The "no transition selected — pick one" empty model.</summary>
    public static SnapshotInspectorModel EmptyState() => new(SnapshotInspectorState.Empty);

    /// <summary>The "nothing selectable in the window, jump to the last transition" model.</summary>
    public static SnapshotInspectorModel OutsideWindow(string lastTransitionRelative) =>
        new(SnapshotInspectorState.OutsideWindow) { LastTransitionRelative = lastTransitionRelative ?? string.Empty };

    /// <summary>
    /// The web-faithful branch resolver — the native port of the component's render conditionals. With no
    /// <paramref name="transition"/> it resolves <see cref="SnapshotInspectorState.Loading"/> /
    /// <c>OutsideWindow</c> / <c>Empty</c>; with one it projects the rows and resolves <c>NoSignals</c> /
    /// <c>Populated</c>.
    /// </summary>
    /// <param name="fsmType">The FSM type whose palette colours the state badges.</param>
    /// <param name="transition">The selected transition, or null.</param>
    /// <param name="snapshot">The snapshot at the transition timestamp.</param>
    /// <param name="previousSnapshot">The previous transition's snapshot (for the diff toggle).</param>
    /// <param name="loading">Whether a fetch is in flight (only consulted with no transition).</param>
    /// <param name="hasLastTransition">Whether a most-recent transition exists outside the window.</param>
    /// <param name="inWindowCount">The number of selectable transitions inside the active window.</param>
    /// <param name="canJumpToLast">Whether the host wired a jump-to-last affordance.</param>
    /// <param name="lastTransitionRelative">The relative age string for the <c>OutsideWindow</c> message.</param>
    public static SnapshotInspectorModel Create(
        string fsmType,
        SnapshotTransition? transition,
        SignalSnapshot? snapshot,
        SignalSnapshot? previousSnapshot,
        bool loading,
        bool hasLastTransition,
        int inWindowCount,
        bool canJumpToLast,
        string lastTransitionRelative)
    {
        string type = fsmType ?? string.Empty;

        if (transition is null)
        {
            if (loading)
            {
                return Loading();
            }

            if (inWindowCount == 0 && hasLastTransition && canJumpToLast)
            {
                return OutsideWindow(lastTransitionRelative);
            }

            return EmptyState();
        }

        var rows = SnapshotInspectorProjection.ProjectRows(snapshot, previousSnapshot);
        string copyPayload = SnapshotInspectorProjection.BuildCopyPayload(transition, snapshot);

        return new SnapshotInspectorModel(rows.Count == 0 ? SnapshotInspectorState.NoSignals : SnapshotInspectorState.Populated)
        {
            FsmType = type,
            Transition = transition,
            Rows = rows,
            CopyPayload = copyPayload,
        };
    }

    /// <summary>The retriable error model the parent drives when the snapshot fetch fails outright.</summary>
    public static SnapshotInspectorModel ErrorState(string? message, int attempts = 0) =>
        new(SnapshotInspectorState.Error) { ErrorMessage = message, Attempts = Math.Max(0, attempts) };

    /// <summary>Re-tag a populated model as stale, attaching the freshness <paramref name="updatedAt"/> chip.</summary>
    public SnapshotInspectorModel ToStale(DateTimeOffset? updatedAt) =>
        this with { State = SnapshotInspectorState.Stale, UpdatedAt = updatedAt };

    /// <summary>Re-tag a populated model as offline, attaching the freshness <paramref name="updatedAt"/> chip.</summary>
    public SnapshotInspectorModel ToOffline(DateTimeOffset? updatedAt) =>
        this with { State = SnapshotInspectorState.Offline, UpdatedAt = updatedAt };

    /// <summary>Re-tag a model as an outright error (preserving any context), with a retry affordance.</summary>
    public SnapshotInspectorModel ToError(string? message, int attempts = 0) =>
        this with { State = SnapshotInspectorState.Error, ErrorMessage = message, Attempts = Math.Max(0, attempts) };
}

/// <summary>
/// The localized strings the Snapshot Inspector surface renders, each resolved through the i18n facade with
/// the web component's English fallback (so the resource keys are asserted in tests and resolved for real in
/// the app). Mirrors every <c>t()</c> call in
/// web/src/features/system/components/state-machine/SnapshotInspector.tsx plus the keys the native
/// error / stale / offline superset needs. WinUI-free.
/// </summary>
public sealed class SnapshotInspectorText
{
    private readonly ILocalizer _localizer;

    /// <summary>Creates the text facade over an <see cref="ILocalizer"/>.</summary>
    public SnapshotInspectorText(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
    }

    /// <summary>"Transition snapshot" — the panel title.</summary>
    public string Title => _localizer.GetString("debugger.inspector.title", "Transition snapshot");

    /// <summary>"Loading…" — the no-transition loading chrome.</summary>
    public string Loading => _localizer.GetString("debugger.inspector.loading", "Loading\u2026");

    /// <summary>"Select a transition to inspect its snapshot" — the empty prompt.</summary>
    public string Empty => _localizer.GetString("debugger.inspector.empty", "Select a transition to inspect its snapshot");

    /// <summary>"Jump to last transition" — the outside-window affordance.</summary>
    public string JumpToLast => _localizer.GetString("debugger.inspector.jumpToLast", "Jump to last transition");

    /// <summary>"From" — the from-state caption.</summary>
    public string From => _localizer.GetString("debugger.inspector.from", "From");

    /// <summary>"To" — the to-state caption.</summary>
    public string To => _localizer.GetString("debugger.inspector.to", "To");

    /// <summary>"Trigger" — the trigger caption.</summary>
    public string Trigger => _localizer.GetString("debugger.inspector.trigger", "Trigger");

    /// <summary>"Duration" — the duration caption.</summary>
    public string Duration => _localizer.GetString("debugger.inspector.duration", "Duration");

    /// <summary>"Signals at transition" — the signal-list section title.</summary>
    public string SignalsTitle => _localizer.GetString("debugger.inspector.signalsTitle", "Signals at transition");

    /// <summary>"Diff vs previous" — the diff-mode toggle label.</summary>
    public string DiffMode => _localizer.GetString("debugger.inspector.diffMode", "Diff vs previous");

    /// <summary>"No signals captured for this transition" — the empty-snapshot note.</summary>
    public string NoSignals => _localizer.GetString("debugger.inspector.noSignals", "No signals captured for this transition");

    /// <summary>"Copy snapshot" — the copy-button idle label.</summary>
    public string Copy => _localizer.GetString("debugger.inspector.copy", "Copy snapshot");

    /// <summary>"Copied" — the copy-button confirmation label.</summary>
    public string Copied => _localizer.GetString("debugger.inspector.copied", "Copied");

    /// <summary>The retriable-error message (native superset state).</summary>
    public string Error => _localizer.GetString("debugger.inspector.error", "Couldn't load the transition snapshot");

    /// <summary>"Retry" — the error retry affordance (native superset state).</summary>
    public string Retry => _localizer.GetString("debugger.inspector.retry", "Retry");

    /// <summary>"Stale" — the stale freshness chip (native superset state).</summary>
    public string Stale => _localizer.GetString("debugger.inspector.stale", "Stale");

    /// <summary>"Offline" — the offline freshness chip (native superset state).</summary>
    public string Offline => _localizer.GetString("debugger.inspector.offline", "Offline");

    /// <summary>
    /// "Nothing in the current window. Last transition {rel}." — the outside-window message with the relative
    /// age interpolated in place of the web i18next <c>{{rel}}</c> interpolation token.
    /// </summary>
    public string OutsideWindow(string relative) =>
        _localizer
            .GetString("debugger.inspector.emptyOutsideWindow", "Nothing in the current window. Last transition {{rel}}.")
            .Replace("{{rel}}", relative ?? string.Empty, StringComparison.Ordinal);
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Snapshot Inspector parse. Every getter returns a
/// nullable / fallback rather than throwing so a partial or schema-drifted transition / snapshot never aborts
/// the parse. Free of WinUI types so the parse is unit-tested without a UI host.
/// </summary>
internal static class SnapshotJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The <see cref="long"/> value of <paramref name="name"/>, or 0 when absent / not an integer.</summary>
    public static long GetInt64(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.Number
        && prop.TryGetInt64(out var value)
            ? value
            : 0L;

    /// <summary>The <see cref="double"/> value of <paramref name="name"/>, or null when absent / not a number.</summary>
    public static double? GetNumber(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.Number
        && prop.TryGetDouble(out var value)
            ? value
            : null;

    /// <summary>The number at <paramref name="container"/>.<paramref name="name"/>, or null when absent.</summary>
    public static double? GetDetailNumber(JsonElement obj, string container, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object
            && obj.TryGetProperty(container, out var details)
            && details.ValueKind == JsonValueKind.Object)
        {
            return GetNumber(details, name);
        }

        return null;
    }

    /// <summary>Parse an ISO-8601 timestamp to a UTC-normalised instant, or null when unparseable.</summary>
    public static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// Canonical registry metadata for the Snapshot Inspector surface. Centralises the stable id and the
/// diagnostics slug so the view and model stay free of literal identifiers.
/// </summary>
public static class SnapshotInspectorRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "snapshot-inspector";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "SnapshotInspector";
}

/// <summary>
/// PII-safe diagnostics for the Snapshot Inspector surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a signal name, value, state or vehicle
/// id — so a diagnostics line can never leak which vehicle or telemetry value was inspected. Thread-safe.
/// </summary>
public sealed class SnapshotInspectorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SnapshotInspectorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SnapshotInspector</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SnapshotInspectorRegistration.Slug}");
    }
}
