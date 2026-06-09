using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="NotificationStatsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>NotificationStatsWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetStatGrid</c> + <c>DataTable</c>
/// (web/src/features/dashboard/widgets/NotificationStatsWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. Faithful to the web component, the load-bearing notification-stats read
/// drives the matrix while the recent-delivery log read merely enriches the wide table. <see cref="Empty"/>
/// mirrors the web outer <c>{stats ? … : &lt;EmptyState&gt;}</c> gate (an absent stats body), not a value
/// threshold — the grid renders for any populated object, even an all-zero idle fleet.
/// </summary>
public enum NotificationStatsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot from the network (or non-stale cache) with stats to show.</summary>
    Loaded,

    /// <summary>The stats response carried no object (null / absent body) — render the empty state.</summary>
    Empty,

    /// <summary>The stats request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The notification-delivery rollup from <c>GET /notifications/stats</c> (web <c>useNotificationStats</c>,
/// shape <c>NotificationStats</c> in web/src/api/types.ts). Field names mirror the Go API's snake_case JSON
/// tags; parsing reads snake_case first and falls back to camelCase (the <c>camelCaseKeys</c> transform
/// shape) so a contract shift never throws. Every value is a dimensionless count, so no unit conversion
/// applies — <see cref="DeliveryRate"/> is derived exactly as the web component does.
/// </summary>
public sealed record NotificationStatsData(
    long TotalSent,
    long Sent,
    long Failed,
    long Pending,
    long TotalChannels,
    long EnabledChannels)
{
    /// <summary>An all-zero snapshot flagged as having no payload — the parse fallback for an absent/non-object body.</summary>
    public static NotificationStatsData Empty { get; } = new(0, 0, 0, 0, 0, 0) { HasData = false };

    /// <summary>
    /// True when a stats payload is present (web <c>stats</c> truthiness). The backend always returns a
    /// populated object — including for an idle inbox, which renders as zeros — so this is true for every
    /// real snapshot and only false for the <see cref="Empty"/> fallback (an absent body). Gates the
    /// empty state.
    /// </summary>
    public bool HasData { get; init; } = true;

    /// <summary>
    /// The 7-day delivery rate as a percentage (web <c>totalSent &gt; 0 ? (sent / totalSent) * 100 : 0</c>).
    /// </summary>
    public double DeliveryRate => TotalSent > 0 ? (double)Sent / TotalSent * 100.0 : 0.0;

    /// <summary>Project a <c>GET /notifications/stats</c> JSON object into a tolerant snapshot.</summary>
    public static NotificationStatsData FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new NotificationStatsData(
            TotalSent: GetLong(element, "total_sent", "totalSent"),
            Sent: GetLong(element, "sent", "sent"),
            Failed: GetLong(element, "failed", "failed"),
            Pending: GetLong(element, "pending", "pending"),
            TotalChannels: GetLong(element, "total_channels", "totalChannels"),
            EnabledChannels: GetLong(element, "enabled_channels", "enabledChannels"));
    }

    private static long GetLong(JsonElement obj, string snake, string camel) =>
        ReadLong(obj, snake) ?? ReadLong(obj, camel) ?? 0;

    private static long? ReadLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.Number when v.TryGetDouble(out var d) => (long)Math.Round(d, MidpointRounding.AwayFromZero),
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }
}

