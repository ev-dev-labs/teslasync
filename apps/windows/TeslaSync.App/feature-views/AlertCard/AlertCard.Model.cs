using System.Globalization;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The render-time data model the <c>AlertCard</c> surface binds to — the native analogue of the web
/// component's props (<c>alert: Alert</c> in web/src/features/notifications/components/AlertCard.tsx),
/// narrowed to the fields the card actually reads, plus the precomputed drill-through href the web derives
/// inline via <c>getAlertDrillthroughHref(alert)</c>. The web card is a pure presentational component — it
/// owns presentation only and the hosting page wires the mark-read / acknowledge / reopen / open-detail
/// actions through callbacks — so this model is just the alert it renders; it performs no fetching. Pure
/// data, no WinUI types, so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Type">The free-form alert type (web <c>alert.type</c>); selects the leading type glyph and the type chip label.</param>
/// <param name="Severity">The raw wire severity (web <c>alert.severity</c>); drives the severity accent, the severity chip and the unread dot.</param>
/// <param name="Title">The alert title (web <c>alert.title</c>).</param>
/// <param name="Message">The alert message (web <c>alert.message</c>).</param>
/// <param name="IsRead">Whether the alert has been read (web <c>alert.is_read</c>); the unread branch adds the accent border, the status dot, the bolder title and the mark-read action.</param>
/// <param name="CreatedAt">When the alert was raised (web <c>alert.created_at</c>); drives the relative "time ago" label.</param>
/// <param name="AcknowledgedAt">When the alert was acknowledged, or <see langword="null"/> when it is not (web <c>Boolean(alert.acknowledged_at)</c>); selects the acknowledged badge and the reopen-vs-acknowledge action.</param>
/// <param name="AcknowledgedBy">Who acknowledged the alert (web <c>alert.acknowledged_by</c>); selects the named-vs-anonymous acknowledged badge copy.</param>
/// <param name="DrillHref">The drill-through target the "View context" affordances navigate to (web <c>getAlertDrillthroughHref(alert)</c>).</param>
public sealed record AlertCardModel(
    string Type,
    string Severity,
    string Title,
    string Message,
    bool IsRead,
    DateTimeOffset CreatedAt,
    DateTimeOffset? AcknowledgedAt,
    string? AcknowledgedBy,
    string DrillHref);

