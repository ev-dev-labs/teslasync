using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state an <see cref="AnomalyDetectorViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>AnomalyDetectorWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetTipCards</c>
/// (web/src/features/dashboard/widgets/AnomalyDetectorWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web "no anomalies" gate (a resolved
/// report whose <c>anomalies</c> array is empty) rather than an absent HTTP body.
/// </summary>
public enum AnomalyDetectorState
{
    /// <summary>Initial fetch with no cached report — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh report from the network (or non-stale cache) carrying at least one anomaly.</summary>
    Loaded,

    /// <summary>The report resolved with no anomalies — render the friendly "No anomalies" state.</summary>
    Empty,

    /// <summary>The request failed and no cached report exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached report older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached report remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One statistical-outlier row from <c>GET /analytics/anomalies</c> (web <c>useAnomalies</c>, shape
/// <c>AnomalyEntry</c> in web/src/api/hooks/useAnomalies.ts). Field names mirror the Go API's
/// snake_case JSON tags (<c>z_score</c>, <c>detected_at</c>, …); parsing is null-tolerant so a partial
/// row never throws. <see cref="DetectedAt"/> is kept as the raw wire string (as the web does) and
/// parsed on demand via <see cref="DetectedAtTime"/>.
/// </summary>
public sealed record AnomalyEntry(
    string? Signal,
    string Type,
    string Severity,
    double Value,
    double Baseline,
    double ZScore,
    string? DetectedAt,
    string? Message)
{
    /// <summary>The parsed detection instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? DetectedAtTime => TryParseTimestamp(DetectedAt);

    /// <summary>Parse a <c>GET /analytics/anomalies</c> <c>anomalies</c> JSON array into tolerant rows.</summary>
    public static IReadOnlyList<AnomalyEntry> ParseArray(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AnomalyEntry>();
        }

        var list = new List<AnomalyEntry>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single anomaly JSON object into an <see cref="AnomalyEntry"/>.</summary>
    public static AnomalyEntry FromJson(JsonElement obj) => new(
        Signal: GetString(obj, "signal"),
        Type: GetString(obj, "type") ?? string.Empty,
        Severity: GetString(obj, "severity") ?? "info",
        Value: GetDouble(obj, "value") ?? 0,
        Baseline: GetDouble(obj, "baseline") ?? 0,
        ZScore: GetDouble(obj, "z_score") ?? 0,
        DetectedAt: GetString(obj, "detected_at"),
        Message: GetString(obj, "message"));

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

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
/// The anomaly report read-model the widget consumes — the <c>anomalies</c> array from the
/// <c>GET /analytics/anomalies</c> object body (the sibling <c>signals_monitored</c> / <c>health_summary</c>
/// fields are not surfaced by this widget, mirroring the web component which reads only
/// <c>data.anomalies</c>). Parsing is tolerant so a partial or non-object body yields
/// <see cref="Empty"/> rather than throwing.
/// </summary>
public sealed record AnomalyReport(IReadOnlyList<AnomalyEntry> Anomalies)
{
    /// <summary>An anomaly-free report — the parse fallback for an absent/non-object body.</summary>
    public static AnomalyReport Empty { get; } = new(Array.Empty<AnomalyEntry>());

    /// <summary>True when there is at least one anomaly to surface (web <c>anomalies.length &gt; 0</c>).</summary>
    public bool HasAnomalies => Anomalies.Count > 0;

    /// <summary>Project a <c>GET /analytics/anomalies</c> JSON body into a tolerant report.</summary>
    public static AnomalyReport FromJson(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Array)
        {
            return new AnomalyReport(AnomalyEntry.ParseArray(element));
        }

        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty("anomalies", out var arr) &&
            arr.ValueKind == JsonValueKind.Array)
        {
            return new AnomalyReport(AnomalyEntry.ParseArray(arr));
        }

        return Empty;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact</c> branch in web/src/features/dashboard/widgets/AnomalyDetectorWidget.tsx.
/// </summary>
public readonly record struct AnomalyDetectorSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static AnomalyDetectorSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>): show the count + badge.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready anomaly tip consumed by the WinUI view — the native analogue of a web
/// <c>TipItem</c> (the <c>tips</c> <c>useMemo</c> in the web component). Holds the resolved severity
/// glyph + accent brush key (the icon colour), the composed title (<c>signal · z=… · relative</c>), the
/// message, the localized severity label plus the impact-coloured badge status (the web
/// <c>impactBadgeMap</c>), and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record AnomalyTip(
    string Id,
    string Glyph,
    string IconBrushKey,
    string Title,
    string Description,
    string ImpactLabel,
    StatusKind ImpactStatus,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the anomaly report for one footprint — the native analogue
/// of everything the web component computes via <c>useMemo</c> before returning JSX. Holds the compact
/// count + its severity badge, plus the severity-sorted tips for the standard layout. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record AnomalyDetectorDisplay(
    bool IsCompact,
    bool HasAnomalies,
    int Count,
    string CountText,
    string ActiveCountLabel,
    StatusKind CountStatus,
    string CountAutomationName,
    IReadOnlyList<AnomalyTip> Tips);

