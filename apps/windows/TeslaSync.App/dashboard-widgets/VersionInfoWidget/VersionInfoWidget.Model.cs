using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="VersionInfoViewModel"/> can be in — the native union of the loading /
/// loaded / empty / error / stale / offline branches the web <c>VersionInfoWidget</c> renders through
/// <c>WidgetShell</c> (web/src/features/dashboard/widgets/VersionInfoWidget.tsx). The widget composes two
/// reads (server version, telemetry-capture stats); the freshness chrome is driven by the version query
/// exactly like the web (<c>updatedAt=version.dataUpdatedAt</c>, <c>isFetching=version.isFetching</c>,
/// <c>isStale=version.isStale</c>, <c>isError=version.isError</c>). <see cref="Empty"/> mirrors the web
/// <c>!hasData</c> gate (<c>version.data == null</c>) — the "No version data available" surface.
/// </summary>
public enum VersionInfoState
{
    /// <summary>Initial fetch with no content from the version read — render the skeleton chrome.</summary>
    Loading,

    /// <summary>The version read resolved with an object and is current — render the body.</summary>
    Loaded,

    /// <summary>The version read carried no value (web <c>!hasData</c>) — render the empty surface.</summary>
    Empty,

    /// <summary>The version read failed and nothing is renderable — render the retry affordance.</summary>
    Error,

    /// <summary>The shown body is backed by a version read older than the freshness window — body plus a stale chip.</summary>
    Stale,

    /// <summary>The version read is offline but cached content remains — body plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isWide</c> logic in web/src/features/dashboard/widgets/VersionInfoWidget.tsx
/// (<c>isCompact = size.cols &lt;= 1</c>, <c>isWide = size.cols &gt;= 4</c>). The registry footprint is
/// 2×2 (default), 1×2 (min), 4×40 (max).
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct VersionInfoSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static VersionInfoSize Default => new(2, 2);

    /// <summary>True at a single column (web <c>isCompact</c>): the bold version + SHA-badge stack.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at four or more columns (web <c>isWide</c>): adds the OS/Arch line and the four-up stat grid.</summary>
    public bool IsWide => Cols >= 4;
}

/// <summary>
/// The parsed <c>GET /system/version</c> body (web <c>useVersionInfo</c>). Only the fields the widget consumes
/// are kept — <see cref="ChartVersion"/> (<c>chart_version</c>), <see cref="GoVersion"/> (<c>go_version</c>),
/// <see cref="BuildDate"/> (<c>build_date</c>), <see cref="GitCommit"/> (<c>git_commit</c>),
/// <see cref="Uptime"/> (<c>uptime</c>), <see cref="Os"/> (<c>os</c>) and <see cref="Arch"/> (<c>arch</c>).
/// Each is optional; the projection falls back to the em dash exactly like the web <c>?? '—'</c>. A non-object
/// body yields <see langword="null"/> — the read carried nothing (web <c>hasData = version.data != null</c>).
/// </summary>
/// <param name="ChartVersion">The TeslaSync chart version (web <c>chart_version</c>).</param>
/// <param name="GoVersion">The Go toolchain version (web <c>go_version</c>).</param>
/// <param name="BuildDate">The build date text (web <c>build_date</c>).</param>
/// <param name="GitCommit">The full git commit SHA (web <c>git_commit</c>), truncated to seven chars for display.</param>
/// <param name="Uptime">The server uptime text (web <c>uptime</c>).</param>
/// <param name="Os">The host operating system (web <c>os</c>).</param>
/// <param name="Arch">The host architecture (web <c>arch</c>).</param>
public sealed record VersionSnapshot(
    string? ChartVersion,
    string? GoVersion,
    string? BuildDate,
    string? GitCommit,
    string? Uptime,
    string? Os,
    string? Arch)
{
    /// <summary>
    /// Project a <c>GET /system/version</c> response into the snapshot. Each field is read as tolerant display
    /// text (string verbatim, number as its raw token). A non-object body yields <see langword="null"/>, which
    /// the combine mapper collapses to the empty surface (web <c>!hasData</c>).
    /// </summary>
    public static VersionSnapshot? Parse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new VersionSnapshot(
            VersionInfoJson.ReadText(root, "chart_version"),
            VersionInfoJson.ReadText(root, "go_version"),
            VersionInfoJson.ReadText(root, "build_date"),
            VersionInfoJson.ReadText(root, "git_commit"),
            VersionInfoJson.ReadText(root, "uptime"),
            VersionInfoJson.ReadText(root, "os"),
            VersionInfoJson.ReadText(root, "arch"));
    }
}

