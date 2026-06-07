using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state an <see cref="AuditLogViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>AuditLogWidget</c>
/// renders (web/src/features/dashboard/widgets/AuditLogWidget.tsx). The widget merges two queries
/// (the admin audit trail and the per-vehicle security/access feed) so every branch is derived from
/// the combined freshness of both, mirroring the web's <c>auditLoading || secLoading</c> /
/// <c>auditIsError || secIsError</c> / <c>auditStale || secStale</c> composition. Every branch maps
/// onto a visible surface; none is ever hidden.
/// </summary>
public enum AuditLogState
{
    /// <summary>Initial fetch with neither source resolved — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh rows from the network (or non-stale cache) carrying at least one event.</summary>
    Loaded,

    /// <summary>Both sources resolved with no combined events — render the friendly empty state.</summary>
    Empty,

    /// <summary>A source failed and no cached events remain — render the empty body plus an error chip.</summary>
    Error,

    /// <summary>Cached events older than the freshness window — render rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached events remain — render rows plus an offline/error chip.</summary>
    Offline,
}

/// <summary>
/// The canonical severity union for an audit/security feed row — the native port of the web
/// <c>Severity</c> ('info' | 'warning' | 'critical') used by <c>AuditLogWidget</c>'s
/// <c>SEVERITY_ICON</c> / <c>SEVERITY_COLOR</c> maps. Distinct from the four-valued
/// <see cref="SeverityLevel"/> so the audit widget never produces a 'success' row.
/// </summary>
public enum AuditSeverity
{
    /// <summary>Routine event (web '#3b82f6' blue).</summary>
    Info,

    /// <summary>Mutating / state-change event (web '#f59e0b' amber).</summary>
    Warning,

    /// <summary>Destructive / failed / unlocked event (web '#ef4444' red).</summary>
    Critical,
}

/// <summary>
/// One audit-trail entry from <c>GET /system/audit</c> (web <c>useAuditLogs</c>). The endpoint
/// serializes the Go <c>systemmodel.AuditLog</c> shape — <c>{id, ts, actor, action, entity_type,
/// entity_id, detail}</c> — whereas the web <c>AuditLogEntry</c> interface names the same concepts
/// <c>{resource, details, createdAt}</c>. Parsing is null-tolerant and accepts BOTH naming
/// conventions (the web-interface name wins when present, else the real wire field) so the native
/// widget reproduces the web component's intent against the actual backend without drift:
/// <c>resource ← entity_type</c>, <c>details ← detail</c>, <c>createdAt ← ts</c>.
/// </summary>
public sealed record AuditLogEntry(
    string Id,
    string Action,
    string? Resource,
    string? Details,
    string? CreatedAt)
{
    /// <summary>The parsed creation instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => AuditTimestamps.TryParse(CreatedAt);

    /// <summary>Parse a <c>GET /system/audit</c> JSON array into a tolerant list of entries.</summary>
    public static IReadOnlyList<AuditLogEntry> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AuditLogEntry>();
        }

        var list = new List<AuditLogEntry>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single audit JSON object into an <see cref="AuditLogEntry"/>.</summary>
    public static AuditLogEntry FromJson(JsonElement obj) => new(
        Id: AuditJson.GetId(obj),
        Action: AuditJson.GetString(obj, "action") ?? string.Empty,
        Resource: AuditJson.GetString(obj, "resource") ?? AuditJson.GetString(obj, "entity_type"),
        Details: AuditJson.GetString(obj, "details") ?? AuditJson.GetString(obj, "detail"),
        CreatedAt: AuditJson.GetString(obj, "created_at") ?? AuditJson.GetString(obj, "createdAt") ?? AuditJson.GetString(obj, "ts"));
}

/// <summary>The JSON kind a <see cref="SecurityFlag"/> was parsed from.</summary>
public enum SecurityFlagKind
{
    /// <summary>The property was not present on the object.</summary>
    Absent,

