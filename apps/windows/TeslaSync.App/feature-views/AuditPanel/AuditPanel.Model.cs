using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.DlqInspector;

/// <summary>
/// The mutually-exclusive render branch of the <c>AuditPanel</c> surface — the native union of the branches
/// the web component renders (web/src/features/admin/components/dlq-inspector/AuditPanel.tsx). The web source
/// is a pure presentational component: it takes <c>rows</c>, <c>loading</c> and <c>scopedDlqId</c> as props and
/// performs no fetching, so the branch is a direct function of the input <see cref="AuditPanelModel"/> and there
/// is no fetch-driven error / stale / offline branch to reproduce (the parent owns those, exactly as react
/// re-renders the component with already-resolved props). Every branch maps onto a visible surface — none is
/// ever hidden.
/// </summary>
public enum AuditPanelState
{
    /// <summary>
    /// The feed is still loading and no rows have arrived yet (web <c>loading &amp;&amp; rows.length === 0</c>):
    /// the audit table renders with the "Loading audit log…" empty message.
    /// </summary>
    Loading,

    /// <summary>
    /// The feed resolved with no rows (web <c>!loading &amp;&amp; rows.length === 0</c>): the friendly
    /// <c>EmptyState</c> with the scoped or global "No replay attempts yet" copy, never a blank box.
    /// </summary>
    Empty,

    /// <summary>The feed produced rows (web <c>rows.length &gt; 0</c>): the audit table with the rows.</summary>
    Data,
}

/// <summary>
/// One replay-audit record — the native mirror of the fields the web <c>AuditPanel</c> reads off a
/// <c>DLQReplayAuditRecord</c> (web/src/types/admin-diagnostics.ts). <see cref="Id"/> is the stable key the table
/// keys on (web <c>keyExtractor={(row) =&gt; row.id}</c>); the remaining fields are the raw observable wire values
/// (snake_case on the wire), formatted for display by <see cref="AuditPanelProjection"/>. Pure data — no WinUI
/// types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">Stable audit-row id (web <c>row.id</c>) — the table key.</param>
/// <param name="ReplayedAt">Raw ISO-8601 replay timestamp (web <c>row.replayed_at</c>); the projection formats it absolutely.</param>
/// <param name="Actor">The operator who triggered the replay (web <c>row.actor</c>).</param>
/// <param name="DlqId">The DLQ entry id that was replayed (web <c>row.dlq_id</c>).</param>
/// <param name="Result">Raw replay-result code (web <c>row.result</c>); drives the status tint via <see cref="DlqReplayResultVariant"/>.</param>
/// <param name="DstTopic">The destination topic the entry was replayed to (web <c>row.dst_topic</c>).</param>
/// <param name="Error">The replay error, when one occurred (web <c>row.error</c>).</param>
/// <param name="TraceId">The replay trace id (web <c>row.trace_id</c>).</param>
public sealed record AuditRecord(
    long Id,
    string ReplayedAt,
    string Actor,
    long DlqId,
    string Result,
    string DstTopic,
    string Error,
    string TraceId);

/// <summary>
/// The render-time data model the <c>AuditPanel</c> view binds to — the native analogue of the web
/// <c>AuditPanelProps</c> (<c>{ rows, loading, scopedDlqId }</c> in
/// web/src/features/admin/components/dlq-inspector/AuditPanel.tsx). The component is presentational, so this model
/// carries the audit <see cref="Rows"/>, the in-flight <see cref="Loading"/> flag, and the optional
/// <see cref="ScopedDlqId"/> that selects the scoped vs. global empty copy. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="Rows">The replay-audit rows (web <c>rows</c>).</param>
/// <param name="Loading">Whether the audit feed is still loading (web <c>loading</c>).</param>
/// <param name="ScopedDlqId">The DLQ id this panel is scoped to, or <see langword="null"/> for the global feed (web <c>scopedDlqId</c>).</param>
public sealed record AuditPanelModel(
    IReadOnlyList<AuditRecord> Rows,
    bool Loading,
    long? ScopedDlqId)
{
    /// <summary>The initial model — a resolved, global, empty feed.</summary>
    public static AuditPanelModel Empty { get; } = new(Array.Empty<AuditRecord>(), false, null);
}