/// <summary>
/// The fully projected, render-ready view of one alert card — the native analogue of what the web
/// <c>AlertCard</c> renders (web/src/features/notifications/components/AlertCard.tsx). Every conditional the
/// web component branches on is resolved here: the read/unread split (<see cref="IsUnread"/>), the
/// acknowledged split (<see cref="IsAcknowledged"/>, <see cref="AckBadgeText"/>), the
/// acknowledge-vs-reopen action (<see cref="PrimaryActionIsReopen"/>, <see cref="PrimaryActionLabel"/>) and
/// the mark-read affordance (<see cref="ShowMarkRead"/>). Labels are resolved through the i18n facade; the
/// type glyph, severity accent and relative-time copy are precomputed so the view does no formatting. Pure
/// data so every branch is asserted headlessly.
/// </summary>
/// <param name="Title">The alert title.</param>
/// <param name="Message">The alert message.</param>
/// <param name="IsRead">Whether the alert is read (the title uses the primary colour when unread, secondary when read).</param>
/// <param name="IsUnread">Convenience inverse of <see cref="IsRead"/> — the unread branch.</param>
/// <param name="IsAcknowledged">Whether the alert is acknowledged (web <c>Boolean(alert.acknowledged_at)</c>).</param>
/// <param name="TypeGlyph">The Segoe Fluent glyph for the alert type (web <c>TYPE_ICONS</c> map, bell fallback).</param>
/// <param name="SeverityAccentBrushKey">The design-token brush key for the severity accent (web <c>severityTokens[sev]</c>).</param>
/// <param name="Severity">The raw severity string, forwarded to the severity chip and status dot.</param>
/// <param name="TypeLabel">The humanised type label (web <c>(alert.type ?? 'notification').replace(/_/g, ' ')</c>).</param>
/// <param name="TimeAgoText">The relative-time label (web <c>getTimeAgo(alert.created_at)</c>).</param>
/// <param name="AckBadgeText">The acknowledged badge copy, or <see langword="null"/> when the alert is not acknowledged.</param>
/// <param name="ViewContextLabel">The "View context" affordance label (web <c>t('alerts.viewContext')</c>).</param>
/// <param name="AuditTimelineLabel">The "Audit timeline" action label (web <c>t('alerts.timeline.title')</c>).</param>
/// <param name="PrimaryActionLabel">The acknowledge / reopen action label (web ternary).</param>
/// <param name="PrimaryActionIsReopen">Whether the primary action is "Reopened" (acknowledged) rather than "Acknowledge".</param>
/// <param name="MarkReadLabel">The "Mark read" action label (web <c>t('Mark read')</c>).</param>
/// <param name="ShowMarkRead">Whether the mark-read action is shown (web <c>!alert.is_read</c>).</param>
/// <param name="UnreadLabel">The accessible label for the unread status dot (web <c>t('Unread')</c>).</param>
/// <param name="DrillHref">The drill-through target the "View context" affordances navigate to.</param>
/// <param name="AutomationName">The composed Narrator name for the whole card.</param>
public sealed record AlertCardDisplay(
    string Title,
    string Message,
    bool IsRead,
    bool IsUnread,
    bool IsAcknowledged,
    string TypeGlyph,
    string SeverityAccentBrushKey,
    string Severity,
    string TypeLabel,
    string TimeAgoText,
    string? AckBadgeText,
    string ViewContextLabel,
    string AuditTimelineLabel,
    string PrimaryActionLabel,
    bool PrimaryActionIsReopen,
    string MarkReadLabel,
    bool ShowMarkRead,
    string UnreadLabel,
    string DrillHref,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="AlertCardModel"/> to its <see cref="AlertCardDisplay"/> — the native
/// port of web/src/features/notifications/components/AlertCard.tsx. The web card is purely presentational
/// (it never fetches), so the projection is a direct function of the input alert plus the injected
/// <c>now</c> the relative-time label is measured against. Type is humanised exactly as the web does, the
/// relative-time copy mirrors the web's bespoke <c>getTimeAgo</c> tiers, the acknowledged badge follows the
/// named-vs-anonymous web ternary, and the acknowledge-vs-reopen action follows the web's
/// <c>isAcked</c> branch. Every label resolves through the i18n facade using the catalog keys the web source
/// feeds into <c>t()</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class AlertCardProjection
{
    /// <summary>i18n key for the "View context" affordance (web <c>t('alerts.viewContext', 'View context')</c>).</summary>
    public const string ViewContextKey = "translation.alerts.viewContext";

    /// <summary>i18n key for the named acknowledged badge (web <c>t('alerts.ack.ackedBy', …, { actor })</c>).</summary>
    public const string AckedByKey = "translation.alerts.ack.ackedBy";

    /// <summary>i18n key for the anonymous acknowledged badge (web <c>t('alerts.ack.ackedByAnonymous', 'Acknowledged')</c>).</summary>
    public const string AckedByAnonymousKey = "translation.alerts.ack.ackedByAnonymous";

    /// <summary>i18n key for the "Audit timeline" action (web <c>t('alerts.timeline.title', 'Audit timeline')</c>).</summary>
    public const string AuditTimelineKey = "translation.alerts.timeline.title";

    /// <summary>i18n key for the "Reopened" action (web <c>t('alerts.timeline.kindAnonymous.reopened', 'Reopened')</c>).</summary>
    public const string ReopenedKey = "translation.alerts.timeline.kindAnonymous.reopened";

    /// <summary>i18n key for the "Acknowledge" action (web <c>t('alerts.ack.button', 'Acknowledge')</c>).</summary>
    public const string AcknowledgeKey = "translation.alerts.ack.button";

    /// <summary>i18n key for the unread status-dot label (web <c>t('Unread')</c>).</summary>
    public const string UnreadKey = "translation.Unread";

    /// <summary>i18n key for the "Mark read" action (web <c>t('Mark read')</c>).</summary>
    public const string MarkReadKey = "translation.Mark read";

    /// <summary>English fallback for <see cref="ViewContextKey"/> (matches the web default).</summary>
    public const string ViewContextFallback = "View context";

    /// <summary>English fallback for <see cref="AckedByKey"/>. Uses a positional <c>{0}</c> token (the resw catalog form) in place of the web i18next <c>{{actor}}</c>.</summary>
    public const string AckedByFallback = "Acknowledged by {0}";

    /// <summary>English fallback for <see cref="AckedByAnonymousKey"/> (matches the web default).</summary>
    public const string AckedByAnonymousFallback = "Acknowledged";

    /// <summary>English fallback for <see cref="AuditTimelineKey"/> (matches the web default).</summary>
    public const string AuditTimelineFallback = "Audit timeline";

    /// <summary>English fallback for <see cref="ReopenedKey"/> (matches the web default).</summary>
    public const string ReopenedFallback = "Reopened";

    /// <summary>English fallback for <see cref="AcknowledgeKey"/> (matches the web default).</summary>
    public const string AcknowledgeFallback = "Acknowledge";

    /// <summary>English fallback for <see cref="UnreadKey"/> (matches the web default).</summary>
    public const string UnreadFallback = "Unread";

    /// <summary>English fallback for <see cref="MarkReadKey"/> (matches the web default).</summary>
    public const string MarkReadFallback = "Mark read";

    /// <summary>The default type the web falls back to when <c>alert.type</c> is empty (web <c>'notification'</c>).</summary>
    public const string DefaultType = "notification";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time alert (the web <c>alert</c> prop, narrowed).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The instant the relative-time label is measured against (the web <c>Date.now()</c> seam).</param>
    public static AlertCardDisplay Project(AlertCardModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        bool isAcked = model.AcknowledgedAt is not null;
        bool isUnread = !model.IsRead;

        string typeLabel = TypeLabel(model.Type);
        string timeAgo = FormatTimeAgo(model.CreatedAt, now);
        string unread = localizer.GetString(UnreadKey, UnreadFallback);

        // Web parity: the acknowledged badge renders only when the alert is acknowledged, with the named copy
        // when an actor is present and the anonymous copy otherwise.
        string? ackBadge = null;
        if (isAcked)
        {
            ackBadge = string.IsNullOrEmpty(model.AcknowledgedBy)
                ? localizer.GetString(AckedByAnonymousKey, AckedByAnonymousFallback)
                : string.Format(
                    CultureInfo.CurrentCulture,
                    localizer.GetString(AckedByKey, AckedByFallback),
                    model.AcknowledgedBy);
        }

        string primaryActionLabel = isAcked
            ? localizer.GetString(ReopenedKey, ReopenedFallback)
            : localizer.GetString(AcknowledgeKey, AcknowledgeFallback);

        return new AlertCardDisplay(
            Title: model.Title,
            Message: model.Message,
            IsRead: model.IsRead,
            IsUnread: isUnread,
            IsAcknowledged: isAcked,
            TypeGlyph: AlertCardRegistration.TypeGlyph(model.Type),
            SeverityAccentBrushKey: SeverityLevels.TokensFor(model.Severity).AccentBrushKey,
            Severity: model.Severity,
            TypeLabel: typeLabel,
            TimeAgoText: timeAgo,
            AckBadgeText: ackBadge,
            ViewContextLabel: localizer.GetString(ViewContextKey, ViewContextFallback),
            AuditTimelineLabel: localizer.GetString(AuditTimelineKey, AuditTimelineFallback),
            PrimaryActionLabel: primaryActionLabel,
            PrimaryActionIsReopen: isAcked,
            MarkReadLabel: localizer.GetString(MarkReadKey, MarkReadFallback),
            ShowMarkRead: isUnread,
            UnreadLabel: unread,
            DrillHref: model.DrillHref,
            AutomationName: BuildAutomationName(model, typeLabel, timeAgo, isUnread, ackBadge, unread));
    }

    /// <summary>Humanise an alert type the way the web does: <c>(type ?? 'notification').replace(/_/g, ' ')</c>.</summary>
    /// <param name="type">The raw alert type (null / empty coerces to the default type).</param>
    public static string TypeLabel(string? type)
    {
        string value = string.IsNullOrEmpty(type) ? DefaultType : type;
        return value.Replace('_', ' ');
    }

    /// <summary>
    /// The relative-time label — a 1:1 port of the web card's bespoke <c>getTimeAgo</c>: under an hour it is
    /// "<c>{m}m ago</c>", under a day "<c>{h}h ago</c>", otherwise "<c>{d}d ago</c>". The integer tiers use
    /// JavaScript <c>Math.floor</c> semantics and the compact, locale-independent unit suffixes the web
    /// renders verbatim (the source does not localize them).
    /// </summary>
    /// <param name="created">When the alert was raised.</param>
    /// <param name="now">The instant to measure against (the web <c>Date.now()</c>).</param>
    public static string FormatTimeAgo(DateTimeOffset created, DateTimeOffset now)
    {
        double diffMs = (now - created).TotalMilliseconds;
        long mins = (long)Math.Floor(diffMs / 60000.0);
        if (mins < 60)
        {
            return mins.ToString(CultureInfo.InvariantCulture) + "m ago";
        }

        long hours = (long)Math.Floor(mins / 60.0);
        if (hours < 24)
        {
            return hours.ToString(CultureInfo.InvariantCulture) + "h ago";
        }

        long days = (long)Math.Floor(hours / 24.0);
        return days.ToString(CultureInfo.InvariantCulture) + "d ago";
    }

    private static string BuildAutomationName(
        AlertCardModel model,
        string typeLabel,
        string timeAgo,
        bool isUnread,
        string? ackBadge,
        string unread)
    {
        var parts = new List<string>(5);

        if (isUnread)
        {
            parts.Add(unread);
        }

        if (!string.IsNullOrEmpty(model.Title))
        {
            parts.Add(model.Title);
        }

        if (!string.IsNullOrEmpty(model.Message))
        {
            parts.Add(model.Message);
        }

        parts.Add(string.Format(CultureInfo.CurrentCulture, "{0}, {1}, {2}", model.Severity, typeLabel, timeAgo));

        if (ackBadge is not null)
        {
            parts.Add(ackBadge);
        }

        return string.Join(". ", parts);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>AlertCard</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an alert title, message, severity or
/// actor — so a diagnostics line can never leak what a user saw. Thread-safe.
/// </summary>
public sealed class AlertCardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AlertCardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AlertCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AlertCardRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>AlertCard</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/notifications/components/AlertCard.tsx</c>, plus the Segoe Fluent Icons glyphs that
/// stand in for the web Lucide icons (the <c>TYPE_ICONS</c> map and the inline clock / chevron / bell /
/// refresh / check / eye affordances). UI-free so the metadata is asserted in tests.
/// </summary>
public static class AlertCardRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AlertCard";

    /// <summary>Segoe Fluent "Recent" glyph — the relative-time clock (web Lucide <c>Clock</c>).</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Segoe Fluent "ChevronRight" glyph — the "View context" affordance (web Lucide <c>ChevronRight</c>).</summary>
    public const string NextGlyph = "\uE76C";

    /// <summary>Segoe Fluent "Ringer" glyph — the "Audit timeline" action (web Lucide <c>Bell</c>).</summary>
    public const string AuditTimelineGlyph = "\uEA8F";

    /// <summary>Segoe Fluent "Refresh" glyph — the "Reopened" action (web Lucide <c>RefreshCw</c>).</summary>
    public const string ReopenGlyph = "\uE72C";

    /// <summary>Segoe Fluent "Completed" glyph — the "Acknowledge" action (web Lucide <c>CheckCircle</c>).</summary>
    public const string AcknowledgeGlyph = "\uE930";

    /// <summary>Segoe Fluent "RedEye" glyph — the "Mark read" action (web Lucide <c>Eye</c>).</summary>
    public const string MarkReadGlyph = "\uE7B3";

    /// <summary>Segoe Fluent "Ringer" glyph — the type fallback when no specific type maps (web Lucide <c>Bell</c>).</summary>
    public const string DefaultTypeGlyph = "\uEA8F";

    // ── Type-icon glyphs — the native port of the web TYPE_ICONS map. Each is the closest Segoe Fluent
    //    Icons glyph for the matching Lucide icon; unmapped types fall back to the bell, exactly as the web
    //    component does (`TYPE_ICONS[alert.type] || Icons.notifications`).
    private const string LocationGlyph = "\uE707";     // web MapPin (geofence)
    private const string BatteryGlyph = "\uE83F";      // web Battery
    private const string ChargingGlyph = "\uE945";     // web Zap (charging)
    private const string SecurityGlyph = "\uEA18";     // web Shield (sentry)
    private const string SpeedGlyph = "\uE9D9";        // web Gauge (speed limit)
    private const string ClimateGlyph = "\uE9CA";      // web Thermometer
    private const string SettingsGlyph = "\uE713";     // web Settings2 (software update)
    private const string TrendDownGlyph = "\uEB0F";    // web TrendingDown (vampire drain)
    private const string TireGlyph = "\uEA3A";         // web Droplets (tire pressure)
    private const string LockGlyph = "\uE72E";         // web Lock (idle unlocked)
    private const string AnalyticsGlyph = "\uE950";    // web BarChart3 (efficiency drop)
    private const string DatabaseGlyph = "\uE968";     // web Database (system database)
    private const string WifiGlyph = "\uEC05";         // web Wifi (system MQTT)
    private const string HardDriveGlyph = "\uEDA2";    // web HardDrive (system Redis)
    private const string RadioGlyph = "\uE93C";        // web Radio (system Tesla API)
    private const string EfficiencyGlyph = "\uE9D2";   // web Activity (system worker)

    /// <summary>
    /// The Segoe Fluent glyph for an alert type's leading icon — the native port of the web <c>TYPE_ICONS</c>
    /// lookup with its bell fallback for unknown / null types.
    /// </summary>
    /// <param name="type">The raw alert type.</param>
    public static string TypeGlyph(string? type) => (type ?? string.Empty) switch
    {
        "geofence_exit" or "geofence_enter" => LocationGlyph,
        "low_battery" or "battery_low" or "battery_high" => BatteryGlyph,
        "charging_complete" or "charging_cost" => ChargingGlyph,
        "sentry_event" => SecurityGlyph,
        "speed_limit" => SpeedGlyph,
        "temperature" => ClimateGlyph,
        "software_update" => SettingsGlyph,
        "vampire_drain" => TrendDownGlyph,
        "tire_pressure_low" => TireGlyph,
        "idle_unlocked" => LockGlyph,
        "efficiency_drop" => AnalyticsGlyph,
        "system_database" => DatabaseGlyph,
        "system_mqtt" => WifiGlyph,
        "system_redis" => HardDriveGlyph,
        "system_tesla_api" => RadioGlyph,
        "system_worker" => EfficiencyGlyph,
        _ => DefaultTypeGlyph,
    };
}