    /// <summary>The property was explicit JSON <c>null</c>.</summary>
    JsonNull,

    /// <summary>The property was a JSON boolean.</summary>
    Flag,

    /// <summary>The property was a JSON string.</summary>
    Word,
}

/// <summary>
/// The tri-state-plus-string value of a single security/access signal from <c>GET /security</c>. The
/// backend serializes raw <c>signal.SignalValue</c>s, so a field may arrive as a boolean, a string,
/// JSON null, or be absent entirely. This struct preserves that distinction so
/// <see cref="AuditLogProjection"/> can reproduce the web component's exact JavaScript semantics
/// (<c>=== false</c>, <c>=== true</c>, <c>=== 'active'</c>, truthiness, and <c>!== null</c> where an
/// absent value still counts as "not null").
/// </summary>
public readonly record struct SecurityFlag(SecurityFlagKind Kind, bool Value, string? Text)
{
    /// <summary>An absent (key-missing) value.</summary>
    public static SecurityFlag Absent => new(SecurityFlagKind.Absent, false, null);

    /// <summary>Web <c>x !== null</c>: true for an absent OR present value, false only for explicit JSON null.</summary>
    public bool IsNotNull => Kind != SecurityFlagKind.JsonNull;

    /// <summary>Web JavaScript truthiness: a boolean <c>true</c> or a non-empty string.</summary>
    public bool IsTruthy => Kind switch
    {
        SecurityFlagKind.Flag => Value,
        SecurityFlagKind.Word => !string.IsNullOrEmpty(Text),
        _ => false,
    };

    /// <summary>Web <c>x === true</c>: strictly the boolean <c>true</c>.</summary>
    public bool IsTrue => Kind == SecurityFlagKind.Flag && Value;

    /// <summary>Web <c>x === false</c>: strictly the boolean <c>false</c>.</summary>
    public bool IsFalse => Kind == SecurityFlagKind.Flag && !Value;

    /// <summary>True when the value is a string (web <c>typeof x === 'string'</c>).</summary>
    public bool IsWord => Kind == SecurityFlagKind.Word;

    /// <summary>Web <c>x === value</c> for a string comparand (e.g. <c>sentryMode === 'active'</c>).</summary>
    public bool Matches(string value) => Kind == SecurityFlagKind.Word && string.Equals(Text, value, StringComparison.Ordinal);

    /// <summary>Read the named property as a <see cref="SecurityFlag"/>, tolerating any JSON kind.</summary>
    public static SecurityFlag From(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return Absent;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Null => new SecurityFlag(SecurityFlagKind.JsonNull, false, null),
            JsonValueKind.True => new SecurityFlag(SecurityFlagKind.Flag, true, null),
            JsonValueKind.False => new SecurityFlag(SecurityFlagKind.Flag, false, null),
            JsonValueKind.String => new SecurityFlag(SecurityFlagKind.Word, false, v.GetString()),
            _ => Absent,
        };
    }
}

/// <summary>
/// One security/access snapshot row from <c>GET /security?vehicle_id=</c> (web
/// <c>useSecurityEvents</c>). The handler stamps each forward-folded timeline row with an <c>id</c>
/// and a <c>created_at</c>; the remaining fields are tolerant <see cref="SecurityFlag"/>s because the
/// signal-backed values may be boolean, string, null, or absent. Only the fields the web
/// <c>AuditLogWidget</c> actually reads (<c>locked</c>, <c>sentry_mode</c>, <c>door_state</c>,
/// <c>guest_mode</c>, <c>valet_mode_enabled</c>) are surfaced.
/// </summary>
public sealed record SecurityEvent(
    string Id,
    SecurityFlag Locked,
    SecurityFlag SentryMode,
    SecurityFlag DoorState,
    SecurityFlag GuestMode,
    SecurityFlag ValetModeEnabled,
    string? CreatedAt)
{
    /// <summary>The parsed creation instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => AuditTimestamps.TryParse(CreatedAt);

    /// <summary>Parse a <c>GET /security</c> JSON array into a tolerant list of rows.</summary>
    public static IReadOnlyList<SecurityEvent> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SecurityEvent>();
        }

        var list = new List<SecurityEvent>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single security JSON object into a <see cref="SecurityEvent"/>.</summary>
    public static SecurityEvent FromJson(JsonElement obj) => new(
        Id: AuditJson.GetId(obj),
        Locked: SecurityFlag.From(obj, "locked"),
        SentryMode: SecurityFlag.From(obj, "sentry_mode"),
        DoorState: SecurityFlag.From(obj, "door_state"),
        GuestMode: SecurityFlag.From(obj, "guest_mode"),
        ValetModeEnabled: SecurityFlag.From(obj, "valet_mode_enabled"),
        CreatedAt: AuditJson.GetString(obj, "created_at") ?? AuditJson.GetString(obj, "createdAt"));
}

