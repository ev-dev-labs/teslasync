using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The export-job lifecycle status surfaced by the drawer — the native port of the web
/// <c>ExportJobSummary['status']</c> union ('queued' | 'processing' | 'ready' | 'failed' | 'expired')
/// in web/src/api/hooks/useExports.ts. Unlike the dashboard <c>ExportStatusWidget</c> (which collapses
/// to four buckets) the drawer keeps all five distinct so each renders the same icon + label the web
/// <c>JobProgressDrawer</c> does.
/// </summary>
public enum ExportJobStatus
{
    /// <summary>Queued / pending — counts as active (web <c>isActive</c>).</summary>
    Queued,

    /// <summary>Actively processing — counts as active (web <c>isActive</c>).</summary>
    Processing,

    /// <summary>Finished and downloadable.</summary>
    Ready,

    /// <summary>Failed (carries an <c>error_message</c>).</summary>
    Failed,

    /// <summary>Artifact expired and is no longer downloadable.</summary>
    Expired,
}

/// <summary>
/// The persisted chrome state of the floating drawer — the native union of the web component's
/// localStorage-backed <c>DrawerState</c> ('open' | 'minimized' | 'dismissed') keyed by
/// <see cref="JobProgressDrawerRegistration.StorageKey"/>. The view-model auto-promotes
/// <see cref="Dismissed"/> back to <see cref="Minimized"/> when a new active job appears, mirroring the
/// web <c>useEffect</c>.
/// </summary>
public enum JobDrawerPresentation
{
    /// <summary>The full panel is expanded (header + sections).</summary>
    Open,

    /// <summary>Collapsed to the active-count chip (web minimized state).</summary>
    Minimized,

    /// <summary>Dismissed by the user; hidden while there is nothing active to surface.</summary>
    Dismissed,
}

/// <summary>
/// The data lifecycle the drawer body renders — the native union of the loading / loaded / empty /
/// error / stale / offline branches derived from the shared <see cref="ExportJobRecord"/> read. Every
/// branch maps onto a visible surface in the open panel (a friendly empty/error state is shown rather
/// than a blank box); the web component additionally hides the whole drawer when there is nothing to
/// surface, which the view-model exposes separately via its visibility flag.
/// </summary>
public enum JobProgressState
{
    /// <summary>Initial fetch with no cache resolved — render the loading line.</summary>
    Loading,

    /// <summary>Fresh rows from the network (or non-stale cache) carrying at least one job.</summary>
    Loaded,

    /// <summary>Resolved with no jobs — render the friendly empty state.</summary>
    Empty,

    /// <summary>The load failed and no cached jobs remain — render the error state with a retry.</summary>
    Error,

    /// <summary>Cached jobs older than the freshness window — render rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached jobs remain — render rows plus an offline/error chip.</summary>
    Offline,
}

