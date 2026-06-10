using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the queue-status surface. Every getter returns a
/// fallback rather than throwing so a partial or schema-drifted worker row from <c>GET /system/queues</c>
/// never aborts the parse (web parity: the React component tolerates undefined fields). Kept private to the
/// surface and free of WinUI types so the parse is unit-tested without a UI host.
/// </summary>
internal static class QueueStatusJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The numeric value of <paramref name="name"/>, tolerating a number or numeric-string field (0 fallback).</summary>
    public static double GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return 0;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => 0,
        };
    }

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field (0 fallback).</summary>
    public static long GetLong(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return 0;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.Number when prop.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => 0,
        };
    }

    /// <summary>
    /// Parse the backend heartbeat-staleness token (<c>ok</c> / <c>warn</c> / <c>critical</c> / <c>down</c>).
    /// An unrecognised / absent token maps to <see cref="QueueHeartbeatSeverity.Down"/> — the most
    /// conservative "we have not heard from this worker" band (web parity: a worker that never reports renders
    /// as <c>down</c>).
    /// </summary>
    public static QueueHeartbeatSeverity ParseSeverity(string? raw) => raw switch
    {
        "ok" => QueueHeartbeatSeverity.Ok,
        "warn" => QueueHeartbeatSeverity.Warn,
        "critical" => QueueHeartbeatSeverity.Critical,
        _ => QueueHeartbeatSeverity.Down,
    };

    /// <summary>Parse an ISO-8601 timestamp string to a UTC-normalised instant, or null when unparseable.</summary>
    public static DateTimeOffset? TryParseTimestamp(string? raw)
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
}

/// <summary>
/// The heartbeat-staleness band the backend reports for a worker — the native analogue of the web
/// <c>QueueHeartbeatSeverity = 'ok' | 'warn' | 'critical' | 'down'</c> union
/// (web/src/api/types.ts). Severity comes straight from the backend so threshold tuning is a single Go ship.
/// </summary>
public enum QueueHeartbeatSeverity
{
    /// <summary>Heartbeat is fresh — green (web <c>#10b981</c>).</summary>
    Ok,

    /// <summary>Heartbeat is lagging (amber after 60s, web <c>#f59e0b</c>).</summary>
    Warn,

    /// <summary>Heartbeat is stale (red after 5m, web <c>#ef4444</c>).</summary>
    Critical,

    /// <summary>The worker has never reported in — slate / muted (web <c>#94a3b8</c>).</summary>
    Down,
}

