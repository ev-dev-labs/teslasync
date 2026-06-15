using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>DiskForecastPage</c> surface — the native mirror of the four data
/// states the web page renders (web/src/features/admin/pages/DiskForecastPage.tsx). The web page runs the
/// <c>useDiskForecast</c> query and renders, in precedence order, the loading shimmer (web <c>query.isLoading</c>), the
/// subsystem-unavailable banner (web <c>subsystemMissing</c>, the HTTP 503 case) or the generic failure surface, the
/// fleet-totals stat grid plus the hypertables table (web <c>rows.length &gt; 0</c>) and otherwise the "no hypertables"
/// empty state. This enum is the top-level summary the ledger/Narrator key off; per-region visibility is still driven
/// by the projected flags so each branch renders exactly as the web composes them.
/// </summary>
public enum DiskForecastState
{
    /// <summary>The forecast query is in flight (web <c>query.isLoading</c>) — the panel shows the shimmer.</summary>
    Loading,

    /// <summary>The query resolved with no hypertables (web <c>rows.length === 0 &amp;&amp; !isLoading</c>).</summary>
    Empty,

    /// <summary>The query failed (web <c>subsystemMissing</c> 503, or any other error) — a banner / InfoBar is shown.</summary>
    Error,

    /// <summary>The query produced one or more hypertables (web <c>rows.length &gt; 0</c>) — stats + table render.</summary>
    Success,
}

/// <summary>
/// One per-hypertable disk-usage row — the native mirror of the web <c>HypertableSize</c>
/// (web/src/types/admin-operator-confidence.ts), itself a mirror of the Go DTO in
/// internal/database/observability/hypertable_metrics_repo.go. Byte counts and the chunk count are int64 on the wire;
/// the per-day growth is a float64; the days-to-quota estimate is a nullable int (absent when no quota is configured).
/// Field names mirror the Go snake_case JSON tags; parsing is null-tolerant so a partial object never throws. Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HypertableName">The TimescaleDB hypertable name (web <c>hypertable_name</c>); the table keys rows on this.</param>
/// <param name="TotalBytes">Total on-disk size in bytes (web <c>total_bytes</c>).</param>
/// <param name="UncompressedBytes">Uncompressed chunk bytes (web <c>uncompressed_bytes</c>).</param>
/// <param name="CompressedBytes">Compressed chunk bytes (web <c>compressed_bytes</c>).</param>
/// <param name="ChunkCount">Number of chunks (web <c>chunk_count</c>).</param>
/// <param name="GrowthBytesPerDay">Estimated growth in bytes per day (web <c>growth_bytes_per_day</c>).</param>
/// <param name="EstDaysToQuota">Estimated days until the configured quota is hit, null when no quota (web <c>est_days_to_quota</c>).</param>
/// <param name="Severity">The backend severity tier (web <c>severity</c>): ok / warn / critical / unknown.</param>
public sealed record HypertableSize(
    string HypertableName,
    long TotalBytes,
    long UncompressedBytes,
    long CompressedBytes,
    long ChunkCount,
    double GrowthBytesPerDay,
    long? EstDaysToQuota,
    string Severity)
{
    /// <summary>Read one hypertable row from a JSON object, tolerating missing / null fields.</summary>
    public static HypertableSize FromJson(JsonElement o)
    {
        return new HypertableSize(
            HypertableName: JsonReadHelpers.Str(o, "hypertable_name") ?? string.Empty,
            TotalBytes: JsonReadHelpers.Long(o, "total_bytes") ?? 0,
            UncompressedBytes: JsonReadHelpers.Long(o, "uncompressed_bytes") ?? 0,
            CompressedBytes: JsonReadHelpers.Long(o, "compressed_bytes") ?? 0,
            ChunkCount: JsonReadHelpers.Long(o, "chunk_count") ?? 0,
            GrowthBytesPerDay: JsonReadHelpers.Double(o, "growth_bytes_per_day") ?? 0.0,
            EstDaysToQuota: JsonReadHelpers.Long(o, "est_days_to_quota"),
            Severity: JsonReadHelpers.Str(o, "severity") ?? DiskForecastSeverity.Unknown);
    }
}

