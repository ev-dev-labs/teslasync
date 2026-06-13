using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Exports;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>ExportsPage</c> surface — the native mirror of the data states the
/// web page renders (web/src/features/exports/pages/ExportsPage.tsx). The web page runs the <c>useExportJobs</c> query
/// and renders, in precedence order, the loading shimmer (web <c>isLoading</c>), the failure surface (web
/// <c>error</c>), the "no exports yet" empty state (web <c>jobs.length === 0</c>) or the bulk-selectable jobs table
/// (web <c>jobs.map</c>). This enum is the top-level summary the ledger / Narrator key off; per-region visibility is
/// still driven by the projected flags so each branch renders exactly as the web composes it.
/// </summary>
public enum ExportsState
{
    /// <summary>The export-jobs query is in flight (web <c>isLoading</c>) — the panel shows the table shimmer.</summary>
    Loading,

    /// <summary>The query resolved with no jobs (web <c>jobs.length === 0</c>) — the empty state shows.</summary>
    Empty,

    /// <summary>The query failed (web <c>error</c>) — the failure surface + retry shows.</summary>
    Error,

    /// <summary>The query produced rows (web <c>jobs.length &gt; 0</c>) — the table renders.</summary>
    Success,
}

/// <summary>
/// The tri-state of the master "select all" checkbox for the currently visible rows — the native mirror of the web
/// <c>useBulkSelection.masterState</c> ('none' / 'some' / 'all') that drives the header checkbox's indeterminate flag.
/// </summary>
public enum ExportsMasterState
{
    /// <summary>No visible row is selected.</summary>
    None,

    /// <summary>At least one (but not all) visible rows are selected (the indeterminate checkbox).</summary>
    Some,

    /// <summary>Every visible row is selected.</summary>
    All,
}

/// <summary>
/// One export-job summary — the native mirror of the web <c>ExportJobSummary</c> the list view reads (id, type,
/// format, status, optional byte size and the ISO created timestamp). Field names mirror the Go
/// <c>models.ExportJobSummary</c> snake_case JSON tags; parsing is null-tolerant. The raw <see cref="Status"/> token is
/// preserved verbatim so both the status-chip colour (web <c>statusVariant</c>) and the localized status label (web
/// <c>t(`exportsList.status.${status}`, status)</c>) derive from the same source. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record ExportJobSummary(
    string Id,
    string Type,
    string Format,
    string Status,
    long? FileSize,
    string? CreatedAt)
{
    /// <summary>The parsed creation instant, or <see langword="null"/> when absent / unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => ParseTimestamp(CreatedAt);

    /// <summary>True when the job's artifact is downloadable (web <c>j.status === 'ready'</c>).</summary>
    public bool IsReady => string.Equals(Status, "ready", StringComparison.OrdinalIgnoreCase);

    /// <summary>Read one job from a JSON object, tolerating missing / null fields.</summary>
    public static ExportJobSummary FromJson(JsonElement o) => new(
        Id: ExportsJson.Str(o, "id") ?? string.Empty,
        Type: ExportsJson.Str(o, "type") ?? string.Empty,
        Format: ExportsJson.Str(o, "format") ?? string.Empty,
        Status: ExportsJson.Str(o, "status") ?? string.Empty,
        FileSize: ExportsJson.Long(o, "file_size"),
        CreatedAt: ExportsJson.Str(o, "created_at"));

    /// <summary>
    /// Map a status token onto the semantic chip colour exactly as the web <c>statusVariant</c> does: <c>ready</c> →
    /// success; <c>failed</c> → danger; <c>processing</c> / <c>queued</c> → info; anything else (incl. <c>expired</c>)
    /// → neutral.
    /// </summary>
    public static StatusKind BadgeFor(string status) => (status ?? string.Empty).ToLowerInvariant() switch
    {
        "ready" => StatusKind.Success,
        "failed" => StatusKind.Danger,
        "processing" or "queued" => StatusKind.Info,
        _ => StatusKind.Neutral,
    };

    private static DateTimeOffset? ParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var value)
            ? value
            : null;
    }
}

/// <summary>
/// The export-jobs envelope — the native mirror of the web <c>useExportJobs</c> result: the parsed <see cref="Jobs"/>
/// plus a <see cref="HasData"/> marker recording whether the server returned a response. The tolerant parser accepts
/// either a bare JSON array (the <c>writeJSON([]ExportJobSummary)</c> wire shape) or the platform <c>{data:[…]}</c>
/// envelope so the response round-trips losslessly. Pure data.
/// </summary>
public sealed record ExportsListSnapshot(bool HasData, IReadOnlyList<ExportJobSummary> Jobs)
{
    /// <summary>The empty snapshot (no response yet) — the default local-state feed result.</summary>
    public static ExportsListSnapshot Empty { get; } = new(false, Array.Empty<ExportJobSummary>());

