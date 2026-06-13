using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="DataPipelineSectionViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>DataPipelineSection</c> renders
/// (web/src/features/system/components/status/DataPipelineSection.tsx). The web component folds two
/// independent queries (<c>getCompressionStats</c> and <c>getExportJobs</c>) and shows its skeleton while
/// either is still loading (<c>compLoading || exportLoading</c>); each branch here maps onto a visible
/// surface and none is ever hidden. <see cref="Empty"/> is reached only when both reads resolve with nothing
/// to show (no compression body and no export jobs) — a friendly empty surface rather than a blank box.
/// </summary>
public enum DataPipelineSectionState
{
    /// <summary>Initial fetch with no resolved read yet — render the skeleton chrome.</summary>
    Loading,

    /// <summary>At least one read carried content from the network (or a non-stale cache).</summary>
    Loaded,

    /// <summary>Both reads resolved with nothing to show — render the friendly empty surface.</summary>
    Empty,

    /// <summary>Both reads failed with nothing cached — render the retry affordance.</summary>
    Error,

    /// <summary>Cached content older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached content remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The compression-savings rollup from <c>GET /system/compression-stats</c> (web <c>getCompressionStats</c>,
/// shape <c>CompressionStats</c> in web/src/api/types.ts). Field names mirror the Go API's snake_case JSON
/// tags; parsing reads snake_case first and falls back to camelCase (the <c>camelCaseKeys</c> transform
/// shape) so a contract shift never throws. Every value is either a dimensionless count or an already-SI
/// byte total, so no unit conversion applies — <see cref="EstimatedSavedBytes"/> is rendered through the
/// byte-exact <see cref="StatusHelpers.FormatBytes(double)"/> (the web <c>formatBytes</c> port) at the
/// display boundary.
/// </summary>
/// <param name="Total">Total rows considered for compression (web <c>total</c>).</param>
/// <param name="Compressed">Rows already compressed (web <c>compressed</c>).</param>
/// <param name="SavingsPercent">The percentage of space saved, 0..100 (web <c>savings_percent</c>).</param>
/// <param name="TotalPositions">Total position rows (web <c>total_positions</c>).</param>
/// <param name="CompressedPositions">Compressed position rows (web <c>compressed_positions</c>).</param>
/// <param name="EstimatedSavedRows">Estimated rows saved (web <c>estimated_saved_rows</c>).</param>
/// <param name="EstimatedSavedBytes">Estimated bytes saved (web <c>estimated_saved_bytes</c>).</param>
public sealed record CompressionStatsSnapshot(
    long Total,
    long Compressed,
    double SavingsPercent,
    long TotalPositions,
    long CompressedPositions,
    long EstimatedSavedRows,
    long EstimatedSavedBytes)
{
    /// <summary>An all-zero snapshot flagged as carrying no payload — the parse fallback for an absent/non-object body.</summary>
    public static CompressionStatsSnapshot Empty { get; } = new(0, 0, 0, 0, 0, 0, 0) { HasData = false };

    /// <summary>
    /// True when a compression payload is present (web <c>compression</c> truthiness). Gates whether the
    /// "Compression Statistics" sub-section and the saved-percent badge render at all. Only the
    /// <see cref="Empty"/> fallback (an absent/non-object body) is false.
    /// </summary>
    public bool HasData { get; init; } = true;

    /// <summary>Project a <c>GET /system/compression-stats</c> JSON object into a tolerant snapshot.</summary>
    /// <param name="element">The decoded compression-stats body.</param>
    public static CompressionStatsSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new CompressionStatsSnapshot(
            Total: DataPipelineJson.GetLong(element, "total", "total"),
            Compressed: DataPipelineJson.GetLong(element, "compressed", "compressed"),
            SavingsPercent: DataPipelineJson.GetDouble(element, "savings_percent", "savingsPercent"),
            TotalPositions: DataPipelineJson.GetLong(element, "total_positions", "totalPositions"),
            CompressedPositions: DataPipelineJson.GetLong(element, "compressed_positions", "compressedPositions"),
            EstimatedSavedRows: DataPipelineJson.GetLong(element, "estimated_saved_rows", "estimatedSavedRows"),
            EstimatedSavedBytes: DataPipelineJson.GetLong(element, "estimated_saved_bytes", "estimatedSavedBytes"));
    }
}