/// <summary>Tolerant JSON readers shared by the export-job parse adapter.</summary>
internal static class JobDrawerJson
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
/// One parsed export job — the native analogue of the web <c>ExportJobSummary</c>
/// (web/src/api/hooks/useExports.ts). The endpoint serializes the Go <c>models.ExportJobSummary</c>
/// shape (snake_case: <c>{id, type, format, status, file_size, error_message, created_at,
/// completed_at}</c>); parsing also accepts the camelCase aliases produced by <c>camelCaseKeys</c> so the
/// native read never drifts from the web. The status is mapped to the canonical five-member
/// <see cref="ExportJobStatus"/> union exactly as the web treats <c>job.status</c>.
/// </summary>
public sealed record ExportJobRecord(
    string Id,
    string Type,
    string Format,
    ExportJobStatus Status,
    long? FileSize,
    string? ErrorMessage,
    string? CreatedAt,
    string? CompletedAt)
{
    /// <summary>The parsed creation instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => ParseTimestamp(CreatedAt);

    /// <summary>The parsed completion instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? CompletedAtTime => ParseTimestamp(CompletedAt);

    /// <summary>True for queued/processing jobs (web <c>isActive</c>): they belong in the "In progress" bucket.</summary>
    public bool IsActive => Status is ExportJobStatus.Queued or ExportJobStatus.Processing;

    /// <summary>
    /// Map a free-text status token onto the canonical <see cref="ExportJobStatus"/>: <c>processing</c> →
    /// processing; <c>ready</c> → ready; <c>failed</c> → failed; <c>expired</c> → expired; anything else
    /// (incl. <c>queued</c> and unknown) → queued, mirroring the web fallback to the clock/queued icon.
    /// </summary>
    public static ExportJobStatus NormaliseStatus(string? raw)
    {
        string s = (raw ?? string.Empty).Trim().ToLowerInvariant();
        return s switch
        {
            "processing" => ExportJobStatus.Processing,
            "ready" => ExportJobStatus.Ready,
            "failed" => ExportJobStatus.Failed,
            "expired" => ExportJobStatus.Expired,
            _ => ExportJobStatus.Queued,
        };
    }

    /// <summary>Parse a <c>GET /export/jobs</c> JSON array into a tolerant list of jobs (input order preserved).</summary>
    public static IReadOnlyList<ExportJobRecord> ParseList(JsonElement element)
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
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single export-job JSON object into an <see cref="ExportJobRecord"/>.</summary>
    public static ExportJobRecord FromJson(JsonElement obj) =>
        new(
            Id: JobDrawerJson.GetId(obj),
            Type: JobDrawerJson.GetString(obj, "type") ?? string.Empty,
            Format: JobDrawerJson.GetString(obj, "format") ?? string.Empty,
            Status: NormaliseStatus(JobDrawerJson.GetString(obj, "status")),
            FileSize: JobDrawerJson.GetLong(obj, "file_size") ?? JobDrawerJson.GetLong(obj, "fileSize"),
            ErrorMessage: JobDrawerJson.GetString(obj, "error_message") ?? JobDrawerJson.GetString(obj, "errorMessage"),
            CreatedAt: JobDrawerJson.GetString(obj, "created_at") ?? JobDrawerJson.GetString(obj, "createdAt"),
            CompletedAt: JobDrawerJson.GetString(obj, "completed_at") ?? JobDrawerJson.GetString(obj, "completedAt"));

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
/// One projected, render-ready job row consumed by the WinUI list — the native analogue of a web
/// <c>JobRow</c>. Holds the localized type label, uppercased format, status presentation (icon + tint +
/// label), the composed detail line (active: "{status} · started {relative}"; recent: "{size} ·
/// {relative}"), an optional error message, the download URI for a finished job, the failed-row glyph
/// flag, and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record JobRowDisplay(
    string Id,
    string TypeLabel,
    string FormatText,
    ExportJobStatus Status,
    string StatusGlyph,
    bool StatusGlyphSpins,
    StatusKind StatusBadge,
    string StatusLabel,
    string DetailLine,
    string? ErrorMessage,
    bool IsActive,
    bool ShowDownload,
    Uri? DownloadUri,
    bool ShowFailedGlyph,
    string AutomationName)
{
    /// <summary>True when a non-empty error message should be surfaced under the row.</summary>
    public bool HasError => !string.IsNullOrEmpty(ErrorMessage);
}

/// <summary>
/// One projected drawer section ("In progress" / "Recent") — the native analogue of the web
/// <c>DrawerSection</c>. Carries the localized heading, the empty-state label shown when there are no
/// rows, and the (capped) row list. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record JobDrawerSection(
    string Heading,
    string EmptyLabel,
    IReadOnlyList<JobRowDisplay> Rows)
{
    /// <summary>True when the section has no rows and should render its empty label.</summary>
    public bool IsEmpty => Rows.Count == 0;
}

/// <summary>
/// The fully projected, render-ready view of the export jobs — the native analogue of everything the web
/// <c>JobProgressDrawer</c> computes via <c>useMemo</c>: the active count + running flag for the
/// minimized chip and active pill, the minimized chip label, and the "In progress" / "Recent" sections.
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record JobDrawerDisplay(
    bool HasAnyJobs,
    int ActiveCount,
    bool HasActive,
    string ActivePillText,
    string MinimizedText,
    bool MinimizedShowSpinner,
    string MinimizedAutomationName,
    JobDrawerSection ActiveSection,
    JobDrawerSection RecentSection);

/// <summary>
/// Pure projection from a parsed job list to the drawer display model — the native port of the
/// filter/slice/format logic in web/src/components/feedback/JobProgressDrawer.tsx. Active jobs
/// (queued/processing) fill the "In progress" section in input order; the remainder fill the "Recent"
/// section capped at <c>maxRecent</c> (web <c>slice(0, maxRecent)</c>). <paramref name="now"/> is injected
/// so the relative-time tiers are unit-tested deterministically, and every label resolves through the
/// i18n facade.
/// </summary>
public static class JobProgressDrawerProjection
{
    /// <summary>Em-dash fallback shown for a missing size (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    private const string DownloadPathPrefix = "/api/v1/export/jobs/";
    private const string DownloadPathSuffix = "/download";
    private const double BytesPerKilobyte = 1024.0;
    private const double BytesPerMegabyte = 1024.0 * 1024.0;
    private const double BytesPerGigabyte = 1024.0 * 1024.0 * 1024.0;

