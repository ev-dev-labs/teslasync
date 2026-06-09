using System.Globalization;
using System.Linq;
using System.Threading;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.IngestXRay;

/// <summary>
/// One per-field ingest statistic — the native mirror of the web <c>IngestXRayFieldStat</c> shape
/// (web/src/types/admin-diagnostics.ts, sourced from <c>internal/database/ingest_xray_repo.go</c>). Field
/// names mirror the Go API's snake_case JSON tags. <see cref="LastSeenAt"/> is kept as the raw ISO-8601
/// string (web parity — the web passes it straight to <c>TimeStamp</c>) and parsed on demand. Pure data —
/// no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Field">The signal field name (web <c>field</c>).</param>
/// <param name="SampleCount">How many samples of this field arrived in the window (web <c>sample_count</c>).</param>
/// <param name="LastSeenAt">The raw ISO-8601 last-seen timestamp (web <c>last_seen_at</c>).</param>
/// <param name="ValueKind">The observed <c>protomodel.ValueKind</c> integer (web <c>value_kind</c>).</param>
public sealed record IngestXRayFieldStat(
    string Field,
    long SampleCount,
    string LastSeenAt,
    int ValueKind);

/// <summary>
/// Human-readable label for a <c>value_kind</c> integer — a 1:1 port of the web
/// <c>formatValueKind</c> (web/src/api/hooks/useIngestXRay.ts), which itself mirrors
/// <c>protomodel.ValueKind</c> in the Go ingest path. These are technical type identifiers (not
/// translatable prose), so — exactly like the web source — they are rendered verbatim rather than routed
/// through the i18n facade. Unknown values render as <c>kind {n}</c> so an operator can still
/// cross-reference the raw enum without a UI change.
/// </summary>
public static class XRayValueKind
{
    /// <summary>The textual label for <paramref name="kind"/>, mirroring the web switch exactly.</summary>
    public static string Format(int kind) => kind switch
    {
        0 => "unknown",
        1 => "string",
        2 => "bool",
        3 => "int32",
        4 => "int64",
        5 => "float32",
        6 => "float64",
        7 => "enum",
        8 => "invalid",
        9 => "time",
        10 => "location",
        _ => string.Create(CultureInfo.InvariantCulture, $"kind {kind}"),
    };
}

/// <summary>
/// The current sort key + direction — the native port of the web <c>useSortToggle('sample_count', 'desc')</c>
/// hook (web/src/components/ui/DataTable.tsx). It is a two-state toggle: re-selecting the active column
/// flips the direction, selecting a different column starts it at descending (matching the web's
/// <c>onSort</c> exactly). Pure and immutable so the toggle semantics are unit-tested without a UI host.
/// </summary>
/// <param name="Key">The active sort column key (one of the <see cref="XRayFieldsTableProjection"/> key constants).</param>
/// <param name="Descending">True when the active column sorts descending (web <c>sortDir === 'desc'</c>).</param>
public sealed record XRayFieldsSort(string Key, bool Descending)
{
    /// <summary>The web default: <c>useSortToggle('sample_count', 'desc')</c>.</summary>
    public static XRayFieldsSort Default { get; } = new(XRayFieldsTableProjection.SampleCountKey, true);

    /// <summary>
    /// Advance the sort for <paramref name="key"/>: re-selecting the active column flips the direction;
    /// selecting a new column starts at descending (web <c>onSort</c>).
    /// </summary>
    public XRayFieldsSort Toggle(string key)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        return string.Equals(key, Key, StringComparison.Ordinal)
            ? this with { Descending = !Descending }
            : new XRayFieldsSort(key, true);
    }

    /// <summary>The direction currently applied to <paramref name="key"/> (for the header sort glyph).</summary>
    public SortDirection DirectionFor(string key) =>
        string.Equals(key, Key, StringComparison.Ordinal)
            ? (Descending ? SortDirection.Descending : SortDirection.Ascending)
            : SortDirection.None;
}

