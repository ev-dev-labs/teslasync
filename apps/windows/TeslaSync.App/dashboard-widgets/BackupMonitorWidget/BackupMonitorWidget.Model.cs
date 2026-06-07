using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="BackupMonitorViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>BackupMonitorWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/BackupMonitorWidget.tsx). Every branch
/// maps onto a visible surface; none is ever hidden. The web shows a single empty surface when the backup
/// runs list is empty (<c>runs.length === 0</c>), so <see cref="Empty"/> is the lone "no data" state.
/// </summary>
public enum BackupMonitorState
{
    /// <summary>Initial fetch with no cached rows — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh data from the network (or non-stale cache) with at least one run.</summary>
    Loaded,

    /// <summary>The request succeeded but there are no backup runs — render the "no backup data" empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached value exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached value older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached value remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Tolerant JSON readers shared by <see cref="BackupRun"/> and the snapshot parsers. Each returns
/// <see langword="null"/> (or a zero default) for an absent / wrong-kind property so a partial wire body
/// never throws — mirroring the web hook's defensive <c>?? 0</c> / <c>?? null</c> reads. Numeric strings
/// are accepted because the Go API occasionally serializes ids/sizes as strings.
/// </summary>
internal static class BackupMonitorJson
{
    internal static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    internal static long? GetLong(JsonElement obj, string name)
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

    internal static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }
}

/// <summary>
/// One database backup run from <c>GET /backup/runs</c> (web <c>useBackupRuns</c>, shape <c>BackupRun</c>
/// in web/src/api/types.ts). Only the fields the widget renders are projected — the <see cref="Id"/>, the
/// <see cref="Status"/>, the <see cref="BackupType"/>, the byte <see cref="FileSizeBytes"/>, the
/// <see cref="CreatedAt"/> / <see cref="CompletedAt"/> timestamps (kept as raw wire strings as the web does,
/// parsed on demand) and the optional <see cref="DurationMs"/>. Parsing is null-tolerant so a partial row
/// never throws.
/// </summary>
public sealed record BackupRun(
    long Id,
    string? Status,
    string? BackupType,
    double FileSizeBytes,
    string? CreatedAt,
    string? CompletedAt,
    long? DurationMs)
{
    /// <summary>The parsed creation instant, or <see langword="null"/> when absent/unparseable.</summary>
    [JsonIgnore]
    public DateTimeOffset? CreatedAtTime => TryParseTimestamp(CreatedAt);

    /// <summary>The parsed completion instant, or <see langword="null"/> when absent/unparseable.</summary>
    [JsonIgnore]
    public DateTimeOffset? CompletedAtTime => TryParseTimestamp(CompletedAt);

    /// <summary>
    /// The instant used to order and timestamp the run (web <c>completedAt ?? createdAt</c>): the completion
    /// time when present, otherwise the creation time.
    /// </summary>
    [JsonIgnore]
    public DateTimeOffset? SortTime => CompletedAtTime ?? CreatedAtTime;

    /// <summary>Project a single backup-run JSON object into a <see cref="BackupRun"/>.</summary>
    public static BackupRun FromJson(JsonElement obj) => new(
        Id: BackupMonitorJson.GetLong(obj, "id") ?? 0,
        Status: BackupMonitorJson.GetString(obj, "status"),
        BackupType: BackupMonitorJson.GetString(obj, "backup_type"),
        FileSizeBytes: BackupMonitorJson.GetDouble(obj, "file_size") ?? 0,
        CreatedAt: BackupMonitorJson.GetString(obj, "created_at"),
        CompletedAt: BackupMonitorJson.GetString(obj, "completed_at"),
        DurationMs: BackupMonitorJson.GetLong(obj, "duration_ms"));

    private static DateTimeOffset? TryParseTimestamp(string? raw)
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
/// The parsed backup-runs payload backing the widget: the list of <see cref="Runs"/> returned by
/// <c>GET /backup/runs</c> (web <c>useBackupRuns</c>). <see cref="HasData"/> distinguishes a fetched payload
/// (even one with no runs) from the absent-body fallback used for the first projection, so an empty list is
/// rendered as the "no backup data" empty surface rather than the engine's generic empty. This type
/// round-trips losslessly through the cache (System.Text.Json over its own well-formed serialization), so
/// the source caches it directly rather than the raw wire JSON.
/// </summary>
public sealed record BackupMonitorSnapshot(IReadOnlyList<BackupRun> Runs)
{
    /// <summary>The absent-body fallback (no payload yet) — flagged <see cref="HasData"/> = false.</summary>
    public static BackupMonitorSnapshot Empty { get; } =
        new(Array.Empty<BackupRun>()) { HasData = false };

    /// <summary>True when a payload has been fetched (web <c>data</c> truthiness). False only for <see cref="Empty"/>.</summary>
    public bool HasData { get; init; } = true;

    /// <summary>True when at least one backup run is present.</summary>
    [JsonIgnore]
    public bool HasRuns => Runs.Count > 0;

    /// <summary>Project a backup-runs JSON array into a tolerant list of <see cref="BackupRun"/>.</summary>
    public static IReadOnlyList<BackupRun> ParseRuns(JsonElement runs)
    {
        if (runs.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<BackupRun>();
        }

        var list = new List<BackupRun>(runs.GetArrayLength());
        foreach (var item in runs.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(BackupRun.FromJson(item));
            }
        }

        return list;
    }

    /// <summary>A fetched snapshot from the backup-runs array (web <c>data ?? []</c>).</summary>
    public static BackupMonitorSnapshot FromJson(JsonElement runs) => new(ParseRuns(runs));
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isWide</c> logic in web/src/features/dashboard/widgets/BackupMonitorWidget.tsx: a
/// single column shows the compact status line; two columns show the 2×2 stat grid; four-plus columns add
/// the newest-first "Recent Runs" feed (web <c>sortedRuns.slice(0, 5)</c>).
/// </summary>
public readonly record struct BackupMonitorSize(int Cols, int Rows)
{
    /// <summary>Maximum rows in the wide "Recent Runs" feed (web <c>sortedRuns.slice(0, 5)</c>).</summary>
    public const int RecentRunsCap = 5;

    /// <summary>The registry default footprint (2×2).</summary>
    public static BackupMonitorSize Default => new(2, 2);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>).</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at four-plus columns (web <c>isWide = size.cols &gt;= 4</c>).</summary>
    public bool IsWide => Cols >= 4;
}