/// <summary>Tolerant JSON readers shared by the audit + security parse adapters.</summary>
internal static class AuditJson
{
    /// <summary>Read a string property, or <see langword="null"/> when absent / not a string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

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

/// <summary>Shared ISO-8601 timestamp parsing for the audit + security read-models.</summary>
internal static class AuditTimestamps
{
    /// <summary>Parse a wire timestamp string, or <see langword="null"/> when absent/unparseable.</summary>
    public static DateTimeOffset? TryParse(string? raw)
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
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1</c> branch in
/// web/src/features/dashboard/widgets/AuditLogWidget.tsx.
/// </summary>
public readonly record struct AuditLogSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static AuditLogSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): show the 24h count + severity badge.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready feed row consumed by the WinUI view — the native analogue of a web
/// <c>EventFeedItem</c> (the merged <c>feedItems</c> in the web component). Holds the resolved
/// severity presentation (glyph + token brush key), the title/subtitle, the relative-time string, and
/// a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record AuditFeedRow(
    string Id,
    AuditSeverity Severity,
    string Glyph,
    string AccentBrushKey,
    string Title,
    string Subtitle,
    string RelativeTime,
    DateTimeOffset Timestamp,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the merged audit + security feed for one footprint — the
/// native analogue of everything the web component computes via <c>useMemo</c> before returning JSX.
/// Holds the compact 24h count + its worst-severity badge, plus the newest-first, capped feed rows for
/// the standard layout. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record AuditLogDisplay(
    bool IsCompact,
    bool HasItems,
    int TotalEvents24h,
    AuditSeverity WorstSeverity,
    string CountText,
    string Events24hLabel,
    string WorstSeverityLabel,
    StatusKind WorstBadgeStatus,
    string CompactAutomationName,
    IReadOnlyList<AuditFeedRow> Items);

/// <summary>
/// Pure projection from raw audit + security rows to the display model — the native port of the
/// <c>feedItems</c> / compact-stats <c>useMemo</c> logic in
/// web/src/features/dashboard/widgets/AuditLogWidget.tsx plus <c>WidgetEventFeed</c>'s newest-first
/// sort and <c>maxItems</c> slice. <paramref name="now"/> is injected so the 24-hour window and the
/// relative-time tiers are unit-tested deterministically. Each label resolves through the i18n facade.
/// </summary>
public static class AuditLogProjection
{
    /// <summary>The Segoe Fluent shield glyph used for security/access rows (web <c>ShieldAlert</c>).</summary>
    public const string SecurityGlyph = "\uEA18";

    private const string EmDash = "\u2014";
    private const string MiddotSeparator = " \u00B7 ";

