using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The mutually-exclusive top-level lifecycle state of the <c>DataExportPage</c> surface — the native mirror of the
/// data states the web page renders (web/src/features/system/pages/DataExportPage.tsx). The web page runs the
/// export-jobs + vehicles queries through a <c>PageContainer</c> and renders, in precedence order, the loading
/// state (web <c>isLoading</c>), the failure surface (web <c>error</c>), the "no exports yet" empty history (web
/// <c>jobs.length === 0</c>) or the populated surface (web <c>jobs.map</c>). Per-region visibility is still driven by
/// the projected flags so each branch renders exactly as the web composes it.
/// </summary>
public enum DataExportState
{
    /// <summary>The export-jobs / vehicles query is in flight (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>The query resolved with no jobs (web <c>jobs.length === 0</c>) — the empty history shows.</summary>
    Empty,

    /// <summary>The export-jobs query failed (web <c>jobsError</c>) — the failure surface + retry shows.</summary>
    Error,

    /// <summary>The query produced jobs (web <c>jobs.length &gt; 0</c>) — the history table renders.</summary>
    Success,
}

/// <summary>
/// One export-job summary — the native mirror of the web <c>ExportJobSummary</c> (id, type, format, status, optional
/// vehicle id, record count, byte size, duration and the ISO created timestamp). Field names mirror the Go
/// <c>models.ExportJobSummary</c> snake_case JSON tags; parsing is null-tolerant. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record ExportJobSummary(
    string Id,
    string Type,
    string Format,
    string Status,
    long? VehicleId,
    long? RecordCount,
    long? FileSize,
    long? DurationMs,
    string? ErrorMessage,
    string? CreatedAt)
{
    /// <summary>The parsed creation instant, or <see langword="null"/> when absent / unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => ParseTimestamp(CreatedAt);

    /// <summary>True when the job's artifact is downloadable (web <c>status === 'ready'</c>).</summary>
    public bool IsReady => string.Equals(Status, "ready", StringComparison.OrdinalIgnoreCase);

    /// <summary>True when the job is still being produced (web <c>queued</c> / <c>processing</c>).</summary>
    public bool IsActive =>
        string.Equals(Status, "queued", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(Status, "processing", StringComparison.OrdinalIgnoreCase);

    /// <summary>Read one job from a JSON object, tolerating missing / null fields.</summary>
    public static ExportJobSummary FromJson(JsonElement o) => new(
        Id: DataExportJson.Str(o, "id") ?? string.Empty,
        Type: DataExportJson.Str(o, "type") ?? string.Empty,
        Format: DataExportJson.Str(o, "format") ?? string.Empty,
        Status: DataExportJson.Str(o, "status") ?? string.Empty,
        VehicleId: DataExportJson.Long(o, "vehicle_id"),
        RecordCount: DataExportJson.Long(o, "record_count"),
        FileSize: DataExportJson.Long(o, "file_size"),
        DurationMs: DataExportJson.Long(o, "duration_ms"),
        ErrorMessage: DataExportJson.Str(o, "error_message"),
        CreatedAt: DataExportJson.Str(o, "created_at"));

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
/// One vehicle the wizard / account panel can scope an export to — the native mirror of the web <c>Vehicle</c> fields
/// the page reads (<c>id</c>, <c>display_name</c>, <c>vin</c>). The <see cref="Label"/> mirrors the web
/// <c>display_name || vin</c> fallback. Pure data; parsing is null-tolerant.
/// </summary>
public sealed record VehicleSummary(long Id, string? DisplayName, string? Vin)
{
    /// <summary>The display label (web <c>display_name || vin || "Vehicle {id}"</c>).</summary>
    public string Label =>
        !string.IsNullOrWhiteSpace(DisplayName) ? DisplayName! :
        !string.IsNullOrWhiteSpace(Vin) ? Vin! :
        $"Vehicle {Id.ToString(CultureInfo.InvariantCulture)}";

    /// <summary>Read one vehicle from a JSON object, tolerating missing / null fields.</summary>
    public static VehicleSummary FromJson(JsonElement o) => new(
        Id: DataExportJson.Long(o, "id") ?? 0,
        DisplayName: DataExportJson.Str(o, "display_name"),
        Vin: DataExportJson.Str(o, "vin"));
}

/// <summary>
/// One publishable column entry — the native mirror of the web <c>ExportColumnInfo</c>
/// (<c>{ name, label, always_included }</c>). Required columns cannot be unchecked. Pure data.
/// </summary>
public sealed record ExportColumnInfo(string Name, string Label, bool AlwaysIncluded)
{
    /// <summary>Read one column from a JSON object, tolerating missing / null fields.</summary>
    public static ExportColumnInfo FromJson(JsonElement o) => new(
        Name: DataExportJson.Str(o, "name") ?? string.Empty,
        Label: DataExportJson.Str(o, "label") ?? string.Empty,
        AlwaysIncluded: DataExportJson.Bool(o, "always_included"));
}

/// <summary>
/// The column catalog for one export type — the native mirror of the web <c>ExportColumnsResponse</c>
/// (<c>{ type, columns, supports_selection }</c>). The picker hides itself when selection is unsupported or the catalog
/// is empty. Pure data; the tolerant parser unwraps the platform <c>{data:…}</c> envelope.
/// </summary>
public sealed record ExportColumnsCatalog(string Type, bool SupportsSelection, IReadOnlyList<ExportColumnInfo> Columns)
{
    /// <summary>The empty catalog (no selection support).</summary>
    public static ExportColumnsCatalog Empty { get; } = new(string.Empty, false, Array.Empty<ExportColumnInfo>());

    /// <summary>True when the wizard should render the column picker (web <c>supports_selection &amp;&amp; columns.length</c>).</summary>
    public bool CanSelect => SupportsSelection && Columns.Count > 0;

    /// <summary>Read the catalog from JSON, tolerating the platform <c>{data:…}</c> envelope and missing fields.</summary>
    public static ExportColumnsCatalog FromJson(JsonElement root)
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

        var columns = new List<ExportColumnInfo>();
        if (o.TryGetProperty("columns", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var element in arr.EnumerateArray())
            {
                if (element.ValueKind == JsonValueKind.Object)
                {
                    columns.Add(ExportColumnInfo.FromJson(element));
                }
            }
        }

        return new ExportColumnsCatalog(
            Type: DataExportJson.Str(o, "type") ?? string.Empty,
            SupportsSelection: DataExportJson.Bool(o, "supports_selection"),
            Columns: columns);
    }
}

/// <summary>
/// The export-jobs envelope — the native mirror of the web <c>useQuery(['export-jobs'])</c> result: the parsed
/// <see cref="Jobs"/> plus a <see cref="HasData"/> marker recording whether the server returned a response. The
/// tolerant parser accepts either a bare JSON array or the platform <c>{data:[…]}</c> envelope. Pure data.
/// </summary>
public sealed record ExportJobsSnapshot(bool HasData, IReadOnlyList<ExportJobSummary> Jobs)
{
    /// <summary>The empty snapshot (no response yet).</summary>
    public static ExportJobsSnapshot Empty { get; } = new(false, Array.Empty<ExportJobSummary>());

    /// <summary>Read the export-jobs list from JSON, tolerating the platform envelope and a bare array.</summary>
    public static ExportJobsSnapshot FromJson(JsonElement root) =>
        new(true, DataExportJson.ReadObjectArray(root, ExportJobSummary.FromJson));
}

/// <summary>
/// The vehicles envelope — the native mirror of the web <c>useQuery(['vehicles'])</c> result. Pure data; the tolerant
/// parser unwraps the platform <c>{data:[…]}</c> envelope.
/// </summary>
public sealed record VehiclesSnapshot(bool HasData, IReadOnlyList<VehicleSummary> Vehicles)
{
    /// <summary>The empty snapshot (no response yet).</summary>
    public static VehiclesSnapshot Empty { get; } = new(false, Array.Empty<VehicleSummary>());

    /// <summary>Read the vehicles list from JSON, tolerating the platform envelope and a bare array.</summary>
    public static VehiclesSnapshot FromJson(JsonElement root) =>
        new(true, DataExportJson.ReadObjectArray(root, VehicleSummary.FromJson));
}

/// <summary>
/// The wizard's submit payload — the native mirror of the web <c>ExportSubmitPayload</c>. The optional column allowlist
/// is omitted (null) when the user kept the default selection so the backend preserves byte-for-byte legacy behaviour.
/// </summary>
public sealed record ExportSubmitPayload(
    string Type,
    string Format,
    long? VehicleId,
    string? Start,
    string? End,
    IReadOnlyList<string>? Columns);

/// <summary>The "Download my data" payload — the native mirror of the web <c>CreateAccountExportPayload</c>.</summary>
public sealed record AccountExportPayload(long? VehicleId, string? Start, string? End);

/// <summary>
/// The data port the <see cref="DataExportPageViewModel"/> reads through — the native parity of the web hooks the page
/// composes: the export-jobs query (web <c>useQuery(['export-jobs'])</c>), the vehicles query
/// (web <c>useQuery(['vehicles'])</c>), the column catalog (web <c>useExportColumns</c> → GET /exports/columns), the
/// account export (web <c>useCreateAccountExport</c> → POST /export/jobs/account) and the generic submit
/// (web <c>submitExport</c> → POST /export/jobs). The view never performs HTTP itself; the default
/// <see cref="EmptyDataExportFeed"/> resolves to the empty state and the generated-client-backed
/// <see cref="DataExportClientFeed"/> binds to the generated OpenAPI contract client (ADR-004).
/// </summary>
public interface IDataExportFeed
{
    /// <summary>The API origin a finished job's artifact is downloaded from, or <see langword="null"/> when unknown.</summary>
    Uri? DownloadBaseUri { get; }

    /// <summary>Resolve the export-jobs list (web <c>useQuery(['export-jobs'])</c>).</summary>
    Task<ExportJobsSnapshot> FetchJobsAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the vehicles list (web <c>useQuery(['vehicles'])</c>).</summary>
    Task<VehiclesSnapshot> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the column catalog for an export type (web <c>useExportColumns</c>).</summary>
    Task<ExportColumnsCatalog> FetchColumnsAsync(string catalogType, CancellationToken cancellationToken);

    /// <summary>Submit a generic export (web <c>submitExport</c> → POST /export/jobs).</summary>
    Task SubmitExportAsync(ExportSubmitPayload payload, CancellationToken cancellationToken);

    /// <summary>Queue a full account export (web <c>useCreateAccountExport</c> → POST /export/jobs/account).</summary>
    Task CreateAccountExportAsync(AccountExportPayload payload, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every read to the empty snapshot and every write to a no-op.</summary>
public sealed class EmptyDataExportFeed : IDataExportFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDataExportFeed Instance { get; } = new();

    private EmptyDataExportFeed()
    {
    }

    /// <inheritdoc />
    public Uri? DownloadBaseUri => null;

    /// <inheritdoc />
    public Task<ExportJobsSnapshot> FetchJobsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(ExportJobsSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<VehiclesSnapshot> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(VehiclesSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<ExportColumnsCatalog> FetchColumnsAsync(string catalogType, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(ExportColumnsCatalog.Empty);
    }

    /// <inheritdoc />
    public Task SubmitExportAsync(ExportSubmitPayload payload, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task CreateAccountExportAsync(AccountExportPayload payload, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

/// <summary>
/// The render-time data model the <c>DataExportPage</c> projects from — the native analogue of the web page's resolved
/// queries plus the wizard / account / column-picker local state (web/src/features/system/pages/DataExportPage.tsx).
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record DataExportModel(
    IReadOnlyList<ExportJobSummary> Jobs,
    IReadOnlyList<VehicleSummary> Vehicles,
    bool JobsLoading,
    bool VehiclesLoading,
    bool HasError,
    string? ErrorDetail,
    WizardSelection Wizard,
    ColumnCatalogState Columns,
    AccountSelection Account,
    bool AccountBusy,
    bool SubmitBusy,
    Uri? DownloadBase,
    DateTimeOffset Now)
{
    /// <summary>The initial model — the first load, no data yet, default wizard / account selection.</summary>
    public static DataExportModel Initial { get; } = new(
        Jobs: Array.Empty<ExportJobSummary>(),
        Vehicles: Array.Empty<VehicleSummary>(),
        JobsLoading: true,
        VehiclesLoading: true,
        HasError: false,
        ErrorDetail: null,
        Wizard: WizardSelection.Default,
        Columns: ColumnCatalogState.Idle,
        Account: AccountSelection.Default,
        AccountBusy: false,
        SubmitBusy: false,
        DownloadBase: null,
        Now: DateTimeOffset.UnixEpoch);
}

/// <summary>
/// The wizard's local selection — the native mirror of the web <c>ExportWizard</c> component state (export type,
/// format, scoped vehicle, the date preset / custom-range toggle and the optional column allowlist where
/// <see langword="null"/> means "untouched: submit without columns"). Pure data.
/// </summary>
public sealed record WizardSelection(
    string Type,
    string Format,
    string VehicleId,
    int PresetDays,
    bool UseCustomRange,
    string CustomStart,
    string CustomEnd,
    IReadOnlyList<string>? SelectedColumns)
{
    /// <summary>The wizard's initial selection (web defaults: drives / csv / all vehicles / last 30 days).</summary>
    public static WizardSelection Default { get; } = new(
        Type: "drives",
        Format: "csv",
        VehicleId: string.Empty,
        PresetDays: 30,
        UseCustomRange: false,
        CustomStart: string.Empty,
        CustomEnd: string.Empty,
        SelectedColumns: null);
}

/// <summary>
/// The column-catalog fetch state for the wizard's current export type — the native mirror of the web
/// <c>useExportColumns</c> query lifecycle (loading / error / resolved catalog) keyed by the catalog type.
/// </summary>
public sealed record ColumnCatalogState(string CatalogType, bool Loading, bool HasError, ExportColumnsCatalog Catalog)
{
    /// <summary>The idle state (no catalog type → picker hidden).</summary>
    public static ColumnCatalogState Idle { get; } = new(string.Empty, false, false, ExportColumnsCatalog.Empty);
}

/// <summary>The "Download my data" panel's local selection — the native mirror of the web <c>AccountExportPanel</c> state.</summary>
public sealed record AccountSelection(string VehicleId, string Start, string End)
{
    /// <summary>The account panel's initial selection (web default: all vehicles, no date range).</summary>
    public static AccountSelection Default { get; } = new("all", string.Empty, string.Empty);
}

/// <summary>
/// Tolerant JSON readers shared across the data-export parsers — the native parity of the page's defensive
/// <c>?.</c> / <c>?? ''</c> field reads. Each accessor returns <see langword="null"/> / a zero default when the field is
/// absent or the wrong kind so a partial server payload never throws. UI-free.
/// </summary>
internal static class DataExportJson
{
    /// <summary>Read a string field, tolerating absence / null / non-string kinds.</summary>
    public static string? Str(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    /// <summary>Read an integer field, tolerating absence / null / non-number kinds.</summary>
    public static long? Long(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) &&
        v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n)
            ? n
            : null;

    /// <summary>Read a boolean field, defaulting to <see langword="false"/> when absent / wrong kind.</summary>
    public static bool Bool(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) &&
        (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False) && v.GetBoolean();

    /// <summary>Read an array of objects, unwrapping the platform <c>{data:[…]}</c> envelope; non-arrays yield empty.</summary>
    public static IReadOnlyList<T> ReadObjectArray<T>(JsonElement root, Func<JsonElement, T> read)
    {
        ArgumentNullException.ThrowIfNull(read);

        JsonElement arr = root;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("data", out var data))
        {
            arr = data;
        }

        if (arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<T>();
        }

        var rows = new List<T>();
        foreach (var element in arr.EnumerateArray())
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
                rows.Add(read(element));
            }
        }

        return rows;
    }
}

/// <summary>
/// Canonical metadata + UI-free formatting helpers for the <c>DataExportPage</c> feature surface — the native mirror of
/// the web page at <c>web/src/features/system/pages/DataExportPage.tsx</c> (route <c>/data-export</c>, nav name
/// <c>DataExport</c>). Holds the generated OpenAPI operation ids the client feed binds to (ADR-004), the export type /
/// format / status / preset catalogs and the byte/int/duration formatters ported 1:1 from the web helpers.
/// </summary>
public static class DataExportRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DataExportPage";

    /// <summary>The navigation route name this page registers under.</summary>
    public const string RouteName = "DataExport";

    /// <summary>The deep-link route the web page lives at (web route <c>/data-export</c>).</summary>
    public const string WebRoute = "/data-export";

    /// <summary>The generated OpenAPI operation id for the export-jobs list (web <c>useQuery(['export-jobs'])</c>).</summary>
    public const string JobsOperation = "get_api_v1_export_jobs";

    /// <summary>The generated OpenAPI operation id for the vehicles list (web <c>useQuery(['vehicles'])</c>).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>The generated OpenAPI operation id for the column catalog (web <c>useExportColumns</c>).</summary>
    public const string ColumnsOperation = "get_api_v1_exports_columns";

    /// <summary>The generated OpenAPI operation id for the generic submit (web <c>submitExport</c>).</summary>
    public const string SubmitOperation = "post_api_v1_export_jobs";

    /// <summary>The generated OpenAPI operation id for the account export (web <c>useCreateAccountExport</c>).</summary>
    public const string AccountOperation = "post_api_v1_export_jobs_account";

    /// <summary>The Segoe Fluent Icons glyph for the page / empty-history (web <c>fileDown</c>).</summary>
    public const string FileDownGlyph = "\uE74B"; // Download / save-as

    /// <summary>The absolute download path for a finished job (web <c>/api/v1/export/jobs/{id}/download</c>).</summary>
    public static string DownloadPath(string id) =>
        $"/api/v1/export/jobs/{Uri.EscapeDataString(id)}/download";

    /// <summary>The seven export-type catalog rows (web <c>EXPORT_TYPES</c>): value, i18n key + default, glyph, badge.</summary>
    public static IReadOnlyList<ExportTypeCatalogEntry> Types { get; } =
    [
        new("drives", "dataExport.types.drives", "Drives", "dataExport.types.drivesDesc", "Export drive sessions, routes, and efficiency data", "\uE804", StatusKind.Info),
        new("charging", "dataExport.types.charging", "Charging", "dataExport.types.chargingDesc", "Export charging sessions and energy data", "\uE945", StatusKind.Success),
        new("trips", "dataExport.types.trips", "Trips", "dataExport.types.tripsDesc", "Export trip summaries with SI aggregate columns", "\uE7C0", StatusKind.Info),
        new("analytics", "dataExport.types.analytics", "Analytics", "dataExport.types.analyticsDesc", "Export analytics and aggregated statistics", "\uE9D9", StatusKind.Neutral),
        new("full_backup", "dataExport.types.fullBackup", "Full Backup", "dataExport.types.fullBackupDesc", "Complete database backup of all vehicle data", "\uE8F1", StatusKind.Warning),
        new("maintenance", "dataExport.types.maintenance", "Maintenance", "dataExport.types.maintenanceDesc", "Export maintenance and service records", "\uE90F", StatusKind.Danger),
        new("energy", "dataExport.types.energy", "Energy", "dataExport.types.energyDesc", "Export energy consumption and efficiency data", "\uEBAA", StatusKind.Success),
    ];

    /// <summary>The two export-format catalog rows (web <c>EXPORT_FORMATS</c>).</summary>
    public static IReadOnlyList<ExportFormatCatalogEntry> Formats { get; } =
    [
        new("csv", "dataExport.formats.csv", "CSV", "\uE9F9"),
        new("json", "dataExport.formats.json", "JSON", "\uE943"),
    ];

    /// <summary>The five date-preset rows (web <c>DATE_PRESETS</c>): i18n key, default label, day span (0 = all time).</summary>
    public static IReadOnlyList<DatePresetCatalogEntry> Presets { get; } =
    [
        new("dataExport.presets.last7", "Last 7 Days", 7),
        new("dataExport.presets.last30", "Last 30 Days", 30),
        new("dataExport.presets.last90", "Last 90 Days", 90),
        new("dataExport.presets.lastYear", "Last Year", 365),
        new("dataExport.presets.allTime", "All Time", 0),
    ];

    /// <summary>The catalog type the column picker fetches for an export type (web <c>catalogTypeFor</c>).</summary>
    public static string CatalogTypeFor(string exportType) => exportType switch
    {
        "drives" => "drives",
        "charging" => "charging",
        _ => string.Empty,
    };

    /// <summary>Map a status token onto the semantic chip colour (web <c>STATUS_CONFIG.badgeVariant</c>).</summary>
    public static StatusKind StatusBadgeFor(string status) => (status ?? string.Empty).ToLowerInvariant() switch
    {
        "ready" => StatusKind.Success,
        "processing" => StatusKind.Info,
        "failed" => StatusKind.Danger,
        "expired" => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    /// <summary>The localized status label (web <c>STATUS_CONFIG.label</c>).</summary>
    public static (string Key, string Default) StatusLabel(string status) => (status ?? string.Empty).ToLowerInvariant() switch
    {
        "queued" => ("dataExport.status.queued", "Queued"),
        "processing" => ("dataExport.status.processing", "Processing"),
        "ready" => ("dataExport.status.ready", "Ready"),
        "failed" => ("dataExport.status.failed", "Failed"),
        "expired" => ("dataExport.status.expired", "Expired"),
        _ => ("dataExport.status.unknown", string.IsNullOrEmpty(status) ? "Unknown" : status),
    };

    /// <summary>The status glyph (web <c>STATUS_CONFIG.icon</c>).</summary>
    public static string StatusGlyph(string status) => (status ?? string.Empty).ToLowerInvariant() switch
    {
        "queued" => "\uE823",
        "processing" => "\uE895",
        "ready" => "\uE73E",
        "failed" => "\uE783",
        "expired" => "\uE7BA",
        _ => "\uE823",
    };

    /// <summary>The localized page title (web <c>dataExport.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("dataExport.title", "Data Export");
    }

    /// <summary>The localized page subtitle (web <c>dataExport.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("dataExport.subtitle", "Export vehicle data in CSV or JSON format");
    }

    /// <summary>
    /// Format a byte count exactly as the web <c>formatBytes(bytes, { zeroAsEmpty: true, gbDecimals: 2 })</c> does:
    /// a null size renders the em-dash; zero renders empty; then "N B" / "N.N KB" / "N.N MB" / "N.NN GB".
    /// </summary>
    public static string FormatBytes(long? bytes)
    {
        if (bytes is not { } b)
        {
            return DataExportProjection.EmDash;
        }

        if (b == 0)
        {
            return string.Empty;
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

        return $"{(b / (1024.0 * 1024 * 1024)).ToString("F2", CultureInfo.InvariantCulture)} GB";
    }

    /// <summary>Format an integer with en-US grouping (web <c>fmtInt</c>); a null value renders the em-dash.</summary>
    public static string FormatInt(long? value) =>
        value is { } v ? NumberFormatting.Format(v, null, 0) : DataExportProjection.EmDash;

    /// <summary>
    /// Format a millisecond duration exactly as the web <c>formatDurationMsLong</c> does: <c>&lt;= 0</c> / null →
    /// em-dash; <c>&lt; 1000</c> → "{ms}ms"; <c>&lt; 60s</c> → "{s.s}s"; else "{m}m {round(s)}s".
    /// </summary>
    public static string FormatDuration(long? ms)
    {
        if (ms is not { } value || value <= 0)
        {
            return DataExportProjection.EmDash;
        }

        if (value < 1000)
        {
            return $"{value.ToString(CultureInfo.InvariantCulture)}ms";
        }

        double sec = value / 1000.0;
        if (sec < 60)
        {
            return $"{sec.ToString("F1", CultureInfo.InvariantCulture)}s";
        }

        long min = (long)Math.Floor(sec / 60);
        long remSec = (long)Math.Round(sec % 60, MidpointRounding.AwayFromZero);
        return $"{min.ToString(CultureInfo.InvariantCulture)}m {remSec.ToString(CultureInfo.InvariantCulture)}s";
    }
}

/// <summary>One export-type catalog row (web <c>EXPORT_TYPES</c> entry).</summary>
public sealed record ExportTypeCatalogEntry(
    string Value,
    string LabelKey,
    string LabelDefault,
    string DescKey,
    string DescDefault,
    string Glyph,
    StatusKind Badge);

/// <summary>One export-format catalog row (web <c>EXPORT_FORMATS</c> entry).</summary>
public sealed record ExportFormatCatalogEntry(string Value, string LabelKey, string LabelDefault, string Glyph);

/// <summary>One date-preset catalog row (web <c>DATE_PRESETS</c> entry).</summary>
public sealed record DatePresetCatalogEntry(string LabelKey, string LabelDefault, int Days);
