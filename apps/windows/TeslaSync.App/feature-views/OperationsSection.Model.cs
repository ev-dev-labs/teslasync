using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state an <see cref="OperationsSectionViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>OperationsSection</c> renders
/// (web/src/features/system/components/status/OperationsSection.tsx). The web component folds three
/// independent queries (<c>useNotificationStats</c>, <c>useNotificationLogs</c>, <c>useAuditLogs</c>) and
/// shows its skeleton while any of them is still loading
/// (<c>statsLoading || logsLoading || auditLoading</c>); each branch here maps onto a visible surface and
/// none is ever hidden. <see cref="Empty"/> is reached only when all three reads resolve with nothing to
/// show (no stats body, no delivery rows and no audit rows) — a friendly empty surface rather than a blank
/// box.
/// </summary>
public enum OperationsSectionState
{
    /// <summary>Initial fetch with no resolved read yet — render the skeleton chrome.</summary>
    Loading,

    /// <summary>At least one read carried content from the network (or a non-stale cache).</summary>
    Loaded,

    /// <summary>Every read resolved with nothing to show — render the friendly empty surface.</summary>
    Empty,

    /// <summary>All reads failed with nothing cached — render the retry affordance.</summary>
    Error,

    /// <summary>Cached content older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached content remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The notification-delivery rollup from <c>GET /notifications/stats</c> (web <c>useNotificationStats</c>,
/// shape <c>NotificationStats</c> in web/src/api/types.ts). Field names mirror the Go API's snake_case JSON
/// tags; parsing reads snake_case first and falls back to camelCase (the <c>camelCaseKeys</c> transform
/// shape) so a contract shift never throws. Every value is a dimensionless count, so no unit conversion
/// applies. <see cref="SuccessRate"/> is derived exactly as the web component does — defaulting to a perfect
/// 100% when nothing has been sent yet (web <c>total_sent &gt; 0 ? (sent / total_sent) * 100 : 100</c>).
/// </summary>
/// <param name="TotalSent">Messages attempted in the rollup window (web <c>total_sent</c>).</param>
/// <param name="Sent">Messages delivered successfully (web <c>sent</c>).</param>
/// <param name="Failed">Messages that failed to deliver (web <c>failed</c>).</param>
/// <param name="Pending">Messages still queued (web <c>pending</c>).</param>
/// <param name="TotalChannels">Configured channels (web <c>total_channels</c>).</param>
/// <param name="EnabledChannels">Enabled channels (web <c>enabled_channels</c>).</param>
public sealed record OperationsNotificationStats(
    long TotalSent,
    long Sent,
    long Failed,
    long Pending,
    long TotalChannels,
    long EnabledChannels)
{
    /// <summary>An all-zero snapshot flagged as carrying no payload — the parse fallback for an absent/non-object body.</summary>
    public static OperationsNotificationStats Empty { get; } = new(0, 0, 0, 0, 0, 0) { HasData = false };

    /// <summary>
    /// True when a stats payload is present (web <c>notifStats</c> truthiness). Gates whether the
    /// "Notification Delivery" sub-section renders at all. The backend always returns a populated object —
    /// an idle inbox renders as zeros — so this is true for every real snapshot and only false for the
    /// <see cref="Empty"/> fallback (an absent body).
    /// </summary>
    public bool HasData { get; init; } = true;

    /// <summary>
    /// The delivery success rate as a percentage. Mirrors the web's
    /// <c>total_sent &gt; 0 ? (sent / total_sent) * 100 : 100</c> — note this defaults to 100 (not 0) when
    /// nothing has been sent, so a fresh install reads as healthy rather than failing.
    /// </summary>
    public double SuccessRate => TotalSent > 0 ? (double)Sent / TotalSent * 100.0 : 100.0;

    /// <summary>Project a <c>GET /notifications/stats</c> JSON object into a tolerant snapshot.</summary>
    /// <param name="element">The decoded stats body.</param>
    public static OperationsNotificationStats FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new OperationsNotificationStats(
            TotalSent: OperationsJson.GetLong(element, "total_sent", "totalSent"),
            Sent: OperationsJson.GetLong(element, "sent", "sent"),
            Failed: OperationsJson.GetLong(element, "failed", "failed"),
            Pending: OperationsJson.GetLong(element, "pending", "pending"),
            TotalChannels: OperationsJson.GetLong(element, "total_channels", "totalChannels"),
            EnabledChannels: OperationsJson.GetLong(element, "enabled_channels", "enabledChannels"));
    }
}

