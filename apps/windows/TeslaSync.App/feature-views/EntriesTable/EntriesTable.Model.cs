using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.DlqInspector;

/// <summary>
/// One dead-letter-queue summary row — the native mirror of the web <c>DLQEntrySummary</c> shape in
/// <c>web/src/types/admin-diagnostics.ts</c> (itself a mirror of the Go <c>DLQEntrySummary</c> DTO returned by
/// the DLQ list endpoint). The entries table consumes a subset of these fields; the full shape is reproduced
/// so the native record is a faithful contract mirror. Pure data — no WinUI types — so the projection that
/// consumes it is unit-tested without a UI host.
/// </summary>
/// <param name="Id">The DLQ row identity (web <c>id</c>); the table keys rows on this.</param>
/// <param name="ArrivedAt">The arrival timestamp as an ISO-8601 string (web <c>arrived_at</c>).</param>
/// <param name="ParsedReason">The parsed failure reason (web <c>parsed_reason</c>).</param>
/// <param name="Replayable">Whether the entry can be replayed to its source topic (web <c>replayable</c>).</param>
/// <param name="RawPayloadSize">The raw envelope size in bytes (web <c>raw_payload_size</c>).</param>
/// <param name="ParsedVin">The parsed VIN, when known (web <c>parsed_vin</c>).</param>
/// <param name="ParsedSourceTopic">The parsed MQTT source topic, when known (web <c>parsed_source_topic</c>).</param>
/// <param name="ParsedRedeliveries">The parsed redelivery count, when known (web <c>parsed_redeliveries</c>).</param>
/// <param name="DlqTopic">The dead-letter topic the row landed on (web <c>dlq_topic</c>).</param>
/// <param name="ParsedVehicleId">The parsed vehicle id, when known (web <c>parsed_vehicle_id</c>).</param>
/// <param name="ParsedTimestamp">The parsed inner-payload timestamp, when known (web <c>parsed_timestamp</c>).</param>
/// <param name="ParseError">The parse error, when the inner payload could not be decoded (web <c>parse_error</c>).</param>
/// <param name="InnerPayloadSize">The decoded inner-payload size in bytes (web <c>inner_payload_size</c>).</param>
public sealed record DlqEntrySummary(
    long Id,
    string ArrivedAt,
    string ParsedReason,
    bool Replayable,
    long RawPayloadSize,
    string? ParsedVin = null,
    string? ParsedSourceTopic = null,
    int? ParsedRedeliveries = null,
    string DlqTopic = "",
    long? ParsedVehicleId = null,
    string? ParsedTimestamp = null,
    string? ParseError = null,
    long InnerPayloadSize = 0);

/// <summary>
/// The render-time data model the <c>EntriesTable</c> surface binds to — the native analogue of the web
/// component's <c>rows</c> and <c>loading</c> props
/// (<c>web/src/features/admin/components/dlq-inspector/EntriesTable.tsx</c>). The web source is a pure
/// presentational component (it takes its data as props and performs no fetching), so the rendered branch is a
/// direct function of this model; the inspect action is delivered through the view's callback rather than this
/// model. Pure data — no WinUI types.
/// </summary>
/// <param name="Rows">The DLQ rows to render (web <c>rows</c>).</param>
/// <param name="Loading">Whether the parent is still loading (web <c>loading</c>); only changes the empty-state copy.</param>
public sealed record EntriesTableModel(IReadOnlyList<DlqEntrySummary> Rows, bool Loading)
{
    /// <summary>The initial empty, not-loading model.</summary>
    public static EntriesTableModel Empty { get; } = new(Array.Empty<DlqEntrySummary>(), false);
}

/// <summary>
/// The mutually-exclusive branch the <c>EntriesTable</c> surface renders. The web source is a pure
/// presentational component whose only fetch-lifecycle input is the <c>loading</c> flag, so there is no
/// fetch-driven error / stale / offline branch to reproduce here — those belong to the parent DLQ Inspector
/// page that owns the query. Every branch maps onto a visible surface; none is hidden.
/// </summary>
public enum EntriesTableState
{
    /// <summary>Rows are present (web <c>rows.length &gt; 0</c>) — the table renders the sorted, paged rows.</summary>
    Data,

    /// <summary>No rows yet and the parent is loading (web empty body with the "Loading…" message).</summary>
    Loading,

    /// <summary>No rows and not loading (web empty body with the "No DLQ entries…" message).</summary>
    Empty,
}