    /// <summary>Project the merged feed for <paramref name="size"/> relative to <paramref name="now"/>.</summary>
    public static AuditLogDisplay Project(
        IReadOnlyList<AuditLogEntry> auditLogs,
        IReadOnlyList<SecurityEvent> securityEvents,
        AuditLogSize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(auditLogs);
        ArgumentNullException.ThrowIfNull(securityEvents);
        ArgumentNullException.ThrowIfNull(localizer);

        var combined = new List<CombinedItem>(auditLogs.Count + securityEvents.Count);
        foreach (var entry in auditLogs)
        {
            combined.Add(FromAudit(entry));
        }

        foreach (var ev in securityEvents)
        {
            combined.Add(FromSecurity(ev, localizer));
        }

        var (total24h, worst) = ComputeCompactStats(combined, now);

        var rows = combined
            .OrderByDescending(c => c.Timestamp)
            .Take(AuditLogRegistration.MaxFeedItems)
            .Select(c => BuildRow(c, localizer, now))
            .ToList();

        return new AuditLogDisplay(
            IsCompact: size.IsCompact,
            HasItems: combined.Count > 0,
            TotalEvents24h: total24h,
            WorstSeverity: worst,
            CountText: total24h.ToString(CultureInfo.InvariantCulture),
            Events24hLabel: localizer.GetString("widget.auditEvents24h", "Events (24h)"),
            WorstSeverityLabel: SeverityLabel(localizer, worst),
            WorstBadgeStatus: BadgeStatus(worst),
            CompactAutomationName: CompactAutomationName(localizer, total24h, worst),
            Items: rows);
    }

    /// <summary>The web <c>inferAuditSeverity</c>: destructive/failed → critical, mutating → warning, else info.</summary>
    public static AuditSeverity InferAuditSeverity(string? action)
    {
        string a = action ?? string.Empty;
        if (a.Contains("delete", StringComparison.OrdinalIgnoreCase) ||
            a.Contains("revoke", StringComparison.OrdinalIgnoreCase) ||
            a.Contains("fail", StringComparison.OrdinalIgnoreCase))
        {
            return AuditSeverity.Critical;
        }

        if (a.Contains("update", StringComparison.OrdinalIgnoreCase) ||
            a.Contains("change", StringComparison.OrdinalIgnoreCase) ||
            a.Contains("modify", StringComparison.OrdinalIgnoreCase))
        {
            return AuditSeverity.Warning;
        }

        return AuditSeverity.Info;
    }

    /// <summary>The web <c>inferSecuritySeverity</c>: unlocked → critical, sentry active/on → warning, else info.</summary>
    public static AuditSeverity InferSecuritySeverity(SecurityEvent ev)
    {
        ArgumentNullException.ThrowIfNull(ev);
        if (ev.Locked.IsFalse)
        {
            return AuditSeverity.Critical;
        }

        if (ev.SentryMode.Matches("active") || ev.SentryMode.IsTrue)
        {
            return AuditSeverity.Warning;
        }

        return AuditSeverity.Info;
    }

    /// <summary>
    /// The web <c>buildSecurityTitle</c>: builds the prioritized label parts and returns the first
    /// applicable one (locked → sentry → door → guest → valet), falling back to "Security event".
    /// </summary>
    public static string BuildSecurityTitle(SecurityEvent ev, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(ev);
        ArgumentNullException.ThrowIfNull(localizer);

        if (ev.Locked.IsNotNull)
        {
            return ev.Locked.IsTruthy
                ? localizer.GetString("widget.audit.vehicleLocked", "Vehicle locked")
                : localizer.GetString("widget.audit.vehicleUnlocked", "Vehicle unlocked");
        }

        if (ev.SentryMode.IsTruthy)
        {
            string label = ev.SentryMode.IsWord
                ? ev.SentryMode.Text ?? string.Empty
                : localizer.GetString("widget.audit.sentryOn", "On");
            return FormatLabel(localizer.GetString("widget.audit.sentry", "Sentry: {0}"), label);
        }

        if (ev.DoorState.IsTruthy)
        {
            string label = ev.DoorState.IsWord
                ? ev.DoorState.Text ?? string.Empty
                : localizer.GetString("widget.audit.doorOpen", "Open");
            return FormatLabel(localizer.GetString("widget.audit.door", "Door: {0}"), label);
        }

        if (ev.GuestMode.IsNotNull)
        {
            return ev.GuestMode.IsTruthy
                ? localizer.GetString("widget.audit.guestModeOn", "Guest mode on")
                : localizer.GetString("widget.audit.guestModeOff", "Guest mode off");
        }

        if (ev.ValetModeEnabled.IsNotNull)
        {
            return ev.ValetModeEnabled.IsTruthy
                ? localizer.GetString("widget.audit.valetModeOn", "Valet mode on")
                : localizer.GetString("widget.audit.valetModeOff", "Valet mode off");
        }

        return localizer.GetString("widget.auditSecurityEvent", "Security event");
    }

