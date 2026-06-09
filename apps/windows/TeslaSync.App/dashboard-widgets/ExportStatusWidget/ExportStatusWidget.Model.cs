using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state an <see cref="ExportStatusViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ExportStatusWidget</c>
/// renders through <c>WidgetShell</c> (web/src/features/dashboard/widgets/ExportStatusWidget.tsx).
/// The widget composes two queries (the legacy <c>useExports</c> list and the admin
/// <c>useExportJobs</c> list, both reading <c>GET /export/jobs</c>) so every branch is derived from the
/// combined freshness of both, mirroring the web's <c>exportsLoading || adminLoading</c> /
/// <c>exportsIsError || adminIsError</c> / <c>exportsStale || adminStale</c> composition. Every branch
/// maps onto a visible surface; none is ever hidden.
/// </summary>
public enum ExportStatusState
{
    /// <summary>Initial fetch with neither source resolved — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh rows from the network (or non-stale cache) carrying at least one job.</summary>
    Loaded,

    /// <summary>Both sources resolved with no merged jobs — render the friendly empty state.</summary>
    Empty,

    /// <summary>A source failed and no cached jobs remain — render the empty body plus an error chip.</summary>
    Error,

    /// <summary>Cached jobs older than the freshness window — render rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached jobs remain — render rows plus an offline/error chip.</summary>
    Offline,
}

/// <summary>
/// The canonical export-job status union — the native port of the web <c>JobStatus</c>
/// ('queued' | 'processing' | 'ready' | 'failed') that <c>ExportStatusWidget</c> normalises both hook
/// shapes into (web <c>normaliseStatusFromExport</c> / <c>normaliseStatusFromAdmin</c>).
/// </summary>
public enum ExportJobStatus
{
    /// <summary>Queued / pending (the web fallback bucket; also covers 'expired').</summary>
    Queued,

    /// <summary>Actively processing (web 'processing' / 'running').</summary>
    Processing,

    /// <summary>Finished and downloadable (web 'ready' / 'done' / 'completed').</summary>
    Ready,

    /// <summary>Failed (web 'failed' / 'error').</summary>
    Failed,
}

/// <summary>Tolerant JSON readers shared by the export-job parse adapter.</summary>
internal static class ExportStatusJson
{
    /// <summary>Read a string property, or <see langword="null"/> when absent / not a string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Read a long property (number or numeric string), or <see langword="null"/> when absent.</summary>
    public static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    /// <summary>Read an <c>id</c> (number or string) as a string, mirroring the web template literal.</summary>
    public static string GetId(JsonElement obj)
    {
        if (!obj.TryGetProperty("id", out var v))
        {
            return string.Empty;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n.ToString(CultureInfo.InvariantCulture),
            JsonValueKind.String => v.GetString() ?? string.Empty,
            _ => string.Empty,
        };
    }
}