/// <summary>
/// One export-queue job from <c>GET /export/jobs</c> (web <c>getExportJobs</c>, shape
/// <c>ExportJobSummary</c> in web/src/api/types.ts). Only the fields the web surface reads are projected with
/// presentation in mind — the queue <see cref="Status"/> (status glyph + colour and the four queue counts),
/// the <see cref="Type"/> / <see cref="Format"/> / <see cref="FileName"/> / <see cref="RecordCount"/>
/// columns and the created time — plus <see cref="FileSize"/> / <see cref="ErrorMessage"/> /
/// <see cref="CompletedAt"/> for shape completeness. Parsing is null-tolerant so a partial row never throws
/// (mirroring the web's defensive reads); the raw wire timestamp is kept and parsed on demand via
/// <see cref="CreatedAtTime"/>. The <see cref="Id"/> is a string (the web <c>id: string</c>).
/// </summary>
/// <param name="Id">The job id (web <c>keyExtractor</c>; a string).</param>
/// <param name="Type">The export type (web "Type" column).</param>
/// <param name="Format">The export format (web "Format" badge).</param>
/// <param name="Status">The queue status wire value: queued / processing / ready / failed (web "Status").</param>
/// <param name="FileName">The output file name (web "File" column).</param>
/// <param name="FileSize">The output file size in bytes (web <c>file_size</c>).</param>
/// <param name="RecordCount">The exported record count (web "Records" column).</param>
/// <param name="ErrorMessage">The failure message, if any (web <c>error_message</c>).</param>
/// <param name="CreatedAt">The raw created timestamp (web "Created" column).</param>
/// <param name="CompletedAt">The raw completed timestamp, if any (web <c>completed_at</c>).</param>
public sealed record ExportJobSnapshot(
    string Id,
    string? Type,
    string? Format,
    string? Status,
    string? FileName,
    long FileSize,
    long RecordCount,
    string? ErrorMessage,
    string? CreatedAt,
    string? CompletedAt)
{
    /// <summary>Wire status for a job still waiting in the queue (web <c>status === 'queued'</c>).</summary>
    public const string StatusQueued = "queued";

    /// <summary>Wire status for a job currently exporting (web <c>status === 'processing'</c>).</summary>
    public const string StatusProcessing = "processing";

    /// <summary>Wire status for a finished, downloadable job (web <c>status === 'ready'</c>).</summary>
    public const string StatusReady = "ready";

    /// <summary>Wire status for a failed job (web <c>status === 'failed'</c>).</summary>
    public const string StatusFailed = "failed";

    /// <summary>The parsed creation instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => DataPipelineJson.TryParseTimestamp(CreatedAt);

    /// <summary>True when this job matches <paramref name="status"/> case-insensitively (web lower-cased compare).</summary>
    /// <param name="status">The wire status to test against.</param>
    public bool IsStatus(string status) =>
        string.Equals(Status, status, StringComparison.OrdinalIgnoreCase);

    /// <summary>Parse a <c>GET /export/jobs</c> JSON array into a tolerant list of jobs.</summary>
    /// <param name="element">The decoded jobs body.</param>
    public static IReadOnlyList<ExportJobSnapshot> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ExportJobSnapshot>();
        }

        var list = new List<ExportJobSnapshot>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single export-job JSON object into an <see cref="ExportJobSnapshot"/>.</summary>
    /// <param name="obj">The decoded job row.</param>
    public static ExportJobSnapshot FromJson(JsonElement obj) => new(
        Id: DataPipelineJson.GetString(obj, "id") ?? string.Empty,
        Type: DataPipelineJson.GetString(obj, "type"),
        Format: DataPipelineJson.GetString(obj, "format"),
        Status: DataPipelineJson.GetString(obj, "status"),
        FileName: DataPipelineJson.GetString(obj, "file_name") ?? DataPipelineJson.GetString(obj, "fileName"),
        FileSize: DataPipelineJson.GetLong(obj, "file_size", "fileSize"),
        RecordCount: DataPipelineJson.GetLong(obj, "record_count", "recordCount"),
        ErrorMessage: DataPipelineJson.GetString(obj, "error_message") ?? DataPipelineJson.GetString(obj, "errorMessage"),
        CreatedAt: DataPipelineJson.GetString(obj, "created_at") ?? DataPipelineJson.GetString(obj, "createdAt"),
        CompletedAt: DataPipelineJson.GetString(obj, "completed_at") ?? DataPipelineJson.GetString(obj, "completedAt"));
}