    /// <summary>
    /// Read the export-jobs list from JSON, tolerating the platform <c>{data:[…]}</c> envelope and a bare array. A
    /// non-array payload is treated as "no data" (the web empty branch).
    /// </summary>
    public static ExportsListSnapshot FromJson(JsonElement root)
    {
        JsonElement arr = root;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("data", out var data))
        {
            arr = data;
        }

        if (arr.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        var rows = new List<ExportJobSummary>();
        foreach (var element in arr.EnumerateArray())
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
                rows.Add(ExportJobSummary.FromJson(element));
            }
        }

        return new ExportsListSnapshot(true, rows);
    }
}

/// <summary>
/// The result of a bulk delete — the native mirror of the web <c>ExportBulkResult</c>
/// (<c>{ deleted: number, failed: { id, reason }[] }</c>). <see cref="Failed"/> is the count of per-id misses. Pure
/// data; parsing is null-tolerant and unwraps the platform <c>{data:…}</c> envelope.
/// </summary>
public sealed record ExportBulkOutcome(int Deleted, int Failed)
{
    /// <summary>The all-zero outcome (the default before any bulk op runs).</summary>
    public static ExportBulkOutcome Empty { get; } = new(0, 0);

    /// <summary>Read the bulk result from JSON, tolerating missing fields and the platform <c>{data:…}</c> envelope.</summary>
    public static ExportBulkOutcome FromJson(JsonElement root)
    {
        JsonElement o = root;
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Object)
        {
            o = data;
        }

        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        int failed = 0;
        if (o.TryGetProperty("failed", out var f) && f.ValueKind == JsonValueKind.Array)
        {
            failed = f.GetArrayLength();
        }

        return new ExportBulkOutcome(
            Deleted: (int)(ExportsJson.Long(o, "deleted") ?? 0),
            Failed: failed);
    }
}

/// <summary>
/// The data port the <see cref="ExportsPageViewModel"/> reads export jobs through and runs the bulk delete against —
/// the native parity of the web <c>useExportJobs</c> (GET /export/jobs) + <c>useBulkExportsDelete</c>
/// (POST /export/jobs/bulk) hooks. The view never performs HTTP itself; the default <see cref="EmptyExportsFeed"/>
/// resolves to the empty state, and the generated-client-backed <see cref="ExportsClientFeed"/> binds to the generated
/// OpenAPI contract client (ADR-004).
/// </summary>
public interface IExportsFeed
{
    /// <summary>The API origin a finished job's artifact is downloaded from, or <see langword="null"/> when unknown.</summary>
    Uri? DownloadBaseUri { get; }

    /// <summary>Resolve the export-jobs list (web <c>useExportJobs</c>).</summary>
    Task<ExportsListSnapshot> FetchAsync(CancellationToken cancellationToken);