/// <summary>
/// How a column's cell is rendered — the native recipe replacing the web <c>render</c> callback per column.
/// The web table uses a <c>Badge</c> for the replayable column and a <c>Button</c> for the actions column, so
/// (unlike the text-only native <c>TsDataTable</c>) the view composes those from the shared
/// <c>TsBadge</c>/<c>TsButton</c> primitives keyed off this style.
/// </summary>
public enum EntriesCellStyle
{
    /// <summary>Absolute timestamp (web <c>TimeStamp format="absolute"</c>): sans, primary, left.</summary>
    Timestamp,

    /// <summary>Monospace reason: mono, primary, left (web <c>font-mono … text-[var(--text-primary)]</c>).</summary>
    ReasonMono,

    /// <summary>Monospace muted value (VIN / source topic): mono, muted, left.</summary>
    MutedMono,

    /// <summary>Right-aligned integer count (redeliveries): sans, primary, right.</summary>
    Count,

    /// <summary>Right-aligned muted byte size (payload): sans, muted, right.</summary>
    Size,

    /// <summary>A success/neutral chip rendering the replayable Yes/No (web <c>Badge</c>).</summary>
    ReplayableBadge,

    /// <summary>An inspect action button (web secondary <c>Button</c> calling <c>onInspect</c>).</summary>
    InspectAction,
}

/// <summary>
/// The column keys the table addresses cells by — verbatim copies of the web column <c>key</c> values so the
/// snake_case contract is reproduced exactly.
/// </summary>
public static class EntriesTableColumns
{
    /// <summary>Arrival timestamp column (web <c>arrived_at</c>).</summary>
    public const string ArrivedAtKey = "arrived_at";

    /// <summary>Parsed reason column (web <c>parsed_reason</c>).</summary>
    public const string ReasonKey = "parsed_reason";

    /// <summary>Parsed VIN column (web <c>parsed_vin</c>).</summary>
    public const string VinKey = "parsed_vin";

    /// <summary>Parsed source-topic column (web <c>parsed_source_topic</c>).</summary>
    public const string TopicKey = "parsed_source_topic";

    /// <summary>Parsed redelivery-count column (web <c>parsed_redeliveries</c>).</summary>
    public const string RedeliveriesKey = "parsed_redeliveries";

    /// <summary>Raw payload-size column (web <c>raw_payload_size</c>).</summary>
    public const string SizeKey = "raw_payload_size";

    /// <summary>Replayable column (web <c>replayable</c>).</summary>
    public const string ReplayableKey = "replayable";

    /// <summary>Inspect-action column (web <c>actions</c>).</summary>
    public const string ActionsKey = "actions";
}

/// <summary>
/// A declarative, WinUI-free column descriptor the view maps onto its header + cells — the native analogue of
/// the web <c>Column&lt;DLQEntrySummary&gt;</c>. <see cref="Sortable"/> mirrors the web <c>sortable</c> flag so
/// only the four web-sortable headers are interactive.
/// </summary>
/// <param name="Key">The row value-map key this column reads.</param>
/// <param name="Header">The localized header label.</param>
/// <param name="Sortable">Whether the header toggles sorting (web <c>sortable</c>).</param>
/// <param name="Style">How the cell is rendered.</param>
public sealed record EntriesTableColumn(string Key, string Header, bool Sortable, EntriesCellStyle Style);

/// <summary>
/// The active sort key + direction — the native analogue of the web <c>useSortToggle</c> state. The default is
/// <c>arrived_at</c> descending (web <c>useSortToggle('arrived_at', 'desc')</c>) and <see cref="Toggle"/>
/// reproduces the hook's behaviour exactly: re-selecting the active column flips ascending/descending, while
/// selecting a new column resets to descending.
/// </summary>
/// <param name="Key">The column key currently sorted.</param>
/// <param name="Ascending">True for ascending, false for descending.</param>
public sealed record EntriesTableSort(string Key, bool Ascending)
{
    /// <summary>The initial sort: arrived_at descending (newest first).</summary>
    public static EntriesTableSort Default { get; } = new(EntriesTableColumns.ArrivedAtKey, false);

    /// <summary>
    /// Apply a header click for <paramref name="key"/> using the web <c>useSortToggle</c> rule: the active
    /// column flips direction; any other column starts descending.
    /// </summary>
    public EntriesTableSort Toggle(string key)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        return key == Key ? this with { Ascending = !Ascending } : new EntriesTableSort(key, false);
    }
}