/// <summary>
/// The parsed <c>GET /dev-tools/telemetry-capture/stats</c> body (web <c>useCaptureStats</c>). The widget
/// consumes the four data-capture readouts the web reads off the payload: <see cref="SignalsPerSec"/>
/// (<c>signals_per_sec</c>), <see cref="MessagesToday"/> (<c>messages_today</c>), <see cref="BytesProcessed"/>
/// (<c>bytes_processed</c>) and <see cref="AvgLatencyMs"/> (<c>avg_processing_latency_ms</c>). Every value is
/// optional and defaults to zero at the projection (web <c>?? 0</c>); the capture read is pure enrichment and
/// never gates the body. A non-object body yields <see langword="null"/>.
/// </summary>
/// <param name="SignalsPerSec">Signals ingested per second (web <c>signals_per_sec</c>).</param>
/// <param name="MessagesToday">Messages processed today (web <c>messages_today</c>).</param>
/// <param name="BytesProcessed">Total bytes processed (web <c>bytes_processed</c>).</param>
/// <param name="AvgLatencyMs">Average processing latency in milliseconds (web <c>avg_processing_latency_ms</c>).</param>
public sealed record CaptureSnapshot(
    double? SignalsPerSec,
    double? MessagesToday,
    double? BytesProcessed,
    double? AvgLatencyMs)
{
    /// <summary>Project a <c>GET /dev-tools/telemetry-capture/stats</c> response into the snapshot, or null for a non-object body.</summary>
    public static CaptureSnapshot? Parse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new CaptureSnapshot(
            VersionInfoJson.ReadDouble(root, "signals_per_sec"),
            VersionInfoJson.ReadDouble(root, "messages_today"),
            VersionInfoJson.ReadDouble(root, "bytes_processed"),
            VersionInfoJson.ReadDouble(root, "avg_processing_latency_ms"));
    }
}

/// <summary>Small reusable readers for the scalar fields the two reads expose, tolerant of string-or-number wire shapes.</summary>
public static class VersionInfoJson
{
    /// <summary>
    /// Read <paramref name="name"/> as display text: a JSON string is returned verbatim, a JSON number is
    /// returned as its raw token. An empty string and anything non-scalar yield <see langword="null"/> so the
    /// projection can fall back to the em dash (web <c>?? '—'</c>).
    /// </summary>
    public static string? ReadText(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var el))
        {
            return null;
        }

        return el.ValueKind switch
        {
            JsonValueKind.String => NullIfEmpty(el.GetString()),
            JsonValueKind.Number => el.GetRawText(),
            _ => null,
        };
    }

    /// <summary>Read <paramref name="name"/> as a double, or null when absent / not a number.</summary>
    public static double? ReadDouble(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number && el.TryGetDouble(out double v) ? v : null;

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;
}

/// <summary>
/// The two reads merged into one value — the native analogue of the web component's <c>version</c> /
/// <c>capture</c> hook results (web/src/features/dashboard/widgets/VersionInfoWidget.tsx). Each slice is
/// <see langword="null"/> only when its read carried no usable body (loading / failed / non-object).
/// <see cref="HasVersion"/> reproduces the web <c>hasData = version.data != null</c> gate — the version read is
/// the sole gate; the capture read only enriches the stat grid.
/// </summary>
/// <param name="Version">The parsed server-version body (web <c>version.data</c>), or null when the read carried nothing.</param>
/// <param name="Capture">The parsed capture-stats body (web <c>capture.data</c>), or null when the read carried nothing.</param>
public sealed record VersionInfoReading(VersionSnapshot? Version, CaptureSnapshot? Capture)
{
    /// <summary>True when the version read returned an object (web <c>hasData</c>).</summary>
    public bool HasVersion => Version is not null;
}

/// <summary>The display weight a <see cref="VersionKvRow"/> value renders with (web <c>font-bold</c> / <c>font-mono</c> spans).</summary>
public enum VersionValueStyle
{
    /// <summary>Default value weight.</summary>
    Normal,

    /// <summary>Bold value (web <c>&lt;span className="font-bold"&gt;</c> on the version row).</summary>
    Bold,

    /// <summary>Monospace value (web <c>&lt;span className="font-mono break-all"&gt;</c> on the Git SHA row).</summary>
    Mono,
}

/// <summary>One key/value row projected for the WinUI <c>KVList</c> (web <c>KVList</c> entry).</summary>
/// <param name="Label">The localized row label.</param>
/// <param name="Value">The pre-formatted row value (already em-dash-defaulted).</param>
/// <param name="Style">The value's display weight (web <c>font-bold</c> / <c>font-mono</c>).</param>
public sealed record VersionKvRow(string Label, string Value, VersionValueStyle Style);