/// <summary>
/// Maps a replay-result code to its semantic status tint — the native port of the web <c>RESULT_VARIANT</c> record
/// (plus its <c>?? 'neutral'</c> fallback) in
/// web/src/features/admin/components/dlq-inspector/AuditPanel.tsx. Unknown codes fall back to
/// <see cref="StatusKind.Neutral"/> exactly as the web lookup does. UI-free so the mapping is unit-tested without a
/// XAML runtime.
/// </summary>
public static class DlqReplayResultVariant
{
    /// <summary>Replay published successfully (web <c>ok → success</c>).</summary>
    public const string Ok = "ok";

    /// <summary>MQTT publish errored (web <c>publish_failed → danger</c>).</summary>
    public const string PublishFailed = "publish_failed";

    /// <summary>Replay rejected by the per-actor rate limit (web <c>rate_limited → warning</c>).</summary>
    public const string RateLimited = "rate_limited";

    /// <summary>Replay disabled at server boot (web <c>disabled → warning</c>).</summary>
    public const string Disabled = "disabled";

    /// <summary>Entry id no longer exists (web <c>not_found → neutral</c>).</summary>
    public const string NotFound = "not_found";

    /// <summary>DLQ row was missing its source topic / unparseable (web <c>unparseable → danger</c>).</summary>
    public const string Unparseable = "unparseable";

    /// <summary>Resolve a replay-result code to its badge status, defaulting to neutral for unknown codes.</summary>
    public static StatusKind For(string? result) => result switch
    {
        Ok => StatusKind.Success,
        PublishFailed => StatusKind.Danger,
        RateLimited => StatusKind.Warning,
        Disabled => StatusKind.Warning,
        NotFound => StatusKind.Neutral,
        Unparseable => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };
}

/// <summary>
/// A declarative table column descriptor (key + localized header) — the native, WinUI-free analogue of the web
/// <c>Column&lt;DLQReplayAuditRecord&gt;</c> the panel passes into its <c>DataTable</c>. The view maps each one onto
/// a <c>TsDataColumn</c>; rows address their cells by the same <see cref="Key"/>.
/// </summary>
public sealed record AuditPanelColumn(string Key, string Header);