/// <summary>
/// One projected, render-ready row — the display strings keyed by column key, the replayable flag/label, the
/// source entry the inspect callback re-delivers, and Narrator names. Pure data so the projection is asserted
/// without a UI host.
/// </summary>
/// <param name="RowKey">The stable row identity (the DLQ <c>id</c>).</param>
/// <param name="Source">The originating entry, handed back to the inspect callback.</param>
/// <param name="Cells">Column-key → display text for the value/badge columns.</param>
/// <param name="Replayable">Whether the entry is replayable (drives the badge status).</param>
/// <param name="ReplayableText">The localized Yes/No shown in the replayable chip.</param>
/// <param name="InspectAutomationName">The Narrator name for this row's inspect button.</param>
/// <param name="AutomationName">The Narrator name for the row as a whole.</param>
public sealed record EntriesTableRowView(
    long RowKey,
    DlqEntrySummary Source,
    IReadOnlyDictionary<string, string> Cells,
    bool Replayable,
    string ReplayableText,
    string InspectAutomationName,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the table for one model + sort — the native analogue of what the
/// web <c>EntriesTable</c> hands to its <c>DataTable</c>. Holds the active <see cref="State"/>, the empty/loading
/// copy, the columns, the fully sorted rows (the view pages them), the resolved sort, the inspect label and the
/// surface Narrator name. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The active render branch.</param>
/// <param name="EmptyMessage">The message shown when there are no rows (loading vs. clean).</param>
/// <param name="Columns">The eight column descriptors, in web order.</param>
/// <param name="Rows">The fully sorted rows (the view applies pagination).</param>
/// <param name="Sort">The resolved sort key + direction.</param>
/// <param name="InspectLabel">The localized inspect-button label.</param>
/// <param name="AutomationName">The surface-level Narrator name.</param>
public sealed record EntriesTableDisplay(
    EntriesTableState State,
    string EmptyMessage,
    IReadOnlyList<EntriesTableColumn> Columns,
    IReadOnlyList<EntriesTableRowView> Rows,
    EntriesTableSort Sort,
    string InspectLabel,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="EntriesTableModel"/> + <see cref="EntriesTableSort"/> to its
/// <see cref="EntriesTableDisplay"/> — the native port of
/// <c>web/src/features/admin/components/dlq-inspector/EntriesTable.tsx</c>. Reproduces the web source's column
/// set + <c>sortable</c> flags, its semantic per-column comparisons (chronological arrived_at, locale reason /
/// VIN, numeric payload size), its cell formatting (<c>TimeStamp</c>, the <c>formatBytes</c> helper,
/// <c>fmtInt</c>, the em-dash fallbacks) and its loading-vs-empty copy. Every label resolves through the i18n
/// facade using the same keys the web <c>t()</c> calls use. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class EntriesTableProjection
{
    private const string EmDash = "\u2014";
    private const long BytesPerKib = 1024;
    private const long BytesPerMib = 1024 * 1024;

    /// <summary>Project <paramref name="model"/> + <paramref name="sort"/> into a render-ready display.</summary>
    /// <param name="model">The render-time data (the web props).</param>
    /// <param name="sort">The active sort key + direction.</param>
    /// <param name="now">The reference instant used for timestamp formatting.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static EntriesTableDisplay Project(
        EntriesTableModel model,
        EntriesTableSort sort,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(sort);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<DlqEntrySummary> source = model.Rows;
        EntriesTableState state = SelectState(model);

        string emptyMessage = model.Loading
            ? localizer.GetString("admin.dlq.table.loading", "Loading\u2026")
            : localizer.GetString("admin.dlq.table.empty", "No DLQ entries \u2014 the pipeline is clean.");

        string inspectLabel = localizer.GetString("admin.dlq.actions.inspect", "Inspect");
        string yes = localizer.GetString("common.yes", "Yes");
        string no = localizer.GetString("common.no", "No");

        IReadOnlyList<EntriesTableColumn> columns = BuildColumns(localizer);
        IReadOnlyList<EntriesTableRowView> rows = BuildRows(source, sort, now, inspectLabel, yes, no);

        string entriesLabel = localizer.GetString("admin.dlq.panels.entries", "Dead-letter entries");
        string automationName = state == EntriesTableState.Data
            ? string.Create(CultureInfo.InvariantCulture, $"{entriesLabel}. {rows.Count}")
            : string.Create(CultureInfo.InvariantCulture, $"{entriesLabel}. {emptyMessage}");

        return new EntriesTableDisplay(
            State: state,
            EmptyMessage: emptyMessage,
            Columns: columns,
            Rows: rows,
            Sort: sort,
            InspectLabel: inspectLabel,
            AutomationName: automationName);
    }

    // Web parity: the DataTable renders its rows whenever there are any; otherwise it shows the empty body whose
    // message is the loading copy while `loading` is true and the clean-pipeline copy once it settles.
    private static EntriesTableState SelectState(EntriesTableModel model) =>
        model.Rows.Count > 0
            ? EntriesTableState.Data
            : model.Loading ? EntriesTableState.Loading : EntriesTableState.Empty;

    private static IReadOnlyList<EntriesTableColumn> BuildColumns(ILocalizer localizer) =>
    [
        new(EntriesTableColumns.ArrivedAtKey, localizer.GetString("admin.dlq.cols.arrived", "Arrived"), true, EntriesCellStyle.Timestamp),
        new(EntriesTableColumns.ReasonKey, localizer.GetString("admin.dlq.cols.reason", "Reason"), true, EntriesCellStyle.ReasonMono),
        new(EntriesTableColumns.VinKey, localizer.GetString("admin.dlq.cols.vin", "VIN"), true, EntriesCellStyle.MutedMono),
        new(EntriesTableColumns.TopicKey, localizer.GetString("admin.dlq.cols.topic", "Source topic"), false, EntriesCellStyle.MutedMono),
        new(EntriesTableColumns.RedeliveriesKey, localizer.GetString("admin.dlq.cols.redeliveries", "Redel."), false, EntriesCellStyle.Count),
        new(EntriesTableColumns.SizeKey, localizer.GetString("admin.dlq.cols.size", "Payload"), true, EntriesCellStyle.Size),
        new(EntriesTableColumns.ReplayableKey, localizer.GetString("admin.dlq.cols.replayable", "Replayable"), false, EntriesCellStyle.ReplayableBadge),
        new(EntriesTableColumns.ActionsKey, localizer.GetString("admin.dlq.cols.actions", "Actions"), false, EntriesCellStyle.InspectAction),
    ];

    private static IReadOnlyList<EntriesTableRowView> BuildRows(
        IReadOnlyList<DlqEntrySummary> source,
        EntriesTableSort sort,
        DateTimeOffset now,
        string inspectLabel,
        string yes,
        string no)
    {
        if (source.Count == 0)
        {
            return Array.Empty<EntriesTableRowView>();
        }

        IReadOnlyList<DlqEntrySummary> sorted = SortRows(source, sort);
        var rows = new List<EntriesTableRowView>(sorted.Count);
        foreach (var entry in sorted)
        {
            string arrived = FormatArrived(entry.ArrivedAt, now);
            string reason = string.IsNullOrEmpty(entry.ParsedReason) ? EmDash : entry.ParsedReason;
            string vin = entry.ParsedVin ?? EmDash;
            string topic = entry.ParsedSourceTopic ?? EmDash;
            string redeliveries = entry.ParsedRedeliveries is { } count ? FormatInt(count) : EmDash;
            string size = FormatBytes(entry.RawPayloadSize);
            string replayableText = entry.Replayable ? yes : no;

            var cells = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [EntriesTableColumns.ArrivedAtKey] = arrived,
                [EntriesTableColumns.ReasonKey] = reason,
                [EntriesTableColumns.VinKey] = vin,
                [EntriesTableColumns.TopicKey] = topic,
                [EntriesTableColumns.RedeliveriesKey] = redeliveries,
                [EntriesTableColumns.SizeKey] = size,
                [EntriesTableColumns.ReplayableKey] = replayableText,
            };

            string rowName = string.Join(
                ". ",
                arrived,
                reason,
                vin,
                topic,
                redeliveries,
                size,
                replayableText);
            string inspectName = string.Create(CultureInfo.InvariantCulture, $"{inspectLabel}. {arrived}. {reason}");

            rows.Add(new EntriesTableRowView(
                RowKey: entry.Id,
                Source: entry,
                Cells: cells,
                Replayable: entry.Replayable,
                ReplayableText: replayableText,
                InspectAutomationName: inspectName,
                AutomationName: rowName));
        }

        return rows;
    }

    // Web parity for `[...rows].sort(...)`: a stable order honouring the active direction and the per-column
    // comparison the web switch uses. OrderBy is stable, matching modern Array.sort, so equal keys keep input
    // order; unsortable keys (the web `default: return 0`) leave the order untouched.
    private static IReadOnlyList<DlqEntrySummary> SortRows(IReadOnlyList<DlqEntrySummary> source, EntriesTableSort sort)
    {
        if (source.Count <= 1)
        {
            return source;
        }

        var comparer = Comparer<DlqEntrySummary>.Create((a, b) =>
        {
            int ascending = CompareAscending(a, b, sort.Key);
            return sort.Ascending ? ascending : -ascending;
        });

        return [.. source.OrderBy(static entry => entry, comparer)];
    }

    // The web reason/VIN comparisons use String.localeCompare; for the ASCII identifier domain of DLQ reason
    // codes and VINs an ordinal comparison yields the same ordering and is the repository's required policy.
    private static int CompareAscending(DlqEntrySummary a, DlqEntrySummary b, string key) => key switch
    {
        EntriesTableColumns.ArrivedAtKey =>
            ParseEpochMillis(a.ArrivedAt).CompareTo(ParseEpochMillis(b.ArrivedAt)),
        EntriesTableColumns.ReasonKey =>
            string.Compare(a.ParsedReason, b.ParsedReason, StringComparison.Ordinal),
        EntriesTableColumns.VinKey =>
            string.Compare(a.ParsedVin ?? string.Empty, b.ParsedVin ?? string.Empty, StringComparison.Ordinal),
        EntriesTableColumns.SizeKey =>
            a.RawPayloadSize.CompareTo(b.RawPayloadSize),
        _ => 0,
    };

    // Web `Date.parse(...)`: epoch milliseconds, NaN for unparseable. We use long.MinValue for unparseable so the
    // comparison stays total and deterministic (such rows order first ascending) instead of NaN-undefined.
    private static long ParseEpochMillis(string? raw)
    {
        if (!string.IsNullOrWhiteSpace(raw) && DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var value))
        {
            return value.ToUnixTimeMilliseconds();
        }

        return long.MinValue;
    }

    // Web `<TimeStamp value={row.arrived_at} format="absolute" />`: the absolute datetime, or the em-dash when
    // the value is null/unparseable.
    private static string FormatArrived(string? raw, DateTimeOffset now)
    {
        if (!string.IsNullOrWhiteSpace(raw) && DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var value))
        {
            return DateTimeFormatting.Format(value, DateTimeVariant.Full, now);
        }

        return EmDash;
    }

    // Web `fmtInt(n)` — integer with locale grouping.
    private static string FormatInt(int value) => value.ToString("N0", CultureInfo.InvariantCulture);

    // Web `formatBytes(n)`: em-dash for negatives, then "{n} B" / "{kb:.1} KB" / "{mb:.1} MB".
    private static string FormatBytes(long n)
    {
        if (n < 0)
        {
            return EmDash;
        }

        if (n < BytesPerKib)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{n} B");
        }

        if (n < BytesPerMib)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{n / (double)BytesPerKib:F1} KB");
        }

        return string.Create(CultureInfo.InvariantCulture, $"{n / (double)BytesPerMib:F1} MB");
    }
}