/// <summary>
/// One projected, display-ready run row consumed by the WinUI "Recent Runs" feed. Holds the absolute run
/// time string, the byte-size + duration subline, the localized status label and the semantic
/// <see cref="Status"/> tone (driving both the leading dot colour and the trailing badge, web
/// <c>statusDotColor</c> ≡ <c>statusVariant</c>), plus a Narrator name. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record BackupRunRow(
    long Id,
    StatusKind Status,
    string TimeText,
    string SubText,
    string StatusText,
    string AccessibilityName);

/// <summary>
/// The fully projected, render-ready view of the backup monitor for one footprint — the native analogue of
/// everything the web component computes via <c>useMemo</c> before returning JSX: the latest run's relative
/// time / size / type / status (web <c>latestRun</c>, <c>latestStatus</c>), and the newest-first, five-row
/// "Recent Runs" feed (web <c>sortedRuns.slice(0, 5)</c>), plus every localized label. Pure data so the
/// projection is unit-tested directly.
/// </summary>
public sealed record BackupMonitorDisplay(
    bool HasData,
    bool HasRuns,
    bool IsCompact,
    bool IsWide,
    string LastBackupLabel,
    string LastBackupValue,
    string SizeLabel,
    string SizeValue,
    string TypeLabel,
    string TypeValue,
    string StatusLabel,
    string LatestStatusText,
    StatusKind LatestStatusKind,
    bool LatestIsFailed,
    string CompactAutomationName,
    string RecentRunsLabel,
    IReadOnlyList<BackupRunRow> RecentRuns,
    string EmptyMessage);