/// <summary>
/// One recent delivery-log row from <c>GET /notifications/logs</c> (web <c>useNotificationLogs</c>, shape
/// <c>NotificationLog</c> in web/src/api/types.ts). Field names mirror the Go API's snake_case JSON tags;
/// parsing is null-tolerant so a partial row never throws (mirroring the web's defensive <c>?? '—'</c>
/// reads). Only the fields the widget renders are projected — id, title (the "Channel" column), message
/// (the "Type" column), status, and the created time. The raw wire timestamp is kept (as the web does) and
/// parsed on demand via <see cref="CreatedAtTime"/>.
/// </summary>
public sealed record NotificationLogEntry(
    long Id,
    string? Title,
    string? Message,
    string? Status,
    string? CreatedAt)
{
    /// <summary>The parsed creation instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => TryParseTimestamp(CreatedAt);

    /// <summary>Parse a <c>GET /notifications/logs</c> JSON array into a tolerant list of rows.</summary>
    public static IReadOnlyList<NotificationLogEntry> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<NotificationLogEntry>();
        }

        var list = new List<NotificationLogEntry>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single delivery-log JSON object into a <see cref="NotificationLogEntry"/>.</summary>
    public static NotificationLogEntry FromJson(JsonElement obj) => new(
        Id: GetId(obj),
        Title: GetString(obj, "title"),
        Message: GetString(obj, "message"),
        Status: GetString(obj, "status"),
        CreatedAt: GetString(obj, "created_at") ?? GetString(obj, "createdAt"));

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static long GetId(JsonElement obj)
    {
        if (!obj.TryGetProperty("id", out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
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
/// Status → presentation mapping for a delivery-log row — the native port of the web <c>STATUS_VARIANT</c>
/// map plus the per-status icon ternaries in
/// web/src/features/dashboard/widgets/NotificationStatsWidget.tsx. Comparisons are case-sensitive against
/// the exact lowercase wire values the Go notification worker writes (<c>"sent"</c> / <c>"failed"</c> /
/// <c>"pending"</c>), matching the web's strict object-key lookups and <c>=== 'sent'</c> checks. Each known
/// status resolves a <see cref="StatusKind"/> badge tone and a Segoe Fluent glyph (approximating the web
/// Lucide icon); an unknown / <see langword="null"/> status falls back to the warning tone with no icon
/// (web <c>STATUS_VARIANT[status] ?? 'warning'</c> with no icon branch taken).
/// </summary>
public static class NotificationStatuses
{
    /// <summary>Segoe Fluent — Completed (web <c>CheckCircle</c>): a delivered notification.</summary>
    public const string SentGlyph = "\uE930";

    /// <summary>Segoe Fluent — ErrorBadge (web <c>XCircle</c>): a failed delivery.</summary>
    public const string FailedGlyph = "\uEA39";

    /// <summary>Segoe Fluent — Clock (web <c>Clock</c>): a pending delivery.</summary>
    public const string PendingGlyph = "\uE823";

    /// <summary>Em-dash fallback for a missing channel / type / status (web <c>?? '—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>
    /// The badge tone for a wire status (web <c>STATUS_VARIANT[status] ?? 'warning'</c>): sent → success,
    /// failed → danger, pending → warning, anything else (including <see langword="null"/>) → warning.
    /// </summary>
    public static StatusKind Variant(string? status) => status switch
    {
        "sent" => StatusKind.Success,
        "failed" => StatusKind.Danger,
        "pending" => StatusKind.Warning,
        _ => StatusKind.Warning,
    };

    /// <summary>
    /// The leading badge glyph for a wire status (web's per-status icon ternaries): sent → check, failed →
    /// error, pending → clock, anything else → no icon (empty string).
    /// </summary>
    public static string Glyph(string? status) => status switch
    {
        "sent" => SentGlyph,
        "failed" => FailedGlyph,
        "pending" => PendingGlyph,
        _ => string.Empty,
    };

    /// <summary>The displayed status label, or the em-dash when absent (web <c>{log.status ?? '—'}</c>).</summary>
    public static string Label(string? status) => string.IsNullOrEmpty(status) ? EmDash : status;
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols &lt;= 1</c> / <c>isWide = size.cols &gt;= 3</c> branches in
/// web/src/features/dashboard/widgets/NotificationStatsWidget.tsx. The compact footprint renders the big
/// delivery-rate number; the standard footprint renders the four-tile stat grid (two-up); the wide
/// footprint widens the grid to four-up and adds the recent-delivery table.
/// </summary>
public readonly record struct NotificationStatsSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static NotificationStatsSize Default => new(2, 2);

    /// <summary>True at a single column (web <c>isCompact</c>): show the big delivery-rate number.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three or more columns (web <c>isWide</c>): four-up grid plus the recent table.</summary>
    public bool IsWide => Cols >= 3;

    /// <summary>Stat-grid column count (web <c>cols={isWide ? 4 : 2}</c>).</summary>
    public int StatColumns => IsWide ? 4 : 2;

    /// <summary>Recent-log row budget (web <c>limit = isCompact ? 3 : 5</c>).</summary>
    public int RecentLogLimit => IsCompact ? 3 : 5;
}

/// <summary>
/// A small directional badge attached to a stat tile — the native analogue of the web <c>StatCard</c>
/// <c>trend</c> ({ direction, value, positive }). Holds the resolved arrow glyph, the already-localized
/// caption, and the token brush key the web's positive/negative/flat colour rule resolves to (success →
/// green, danger → red, muted → grey). Pure data — no WinUI types.
/// </summary>
public sealed record NotificationStatTrend(string Arrow, string Value, string BrushKey);

/// <summary>
/// One projected, display-ready stat tile consumed by the WinUI view — the native analogue of a web
/// <c>StatGridItem</c> / <c>StatCard</c>. Holds the localized label, the already-formatted value, the
/// optional unit suffix, the resolved Fluent glyph, an optional <see cref="NotificationStatTrend"/> badge,
/// the optional value-colour token brush key (the web <c>valueColor</c>), and a Narrator automation name.
/// Pure data — no WinUI types.
/// </summary>
public sealed record NotificationStatTile(
    string Label,
    string Value,
    string? Unit,
    string Glyph,
    string? ValueBrushKey,
    NotificationStatTrend? Trend,
    string AutomationName);

/// <summary>
/// One projected, display-ready recent-delivery row consumed by the WinUI view — the native analogue of a
/// web <c>DataTable</c> row (the <c>recentLogs</c> map). Holds the channel (title) and type (message) cell
/// text, the resolved status badge tone / glyph / label, the relative-time string, and a Narrator
/// automation name. Pure data — no WinUI types.
/// </summary>
public sealed record NotificationLogRow(
    long Id,
    string Channel,
    string Type,
    StatusKind StatusVariant,
    string StatusGlyph,
    string StatusLabel,
    string RelativeTime,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the notification stats for one footprint — the native
/// analogue of everything the web component computes via <c>useMemo</c> before returning JSX. Holds the
/// four stat tiles and their grid column count, the recent-delivery rows plus the wide-only table gate,
/// and the compact big-number delivery rate with its caption and optional failed line. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record NotificationStatsDisplay(
    bool IsCompact,
    bool IsWide,
    IReadOnlyList<NotificationStatTile> Stats,
    int StatColumns,
    bool ShowLogTable,
    IReadOnlyList<NotificationLogRow> LogRows,
    string CompactValue,
    string CompactLabel,
    string? CompactFailedText,
    string CompactAutomationName);

/// <summary>
/// A merged notification-stats reading — the load-bearing <see cref="NotificationStatsData"/> rollup plus
/// the enriching recent <see cref="NotificationLogEntry"/> rows. The native analogue of the web component's
/// <c>useNotificationStats</c> + <c>useNotificationLogs</c> hook pair: the stats decide loaded/empty/error
/// while the logs only feed the wide recent-delivery table.
/// </summary>
public sealed record NotificationStatsReading(
    NotificationStatsData Stats,
    IReadOnlyList<NotificationLogEntry> Logs);

/// <summary>
/// Pure projection from a merged <see cref="NotificationStatsReading"/> to the display model — the native
/// port of the <c>coreStats</c>, <c>recentLogs</c>, and compact-branch <c>useMemo</c> blocks in
/// web/src/features/dashboard/widgets/NotificationStatsWidget.tsx. <paramref name="now"/> is injected so the
/// relative-time tiers are unit-tested deterministically; every label resolves through the i18n facade.
/// </summary>
public static class NotificationStatsProjection
{
    /// <summary>Segoe Fluent — Ringer (web <c>Bell</c>): the standard header icon and the empty state.</summary>
    public const string BellGlyph = "\uEA8F";

    // web Send (the "Total Sent" tile).
    private const string SendGlyph = "\uE724";

    // web CheckCircle (the "Delivery Rate" tile).
    private const string CheckGlyph = "\uE930";

    // web AlertTriangle (the "Failed" tile).
    private const string WarningGlyph = "\uE7BA";

    // web Radio → NetworkTower (a broadcast/channels marker; Segoe Fluent has no concentric-arc glyph).
    private const string ChannelsGlyph = "\uEC05";

    // web StatCard up arrow ("↑" for a positive trend) and down arrow ("↓" for a negative trend).
    private const string ArrowUp = "\u2191";
    private const string ArrowDown = "\u2193";

    // Token brush keys for the StatCard trend colour rule (positive → green, negative → red).
    private const string SuccessBrushKey = "TsColorSuccessBrush";
    private const string DangerBrushKey = "TsColorDangerBrush";

    private const string Separator = ", ";

    /// <summary>The delivery rate at or above which the web marks the rate tile "Healthy".</summary>
    private const double HealthyRateThreshold = 95.0;

    /// <summary>Project <paramref name="reading"/> for <paramref name="size"/> at <paramref name="now"/> using the i18n facade.</summary>
    public static NotificationStatsDisplay Project(
        NotificationStatsReading reading,
        NotificationStatsSize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        var data = reading.Stats;
        double rate = data.DeliveryRate;

        string totalSentValue = FormatInt(data.TotalSent);
        string rateValue = ScalarFormatters.FormatNumber(rate, 1);
        string failedValue = FormatInt(data.Failed);
        string channelsValue = FormatInt(data.EnabledChannels);

        string totalSentLabel = localizer.GetString("widget.notificationStats.totalSent", "Total Sent (7d)");
        string deliveryRateLabel = localizer.GetString("widget.notificationStats.deliveryRate", "Delivery Rate");
        string failedLabel = localizer.GetString("widget.notificationStats.failed", "Failed");
        string activeChannelsLabel = localizer.GetString("widget.notificationStats.activeChannels", "Active Channels");

        // Total Sent — the trend only renders when there is volume (web trendValue gate).
        NotificationStatTrend? totalSentTrend = data.TotalSent > 0
            ? new NotificationStatTrend(ArrowUp, totalSentValue, SuccessBrushKey)
            : null;

        // Delivery Rate — the "Healthy" trend only renders at or above the threshold (web trendValue gate).
        NotificationStatTrend? rateTrend = rate >= HealthyRateThreshold
            ? new NotificationStatTrend(ArrowUp, localizer.GetString("widget.notificationStats.healthy", "Healthy"), SuccessBrushKey)
            : null;

        // Failed — the "Needs attention" down-trend (and red value) only render when failures exist.
        NotificationStatTrend? failedTrend = data.Failed > 0
            ? new NotificationStatTrend(ArrowDown, localizer.GetString("widget.notificationStats.needsAttention", "Needs attention"), DangerBrushKey)
            : null;
        string? failedValueBrush = data.Failed > 0 ? DangerBrushKey : null;

        var stats = new List<NotificationStatTile>(4)
        {
            new(totalSentLabel, totalSentValue, null, SendGlyph, null, totalSentTrend, TileAutomation(totalSentLabel, totalSentValue, null, totalSentTrend)),
            new(deliveryRateLabel, rateValue, "%", CheckGlyph, null, rateTrend, TileAutomation(deliveryRateLabel, rateValue, "%", rateTrend)),
            new(failedLabel, failedValue, null, WarningGlyph, failedValueBrush, failedTrend, TileAutomation(failedLabel, failedValue, null, failedTrend)),
            new(activeChannelsLabel, channelsValue, null, ChannelsGlyph, null, null, TileAutomation(activeChannelsLabel, channelsValue, null, null)),
        };

        var logRows = ProjectLogRows(reading.Logs, size.RecentLogLimit, now);
        bool showLogTable = size.IsWide && logRows.Count > 0;

        string compactValue = string.Create(CultureInfo.CurrentCulture, $"{rateValue}%");
        string compactLabel = deliveryRateLabel;
        string? compactFailed = data.Failed > 0
            ? string.Format(
                CultureInfo.CurrentCulture,
                "{0} {1}",
                failedValue,
                localizer.GetString("widget.notificationStats.failedLabel", "failed"))
            : null;
        string compactAutomation = compactFailed is null
            ? string.Format(CultureInfo.CurrentCulture, "{0} {1}", compactValue, compactLabel)
            : string.Format(CultureInfo.CurrentCulture, "{0} {1}{2}{3}", compactValue, compactLabel, Separator, compactFailed);

        return new NotificationStatsDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            Stats: stats,
            StatColumns: size.StatColumns,
            ShowLogTable: showLogTable,
            LogRows: logRows,
            CompactValue: compactValue,
            CompactLabel: compactLabel,
            CompactFailedText: compactFailed,
            CompactAutomationName: compactAutomation);
    }

    private static List<NotificationLogRow> ProjectLogRows(
        IReadOnlyList<NotificationLogEntry> logs,
        int limit,
        DateTimeOffset now)
    {
        var ordered = logs
            .OrderByDescending(l => l.CreatedAtTime ?? DateTimeOffset.MinValue)
            .Take(limit);

        var rows = new List<NotificationLogRow>(Math.Min(logs.Count, limit));
        foreach (var log in ordered)
        {
            string channel = string.IsNullOrEmpty(log.Title) ? NotificationStatuses.EmDash : log.Title!;
            string type = string.IsNullOrEmpty(log.Message) ? NotificationStatuses.EmDash : log.Message!;
            string statusLabel = NotificationStatuses.Label(log.Status);
            string relative = DateTimeFormatting.Format(log.CreatedAtTime, DateTimeVariant.Relative, now);
            string automation = string.Format(
                CultureInfo.CurrentCulture, "{0}: {1}, {2}, {3}", channel, type, statusLabel, relative);

            rows.Add(new NotificationLogRow(
                Id: log.Id,
                Channel: channel,
                Type: type,
                StatusVariant: NotificationStatuses.Variant(log.Status),
                StatusGlyph: NotificationStatuses.Glyph(log.Status),
                StatusLabel: statusLabel,
                RelativeTime: relative,
                AutomationName: automation));
        }

        return rows;
    }

    private static string TileAutomation(string label, string value, string? unit, NotificationStatTrend? trend)
    {
        string valuePart = string.IsNullOrEmpty(unit)
            ? value
            : string.Format(CultureInfo.CurrentCulture, "{0}{1}", value, unit);
        string baseName = string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, valuePart);
        return trend is null
            ? baseName
            : string.Format(CultureInfo.CurrentCulture, "{0}, {1}", baseName, trend.Value);
    }

    private static string FormatInt(long value) =>
        ScalarFormatters.FormatNumber(value, 0);
}

/// <summary>
/// Combines the load-bearing notification-stats read with the enriching recent-delivery log read into a
/// single <c>RepositoryResult&lt;NotificationStatsReading&gt;</c> — the native analogue of the web
/// component folding <c>useNotificationStats</c> + <c>useNotificationLogs</c> into one render. The stats
/// decide the surface (error → retry, absent body → empty, otherwise loaded/stale/offline with the
/// freshness union); a slow / failed / empty logs read only enriches (or silently omits) the wide table.
/// Kept pure so the parse-and-combine contract is unit-tested without a network or cache.
/// </summary>
public static class NotificationStatsResultMapper
{
    /// <summary>
    /// Combine the settled <paramref name="stats"/> read with the optional <paramref name="logs"/> read
    /// (null models a logs query still loading / not started — it contributes nothing yet and, web parity,
    /// never gates content because the recent table is a wide-only enrichment).
    /// </summary>
    public static RepositoryResult<NotificationStatsReading> Combine(
        RepositoryResult<JsonElement> stats,
        RepositoryResult<JsonElement>? logs)
    {
        ArgumentNullException.ThrowIfNull(stats);

        // Load-bearing: the notification-stats read. A hard failure with nothing cached → the retry surface.
        if (stats.Status == LoadStatus.Error)
        {
            return RepositoryResult<NotificationStatsReading>.Failure(
                stats.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load notification stats"));
        }

        var data = stats.Value is { } statsEl ? NotificationStatsData.FromJson(statsEl) : NotificationStatsData.Empty;

        // Web parity: the outer gate is `stats ? … : <EmptyState>`. An absent / non-object body → empty.
        if (!data.HasData)
        {
            return RepositoryResult<NotificationStatsReading>.Empty(stats.FetchedAt);
        }

        IReadOnlyList<NotificationLogEntry> logList =
            logs?.Value is { } logsEl ? NotificationLogEntry.ParseList(logsEl) : Array.Empty<NotificationLogEntry>();
        var reading = new NotificationStatsReading(data, logList);

        bool offline = stats.Status == LoadStatus.Offline;
        bool stale = stats.IsStale || (logs?.IsStale ?? false);
        DateTimeOffset updatedAt = Latest(stats.FetchedAt, logs?.FetchedAt)
            ?? stats.FetchedAt
            ?? DateTimeOffset.UtcNow;

        if (offline)
        {
            return RepositoryResult<NotificationStatsReading>.OfflineCached(
                reading,
                updatedAt,
                stats.Error ?? new RepositoryError(RepositoryErrorKind.Network, "A live read is unavailable"));
        }

        if (stale)
        {
            return RepositoryResult<NotificationStatsReading>.Cached(reading, updatedAt, stale: true);
        }

        return RepositoryResult<NotificationStatsReading>.Loaded(reading, updatedAt);
    }

    private static DateTimeOffset? Latest(DateTimeOffset? a, DateTimeOffset? b)
    {
        DateTimeOffset? best = a;
        if (b is { } bv && (best is null || bv > best))
        {
            best = bv;
        }

        return best;
    }
}