/// <summary>
/// One worker row from <c>GET /system/queues</c> — the native analogue of the web <c>QueueStat</c> shape
/// (web/src/api/types.ts). Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a
/// partial row never throws. The raw <c>last_heartbeat_at</c> string is kept and parsed on demand. Pure data —
/// unit-tested without a UI host.
/// </summary>
public sealed record QueueWorkerStat(
    string Worker,
    string DisplayName,
    long Pending,
    long InProgress,
    long Succeeded24h,
    long Failed24h,
    double OldestPendingAgeSeconds,
    QueueHeartbeatSeverity HeartbeatSeverity,
    string? HeartbeatDetail,
    string? LastHeartbeatAt,
    string? Host,
    string? Version)
{
    /// <summary>The parsed most-recent-heartbeat instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? LastHeartbeatInstant => QueueStatusJson.TryParseTimestamp(LastHeartbeatAt);

    /// <summary>Parse a single worker JSON object into a <see cref="QueueWorkerStat"/>.</summary>
    public static QueueWorkerStat FromJson(JsonElement obj) => new(
        Worker: QueueStatusJson.GetString(obj, "worker") ?? string.Empty,
        DisplayName: QueueStatusJson.GetString(obj, "display_name") ?? string.Empty,
        Pending: QueueStatusJson.GetLong(obj, "pending"),
        InProgress: QueueStatusJson.GetLong(obj, "in_progress"),
        Succeeded24h: QueueStatusJson.GetLong(obj, "succeeded_24h"),
        Failed24h: QueueStatusJson.GetLong(obj, "failed_24h"),
        OldestPendingAgeSeconds: QueueStatusJson.GetDouble(obj, "oldest_pending_age_seconds"),
        HeartbeatSeverity: QueueStatusJson.ParseSeverity(QueueStatusJson.GetString(obj, "heartbeat_severity")),
        HeartbeatDetail: QueueStatusJson.GetString(obj, "heartbeat_detail"),
        LastHeartbeatAt: QueueStatusJson.GetString(obj, "last_heartbeat_at"),
        Host: QueueStatusJson.GetString(obj, "host"),
        Version: QueueStatusJson.GetString(obj, "version"));

    /// <summary>Parse the <c>workers</c> JSON array into a tolerant list (non-objects skipped).</summary>
    public static IReadOnlyList<QueueWorkerStat> ParseList(JsonElement array)
    {
        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<QueueWorkerStat>();
        }

        var list = new List<QueueWorkerStat>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>
/// The decoded envelope for <c>GET /system/queues</c> — the native analogue of the web
/// <c>QueueStatusResponse</c> (web/src/api/types.ts). Holds the server-stamped <see cref="GeneratedAt"/>
/// (rendered relative in the "Updated {when}" caption) and the per-worker <see cref="Workers"/>.
/// </summary>
public sealed record QueueStatusSnapshot(
    string? GeneratedAt,
    IReadOnlyList<QueueWorkerStat> Workers)
{
    /// <summary>An empty snapshot (no workers) — the parse / projection fallback.</summary>
    public static QueueStatusSnapshot Empty { get; } = new(null, Array.Empty<QueueWorkerStat>());

    /// <summary>The parsed generated-at instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? GeneratedAtInstant => QueueStatusJson.TryParseTimestamp(GeneratedAt);

    /// <summary>Parse the queue-status response object into a tolerant snapshot.</summary>
    public static QueueStatusSnapshot FromJson(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        string? generatedAt = QueueStatusJson.GetString(obj, "generated_at");
        IReadOnlyList<QueueWorkerStat> workers = obj.TryGetProperty("workers", out var workersEl)
            ? QueueWorkerStat.ParseList(workersEl)
            : Array.Empty<QueueWorkerStat>();
        return new QueueStatusSnapshot(generatedAt, workers);
    }
}

/// <summary>
/// The lifecycle state the queue panel can be in. Every branch maps onto a visible surface — none is ever
/// hidden (engineering rule #6). The web shows <c>Spinner → cards | empty text | inline error</c>; the native
/// surface additionally renders explicit <c>stale</c> and <c>offline</c> freshness branches (a strict superset
/// of the web that satisfies the prompt's mandated state set).
/// </summary>
public enum QueuePanelState
{
    /// <summary>First fetch with nothing cached — render the skeleton / spinner.</summary>
    Loading,

    /// <summary>A fresh (network or non-stale cache) result with cards to show.</summary>
    Loaded,

    /// <summary>The read resolved with no workers — the friendly empty text.</summary>
    Empty,

    /// <summary>The read failed and no cached cards exist — the retry affordance.</summary>
    Error,

    /// <summary>A cached result older than the freshness window — cards plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached cards remain — cards plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One projected, render-ready worker card — the native analogue of a <c>WorkerCard</c> in
/// web/src/features/admin/components/QueueStatusPanel.tsx. Holds the display name, the localized severity label
/// + its token status/brush (web <c>SEVERITY_TONE_CLASS</c> / <c>SEVERITY_COLOR</c>), the host/version
/// caption, the queue-depth bar value/max + its label and "{pending} pending · {inProgress} in progress"
/// sublabel, the succeeded / failed 24h counts (with the danger flag the web sets when failures &gt; 0), the
/// heartbeat caption, the optional "Oldest pending: {duration}" backlog caption, the "Show recent {worker}
/// jobs" activation label (web card <c>aria-label</c>) and a composite Narrator name. Pure data.
/// </summary>
public sealed record QueueWorkerDisplay(
    string Worker,
    string DisplayName,
    string SeverityLabel,
    StatusKind SeverityStatus,
    string AccentBrushKey,
    string HostLabel,
    double QueueDepthValue,
    double QueueDepthMax,
    string QueueDepthLabel,
    string QueueDepthDetail,
    string SucceededLabel,
    string SucceededValue,
    string FailedLabel,
    string FailedValue,
    bool FailedIsDanger,
    string HeartbeatLabel,
    string? OldestLabel,
    string OpenLabel,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the panel body — the native analogue of the <c>workers.map</c>
/// card list in web/src/features/admin/components/QueueStatusPanel.tsx. <see cref="HasRows"/> reproduces the
/// web <c>workers.length === 0</c> empty / cards gate.
/// </summary>
public sealed record QueuePanelDisplay(
    bool HasRows,
    IReadOnlyList<QueueWorkerDisplay> Rows)
{
    /// <summary>An empty display (no workers) — the projection fallback.</summary>
    public static QueuePanelDisplay Empty { get; } = new(false, Array.Empty<QueueWorkerDisplay>());
}

/// <summary>
/// A 1:1 port of the web <c>formatDurationMsLong</c> (web/src/lib/dateFormat.ts) used by the oldest-pending
/// backlog label. Renders a millisecond span as <c>"500ms"</c> / <c>"5.0s"</c> / <c>"2m 5s"</c>, matching the
/// web's <c>toFixed(1)</c> seconds and <c>formatRoundedInt</c> minute-remainder. Non-positive / non-finite
/// inputs render the em-dash. Pure — unit-tested with golden vectors.
/// </summary>
public static class QueueDuration
{
    /// <summary>Em-dash fallback for non-positive / non-finite spans (web parity '—').</summary>
    public const string EmDash = "\u2014";

    /// <summary>Format a positive millisecond span the way the web backlog label does.</summary>
    public static string FormatMsLong(double ms)
    {
        if (double.IsNaN(ms) || double.IsInfinity(ms) || ms <= 0)
        {
            return EmDash;
        }

        if (ms < 1000)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{(long)ms}ms");
        }

        double sec = ms / 1000.0;
        if (sec < 60)
        {
            return NumberFormatting.Format(sec, null, 1) + "s";
        }

        long min = (long)Math.Floor(sec / 60.0);
        double remainder = sec % 60.0;
        return string.Create(CultureInfo.InvariantCulture, $"{min}m {NumberFormatting.Format(remainder, null, 0)}s");
    }
}

/// <summary>
/// A 1:1 port of the web <c>formatRelative</c> (web/src/lib/dateFormat.ts) used by the heartbeat and "Updated"
/// captions. Renders <c>"just now"</c> (&lt; 60s, including future timestamps), then <c>"{m}m ago"</c>,
/// <c>"{h}h ago"</c> and <c>"{d}d ago"</c> tiers, falling back to an absolute <c>"MMM d, yyyy"</c> date beyond
/// a week — distinct from the app's <c>DateTimeVariant.Relative</c> (web <c>formatRelativeTime</c>), which has
/// no day tier. <c>now</c> is injected so the tiers are unit-tested deterministically. Pure.
/// </summary>
public static class QueueRelativeTime
{
    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");

    /// <summary>Format <paramref name="value"/> relative to <paramref name="now"/> the way the web card does.</summary>
    public static string Format(DateTimeOffset value, DateTimeOffset now)
    {
        long seconds = (long)Math.Floor((now - value).TotalSeconds);
        if (seconds < 60)
        {
            return "just now";
        }

        long minutes = seconds / 60;
        if (minutes < 60)
        {
            return string.Create(CultureInfo.CurrentCulture, $"{minutes}m ago");
        }

        long hours = minutes / 60;
        if (hours < 24)
        {
            return string.Create(CultureInfo.CurrentCulture, $"{hours}h ago");
        }

        long days = hours / 24;
        if (days < 7)
        {
            return string.Create(CultureInfo.CurrentCulture, $"{days}d ago");
        }

        return value.LocalDateTime.ToString("MMM d, yyyy", EnUs);
    }
}

/// <summary>
/// Pure projection from the parsed workers to the render-ready card models — the native port of the
/// <c>WorkerCard</c> render (the host/version caption, the queue-depth bar, the succeeded / failed counts, the
/// severity tone mapping, the heartbeat label and the oldest-pending backlog) plus the "Updated {when}"
/// caption, in web/src/features/admin/components/QueueStatusPanel.tsx. <c>now</c> is injected so the relative
/// heartbeat / "Updated" stamps are unit-tested deterministically; every label resolves through the i18n
/// facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class QueueStatusProjection
{
    /// <summary>Project the worker list into render-ready cards using the i18n facade.</summary>
    public static QueuePanelDisplay Project(
        IReadOnlyList<QueueWorkerStat> workers,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(workers);
        ArgumentNullException.ThrowIfNull(localizer);

        var rows = new List<QueueWorkerDisplay>(workers.Count);
        foreach (var worker in workers)
        {
            StatusKind status = StatusFor(worker.HeartbeatSeverity);
            string severityLabel = SeverityLabel(worker.HeartbeatSeverity, localizer);
            double total = worker.Pending + worker.InProgress;
            string depthDetail = QueueDepthDetail(worker, localizer);
            string heartbeat = HeartbeatLabel(worker, localizer, now);
            string? oldest = OldestLabel(worker, localizer);
            string succeeded = ScalarFormatters.FormatNumber(worker.Succeeded24h);
            string failed = ScalarFormatters.FormatNumber(worker.Failed24h);

            rows.Add(new QueueWorkerDisplay(
                Worker: worker.Worker,
                DisplayName: worker.DisplayName,
                SeverityLabel: severityLabel,
                SeverityStatus: status,
                AccentBrushKey: StatusResources.AccentBrushKey(status),
                HostLabel: HostLabel(worker, localizer),
                QueueDepthValue: total,
                QueueDepthMax: total > 0 ? total : 1,
                QueueDepthLabel: localizer.GetString("queueStatus.queueDepth", "Queue depth"),
                QueueDepthDetail: depthDetail,
                SucceededLabel: localizer.GetString("queueStatus.metric.succeeded24h", "Succeeded 24h"),
                SucceededValue: succeeded,
                FailedLabel: localizer.GetString("queueStatus.metric.failed24h", "Failed 24h"),
                FailedValue: failed,
                FailedIsDanger: worker.Failed24h > 0,
                HeartbeatLabel: heartbeat,
                OldestLabel: oldest,
                OpenLabel: OpenLabel(worker, localizer),
                AutomationName: AutomationName(worker.DisplayName, severityLabel, depthDetail, succeeded, failed, heartbeat, oldest, localizer)));
        }

        return new QueuePanelDisplay(rows.Count > 0, rows);
    }

    /// <summary>The localized "Updated {when}" caption (web <c>updatedLabel</c>), or null when no timestamp.</summary>
    public static string? UpdatedLabel(DateTimeOffset? generatedAt, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (generatedAt is not { } ts)
        {
            return null;
        }

        return string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("queueStatus.lastUpdated", "Updated {0}"),
            QueueRelativeTime.Format(ts, now));
    }

    /// <summary>Map a heartbeat severity to its token status (web <c>SEVERITY_TONE_CLASS</c> / <c>SEVERITY_COLOR</c>).</summary>
    public static StatusKind StatusFor(QueueHeartbeatSeverity severity) => severity switch
    {
        QueueHeartbeatSeverity.Ok => StatusKind.Success,
        QueueHeartbeatSeverity.Warn => StatusKind.Warning,
        QueueHeartbeatSeverity.Critical => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    private static string SeverityLabel(QueueHeartbeatSeverity severity, ILocalizer localizer) => severity switch
    {
        QueueHeartbeatSeverity.Ok => localizer.GetString("queueStatus.severity.ok", "Healthy"),
        QueueHeartbeatSeverity.Warn => localizer.GetString("queueStatus.severity.warn", "Lagging"),
        QueueHeartbeatSeverity.Critical => localizer.GetString("queueStatus.severity.critical", "Stale"),
        _ => localizer.GetString("queueStatus.severity.down", "Down"),
    };

    // web: stat.host ? '{host} · {version || unknown}' : 'No host reported'.
    private static string HostLabel(QueueWorkerStat worker, ILocalizer localizer)
    {
        if (string.IsNullOrEmpty(worker.Host))
        {
            return localizer.GetString("queueStatus.hostUnknown", "No host reported");
        }

        string version = string.IsNullOrEmpty(worker.Version)
            ? localizer.GetString("queueStatus.versionUnknown", "unknown")
            : worker.Version;

        return string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("queueStatus.hostVersion", "{0} \u00b7 {1}"),
            worker.Host,
            version);
    }

    // web: t('queueStatus.queueDepthDetail', '{{pending}} pending · {{inProgress}} in progress', ...).
    // Counts are integers, so the native scalar formatter renders them at precision 0 with grouping.
    private static string QueueDepthDetail(QueueWorkerStat worker, ILocalizer localizer) => string.Format(
        CultureInfo.CurrentCulture,
        localizer.GetString("queueStatus.queueDepthDetail", "{0} pending \u00b7 {1} in progress"),
        ScalarFormatters.FormatNumber(worker.Pending),
        ScalarFormatters.FormatNumber(worker.InProgress));

    // web: stat.heartbeat_detail || lastBeatLabel, where lastBeatLabel is the relative "Last beat {when}"
    // (or "No heartbeat recorded" when the worker has never reported a heartbeat).
    private static string HeartbeatLabel(QueueWorkerStat worker, ILocalizer localizer, DateTimeOffset now)
    {
        if (!string.IsNullOrEmpty(worker.HeartbeatDetail))
        {
            return worker.HeartbeatDetail;
        }

        if (worker.LastHeartbeatInstant is not { } beat)
        {
            return localizer.GetString("queueStatus.heartbeatNever", "No heartbeat recorded");
        }

        return string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("queueStatus.heartbeatRelative", "Last beat {0}"),
            QueueRelativeTime.Format(beat, now));
    }

    // web: oldest_pending_age_seconds > 0 → 'Oldest pending: {{duration}}', else no label.
    private static string? OldestLabel(QueueWorkerStat worker, ILocalizer localizer)
    {
        if (worker.OldestPendingAgeSeconds <= 0)
        {
            return null;
        }

        return string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString("queueStatus.oldestPending", "Oldest pending: {0}"),
            QueueDuration.FormatMsLong(worker.OldestPendingAgeSeconds * 1000.0));
    }

    // web card aria-label: t('queueStatus.openDrawer', 'Show recent {{worker}} jobs', { worker: display_name }).
    private static string OpenLabel(QueueWorkerStat worker, ILocalizer localizer) => string.Format(
        CultureInfo.CurrentCulture,
        localizer.GetString("queueStatus.openDrawer", "Show recent {0} jobs"),
        worker.DisplayName);

    private static string AutomationName(
        string displayName,
        string severityLabel,
        string depthDetail,
        string succeeded,
        string failed,
        string heartbeat,
        string? oldest,
        ILocalizer localizer)
    {
        string core = string.Format(
            CultureInfo.CurrentCulture,
            "{0}, {1}, {2}, {3} {4}, {5} {6}, {7}",
            displayName,
            severityLabel,
            depthDetail,
            localizer.GetString("queueStatus.metric.succeeded24h", "Succeeded 24h"),
            succeeded,
            localizer.GetString("queueStatus.metric.failed24h", "Failed 24h"),
            failed,
            heartbeat);
        return oldest is null
            ? core
            : string.Format(CultureInfo.CurrentCulture, "{0}, {1}", core, oldest);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions to typed
/// <c>RepositoryResult&lt;QueueStatusSnapshot&gt;</c>, preserving the cache-then-network status/freshness while
/// parsing the snake_case payload (the native analogue of the web hook's typed query result). A value-bearing
/// status always carries the parsed snapshot (even when its <c>workers</c> array is empty) so the header's
/// "Updated {when}" caption survives a zero-worker response, exactly as the web header does; the body's empty
/// state is derived downstream from the row count, not from a lost payload. Pure — unit-tested without a
/// network or cache.
/// </summary>
public static class QueueStatusResultMapper
{
    /// <summary>Map a raw queue-status emission to a typed snapshot result.</summary>
    public static RepositoryResult<QueueStatusSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<QueueStatusSnapshot>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<QueueStatusSnapshot>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<QueueStatusSnapshot>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var snapshot = QueueStatusSnapshot.FromJson(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<QueueStatusSnapshot>.Cached(snapshot, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<QueueStatusSnapshot>.Refreshing(snapshot, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<QueueStatusSnapshot>.OfflineCached(
                snapshot, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<QueueStatusSnapshot>.Loaded(snapshot, fetchedAt),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the queue-status surface — the native mirror of the web admin panel
/// (web/src/features/admin/components/QueueStatusPanel.tsx). Centralises the stable id, the diagnostics slug,
/// and the localized title/subtitle so the view and view-model stay free of literal copy.
/// </summary>
public static class QueueStatusRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "queue-status-panel";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "QueueStatusPanel";

    /// <summary>Localized panel title (web <c>queueStatus.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("queueStatus.title", "Background workers");

    /// <summary>Localized panel subtitle (web <c>queueStatus.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Require(localizer).GetString(
            "queueStatus.subtitle",
            "Live view of the notification, export, and automation worker queues. Heartbeat colour switches from green to amber after 60 seconds and to red after 5 minutes of silence; \"down\" means the worker has never reported in.");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the queue-status surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a worker id, host or heartbeat detail —
/// so a diagnostics line can never leak operator-specific worker data. Thread-safe.
/// </summary>
public sealed class QueueStatusDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public QueueStatusDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=QueueStatusPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={QueueStatusRegistration.Slug}");
    }
}
