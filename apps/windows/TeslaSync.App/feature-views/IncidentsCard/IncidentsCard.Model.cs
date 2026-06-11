using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive freshness state of the active-incidents read backing the
/// <see cref="IncidentsCardViewModel"/> — the native union of the loading / loaded / empty / stale / offline /
/// error branches the P2 feature-view contract mandates. The web source
/// (web/src/features/system/components/status/IncidentsCard.tsx) reads its list through the TanStack query
/// <c>useIncidents({ activeOnly: true })</c> and collapses to nothing when the list is empty; the native surface
/// owns the same cache-then-network read but renders an explicit empty surface so a region never disappears
/// silently.
/// </summary>
public enum IncidentsState
{
    /// <summary>The incidents read is in flight with no cached value yet — render skeleton rows.</summary>
    Loading,

    /// <summary>A fresh incident list arrived — render the active-incident rows.</summary>
    Loaded,

    /// <summary>The read resolved with no active incidents — render the friendly empty surface.</summary>
    Empty,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,

    /// <summary>The read failed with no cached list — render the retriable error surface.</summary>
    Error,
}

// IncidentSeverity (Minor/Major/Critical) and IncidentStatus (Investigating/Identified/Monitoring/Resolved)
// are declared once for the TeslaSync.App.FeatureViews namespace in IncidentForm.Model.cs — the incident-domain
// authority that also owns their wire mappings. This card consumes those canonical enums; a second copy here
// produced a CS0101 duplicate-type build break, so the redundant declarations were consolidated away.

/// <summary>
/// One active incident as the card needs it — the native mirror of the fields the web row reads from the
/// <c>Incident</c> shape (web/src/api/hooks/useIncidents.ts). Only the rendered fields are retained; the full
/// description, source, per-update bodies and audit timestamps are dropped because the card never shows them
/// (they live on the post-mortem timeline surface). Parsed from the snake_case JSON the Go API returns.
/// </summary>
/// <param name="Id">The server incident id (web <c>id</c>) — the list key and the timeline navigation target.</param>
/// <param name="Title">The incident title (web <c>title</c>).</param>
/// <param name="Severity">The incident severity (web <c>severity</c>).</param>
/// <param name="Status">The incident lifecycle status (web <c>status</c>).</param>
/// <param name="AffectedComponents">The affected components (web <c>affected_components</c>), possibly empty.</param>
/// <param name="StartedAt">When the incident started (web <c>started_at</c>), or null when unparseable.</param>
/// <param name="UpdateCount">The number of timeline updates (web <c>updates.length</c>).</param>
public sealed record IncidentSummary(
    long Id,
    string Title,
    IncidentSeverity Severity,
    IncidentStatus Status,
    IReadOnlyList<string> AffectedComponents,
    DateTimeOffset? StartedAt,
    int UpdateCount)
{
    /// <summary>Parse one incident from its JSON object, or null when it carries no id.</summary>
    public static IncidentSummary? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (!element.TryGetProperty("id", out var idEl) || idEl.ValueKind != JsonValueKind.Number
            || !idEl.TryGetInt64(out var id))
        {
            return null;
        }

        return new IncidentSummary(
            id,
            ReadString(element, "title") ?? string.Empty,
            ParseSeverity(ReadString(element, "severity")),
            ParseStatus(ReadString(element, "status")),
            ReadStringList(element, "affected_components"),
            ReadTimestamp(element, "started_at"),
            CountArray(element, "updates"));
    }

    /// <summary>
    /// Parse the active-incident list from the <c>GET /status/incidents?active=1</c> response. The Go handler
    /// returns a <c>{ "incidents": [...], "count": n }</c> envelope (web <c>IncidentListResponse</c>); a bare
    /// array is also tolerated. Any other shape yields an empty list.
    /// </summary>
    public static IReadOnlyList<IncidentSummary> ParseList(JsonElement element)
    {
        JsonElement array;
        if (element.ValueKind == JsonValueKind.Array)
        {
            array = element;
        }
        else if (element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty("incidents", out var incidents)
            && incidents.ValueKind == JsonValueKind.Array)
        {
            array = incidents;
        }
        else
        {
            return Array.Empty<IncidentSummary>();
        }

        var rows = new List<IncidentSummary>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (FromJson(item) is { } row)
            {
                rows.Add(row);
            }
        }

        return rows;
    }

    /// <summary>Map a severity string to the enum (case-insensitive); unknown values fall back to minor.</summary>
    public static IncidentSeverity ParseSeverity(string? value) =>
        value?.ToLowerInvariant() switch
        {
            "critical" => IncidentSeverity.Critical,
            "major" => IncidentSeverity.Major,
            _ => IncidentSeverity.Minor,
        };

    /// <summary>Map a status string to the enum (case-insensitive); unknown values fall back to investigating.</summary>
    public static IncidentStatus ParseStatus(string? value) =>
        value?.ToLowerInvariant() switch
        {
            "resolved" => IncidentStatus.Resolved,
            "monitoring" => IncidentStatus.Monitoring,
            "identified" => IncidentStatus.Identified,
            _ => IncidentStatus.Investigating,
        };

    private static string? ReadString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static IReadOnlyList<string> ReadStringList(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var items = new List<string>(value.GetArrayLength());
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { Length: > 0 } text)
            {
                items.Add(text);
            }
        }

        return items;
    }

    private static int CountArray(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array
            ? value.GetArrayLength()
            : 0;

    private static DateTimeOffset? ReadTimestamp(JsonElement element, string name)
    {
        if (element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            && DateTimeOffset.TryParse(
                value.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var parsed))
        {
            return parsed;
        }

        return null;
    }
}