/// <summary>
/// A single projected, display-ready audit row — the cell values keyed by column key, the stable
/// <see cref="RowKey"/>, the semantic <see cref="ResultStatus"/> (the web <c>RESULT_VARIANT</c> tint), and a
/// Narrator automation name composed from the visible cells. Pure data so the projection is unit-tested without a
/// UI host.
/// </summary>
public sealed record AuditPanelRow(
    object RowKey,
    IReadOnlyDictionary<string, string> Cells,
    StatusKind ResultStatus,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the panel for one input model — the native analogue of the branch the
/// web <c>AuditPanel</c> returns. Holds the resolved empty/loading copy, the table's empty message, the active
/// <see cref="State"/>, the localized columns + rows, and the surface's accessible name. Pure data so every branch
/// is asserted headlessly.
/// </summary>
public sealed record AuditPanelDisplay(
    AuditPanelState State,
    string EmptyTitle,
    string EmptyMessage,
    string LoadingText,
    string TableEmptyMessage,
    IReadOnlyList<AuditPanelColumn> Columns,
    IReadOnlyList<AuditPanelRow> Rows,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="AuditPanelModel"/> to its <see cref="AuditPanelDisplay"/> — the native port of
/// the branch selection + column renderers in
/// web/src/features/admin/components/dlq-inspector/AuditPanel.tsx. The branch precedence mirrors the web source
/// exactly: <c>!loading &amp;&amp; rows.length === 0</c> renders the <c>EmptyState</c> (scoped or global copy),
/// otherwise the <c>DataTable</c> renders the rows with an empty message of
/// <c>loading ? 'Loading audit log…' : 'No replay attempts yet'</c>. Each column reproduces the web cell render —
/// the absolute timestamp (web <c>&lt;TimeStamp format="absolute" /&gt;</c>), the <c>x || '—'</c> em-dash fallbacks,
/// the numeric <c>dlq_id</c>, and the result code whose <c>RESULT_VARIANT</c> tint is captured on the row. Timestamps
/// render through <see cref="DateTimeFormatting"/> (so <c>now</c> is injected for determinism) and every label resolves
/// through the i18n facade using the catalog keys the web source feeds into <c>t()</c>. No WinUI types — unit-tested
/// without a UI host.
/// </summary>
public static class AuditPanelProjection
{
    /// <summary>Column key for the replay-timestamp column (web <c>key: 'replayed_at'</c>).</summary>
    public const string ReplayedAtKey = "replayed_at";

    /// <summary>Column key for the actor column (web <c>key: 'actor'</c>).</summary>
    public const string ActorKey = "actor";

    /// <summary>Column key for the DLQ-id column (web <c>key: 'dlq_id'</c>).</summary>
    public const string DlqIdKey = "dlq_id";

    /// <summary>Column key for the result column (web <c>key: 'result'</c>).</summary>
    public const string ResultKey = "result";

    /// <summary>Column key for the destination-topic column (web <c>key: 'dst_topic'</c>).</summary>
    public const string DstTopicKey = "dst_topic";

    /// <summary>Column key for the error column (web <c>key: 'error'</c>).</summary>
    public const string ErrorKey = "error";

    /// <summary>Column key for the trace-id column (web <c>key: 'trace_id'</c>).</summary>
    public const string TraceIdKey = "trace_id";

    /// <summary>Default table page size (web <c>pagination.defaultPageSize</c>).</summary>
    public const int PageSize = 25;

    // i18n catalog keys (P1/S10 — Strings/{lang}/Resources.resw, resolved via the '.'→'/' shell bridge).
    private const string EmptyTitleKey = "translation.admin.dlq.audit.empty.title";
    private const string EmptyScopedKey = "translation.admin.dlq.audit.empty.scopedMessage";
    private const string EmptyGlobalKey = "translation.admin.dlq.audit.empty.globalMessage";
    private const string LoadingKey = "translation.admin.dlq.audit.loading";
    private const string PanelLabelKey = "translation.admin.dlq.panels.audit";
    private const string ColReplayedAtKey = "translation.admin.dlq.audit.cols.replayedAt";
    private const string ColActorKey = "translation.admin.dlq.audit.cols.actor";
    private const string ColDlqIdKey = "translation.admin.dlq.audit.cols.dlqId";
    private const string ColResultKey = "translation.admin.dlq.audit.cols.result";
    private const string ColDstTopicKey = "translation.admin.dlq.audit.cols.dstTopic";
    private const string ColErrorKey = "translation.admin.dlq.audit.cols.error";
    private const string ColTraceIdKey = "translation.admin.dlq.audit.cols.traceId";

    private const string EmptyTitleFallback = "No replay attempts yet";
    private const string LoadingFallback = "Loading audit log\u2026";
    private const string PanelLabelFallback = "Recent replay activity";
    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for timestamp formatting.</param>
    public static AuditPanelDisplay Project(AuditPanelModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string emptyTitle = localizer.GetString(EmptyTitleKey, EmptyTitleFallback);

        // web: scopedDlqId ? scopedMessage : globalMessage
        string emptyMessage = model.ScopedDlqId is not null
            ? localizer.GetString(
                EmptyScopedKey,
                "This entry has not been replayed. Use the Replay action above to send it back to its source topic.")
            : localizer.GetString(
                EmptyGlobalKey,
                "Replay attempts will appear here once an operator triggers one.");

        string loadingText = localizer.GetString(LoadingKey, LoadingFallback);
        string panelLabel = localizer.GetString(PanelLabelKey, PanelLabelFallback);

        IReadOnlyList<AuditPanelColumn> columns = BuildColumns(localizer);
        IReadOnlyList<AuditPanelRow> rows = BuildRows(model.Rows, now);
        AuditPanelState state = SelectState(model);

        // web: emptyMessage={loading ? 'Loading audit log…' : 'No replay attempts yet'}
        string tableEmptyMessage = model.Loading ? loadingText : emptyTitle;

        return new AuditPanelDisplay(
            State: state,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            LoadingText: loadingText,
            TableEmptyMessage: tableEmptyMessage,
            Columns: columns,
            Rows: rows,
            AutomationName: BuildAutomationName(state, emptyTitle, emptyMessage, loadingText, panelLabel));
    }

    // Branch precedence from the web source: !loading && empty -> EmptyState; else the DataTable (rows, or the
    // "Loading audit log…" empty message while the feed is still in flight).
    private static AuditPanelState SelectState(AuditPanelModel model)
    {
        if (model.Rows.Count == 0)
        {
            return model.Loading ? AuditPanelState.Loading : AuditPanelState.Empty;
        }

        return AuditPanelState.Data;
    }

    private static IReadOnlyList<AuditPanelColumn> BuildColumns(ILocalizer localizer) =>
    [
        new(ReplayedAtKey, localizer.GetString(ColReplayedAtKey, "Replayed at")),
        new(ActorKey, localizer.GetString(ColActorKey, "Actor")),
        new(DlqIdKey, localizer.GetString(ColDlqIdKey, "DLQ ID")),
        new(ResultKey, localizer.GetString(ColResultKey, "Result")),
        new(DstTopicKey, localizer.GetString(ColDstTopicKey, "Destination")),
        new(ErrorKey, localizer.GetString(ColErrorKey, "Error")),
        new(TraceIdKey, localizer.GetString(ColTraceIdKey, "Trace ID")),
    ];

    private static IReadOnlyList<AuditPanelRow> BuildRows(IReadOnlyList<AuditRecord> records, DateTimeOffset now)
    {
        if (records.Count == 0)
        {
            return Array.Empty<AuditPanelRow>();
        }

        var rows = new List<AuditPanelRow>(records.Count);
        foreach (var record in records)
        {
            // web column renders: <TimeStamp format="absolute" />, actor || '—', {dlq_id}, {result},
            // dst_topic || '—', error || '—', trace_id || '—'.
            string replayedAt = FormatTimestamp(record.ReplayedAt, now);
            string actor = OrDash(record.Actor);
            string dlqId = record.DlqId.ToString(CultureInfo.InvariantCulture);
            string result = string.IsNullOrEmpty(record.Result) ? EmDash : record.Result;
            string dstTopic = OrDash(record.DstTopic);
            string error = OrDash(record.Error);
            string traceId = OrDash(record.TraceId);

            var cells = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [ReplayedAtKey] = replayedAt,
                [ActorKey] = actor,
                [DlqIdKey] = dlqId,
                [ResultKey] = result,
                [DstTopicKey] = dstTopic,
                [ErrorKey] = error,
                [TraceIdKey] = traceId,
            };

            rows.Add(new AuditPanelRow(
                RowKey: record.Id,
                Cells: cells,
                ResultStatus: DlqReplayResultVariant.For(record.Result),
                AutomationName: string.Join(". ", replayedAt, actor, dlqId, result, dstTopic, error, traceId)));
        }

        return rows;
    }

    // web `value || '—'`: empty / missing values render the universal em-dash.
    private static string OrDash(string? value) => string.IsNullOrEmpty(value) ? EmDash : value;

    // web `<TimeStamp value={replayed_at} format="absolute" />`: render the absolute date-time, or '—' when the
    // value is null / unparseable (the web TimeStamp's own fallback).
    private static string FormatTimestamp(string? raw, DateTimeOffset now)
    {
        if (TryParseTimestamp(raw, out var value))
        {
            return DateTimeFormatting.Format(value, DateTimeVariant.Full, now);
        }

        return EmDash;
    }

    private static bool TryParseTimestamp(string? raw, out DateTimeOffset value)
    {
        if (!string.IsNullOrWhiteSpace(raw) && DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out value))
        {
            return true;
        }

        value = default;
        return false;
    }

    private static string BuildAutomationName(
        AuditPanelState state,
        string emptyTitle,
        string emptyMessage,
        string loadingText,
        string panelLabel) => state switch
        {
            AuditPanelState.Loading => loadingText,
            AuditPanelState.Empty => $"{emptyTitle}. {emptyMessage}",
            _ => panelLabel,
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>AuditPanel</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an actor, DLQ id, trace id or error — so a
/// diagnostics line can never leak who replayed which entry. Thread-safe.
/// </summary>
public sealed class AuditPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AuditPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AuditPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AuditPanelRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>AuditPanel</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/admin/components/dlq-inspector/AuditPanel.tsx</c>.
/// </summary>
public static class AuditPanelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AuditPanel";
}