/// <summary>
/// One normalised export job — the native analogue of the web <c>NormalisedJob</c> plus its resolved
/// <see cref="ExportJobStatus"/>. The endpoint serializes the Go <c>models.ExportJobSummary</c> shape
/// (<c>{id, type, format, status, file_name, file_size, created_at, …}</c>) whereas the web interfaces
/// name some concepts differently (<c>filePath</c>, <c>fileSize</c>, <c>createdAt</c>, <c>fsmState</c>).
/// Parsing is null-tolerant and accepts BOTH naming conventions (the web-interface name wins when
/// present, else the real wire field) so the native widget reproduces the web component's intent against
/// the actual backend without drift: <c>FilePath ← file_path / filePath / file_name</c>,
/// <c>FileSize ← file_size / fileSize</c>, <c>CreatedAt ← created_at / createdAt</c>. The status is
/// derived per source — the admin list from <c>status</c>, the legacy list from
/// <c>fsm_state ?? status</c> — exactly mirroring the web's two normalisers.
/// </summary>
public sealed record ExportJobRecord(
    string Id,
    string Format,
    string? FilePath,
    long FileSize,
    string? CreatedAt,
    ExportJobStatus Status)
{
    private const string FsmStateField = "fsm_state";

    /// <summary>The parsed creation instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => ParseTimestamp(CreatedAt);

    /// <summary>
    /// Map a free-text status / fsm-state token onto the canonical <see cref="ExportJobStatus"/> exactly
    /// as the web normalisers do: <c>processing</c>/<c>running</c> → processing; <c>ready</c>/<c>done</c>/
    /// <c>completed</c> → ready; <c>failed</c>/<c>error</c> → failed; anything else (incl. <c>queued</c>,
    /// <c>expired</c>, empty) → queued.
    /// </summary>
    public static ExportJobStatus NormaliseStatus(string? raw)
    {
        string s = (raw ?? string.Empty).Trim().ToLowerInvariant();
        return s switch
        {
            "processing" or "running" => ExportJobStatus.Processing,
            "ready" or "done" or "completed" => ExportJobStatus.Ready,
            "failed" or "error" => ExportJobStatus.Failed,
            _ => ExportJobStatus.Queued,
        };
    }

    /// <summary>
    /// Parse a <c>GET /export/jobs</c> JSON array into a tolerant list of jobs. When
    /// <paramref name="fromAdmin"/> is true the status is read from the admin <c>status</c> field (web
    /// <c>fromAdminHook</c>); otherwise it is read from <c>fsm_state</c> falling back to <c>status</c>
    /// (web <c>fromExportHook</c> over the real wire, which carries <c>status</c> rather than
    /// <c>fsm_state</c>).
    /// </summary>
    public static IReadOnlyList<ExportJobRecord> ParseList(JsonElement element, bool fromAdmin)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ExportJobRecord>();
        }

        var list = new List<ExportJobRecord>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item, fromAdmin));
            }
        }

        return list;
    }

    /// <summary>Project a single export-job JSON object into an <see cref="ExportJobRecord"/>.</summary>
    public static ExportJobRecord FromJson(JsonElement obj, bool fromAdmin)
    {
        string? statusRaw = fromAdmin
            ? ExportStatusJson.GetString(obj, "status")
            : ExportStatusJson.GetString(obj, FsmStateField)
                ?? ExportStatusJson.GetString(obj, "fsmState")
                ?? ExportStatusJson.GetString(obj, "status");

        return new ExportJobRecord(
            Id: ExportStatusJson.GetId(obj),
            Format: ExportStatusJson.GetString(obj, "format") ?? string.Empty,
            FilePath: ExportStatusJson.GetString(obj, "file_path")
                ?? ExportStatusJson.GetString(obj, "filePath")
                ?? ExportStatusJson.GetString(obj, "file_name")
                ?? ExportStatusJson.GetString(obj, "fileName"),
            FileSize: ExportStatusJson.GetLong(obj, "file_size") ?? ExportStatusJson.GetLong(obj, "fileSize") ?? 0,
            CreatedAt: ExportStatusJson.GetString(obj, "created_at") ?? ExportStatusJson.GetString(obj, "createdAt"),
            Status: NormaliseStatus(statusRaw));
    }

    private static DateTimeOffset? ParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols &lt;= 1</c> and <c>isWide = size.cols &gt;= 3</c> branches in
/// web/src/features/dashboard/widgets/ExportStatusWidget.tsx.
/// </summary>
public readonly record struct ExportStatusSize(int Cols, int Rows)
{
    /// <summary>Maximum job rows rendered in the standard layout (web <c>maxItems={15}</c>).</summary>
    public const int MaxFeedItems = 15;

    /// <summary>The registry default footprint (2×4).</summary>
    public static ExportStatusSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): show the active-count big number.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three or more columns (web <c>isWide</c>): show the per-row download affordance.</summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// One projected, display-ready export-job row consumed by the WinUI list — the native analogue of a web
/// <c>JobRow</c>. Holds the truncated file name, the uppercased format, the formatted size, the resolved
/// status presentation (tint + localized label), the relative-time string, whether a progress bar should
/// follow (processing), the absolute download URI for a finished job (wide footprint only), and a
/// Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record ExportJobRow(
    string Id,
    string FileName,
    string FormatText,
    string FileSizeText,
    ExportJobStatus Status,
    string StatusLabel,
    StatusKind StatusBadge,
    string RelativeTime,
    bool IsProcessing,
    Uri? DownloadUri,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the merged export jobs for one footprint — the native