/// <summary>
/// The render-ready projection of one incident row — the native port of the web per-incident <c>&lt;li&gt;</c>
/// (severity glyph, title, status badge, severity label, the optional affected-components line and the
/// "Started …" meta line). Pure data so the composition and the Narrator name are unit-tested without a XAML
/// host.
/// </summary>
/// <param name="Id">The incident id used as the list key and the timeline navigation target.</param>
/// <param name="Title">The incident title.</param>
/// <param name="SeverityGlyph">The Segoe Fluent glyph standing in for the web severity icon.</param>
/// <param name="SeverityStatus">The semantic tone tinting the severity glyph and label.</param>
/// <param name="SeverityLabel">The localized severity label ("minor" / "major" / "critical").</param>
/// <param name="StatusText">The localized status text shown in the status badge.</param>
/// <param name="StatusStatus">The semantic tone driving the status badge colour (web <c>STATUS_BADGE</c>).</param>
/// <param name="AffectsText">The "Affects: …" line (empty when no components are affected).</param>
/// <param name="HasAffects">True when an affected-components line should render.</param>
/// <param name="MetaText">The "Started {{when}}" line, with the " · N updates" suffix when there is more than one update.</param>
/// <param name="OpenLabel">The localized "view timeline" affordance label.</param>
/// <param name="AutomationName">The composed row Narrator name.</param>
public sealed record IncidentRow(
    long Id,
    string Title,
    string SeverityGlyph,
    StatusKind SeverityStatus,
    string SeverityLabel,
    string StatusText,
    StatusKind StatusStatus,
    string AffectsText,
    bool HasAffects,
    string MetaText,
    string OpenLabel,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the whole IncidentsCard surface — the header (title, count badge and
/// the log-incident affordance) plus the active-incident rows and the empty-surface copy. Pure data (no WinUI
/// types) so the projection is unit-tested without a XAML host.
/// </summary>
/// <param name="AutomationName">The surface Narrator name (the localized title plus the active count).</param>
/// <param name="HeaderGlyph">The Segoe Fluent glyph standing in for the web header <c>AlertTriangle</c> icon.</param>
/// <param name="Title">The card title (web "Active incidents").</param>
/// <param name="ShowCount">True when the active-incident count badge should render.</param>
/// <param name="Count">The active-incident count shown in the header badge.</param>
/// <param name="LogIncidentText">The "Log incident" call-to-action label.</param>
/// <param name="Incidents">The projected incident rows in server order.</param>
/// <param name="EmptyTitle">The empty-surface heading shown when no incidents are active.</param>
/// <param name="EmptyMessage">The empty-surface body shown when no incidents are active.</param>
public sealed record IncidentsDisplay(
    string AutomationName,
    string HeaderGlyph,
    string Title,
    bool ShowCount,
    int Count,
    string LogIncidentText,
    IReadOnlyList<IncidentRow> Incidents,
    string EmptyTitle,
    string EmptyMessage);

/// <summary>
/// Pure projection from the active-incident list to the render-ready <see cref="IncidentsDisplay"/> — the native
/// port of the web IncidentsCard render (web/src/features/system/components/status/IncidentsCard.tsx). Every owned
/// string resolves through the i18n facade with the web English fallback, the status-badge tone matches the web
/// <c>STATUS_BADGE</c> map, and the per-row "Started …" line reproduces the web <c>relativeFrom</c> tiers exactly.
/// The native token palette folds the web's amber/orange/red severity tones onto two semantic tones (warning for
/// minor and major, danger for critical); the distinct glyph and the severity label keep minor and major
/// distinguishable.
/// </summary>
public static class IncidentsProjection
{
    /// <summary>Segoe Fluent "Warning" glyph standing in for the web Lucide <c>AlertTriangle</c> (header + major).</summary>
    public const string HeaderGlyph = "\uE7BA";

    /// <summary>Segoe Fluent "ErrorBadge" glyph standing in for the web Lucide <c>AlertCircle</c> (minor).</summary>
    public const string MinorGlyph = "\uEA39";

    /// <summary>Segoe Fluent "Warning" glyph standing in for the web Lucide <c>AlertTriangle</c> (major).</summary>
    public const string MajorGlyph = "\uE7BA";

    /// <summary>Segoe Fluent "Blocked" glyph standing in for the web Lucide <c>AlertOctagon</c> (critical).</summary>
    public const string CriticalGlyph = "\uE730";

    private const int MinuteSeconds = 60;
    private const int HourSeconds = 3600;
    private const int DaySeconds = 86400;

    /// <summary>
    /// Project the active-incident list into the render-ready display, resolving every string through
    /// <paramref name="localizer"/> and formatting "Started …" times relative to <paramref name="now"/>.
    /// </summary>
    /// <param name="incidents">The active incidents (web <c>useIncidents({ activeOnly: true })</c>).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    /// <param name="now">The wall clock the relative "Started …" times are computed against.</param>
    public static IncidentsDisplay Project(
        IReadOnlyList<IncidentSummary> incidents,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(incidents);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString(IncidentsStrings.Title, "Active incidents");
        var rows = ProjectRows(incidents, localizer, now);

        string automationName = rows.Count > 0
            ? string.Format(CultureInfo.CurrentCulture, "{0} ({1})", title, rows.Count)
            : title;

        return new IncidentsDisplay(
            AutomationName: automationName,
            HeaderGlyph: HeaderGlyph,
            Title: title,
            ShowCount: rows.Count > 0,
            Count: rows.Count,
            LogIncidentText: localizer.GetString(IncidentsStrings.Log, "Log incident"),
            Incidents: rows,
            EmptyTitle: localizer.GetString(IncidentsStrings.EmptyTitle, "No active incidents"),
            EmptyMessage: localizer.GetString(
                IncidentsStrings.EmptyMessage,
                "All systems are operating normally. Active incidents will appear here."));
    }

    /// <summary>Project the incident rows in server order, resolving every string through the i18n facade.</summary>
    public static IReadOnlyList<IncidentRow> ProjectRows(
        IReadOnlyList<IncidentSummary> incidents,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(incidents);
        ArgumentNullException.ThrowIfNull(localizer);

        string openLabel = localizer.GetString(IncidentsStrings.Open, "View incident timeline");
        var rows = new List<IncidentRow>(incidents.Count);
        foreach (var incident in incidents)
        {
            string severityLabel = SeverityLabel(incident.Severity, localizer);
            string statusText = StatusLabel(incident.Status, localizer);
            string affectsText = incident.AffectedComponents.Count > 0
                ? localizer.GetString(IncidentsStrings.Affects, "Affects: {{components}}")
                    .Replace(
                        "{{components}}",
                        string.Join(", ", incident.AffectedComponents),
                        StringComparison.Ordinal)
                : string.Empty;
            string metaText = MetaLine(incident, localizer, now);

            string automationName = BuildAutomationName(
                incident.Title,
                severityLabel,
                statusText,
                metaText,
                affectsText);

            rows.Add(new IncidentRow(
                Id: incident.Id,
                Title: incident.Title,
                SeverityGlyph: SeverityGlyph(incident.Severity),
                SeverityStatus: SeverityTone(incident.Severity),
                SeverityLabel: severityLabel,
                StatusText: statusText,
                StatusStatus: StatusTone(incident.Status),
                AffectsText: affectsText,
                HasAffects: affectsText.Length > 0,
                MetaText: metaText,
                OpenLabel: openLabel,
                AutomationName: automationName));
        }

        return rows;
    }

    /// <summary>The Segoe Fluent glyph standing in for the web severity icon.</summary>
    public static string SeverityGlyph(IncidentSeverity severity) => severity switch
    {
        IncidentSeverity.Critical => CriticalGlyph,
        IncidentSeverity.Major => MajorGlyph,
        _ => MinorGlyph,
    };

    /// <summary>The semantic tone tinting the severity glyph and label (critical → danger, otherwise warning).</summary>
    public static StatusKind SeverityTone(IncidentSeverity severity) =>
        severity == IncidentSeverity.Critical ? StatusKind.Danger : StatusKind.Warning;

    /// <summary>The semantic tone driving the status badge colour (the web <c>STATUS_BADGE</c> map).</summary>
    public static StatusKind StatusTone(IncidentStatus status) => status switch
    {
        IncidentStatus.Investigating => StatusKind.Danger,
        IncidentStatus.Identified => StatusKind.Warning,
        IncidentStatus.Monitoring => StatusKind.Info,
        _ => StatusKind.Success,
    };

    /// <summary>The localized severity label ("minor" / "major" / "critical").</summary>
    public static string SeverityLabel(IncidentSeverity severity, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return severity switch
        {
            IncidentSeverity.Critical => localizer.GetString(IncidentsStrings.SeverityCritical, "critical"),
            IncidentSeverity.Major => localizer.GetString(IncidentsStrings.SeverityMajor, "major"),
            _ => localizer.GetString(IncidentsStrings.SeverityMinor, "minor"),
        };
    }

    /// <summary>The localized status label shown in the status badge.</summary>
    public static string StatusLabel(IncidentStatus status, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return status switch
        {
            IncidentStatus.Investigating => localizer.GetString(IncidentsStrings.StatusInvestigating, "investigating"),
            IncidentStatus.Identified => localizer.GetString(IncidentsStrings.StatusIdentified, "identified"),
            IncidentStatus.Monitoring => localizer.GetString(IncidentsStrings.StatusMonitoring, "monitoring"),
            _ => localizer.GetString(IncidentsStrings.StatusResolved, "resolved"),
        };
    }

    /// <summary>
    /// The "Started {{when}}" meta line with the " · N updates" suffix when there is more than one update —
    /// the native port of the web started-and-updates composition.
    /// </summary>
    public static string MetaLine(IncidentSummary incident, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(incident);
        ArgumentNullException.ThrowIfNull(localizer);

        string when = RelativeFrom(incident.StartedAt, now, localizer);
        string started = localizer.GetString(IncidentsStrings.Started, "Started {{when}}")
            .Replace("{{when}}", when, StringComparison.Ordinal)
            .TrimEnd();

        if (incident.UpdateCount > 1)
        {
            string updates = localizer.GetString(IncidentsStrings.Updates, "{{count}} updates")
                .Replace(
                    "{{count}}",
                    incident.UpdateCount.ToString(CultureInfo.InvariantCulture),
                    StringComparison.Ordinal);
            return started + " \u00B7 " + updates;
        }

        return started;
    }

    /// <summary>
    /// The relative-from-now label — a 1:1 port of the web <c>relativeFrom</c>: "just now" under a minute, then
    /// "Nm ago", "Nh ago" and "Nd ago". A null / unparseable timestamp yields an empty string, exactly as the web
    /// helper returns "" for a non-finite parse.
    /// </summary>
    public static string RelativeFrom(DateTimeOffset? value, DateTimeOffset now, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (value is not { } at)
        {
            return string.Empty;
        }

        long seconds = Math.Max(0, (long)Math.Floor((now - at).TotalSeconds));
        if (seconds < MinuteSeconds)
        {
            return localizer.GetString(IncidentsStrings.JustNow, "just now");
        }

        if (seconds < HourSeconds)
        {
            return Count(IncidentsStrings.MinutesAgo, "{{count}}m ago", seconds / MinuteSeconds, localizer);
        }

        if (seconds < DaySeconds)
        {
            return Count(IncidentsStrings.HoursAgo, "{{count}}h ago", seconds / HourSeconds, localizer);
        }

        return Count(IncidentsStrings.DaysAgo, "{{count}}d ago", seconds / DaySeconds, localizer);
    }

    private static string Count(string key, string fallback, long count, ILocalizer localizer) =>
        localizer.GetString(key, fallback)
            .Replace("{{count}}", count.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);

    private static string BuildAutomationName(
        string title,
        string severityLabel,
        string statusText,
        string metaText,
        string affectsText)
    {
        var parts = new List<string>(3)
        {
            string.Format(CultureInfo.CurrentCulture, "{0}, {1}, {2}", title, severityLabel, statusText),
        };

        if (metaText.Length > 0)
        {
            parts.Add(metaText);
        }

        if (affectsText.Length > 0)
        {
            parts.Add(affectsText);
        }

        return string.Join(". ", parts);
    }
}

/// <summary>
/// The canonical i18n keys the IncidentsCard surface resolves. The web source hard-codes its English copy
/// (the surface predates the web i18n sweep), so these keys are introduced for the native port per the P2/S10
/// contract: every label flows through the i18n facade with the web English text as the fallback. Centralised so
/// the catalog is asserted once and the keys never drift between the projection and the resource pipeline.
/// </summary>
public static class IncidentsStrings
{
    /// <summary>Card title (web "Active incidents").</summary>
    public const string Title = "status.incidents.title";

    /// <summary>Log-incident call-to-action (web "Log incident").</summary>
    public const string Log = "status.incidents.log";

    /// <summary>Affected-components line template (web "Affects: …").</summary>
    public const string Affects = "status.incidents.affects";

    /// <summary>Started-at line template (web "Started {relative}").</summary>
    public const string Started = "status.incidents.started";

    /// <summary>Updates-count suffix template (web "{n} updates").</summary>
    public const string Updates = "status.incidents.updates";

    /// <summary>"View incident timeline" row affordance label.</summary>
    public const string Open = "status.incidents.open";

    /// <summary>Minor severity label (web <c>'minor'</c>).</summary>
    public const string SeverityMinor = "status.incidents.severity.minor";

    /// <summary>Major severity label (web <c>'major'</c>).</summary>
    public const string SeverityMajor = "status.incidents.severity.major";

    /// <summary>Critical severity label (web <c>'critical'</c>).</summary>
    public const string SeverityCritical = "status.incidents.severity.critical";

    /// <summary>Investigating status label (web <c>'investigating'</c>).</summary>
    public const string StatusInvestigating = "status.incidents.status.investigating";

    /// <summary>Identified status label (web <c>'identified'</c>).</summary>
    public const string StatusIdentified = "status.incidents.status.identified";

    /// <summary>Monitoring status label (web <c>'monitoring'</c>).</summary>
    public const string StatusMonitoring = "status.incidents.status.monitoring";

    /// <summary>Resolved status label (web <c>'resolved'</c>).</summary>
    public const string StatusResolved = "status.incidents.status.resolved";

    /// <summary>Relative "just now" label (web <c>relativeFrom</c>).</summary>
    public const string JustNow = "status.incidents.time.justNow";

    /// <summary>Relative minutes-ago template (web <c>relativeFrom</c>).</summary>
    public const string MinutesAgo = "status.incidents.time.minutesAgo";

    /// <summary>Relative hours-ago template (web <c>relativeFrom</c>).</summary>
    public const string HoursAgo = "status.incidents.time.hoursAgo";

    /// <summary>Relative days-ago template (web <c>relativeFrom</c>).</summary>
    public const string DaysAgo = "status.incidents.time.daysAgo";

    /// <summary>Empty-surface heading (native-only; the web collapses the card when empty).</summary>
    public const string EmptyTitle = "status.incidents.empty.title";

    /// <summary>Empty-surface body (native-only; the web collapses the card when empty).</summary>
    public const string EmptyMessage = "status.incidents.empty.message";

    /// <summary>Error-surface title for a hard incidents-read failure.</summary>
    public const string ErrorTitle = "status.incidents.error.title";

    /// <summary>Generic incidents-read failure message.</summary>
    public const string ErrorLoad = "status.incidents.error.load";

    /// <summary>Offline incidents-read message.</summary>
    public const string ErrorOffline = "status.incidents.error.offline";

    /// <summary>Unauthenticated incidents-read message.</summary>
    public const string ErrorAuth = "status.incidents.error.auth";

    /// <summary>Refresh affordance Narrator label.</summary>
    public const string Refresh = "status.incidents.refresh";

    /// <summary>Stale freshness chip label.</summary>
    public const string StaleChip = "status.incidents.staleChip";

    /// <summary>Offline freshness chip label.</summary>
    public const string OfflineChip = "status.incidents.offlineChip";

    /// <summary>Retry affordance label.</summary>
    public const string Retry = "common.retry";

    /// <summary>Every key the surface resolves — asserted in tests as the i18n catalog.</summary>
    public static IReadOnlyList<string> AllKeys => new[]
    {
        Title,
        Log,
        Affects,
        Started,
        Updates,
        Open,
        SeverityMinor,
        SeverityMajor,
        SeverityCritical,
        StatusInvestigating,
        StatusIdentified,
        StatusMonitoring,
        StatusResolved,
        JustNow,
        MinutesAgo,
        HoursAgo,
        DaysAgo,
        EmptyTitle,
        EmptyMessage,
        ErrorTitle,
        ErrorLoad,
        ErrorOffline,
        ErrorAuth,
        Refresh,
        StaleChip,
        OfflineChip,
        Retry,
    };
}

/// <summary>
/// Canonical metadata for the IncidentsCard surface — the native anchor for the web component at
/// web/src/features/system/components/status/IncidentsCard.tsx. Centralises the diagnostics <see cref="Slug"/>
/// emitted with the <c>view.opened</c> event (P1/S11) and the generated incidents operation ids the source reads.
/// </summary>
public static class IncidentsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "IncidentsCard";

    /// <summary>The web component this surface mirrors.</summary>
    public const string WebSource = "features/system/components/status/IncidentsCard.tsx";

    /// <summary>The generated operation id for <c>GET /status/incidents</c> (web <c>useIncidents</c>).</summary>
    public const string ListOperation = "get_api_v1_status_incidents";

    /// <summary>The generated operation id for <c>GET /status/incidents/{id}</c> (the post-mortem timeline target).</summary>
    public const string DetailOperation = "get_api_v1_status_incidents_id";
}

/// <summary>
/// PII-safe diagnostics for the IncidentsCard surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never an incident id, title or affected component — so a
/// diagnostics line can never leak an incident. Thread-safe.
/// </summary>
public sealed class IncidentsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public IncidentsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=IncidentsCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={IncidentsRegistration.Slug}");
    }
}