/// <summary>One stat-grid tile projected for the WinUI view (web <c>WidgetStatGrid</c> item).</summary>
/// <param name="Label">The localized stat label.</param>
/// <param name="Value">The pre-formatted stat value.</param>
public sealed record VersionStatItem(string Label, string Value);

/// <summary>
/// The fully projected, render-ready view of the version-info surface for one footprint — the native analogue
/// of everything the web component computes before returning JSX. Pure data so the projection is unit-tested
/// without a UI host; the WinUI view chooses the compact / standard / wide composition from the footprint flags.
/// </summary>
/// <param name="HasData">Web <c>hasData</c>; false renders the empty surface instead of the body.</param>
/// <param name="IsCompact">Web <c>isCompact</c> (single column) — the bold-version + SHA-badge stack.</param>
/// <param name="IsWide">Web <c>isWide</c> (four-plus columns) — adds the OS/Arch line and a four-up stat grid.</param>
/// <param name="ChartVersion">The chart version value (web <c>chartVersion</c>), or the em dash.</param>
/// <param name="TruncatedSha">The seven-char Git SHA (web <c>truncatedSha</c>), or the em dash.</param>
/// <param name="KvRows">The five key/value rows (web <c>KVList</c> items).</param>
/// <param name="ShowOsArch">True to render the OS/Arch line (web <c>isWide</c> gate).</param>
/// <param name="OsLabel">The localized "OS" label.</param>
/// <param name="OsValue">The OS value (web <c>osInfo</c>), or the em dash.</param>
/// <param name="ArchLabel">The localized "Arch" label.</param>
/// <param name="ArchValue">The architecture value (web <c>archInfo</c>), or the em dash.</param>
/// <param name="StatColumns">The stat-grid column count (web <c>cols={isWide ? 4 : 2}</c>).</param>
/// <param name="Stats">The stat tiles (two standard, four wide).</param>
/// <param name="AutomationName">Narrator summary of the standard / wide body.</param>
/// <param name="CompactAutomationName">Narrator summary of the compact body.</param>
public sealed record VersionInfoDisplay(
    bool HasData,
    bool IsCompact,
    bool IsWide,
    string ChartVersion,
    string TruncatedSha,
    IReadOnlyList<VersionKvRow> KvRows,
    bool ShowOsArch,
    string OsLabel,
    string OsValue,
    string ArchLabel,
    string ArchValue,
    int StatColumns,
    IReadOnlyList<VersionStatItem> Stats,
    string AutomationName,
    string CompactAutomationName);

/// <summary>
/// Pure projection for the version-info surface — the native port of the web component's computation in
/// web/src/features/dashboard/widgets/VersionInfoWidget.tsx. Reproduces the em-dash fallbacks, the seven-char
/// SHA truncation, the human byte formatting (<c>formatBytes</c>), the signals/messages/latency readouts and
/// the footprint-driven layout selection. Every label resolves through the i18n facade.
/// </summary>
public static class VersionInfoProjection
{
    /// <summary>Segoe Fluent "Info" glyph for the surface header / empty state (web <c>Info</c> icon).</summary>
    public const string InfoGlyph = "\uE946";

    /// <summary>The em dash the web renders for an absent value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    private const int ShaLength = 7;
    private const double Kilo = 1024d;
    private const double Mega = 1024d * 1024d;
    private const double Giga = 1024d * 1024d * 1024d;

    private static readonly CultureInfo Culture = CultureInfo.GetCultureInfo("en-US");

