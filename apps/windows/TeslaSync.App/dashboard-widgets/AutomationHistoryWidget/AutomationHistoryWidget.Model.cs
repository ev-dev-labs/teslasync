using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state an <see cref="AutomationHistoryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>AutomationHistoryWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetEventFeed</c>
/// (web/src/features/dashboard/widgets/AutomationHistoryWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>items.length === 0</c> gate
/// (the run history resolved with no rows); the wide footprint still renders the success-rate header
/// above the feed's empty message, exactly as the web does.
/// </summary>
public enum AutomationHistoryState
{
    /// <summary>Initial fetch with no cached rows — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh rows from the network (or non-stale cache).</summary>
    Loaded,

    /// <summary>The request resolved with no automation runs — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached rows exist — render the retry affordance.</summary>
    Error,

    /// <summary>Cached rows older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached rows remain — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Tolerant JSON readers shared by <see cref="AutomationRun"/> and <see cref="AutomationHistorySummary"/>.
/// Each returns <see langword="null"/> (or a zero default) for an absent / wrong-kind property so a
/// partial wire body never throws — mirroring the web hook's defensive <c>?? 0</c> / <c>?? null</c> reads.
/// </summary>
internal static class AutomationHistoryJson
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

    internal static int GetInt(JsonElement obj, string name) =>
        (int)Math.Round(GetDouble(obj, name) ?? 0, MidpointRounding.AwayFromZero);
}

