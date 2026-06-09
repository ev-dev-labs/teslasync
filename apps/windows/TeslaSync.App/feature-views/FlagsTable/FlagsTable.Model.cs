using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.FeatureFlags;

/// <summary>
/// The mutually-exclusive render branch of the <c>FlagsTable</c> surface — the native union of the states the
/// web component renders (web/src/features/admin/components/feature-flags/FlagsTable.tsx). The web source is a
/// pure presentational component: it takes its <c>rows</c> + <c>loading</c> as props and performs no fetching,
/// so the branch is a direct function of the input <see cref="FlagsTableModel"/> exactly as the web
/// <c>DataTable</c>'s <c>emptyMessage = loading ? … : …</c> resolves. Every branch maps onto a visible surface;
/// none is ever hidden.
/// </summary>
public enum FlagsTableState
{
    /// <summary>No rows yet and a fetch is in flight (web <c>emptyMessage = t('…table.loading')</c>).</summary>
    Loading,

    /// <summary>No rows and not loading (web <c>emptyMessage = t('…table.empty')</c>).</summary>
    Empty,

    /// <summary>One or more rows are present (web <c>data.length &gt; 0</c>) — the registry table.</summary>
    Data,
}

/// <summary>
/// One feature-flag registry row — the native mirror of the web <c>FeatureFlagEntry</c>
/// (<c>web/src/types/admin-diagnostics.ts</c>): a string <see cref="Key"/> and a JSON
/// <see cref="Value"/> (the web <c>unknown</c> value stored as JSON in Postgres). Pure data — no WinUI types —
/// so the projection is unit-tested without a UI host.
/// </summary>
public sealed record FeatureFlagEntry(string Key, JsonElement Value)
{
    /// <summary>
    /// Builds an entry from a flag key and a JSON value literal, cloning the parsed element so it stays valid
    /// after the backing <see cref="JsonDocument"/> is disposed (mirrors how the API adapter materialises each
    /// flag's value).
    /// </summary>
    public static FeatureFlagEntry FromJson(string key, string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        using var document = JsonDocument.Parse(json);
        return new FeatureFlagEntry(key, document.RootElement.Clone());
    }
}

/// <summary>
/// The render-time data model the <c>FlagsTable</c> view binds to — the native analogue of the web
/// <c>FlagsTableProps</c> data fields (<c>rows</c> + <c>loading</c>). The component is presentational, so the
/// edit/delete callbacks are surfaced as view events rather than carried here. Pure data — no WinUI types.
/// </summary>
public sealed record FlagsTableModel(IReadOnlyList<FeatureFlagEntry> Rows, bool Loading)
{
    /// <summary>The initial empty, not-loading model.</summary>
    public static FlagsTableModel Empty { get; } = new(Array.Empty<FeatureFlagEntry>(), false);
}

/// <summary>
/// A declarative table-column descriptor (key + localized header + sortability) — the native, WinUI-free
/// analogue of the web <c>Column&lt;FeatureFlagEntry&gt;</c> the table renders. The view maps each onto a
/// header cell; only the key column is <see cref="Sortable"/> (web <c>sortable: true</c>).
/// </summary>
public sealed record FlagsTableColumn(string Key, string Header, bool Sortable);

/// <summary>
/// A single projected, display-ready registry row — the formatted key + JSON value preview, the original
/// <see cref="Entry"/> (so the view can hand it back through the edit/delete callbacks), and the Narrator
/// names for the row and its two action buttons. Pure data so the projection is asserted headlessly.
/// </summary>
public sealed record FlagsTableRow(
    string Key,
    string KeyText,
    string ValuePreview,
    FeatureFlagEntry Entry,
    string AutomationName,
    string EditActionName,
    string DeleteActionName);