    /// <summary>Project <paramref name="reading"/> for <paramref name="size"/> against the localizer.</summary>
    public static VersionInfoDisplay Project(VersionInfoReading reading, VersionInfoSize size, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        var version = reading.Version;
        string chartVersion = version?.ChartVersion ?? EmDash;
        string buildDate = version?.BuildDate ?? EmDash;
        string goVersion = version?.GoVersion ?? EmDash;
        string uptime = version?.Uptime ?? EmDash;
        string os = version?.Os ?? EmDash;
        string arch = version?.Arch ?? EmDash;
        string truncatedSha = TruncateSha(version?.GitCommit);

        var capture = reading.Capture;
        double signalsPerSec = capture?.SignalsPerSec ?? 0;
        double messagesToday = capture?.MessagesToday ?? 0;
        double bytesProcessed = capture?.BytesProcessed ?? 0;
        double avgLatency = capture?.AvgLatencyMs ?? 0;

        bool isCompact = size.IsCompact;
        bool isWide = size.IsWide;

        string versionLabel = localizer.GetString("widget.versionInfo.version", "Version");
        string buildDateLabel = localizer.GetString("widget.versionInfo.buildDate", "Build Date");
        string gitShaLabel = localizer.GetString("widget.versionInfo.gitSha", "Git SHA");
        string goVersionLabel = localizer.GetString("widget.versionInfo.goVersion", "Go Version");
        string uptimeLabel = localizer.GetString("widget.versionInfo.uptime", "Uptime");

        var kvRows = new List<VersionKvRow>(5)
        {
            new(versionLabel, chartVersion, VersionValueStyle.Bold),
            new(buildDateLabel, buildDate, VersionValueStyle.Normal),
            new(gitShaLabel, truncatedSha, VersionValueStyle.Mono),
            new(goVersionLabel, goVersion, VersionValueStyle.Normal),
            new(uptimeLabel, uptime, VersionValueStyle.Normal),
        };

        string signalsLabel = localizer.GetString("widget.versionInfo.signalsPerSec", "Signals/sec");
        string messagesLabel = localizer.GetString("widget.versionInfo.messagesToday", "Messages Today");

        var stats = new List<VersionStatItem>(isWide ? 4 : 2)
        {
            new(signalsLabel, Format(signalsPerSec, 1)),
            new(messagesLabel, Format(messagesToday, 0)),
        };

        if (isWide)
        {
            stats.Add(new(
                localizer.GetString("widget.versionInfo.bytesProcessed", "Bytes Processed"),
                FormatBytes(bytesProcessed)));
            stats.Add(new(
                localizer.GetString("widget.versionInfo.avgLatency", "Avg Latency"),
                string.Create(Culture, $"{Format(avgLatency, 1)} ms")));
        }

        string osLabel = localizer.GetString("widget.versionInfo.os", "OS");
        string archLabel = localizer.GetString("widget.versionInfo.arch", "Arch");
        int statColumns = isWide ? 4 : 2;

        string automation = BuildAutomationName(localizer, kvRows, stats, isWide, osLabel, os, archLabel, arch);
        string compactAutomation = BuildCompactAutomationName(localizer, versionLabel, chartVersion, gitShaLabel, truncatedSha);

        return new VersionInfoDisplay(
            HasData: reading.HasVersion,
            IsCompact: isCompact,
            IsWide: isWide,
            ChartVersion: chartVersion,
            TruncatedSha: truncatedSha,
            KvRows: kvRows,
            ShowOsArch: isWide,
            OsLabel: osLabel,
            OsValue: os,
            ArchLabel: archLabel,
            ArchValue: arch,
            StatColumns: statColumns,
            Stats: stats,
            AutomationName: automation,
            CompactAutomationName: compactAutomation);
    }

    /// <summary>
    /// Truncate the full Git SHA to its first seven characters (web <c>gitSha?.slice(0, 7) ?? '—'</c>). A null /
    /// empty SHA yields the em dash; a SHA shorter than seven characters is returned verbatim.
    /// </summary>
    public static string TruncateSha(string? gitCommit)
    {
        if (string.IsNullOrEmpty(gitCommit))
        {
            return EmDash;
        }

        return gitCommit.Length <= ShaLength ? gitCommit : gitCommit[..ShaLength];
    }

    /// <summary>
    /// Format a byte count the way the web <c>formatBytes</c> does: bytes (no decimals), KB / MB (one decimal),
    /// GB (two decimals), each with en-US grouping. Mirrors the 1024-based thresholds exactly.
    /// </summary>
    public static string FormatBytes(double bytes)
    {
        if (bytes < Kilo)
        {
            return string.Create(Culture, $"{Format(bytes, 0)} B");
        }

        if (bytes < Mega)
        {
            return string.Create(Culture, $"{Format(bytes / Kilo, 1)} KB");
        }

        if (bytes < Giga)
        {
            return string.Create(Culture, $"{Format(bytes / Mega, 1)} MB");
        }

        return string.Create(Culture, $"{Format(bytes / Giga, 2)} GB");
    }

    // Web fmtNumber(value, decimals) — en-US grouping, fixed fraction digits. fmtInt is fmtNumber(value, 0).
    private static string Format(double value, int decimals)
    {
        string format = decimals switch
        {
            0 => "N0",
            1 => "N1",
            2 => "N2",
            _ => "N0",
        };

        return value.ToString(format, Culture);
    }