/// <summary>
/// The render-time data model the <c>XRayFieldsTable</c> view binds to — the native analogue of the web
/// <c>XRayFieldsTableProps</c> (<see cref="Rows"/> + <see cref="Loading"/>). The web component is
/// presentational: the parent page's state holder (web <c>useIngestXRay</c>) supplies the rows; the
/// surface never performs HTTP. Pure data — no WinUI types — so the projection is unit-tested without a UI
/// host.
/// </summary>
/// <param name="Rows">The per-field statistics to render (web <c>rows</c>).</param>
/// <param name="Loading">True while the parent's query is in flight with no rows yet (web <c>loading</c>).</param>
public sealed record XRayFieldsTableModel(
    IReadOnlyList<IngestXRayFieldStat> Rows,
    bool Loading)
{
    /// <summary>The initial empty, resolved model (no rows, not loading).</summary>
    public static XRayFieldsTableModel Empty { get; } =
        new(Array.Empty<IngestXRayFieldStat>(), false);
}

/// <summary>
/// The mutually-exclusive render branch of the <c>XRayFieldsTable</c> surface. The web source is a pure
/// presentational component (it receives its rows + loading as props and performs no fetching), so the
/// branches are a direct function of the input <see cref="XRayFieldsTableModel"/> — there is no
/// fetch-driven error / stale / offline branch to reproduce. Every branch maps onto a visible surface;
/// none is ever hidden.
/// </summary>
public enum XRayFieldsTableState
{
    /// <summary>A load is in flight with no rows yet (web empty message = "Loading…") — header + skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with zero rows (web empty message = "No samples…") — header + a friendly empty surface.</summary>
    Empty,

    /// <summary>Rows are present (web <c>data.length &gt; 0</c>) — the sortable, paged table.</summary>
    Data,
}

/// <summary>
/// A declarative table column descriptor (key + localized header + render hints) — the native, WinUI-free
/// analogue of the web <c>Column&lt;IngestXRayFieldStat&gt;</c> the component builds. <see cref="Numeric"/>
/// right-aligns the cell (web <c>align: 'right'</c>), <see cref="Mono"/> renders a monospace cell (web
/// <c>font-mono</c>), and <see cref="Badge"/> renders the value in a status chip (web <c>Badge</c>). All
/// four columns are sortable (web <c>sortable: true</c>).
/// </summary>
public sealed record XRayFieldsTableColumn(
    string Key,
    string Header,
    bool Numeric,
    bool Mono,
    bool Badge);

