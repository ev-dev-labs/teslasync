using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.FeatureFlags;

/// <summary>
/// The mutually-exclusive render branch of the <c>ChangesPanel</c> surface — the native union of the
/// branches the web component renders
/// (web/src/features/admin/components/feature-flags/ChangesPanel.tsx). The web source is a pure
/// presentational component (it takes <c>rows</c>, <c>loading</c> and <c>scopedKey</c> as props and performs
/// no fetching), so the branches are a direct function of the input <see cref="ChangesPanelModel"/>; there is
/// no fetch-driven error / stale / offline branch to reproduce. Every branch maps onto a visible surface —
/// none is ever hidden.
/// </summary>
public enum ChangesPanelState
{
    /// <summary>
    /// The audit log is still loading and no rows are available yet (web <c>loading &amp;&amp; rows == 0</c>)
    /// — the table renders its "Loading audit log…" empty message.
    /// </summary>
    Loading,

    /// <summary>
    /// The audit log resolved with no rows (web <c>!loading &amp;&amp; rows.length === 0</c>) — a friendly
    /// empty state with the scoped or global guidance message.
    /// </summary>
    Empty,

    /// <summary>The audit log produced rows (web fall-through, <c>rows.length &gt; 0</c>) — the table.</summary>
    Data,
}

/// <summary>
/// One inbound flag-change row — the native mirror of the web <c>FeatureFlagChange</c> shape
/// (web/src/types/admin-diagnostics.ts), reduced to the fields the panel renders. <see cref="Id"/> is the
/// stable key the table keys on; <see cref="OldValueJson"/> / <see cref="NewValueJson"/> carry the already
/// <c>JSON.stringify</c>-ed value (or <c>null</c> when the source value was null/absent) so the projection can
/// reproduce the web <c>compact()</c> truncation. Pure data — no WinUI types.
/// </summary>
public sealed record FeatureFlagChangeRow(
    string Id,
    string? ChangedAt,
    string? Actor,
    string FlagKey,
    string Operation,
    string? OldValueJson,
    string? NewValueJson,
    string? Reason);

/// <summary>
/// The render-time data model the <c>ChangesPanel</c> view binds to — the native analogue of the web
/// <c>ChangesPanelProps</c>. The component is presentational: this model carries the <see cref="Rows"/>, the
/// <see cref="Loading"/> flag and the optional <see cref="ScopedKey"/> (the flag key the surface is scoped to,
/// which selects the scoped vs. global empty message). User-facing labels are resolved from the i18n facade by
/// the projection, not passed in. Pure data — no WinUI types — so the projection is unit-tested without a UI
/// host.
/// </summary>
public sealed record ChangesPanelModel(
    IReadOnlyList<FeatureFlagChangeRow> Rows,
    bool Loading,
    string? ScopedKey)
{
    /// <summary>The initial empty model — resolved with no rows and no active scope.</summary>
    public static ChangesPanelModel Empty { get; } =
        new(Array.Empty<FeatureFlagChangeRow>(), false, null);
}

/// <summary>
/// A declarative table column descriptor (key + localized header) — the native, WinUI-free analogue of the web
/// <c>Column&lt;FeatureFlagChange&gt;</c> the panel declares. The view maps each one onto a <c>TsDataColumn</c>;
/// rows address their cells by the same <see cref="Key"/>.
/// </summary>
public sealed record ChangesPanelColumn(string Key, string Header);

/// <summary>
/// A single projected, display-ready table row — the cell values keyed by column key, the stable
/// <see cref="RowKey"/>, the semantic <see cref="OperationStatus"/> the web renders the operation
/// <c>Badge</c> with (preserved here even though the shared <c>TsDataTable</c> renders the operation as text),
/// and a Narrator automation name. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ChangesPanelRow(
    string RowKey,
    IReadOnlyDictionary<string, string> Cells,
    StatusKind OperationStatus,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the panel for one input model — the native analogue of the branch
/// the web <c>ChangesPanel</c> returns. Holds the resolved empty/loading labels, the active <see cref="State"/>,
/// and the table columns + rows. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record ChangesPanelDisplay(
    ChangesPanelState State,
    string EmptyTitle,
    string EmptyMessage,
    string LoadingMessage,
    IReadOnlyList<ChangesPanelColumn> Columns,
    IReadOnlyList<ChangesPanelRow> Rows,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="ChangesPanelModel"/> to its <see cref="ChangesPanelDisplay"/> — the native