/// <summary>
/// Pure projection from a parsed <see cref="BackupMonitorSnapshot"/> to the display model — the native port
/// of the <c>sortedRuns</c> / <c>latestRun</c> <c>useMemo</c> work plus the <c>fmtBytes</c>,
/// <c>fmtRelativeTime</c>, <c>statusVariant</c>, <c>statusLabel</c> and <c>statusDotColor</c> helpers in
/// web/src/features/dashboard/widgets/BackupMonitorWidget.tsx. Byte sizes are dimensionless (no SI
/// conversion needed); every label resolves through the i18n facade. <c>now</c> is injected so the
/// relative-time tiers are deterministic in tests.
/// </summary>
public static class BackupMonitorProjection
{
    private static readonly string[] ByteUnits = { "B", "KB", "MB", "GB", "TB" };

    /// <summary>Wire status value for a completed backup run.</summary>
    private const string StatusCompleted = "completed";

    /// <summary>Wire status value for an in-progress backup run.</summary>
    private const string StatusRunning = "running";

    /// <summary>Wire status value for a queued backup run.</summary>
    private const string StatusQueued = "queued";

    /// <summary>Wire status value for a failed backup run (also the null/unknown default, web <c>?? 'failed'</c>).</summary>
    private const string StatusFailed = "failed";

    /// <summary>
    /// Format a byte count into a human-readable size exactly as the web <c>fmtBytes</c> helper does: "0 B"
    /// for non-positive input; otherwise the largest fitting unit (B/KB/MB/GB/TB) with one decimal below 10
    /// (e.g. "1.5 GB") and a rounded integer at or above 10 (e.g. "450 MB"). Invariant-culture so the
    /// output matches the web's locale-independent <c>toFixed</c> / <c>Math.round</c>.
    /// </summary>
    public static string FormatBytes(double bytes)
    {
        if (double.IsNaN(bytes) || bytes <= 0)
        {
            return "0 B";
        }

        int i = (int)Math.Floor(Math.Log(bytes) / Math.Log(1024));
        i = Math.Clamp(i, 0, ByteUnits.Length - 1);
        double val = bytes / Math.Pow(1024, i);
        string num = val < 10
            ? val.ToString("0.0", CultureInfo.InvariantCulture)
            : Math.Round(val, MidpointRounding.AwayFromZero).ToString(CultureInfo.InvariantCulture);
        return string.Create(CultureInfo.InvariantCulture, $"{num} {ByteUnits[i]}");
    }

    /// <summary>
    /// Format an instant as relative time exactly as the web <c>fmtRelativeTime</c> helper does: the em-dash
    /// for a null/unparseable value, "just now" for the present (or a future instant), then "<c>{m}m ago</c>"
    /// (under an hour), "<c>{h}h ago</c>" (under a day) and "<c>{d}d ago</c>". Deterministic against
    /// <paramref name="now"/>.
    /// </summary>
    public static string FormatRelativeTime(DateTimeOffset? value, DateTimeOffset now)
    {
        if (value is not { } d)
        {
            return DateTimeFormatting.DefaultEmptyDisplay;
        }

        TimeSpan diff = now - d;
        if (diff < TimeSpan.Zero)
        {
            return "just now";
        }

        long mins = (long)Math.Floor(diff.TotalMinutes);
        if (mins < 1)
        {
            return "just now";
        }

        if (mins < 60)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{mins}m ago");
        }