/// <summary>
/// One recent delivery-log row from <c>GET /notifications/logs</c> (web <c>useNotificationLogs</c>, shape
/// <c>NotificationLog</c> in web/src/api/types.ts). Only the fields the web table renders are projected —
/// the delivery <see cref="Status"/> (status glyph + colour), the <see cref="Title"/> and
/// <see cref="Message"/> columns, and the created time. Parsing is null-tolerant so a partial row never
/// throws (mirroring the web's defensive reads); the raw wire timestamp is kept and parsed on demand via
/// <see cref="CreatedAtTime"/>.
/// </summary>
/// <param name="Id">The row id (web <c>keyExtractor</c>).</param>
/// <param name="Title">The notification title (web "Title" column).</param>
/// <param name="Message">The notification body (web "Message" column).</param>
/// <param name="Status">The delivery status wire value (web "Status" column).</param>
/// <param name="CreatedAt">The raw created timestamp (web "Time" column).</param>
public sealed record OperationsNotificationLog(
    long Id,
    string? Title,
    string? Message,
    string? Status,
    string? CreatedAt)
{
    /// <summary>The parsed creation instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => OperationsJson.TryParseTimestamp(CreatedAt);

    /// <summary>Parse a <c>GET /notifications/logs</c> JSON array into a tolerant list of rows.</summary>
    /// <param name="element">The decoded logs body.</param>
    public static IReadOnlyList<OperationsNotificationLog> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<OperationsNotificationLog>();
        }

        var list = new List<OperationsNotificationLog>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single delivery-log JSON object into an <see cref="OperationsNotificationLog"/>.</summary>
    /// <param name="obj">The decoded log row.</param>
    public static OperationsNotificationLog FromJson(JsonElement obj) => new(
        Id: OperationsJson.GetId(obj),
        Title: OperationsJson.GetString(obj, "title"),
        Message: OperationsJson.GetString(obj, "message"),
        Status: OperationsJson.GetString(obj, "status"),
        CreatedAt: OperationsJson.GetString(obj, "created_at") ?? OperationsJson.GetString(obj, "createdAt"));
}

/// <summary>
/// One audit-trail entry from <c>GET /system/audit</c> (web <c>getAuditLogs</c>, shape <c>AuditLog</c> in
/// web/src/api/types.ts). The web interface names the fields <c>{action, resource, details, created_at}</c>
/// whereas the Go <c>systemmodel.AuditLog</c> wire shape serialises the same concepts as
/// <c>{action, entity_type, detail, ts}</c>. Parsing accepts BOTH conventions (the web-interface name wins
/// when present, else the real wire field) so the native surface reproduces the web component's intent
/// against the actual backend without drift: <c>resource ← entity_type</c>, <c>details ← detail</c>,
/// <c>created_at ← ts</c>.
/// </summary>
/// <param name="Id">The entry id (web <c>keyExtractor</c>).</param>
/// <param name="Action">The audited action (web "Action" badge).</param>
/// <param name="Resource">The affected resource (web "Resource" column).</param>
/// <param name="Details">Free-form detail (web "Details" column).</param>
/// <param name="CreatedAt">The raw created timestamp (web "Time" column).</param>
public sealed record OperationsAuditEntry(
    long Id,
    string Action,
    string? Resource,
    string? Details,
    string? CreatedAt)
{
    /// <summary>The parsed creation instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => OperationsJson.TryParseTimestamp(CreatedAt);

    /// <summary>Parse a <c>GET /system/audit</c> JSON array into a tolerant list of entries.</summary>
    /// <param name="element">The decoded audit body.</param>
    public static IReadOnlyList<OperationsAuditEntry> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<OperationsAuditEntry>();
        }

        var list = new List<OperationsAuditEntry>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single audit JSON object into an <see cref="OperationsAuditEntry"/>.</summary>
    /// <param name="obj">The decoded audit row.</param>
    public static OperationsAuditEntry FromJson(JsonElement obj) => new(
        Id: OperationsJson.GetId(obj),
        Action: OperationsJson.GetString(obj, "action") ?? string.Empty,
        Resource: OperationsJson.GetString(obj, "resource") ?? OperationsJson.GetString(obj, "entity_type"),
        Details: OperationsJson.GetString(obj, "details") ?? OperationsJson.GetString(obj, "detail"),
        CreatedAt: OperationsJson.GetString(obj, "created_at")
            ?? OperationsJson.GetString(obj, "createdAt")
            ?? OperationsJson.GetString(obj, "ts"));
}