/// <summary>
/// The disk-forecast envelope — the native mirror of the web <c>DiskForecastResponse</c>: the list of
/// <see cref="HypertableSize"/> rows the page renders (web <c>query.data.hypertables</c>). Pure data; parsing is
/// null-tolerant so a non-object payload, or one without a <c>hypertables</c> array, resolves to the empty list.
/// </summary>
public sealed record DiskForecastSnapshot(IReadOnlyList<HypertableSize> Hypertables)
{
    /// <summary>The empty snapshot (no hypertables) — the default local-state feed result.</summary>
    public static DiskForecastSnapshot Empty { get; } = new(Array.Empty<HypertableSize>());

    /// <summary>Read the forecast response from JSON, tolerating a missing / null / non-array <c>hypertables</c> field.</summary>
    public static DiskForecastSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object ||
            !o.TryGetProperty("hypertables", out var arr) ||
            arr.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        var rows = new List<HypertableSize>(arr.GetArrayLength());
        foreach (var el in arr.EnumerateArray())
        {
            if (el.ValueKind == JsonValueKind.Object)
            {
                rows.Add(HypertableSize.FromJson(el));
            }
        }

        return new DiskForecastSnapshot(rows);
    }
}

/// <summary>
/// The backend severity tiers (web <c>DiskForecastSeverity</c>) — verbatim wire values so the snake/lower-case contract
/// is reproduced exactly. The display labels (OK / Warn / Critical / —) are the web's <c>SEVERITY_LABEL</c> constants
/// (not i18n keys), and the badge tone maps through <see cref="ToStatus"/> (the web <c>SEVERITY_VARIANT</c>).
/// </summary>
public static class DiskForecastSeverity
{
    /// <summary>Within thresholds (web <c>ok</c>).</summary>
    public const string Ok = "ok";

    /// <summary>Approaching the quota (web <c>warn</c>).</summary>
    public const string Warn = "warn";

    /// <summary>At/over the quota (web <c>critical</c>).</summary>
    public const string Critical = "critical";

    /// <summary>Severity could not be derived (web <c>unknown</c>).</summary>
    public const string Unknown = "unknown";

    /// <summary>The web <c>SEVERITY_VARIANT</c> map: ok→success, warn→warning, critical→danger, otherwise neutral.</summary>
    public static StatusKind ToStatus(string severity) => severity switch
    {
        Ok => StatusKind.Success,
        Warn => StatusKind.Warning,
        Critical => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>The web <c>SEVERITY_LABEL</c> map: ok→"OK", warn→"Warn", critical→"Critical", otherwise the em-dash.</summary>
    public static string ToLabel(string severity) => severity switch
    {
        Ok => "OK",
        Warn => "Warn",
        Critical => "Critical",
        Unknown => "\u2014",
        _ => severity,
    };
}

/// <summary>
/// The data port the <see cref="DiskForecastPageViewModel"/> reads the forecast through — the native parity of the web
/// <c>useDiskForecast</c> hook (GET /admin/observability/disk-forecast). The view never performs HTTP itself; the
/// default <see cref="EmptyDiskForecastFeed"/> resolves to the empty state, and the generated-client-backed
/// <see cref="DiskForecastClientFeed"/> binds to the generated OpenAPI contract client (ADR-004). A failing fetch
/// throws (carrying the HTTP status via <c>ApiException</c>) so the view-model can surface the 503
/// subsystem-unavailable branch distinctly from a generic failure, exactly as the web <c>subsystemMissing</c> check does.
/// </summary>
public interface IDiskForecastFeed
{
    /// <summary>Resolve the disk-forecast snapshot (web <c>useDiskForecast</c>).</summary>
    Task<DiskForecastSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every fetch to the empty snapshot (the empty data state).</summary>
public sealed class EmptyDiskForecastFeed : IDiskForecastFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDiskForecastFeed Instance { get; } = new();