    // Segoe Fluent Icons glyphs for each status (the spinning processing row uses a ProgressRing instead).
    private const string GlyphQueued = "\uE823";    // Recent / clock
    private const string GlyphProcessing = "\uE895"; // Sync
    private const string GlyphReady = "\uE73E";      // CheckMark
    private const string GlyphFailed = "\uEA39";     // ErrorBadge
    private const string GlyphExpired = "\uE7BA";    // Warning

    /// <summary>Project <paramref name="jobs"/> into the drawer display relative to <paramref name="now"/>.</summary>
    public static JobDrawerDisplay Project(
        IReadOnlyList<ExportJobRecord> jobs,
        int maxRecent,
        ILocalizer localizer,
        DateTimeOffset now,
        Uri? downloadBase)
    {
        ArgumentNullException.ThrowIfNull(jobs);
        ArgumentNullException.ThrowIfNull(localizer);

        var activeRows = new List<JobRowDisplay>();
        var recentRows = new List<JobRowDisplay>();
        int cap = Math.Max(0, maxRecent);
        foreach (var job in jobs)
        {
            if (job.IsActive)
            {
                activeRows.Add(BuildRow(job, localizer, now, downloadBase));
            }
            else if (recentRows.Count < cap)
            {
                recentRows.Add(BuildRow(job, localizer, now, downloadBase));
            }
        }

        int activeCount = activeRows.Count;
        bool hasActive = activeCount > 0;
        string activeCountText = ScalarFormatters.FormatNumber(activeCount, 0);

        string activePill = Fill(
            localizer.GetString("export.jobDrawer.activePill", "{{count}} active"),
            ("count", activeCountText));
        string minimizedText = hasActive
            ? Fill(localizer.GetString("export.jobDrawer.activeCount", "{{count}} export running"), ("count", activeCountText))
            : localizer.GetString("export.jobDrawer.recentLabel", "Exports");

        var activeSection = new JobDrawerSection(
            localizer.GetString("export.jobDrawer.activeHeading", "In progress"),
            localizer.GetString("export.jobDrawer.activeEmpty", "No active exports"),
            activeRows);
        var recentSection = new JobDrawerSection(
            localizer.GetString("export.jobDrawer.recentHeading", "Recent"),
            localizer.GetString("export.jobDrawer.recentEmpty", "No recent exports"),
            recentRows);

        return new JobDrawerDisplay(
            HasAnyJobs: jobs.Count > 0,
            ActiveCount: activeCount,
            HasActive: hasActive,
            ActivePillText: activePill,
            MinimizedText: minimizedText,
            MinimizedShowSpinner: hasActive,
            MinimizedAutomationName: minimizedText,
            ActiveSection: activeSection,
            RecentSection: recentSection);
    }

    /// <summary>Build a single render-ready row from a parsed job.</summary>
    public static JobRowDisplay BuildRow(
        ExportJobRecord job,
        ILocalizer localizer,
        DateTimeOffset now,
        Uri? downloadBase)
    {
        ArgumentNullException.ThrowIfNull(job);
        ArgumentNullException.ThrowIfNull(localizer);

        string typeLabel = PrettyType(job.Type, localizer);
        string formatText = (job.Format ?? string.Empty).ToUpperInvariant();
        (StatusKind kind, string glyph, bool spins, string labelKey, string fallback) = StatusPresentation(job.Status);
        string statusLabel = localizer.GetString(labelKey, fallback);

        string detailLine;
        if (job.IsActive)
        {
            string relative = DateTimeFormatting.Format(job.CreatedAtTime, DateTimeVariant.Relative, now);
            detailLine = Fill(
                localizer.GetString("export.jobDrawer.statusLine", "{{status}} \u00b7 started {{relative}}"),
                ("status", statusLabel),
                ("relative", relative));
        }
        else
        {
            string size = FormatBytes(job.FileSize);
            string relative = DateTimeFormatting.Format(job.CompletedAtTime ?? job.CreatedAtTime, DateTimeVariant.Relative, now);
            detailLine = Fill(
                localizer.GetString("export.jobDrawer.completedLine", "{{size}} \u00b7 {{relative}}"),
                ("size", size),
                ("relative", relative));
        }

        Uri? downloadUri = null;
        if (job.Status == ExportJobStatus.Ready
            && downloadBase is { } baseUri
            && !string.IsNullOrEmpty(job.Id))
        {
            downloadUri = new Uri(baseUri, DownloadPathPrefix + Uri.EscapeDataString(job.Id) + DownloadPathSuffix);
        }

        string automationName = BuildAutomationName(typeLabel, formatText, detailLine, job.ErrorMessage);

        return new JobRowDisplay(
            Id: job.Id,
            TypeLabel: typeLabel,
            FormatText: formatText,
            Status: job.Status,
            StatusGlyph: glyph,
            StatusGlyphSpins: spins,
            StatusBadge: kind,
            StatusLabel: statusLabel,
            DetailLine: detailLine,
            ErrorMessage: job.ErrorMessage,
            IsActive: job.IsActive,
            ShowDownload: job.Status == ExportJobStatus.Ready,
            DownloadUri: downloadUri,
            ShowFailedGlyph: job.Status == ExportJobStatus.Failed,
            AutomationName: automationName);
    }