    /// <summary>Localized severity label (web <c>widget.audit{Critical|Warning|Info}</c>).</summary>
    public static string SeverityLabel(ILocalizer localizer, AuditSeverity severity)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return severity switch
        {
            AuditSeverity.Critical => localizer.GetString("widget.auditCritical", "Critical"),
            AuditSeverity.Warning => localizer.GetString("widget.auditWarning", "Warning"),
            _ => localizer.GetString("widget.auditInfo", "Info"),
        };
    }

    /// <summary>The compact badge tint (web <c>variant</c>): critical → danger, warning → warning, info → neutral.</summary>
    public static StatusKind BadgeStatus(AuditSeverity severity) => severity switch
    {
        AuditSeverity.Critical => StatusKind.Danger,
        AuditSeverity.Warning => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    private static CombinedItem FromAudit(AuditLogEntry entry)
    {
        var severity = InferAuditSeverity(entry.Action);
        string title = string.IsNullOrEmpty(entry.Action) ? EmDash : entry.Action;
        string subtitle = JoinSubtitle(entry.Resource, entry.Details);
        return new CombinedItem(
            Id: $"audit-{entry.Id}",
            Severity: severity,
            IsSecurity: false,
            Title: title,
            Subtitle: subtitle,
            Timestamp: entry.CreatedAtTime ?? DateTimeOffset.UnixEpoch);
    }

    private static CombinedItem FromSecurity(SecurityEvent ev, ILocalizer localizer)
    {
        var severity = InferSecuritySeverity(ev);
        return new CombinedItem(
            Id: $"sec-{ev.Id}",
            Severity: severity,
            IsSecurity: true,
            Title: BuildSecurityTitle(ev, localizer),
            Subtitle: localizer.GetString("widget.auditSecurityEvent", "Security event"),
            Timestamp: ev.CreatedAtTime ?? DateTimeOffset.UnixEpoch);
    }

    private static (int Total, AuditSeverity Worst) ComputeCompactStats(IReadOnlyList<CombinedItem> items, DateTimeOffset now)
    {
        var dayAgo = now - TimeSpan.FromHours(24);
        int total = 0;
        var worst = AuditSeverity.Info;
        foreach (var item in items)
        {
            if (item.Timestamp < dayAgo)
            {
                continue;
            }

            total++;
            if (item.Severity == AuditSeverity.Critical)
            {
                worst = AuditSeverity.Critical;
            }
            else if (item.Severity == AuditSeverity.Warning && worst != AuditSeverity.Critical)
            {
                worst = AuditSeverity.Warning;
            }
        }

        return (total, worst);
    }

    private static AuditFeedRow BuildRow(CombinedItem item, ILocalizer localizer, DateTimeOffset now)
    {
        var tokens = SeverityLevels.Tokens(ToLevel(item.Severity));
        string glyph = item.IsSecurity ? SecurityGlyph : tokens.IconGlyph;
        string relative = DateTimeFormatting.Format(item.Timestamp, DateTimeVariant.Relative, now);
        string severityLabel = SeverityLabel(localizer, item.Severity);

        return new AuditFeedRow(
            Id: item.Id,
            Severity: item.Severity,
            Glyph: glyph,
            AccentBrushKey: tokens.AccentBrushKey,
            Title: item.Title,
            Subtitle: item.Subtitle,
            RelativeTime: relative,
            Timestamp: item.Timestamp,
            AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", severityLabel, item.Title, relative));
    }

    private static string CompactAutomationName(ILocalizer localizer, int total, AuditSeverity worst) =>
        string.Format(
            CultureInfo.CurrentCulture,
            "{0} {1}, {2}",
            total.ToString(CultureInfo.InvariantCulture),
            localizer.GetString("widget.auditEvents24h", "Events (24h)"),
            SeverityLabel(localizer, worst));

    private static string JoinSubtitle(string? resource, string? details)
    {
        var parts = new List<string>(2);
        if (!string.IsNullOrEmpty(resource))
        {
            parts.Add(resource);
        }

        if (!string.IsNullOrEmpty(details))
        {
            parts.Add(details);
        }

        return parts.Count > 0 ? string.Join(MiddotSeparator, parts) : EmDash;
    }

    private static SeverityLevel ToLevel(AuditSeverity severity) => severity switch
    {
        AuditSeverity.Critical => SeverityLevel.Critical,
        AuditSeverity.Warning => SeverityLevel.Warn,
        _ => SeverityLevel.Info,
    };

    private static string FormatLabel(string template, string value) =>
        template
            .Replace("{{value}}", value, StringComparison.Ordinal)
            .Replace("{value}", value, StringComparison.Ordinal)
            .Replace("{0}", value, StringComparison.Ordinal);

    private readonly record struct CombinedItem(
        string Id,
        AuditSeverity Severity,
        bool IsSecurity,
        string Title,
        string Subtitle,
        DateTimeOffset Timestamp);
}

/// <summary>
/// Canonical registry metadata for the Audit Log surface — the native mirror of the web registry entry
/// in web/src/features/dashboard/widgets/registry/system.ts. The dashboard grid system binds this
/// surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class AuditLogRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "audit-log";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "system";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AuditLogWidget";

    /// <summary>Maximum feed rows rendered in the standard layout (web <c>maxItems={15}</c>).</summary>
    public const int MaxFeedItems = 15;

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static AuditLogSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 2 columns × 4 rows.</summary>
    public static AuditLogSize MinSize => new(2, 4);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static AuditLogSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Audit Log").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.auditLog", "Audit Log");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.auditLog.description",
            "Security audit trail: user actions, auth events, permission changes");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(AuditLogSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static AuditLogSize Clamp(AuditLogSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Audit Log surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an action, resource, VIN, or
/// security value — so a diagnostics line can never leak what an audit event was about. Thread-safe.
/// </summary>
public sealed class AuditLogDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AuditLogDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AuditLogWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AuditLogRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;AuditLogEntry&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept
/// pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class AuditLogResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<AuditLogEntry>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<AuditLogEntry> Parse() =>
            raw.HasValue ? AuditLogEntry.ParseList(raw.Value) : Array.Empty<AuditLogEntry>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<AuditLogEntry>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<AuditLogEntry>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<AuditLogEntry>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<AuditLogEntry>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<AuditLogEntry>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<AuditLogEntry>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<AuditLogEntry>> ToLoadedOrEmpty(
        IReadOnlyList<AuditLogEntry> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<AuditLogEntry>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<AuditLogEntry>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;SecurityEvent&gt;&gt;</c>, preserving every freshness flag
/// so the view-model can render the full state matrix. Kept pure so the parse-and-preserve contract is
/// unit-tested without a network or cache.
/// </summary>
public static class SecurityEventResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<SecurityEvent>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<SecurityEvent> Parse() =>
            raw.HasValue ? SecurityEvent.ParseList(raw.Value) : Array.Empty<SecurityEvent>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<SecurityEvent>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<SecurityEvent>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<SecurityEvent>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<SecurityEvent>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<SecurityEvent>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<SecurityEvent>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<SecurityEvent>> ToLoadedOrEmpty(
        IReadOnlyList<SecurityEvent> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<SecurityEvent>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<SecurityEvent>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}