/// analogue of everything the web component computes via <c>useMemo</c> before returning JSX: the active
/// count + running flag for the compact big number, and the newest-first, status-ordered, capped rows for
/// the standard list. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ExportStatusDisplay(
    bool IsCompact,
    bool ShowDownload,
    bool HasItems,
    int ActiveCount,
    bool HasRunning,
    string ActiveCountText,
    string ActiveLabel,
    string CompactBadgeText,
    StatusKind CompactBadgeStatus,
    string CompactAutomationName,
    IReadOnlyList<ExportJobRow> Items);

/// <summary>
/// Pure projection from raw legacy + admin job lists to the display model — the native port of the
/// merge/dedupe/sort and compact-stats logic in
/// web/src/features/dashboard/widgets/ExportStatusWidget.tsx. Jobs are merged by id with the admin list
/// winning (web <c>byId.set</c> ordering), ordered by status (processing, queued, ready, failed) then by
/// newest <c>createdAt</c>, and the standard list is capped at <see cref="ExportStatusSize.MaxFeedItems"/>.
/// <paramref name="now"/> is injected so the relative-time tiers are unit-tested deterministically; each
/// label resolves through the i18n facade.
/// </summary>
public static class ExportStatusProjection
{
    /// <summary>Em-dash fallback shown for a missing file name / size / format (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    private const string Ellipsis = "\u2026";
    private const int FileNameMaxLength = 28;
    private const double BytesPerKilobyte = 1024.0;
    private const double BytesPerMegabyte = 1024.0 * 1024.0;
    private const double BytesPerGigabyte = 1024.0 * 1024.0 * 1024.0;

    /// <summary>The relative path template a finished job's artifact is downloaded from (web <c>href</c>).</summary>
    private const string DownloadPathPrefix = "/api/v1/export/download/";

    /// <summary>Project the merged jobs for <paramref name="size"/> relative to <paramref name="now"/>.</summary>
    public static ExportStatusDisplay Project(
        IReadOnlyList<ExportJobRecord> primary,
        IReadOnlyList<ExportJobRecord> admin,
        ExportStatusSize size,
        ILocalizer localizer,
        DateTimeOffset now,
        Uri? downloadBase)
    {
        ArgumentNullException.ThrowIfNull(primary);
        ArgumentNullException.ThrowIfNull(admin);
        ArgumentNullException.ThrowIfNull(localizer);

        var sorted = Merge(primary, admin);

        int activeCount = 0;
        bool hasRunning = false;
        foreach (var job in sorted)
        {
            if (job.Status is ExportJobStatus.Processing or ExportJobStatus.Queued)
            {
                activeCount++;
            }

            if (job.Status == ExportJobStatus.Processing)
            {
                hasRunning = true;
            }
        }

        var rows = new List<ExportJobRow>(Math.Min(sorted.Count, ExportStatusSize.MaxFeedItems));
        foreach (var job in sorted.Take(ExportStatusSize.MaxFeedItems))
        {
            rows.Add(BuildRow(job, size.IsWide, localizer, now, downloadBase));
        }

        string activeLabel = localizer.GetString("widget.exportActiveJobs", "Active Exports");
        string compactBadgeText = hasRunning
            ? localizer.GetString("widget.exportRunningBadge", "Running")
            : localizer.GetString("widget.exportIdleBadge", "Idle");
        StatusKind compactBadgeStatus = hasRunning ? StatusKind.Success : StatusKind.Neutral;
        string activeCountText = ScalarFormatters.FormatNumber(activeCount, 0);

        return new ExportStatusDisplay(
            IsCompact: size.IsCompact,
            ShowDownload: size.IsWide,
            HasItems: sorted.Count > 0,
            ActiveCount: activeCount,
            HasRunning: hasRunning,
            ActiveCountText: activeCountText,
            ActiveLabel: activeLabel,
            CompactBadgeText: compactBadgeText,
            CompactBadgeStatus: compactBadgeStatus,
            CompactAutomationName: string.Format(CultureInfo.CurrentCulture, "{0} {1}, {2}", activeCountText, activeLabel, compactBadgeText),
            Items: rows);
    }