/// <summary>
/// Pure projection from a raw <see cref="AnomalyReport"/> to the display model — the native port of the
/// <c>tips</c> / compact <c>useMemo</c> logic in
/// web/src/features/dashboard/widgets/AnomalyDetectorWidget.tsx. Anomalies are severity-sorted
/// (critical → warning → info, the web <c>SEVERITY_ORDER</c>); each label resolves through the i18n
/// facade. <paramref name="now"/> is injected so the relative-time tiers are unit-tested
/// deterministically.
/// </summary>
public static class AnomalyDetectorProjection
{
    /// <summary>Maximum tips the standard layout renders, mirroring the web <c>WidgetTipCards</c> default cap.</summary>
    public const int MaxStandardTips = 3;

    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="report"/> for <paramref name="size"/> relative to <paramref name="now"/>.</summary>
    public static AnomalyDetectorDisplay Project(
        AnomalyReport report,
        AnomalyDetectorSize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(report);
        ArgumentNullException.ThrowIfNull(localizer);

        var sorted = report.Anomalies
            .OrderBy(a => SeverityRank(a.Severity))
            .ToList();

        var tips = new List<AnomalyTip>(sorted.Count);
        foreach (var entry in sorted)
        {
            tips.Add(BuildTip(entry, localizer, now));
        }

        int count = report.Anomalies.Count;
        string countText = count.ToString(CultureInfo.InvariantCulture);
        string activeLabel = ActiveCountLabel(localizer, count);

        var topSeverity = sorted.Count > 0
            ? SeverityLevels.Normalize(sorted[0].Severity)
            : SeverityLevel.Info;
        string topSeverityLabel = sorted.Count > 0
            ? SeverityLabel(localizer, sorted[0].Severity)
            : SeverityLabel(localizer, "info");

        string countAutomationName = string.Format(
            CultureInfo.CurrentCulture, "{0}, {1}", activeLabel, topSeverityLabel);

        return new AnomalyDetectorDisplay(
            IsCompact: size.IsCompact,
            HasAnomalies: report.HasAnomalies,
            Count: count,
            CountText: countText,
            ActiveCountLabel: activeLabel,
            CountStatus: SeverityBadgeStatus(topSeverity),
            CountAutomationName: countAutomationName,
            Tips: tips);
    }