/// port of the branch selection in web/src/features/admin/components/feature-flags/ChangesPanel.tsx. The branch
/// precedence mirrors the web source exactly: a non-empty row set renders the table (data); an empty set renders
/// the table's "Loading audit log…" message while loading, otherwise the friendly empty state. The empty message
/// reproduces the web <c>scopedKey ? scopedMessage : globalMessage</c> choice, the value columns reproduce the
/// web <c>compact()</c> truncation, the operation column reproduces the web <c>OP_VARIANT</c> mapping, and
/// timestamps render through <see cref="DateTimeFormatting"/> (so <c>now</c> is injected for determinism). Every
/// label resolves through the i18n facade using the same keys the web source feeds into <c>t()</c>. No WinUI
/// types — unit-tested without a UI host.
/// </summary>
public static class ChangesPanelProjection
{
    /// <summary>Column key for the change timestamp column (web <c>key: 'changed_at'</c>).</summary>
    public const string ChangedAtKey = "changed_at";

    /// <summary>Column key for the actor column (web <c>key: 'actor'</c>).</summary>
    public const string ActorKey = "actor";

    /// <summary>Column key for the flag-key column (web <c>key: 'flag_key'</c>).</summary>
    public const string FlagKeyKey = "flag_key";

    /// <summary>Column key for the operation column (web <c>key: 'operation'</c>).</summary>
    public const string OperationKey = "operation";

    /// <summary>Column key for the old-value column (web <c>key: 'old_value'</c>).</summary>
    public const string OldValueKey = "old_value";

    /// <summary>Column key for the new-value column (web <c>key: 'new_value'</c>).</summary>
    public const string NewValueKey = "new_value";

    /// <summary>Column key for the reason column (web <c>key: 'reason'</c>).</summary>
    public const string ReasonKey = "reason";

    /// <summary>Page size for the data table (web <c>pagination.defaultPageSize</c>).</summary>
    public const int PageSize = 25;

    private const string EmDash = "\u2014";
    private const string Ellipsis = "\u2026";
    private const string SetOperation = "set";
    private const string DeleteOperation = "delete";

    // Web compact(): JSON.stringify, then `s.length > 60 ? s.slice(0, 57) + '…'`.
    private const int MaxValueLength = 60;
    private const int TruncatedLength = 57;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for timestamp formatting.</param>
    public static ChangesPanelDisplay Project(
        ChangesPanelModel model,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string emptyTitle = localizer.GetString("admin.flags.audit.empty.title", "No flag changes yet");
        string loadingMessage = localizer.GetString("admin.flags.audit.loading", "Loading audit log\u2026");
        string emptyMessage = BuildEmptyMessage(model.ScopedKey, localizer);

        IReadOnlyList<ChangesPanelColumn> columns = BuildColumns(localizer);
        IReadOnlyList<ChangesPanelRow> rows = BuildRows(model.Rows, now);
        ChangesPanelState state = SelectState(model);

        return new ChangesPanelDisplay(
            State: state,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            LoadingMessage: loadingMessage,
            Columns: columns,
            Rows: rows,
            AutomationName: BuildAutomationName(state, emptyTitle, emptyMessage, loadingMessage, rows.Count));
    }

    /// <summary>
    /// Branch selection from the web source: a non-empty row set is the data table; an empty set is the
    /// loading message while <c>loading</c>, otherwise the friendly empty state.
    /// </summary>
    private static ChangesPanelState SelectState(ChangesPanelModel model)
    {
        if (model.Rows.Count > 0)
        {
            return ChangesPanelState.Data;
        }

        return model.Loading ? ChangesPanelState.Loading : ChangesPanelState.Empty;
    }

    // Web parity: `scopedKey ? t('…scopedMessage', { key }) : t('…globalMessage')`. An empty scope is falsy.
    private static string BuildEmptyMessage(string? scopedKey, ILocalizer localizer)
    {
        if (string.IsNullOrEmpty(scopedKey))
        {
            return localizer.GetString(
                "admin.flags.audit.empty.globalMessage",
                "Flag changes will appear here once an operator edits a value.");
        }

        string template = localizer.GetString(
            "admin.flags.audit.empty.scopedMessage",
            "No audit rows for \"{0}\" \u2014 edit the value above to start the trail.");
        return string.Format(CultureInfo.CurrentCulture, template, scopedKey);
    }