        long hrs = mins / 60;
        if (hrs < 24)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{hrs}h ago");
        }

        long days = hrs / 24;
        return string.Create(CultureInfo.InvariantCulture, $"{days}d ago");
    }

    /// <summary>
    /// Map a wire status to its semantic tone (web <c>statusVariant</c> ≡ <c>statusDotColor</c>): completed →
    /// success (green), running/queued → warning (amber), everything else → danger (red).
    /// </summary>
    public static StatusKind StatusKindFor(string? status) => status switch
    {
        StatusCompleted => StatusKind.Success,
        StatusRunning or StatusQueued => StatusKind.Warning,
        _ => StatusKind.Danger,
    };

    /// <summary>Resolve the localized status label (web <c>statusLabel</c>).</summary>
    public static string StatusLabelFor(string? status, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return status switch
        {
            StatusCompleted => localizer.GetString("widget.backupMonitor.statusSuccess", "Success"),
            StatusRunning => localizer.GetString("widget.backupMonitor.statusRunning", "Running"),
            StatusQueued => localizer.GetString("widget.backupMonitor.statusQueued", "Queued"),
            _ => localizer.GetString("widget.backupMonitor.statusFailed", "Failed"),
        };
    }

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> at <paramref name="now"/> using the i18n facade.</summary>
    public static BackupMonitorDisplay Project(
        BackupMonitorSnapshot data,
        BackupMonitorSize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        string lastBackupLabel = localizer.GetString("widget.backupMonitor.lastBackup", "Last backup");
        string sizeLabel = localizer.GetString("widget.backupMonitor.size", "Backup Size");
        string typeLabel = localizer.GetString("widget.backupMonitor.type", "Type");
        string statusLabel = localizer.GetString("widget.backupMonitor.status", "Status");
        string recentRunsLabel = localizer.GetString("widget.backupMonitor.recentRuns", "Recent Runs");
        string emptyMessage = localizer.GetString("widget.backupMonitor.noData", "No backup data");

        var sorted = SortedRuns(data.Runs);
        var latest = sorted.Count > 0 ? sorted[0] : null;

        string lastBackupValue = FormatRelativeTime(latest?.SortTime, now);
        string sizeValue = FormatBytes(latest?.FileSizeBytes ?? 0);
        string typeValue = string.IsNullOrEmpty(latest?.BackupType)
            ? DateTimeFormatting.DefaultEmptyDisplay
            : latest!.BackupType!;
        string latestStatusText = StatusLabelFor(latest?.Status, localizer);
        StatusKind latestStatusKind = StatusKindFor(latest?.Status);

        // Web parity: the failed tint keys off the literal latest status (`latestStatus === 'failed'`), not
        // every danger-toned status — an unknown status is danger-toned but does not paint the cell red.
        bool latestIsFailed = string.Equals(latest?.Status, StatusFailed, StringComparison.Ordinal);

        string compactAutomationName = string.Format(
            CultureInfo.CurrentCulture, "{0}: {1}, {2}", lastBackupLabel, lastBackupValue, latestStatusText);

        var recentRuns = ProjectRecentRows(sorted, BackupMonitorSize.RecentRunsCap, localizer, now);

        return new BackupMonitorDisplay(
            HasData: data.HasData,
            HasRuns: sorted.Count > 0,
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            LastBackupLabel: lastBackupLabel,
            LastBackupValue: lastBackupValue,
            SizeLabel: sizeLabel,
            SizeValue: sizeValue,
            TypeLabel: typeLabel,
            TypeValue: typeValue,
            StatusLabel: statusLabel,
            LatestStatusText: latestStatusText,
            LatestStatusKind: latestStatusKind,
            LatestIsFailed: latestIsFailed,
            CompactAutomationName: compactAutomationName,
            RecentRunsLabel: recentRunsLabel,
            RecentRuns: recentRuns,
            EmptyMessage: emptyMessage);
    }

    /// <summary>Order runs newest-first by completion-or-creation time (web <c>sortedRuns</c>).</summary>
    public static IReadOnlyList<BackupRun> SortedRuns(IReadOnlyList<BackupRun> runs)
    {
        ArgumentNullException.ThrowIfNull(runs);
        return runs
            .OrderByDescending(r => r.SortTime ?? DateTimeOffset.MinValue)
            .ToList();
    }

    private static List<BackupRunRow> ProjectRecentRows(
        IReadOnlyList<BackupRun> sorted,
        int cap,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        var rows = new List<BackupRunRow>(Math.Min(sorted.Count, cap));
        foreach (var run in sorted.Take(cap))
        {
            string timeText = DateTimeFormatting.Format(run.SortTime, DateTimeVariant.Full, now);
            string sizeText = FormatBytes(run.FileSizeBytes);
            string subText = run.DurationMs is { } ms
                ? string.Create(CultureInfo.InvariantCulture, $"{sizeText} \u00B7 {ms}ms")
                : sizeText;
            string statusText = StatusLabelFor(run.Status, localizer);
            string accessibilityName = string.Format(
                CultureInfo.CurrentCulture, "{0}, {1}, {2}", timeText, subText, statusText);

            rows.Add(new BackupRunRow(
                Id: run.Id,
                Status: StatusKindFor(run.Status),
                TimeText: timeText,
                SubText: subText,
                StatusText: statusText,
                AccessibilityName: accessibilityName));
        }

        return rows;
    }
}