/// <summary>
/// One automation-run history entry from <c>GET /automations/history</c> (web <c>useAutomationHistory</c>,
/// shape <c>AutomationHistory</c> in web/src/api/types.ts). Field names mirror the Go API's snake_case
/// JSON tags; parsing is null-tolerant so a partial row never throws. <see cref="TriggeredAt"/> is kept
/// as the raw wire string (as the web does) and parsed on demand via <see cref="TriggeredAtTime"/>.
/// Only the fields the widget renders are projected — id, automation name, status, duration, trigger time.
/// </summary>
public sealed record AutomationRun(
    long Id,
    string? AutomationName,
    string Status,
    double? DurationMs,
    string? TriggeredAt)
{
    /// <summary>The parsed trigger instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? TriggeredAtTime => TryParseTimestamp(TriggeredAt);

    /// <summary>Project a single history JSON object into an <see cref="AutomationRun"/>.</summary>
    public static AutomationRun FromJson(JsonElement obj) => new(
        Id: AutomationHistoryJson.GetLong(obj, "id") ?? 0,
        AutomationName: AutomationHistoryJson.GetString(obj, "automation_name"),
        Status: AutomationHistoryJson.GetString(obj, "status") ?? string.Empty,
        DurationMs: AutomationHistoryJson.GetDouble(obj, "duration_ms"),
        TriggeredAt: AutomationHistoryJson.GetString(obj, "triggered_at"));

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
/// The roll-up summary from <c>GET /automations/history</c> (web <c>AutomationHistoryStats</c>). Only the
/// two fields the widget reads are projected: <see cref="SuccessRate"/> (already a 0..100 percentage,
/// dimensionless at the display boundary) and <see cref="TotalExecutions"/>. Parsing is null-tolerant.
/// </summary>
public sealed record AutomationHistorySummary(int TotalExecutions, double SuccessRate)
{
    /// <summary>Project a <c>summary</c> JSON object into an <see cref="AutomationHistorySummary"/>.</summary>
    public static AutomationHistorySummary FromJson(JsonElement obj) => new(
        TotalExecutions: AutomationHistoryJson.GetInt(obj, "total_executions"),
        SuccessRate: AutomationHistoryJson.GetDouble(obj, "success_rate") ?? 0);
}

/// <summary>
/// The parsed <c>GET /automations/history</c> payload (web <c>AutomationHistoryListResponse</c>): the run
/// <see cref="Items"/> plus the optional <see cref="Summary"/>. <see cref="HasData"/> distinguishes a
/// present body (even one with zero runs) from an absent/non-object body — the web gates its empty state
/// on <c>items.length === 0</c>, so an idle fleet renders the success-rate header with zero rows rather
/// than as a blank surface.
/// </summary>
public sealed record AutomationHistorySnapshot(
    IReadOnlyList<AutomationRun> Items,
    AutomationHistorySummary? Summary)
{
    /// <summary>An absent-body fallback flagged as having no payload (the parse fallback for a non-object body).</summary>
    public static AutomationHistorySnapshot Empty { get; } =
        new(Array.Empty<AutomationRun>(), null) { HasData = false };

    /// <summary>True when a payload object is present (web <c>data</c> truthiness). False only for <see cref="Empty"/>.</summary>
    public bool HasData { get; init; } = true;

    /// <summary>Project a <c>GET /automations/history</c> JSON object into a tolerant snapshot.</summary>
    public static AutomationHistorySnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var items = ParseItems(element);
        AutomationHistorySummary? summary =
            element.TryGetProperty("summary", out var s) && s.ValueKind == JsonValueKind.Object
                ? AutomationHistorySummary.FromJson(s)
                : null;

        return new AutomationHistorySnapshot(items, summary);
    }

    private static IReadOnlyList<AutomationRun> ParseItems(JsonElement obj)
    {
        if (!obj.TryGetProperty("items", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AutomationRun>();
        }

        var list = new List<AutomationRun>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(AutomationRun.FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> logic in web/src/features/dashboard/widgets/AutomationHistoryWidget.tsx (a single
/// column renders the success-rate hero; wider footprints render the success header + run feed). The
/// feed is always capped at ten rows, matching the web <c>maxItems={10}</c>.
/// </summary>
public readonly record struct AutomationHistorySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static AutomationHistorySize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): show the success-rate hero.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>Maximum feed rows rendered (web <c>maxItems={10}</c>, independent of footprint).</summary>
    public const int MaxFeedItems = 10;
}

/// <summary>
/// Status → presentation mapping for an automation run — the native port of <c>STATUS_MAP</c> in
/// web/src/features/dashboard/widgets/AutomationHistoryWidget.tsx. Each status resolves a Segoe Fluent
/// glyph (approximating the web Lucide icon) and a token brush key (approximating the web hex accent).
/// Unknown statuses fall back to the play glyph + muted accent (web <c>DEFAULT_STATUS</c>).
/// </summary>
public static class AutomationRunStatus
{
    /// <summary>Segoe Fluent — Play (web <c>PlayCircle</c>): the header icon, the <c>test</c> and default rows.</summary>
    public const string PlayGlyph = "\uE768";

    /// <summary>Segoe Fluent — Completed (web <c>CheckCircle</c>): a successful run.</summary>
    public const string CheckGlyph = "\uE930";

    /// <summary>Segoe Fluent — ErrorBadge (web <c>XCircle</c>): a failed / cancelled run.</summary>
    public const string ErrorGlyph = "\uEA39";

    /// <summary>Segoe Fluent — Clock (web <c>Clock</c>): a partial / running / skipped / undo run.</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Resolve the glyph + token accent brush key for a wire status string (case-insensitive).</summary>
    public static (string Glyph, string AccentBrushKey) Tokens(string? status) =>
        (status?.Trim().ToLowerInvariant()) switch
        {
            "success" => (CheckGlyph, "TsColorSuccessBrush"),
            "failed" => (ErrorGlyph, "TsColorDangerBrush"),
            "partial" => (ClockGlyph, "TsColorWarningBrush"),
            "running" => (ClockGlyph, "TsColorInfoBrush"),
            "skipped" => (ClockGlyph, "TsColorTextMutedBrush"),
            "cancelled" => (ErrorGlyph, "TsColorTextMutedBrush"),
            "test" => (PlayGlyph, "TsColorAccentBrush"),
            "undo" => (ClockGlyph, "TsColorTextMutedBrush"),
            _ => (PlayGlyph, "TsColorTextMutedBrush"),
        };
}

/// <summary>
/// One projected, display-ready run row consumed by the WinUI feed. Holds the resolved status
/// presentation (glyph + token brush key), the localized-or-raw title/subtitle, the relative time string,
/// and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record AutomationRunRow(
    long Id,
    string Glyph,
    string AccentBrushKey,
    string Title,
    string Subtitle,
    string RelativeTime,
    DateTimeOffset? Timestamp,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the run history for one footprint — the native analogue of
/// everything the web component computes via <c>useMemo</c> before returning JSX. Holds the feed rows plus
/// the success-rate hero (compact) / badge header (wide) strings and the footprint flag. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record AutomationHistoryDisplay(
    bool HasData,
    bool IsCompact,
    bool HasItems,
    IReadOnlyList<AutomationRunRow> Items,
    string SuccessRateText,
    string CompactValueText,
    string SuccessRateLabel,
    string BadgeText,
    StatusKind SuccessRateStatus,
    bool HasSummary,
    string TotalRunsText,
    string LastRunRelative,
    string CompactAutomationName);

/// <summary>
/// Pure projection from a parsed <see cref="AutomationHistorySnapshot"/> to the display model — the native
/// port of the <c>feedItems</c> / <c>successRate</c> <c>useMemo</c> work plus the compact branch in
/// web/src/features/dashboard/widgets/AutomationHistoryWidget.tsx. The success rate is dimensionless (no SI
/// conversion); every label resolves through the i18n facade. <c>now</c> is injected so the relative-time
/// tiers are unit-tested deterministically.
/// </summary>
public static class AutomationHistoryProjection
{
    /// <summary>Success rate at or above which the badge is success-toned (web <c>successRate &gt;= 90</c>).</summary>
    public const double HighSuccessThreshold = 90.0;

    /// <summary>Success rate at or above which the badge is warning-toned (web <c>successRate &gt;= 50</c>).</summary>
    public const double MidSuccessThreshold = 50.0;

    /// <summary>Em-dash fallback for a missing title / status / duration (web <c>?? '—'</c> and the FALLBACK constant).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> at <paramref name="now"/> using the i18n facade.</summary>
    public static AutomationHistoryDisplay Project(
        AutomationHistorySnapshot data,
        AutomationHistorySize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        double successRate = data.Summary?.SuccessRate ?? 0;
        string successRateText = ScalarFormatters.FormatNumber(successRate, 1);
        string compactValueText = $"{successRateText}%";
        string successRateLabel = localizer.GetString("widget.successRate", "Success Rate");
        string badgeText = string.Format(CultureInfo.CurrentCulture, "{0}% {1}", successRateText, successRateLabel);
        StatusKind status = SuccessRateStatusFor(successRate);

        bool hasSummary = data.Summary is not null;
        string runsWord = localizer.GetString("widget.totalRuns", "runs");
        string totalRunsText = hasSummary
            ? string.Format(
                CultureInfo.CurrentCulture,
                "{0} {1}",
                ScalarFormatters.FormatNumber(data.Summary!.TotalExecutions, 0),
                runsWord)
            : string.Empty;

        var rows = ProjectRows(data.Items, now);
        string lastRunRelative = LastRunRelative(data.Items, now);
        string compactAutomationName = string.IsNullOrEmpty(lastRunRelative)
            ? string.Format(CultureInfo.CurrentCulture, "{0} {1}", compactValueText, successRateLabel)
            : string.Format(CultureInfo.CurrentCulture, "{0} {1}, {2}", compactValueText, successRateLabel, lastRunRelative);

        return new AutomationHistoryDisplay(
            HasData: data.HasData,
            IsCompact: size.IsCompact,
            HasItems: rows.Count > 0,
            Items: rows,
            SuccessRateText: successRateText,
            CompactValueText: compactValueText,
            SuccessRateLabel: successRateLabel,
            BadgeText: badgeText,
            SuccessRateStatus: status,
            HasSummary: hasSummary,
            TotalRunsText: totalRunsText,
            LastRunRelative: lastRunRelative,
            CompactAutomationName: compactAutomationName);
    }

    /// <summary>The web <c>Badge</c> variant tone for a success rate (success ≥ 90, warning ≥ 50, else danger).</summary>
    public static StatusKind SuccessRateStatusFor(double rate) =>
        rate >= HighSuccessThreshold ? StatusKind.Success
        : rate >= MidSuccessThreshold ? StatusKind.Warning
        : StatusKind.Danger;

    /// <summary>
    /// Format a millisecond duration as the web <c>formatDurationMs</c> does: the em-dash for a
    /// null/non-finite value, "<c>{ms}ms</c>" below one second, otherwise "<c>{s}s</c>" with one decimal.
    /// </summary>
    public static string FormatDurationMs(double? ms)
    {
        if (ms is not { } v || double.IsNaN(v) || double.IsInfinity(v))
        {
            return EmDash;
        }

        return v < 1000
            ? string.Format(CultureInfo.InvariantCulture, "{0:0.###}ms", v)
            : string.Format(CultureInfo.InvariantCulture, "{0:0.0}s", v / 1000.0);
    }

    private static List<AutomationRunRow> ProjectRows(
        IReadOnlyList<AutomationRun> items,
        DateTimeOffset now)
    {
        var ordered = items
            .OrderByDescending(e => e.TriggeredAtTime ?? DateTimeOffset.MinValue)
            .Take(AutomationHistorySize.MaxFeedItems);

        var rows = new List<AutomationRunRow>(Math.Min(items.Count, AutomationHistorySize.MaxFeedItems));
        foreach (var entry in ordered)
        {
            var (glyph, brushKey) = AutomationRunStatus.Tokens(entry.Status);
            string title = string.IsNullOrEmpty(entry.AutomationName) ? EmDash : entry.AutomationName!;
            string statusLabel = string.IsNullOrEmpty(entry.Status) ? EmDash : entry.Status;
            string duration = FormatDurationMs(entry.DurationMs);
            string subtitle = string.Format(CultureInfo.CurrentCulture, "{0} \u00b7 {1}", statusLabel, duration);
            string relative = DateTimeFormatting.Format(entry.TriggeredAtTime, DateTimeVariant.Relative, now);
            string automationName = string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", title, statusLabel, relative);

            rows.Add(new AutomationRunRow(
                Id: entry.Id,
                Glyph: glyph,
                AccentBrushKey: brushKey,
                Title: title,
                Subtitle: subtitle,
                RelativeTime: relative,
                Timestamp: entry.TriggeredAtTime,
                AutomationName: automationName));
        }

        return rows;
    }

    private static string LastRunRelative(IReadOnlyList<AutomationRun> items, DateTimeOffset now)
    {
        // Web parity: the compact hero reads the raw first item (items[0]), not the sorted feed head.
        if (items.Count == 0 || string.IsNullOrEmpty(items[0].TriggeredAt))
        {
            return string.Empty;
        }

        return DateTimeFormatting.Format(items[0].TriggeredAtTime, DateTimeVariant.Relative, now);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;AutomationHistorySnapshot&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure
/// so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class AutomationHistoryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<AutomationHistorySnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        AutomationHistorySnapshot Parse() =>
            raw.HasValue ? AutomationHistorySnapshot.FromJson(raw.Value) : AutomationHistorySnapshot.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<AutomationHistorySnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<AutomationHistorySnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<AutomationHistorySnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<AutomationHistorySnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<AutomationHistorySnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<AutomationHistorySnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<AutomationHistorySnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