    private static IReadOnlyList<ChangesPanelColumn> BuildColumns(ILocalizer localizer) =>
    [
        new ChangesPanelColumn(ChangedAtKey, localizer.GetString("admin.flags.audit.cols.changedAt", "Changed at")),
        new ChangesPanelColumn(ActorKey, localizer.GetString("admin.flags.audit.cols.actor", "Actor")),
        new ChangesPanelColumn(FlagKeyKey, localizer.GetString("admin.flags.audit.cols.flagKey", "Key")),
        new ChangesPanelColumn(OperationKey, localizer.GetString("admin.flags.audit.cols.operation", "Op")),
        new ChangesPanelColumn(OldValueKey, localizer.GetString("admin.flags.audit.cols.oldValue", "Old")),
        new ChangesPanelColumn(NewValueKey, localizer.GetString("admin.flags.audit.cols.newValue", "New")),
        new ChangesPanelColumn(ReasonKey, localizer.GetString("admin.flags.audit.cols.reason", "Reason")),
    ];

    private static IReadOnlyList<ChangesPanelRow> BuildRows(
        IReadOnlyList<FeatureFlagChangeRow> rows,
        DateTimeOffset now)
    {
        if (rows.Count == 0)
        {
            return Array.Empty<ChangesPanelRow>();
        }

        var projected = new List<ChangesPanelRow>(rows.Count);
        foreach (var row in rows)
        {
            string changedAt = FormatChangedAt(row.ChangedAt, now);
            string actor = string.IsNullOrEmpty(row.Actor) ? EmDash : row.Actor;
            string flagKey = row.FlagKey; // Web renders row.flag_key verbatim (no fallback).
            string operation = row.Operation;
            string oldValue = Compact(row.OldValueJson);
            string newValue = Compact(row.NewValueJson);
            string reason = string.IsNullOrEmpty(row.Reason) ? EmDash : row.Reason;

            var cells = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [ChangedAtKey] = changedAt,
                [ActorKey] = actor,
                [FlagKeyKey] = flagKey,
                [OperationKey] = operation,
                [OldValueKey] = oldValue,
                [NewValueKey] = newValue,
                [ReasonKey] = reason,
            };

            projected.Add(new ChangesPanelRow(
                RowKey: row.Id,
                Cells: cells,
                OperationStatus: OperationStatusFor(operation),
                AutomationName: BuildRowAutomationName(changedAt, flagKey, operation, actor, oldValue, newValue, reason)));
        }

        return projected;
    }

    // Web parity for the operation Badge: OP_VARIANT[op] (set→success, delete→danger) ?? neutral.
    private static StatusKind OperationStatusFor(string operation) => operation switch
    {
        SetOperation => StatusKind.Success,
        DeleteOperation => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    // Web parity for the changed_at column: <TimeStamp value format="absolute" /> → the locale-aware
    // absolute datetime, with the universal em-dash fallback for null / unparseable timestamps.
    private static string FormatChangedAt(string? raw, DateTimeOffset now)
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

    // Web compact(): `value == null` → '—'; otherwise JSON.stringify and, when longer than 60 chars,
    // slice(0, 57) + '…'. The model already carries the stringified value (or null for a null/absent value).
    internal static string Compact(string? json)
    {
        if (string.IsNullOrEmpty(json))
        {
            return EmDash;
        }

        return json.Length > MaxValueLength
            ? string.Concat(json.AsSpan(0, TruncatedLength), Ellipsis)
            : json;
    }

    private static string BuildRowAutomationName(
        string changedAt,
        string flagKey,
        string operation,
        string actor,
        string oldValue,
        string newValue,
        string reason) =>
        $"{changedAt}. {flagKey}. {operation}. {actor}. {oldValue} {newValue}. {reason}";

    private static string BuildAutomationName(
        ChangesPanelState state,
        string emptyTitle,
        string emptyMessage,
        string loadingMessage,
        int rowCount) => state switch
        {
            ChangesPanelState.Empty => $"{emptyTitle}. {emptyMessage}",
            ChangesPanelState.Loading => loadingMessage,
            _ => string.Create(CultureInfo.InvariantCulture, $"{emptyTitle}. {rowCount}"),
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>ChangesPanel</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an actor, flag key, value or reason — so a
/// diagnostics line can never leak which operator or flag was involved. Thread-safe.
/// </summary>
public sealed class ChangesPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChangesPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChangesPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChangesPanelRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>ChangesPanel</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/admin/components/feature-flags/ChangesPanel.tsx</c>.
/// </summary>
public static class ChangesPanelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChangesPanel";
}