/// <summary>
/// The fully projected, render-ready view of the table for one input model + sort + page — the native analogue
/// of what the web <c>FlagsTable</c> returns. Holds the resolved column headers, the active sort direction, the
/// current page's <see cref="Rows"/>, the loading/empty status message, the action-button labels, and the
/// pagination metadata. Pure data so every branch is asserted without a UI host.
/// </summary>
public sealed record FlagsTableDisplay(
    FlagsTableState State,
    IReadOnlyList<FlagsTableColumn> Columns,
    IReadOnlyList<FlagsTableRow> Rows,
    SortDirection KeySortDirection,
    string StatusMessage,
    string EditLabel,
    string DeleteLabel,
    bool ShowPagination,
    int Page,
    int PageCount,
    int PageSize,
    int TotalCount,
    int RangeStart,
    int RangeEnd,
    string PaginationSummary,
    string FirstLabel,
    string PreviousLabel,
    string NextLabel,
    string LastLabel,
    string PageSizeLabel,
    IReadOnlyList<int> PageSizeOptions,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="FlagsTableModel"/> (+ sort + page) to its <see cref="FlagsTableDisplay"/> —
/// the native port of web/src/features/admin/components/feature-flags/FlagsTable.tsx. It reproduces the web
/// <c>previewValue</c> JSON-preview rules exactly, the <c>useSortToggle('key', 'asc')</c> key sort, the
/// <c>DataTable</c> empty/loading message resolution, and the <c>pagination = { defaultPageSize: 25,
/// pageSizeOptions: [25, 50, 100] }</c> paging. Every label resolves through the i18n facade using the same
/// keys the web source feeds <c>t()</c> (the catalog stores them under the <c>translation.</c> namespace). No
/// WinUI types — unit-tested without a UI host.
/// </summary>
public static class FlagsTableProjection
{
    /// <summary>Row value-map key for the flag-key column (web <c>key: 'key'</c>).</summary>
    public const string KeyColumnKey = "key";

    /// <summary>Row value-map key for the value column (web <c>key: 'value'</c>).</summary>
    public const string ValueColumnKey = "value";

    /// <summary>Row value-map key for the actions column (web <c>key: 'actions'</c>).</summary>
    public const string ActionsColumnKey = "actions";

    /// <summary>i18n key for the flag-key column header (web <c>admin.flags.cols.key</c>).</summary>
    public const string KeyHeaderKey = "translation.admin.flags.cols.key";

    /// <summary>i18n key for the value column header (web <c>admin.flags.cols.value</c>).</summary>
    public const string ValueHeaderKey = "translation.admin.flags.cols.value";

    /// <summary>i18n key for the actions column header (web <c>admin.flags.cols.actions</c>).</summary>
    public const string ActionsHeaderKey = "translation.admin.flags.cols.actions";

    /// <summary>i18n key for the edit action label (web <c>admin.flags.actions.edit</c>).</summary>
    public const string EditLabelKey = "translation.admin.flags.actions.edit";

    /// <summary>i18n key for the delete action label (web <c>admin.flags.actions.delete</c>).</summary>
    public const string DeleteLabelKey = "translation.admin.flags.actions.delete";

    /// <summary>i18n key for the loading empty-message (web <c>admin.flags.table.loading</c>).</summary>
    public const string LoadingMessageKey = "translation.admin.flags.table.loading";

    /// <summary>i18n key for the empty empty-message (web <c>admin.flags.table.empty</c>).</summary>
    public const string EmptyMessageKey = "translation.admin.flags.table.empty";

    /// <summary>Default page size (web <c>pagination.defaultPageSize</c>).</summary>
    public const int DefaultPageSize = 25;

    /// <summary>Page-size choices (web <c>pagination.pageSizeOptions</c>).</summary>
    public static IReadOnlyList<int> PageSizeOptions { get; } =
        new ReadOnlyCollection<int>(new[] { 25, 50, 100 });

    private const string RegistryLabelKey = "translation.admin.flags.panels.registry";
    private const string FirstLabelKey = "translation.common.pagination.first";
    private const string PreviousLabelKey = "translation.common.pagination.previous";
    private const string NextLabelKey = "translation.common.pagination.next";
    private const string LastLabelKey = "translation.common.pagination.last";
    private const string PageSizeLabelKey = "translation.common.pagination.pageSize";

    private const string EmDash = "\u2014";
    private const string Ellipsis = "\u2026";
    private const int PreviewMaxLength = 120;
    private const int PreviewTruncateAt = 117;

    private static readonly JsonSerializerOptions PreviewJsonOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="sort">The key-column sort state (web <c>useSortToggle('key', 'asc')</c>).</param>
    /// <param name="page">The 1-based current page (web pagination).</param>
    /// <param name="pageSize">The current page size (web <c>pagination.defaultPageSize</c> default 25).</param>
    public static FlagsTableDisplay Project(
        FlagsTableModel model,
        ILocalizer localizer,
        TableSortState sort,
        int page,
        int pageSize)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(sort);

        string keyHeader = localizer.GetString(KeyHeaderKey, "Flag key");
        string valueHeader = localizer.GetString(ValueHeaderKey, "Value");
        string actionsHeader = localizer.GetString(ActionsHeaderKey, "Actions");
        string editLabel = localizer.GetString(EditLabelKey, "Edit");
        string deleteLabel = localizer.GetString(DeleteLabelKey, "Delete");
        string loadingMessage = localizer.GetString(LoadingMessageKey, "Loading flags\u2026");
        string emptyMessage = localizer.GetString(EmptyMessageKey, "No feature flags are set on this server.");
        string registryLabel = localizer.GetString(RegistryLabelKey, "Registry");

        var columns = new FlagsTableColumn[]
        {
            new(KeyColumnKey, keyHeader, true),
            new(ValueColumnKey, valueHeader, false),
            new(ActionsColumnKey, actionsHeader, false),
        };

        // web: const sorted = [...rows].sort(...) — only the key column reorders (value's comparator returns 0).
        var sorted = sort.Apply(model.Rows, static entry => entry.Key);

        var pagination = new PaginationState { PageSize = pageSize };
        pagination.Total = sorted.Count;
        pagination.Page = page;

        var pageEntries = pagination.Slice(sorted);
        var rows = BuildRows(pageEntries, editLabel, deleteLabel);

        var state = model.Rows.Count > 0
            ? FlagsTableState.Data
            : model.Loading ? FlagsTableState.Loading : FlagsTableState.Empty;

        string statusMessage = state switch
        {
            FlagsTableState.Loading => loadingMessage,
            FlagsTableState.Empty => emptyMessage,
            _ => string.Empty,
        };

        string summary = string.Format(
            CultureInfo.CurrentCulture,
            "{0}\u2013{1} / {2}",
            pagination.RangeStart,
            pagination.RangeEnd,
            pagination.Total);

        string automationName = state switch
        {
            FlagsTableState.Loading => loadingMessage,
            FlagsTableState.Empty => emptyMessage,
            _ => string.Create(CultureInfo.CurrentCulture, $"{registryLabel}. {summary}"),
        };

        return new FlagsTableDisplay(
            State: state,
            Columns: columns,
            Rows: rows,
            KeySortDirection: sort.DirectionFor(KeyColumnKey),
            StatusMessage: statusMessage,
            EditLabel: editLabel,
            DeleteLabel: deleteLabel,
            ShowPagination: state == FlagsTableState.Data,
            Page: pagination.Page,
            PageCount: pagination.PageCount,
            PageSize: pagination.PageSize,
            TotalCount: pagination.Total,
            RangeStart: pagination.RangeStart,
            RangeEnd: pagination.RangeEnd,
            PaginationSummary: summary,
            FirstLabel: localizer.GetString(FirstLabelKey, "First page"),
            PreviousLabel: localizer.GetString(PreviousLabelKey, "Previous page"),
            NextLabel: localizer.GetString(NextLabelKey, "Next page"),
            LastLabel: localizer.GetString(LastLabelKey, "Last page"),
            PageSizeLabel: localizer.GetString(PageSizeLabelKey, "Rows per page"),
            PageSizeOptions: PageSizeOptions,
            AutomationName: automationName);
    }

    /// <summary>
    /// Compact JSON preview for a single cell — the native port of the web <c>previewValue</c>. Mirrors its
    /// branch order exactly: <c>null</c>→"null", undefined→em dash, string→<c>JSON.stringify</c> (quoted, never
    /// truncated), boolean/number→<c>String(value)</c>, otherwise compact <c>JSON.stringify</c> truncated to 117
    /// chars + an ellipsis past 120, falling back to an em dash on an empty serialization.
    /// </summary>
    public static string PreviewValue(JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Undefined:
                return EmDash;
            case JsonValueKind.Null:
                return "null";
            case JsonValueKind.String:
                return value.GetRawText();
            case JsonValueKind.True:
                return "true";
            case JsonValueKind.False:
                return "false";
            case JsonValueKind.Number:
                return value.GetRawText();
            default:
                string json = JsonSerializer.Serialize(value, PreviewJsonOptions);
                if (string.IsNullOrEmpty(json))
                {
                    return EmDash;
                }

                return json.Length > PreviewMaxLength
                    ? string.Concat(json.AsSpan(0, PreviewTruncateAt), Ellipsis)
                    : json;
        }
    }

    private static IReadOnlyList<FlagsTableRow> BuildRows(
        IReadOnlyList<FeatureFlagEntry> entries,
        string editLabel,
        string deleteLabel)
    {
        if (entries.Count == 0)
        {
            return Array.Empty<FlagsTableRow>();
        }

        var rows = new List<FlagsTableRow>(entries.Count);
        foreach (var entry in entries)
        {
            string keyText = string.IsNullOrEmpty(entry.Key) ? EmDash : entry.Key;
            string preview = PreviewValue(entry.Value);

            rows.Add(new FlagsTableRow(
                Key: entry.Key,
                KeyText: keyText,
                ValuePreview: preview,
                Entry: entry,
                AutomationName: string.Create(CultureInfo.CurrentCulture, $"{keyText}. {preview}"),
                EditActionName: string.Concat(editLabel, " ", keyText),
                DeleteActionName: string.Concat(deleteLabel, " ", keyText)));
        }

        return rows;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>FlagsTable</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a flag key or value — so a diagnostics
/// line can never leak which flags an operator inspected. Thread-safe.
/// </summary>
public sealed class FlagsTableDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FlagsTableDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FlagsTable</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FlagsTableRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>FlagsTable</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/admin/components/feature-flags/FlagsTable.tsx</c>.
/// </summary>
public static class FlagsTableRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "FlagsTable";
}