    /// <summary>The localized human label for an export type (web <c>prettyType</c>); unknown types pass through.</summary>
    public static string PrettyType(string? type, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return type switch
        {
            "account" => localizer.GetString("export.types.account", "Account export"),
            "drives" => localizer.GetString("export.types.drives", "Drives"),
            "charging" => localizer.GetString("export.types.charging", "Charging"),
            "analytics" => localizer.GetString("export.types.analytics", "Analytics"),
            "backup" => localizer.GetString("export.types.backup", "Backup"),
            "import_drives" => localizer.GetString("export.types.importDrives", "Import drives"),
            "import_charging" => localizer.GetString("export.types.importCharging", "Import charging"),
            _ => string.IsNullOrEmpty(type) ? EmDash : type,
        };
    }

    /// <summary>The localized status label (web <c>prettyStatus</c>).</summary>
    public static string PrettyStatus(ExportJobStatus status, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        (_, _, _, string labelKey, string fallback) = StatusPresentation(status);
        return localizer.GetString(labelKey, fallback);
    }

    /// <summary>The icon glyph, spin flag, badge tint, i18n key and English fallback for a status (web <c>statusIcon</c>).</summary>
    public static (StatusKind Kind, string Glyph, bool Spins, string LabelKey, string Fallback) StatusPresentation(ExportJobStatus status) => status switch
    {
        ExportJobStatus.Processing => (StatusKind.Info, GlyphProcessing, true, "export.status.processing", "Processing"),
        ExportJobStatus.Ready => (StatusKind.Success, GlyphReady, false, "export.status.ready", "Ready"),
        ExportJobStatus.Failed => (StatusKind.Danger, GlyphFailed, false, "export.status.failed", "Failed"),
        ExportJobStatus.Expired => (StatusKind.Warning, GlyphExpired, false, "export.status.expired", "Expired"),
        _ => (StatusKind.Neutral, GlyphQueued, false, "export.status.queued", "Queued"),
    };

    /// <summary>
    /// Format a byte count the way the web <c>formatBytes(size, { zeroAsEmpty: true, gbDecimals: 2 })</c>
    /// helper does: null / 0 → em-dash; &lt; 1 KiB → "<c>{b} B</c>"; &lt; 1 MiB → "<c>{kb} KB</c>" (1 dp);
    /// &lt; 1 GiB → "<c>{mb} MB</c>" (1 dp); otherwise "<c>{gb} GB</c>" (2 dp).
    /// </summary>
    public static string FormatBytes(long? bytes)
    {
        if (bytes is not { } b || b <= 0)
        {
            return EmDash;
        }

        if (b < BytesPerKilobyte)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{b} B");
        }