/// <summary>
/// Status → presentation mapping for a delivery-log row — the native port of the web
/// <c>statusTextClass</c> / <c>getStatusIcon</c> helpers
/// (web/src/features/system/components/status/helpers.tsx). The wire status is lower-cased and matched
/// against the same word sets the web switches over; each tier resolves a <see cref="StatusKind"/> tone
/// (which drives both the glyph and the text colour) and a Segoe Fluent glyph approximating the web Lucide
/// icon. An unknown / <see langword="null"/> status falls back to the neutral tone with the warning glyph,
/// exactly as the web default arm does (muted text + <c>AlertTriangle</c>).
/// </summary>
public static class OperationsStatuses
{
    /// <summary>Segoe Fluent — Completed (web <c>CheckCircle</c>): a healthy / delivered status.</summary>
    public const string SuccessGlyph = "\uE930";

    /// <summary>Segoe Fluent — Important/AlertTriangle (web <c>AlertTriangle</c>): a warning / unknown status.</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>Segoe Fluent — ErrorBadge (web <c>XCircle</c>): a failed / down status.</summary>
    public const string DangerGlyph = "\uEA39";

    /// <summary>Em-dash fallback for a missing status / title / message (web <c>?? '—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Resolve the tone + glyph for a wire status, reproducing the web helper word sets.</summary>
    /// <param name="status">The raw wire status (any case), or null.</param>
    public static (StatusKind Kind, string Glyph) Classify(string? status)
    {
        switch ((status ?? string.Empty).ToLowerInvariant())
        {
            case "healthy":
            case "ok":
            case "online":
            case "connected":
            case "ready":
            case "sent":
            case "completed":
                return (StatusKind.Success, SuccessGlyph);

            case "degraded":
            case "warning":
            case "pending":
            case "queued":
            case "processing":
                return (StatusKind.Warning, WarningGlyph);

            case "unhealthy":
            case "offline":
            case "error":
            case "down":
            case "failed":
                return (StatusKind.Danger, DangerGlyph);

            default:
                return (StatusKind.Neutral, WarningGlyph);
        }
    }

    /// <summary>The displayed status label, or the em-dash when absent (web <c>{row.status ?? '—'}</c>).</summary>
    /// <param name="status">The raw wire status, or null.</param>
    public static string Label(string? status) => string.IsNullOrEmpty(status) ? EmDash : status;
}

/// <summary>
/// A merged Operations reading — the notification-delivery rollup plus the recent delivery log plus the
/// audit trail. The native analogue of the web component's three-hook composition
/// (<c>useNotificationStats</c> + <c>useNotificationLogs</c> + <c>useAuditLogs</c>): the stats gate the
/// "Notification Delivery" sub-section, the logs feed its table, and the audit entries feed the always-shown
/// "Audit Log" sub-section.
/// </summary>
/// <param name="Stats">The notification-delivery rollup.</param>
/// <param name="Logs">The recent delivery-log rows.</param>
/// <param name="Audit">The audit-trail entries.</param>
public sealed record OperationsReading(
    OperationsNotificationStats Stats,
    IReadOnlyList<OperationsNotificationLog> Logs,
    IReadOnlyList<OperationsAuditEntry> Audit)
{
    /// <summary>An empty reading (no stats body, no logs, no audit) — the projection's neutral seed.</summary>
    public static OperationsReading Empty { get; } = new(
        OperationsNotificationStats.Empty,
        Array.Empty<OperationsNotificationLog>(),
        Array.Empty<OperationsAuditEntry>());
}