    /// <summary>
    /// Merge the two lists by id (admin overwrites the legacy entry, web <c>byId.set</c>) and order them
    /// by status (processing → queued → ready → failed) then by newest <c>createdAt</c> first.
    /// </summary>
    public static IReadOnlyList<ExportJobRecord> Merge(
        IReadOnlyList<ExportJobRecord> primary,
        IReadOnlyList<ExportJobRecord> admin)
    {
        ArgumentNullException.ThrowIfNull(primary);
        ArgumentNullException.ThrowIfNull(admin);

        var byId = new Dictionary<string, ExportJobRecord>(StringComparer.Ordinal);
        var order = new List<string>(primary.Count + admin.Count);

        foreach (var job in primary)
        {
            Accumulate(byId, order, job);
        }

        foreach (var job in admin)
        {
            Accumulate(byId, order, job);
        }

        return order
            .Select(id => byId[id])
            .OrderBy(StatusOrder)
            .ThenByDescending(job => job.CreatedAtTime ?? DateTimeOffset.MinValue)
            .ToList();
    }

    /// <summary>The sort rank of a status (web <c>STATUS_ORDER</c>): processing 0, queued 1, ready 2, failed 3.</summary>
    public static int StatusOrder(ExportJobRecord job)
    {
        ArgumentNullException.ThrowIfNull(job);
        return job.Status switch
        {
            ExportJobStatus.Processing => 0,
            ExportJobStatus.Queued => 1,
            ExportJobStatus.Ready => 2,
            _ => 3,
        };
    }

    /// <summary>The badge tint + i18n key + English fallback for a status (web <c>STATUS_BADGE</c>).</summary>
    public static (StatusKind Kind, string LabelKey, string Fallback) StatusPresentation(ExportJobStatus status) => status switch
    {
        ExportJobStatus.Processing => (StatusKind.Info, "widget.exportRunning", "Running"),
        ExportJobStatus.Ready => (StatusKind.Success, "widget.exportDone", "Done"),
        ExportJobStatus.Failed => (StatusKind.Danger, "widget.exportFailed", "Failed"),
        _ => (StatusKind.Neutral, "widget.exportQueued", "Queued"),
    };

    /// <summary>
    /// Format a byte count exactly as the web <c>fmtBytes</c> helper: ≤ 0 → em-dash; &lt; 1 KiB → "<c>{b} B</c>";
    /// &lt; 1 MiB → "<c>{kb} KB</c>"; &lt; 1 GiB → "<c>{mb} MB</c>"; otherwise "<c>{gb} GB</c>" (one decimal place).
    /// </summary>
    public static string FormatBytes(long bytes)
    {
        if (bytes <= 0)
        {
            return EmDash;
        }

        if (bytes < BytesPerKilobyte)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{bytes} B");
        }