/// <summary>
/// A single projected, display-ready table row — the formatted cell text, the kind chip status, the stable
/// <see cref="RowKey"/>, and a Narrator automation name. Pure data so the projection is unit-tested without
/// a UI host.
/// </summary>
public sealed record XRayFieldsTableRow(
    string RowKey,
    string Field,
    string SamplesText,
    string LastSeenText,
    string KindText,
    StatusKind KindStatus,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the surface for one input model + sort — the native analogue
/// of the branch the web <c>XRayFieldsTable</c> returns. Holds the active <see cref="State"/>, the
/// localized <see cref="Columns"/>, the sorted + formatted <see cref="Rows"/>, the empty/loading
/// <see cref="EmptyMessage"/>, the active sort, and the surface automation name. Pure data so every branch
/// is asserted headlessly.
/// </summary>
public sealed record XRayFieldsTableDisplay(
    XRayFieldsTableState State,
    IReadOnlyList<XRayFieldsTableColumn> Columns,
    IReadOnlyList<XRayFieldsTableRow> Rows,
    string EmptyMessage,
    string SortKey,
    bool SortDescending,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="XRayFieldsTableModel"/> + <see cref="XRayFieldsSort"/> to its
/// <see cref="XRayFieldsTableDisplay"/> — the native port of
/// web/src/features/admin/components/ingest-xray/XRayFieldsTable.tsx. It selects the branch
/// (rows → Data; otherwise loading → Loading, else Empty), sorts a copy of the rows by the active key with
/// the web's exact comparators (locale-style field order, numeric sample count, parsed last-seen instant,
/// numeric value kind) and stable ties, formats each cell (en-US grouped sample count, relative last-seen,
/// value-kind label) and resolves every label through the i18n facade. No WinUI types — unit-tested
/// without a UI host.
/// </summary>
public static class XRayFieldsTableProjection
{
    /// <summary>Column key for the field-name column (web <c>key: 'field'</c>).</summary>
    public const string FieldKey = "field";

    /// <summary>Column key for the sample-count column (web <c>key: 'sample_count'</c>).</summary>
    public const string SampleCountKey = "sample_count";

    /// <summary>Column key for the last-seen column (web <c>key: 'last_seen_at'</c>).</summary>
    public const string LastSeenKey = "last_seen_at";

    /// <summary>Column key for the value-kind column (web <c>key: 'value_kind'</c>).</summary>
    public const string ValueKindKey = "value_kind";

    /// <summary>Page size for the table (web <c>pagination.defaultPageSize</c>).</summary>
    public const int PageSize = 50;

    private const string ColFieldKey = "translation.admin.xray.fields.cols.field";
    private const string ColCountKey = "translation.admin.xray.fields.cols.count";
    private const string ColLastSeenKey = "translation.admin.xray.fields.cols.lastSeen";
    private const string ColKindKey = "translation.admin.xray.fields.cols.kind";
    private const string EmptyKey = "translation.admin.xray.fields.empty";
    private const string LoadingKey = "translation.admin.xray.fields.loading";
    private const string TitleKey = "translation.admin.xray.panels.fields";

    private const string ColFieldFallback = "Field";
    private const string ColCountFallback = "Samples";
    private const string ColLastSeenFallback = "Last seen";
    private const string ColKindFallback = "Kind";
    private const string EmptyFallback =
        "No samples in this window. Try widening the window or confirm the vehicle is publishing.";
    private const string LoadingFallback = "Loading\u2026";
    private const string TitleFallback = "Field statistics";

    /// <summary>Project <paramref name="model"/> under <paramref name="sort"/> into a render-ready display.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="sort">The active sort key + direction (web <c>useSortToggle</c> state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for relative last-seen formatting.</param>
    public static XRayFieldsTableDisplay Project(
        XRayFieldsTableModel model,
        XRayFieldsSort sort,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(sort);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<XRayFieldsTableColumn> columns = BuildColumns(localizer);

        XRayFieldsTableState state = model.Rows.Count > 0
            ? XRayFieldsTableState.Data
            : (model.Loading ? XRayFieldsTableState.Loading : XRayFieldsTableState.Empty);

        IReadOnlyList<XRayFieldsTableRow> rows = state == XRayFieldsTableState.Data
            ? BuildRows(Sort(model.Rows, sort), now)
            : Array.Empty<XRayFieldsTableRow>();

        string loadingText = localizer.GetString(LoadingKey, LoadingFallback);
        string emptyText = localizer.GetString(EmptyKey, EmptyFallback);
        string title = localizer.GetString(TitleKey, TitleFallback);

        string emptyMessage = state == XRayFieldsTableState.Loading ? loadingText : emptyText;

        return new XRayFieldsTableDisplay(
            State: state,
            Columns: columns,
            Rows: rows,
            EmptyMessage: emptyMessage,
            SortKey: sort.Key,
            SortDescending: sort.Descending,
            AutomationName: BuildAutomationName(state, title, loadingText, emptyText, rows.Count));
    }

    private static IReadOnlyList<XRayFieldsTableColumn> BuildColumns(ILocalizer localizer) =>
    [
        new XRayFieldsTableColumn(FieldKey, localizer.GetString(ColFieldKey, ColFieldFallback), Numeric: false, Mono: true, Badge: false),
        new XRayFieldsTableColumn(SampleCountKey, localizer.GetString(ColCountKey, ColCountFallback), Numeric: true, Mono: false, Badge: false),
        new XRayFieldsTableColumn(LastSeenKey, localizer.GetString(ColLastSeenKey, ColLastSeenFallback), Numeric: false, Mono: false, Badge: false),
        new XRayFieldsTableColumn(ValueKindKey, localizer.GetString(ColKindKey, ColKindFallback), Numeric: false, Mono: false, Badge: true),
    ];

    // Web parity: `[...rows].sort(...)` with the per-key comparator, multiplied by the direction. JS
    // Array.sort is stable (ES2019), so ties keep their original order — reproduced via the index tie-break.
    private static IReadOnlyList<IngestXRayFieldStat> Sort(
        IReadOnlyList<IngestXRayFieldStat> rows,
        XRayFieldsSort sort)
    {
        if (rows.Count == 0)
        {
            return Array.Empty<IngestXRayFieldStat>();
        }

        int direction = sort.Descending ? -1 : 1;
        var indexed = new List<(IngestXRayFieldStat Row, int Index)>(rows.Count);
        for (int i = 0; i < rows.Count; i++)
        {
            indexed.Add((rows[i], i));
        }

        indexed.Sort((x, y) =>
        {
            int cmp = CompareByKey(x.Row, y.Row, sort.Key) * direction;
            return cmp != 0 ? cmp : x.Index.CompareTo(y.Index);
        });

        var ordered = new List<IngestXRayFieldStat>(indexed.Count);
        foreach (var entry in indexed)
        {
            ordered.Add(entry.Row);
        }

        return ordered;
    }

    private static int CompareByKey(IngestXRayFieldStat a, IngestXRayFieldStat b, string key) => key switch
    {
        // Web: a.field.localeCompare(b.field). Ordinal keeps signal-name ordering deterministic.
        FieldKey => string.Compare(a.Field, b.Field, StringComparison.Ordinal),
        // Web: a.sample_count - b.sample_count.
        SampleCountKey => a.SampleCount.CompareTo(b.SampleCount),
        // Web: Date.parse(a.last_seen_at) - Date.parse(b.last_seen_at). Unparseable sorts earliest.
        LastSeenKey => SortInstant(a.LastSeenAt).CompareTo(SortInstant(b.LastSeenAt)),
        // Web: a.value_kind - b.value_kind.
        ValueKindKey => a.ValueKind.CompareTo(b.ValueKind),
        _ => 0,
    };

    private static IReadOnlyList<XRayFieldsTableRow> BuildRows(
        IReadOnlyList<IngestXRayFieldStat> rows,
        DateTimeOffset now)
    {
        if (rows.Count == 0)
        {
            return Array.Empty<XRayFieldsTableRow>();
        }

        var built = new List<XRayFieldsTableRow>(rows.Count);
        foreach (var row in rows)
        {
            // Web: fmtInt(row.sample_count) — en-US grouped, zero fraction digits.
            string samples = NumberFormatting.Format(row.SampleCount, "en-US", 0);
            // Web: <TimeStamp value={row.last_seen_at} format="relative" />.
            string lastSeen = DateTimeFormatting.Format(TryParseInstant(row.LastSeenAt), DateTimeVariant.Relative, now);
            // Web: <Badge variant="neutral">{formatValueKind(row.value_kind)}</Badge>.
            string kind = XRayValueKind.Format(row.ValueKind);

            built.Add(new XRayFieldsTableRow(
                RowKey: row.Field,
                Field: row.Field,
                SamplesText: samples,
                LastSeenText: lastSeen,
                KindText: kind,
                KindStatus: StatusKind.Neutral,
                AutomationName: $"{row.Field}. {samples}. {lastSeen}. {kind}"));
        }

        return built;
    }

    private static DateTimeOffset SortInstant(string? raw) =>
        TryParseInstant(raw) ?? DateTimeOffset.MinValue;

    private static DateTimeOffset? TryParseInstant(string? raw)
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

    private static string BuildAutomationName(
        XRayFieldsTableState state,
        string title,
        string loadingText,
        string emptyText,
        int rowCount) => state switch
        {
            XRayFieldsTableState.Loading => $"{title}. {loadingText}",
            XRayFieldsTableState.Data => string.Create(CultureInfo.InvariantCulture, $"{title}. {rowCount}"),
            _ => $"{title}. {emptyText}",
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>XRayFieldsTable</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a field name, sample count or
/// vehicle identifier — so a diagnostics line can never leak which vehicle or signal was inspected.
/// Thread-safe.
/// </summary>
public sealed class XRayFieldsTableDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public XRayFieldsTableDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=XRayFieldsTable</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={XRayFieldsTableRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>XRayFieldsTable</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/admin/components/ingest-xray/XRayFieldsTable.tsx</c>.
/// </summary>
public static class XRayFieldsTableRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "XRayFieldsTable";
}