        if (b < BytesPerMegabyte)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{b / BytesPerKilobyte:0.0} KB");
        }

        if (b < BytesPerGigabyte)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{b / BytesPerMegabyte:0.0} MB");
        }

        return string.Create(CultureInfo.InvariantCulture, $"{b / BytesPerGigabyte:0.00} GB");
    }

    /// <summary>Substitute <c>{{token}}</c> interpolation markers (i18next style) in a localized template.</summary>
    public static string Fill(string template, params (string Token, string Value)[] substitutions)
    {
        ArgumentNullException.ThrowIfNull(template);
        ArgumentNullException.ThrowIfNull(substitutions);
        string result = template;
        foreach ((string token, string value) in substitutions)
        {
            result = result.Replace("{{" + token + "}}", value, StringComparison.Ordinal);
        }

        return result;
    }

    private static string BuildAutomationName(string typeLabel, string formatText, string detailLine, string? errorMessage)
    {
        string baseName = string.IsNullOrEmpty(formatText)
            ? string.Format(CultureInfo.CurrentCulture, "{0}, {1}", typeLabel, detailLine)
            : string.Format(CultureInfo.CurrentCulture, "{0}, {1}, {2}", typeLabel, formatText, detailLine);
        return string.IsNullOrEmpty(errorMessage)
            ? baseName
            : string.Format(CultureInfo.CurrentCulture, "{0}, {1}", baseName, errorMessage);
    }
}

/// <summary>
/// Canonical registry metadata for the Job Progress drawer surface — the native mirror of the web
/// component's wiring (web/src/components/feedback/JobProgressDrawer.tsx). Pins the generated operation
/// id, the default recent cap, the persistence key and the localized chrome labels.
/// </summary>
public static class JobProgressDrawerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "JobProgressDrawer";

    /// <summary>The generated operation id for the export-jobs list (<c>GET /export/jobs</c>).</summary>
    public const string JobsOperationId = "get_api_v1_export_jobs";

    /// <summary>Default number of recently-finished jobs shown (web <c>maxRecent = 5</c>).</summary>
    public const int DefaultMaxRecent = 5;

    /// <summary>The persistence key the drawer chrome state is stored under (web localStorage key).</summary>
    public const string StorageKey = "teslasync.exportDrawer.state";

    /// <summary>Localized region label for the open panel (web <c>export.jobDrawer.label</c>).</summary>
    public static string Label(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("export.jobDrawer.label", "Export job progress");
    }

    /// <summary>Localized panel title (web <c>export.jobDrawer.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("export.jobDrawer.title", "Export jobs");
    }
}

/// <summary>
/// PII-safe diagnostics for the Job Progress drawer (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a file name, job id or export type
/// — so a diagnostics line can never leak what was exported. Thread-safe.
/// </summary>
public sealed class JobProgressDrawerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public JobProgressDrawerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=JobProgressDrawer</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={JobProgressDrawerRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;ExportJobRecord&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure
/// so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class JobProgressDrawerResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<ExportJobRecord>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<ExportJobRecord> Parse() =>
            raw.HasValue ? ExportJobRecord.ParseList(raw.Value) : Array.Empty<ExportJobRecord>();

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

/// <summary>
/// Persistence seam for the drawer's <see cref="JobDrawerPresentation"/> — the native analogue of the web
/// component's <c>localStorage</c> read/write under <see cref="JobProgressDrawerRegistration.StorageKey"/>.
/// The WinUI view binds a durable implementation (ApplicationData.LocalSettings); headless callers and
/// unit tests use <see cref="InMemoryJobDrawerStateStore"/>. Implementations must be best-effort — a
/// failing read returns the default and a failing write silently no-ops rather than throwing.
/// </summary>
public interface IJobDrawerStateStore
{
    /// <summary>Returns the persisted presentation, or <see cref="JobDrawerPresentation.Minimized"/> when absent.</summary>
    JobDrawerPresentation Load();

    /// <summary>Persists <paramref name="presentation"/>, replacing any previously stored value.</summary>
    void Save(JobDrawerPresentation presentation);
}

/// <summary>
/// An in-memory <see cref="IJobDrawerStateStore"/> used by unit tests (and as the headless fallback). It
/// is intentionally non-durable; the real app binds the LocalSettings-backed store. Mirrors the web
/// default of starting minimized when nothing is persisted.
/// </summary>
public sealed class InMemoryJobDrawerStateStore : IJobDrawerStateStore
{
    private JobDrawerPresentation _presentation;

    /// <summary>Creates the store seeded with <paramref name="initial"/> (minimized when omitted).</summary>
    public InMemoryJobDrawerStateStore(JobDrawerPresentation initial = JobDrawerPresentation.Minimized) =>
        _presentation = initial;

    /// <summary>Number of times <see cref="Save"/> has been invoked.</summary>
    public int SaveCount { get; private set; }

    /// <inheritdoc />
    public JobDrawerPresentation Load() => _presentation;

    /// <inheritdoc />
    public void Save(JobDrawerPresentation presentation)
    {
        SaveCount++;
        _presentation = presentation;
    }
}