    private static string BuildAutomationName(
        ILocalizer localizer,
        List<VersionKvRow> kvRows,
        List<VersionStatItem> stats,
        bool isWide,
        string osLabel,
        string os,
        string archLabel,
        string arch)
    {
        string title = localizer.GetString("widget.versionInfo.title", "Version Info");
        var parts = new List<string>(kvRows.Count + stats.Count + 2);
        foreach (var row in kvRows)
        {
            parts.Add($"{row.Label} {row.Value}");
        }

        if (isWide)
        {
            parts.Add($"{osLabel} {os}");
            parts.Add($"{archLabel} {arch}");
        }

        foreach (var stat in stats)
        {
            parts.Add($"{stat.Label} {stat.Value}");
        }

        return string.Create(CultureInfo.CurrentCulture, $"{title}: {string.Join(", ", parts)}");
    }

    private static string BuildCompactAutomationName(
        ILocalizer localizer,
        string versionLabel,
        string chartVersion,
        string gitShaLabel,
        string truncatedSha)
    {
        string title = localizer.GetString("widget.versionInfo.title", "Version Info");
        return string.Create(
            CultureInfo.CurrentCulture,
            $"{title}: {versionLabel} {chartVersion}, {gitShaLabel} {truncatedSha}");
    }
}

/// <summary>
/// Combines the two cache-then-network reads (server version, telemetry-capture stats) into a single
/// <see cref="RepositoryResult{T}"/> over the merged <see cref="VersionInfoReading"/>, preserving the freshness
/// contract. The freshness / error chrome is driven solely by the version read, exactly like the web
/// (<c>updatedAt=version.dataUpdatedAt</c>, <c>isFetching=version.isFetching</c>, <c>isStale=version.isStale</c>,
/// <c>isError=version.isError</c>); the body's empty-vs-content choice is driven by whether the version read
/// carried a value (web <c>hasData = version.data != null</c>). Kept pure so the combine contract is unit-tested
/// without a network or cache.
/// </summary>
public static class VersionInfoResultMapper
{
    /// <summary>Fold the two resolved reads into one combined emission with version-driven freshness.</summary>
    /// <param name="version">The load-bearing server-version read.</param>
    /// <param name="capture">The capture-stats enrichment read, or null while it is still loading.</param>
    public static RepositoryResult<VersionInfoReading> Combine(
        RepositoryResult<JsonElement> version,
        RepositoryResult<JsonElement>? capture)
    {
        var versionSnap = HasContent(version) && version.Value is { } versionEl ? VersionSnapshot.Parse(versionEl) : null;
        var captureSnap = capture is { } c && HasContent(c) && c.Value is { } captureEl ? CaptureSnapshot.Parse(captureEl) : null;

        var reading = new VersionInfoReading(versionSnap, captureSnap);

        if (!reading.HasVersion)
        {
            // Web parity: version.data == null → !hasData. A version hard-failure collapses to the retry surface;
            // otherwise this is the friendly "No version data available" empty surface.
            return version.Status == LoadStatus.Error
                ? RepositoryResult<VersionInfoReading>.Failure(
                    version.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load version info"))
                : RepositoryResult<VersionInfoReading>.Empty(version.FetchedAt);
        }

        // hasData → the body renders; the version read tints the freshness chip (web chrome).
        DateTimeOffset stamp = version.FetchedAt
            ?? capture?.FetchedAt
            ?? DateTimeOffset.UtcNow;

        return version.Status switch
        {
            // Version offline / errored but its cached object remains — keep the body, tint the chip as offline.
            LoadStatus.Offline or LoadStatus.Error => RepositoryResult<VersionInfoReading>.OfflineCached(
                reading, stamp, version.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Version info is unavailable")),

            // Version still in flight while its cached object is shown — body plus the "Updating…" chip.
            LoadStatus.Loading or LoadStatus.Refreshing => RepositoryResult<VersionInfoReading>.Refreshing(
                reading, stamp, version.IsStale),

            // Version surfaced a (possibly stale) cached value.
            LoadStatus.Cached => RepositoryResult<VersionInfoReading>.Cached(reading, stamp, version.IsStale),

            // Version returned fresh (Loaded) — fresh chrome unless flagged stale.
            _ => version.IsStale
                ? RepositoryResult<VersionInfoReading>.Cached(reading, stamp, stale: true)
                : RepositoryResult<VersionInfoReading>.Loaded(reading, stamp),
        };
    }

    private static bool HasContent(RepositoryResult<JsonElement> result) =>
        result.Status is LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline;
}