/// <summary>
/// A merged Data Pipeline reading — the compression-savings rollup plus the export-job queue. The native
/// analogue of the web component's two-query composition (<c>getCompressionStats</c> +
/// <c>getExportJobs</c>): the compression body gates the "Compression Statistics" sub-section and the
/// saved-percent badge, while the jobs feed the always-shown "Export Job Queue" sub-section (its four queue
/// counters, the active badge, and the job table).
/// </summary>
/// <param name="Compression">The compression-savings rollup.</param>
/// <param name="ExportJobs">The export-queue jobs (preserved in API order, as the web table renders them).</param>
public sealed record DataPipelineReading(
    CompressionStatsSnapshot Compression,
    IReadOnlyList<ExportJobSnapshot> ExportJobs)
{
    /// <summary>An empty reading (no compression body, no jobs) — the projection's neutral seed.</summary>
    public static DataPipelineReading Empty { get; } = new(
        CompressionStatsSnapshot.Empty,
        Array.Empty<ExportJobSnapshot>());
}

/// <summary>
/// One projected, display-ready metric tile — the native analogue of a web <c>MetricCard</c> /
/// <c>StatCard</c> (label + icon + accent + value). Holds the localized label, the already-formatted value,
/// the Segoe Fluent glyph, the token brush key for the accent colour, and a Narrator automation name. Pure
/// data — no WinUI types.
/// </summary>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted value.</param>
/// <param name="Glyph">The Segoe Fluent accent glyph.</param>
/// <param name="AccentBrushKey">The token brush key for the icon accent.</param>
/// <param name="AutomationName">The composed Narrator name.</param>
public sealed record DataPipelineMetricTile(
    string Label,
    string Value,
    string Glyph,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// One projected, display-ready export-job row — the native analogue of a web export-job <c>DataTable</c>
/// row. Holds the status glyph / token-brush key / label (the web <c>getStatusIcon</c> +
/// <c>statusTextClass</c> over <c>{row.status}</c>), the type cell, the format badge text, the monospace file
/// name, the formatted record count, the formatted absolute created time, and a Narrator automation name.
/// Pure data — no WinUI types.
/// </summary>
/// <param name="Id">The row id (the web <c>keyExtractor</c>; a string).</param>
/// <param name="StatusText">The raw status label (em-dash when absent).</param>
/// <param name="StatusGlyph">The Segoe Fluent status glyph (web <c>getStatusIcon</c>).</param>
/// <param name="StatusBrushKey">The status foreground token brush key (web <c>statusTextClass</c>).</param>
/// <param name="Type">The export type cell (em-dash when absent).</param>
/// <param name="Format">The export format badge text (em-dash when absent).</param>
/// <param name="FileName">The output file name, rendered monospace (em-dash when absent).</param>
/// <param name="RecordCount">The formatted record count (web <c>fmtInt</c>).</param>
/// <param name="Created">The formatted absolute created time (web <c>formatDateTime</c>).</param>
/// <param name="AutomationName">The composed Narrator name.</param>
public sealed record DataPipelineExportRow(
    string Id,
    string StatusText,
    string StatusGlyph,
    string StatusBrushKey,
    string Type,
    string Format,
    string FileName,
    string RecordCount,
    string Created,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of one <see cref="DataPipelineReading"/> — the native analogue of
/// everything the web component computes before returning JSX. Holds the "Compression Statistics" gate and
/// its four metric tiles, the savings-percent value/label feeding the gauge, the saved-percent and active
/// header badges, the four export-queue stat tiles (rendered only when there are jobs), the export rows, and
/// the gates for the always-shown queue sub-section. Pure data so the projection is unit-tested without a UI
/// host.
/// </summary>
/// <param name="HasCompression">Whether the "Compression Statistics" sub-section renders (web <c>compression &amp;&amp;</c>).</param>
/// <param name="CompressionTiles">The four compression metric tiles (Ratio / Savings / Total / Compressed).</param>
/// <param name="SavingsPercent">The raw savings percentage (0..100) feeding the gauge.</param>
/// <param name="GaugeLabel">The localized gauge caption (web <c>label="Savings"</c>).</param>
/// <param name="HasSavedBadge">Whether the header saved-percent badge renders (web <c>compression &amp;&amp;</c>).</param>
/// <param name="SavedBadgeText">The header saved-percent badge text (e.g. "12.50% saved").</param>
/// <param name="HasActiveBadge">Whether the header active badge renders (web <c>pending + processing &gt; 0</c>).</param>
/// <param name="ActiveBadgeText">The header active badge text (e.g. "3 active").</param>
/// <param name="StatTiles">The four queue stat tiles (Pending / Processing / Completed / Failed).</param>
/// <param name="ExportRows">The export-job rows (in API order).</param>
/// <param name="HasExportJobs">Whether the export table renders (else its inline empty surface).</param>
/// <param name="HasAnyContent">Whether anything at all is renderable (gates the section-level empty state).</param>
public sealed record DataPipelineSectionDisplay(
    bool HasCompression,
    IReadOnlyList<DataPipelineMetricTile> CompressionTiles,
    double SavingsPercent,
    string GaugeLabel,
    bool HasSavedBadge,
    string SavedBadgeText,
    bool HasActiveBadge,
    string ActiveBadgeText,
    IReadOnlyList<DataPipelineMetricTile> StatTiles,
    IReadOnlyList<DataPipelineExportRow> ExportRows,
    bool HasExportJobs,
    bool HasAnyContent)
{
    /// <summary>The neutral seed display (no compression, no jobs) used before the first projection.</summary>
    public static DataPipelineSectionDisplay Empty { get; } = new(
        HasCompression: false,
        CompressionTiles: Array.Empty<DataPipelineMetricTile>(),
        SavingsPercent: 0,
        GaugeLabel: string.Empty,
        HasSavedBadge: false,
        SavedBadgeText: string.Empty,
        HasActiveBadge: false,
        ActiveBadgeText: string.Empty,
        StatTiles: Array.Empty<DataPipelineMetricTile>(),
        ExportRows: Array.Empty<DataPipelineExportRow>(),
        HasExportJobs: false,
        HasAnyContent: false);
}

/// <summary>
/// Pure projection from a merged <see cref="DataPipelineReading"/> to its
/// <see cref="DataPipelineSectionDisplay"/> — the native port of the render body of
/// web/src/features/system/components/status/DataPipelineSection.tsx. <paramref name="now"/> is injected so
/// the absolute created-time column is deterministic; every label resolves through the i18n facade. The
/// active-badge gate (web <c>pendingJobs + processingJobs &gt; 0</c>) and the four queue counters are derived
/// from the job statuses. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class DataPipelineSectionProjection
{
    /// <summary>Segoe Fluent — Archive (web <c>Archive</c>): the section header glyph, the empty state and the "Compressed" tile.</summary>
    public const string ArchiveGlyph = "\uE7B8";

    /// <summary>Segoe Fluent — trending up (web <c>TrendingUp</c>): the "Compression Ratio" tile.</summary>
    public const string TrendingUpGlyph = "\uE9D2";

    /// <summary>Segoe Fluent — HardDrive (web <c>HardDrive</c>): the "Estimated Savings" tile.</summary>
    public const string HardDriveGlyph = "\uEDA2";

    /// <summary>Segoe Fluent — BarChart (web <c>BarChart3</c>): the "Total Positions" tile.</summary>
    public const string BarChartGlyph = "\uE9D9";

    /// <summary>Segoe Fluent — Clock (web <c>Clock</c>): the "Pending" stat tile.</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Segoe Fluent — Speed/Activity (web <c>Activity</c>): the "Processing" stat tile.</summary>
    public const string ActivityGlyph = "\uE9D9";

    /// <summary>Segoe Fluent — Completed (web <c>CheckCircle</c>): the "Completed" stat tile.</summary>
    public const string CheckCircleGlyph = "\uE930";

    /// <summary>Segoe Fluent — ErrorBadge (web <c>XCircle</c>): the "Failed" stat tile.</summary>
    public const string XCircleGlyph = "\uEA39";

    /// <summary>Em-dash fallback for a missing cell value (web <c>?? '—'</c>).</summary>
    public const string EmDash = "\u2014";

    // Web `fmtPercent(savings_percent)` is called with no explicit precision, so it uses the web's global
    // default decimal precision (numberFormat.ts `_globalPrecision = 2`). The saved-percent badge and the
    // "Compression Ratio" tile therefore render two fraction digits.
    private const int SavingsPercentDecimals = 2;

    private const string SuccessBrushKey = "TsColorSuccessBrush"; // web MetricCard color="green"
    private const string InfoBrushKey = "TsColorInfoBrush";       // web MetricCard color="cyan"
    private const string AccentBrushKey = "TsColorAccentBrush";   // web MetricCard color="purple"
    private const string NeutralBrushKey = "TsColorTextSecondaryBrush"; // web StatCard (no color)

    /// <summary>Project <paramref name="reading"/> at <paramref name="now"/> using the i18n facade.</summary>
    /// <param name="reading">The merged compression + export-jobs reading.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The clock anchor for absolute time formatting.</param>
    public static DataPipelineSectionDisplay Project(DataPipelineReading reading, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        CompressionStatsSnapshot compression = reading.Compression;
        bool hasCompression = compression.HasData;
        double savings = compression.SavingsPercent;

        IReadOnlyList<DataPipelineMetricTile> compressionTiles = hasCompression
            ? BuildCompressionTiles(compression, localizer)
            : Array.Empty<DataPipelineMetricTile>();

        IReadOnlyList<ExportJobSnapshot> jobs = reading.ExportJobs;
        int pending = CountStatus(jobs, ExportJobSnapshot.StatusQueued);
        int processing = CountStatus(jobs, ExportJobSnapshot.StatusProcessing);
        int completed = CountStatus(jobs, ExportJobSnapshot.StatusReady);
        int failed = CountStatus(jobs, ExportJobSnapshot.StatusFailed);
        int active = pending + processing;

        IReadOnlyList<DataPipelineExportRow> exportRows = BuildExportRows(jobs, localizer, now);
        bool hasExportJobs = exportRows.Count > 0;

        // Web parity: the four queue StatCards are rendered only inside the `exportJobs.length > 0` branch.
        IReadOnlyList<DataPipelineMetricTile> statTiles = hasExportJobs
            ? BuildStatTiles(pending, processing, completed, failed, localizer)
            : Array.Empty<DataPipelineMetricTile>();

        string saved = localizer.GetString("featureView.dataPipeline.saved", "saved");
        string savedBadgeText = string.Format(
            CultureInfo.CurrentCulture,
            "{0} {1}",
            ScalarFormatters.FormatPercentage(savings, SavingsPercentDecimals),
            saved);

        string activeWord = localizer.GetString("featureView.dataPipeline.active", "active");
        string activeBadgeText = string.Format(
            CultureInfo.CurrentCulture,
            "{0} {1}",
            ScalarFormatters.FormatNumber(active, 0),
            activeWord);

        bool hasContent = hasCompression || hasExportJobs;

        return new DataPipelineSectionDisplay(
            HasCompression: hasCompression,
            CompressionTiles: compressionTiles,
            SavingsPercent: savings,
            GaugeLabel: localizer.GetString("featureView.dataPipeline.gauge.savings", "Savings"),
            HasSavedBadge: hasCompression,
            SavedBadgeText: savedBadgeText,
            HasActiveBadge: active > 0,
            ActiveBadgeText: activeBadgeText,
            StatTiles: statTiles,
            ExportRows: exportRows,
            HasExportJobs: hasExportJobs,
            HasAnyContent: hasContent);
    }

    /// <summary>Count the jobs whose status matches <paramref name="status"/> (web <c>filter(...).length</c>).</summary>
    /// <param name="jobs">The export jobs.</param>
    /// <param name="status">The wire status to count.</param>
    public static int CountStatus(IReadOnlyList<ExportJobSnapshot> jobs, string status)
    {
        ArgumentNullException.ThrowIfNull(jobs);
        int count = 0;
        foreach (var job in jobs)
        {
            if (job.IsStatus(status))
            {
                count++;
            }
        }

        return count;
    }

    private static DataPipelineMetricTile[] BuildCompressionTiles(
        CompressionStatsSnapshot stats,
        ILocalizer localizer)
    {
        string ratioLabel = localizer.GetString("featureView.dataPipeline.compressionRatio", "Compression Ratio");
        string savingsLabel = localizer.GetString("featureView.dataPipeline.estimatedSavings", "Estimated Savings");
        string totalLabel = localizer.GetString("featureView.dataPipeline.totalPositions", "Total Positions");
        string compressedLabel = localizer.GetString("featureView.dataPipeline.compressed", "Compressed");

        string ratioValue = ScalarFormatters.FormatPercentage(stats.SavingsPercent, SavingsPercentDecimals);
        string savingsValue = StatusHelpers.FormatBytes(stats.EstimatedSavedBytes);
        string totalValue = ScalarFormatters.FormatNumber(stats.TotalPositions, 0);
        string compressedValue = ScalarFormatters.FormatNumber(stats.CompressedPositions, 0);

        return new[]
        {
            new DataPipelineMetricTile(ratioLabel, ratioValue, TrendingUpGlyph, SuccessBrushKey, Tile(ratioLabel, ratioValue)),
            new DataPipelineMetricTile(savingsLabel, savingsValue, HardDriveGlyph, InfoBrushKey, Tile(savingsLabel, savingsValue)),
            new DataPipelineMetricTile(totalLabel, totalValue, BarChartGlyph, AccentBrushKey, Tile(totalLabel, totalValue)),
            new DataPipelineMetricTile(compressedLabel, compressedValue, ArchiveGlyph, InfoBrushKey, Tile(compressedLabel, compressedValue)),
        };
    }

    private static DataPipelineMetricTile[] BuildStatTiles(
        int pending,
        int processing,
        int completed,
        int failed,
        ILocalizer localizer)
    {
        string pendingLabel = localizer.GetString("featureView.dataPipeline.pending", "Pending");
        string processingLabel = localizer.GetString("featureView.dataPipeline.processing", "Processing");
        string completedLabel = localizer.GetString("featureView.dataPipeline.completed", "Completed");
        string failedLabel = localizer.GetString("featureView.dataPipeline.failed", "Failed");

        string pendingValue = ScalarFormatters.FormatNumber(pending, 0);
        string processingValue = ScalarFormatters.FormatNumber(processing, 0);
        string completedValue = ScalarFormatters.FormatNumber(completed, 0);
        string failedValue = ScalarFormatters.FormatNumber(failed, 0);

        return new[]
        {
            new DataPipelineMetricTile(pendingLabel, pendingValue, ClockGlyph, NeutralBrushKey, Tile(pendingLabel, pendingValue)),
            new DataPipelineMetricTile(processingLabel, processingValue, ActivityGlyph, NeutralBrushKey, Tile(processingLabel, processingValue)),
            new DataPipelineMetricTile(completedLabel, completedValue, CheckCircleGlyph, NeutralBrushKey, Tile(completedLabel, completedValue)),
            new DataPipelineMetricTile(failedLabel, failedValue, XCircleGlyph, NeutralBrushKey, Tile(failedLabel, failedValue)),
        };
    }

    private static IReadOnlyList<DataPipelineExportRow> BuildExportRows(
        IReadOnlyList<ExportJobSnapshot> jobs,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        if (jobs.Count == 0)
        {
            return Array.Empty<DataPipelineExportRow>();
        }

        string statusLabel = localizer.GetString("featureView.dataPipeline.col.status", "Status");
        string recordsLabel = localizer.GetString("featureView.dataPipeline.col.records", "Records");

        // Web parity: the table renders `data={exportJobs}` verbatim, so API order is preserved (no re-sort).
        var rows = new List<DataPipelineExportRow>(jobs.Count);
        foreach (var job in jobs)
        {
            string statusText = Fallback(job.Status);
            string statusGlyph = StatusHelpers.StatusGlyph(job.Status);
            string statusBrushKey = StatusHelpers.StatusForegroundBrushKey(job.Status);
            string type = Fallback(job.Type);
            string format = Fallback(job.Format);
            string fileName = Fallback(job.FileName);
            string recordCount = ScalarFormatters.FormatNumber(job.RecordCount, 0);
            string created = DateTimeFormatting.Format(job.CreatedAtTime, DateTimeVariant.Full, now);
            string automation = string.Format(
                CultureInfo.CurrentCulture,
                "{0}: {1}, {2}, {3}, {4} {5}, {6}",
                statusLabel,
                statusText,
                type,
                fileName,
                recordCount,
                recordsLabel,
                created);

            rows.Add(new DataPipelineExportRow(
                Id: job.Id,
                StatusText: statusText,
                StatusGlyph: statusGlyph,
                StatusBrushKey: statusBrushKey,
                Type: type,
                Format: format,
                FileName: fileName,
                RecordCount: recordCount,
                Created: created,
                AutomationName: automation));
        }

        return rows;
    }

    private static string Tile(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);

    private static string Fallback(string? value) =>
        string.IsNullOrEmpty(value) ? EmDash : value;
}

/// <summary>
/// Combines the two settled cache-then-network reads — the compression-savings rollup and the export-job
/// queue — into typed snapshots and a merged <see cref="RepositoryResult{T}"/>. Each <c>Map*</c> method
/// parses one raw JSON emission, mapping an absent / non-object compression body or an empty jobs array to
/// <see cref="LoadStatus.Empty"/> (the web's <c>compression &amp;&amp;</c> / <c>exportJobs.length &gt; 0</c>
/// gates), while preserving cached / stale / offline freshness so the view's chips stay faithful. Kept pure
/// so the parse-and-map contract is unit-tested without a network or cache.
/// </summary>
public static class DataPipelineSectionResultMapper
{
    /// <summary>Parse a raw <c>GET /system/compression-stats</c> emission into a typed snapshot result.</summary>
    /// <param name="raw">The raw JSON emission from the cache-then-network engine.</param>
    public static RepositoryResult<CompressionStatsSnapshot> MapCompression(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return Map(raw, CompressionStatsSnapshot.FromJson, static s => !s.HasData);
    }

    /// <summary>Parse a raw <c>GET /export/jobs</c> emission into a typed list result.</summary>
    /// <param name="raw">The raw JSON emission from the cache-then-network engine.</param>
    public static RepositoryResult<IReadOnlyList<ExportJobSnapshot>> MapExportJobs(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return Map(raw, ExportJobSnapshot.ParseList, static list => list.Count == 0);
    }

    private static RepositoryResult<T> Map<T>(
        RepositoryResult<JsonElement> raw,
        Func<JsonElement, T> parse,
        Func<T, bool> isEmpty)
        where T : class
    {
        switch (raw.Status)
        {
            case LoadStatus.Loading:
            case LoadStatus.Refreshing:
                return RepositoryResult<T>.Loading();

            case LoadStatus.Error:
                return RepositoryResult<T>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load data pipeline status"));

            case LoadStatus.Empty:
                return RepositoryResult<T>.Empty(raw.FetchedAt);
        }

        // RepositoryResult<JsonElement>.Value is a non-nullable JsonElement (unconstrained T?), so an absent
        // body surfaces as the default element (ValueKind.Undefined) rather than null.
        JsonElement element = raw.Value;
        if (element.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
        {
            return RepositoryResult<T>.Empty(raw.FetchedAt);
        }

        T value = parse(element);
        if (isEmpty(value))
        {
            return RepositoryResult<T>.Empty(raw.FetchedAt);
        }

        DateTimeOffset fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;
        return raw.Status switch
        {
            LoadStatus.Offline => RepositoryResult<T>.OfflineCached(
                value, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "A live read is unavailable")),
            LoadStatus.Cached => RepositoryResult<T>.Cached(value, fetchedAt, raw.IsStale),
            _ => raw.IsStale
                ? RepositoryResult<T>.Cached(value, fetchedAt, stale: true)
                : RepositoryResult<T>.Loaded(value, fetchedAt),
        };
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>DataPipelineSection</c> surface (P1/S11 diagnostics contract). Records
/// only the operational <c>view.opened</c> event with the surface slug — never compression figures, export
/// file names or any fleet data — so a diagnostics line can never leak. Thread-safe.
/// </summary>
public sealed class DataPipelineSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public DataPipelineSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DataPipelineSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DataPipelineSectionRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>DataPipelineSection</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/system/components/status/DataPipelineSection.tsx</c>. Holds the
/// diagnostics slug emitted with the <c>view.opened</c> event, the stable surface id, and the localized
/// section title and description. UI-free so the metadata is asserted in tests.
/// </summary>
public static class DataPipelineSectionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DataPipelineSection";

    /// <summary>Stable surface id (kebab-case).</summary>
    public const string Id = "data-pipeline-section";

    /// <summary>The section title (web <c>t('Data Pipeline')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("featureView.dataPipeline.title", "Data Pipeline");
    }

    /// <summary>The section description (web accordion description).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "featureView.dataPipeline.description", "Compression statistics and export job queue");
    }
}

/// <summary>
/// Tolerant JSON readers shared by the Data Pipeline snapshots. Every getter is null- and kind-tolerant so a
/// partial or contract-shifted wire row never throws — the native analogue of the web component's defensive
/// optional reads. Numeric getters accept a number or a numeric string (the <c>camelCaseKeys</c> transform
/// can leave large ids/counts as strings).
/// </summary>
internal static class DataPipelineJson
{
    /// <summary>Read a string property, or null when absent / not a string.</summary>
    /// <param name="obj">The JSON object.</param>
    /// <param name="name">The property name.</param>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    /// <summary>Read a 64-bit integer from <paramref name="snake"/> then <paramref name="camel"/>, defaulting to 0.</summary>
    /// <param name="obj">The JSON object.</param>
    /// <param name="snake">The snake_case property name.</param>
    /// <param name="camel">The camelCase fallback property name.</param>
    public static long GetLong(JsonElement obj, string snake, string camel)
    {
        if (TryGetLong(obj, snake, out long value) || TryGetLong(obj, camel, out value))
        {
            return value;
        }

        return 0;
    }

    /// <summary>Read a double from <paramref name="snake"/> then <paramref name="camel"/>, defaulting to 0.</summary>
    /// <param name="obj">The JSON object.</param>
    /// <param name="snake">The snake_case property name.</param>
    /// <param name="camel">The camelCase fallback property name.</param>
    public static double GetDouble(JsonElement obj, string snake, string camel)
    {
        if (TryGetDouble(obj, snake, out double value) || TryGetDouble(obj, camel, out value))
        {
            return value;
        }

        return 0;
    }

    /// <summary>Parse an ISO-8601 timestamp, or null when absent / unparseable.</summary>
    /// <param name="raw">The raw timestamp string.</param>
    public static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed)
            ? parsed
            : null;
    }

    private static bool TryGetLong(JsonElement obj, string name, out long value)
    {
        value = 0;
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        switch (v.ValueKind)
        {
            case JsonValueKind.Number when v.TryGetInt64(out long l):
                value = l;
                return true;
            case JsonValueKind.Number when v.TryGetDouble(out double d):
                value = (long)d;
                return true;
            case JsonValueKind.String when long.TryParse(
                v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long parsed):
                value = parsed;
                return true;
            default:
                return false;
        }
    }

    private static bool TryGetDouble(JsonElement obj, string name, out double value)
    {
        value = 0;
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        switch (v.ValueKind)
        {
            case JsonValueKind.Number when v.TryGetDouble(out double d):
                value = d;
                return true;
            case JsonValueKind.String when double.TryParse(
                v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out double parsed):
                value = parsed;
                return true;
            default:
                return false;
        }
    }
}