    private EmptyDiskForecastFeed()
    {
    }

    /// <inheritdoc />
    public Task<DiskForecastSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(DiskForecastSnapshot.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>DiskForecastPage</c> projects from — the native analogue of the web page's
/// resolved query state (web/src/features/admin/pages/DiskForecastPage.tsx). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Rows">The hypertable rows (web <c>query.data.hypertables</c>).</param>
/// <param name="Loading">Whether the query is in flight with no data yet (web <c>query.isLoading</c>).</param>
/// <param name="HasError">Whether the query failed with a non-503 error.</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface.</param>
/// <param name="SubsystemMissing">Whether the query failed with HTTP 503 (web <c>subsystemMissing</c>).</param>
public sealed record DiskForecastModel(
    IReadOnlyList<HypertableSize> Rows,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    bool SubsystemMissing)
{
    /// <summary>The initial model — the first load, no data yet.</summary>
    public static DiskForecastModel Initial { get; } = new(
        Rows: Array.Empty<HypertableSize>(),
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        SubsystemMissing: false);
}

/// <summary>
/// One projected, render-ready fleet-summary stat card (web <c>StatCard</c>): the label, the formatted value and the
/// sublabel line. Pure data.
/// </summary>
public sealed record DiskForecastStatDisplay(string Label, string Value, string Sublabel);

/// <summary>
/// One projected, render-ready hypertable table row (web <c>DataTable</c> row). Every cell is already formatted at the
/// display boundary and every literal resolved through the i18n facade. Pure data.
/// </summary>
/// <param name="Key">The row identity (web <c>keyExtractor</c> → <c>hypertable_name</c>).</param>
/// <param name="HypertableName">The hypertable name cell (web <c>r.hypertable_name</c>).</param>
/// <param name="ChunkCountText">The chunk-count caption under the name (web <c>{{count}} chunks</c>).</param>
/// <param name="TotalText">The total-size cell (web <c>formatBytes(total_bytes)</c>).</param>
/// <param name="UncompressedText">The uncompressed-size line of the split cell (web <c>formatBytes(uncompressed_bytes)</c>).</param>
/// <param name="CompressedText">The compressed caption of the split cell (web <c>formatBytes(compressed_bytes) + ' compressed'</c>).</param>
/// <param name="GrowthText">The per-day growth cell (web <c>formatBytes(growth_bytes_per_day) + '/d'</c>).</param>
/// <param name="DaysText">The days-to-quota cell (web <c>fmtNumber(est_days_to_quota)</c> or the em-dash).</param>
/// <param name="SeverityLabel">The severity badge text (web <c>SEVERITY_LABEL</c>).</param>
/// <param name="SeverityVariant">The severity badge tone (web <c>SEVERITY_VARIANT</c>).</param>
/// <param name="AutomationName">The row's composed Narrator name.</param>
public sealed record DiskForecastRowDisplay(
    string Key,
    string HypertableName,
    string ChunkCountText,
    string TotalText,
    string UncompressedText,
    string CompressedText,
    string GrowthText,
    string DaysText,
    string SeverityLabel,
    StatusKind SeverityVariant,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade and every number formatted at the display boundary.
/// Holds the always-visible page header, the subsystem-unavailable banner, the four data-state flags (each a visible
/// region), the fleet-totals stat grid (the four stat-card panels) and the hypertables table panel (GlassPanel 5) with
/// its column headers and projected rows. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record DiskForecastDisplay(
    DiskForecastState State,
    string Title,
    string Subtitle,
    bool ShowSubsystemUnavailable,
    string SubsystemTitle,
    string SubsystemMessage,
    bool ShowLoading,
    string LoadingText,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    bool ShowEmpty,
    string EmptyTitle,
    string EmptyMessage,
    bool ShowStats,
    DiskForecastStatDisplay TotalCard,
    DiskForecastStatDisplay UncompressedCard,
    DiskForecastStatDisplay CompressedCard,
    DiskForecastStatDisplay GrowthCard,
    bool ShowTablePanel,
    string TableTitle,
    bool ShowTable,
    string ColTable,
    string ColTotal,
    string ColSplit,
    string ColGrowth,
    string ColDays,
    string ColSeverity,
    string EmptyTableMessage,
    IReadOnlyList<DiskForecastRowDisplay> Rows,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="DiskForecastModel"/> to its <see cref="DiskForecastDisplay"/> — the native port of
/// the render logic in web/src/features/admin/pages/DiskForecastPage.tsx. Every visible literal resolves through the
/// i18n facade using the exact web key names; byte counts format through <see cref="FormatBytes(double)"/> (the web
/// <c>formatBytes</c>) and the days-to-quota estimate through <see cref="NumberFormatting"/> at the web
/// <c>fmtNumber</c> default precision, so the C# output matches the web truth. Every chrome string is resolved on
/// every projection (visibility is gated by the returned flags), so the i18n contract holds in every data state. No
/// WinUI types — unit-tested without a UI host.
/// </summary>
public static class DiskForecastProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    // The web fmtNumber default precision (getGlobalPrecision() === 2); est_days_to_quota uses it (web fmtNumber(value)).
    private const int DaysPrecision = 2;

    private const long Kib = 1024L;
    private const long Mib = 1024L * 1024L;
    private const long Gib = 1024L * 1024L * 1024L;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static DiskForecastDisplay Project(DiskForecastModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Page header (web PageContainer title + subtitle) ────────────────────────────────────────────────
        string title = localizer.GetString("admin.diskForecast.pageTitle", "Disk Forecast");
        string subtitle = localizer.GetString(
            "admin.diskForecast.subtitle",
            "Per-hypertable disk usage with compressed/uncompressed split and days-to-quota estimate. Severity reflects the configured quota threshold.");

        // ── Subsystem-unavailable banner (web 503 subsystemMissing AlertBanner) ─────────────────────────────
        string subsystemTitle = localizer.GetString("admin.subsystem.unavailableTitle", "Subsystem unavailable");
        string subsystemMessage = localizer.GetString(
            "admin.diskForecast.notConfigured",
            "TimescaleDB hypertable metrics are unavailable on this deployment. This page requires TimescaleDB to be installed and accessible.");

        // ── Generic failure surface (native InfoBar + Retry) ────────────────────────────────────────────────
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        // ── Loading + empty branches ────────────────────────────────────────────────────────────────────────
        string loadingText = localizer.GetString("common.loading", "Loading...");
        string emptyTitle = localizer.GetString("admin.diskForecast.emptyTitle", "No hypertables");
        string emptyMessage = localizer.GetString(
            "admin.diskForecast.emptyMessage",
            "No hypertables found in this database. The disk forecast surfaces TimescaleDB hypertables only.");
        string emptyTableMessage = localizer.GetString("admin.diskForecast.emptyTable", "No hypertables");

        // ── Fleet totals (web fleetTotals reduce) ───────────────────────────────────────────────────────────
        var rows = model.Rows;
        double totalBytes = 0, uncompressedBytes = 0, compressedBytes = 0, growthBytes = 0;
        foreach (var r in rows)
        {
            totalBytes += r.TotalBytes;
            uncompressedBytes += r.UncompressedBytes;
            compressedBytes += r.CompressedBytes;
            growthBytes += r.GrowthBytesPerDay;
        }

        string tableCountSub = Format(
            localizer.GetString("admin.diskForecast.tableCount", "{0} hypertables"),
            FormatCount(rows.Count));

        var totalCard = new DiskForecastStatDisplay(
            Label: localizer.GetString("admin.diskForecast.fleetTotal", "Total disk"),
            Value: FormatBytes(totalBytes),
            Sublabel: tableCountSub);

        string percentTemplate = localizer.GetString("admin.diskForecast.percentSub", "{0}% of total");
        var uncompressedCard = new DiskForecastStatDisplay(
            Label: localizer.GetString("admin.diskForecast.fleetUncompressed", "Uncompressed"),
            Value: FormatBytes(uncompressedBytes),
            Sublabel: totalBytes > 0 ? Format(percentTemplate, Percent(uncompressedBytes, totalBytes)) : EmDash);

        var compressedCard = new DiskForecastStatDisplay(
            Label: localizer.GetString("admin.diskForecast.fleetCompressed", "Compressed"),
            Value: FormatBytes(compressedBytes),
            Sublabel: totalBytes > 0 ? Format(percentTemplate, Percent(compressedBytes, totalBytes)) : EmDash);

        var growthCard = new DiskForecastStatDisplay(
            Label: localizer.GetString("admin.diskForecast.fleetGrowth", "Growth (per day)"),
            Value: $"{FormatBytes(growthBytes)}/d",
            Sublabel: localizer.GetString("admin.diskForecast.growthSub", "Sum across all hypertables"));

        // ── Table column headers (web columns[].header) ─────────────────────────────────────────────────────
        string colTable = localizer.GetString("admin.diskForecast.colTable", "Hypertable");
        string colTotal = localizer.GetString("admin.diskForecast.colTotal", "Total");
        string colSplit = localizer.GetString("admin.diskForecast.colSplit", "Uncompressed / compressed");
        string colGrowth = localizer.GetString("admin.diskForecast.colGrowth", "Growth (per day)");
        string colDays = localizer.GetString("admin.diskForecast.colDays", "Days to quota");
        string colSeverity = localizer.GetString("admin.diskForecast.colSeverity", "Severity");
        string tableTitle = localizer.GetString("admin.diskForecast.tableTitle", "Hypertables");

        string chunkTemplate = localizer.GetString("admin.diskForecast.chunkCount", "{0} chunks");
        string compressedSuffix = localizer.GetString("admin.diskForecast.compressedSuffix", "compressed");

        var rowDisplays = new List<DiskForecastRowDisplay>(rows.Count);
        foreach (var r in rows)
        {
            string severity = string.IsNullOrEmpty(r.Severity) ? DiskForecastSeverity.Unknown : r.Severity;
            string total = FormatBytes(r.TotalBytes);
            string uncompressed = FormatBytes(r.UncompressedBytes);
            string compressed = $"{FormatBytes(r.CompressedBytes)} {compressedSuffix}";
            string growth = $"{FormatBytes(r.GrowthBytesPerDay)}/d";
            string days = r.EstDaysToQuota is null ? EmDash : FormatDays(r.EstDaysToQuota.Value);
            string severityLabel = DiskForecastSeverity.ToLabel(severity);
            string chunkText = Format(chunkTemplate, FormatCount(r.ChunkCount));

            rowDisplays.Add(new DiskForecastRowDisplay(
                Key: r.HypertableName,
                HypertableName: r.HypertableName,
                ChunkCountText: chunkText,
                TotalText: total,
                UncompressedText: uncompressed,
                CompressedText: compressed,
                GrowthText: growth,
                DaysText: days,
                SeverityLabel: severityLabel,
                SeverityVariant: DiskForecastSeverity.ToStatus(severity),
                AutomationName: $"{r.HypertableName}, {total}, {severityLabel}"));
        }

        // ── State selection (web render precedence) ─────────────────────────────────────────────────────────
        bool hasRows = rows.Count > 0;
        bool showLoading = model.Loading;
        bool showSubsystem = !model.Loading && model.SubsystemMissing;
        bool showError = !model.Loading && !model.SubsystemMissing && model.HasError;
        bool showSuccess = !model.Loading && !model.SubsystemMissing && !model.HasError && hasRows;
        bool showEmpty = !model.Loading && !model.SubsystemMissing && !model.HasError && !hasRows;

        DiskForecastState state = showLoading
            ? DiskForecastState.Loading
            : (showSubsystem || showError)
                ? DiskForecastState.Error
                : showSuccess
                    ? DiskForecastState.Success
                    : DiskForecastState.Empty;

        return new DiskForecastDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowSubsystemUnavailable: showSubsystem,
            SubsystemTitle: subsystemTitle,
            SubsystemMessage: subsystemMessage,
            ShowLoading: showLoading,
            LoadingText: loadingText,
            ShowError: showError,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowEmpty: showEmpty,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            ShowStats: showSuccess,
            TotalCard: totalCard,
            UncompressedCard: uncompressedCard,
            CompressedCard: compressedCard,
            GrowthCard: growthCard,
            ShowTablePanel: showSuccess || showEmpty,
            TableTitle: tableTitle,
            ShowTable: showSuccess,
            ColTable: colTable,
            ColTotal: colTotal,
            ColSplit: colSplit,
            ColGrowth: colGrowth,
            ColDays: colDays,
            ColSeverity: colSeverity,
            EmptyTableMessage: emptyTableMessage,
            Rows: rowDisplays,
            AutomationName: title);
    }

    /// <summary>Format a count with en-US grouping (web <c>fmtNumber</c> at 0 decimals).</summary>
    public static string FormatCount(long value) => NumberFormatting.Format(value, null, 0);

    /// <summary>Format the days-to-quota estimate at the web <c>fmtNumber</c> default precision (en-US grouping).</summary>
    public static string FormatDays(long value) => NumberFormatting.Format(value, null, DaysPrecision);

    /// <summary>
    /// Format a byte count with binary units (web <c>formatBytes</c>): the raw value with a "B" suffix below 1 KiB,
    /// then KB / MB / GB each with one fixed decimal. Mirrors the web's <c>toFixed(1)</c> (no grouping) so the C#
    /// output matches; the sub-KiB branch prints the shortest round-trip decimal exactly as the web's template literal.
    /// </summary>
    public static string FormatBytes(double bytes)
    {
        if (bytes < Kib)
        {
            return $"{bytes.ToString(CultureInfo.InvariantCulture)} B";
        }

        if (bytes < Mib)
        {
            return $"{Fixed1(bytes / Kib)} KB";
        }

        if (bytes < Gib)
        {
            return $"{Fixed1(bytes / Mib)} MB";
        }

        return $"{Fixed1(bytes / Gib)} GB";
    }

    // web ((part / total) * 100).toFixed(1) — one fixed decimal, no grouping.
    private static string Percent(double part, double total) => Fixed1(part / total * 100.0);

    private static string Fixed1(double value) => value.ToString("F1", CultureInfo.InvariantCulture);

    private static string Format(string template, string value) =>
        string.Format(CultureInfo.CurrentCulture, template, value);
}

/// <summary>
/// Canonical metadata for the <c>DiskForecastPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/admin/pages/DiskForecastPage.tsx</c> (route <c>/admin/disk-forecast</c>, nav name
/// <c>DiskForecast</c>).
/// </summary>
public static class DiskForecastRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DiskForecastPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>DiskForecast</c>).</summary>
    public const string RouteName = "DiskForecast";

    /// <summary>The generated OpenAPI operation id for the forecast query (web <c>useDiskForecast</c>).</summary>
    public const string Operation = "get_api_v1_admin_observability_disk_forecast";

    /// <summary>The localized page title (web <c>admin.diskForecast.pageTitle</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("admin.diskForecast.pageTitle", "Disk Forecast");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>DiskForecastPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a hypertable name or byte count — so a
/// diagnostics line can never leak deployment topology. Thread-safe.
/// </summary>
public sealed class DiskForecastDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DiskForecastDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DiskForecastPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DiskForecastRegistration.Slug}");
    }
}