        if (bytes < BytesPerMegabyte)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{bytes / BytesPerKilobyte:0.0} KB");
        }

        if (bytes < BytesPerGigabyte)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{bytes / BytesPerMegabyte:0.0} MB");
        }

        return string.Create(CultureInfo.InvariantCulture, $"{bytes / BytesPerGigabyte:0.0} GB");
    }

    /// <summary>
    /// Reduce a path to its trailing file name and ellipsize it past <see cref="FileNameMaxLength"/>
    /// (web <c>truncateFilename</c>); a null / empty path renders the em-dash fallback.
    /// </summary>
    public static string TruncateFileName(string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return EmDash;
        }

        string[] segments = path.Split('/');
        string name = segments[^1];
        if (name.Length == 0)
        {
            name = path;
        }

        if (name.Length <= FileNameMaxLength)
        {
            return name;
        }

        return string.Concat(name.AsSpan(0, FileNameMaxLength - 1), Ellipsis);
    }

    private static void Accumulate(Dictionary<string, ExportJobRecord> byId, List<string> order, ExportJobRecord job)
    {
        if (string.IsNullOrEmpty(job.Id))
        {
            return;
        }

        if (!byId.ContainsKey(job.Id))
        {
            order.Add(job.Id);
        }

        byId[job.Id] = job;
    }

    private static ExportJobRow BuildRow(
        ExportJobRecord job,
        bool showDownload,
        ILocalizer localizer,
        DateTimeOffset now,
        Uri? downloadBase)
    {
        string format = (job.Format ?? string.Empty).ToUpperInvariant();
        string formatText = string.IsNullOrEmpty(format) ? EmDash : format;
        string fileName = TruncateFileName(job.FilePath);
        string fileSizeText = FormatBytes(job.FileSize);
        (StatusKind kind, string labelKey, string fallback) = StatusPresentation(job.Status);
        string statusLabel = localizer.GetString(labelKey, fallback);
        string relativeTime = DateTimeFormatting.Format(job.CreatedAtTime, DateTimeVariant.Relative, now);

        Uri? downloadUri = null;
        if (showDownload
            && job.Status == ExportJobStatus.Ready
            && !string.IsNullOrEmpty(job.FilePath)
            && downloadBase is { } baseUri
            && !string.IsNullOrEmpty(job.Id))
        {
            downloadUri = new Uri(baseUri, DownloadPathPrefix + Uri.EscapeDataString(job.Id));
        }

        string automationName = string.Format(
            CultureInfo.CurrentCulture,
            "{0}, {1}, {2}, {3}, {4}",
            fileName,
            formatText,
            fileSizeText,
            statusLabel,
            relativeTime);

        return new ExportJobRow(
            Id: job.Id,
            FileName: fileName,
            FormatText: formatText,
            FileSizeText: fileSizeText,
            Status: job.Status,
            StatusLabel: statusLabel,
            StatusBadge: kind,
            RelativeTime: relativeTime,
            IsProcessing: job.Status == ExportJobStatus.Processing,
            DownloadUri: downloadUri,
            AutomationName: automationName);
    }
}

/// <summary>
/// Canonical registry metadata for the Export Status surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/system.ts. The dashboard grid system binds this
/// surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class ExportStatusRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "export-status";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "system";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ExportStatusWidget";

    /// <summary>Maximum job rows rendered in the standard layout (web <c>maxItems={15}</c>).</summary>
    public const int MaxFeedItems = ExportStatusSize.MaxFeedItems;

    /// <summary>The generated operation id for the export-jobs list (<c>GET /export/jobs</c>).</summary>
    public const string JobsOperationId = "get_api_v1_export_jobs";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static ExportStatusSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static ExportStatusSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static ExportStatusSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Export Status").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.exportStatus", "Export Status");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.exportStatus.description",
            "Data export jobs: progress, format, size, success/fail status");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(ExportStatusSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static ExportStatusSize Clamp(ExportStatusSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Export Status surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a file name, path, or job id — so a
/// diagnostics line can never leak what was exported. Thread-safe.
/// </summary>
public sealed class ExportStatusDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ExportStatusDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ExportStatusWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ExportStatusRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;ExportJobRecord&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure
/// so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ExportStatusResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<ExportJobRecord>> Map(RepositoryResult<JsonElement> raw, bool fromAdmin)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<ExportJobRecord> Parse() =>
            raw.HasValue ? ExportJobRecord.ParseList(raw.Value, fromAdmin) : Array.Empty<ExportJobRecord>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<ExportJobRecord>>.Loading(),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<ExportJobRecord>>.Empty(raw.FetchedAt),
            LoadStatus.Error => RepositoryResult<IReadOnlyList<ExportJobRecord>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<ExportJobRecord>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<ExportJobRecord>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<ExportJobRecord>>.OfflineCached(
                Parse(), raw.FetchedAt!.Value, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<IReadOnlyList<ExportJobRecord>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UnixEpoch),
        };
    }
}