/// <summary>
/// One projected, display-ready metric tile — the native analogue of a web <c>MetricCard</c> (label + icon
/// + colour + value). Holds the localized label, the already-formatted value, the Segoe Fluent glyph, the
/// token brush key for the accent colour, and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted value.</param>
/// <param name="Glyph">The Segoe Fluent accent glyph.</param>
/// <param name="AccentBrushKey">The token brush key for the icon accent.</param>
/// <param name="AutomationName">The composed Narrator name.</param>
public sealed record OperationsMetricTile(
    string Label,
    string Value,
    string Glyph,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// One projected, display-ready recent-delivery row — the native analogue of a web notification-log
/// <c>DataTable</c> row. Holds the status tone / glyph / label, the channel title and message cell text,
/// the formatted absolute time, and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Id">The row id.</param>
/// <param name="StatusKind">The status tone (drives glyph + text colour).</param>
/// <param name="StatusGlyph">The Segoe Fluent status glyph.</param>
/// <param name="StatusText">The raw status label (em-dash when absent).</param>
/// <param name="Title">The title cell text (em-dash when absent).</param>
/// <param name="Message">The message cell text (em-dash when absent).</param>
/// <param name="Time">The formatted absolute created time.</param>
/// <param name="AutomationName">The composed Narrator name.</param>
public sealed record OperationsNotificationRow(
    long Id,
    StatusKind StatusKind,
    string StatusGlyph,
    string StatusText,
    string Title,
    string Message,
    string Time,
    string AutomationName);

/// <summary>
/// One projected, display-ready audit row — the native analogue of a web audit <c>DataTable</c> row. Holds
/// the formatted absolute time, the action (rendered as a badge), the resource (rendered monospace), the
/// detail text, and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Id">The entry id.</param>
/// <param name="Time">The formatted absolute created time.</param>
/// <param name="Action">The action badge text (em-dash when absent).</param>
/// <param name="Resource">The resource cell text (em-dash when absent).</param>
/// <param name="Details">The detail cell text (em-dash when absent).</param>
/// <param name="AutomationName">The composed Narrator name.</param>
public sealed record OperationsAuditRow(
    long Id,
    string Time,
    string Action,
    string Resource,
    string Details,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of one <see cref="OperationsReading"/> — the native analogue of
/// everything the web component computes before returning JSX. Holds the "Notification Delivery" gate and
/// its four metric tiles, the success-rate value/label and the header badge (tone + text), the recent
/// delivery rows, and the audit rows. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasNotificationStats">Whether the "Notification Delivery" sub-section renders (web <c>notifStats &amp;&amp;</c>).</param>
/// <param name="MetricTiles">The four delivery metric tiles (Total Sent / Failed / Success Rate / Channels).</param>
/// <param name="SuccessRate">The raw success-rate percentage (0..100) feeding the gauge.</param>
/// <param name="SuccessRateText">The formatted success-rate value (e.g. "99.5%").</param>
/// <param name="GaugeLabel">The localized gauge caption (web <c>label="Success"</c>).</param>
/// <param name="HasBadge">Whether the header success-rate badge renders.</param>
/// <param name="BadgeStatus">The header badge tone (success / warning / danger by threshold).</param>
/// <param name="BadgeText">The header badge text (e.g. "99.5% success rate").</param>
/// <param name="NotificationRows">The recent delivery rows (most-recent first).</param>
/// <param name="HasNotificationLogs">Whether the recent-delivery table renders (else its empty surface).</param>
/// <param name="AuditRows">The audit-trail rows (most-recent first).</param>
/// <param name="HasAudit">Whether the audit table renders (else its empty surface).</param>
/// <param name="HasAnyContent">Whether anything at all is renderable (gates the section-level empty state).</param>
public sealed record OperationsSectionDisplay(
    bool HasNotificationStats,
    IReadOnlyList<OperationsMetricTile> MetricTiles,
    double SuccessRate,
    string SuccessRateText,
    string GaugeLabel,
    bool HasBadge,
    StatusKind BadgeStatus,
    string BadgeText,
    IReadOnlyList<OperationsNotificationRow> NotificationRows,
    bool HasNotificationLogs,
    IReadOnlyList<OperationsAuditRow> AuditRows,
    bool HasAudit,
    bool HasAnyContent)
{
    /// <summary>The neutral seed display (no stats, no rows) used before the first projection.</summary>
    public static OperationsSectionDisplay Empty { get; } = new(
        HasNotificationStats: false,
        MetricTiles: Array.Empty<OperationsMetricTile>(),
        SuccessRate: 0,
        SuccessRateText: string.Empty,
        GaugeLabel: string.Empty,
        HasBadge: false,
        BadgeStatus: StatusKind.Neutral,
        BadgeText: string.Empty,
        NotificationRows: Array.Empty<OperationsNotificationRow>(),
        HasNotificationLogs: false,
        AuditRows: Array.Empty<OperationsAuditRow>(),
        HasAudit: false,
        HasAnyContent: false);
}

/// <summary>
/// Pure projection from a merged <see cref="OperationsReading"/> to its <see cref="OperationsSectionDisplay"/>
/// — the native port of the render body of
/// web/src/features/system/components/status/OperationsSection.tsx. <paramref name="now"/> is injected so
/// any relative tiers are deterministic; every label resolves through the i18n facade. The success-rate
/// threshold (web <c>&gt;= 95 ? 'success' : &gt;= 80 ? 'warning' : 'danger'</c>) drives the header badge
/// tone. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class OperationsSectionProjection
{
    /// <summary>Segoe Fluent — Ringer (web <c>Bell</c>): the section header glyph and the empty state.</summary>
    public const string BellGlyph = "\uEA8F";

    /// <summary>Segoe Fluent — Send (web <c>Send</c>): the "Total Sent" tile.</summary>
    public const string SendGlyph = "\uE724";

    /// <summary>Segoe Fluent — Speed (web <c>Activity</c>): the empty recent-delivery surface.</summary>
    public const string ActivityGlyph = "\uE9D9";

    /// <summary>The delivery rate at or above which the badge reads "success" (web <c>&gt;= 95</c>).</summary>
    public const double HealthyThreshold = 95.0;

    /// <summary>The delivery rate at or above which the badge reads "warning" (web <c>&gt;= 80</c>).</summary>
    public const double WarningThreshold = 80.0;

    private const string AccentBrushKey = "TsColorAccentBrush";
    private const string SuccessBrushKey = "TsColorSuccessBrush";
    private const string DangerBrushKey = "TsColorDangerBrush";
    private const string InfoBrushKey = "TsColorInfoBrush";

    /// <summary>Project <paramref name="reading"/> at <paramref name="now"/> using the i18n facade.</summary>
    /// <param name="reading">The merged stats + logs + audit reading.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The clock anchor for absolute/relative time formatting.</param>
    public static OperationsSectionDisplay Project(OperationsReading reading, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        OperationsNotificationStats stats = reading.Stats;
        bool hasStats = stats.HasData;
        double rate = stats.SuccessRate;
        string rateText = ScalarFormatters.FormatPercentage(rate, 1);

        OperationsMetricTile[] tiles = hasStats
            ? BuildTiles(stats, rate, rateText, localizer)
            : Array.Empty<OperationsMetricTile>();

        StatusKind badgeStatus = RateStatus(rate);
        string badgeText = string.Format(
            CultureInfo.CurrentCulture,
            "{0} {1}",
            rateText,
            localizer.GetString("featureView.operations.successRate", "success rate"));

        IReadOnlyList<OperationsNotificationRow> notifRows = BuildNotificationRows(reading.Logs, localizer, now);
        IReadOnlyList<OperationsAuditRow> auditRows = BuildAuditRows(reading.Audit, localizer, now);

        bool hasContent = hasStats || notifRows.Count > 0 || auditRows.Count > 0;

        return new OperationsSectionDisplay(
            HasNotificationStats: hasStats,
            MetricTiles: tiles,
            SuccessRate: rate,
            SuccessRateText: rateText,
            GaugeLabel: localizer.GetString("featureView.operations.gauge.success", "Success"),
            HasBadge: hasStats,
            BadgeStatus: badgeStatus,
            BadgeText: badgeText,
            NotificationRows: notifRows,
            HasNotificationLogs: notifRows.Count > 0,
            AuditRows: auditRows,
            HasAudit: auditRows.Count > 0,
            HasAnyContent: hasContent);
    }

    /// <summary>The header badge tone for a delivery rate (web threshold ladder).</summary>
    /// <param name="rate">The success rate (0..100).</param>
    public static StatusKind RateStatus(double rate)
    {
        if (rate >= HealthyThreshold)
        {
            return StatusKind.Success;
        }

        return rate >= WarningThreshold ? StatusKind.Warning : StatusKind.Danger;
    }

    private static OperationsMetricTile[] BuildTiles(
        OperationsNotificationStats stats,
        double rate,
        string rateText,
        ILocalizer localizer)
    {
        string totalSentLabel = localizer.GetString("featureView.operations.totalSent", "Total Sent");
        string failedLabel = localizer.GetString("featureView.operations.failed", "Failed");
        string successRateLabel = localizer.GetString("featureView.operations.successRateTitle", "Success Rate");
        string channelsLabel = localizer.GetString("featureView.operations.channels", "Channels");

        string totalSentValue = FormatInt(stats.TotalSent);
        string failedValue = FormatInt(stats.Failed);
        string channelsValue = string.Format(
            CultureInfo.CurrentCulture, "{0}/{1}", stats.EnabledChannels, stats.TotalChannels);

        return new[]
        {
            new OperationsMetricTile(
                totalSentLabel, totalSentValue, SendGlyph, InfoBrushKey, Tile(totalSentLabel, totalSentValue)),
            new OperationsMetricTile(
                failedLabel, failedValue, OperationsStatuses.DangerGlyph, DangerBrushKey, Tile(failedLabel, failedValue)),
            new OperationsMetricTile(
                successRateLabel, rateText, OperationsStatuses.SuccessGlyph, SuccessBrushKey, Tile(successRateLabel, rateText)),
            new OperationsMetricTile(
                channelsLabel, channelsValue, BellGlyph, AccentBrushKey, Tile(channelsLabel, channelsValue)),
        };
    }

    private static IReadOnlyList<OperationsNotificationRow> BuildNotificationRows(
        IReadOnlyList<OperationsNotificationLog> logs,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        if (logs.Count == 0)
        {
            return Array.Empty<OperationsNotificationRow>();
        }

        var ordered = logs
            .OrderByDescending(l => l.CreatedAtTime ?? DateTimeOffset.MinValue)
            .ToList();

        var rows = new List<OperationsNotificationRow>(ordered.Count);
        string statusLabelKey = localizer.GetString("featureView.operations.col.status", "Status");
        foreach (var log in ordered)
        {
            (StatusKind kind, string glyph) = OperationsStatuses.Classify(log.Status);
            string statusText = OperationsStatuses.Label(log.Status);
            string title = Fallback(log.Title);
            string message = Fallback(log.Message);
            string time = DateTimeFormatting.Format(log.CreatedAtTime, DateTimeVariant.Full, now);
            string automation = string.Format(
                CultureInfo.CurrentCulture,
                "{0}: {1}, {2}, {3}",
                statusLabelKey,
                statusText,
                title,
                time);

            rows.Add(new OperationsNotificationRow(
                Id: log.Id,
                StatusKind: kind,
                StatusGlyph: glyph,
                StatusText: statusText,
                Title: title,
                Message: message,
                Time: time,
                AutomationName: automation));
        }

        return rows;
    }

    private static IReadOnlyList<OperationsAuditRow> BuildAuditRows(
        IReadOnlyList<OperationsAuditEntry> audit,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        if (audit.Count == 0)
        {
            return Array.Empty<OperationsAuditRow>();
        }

        var ordered = audit
            .OrderByDescending(a => a.CreatedAtTime ?? DateTimeOffset.MinValue)
            .ToList();

        var rows = new List<OperationsAuditRow>(ordered.Count);
        string actionLabel = localizer.GetString("featureView.operations.col.action", "Action");
        foreach (var entry in ordered)
        {
            string time = DateTimeFormatting.Format(entry.CreatedAtTime, DateTimeVariant.Full, now);
            string action = Fallback(string.IsNullOrEmpty(entry.Action) ? null : entry.Action);
            string resource = Fallback(entry.Resource);
            string details = Fallback(entry.Details);
            string automation = string.Format(
                CultureInfo.CurrentCulture,
                "{0}: {1} {2} {3}",
                time,
                action,
                resource,
                details);

            rows.Add(new OperationsAuditRow(
                Id: entry.Id,
                Time: time,
                Action: action,
                Resource: resource,
                Details: details,
                AutomationName: automation));
        }

        return rows;
    }

    private static string Tile(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);

    private static string Fallback(string? value) =>
        string.IsNullOrEmpty(value) ? OperationsStatuses.EmDash : value;

    private static string FormatInt(long value) => ScalarFormatters.FormatNumber(value, 0);
}

/// <summary>
/// Combines the three settled cache-then-network reads — the notification-delivery rollup, the recent
/// delivery log, and the audit trail — into typed snapshots and a single merged
/// <see cref="RepositoryResult{T}"/>. Each <c>Map*</c> method parses one raw JSON emission; <see cref="Fold"/>
/// folds the three typed results into the section-level freshness exactly as the web's combined
/// <c>statsLoading || logsLoading || auditLoading</c> gate plus per-query error/stale handling would. Kept
/// pure so the parse-and-combine contract is unit-tested without a network or cache.
/// </summary>
public static class OperationsSectionResultMapper
{
    /// <summary>Parse a raw <c>GET /notifications/stats</c> emission into a typed snapshot result.</summary>
    /// <param name="raw">The raw JSON emission from the cache-then-network engine.</param>
    public static RepositoryResult<OperationsNotificationStats> MapStats(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return Map(raw, OperationsNotificationStats.FromJson, static s => !s.HasData);
    }

    /// <summary>Parse a raw <c>GET /notifications/logs</c> emission into a typed list result.</summary>
    /// <param name="raw">The raw JSON emission from the cache-then-network engine.</param>
    public static RepositoryResult<IReadOnlyList<OperationsNotificationLog>> MapLogs(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return Map(raw, OperationsNotificationLog.ParseList, static list => list.Count == 0);
    }

    /// <summary>Parse a raw <c>GET /system/audit</c> emission into a typed list result.</summary>
    /// <param name="raw">The raw JSON emission from the cache-then-network engine.</param>
    public static RepositoryResult<IReadOnlyList<OperationsAuditEntry>> MapAudit(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return Map(raw, OperationsAuditEntry.ParseList, static list => list.Count == 0);
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
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load operations data"));

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
/// PII-safe diagnostics for the <c>OperationsSection</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never delivery titles, messages, audit
/// details or any fleet data — so a diagnostics line can never leak. Thread-safe.
/// </summary>
public sealed class OperationsSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public OperationsSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=OperationsSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={OperationsSectionRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>OperationsSection</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/system/components/status/OperationsSection.tsx</c>. Holds the diagnostics
/// slug emitted with the <c>view.opened</c> event, the surface id, and the localized section title and
/// description. UI-free so the metadata is asserted in tests.
/// </summary>
public static class OperationsSectionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "OperationsSection";

    /// <summary>Stable surface id (kebab-case).</summary>
    public const string Id = "operations-section";

    /// <summary>The section title (web <c>t('Operations')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("featureView.operations.title", "Operations");
    }

    /// <summary>The section description (web accordion description).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "featureView.operations.description", "Notification delivery and audit trail");
    }
}

/// <summary>
/// Tolerant JSON readers shared by the Operations snapshots. Every getter is null- and kind-tolerant so a
/// partial or contract-shifted wire row never throws — the native analogue of the web component's defensive
/// optional reads.
/// </summary>
internal static class OperationsJson
{
    /// <summary>Read a string property, or null when absent / not a string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Read a numeric id (number or numeric string), defaulting to 0.</summary>
    public static long GetId(JsonElement obj)
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

    /// <summary>Read a long from the snake_case key, falling back to the camelCase key, then to 0.</summary>
    public static long GetLong(JsonElement obj, string snake, string camel) =>
        ReadLong(obj, snake) ?? ReadLong(obj, camel) ?? 0;

    /// <summary>Parse an ISO-8601 timestamp, or null when absent / unparseable.</summary>
    public static DateTimeOffset? TryParseTimestamp(string? raw)
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