/// <summary>
/// Pure paging helper for the <c>EntriesTable</c> view — the native analogue of the web <c>DataTable</c>
/// pagination (<c>defaultPageSize: 25</c>). Slices the projected rows for a clamped page so the view renders
/// one page at a time; kept WinUI-free so the slice maths is unit-tested without a UI host.
/// </summary>
public static class EntriesTablePaging
{
    /// <summary>The web default page size (<c>pagination.defaultPageSize</c>).</summary>
    public const int DefaultPageSize = 25;

    /// <summary>The web page-size options (<c>pagination.pageSizeOptions</c>).</summary>
    public static IReadOnlyList<int> PageSizeOptions { get; } = [25, 50, 100];

    /// <summary>Number of pages needed to show <paramref name="rowCount"/> rows at <paramref name="pageSize"/>.</summary>
    public static int PageCount(int rowCount, int pageSize)
    {
        if (pageSize <= 0 || rowCount <= 0)
        {
            return 1;
        }

        return (rowCount + pageSize - 1) / pageSize;
    }

    /// <summary>
    /// The rows visible on <paramref name="pageIndex"/> (zero-based) at <paramref name="pageSize"/>. The page is
    /// clamped into range so an out-of-range index falls back to the last page.
    /// </summary>
    public static IReadOnlyList<EntriesTableRowView> Slice(
        IReadOnlyList<EntriesTableRowView> rows,
        int pageIndex,
        int pageSize)
    {
        ArgumentNullException.ThrowIfNull(rows);
        if (pageSize <= 0 || rows.Count == 0)
        {
            return rows;
        }

        int lastPage = PageCount(rows.Count, pageSize) - 1;
        int clamped = Math.Clamp(pageIndex, 0, lastPage);
        return [.. rows.Skip(clamped * pageSize).Take(pageSize)];
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>EntriesTable</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a VIN, reason, source topic or payload —
/// so a diagnostics line can never leak which entry or vehicle was involved. Thread-safe.
/// </summary>
public sealed class EntriesTableDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public EntriesTableDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EntriesTable</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EntriesTableRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>EntriesTable</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/admin/components/dlq-inspector/EntriesTable.tsx</c>.
/// </summary>
public static class EntriesTableRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "EntriesTable";
}