    /// <summary>Delete the selected export jobs (web <c>useBulkExportsDelete</c>: <c>POST /export/jobs/bulk</c>).</summary>
    Task<ExportBulkOutcome> BulkDeleteAsync(IReadOnlyList<string> ids, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves the list to the empty snapshot and every bulk delete to the empty outcome.</summary>
public sealed class EmptyExportsFeed : IExportsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyExportsFeed Instance { get; } = new();

    private EmptyExportsFeed()
    {
    }

    /// <inheritdoc />
    public Uri? DownloadBaseUri => null;

    /// <inheritdoc />
    public Task<ExportsListSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(ExportsListSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<ExportBulkOutcome> BulkDeleteAsync(IReadOnlyList<string> ids, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(ExportBulkOutcome.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>ExportsPage</c> projects from — the native analogue of the web page's resolved
/// query + selection state (web/src/features/exports/pages/ExportsPage.tsx). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Jobs">The export-job rows (web <c>jobs</c>).</param>
/// <param name="SelectedIds">The currently selected job ids (web <c>useBulkSelection.selectedIds</c>).</param>
/// <param name="Loading">Whether the list query is in flight with no data yet (web <c>isLoading</c>).</param>
/// <param name="HasError">Whether the list query failed (web <c>error</c>).</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface.</param>
/// <param name="BulkBusy">Whether the bulk delete is currently in flight (web mutation pending flag).</param>
/// <param name="DownloadBase">The API origin a finished job's artifact downloads from (web download href base).</param>
/// <param name="Now">The reference instant for the created-timestamp formatting.</param>
public sealed record ExportsModel(
    IReadOnlyList<ExportJobSummary> Jobs,
    IReadOnlySet<string> SelectedIds,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    bool BulkBusy,
    Uri? DownloadBase,
    DateTimeOffset Now)
{
    /// <summary>The initial model — the first load, no data yet, nothing selected.</summary>
    public static ExportsModel Initial { get; } = new(
        Jobs: Array.Empty<ExportJobSummary>(),
        SelectedIds: new HashSet<string>(StringComparer.Ordinal),
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        BulkBusy: false,
        DownloadBase: null,
        Now: DateTimeOffset.UnixEpoch);
}

/// <summary>One projected, render-ready table row (web table row): the formatted cells plus the row's selection
/// state, the resolved download affordance and the accessible name.</summary>
public sealed record ExportRowDisplay(
    string Id,
    string Type,
    string Format,
    string Size,
    string Created,
    string StatusLabel,
    StatusKind StatusKind,
    bool Selected,
    string SelectLabel,
    bool CanDownload,
    string DownloadLabel,
    string DownloadPath,
    Uri? DownloadUri);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade. Holds the always-visible page header, the four
/// data-state flags, the bulk-action toolbar (count + delete + clear + delete-confirm copy) and the table chrome
/// (column headers, master-checkbox label/state, the projected rows or the empty state). Pure data so every branch is
/// asserted headlessly.
/// </summary>
public sealed record ExportsDisplay(
    ExportsState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    bool ShowEmpty,
    string EmptyTitle,
    string EmptyMessage,
    bool ShowTable,
    string TypeHeader,
    string FormatHeader,
    string SizeHeader,
    string CreatedHeader,
    string StatusHeader,
    string SelectAllLabel,
    string SelectRowLabel,
    ExportsMasterState MasterState,
    IReadOnlyList<ExportRowDisplay> Rows,
    bool ShowBulkBar,
    int SelectedCount,
    string SelectedCountLabel,
    string ItemNoun,
    string ClearLabel,
    bool BulkBusy,
    string DeleteLabel,
    string DeleteGlyph,
    string DeleteConfirmTitle,
    string DeleteConfirmBody,
    string DeleteConfirmLabel,
    string DeleteCancelLabel,
    string DownloadLabel,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="ExportsModel"/> to its <see cref="ExportsDisplay"/> — the native port of the
/// render logic in web/src/features/exports/pages/ExportsPage.tsx. Every visible literal resolves through the i18n
/// facade using the exact web key names; the chrome strings (subtitle, column headers, the per-row select template,
/// the delete-confirm copy, the bulk-action labels) are resolved on every projection so the i18n contract holds in
/// every data state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ExportsProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literal.</summary>
    public const string EmDash = "\u2014";

    // The Segoe Fluent Icons glyph for the bulk delete action (web Icons.delete).
    private const string DeleteGlyph = "\uE74D"; // Delete

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query + selection state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static ExportsDisplay Project(ExportsModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Page header (web PageContainer title + subtitle) ────────────────────────────────────────────────
        string title = localizer.GetString("exportsList.title", "Exports");
        string subtitle = localizer.GetString(
            "exportsList.subtitle",
            "Manage your past export jobs. Select rows to delete in bulk.");

        // ── Failure surface (web ErrorDisplay) ──────────────────────────────────────────────────────────────
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        // ── Empty state (web EmptyState title + message) ────────────────────────────────────────────────────
        string emptyTitle = localizer.GetString("exportsList.empty.title", "No exports yet");
        string emptyMessage = localizer.GetString(
            "exportsList.empty.body",
            "Your future exports will appear here for download or deletion.");

        // ── Table chrome (web thead column labels + bulk select labels) ─────────────────────────────────────
        string typeHeader = localizer.GetString("exportsList.col.type", "Type");
        string formatHeader = localizer.GetString("exportsList.col.format", "Format");
        string sizeHeader = localizer.GetString("exportsList.col.size", "Size");
        string createdHeader = localizer.GetString("exportsList.col.created", "Created");
        string statusHeader = localizer.GetString("exportsList.col.status", "Status");
        string selectAll = localizer.GetString("bulk.selectAll", "Select all");
        string selectRow = localizer.GetString("bulk.selectRow", "Select row");
        string selectExportTemplate = localizer.GetString("exportsList.selectExport", "Select export {{id}}");
        string downloadLabel = localizer.GetString("exportsList.download", "Download");

        // ── Bulk-action toolbar (web BulkActionToolbar: single destructive Delete + Clear) ──────────────────
        string nounOne = localizer.GetString("exportsList.noun.one", "export");
        string nounOther = localizer.GetString("exportsList.noun.other", "exports");
        string clearLabel = localizer.GetString("bulk.clear", "Clear selection");
        string deleteLabel = localizer.GetString("exportsList.bulk.delete", "Delete");
        string deleteConfirmTitle = localizer.GetString("exportsList.bulk.deleteConfirm.title", "Delete export jobs?");
        string deleteConfirmBody = localizer.GetString(
            "exportsList.bulk.deleteConfirm.body",
            "Selected jobs and their downloadable artifacts will be permanently removed.");
        string deleteConfirmLabel = localizer.GetString("common.delete", "Delete");
        string deleteCancelLabel = localizer.GetString("common.cancel", "Cancel");

        // ── Rows (web jobs.map) ─────────────────────────────────────────────────────────────────────────────
        var rows = new List<ExportRowDisplay>(model.Jobs.Count);
        foreach (var job in model.Jobs)
        {
            bool selected = model.SelectedIds.Contains(job.Id);
            bool canDownload = job.IsReady && !string.IsNullOrEmpty(job.Id);
            string downloadPath = ExportsRegistration.DownloadPath(job.Id);
            Uri? downloadUri = null;
            if (canDownload && model.DownloadBase is { } baseUri)
            {
                downloadUri = new Uri(baseUri, ExportsRegistration.DownloadRelative(job.Id));
            }

            string statusLabel = localizer.GetString(
                $"exportsList.status.{job.Status}",
                string.IsNullOrEmpty(job.Status) ? EmDash : job.Status);

            rows.Add(new ExportRowDisplay(
                Id: job.Id,
                Type: string.IsNullOrEmpty(job.Type) ? EmDash : job.Type,
                Format: string.IsNullOrEmpty(job.Format) ? EmDash : job.Format.ToUpperInvariant(),
                Size: ExportsRegistration.FormatBytes(job.FileSize),
                Created: DateTimeFormatting.Format(job.CreatedAtTime, DateTimeVariant.Full, model.Now),
                StatusLabel: statusLabel,
                StatusKind: ExportJobSummary.BadgeFor(job.Status),
                Selected: selected,
                SelectLabel: selectExportTemplate.Replace("{{id}}", job.Id, StringComparison.Ordinal),
                CanDownload: canDownload,
                DownloadLabel: downloadLabel,
                DownloadPath: downloadPath,
                DownloadUri: downloadUri));
        }

        // ── State selection (web render precedence: loading → error → empty → table) ─────────────────────────
        bool showLoading = model.Loading;
        bool showError = !model.Loading && model.HasError;
        bool hasRows = model.Jobs.Count > 0;
        bool showEmpty = !model.Loading && !model.HasError && !hasRows;
        bool showTable = !model.Loading && !model.HasError && hasRows;

        ExportsState state = showLoading
            ? ExportsState.Loading
            : showError
                ? ExportsState.Error
                : hasRows
                    ? ExportsState.Success
                    : ExportsState.Empty;

        // ── Selection summary (web BulkActionToolbar count + master checkbox) ───────────────────────────────
        int selectedCount = CountSelected(model);
        string selectedCountLabel = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("bulk.selected", "{0} selected"),
            selectedCount);
        string itemNoun = selectedCount == 1 ? nounOne : nounOther;
        ExportsMasterState masterState = ComputeMasterState(model);

        return new ExportsDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowLoading: showLoading,
            ShowError: showError,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowEmpty: showEmpty,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            ShowTable: showTable,
            TypeHeader: typeHeader,
            FormatHeader: formatHeader,
            SizeHeader: sizeHeader,
            CreatedHeader: createdHeader,
            StatusHeader: statusHeader,
            SelectAllLabel: selectAll,
            SelectRowLabel: selectRow,
            MasterState: masterState,
            Rows: rows,
            ShowBulkBar: selectedCount > 0,
            SelectedCount: selectedCount,
            SelectedCountLabel: selectedCountLabel,
            ItemNoun: itemNoun,
            ClearLabel: clearLabel,
            BulkBusy: model.BulkBusy,
            DeleteLabel: deleteLabel,
            DeleteGlyph: DeleteGlyph,
            DeleteConfirmTitle: deleteConfirmTitle,
            DeleteConfirmBody: deleteConfirmBody,
            DeleteConfirmLabel: deleteConfirmLabel,
            DeleteCancelLabel: deleteCancelLabel,
            DownloadLabel: downloadLabel,
            AutomationName: title);
    }

    /// <summary>
    /// The master-checkbox tri-state for the visible rows (web <c>useBulkSelection.masterState</c>): none when no
    /// visible row is selected, all when every visible row is, otherwise some (the indeterminate state).
    /// </summary>
    public static ExportsMasterState ComputeMasterState(ExportsModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        if (model.Jobs.Count == 0)
        {
            return ExportsMasterState.None;
        }

        int hits = CountSelected(model);
        if (hits == 0)
        {
            return ExportsMasterState.None;
        }

        return hits == model.Jobs.Count ? ExportsMasterState.All : ExportsMasterState.Some;
    }

    // Counts only selected ids that are still visible — matches the web toolbar count over the rendered rows.
    private static int CountSelected(ExportsModel model)
    {
        int count = 0;
        foreach (var job in model.Jobs)
        {
            if (model.SelectedIds.Contains(job.Id))
            {
                count++;
            }
        }

        return count;
    }
}

/// <summary>
/// Canonical metadata for the <c>ExportsPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/exports/pages/ExportsPage.tsx</c> (route <c>/exports</c>, nav name <c>Exports</c>).
/// </summary>
public static class ExportsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ExportsPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>Exports</c>).</summary>
    public const string RouteName = "Exports";

    /// <summary>The generated OpenAPI operation id for the list query (web <c>useExportJobs</c>).</summary>
    public const string ListOperation = "get_api_v1_export_jobs";

    /// <summary>The generated OpenAPI operation id for the bulk delete (web <c>useBulkExportsDelete</c>).</summary>
    public const string BulkOperation = "post_api_v1_export_jobs_bulk";

    /// <summary>The generated OpenAPI operation id for a finished job's artifact download.</summary>
    public const string DownloadOperation = "get_api_v1_export_jobs_jobID_download";

    /// <summary>The wire op string the bulk endpoint expects (web <c>op: 'delete'</c>).</summary>
    public const string DeleteOp = "delete";

    /// <summary>The Segoe Fluent Icons glyph for the empty state / nav item (web export icon).</summary>
    public const string EmptyGlyph = "\uEDE1"; // Save / export

    /// <summary>The absolute download path for a finished job (web <c>exportDownloadUrl</c>).</summary>
    public static string DownloadPath(string id) =>
        $"/api/v1/export/jobs/{id}/download";

    /// <summary>The (escaped) download path relative to the API origin used to build the clickable URI.</summary>
    public static string DownloadRelative(string id) =>
        $"/api/v1/export/jobs/{Uri.EscapeDataString(id)}/download";

    /// <summary>
    /// Format a byte count with binary units exactly as the web <c>formatBytes</c> does: <c>&lt; 1 KiB</c> → "N B";
    /// then "N.N KB" / "N.N MB" / "N.N GB". A null size renders the shared em-dash fallback.
    /// </summary>
    public static string FormatBytes(long? bytes)
    {
        if (bytes is not { } b)
        {
            return ExportsProjection.EmDash;
        }

        if (b < 1024)
        {
            return $"{b.ToString(CultureInfo.InvariantCulture)} B";
        }

        if (b < 1024L * 1024)
        {
            return $"{(b / 1024.0).ToString("F1", CultureInfo.InvariantCulture)} KB";
        }

        if (b < 1024L * 1024 * 1024)
        {
            return $"{(b / (1024.0 * 1024)).ToString("F1", CultureInfo.InvariantCulture)} MB";
        }

        return $"{(b / (1024.0 * 1024 * 1024)).ToString("F1", CultureInfo.InvariantCulture)} GB";
    }

    /// <summary>The localized page title (web <c>exportsList.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("exportsList.title", "Exports");
    }

    /// <summary>The localized page subtitle (web <c>exportsList.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "exportsList.subtitle",
            "Manage your past export jobs. Select rows to delete in bulk.");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>ExportsPage</c> surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a job id, type or count — so a diagnostics line can never
/// leak fleet content. Thread-safe.
/// </summary>
public sealed class ExportsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ExportsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ExportsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ExportsRegistration.Slug}");
    }
}

/// <summary>Null-tolerant JSON readers for the export-jobs parsers (mirrors the sibling feature-view helpers).</summary>
internal static class ExportsJson
{
    /// <summary>Read a string property, or null when absent / not a string.</summary>
    public static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Read an integer property, tolerating numeric or string-encoded values.</summary>
    public static long? Long(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
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
}