    /// <summary>Localized "{n} active" label (web <c>widget.anomalyDetector.activeCount</c>).</summary>
    public static string ActiveCountLabel(ILocalizer localizer, int count)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string countText = count.ToString(CultureInfo.InvariantCulture);
        string template = localizer.GetString("widget.anomalyDetector.activeCount", "{0} active");
        return template
            .Replace("{{count}}", countText, StringComparison.Ordinal)
            .Replace("{count}", countText, StringComparison.Ordinal)
            .Replace("{0}", countText, StringComparison.Ordinal);
    }

    /// <summary>Localized severity label (web <c>widget.anomalyDetector.severity.{severity}</c>).</summary>
    public static string SeverityLabel(ILocalizer localizer, string severity)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string wire = string.IsNullOrEmpty(severity) ? EmDash : severity;
        return localizer.GetString($"widget.anomalyDetector.severity.{severity}", wire);
    }

    /// <summary>Web <c>SEVERITY_ORDER</c> rank: critical 0, warning 1, info (and anything else) 2.</summary>
    public static int SeverityRank(string severity) => SeverityLevels.Normalize(severity) switch
    {
        SeverityLevel.Critical => 0,
        SeverityLevel.Warn => 1,
        _ => 2,
    };

    private static AnomalyTip BuildTip(AnomalyEntry entry, ILocalizer localizer, DateTimeOffset now)
    {
        var level = SeverityLevels.Normalize(entry.Severity);
        var tokens = SeverityLevels.Tokens(level);

        string signal = entry.Signal ?? EmDash;
        string zScore = ScalarFormatters.FormatNumber(entry.ZScore, 1);
        string relative = FormatRelativeTime(entry.DetectedAtTime, now);
        string title = string.Format(CultureInfo.CurrentCulture, "{0} \u00B7 z={1} \u00B7 {2}", signal, zScore, relative);
        string description = entry.Message ?? EmDash;
        string impactLabel = SeverityLabel(localizer, entry.Severity);

        return new AnomalyTip(
            Id: $"{entry.Signal}-{entry.DetectedAt}",
            Glyph: tokens.IconGlyph,
            IconBrushKey: tokens.AccentBrushKey,
            Title: title,
            Description: description,
            ImpactLabel: impactLabel,
            ImpactStatus: ImpactBadgeStatus(level),
            AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}. {2}", impactLabel, title, description));
    }

    /// <summary>
    /// Web <c>impactBadgeMap[SEVERITY_IMPACT[severity]]</c>: critical → high → success, warning → medium →
    /// warning, info (and anything else) → low → neutral. Drives the tip badge tint.
    /// </summary>
    private static StatusKind ImpactBadgeStatus(SeverityLevel level) => level switch
    {
        SeverityLevel.Critical => StatusKind.Success,
        SeverityLevel.Warn => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    /// <summary>
    /// Web <c>SEVERITY_BADGE[maxSeverity]</c>: critical → danger, warning → warning, info (and anything
    /// else) → neutral. Drives the compact count badge tint.
    /// </summary>
    private static StatusKind SeverityBadgeStatus(SeverityLevel level) => level switch
    {
        SeverityLevel.Critical => StatusKind.Danger,
        SeverityLevel.Warn => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    /// <summary>
    /// The web component's local <c>formatRelativeTime</c> tiers: "Just now" (&lt; 1m), "{n}m ago"
    /// (&lt; 60m), "{n}h ago" (&lt; 24h), otherwise "{n}d ago". Null/unparseable timestamps render the
    /// em-dash fallback rather than the web's "NaNd ago".
    /// </summary>
    public static string FormatRelativeTime(DateTimeOffset? detectedAt, DateTimeOffset now)
    {
        if (detectedAt is not { } d)
        {
            return EmDash;
        }

        long diffMin = (long)Math.Floor((now - d).TotalMinutes);
        if (diffMin < 1)
        {
            return "Just now";
        }

        if (diffMin < 60)
        {
            return $"{diffMin}m ago";
        }

        long diffHrs = diffMin / 60;
        if (diffHrs < 24)
        {
            return $"{diffHrs}h ago";
        }

        long diffDays = diffHrs / 24;
        return $"{diffDays}d ago";
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;AnomalyReport&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. A
/// resolved report carrying no anomalies collapses to <see cref="RepositoryResult{T}.Empty"/> so the
/// view shows the "No anomalies" state (web parity). Kept pure so the parse-and-preserve contract is
/// unit-tested without a network or cache.
/// </summary>
public static class AnomalyDetectorResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<AnomalyReport> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        AnomalyReport Parse() => raw.HasValue ? AnomalyReport.FromJson(raw.Value) : AnomalyReport.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<AnomalyReport>.Loading(),
            LoadStatus.Cached => RepositoryResult<AnomalyReport>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<AnomalyReport>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<AnomalyReport>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<AnomalyReport>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<AnomalyReport>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<AnomalyReport> ToLoadedOrEmpty(AnomalyReport report, DateTimeOffset? fetchedAt)
        => report.HasAnomalies
            ? RepositoryResult<AnomalyReport>.Loaded(report, fetchedAt ?? DateTimeOffset.UtcNow)
            : RepositoryResult<AnomalyReport>.Empty(fetchedAt);
}
