using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.SystemOps;

// The incident severity / status unions (web IncidentSeverity / IncidentStatus) and their wire mappings are the
// incident-domain authority declared once for the TeslaSync.App.FeatureViews namespace in IncidentForm.Model.cs.
// This post-mortem page consumes those canonical enums (resolved from the parent namespace) rather than
// re-declaring them, so the lifecycle vocabulary stays single-sourced across the incident surfaces.

/// <summary>
/// One timeline update entry — the native mirror of the web <c>IncidentUpdateEntry</c>
/// (web/src/api/hooks/useIncidents.ts): the moment it was posted, the lifecycle status it carried, the message
/// body and the optional author. Parsed null-tolerantly from the snake_case JSON the Go API returns so a partial
/// entry never throws and the projection applies the same web <c>?? '—'</c> defaults.
/// </summary>
/// <param name="At">When the update was posted (web <c>at</c>), or null when unparseable.</param>
/// <param name="Status">The lifecycle status the update carried (web <c>status</c>).</param>
/// <param name="Message">The update body (web <c>message</c>).</param>
/// <param name="Author">The optional author (web <c>author</c>), or null.</param>
public sealed record IncidentUpdateItem(
    DateTimeOffset? At,
    IncidentStatus Status,
    string Message,
    string? Author)
{
    /// <summary>Parse one update from its JSON object; a non-object element yields null.</summary>
    public static IncidentUpdateItem? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new IncidentUpdateItem(
            IncidentJson.Timestamp(element, "at"),
            IncidentSummary.ParseStatus(IncidentJson.String(element, "status")),
            IncidentJson.String(element, "message") ?? string.Empty,
            NullIfBlank(IncidentJson.String(element, "author")));
    }

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;
}

/// <summary>
/// One incident aggregate from <c>GET /status/incidents/{id}</c> — the native mirror of the web <c>Incident</c>
/// shape (web/src/api/hooks/useIncidents.ts) narrowed to the fields the post-mortem page renders: the header
/// (title, description, severity, status, source, affected components, started / resolved timestamps) and the
/// full ordered update list the timeline walks. Parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="Id">The server incident id (web <c>id</c>).</param>
/// <param name="Title">The incident title (web <c>title</c>).</param>
/// <param name="Description">The incident description (web <c>description</c>), possibly empty.</param>
/// <param name="Severity">The incident severity (web <c>severity</c>).</param>
/// <param name="Status">The incident lifecycle status (web <c>status</c>).</param>
/// <param name="Source">The incident source token (web <c>source</c>: <c>manual</c> / <c>auto</c>).</param>
/// <param name="AffectedComponents">The affected components (web <c>affected_components</c>), possibly empty.</param>
/// <param name="Updates">The ordered timeline updates (web <c>updates</c>), oldest first as the API returns them.</param>
/// <param name="StartedAt">When the incident started (web <c>started_at</c>), or null when unparseable.</param>
/// <param name="ResolvedAt">When the incident resolved (web <c>resolved_at</c>), or null when still open.</param>
public sealed record IncidentDetail(
    long Id,
    string Title,
    string Description,
    IncidentSeverity Severity,
    IncidentStatus Status,
    string Source,
    IReadOnlyList<string> AffectedComponents,
    IReadOnlyList<IncidentUpdateItem> Updates,
    DateTimeOffset? StartedAt,
    DateTimeOffset? ResolvedAt)
{
    /// <summary>True once the incident is closed (web <c>incident.status === 'resolved'</c>).</summary>
    public bool IsResolved => Status == IncidentStatus.Resolved;

    /// <summary>Parse one incident detail from its JSON object; an object without a numeric id yields null.</summary>
    public static IncidentDetail? FromJson(JsonElement element)
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

        return new IncidentDetail(
            id,
            IncidentJson.String(element, "title") ?? string.Empty,
            IncidentJson.String(element, "description") ?? string.Empty,
            IncidentSummary.ParseSeverity(IncidentJson.String(element, "severity")),
            IncidentSummary.ParseStatus(IncidentJson.String(element, "status")),
            IncidentJson.String(element, "source") ?? string.Empty,
            IncidentJson.StringList(element, "affected_components"),
            ParseUpdates(element),
            IncidentJson.Timestamp(element, "started_at"),
            IncidentJson.Timestamp(element, "resolved_at"));
    }

    private static IReadOnlyList<IncidentUpdateItem> ParseUpdates(JsonElement element)
    {
        if (!element.TryGetProperty("updates", out var updates) || updates.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<IncidentUpdateItem>();
        }

        var rows = new List<IncidentUpdateItem>(updates.GetArrayLength());
        foreach (var item in updates.EnumerateArray())
        {
            if (IncidentUpdateItem.FromJson(item) is { } row)
            {
                rows.Add(row);
            }
        }

        return rows;
    }
}

/// <summary>Null-tolerant JSON readers shared by the incident-timeline parsers (UI-free, headlessly asserted).</summary>
internal static class IncidentJson
{
    /// <summary>Read a string property, or null when absent / not a string.</summary>
    public static string? String(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    /// <summary>Read a string array property, dropping empty entries; absent / non-array yields an empty list.</summary>
    public static IReadOnlyList<string> StringList(JsonElement element, string name)
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

    /// <summary>Read an ISO-8601 timestamp property as a UTC <see cref="DateTimeOffset"/>, or null when unparseable.</summary>
    public static DateTimeOffset? Timestamp(JsonElement element, string name)
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
/// The <c>POST /status/incidents/{id}/updates</c> request body — the native mirror of the web
/// <c>AppendIncidentUpdatePayload</c> (web <c>useAppendIncidentUpdate</c>). The trimmed <see cref="Message"/> is
/// always sent; <see cref="Status"/> is the optional lifecycle change (web <c>status || undefined</c>) and is
/// omitted from the wire when null. Explicit snake_case names keep the shape matching the Go handler regardless
/// of the shared serializer policy.
/// </summary>
public sealed record AppendIncidentUpdateRequest(
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("status")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Status);

/// <summary>
/// The <c>PATCH /status/incidents/{id}</c> request body the page uses — the native mirror of the web
/// <c>PatchIncidentPayload</c> the resolve action fills (web <c>patch.mutateAsync({ id, payload: { resolved: true } })</c>).
/// Only the <see cref="Resolved"/> flag is modelled because that is the single field this page patches.
/// </summary>
public sealed record PatchIncidentRequest(
    [property: JsonPropertyName("resolved")] bool Resolved);

/// <summary>
/// The outcome of an incident mutation (append update / resolve) — the native analogue of a web mutation
/// resolving. On success it carries the refreshed <see cref="Incident"/> the API echoes (web mutations return the
/// updated <c>Incident</c>); on an HTTP fault it carries a classified <see cref="Error"/> rather than throwing,
/// so the view-model raises a toast exactly like the web <c>useToast</c> path.
/// </summary>
public sealed record IncidentMutationOutcome(bool Success, IncidentDetail? Incident, RepositoryError? Error)
{
    /// <summary>A successful mutation carrying the refreshed incident (or null when the body was unreadable).</summary>
    public static IncidentMutationOutcome Ok(IncidentDetail? incident) => new(true, incident, null);

    /// <summary>A classified failure.</summary>
    public static IncidentMutationOutcome Fail(RepositoryError error) => new(false, null, error);
}

/// <summary>The top-level data state the post-mortem page renders (web loading / not-found / success branches).</summary>
public enum IncidentTimelineState
{
    /// <summary>The incident read is in flight with nothing cached (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>The incident loaded — the header, timeline and append form render (web success branch).</summary>
    Ready,

    /// <summary>The incident is missing or the read failed (web <c>error || !incident</c>) — never a blank region.</summary>
    NotFound,
}

/// <summary>The immutable inputs the projection folds into a render-ready display (snapshot + flags).</summary>
/// <param name="Incident">The loaded incident, or null while loading / not found.</param>
/// <param name="Loading">True while the first read is in flight.</param>
/// <param name="Error">The classified read failure, or null.</param>
/// <param name="IncidentId">The route incident id (web <c>:id</c> param), surfaced in the not-found copy.</param>
public sealed record IncidentTimelineModel(
    IncidentDetail? Incident,
    bool Loading,
    RepositoryError? Error,
    long IncidentId);

/// <summary>
/// One render-ready timeline update row — the native port of the web per-update <c>&lt;li&gt;</c> (status badge,
/// absolute timestamp, optional "· author" and the message body). Pure data so the composition and Narrator name
/// are unit-tested without a XAML host.
/// </summary>
/// <param name="StatusText">The localized status badge text.</param>
/// <param name="StatusTone">The semantic tone driving the status badge colour (web <c>STATUS_BADGE</c>).</param>
/// <param name="TimestampText">The absolute timestamp text (web <c>fmtAbs(u.at)</c>).</param>
/// <param name="AuthorText">The "· author" suffix, or empty when no author.</param>
/// <param name="HasAuthor">True when an author suffix should render.</param>
/// <param name="Message">The update body (web <c>u.message</c>).</param>
/// <param name="AutomationName">The composed row Narrator name.</param>
public sealed record IncidentTimelineRow(
    string StatusText,
    StatusKind StatusTone,
    string TimestampText,
    string AuthorText,
    bool HasAuthor,
    string Message,
    string AutomationName);

/// <summary>One status choice for the append-form status dropdown — null value keeps the current status.</summary>
/// <param name="Value">The lifecycle status to switch to, or null for "keep current status".</param>
/// <param name="Label">The localized option label (web option labels).</param>
public sealed record IncidentTimelineStatusOption(IncidentStatus? Value, string Label);

/// <summary>
/// The fully render-ready projection of the post-mortem page — every visible string resolved through the i18n
/// facade and every branch decided here so the WinUI view is a thin renderer. Pure data so the whole surface is
/// asserted headlessly.
/// </summary>
public sealed record IncidentTimelineDisplay(
    IncidentTimelineState State,
    string Title,
    string Subtitle,
    bool IsLoading,
    string BackLabel,
    string BackToStatusLabel,
    string NotFoundText,
    string SeverityGlyph,
    StatusKind SeverityTone,
    string SeverityLabel,
    string StatusText,
    StatusKind StatusTone,
    string SourceText,
    bool HasSource,
    string DurationBadgeText,
    StatusKind DurationBadgeTone,
    bool HasDescription,
    string Description,
    bool HasAffects,
    string AffectsText,
    string MetaText,
    bool IsResolved,
    string ResolveLabel,
    string TimelineTitle,
    string EntriesText,
    IReadOnlyList<IncidentTimelineRow> Rows,
    string AddUpdateTitle,
    string MessageHint,
    IReadOnlyList<IncidentTimelineStatusOption> StatusOptions,
    string AddLabel,
    string AddingLabel,
    string ConfirmTitle,
    string ConfirmMessage,
    string ConfirmLabel,
    string CancelLabel,
    string AutomationName);

/// <summary>
/// Pure projections for the post-mortem page — the native analogue of the web component's tone tables
/// (<c>SEVERITY_TONE</c> / <c>STATUS_BADGE</c> / <c>STATUS_LABEL</c>), its <c>fmtDuration</c> helper, the timeline
/// reversal, the status-option list and the not-found copy. Every user-visible string flows through the i18n
/// facade so the projection is unit-tested headlessly and the view-model never resolves a literal.
/// </summary>
public static class IncidentTimelineProjection
{
    private const long MinuteSeconds = 60;
    private const long HourSeconds = 3600;
    private const long DaySeconds = 86400;

    /// <summary>Project the model into the render-ready display, formatting timestamps against <paramref name="now"/>.</summary>
    public static IncidentTimelineDisplay Project(
        IncidentTimelineModel model,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string back = localizer.GetString(IncidentTimelineStrings.Back, "Back");
        string backToStatus = localizer.GetString(IncidentTimelineStrings.BackToStatus, "Back to System Status");
        var statusOptions = BuildStatusOptions(model.Incident?.Status ?? IncidentStatus.Investigating, localizer);
        string addUpdateTitle = localizer.GetString(IncidentTimelineStrings.AddUpdate, "Add update");
        string messageHint = localizer.GetString(
            IncidentTimelineStrings.MessageHint,
            "What\u2019s new? Investigation step, mitigation applied, hypothesis\u2026");
        string addLabel = localizer.GetString(IncidentTimelineStrings.Add, "Add update");
        string addingLabel = localizer.GetString(IncidentTimelineStrings.Adding, "Adding\u2026");
        string confirmTitle = localizer.GetString(IncidentTimelineStrings.ConfirmTitle, "Resolve incident?");
        string confirmMessage = localizer.GetString(
            IncidentTimelineStrings.ConfirmMessage,
            "This will close the incident and stamp resolved_at. You can still view the timeline.");
        string resolveLabel = localizer.GetString(IncidentTimelineStrings.Resolve, "Resolve");
        string cancelLabel = localizer.GetString(IncidentTimelineStrings.Cancel, "Cancel");

        if (model.Loading && model.Incident is null)
        {
            return Shell(
                IncidentTimelineState.Loading,
                localizer.GetString(IncidentTimelineStrings.Title, "Incident"),
                localizer.GetString(IncidentTimelineStrings.LoadingSubtitle, "Loading\u2026"),
                isLoading: true,
                back,
                backToStatus,
                notFoundText: string.Empty,
                statusOptions,
                addUpdateTitle,
                messageHint,
                addLabel,
                addingLabel,
                confirmTitle,
                confirmMessage,
                resolveLabel,
                cancelLabel,
                automationName: localizer.GetString(IncidentTimelineStrings.Title, "Incident"));
        }

        if (model.Incident is not { } incident)
        {
            string notFound = localizer
                .GetString(IncidentTimelineStrings.NotFound, "Incident {{id}} not found or you don\u2019t have access.")
                .Replace("{{id}}", model.IncidentId.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal);

            return Shell(
                IncidentTimelineState.NotFound,
                localizer.GetString(IncidentTimelineStrings.Title, "Incident"),
                localizer.GetString(IncidentTimelineStrings.NotFoundSubtitle, "Not found"),
                isLoading: false,
                back,
                backToStatus,
                notFound,
                statusOptions,
                addUpdateTitle,
                messageHint,
                addLabel,
                addingLabel,
                confirmTitle,
                confirmMessage,
                resolveLabel,
                cancelLabel,
                automationName: localizer.GetString(IncidentTimelineStrings.NotFoundSubtitle, "Not found"));
        }

        string title = string.IsNullOrWhiteSpace(incident.Title)
            ? localizer.GetString(IncidentTimelineStrings.Title, "Incident")
            : incident.Title;
        string subtitle = localizer
            .GetString(IncidentTimelineStrings.IncidentNumber, "Incident #{{id}}")
            .Replace("{{id}}", incident.Id.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal);

        string statusText = StatusLabel(incident.Status, localizer);
        string severityLabel = SeverityLabel(incident.Severity, localizer);
        string durationText = DurationBadge(incident, localizer, now);
        var rows = BuildRows(incident.Updates, localizer, now);
        string entriesText = localizer
            .GetString(IncidentTimelineStrings.Entries, "{{count}} entries")
            .Replace("{{count}}", rows.Count.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal);
        string affectsText = incident.AffectedComponents.Count > 0
            ? localizer
                .GetString(IncidentTimelineStrings.Affects, "Affects: {{components}}")
                .Replace(
                    "{{components}}",
                    string.Join(", ", incident.AffectedComponents),
                    StringComparison.Ordinal)
            : string.Empty;

        return new IncidentTimelineDisplay(
            State: IncidentTimelineState.Ready,
            Title: title,
            Subtitle: subtitle,
            IsLoading: false,
            BackLabel: back,
            BackToStatusLabel: backToStatus,
            NotFoundText: string.Empty,
            SeverityGlyph: SeverityGlyph(incident.Severity),
            SeverityTone: SeverityTone(incident.Severity),
            SeverityLabel: severityLabel,
            StatusText: statusText,
            StatusTone: StatusTone(incident.Status),
            SourceText: incident.Source,
            HasSource: !string.IsNullOrWhiteSpace(incident.Source),
            DurationBadgeText: durationText,
            DurationBadgeTone: incident.IsResolved ? StatusKind.Success : StatusKind.Neutral,
            HasDescription: !string.IsNullOrWhiteSpace(incident.Description),
            Description: incident.Description,
            HasAffects: incident.AffectedComponents.Count > 0,
            AffectsText: affectsText,
            MetaText: MetaLine(incident, localizer, now),
            IsResolved: incident.IsResolved,
            ResolveLabel: resolveLabel,
            TimelineTitle: localizer.GetString(IncidentTimelineStrings.Timeline, "Timeline"),
            EntriesText: entriesText,
            Rows: rows,
            AddUpdateTitle: addUpdateTitle,
            MessageHint: messageHint,
            StatusOptions: statusOptions,
            AddLabel: addLabel,
            AddingLabel: addingLabel,
            ConfirmTitle: confirmTitle,
            ConfirmMessage: confirmMessage,
            ConfirmLabel: resolveLabel,
            CancelLabel: cancelLabel,
            AutomationName: title);
    }

    /// <summary>The semantic badge tone for a lifecycle status — the native port of the web <c>STATUS_BADGE</c> map.</summary>
    public static StatusKind StatusTone(IncidentStatus status) => status switch
    {
        IncidentStatus.Investigating => StatusKind.Danger,
        IncidentStatus.Identified => StatusKind.Warning,
        IncidentStatus.Monitoring => StatusKind.Info,
        IncidentStatus.Resolved => StatusKind.Success,
        _ => StatusKind.Neutral,
    };

    /// <summary>The localized status label — the native port of the web <c>STATUS_LABEL</c> map (shared incident keys).</summary>
    public static string StatusLabel(IncidentStatus status, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return status switch
        {
            IncidentStatus.Investigating =>
                localizer.GetString(IncidentTimelineStrings.StatusInvestigating, "Investigating"),
            IncidentStatus.Identified =>
                localizer.GetString(IncidentTimelineStrings.StatusIdentified, "Identified"),
            IncidentStatus.Monitoring =>
                localizer.GetString(IncidentTimelineStrings.StatusMonitoring, "Monitoring"),
            IncidentStatus.Resolved =>
                localizer.GetString(IncidentTimelineStrings.StatusResolved, "Resolved"),
            _ => localizer.GetString(IncidentTimelineStrings.StatusInvestigating, "Investigating"),
        };
    }

    /// <summary>The semantic tone tinting the severity glyph — the native port of the web <c>SEVERITY_TONE</c> map.</summary>
    public static StatusKind SeverityTone(IncidentSeverity severity) => severity switch
    {
        IncidentSeverity.Minor => StatusKind.Warning,
        IncidentSeverity.Major => StatusKind.Warning,
        IncidentSeverity.Critical => StatusKind.Danger,
        _ => StatusKind.Warning,
    };

    /// <summary>The Segoe Fluent glyph standing in for the web Lucide severity icon (mirrors IncidentsProjection).</summary>
    public static string SeverityGlyph(IncidentSeverity severity) => severity switch
    {
        IncidentSeverity.Minor => "\uEA39",     // ErrorBadge — web AlertCircle
        IncidentSeverity.Major => "\uE7BA",     // Warning — web AlertTriangle
        IncidentSeverity.Critical => "\uE730",  // Blocked — web AlertOctagon
        _ => "\uEA39",
    };

    /// <summary>The localized severity label (shared incident severity keys).</summary>
    public static string SeverityLabel(IncidentSeverity severity, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return severity switch
        {
            IncidentSeverity.Minor => localizer.GetString(IncidentTimelineStrings.SeverityMinor, "Minor"),
            IncidentSeverity.Major => localizer.GetString(IncidentTimelineStrings.SeverityMajor, "Major"),
            IncidentSeverity.Critical => localizer.GetString(IncidentTimelineStrings.SeverityCritical, "Critical"),
            _ => localizer.GetString(IncidentTimelineStrings.SeverityMinor, "Minor"),
        };
    }

    /// <summary>
    /// The compact open / closed duration string — the native port of the web <c>fmtDuration</c> helper
    /// (<c>{s}s</c> / <c>{m}m</c> / <c>{h}h {m}m</c> / <c>{d}d {h}h</c>). A null start yields an empty string.
    /// </summary>
    public static string FormatDuration(DateTimeOffset? start, DateTimeOffset? end, DateTimeOffset now)
    {
        if (start is not { } s)
        {
            return string.Empty;
        }

        DateTimeOffset e = end ?? now;
        long secs = Math.Max(0, (long)Math.Floor((e - s).TotalSeconds));
        if (secs < MinuteSeconds)
        {
            return string.Create(CultureInfo.CurrentCulture, $"{secs}s");
        }

        if (secs < HourSeconds)
        {
            return string.Create(CultureInfo.CurrentCulture, $"{secs / MinuteSeconds}m");
        }

        if (secs < DaySeconds)
        {
            return string.Create(
                CultureInfo.CurrentCulture, $"{secs / HourSeconds}h {secs % HourSeconds / MinuteSeconds}m");
        }

        return string.Create(
            CultureInfo.CurrentCulture, $"{secs / DaySeconds}d {secs % DaySeconds / HourSeconds}h");
    }

    /// <summary>The append-form status options — "keep current status" plus the four lifecycle targets (web order).</summary>
    public static IReadOnlyList<IncidentTimelineStatusOption> BuildStatusOptions(
        IncidentStatus current,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string keep = localizer
            .GetString(IncidentTimelineStrings.KeepStatus, "Keep status as {{status}}")
            .Replace("{{status}}", StatusLabel(current, localizer), StringComparison.Ordinal);

        return new[]
        {
            new IncidentTimelineStatusOption(null, keep),
            new IncidentTimelineStatusOption(
                IncidentStatus.Investigating,
                localizer.GetString(IncidentTimelineStrings.ToInvestigating, "\u2192 Investigating")),
            new IncidentTimelineStatusOption(
                IncidentStatus.Identified,
                localizer.GetString(IncidentTimelineStrings.ToIdentified, "\u2192 Identified")),
            new IncidentTimelineStatusOption(
                IncidentStatus.Monitoring,
                localizer.GetString(IncidentTimelineStrings.ToMonitoring, "\u2192 Monitoring")),
            new IncidentTimelineStatusOption(
                IncidentStatus.Resolved,
                localizer.GetString(IncidentTimelineStrings.ToResolved, "\u2192 Resolved")),
        };
    }

    /// <summary>Project the timeline rows newest-first (web <c>[...updates].reverse()</c>).</summary>
    public static IReadOnlyList<IncidentTimelineRow> BuildRows(
        IReadOnlyList<IncidentUpdateItem> updates,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(updates);
        ArgumentNullException.ThrowIfNull(localizer);

        var rows = new List<IncidentTimelineRow>(updates.Count);
        for (int i = updates.Count - 1; i >= 0; i--)
        {
            var update = updates[i];
            string statusText = StatusLabel(update.Status, localizer);
            string timestamp = DateTimeFormatting.Format(update.At, DateTimeVariant.Full, now);
            bool hasAuthor = !string.IsNullOrWhiteSpace(update.Author);
            string authorText = hasAuthor
                ? string.Create(CultureInfo.CurrentCulture, $"\u00b7 {update.Author}")
                : string.Empty;
            string automation = string.Join(
                " \u2014 ",
                new[] { statusText, timestamp, update.Author, update.Message }
                    .Where(static part => !string.IsNullOrWhiteSpace(part)));

            rows.Add(new IncidentTimelineRow(
                statusText,
                StatusTone(update.Status),
                timestamp,
                authorText,
                hasAuthor,
                update.Message,
                automation));
        }

        return rows;
    }

    private static string DurationBadge(IncidentDetail incident, ILocalizer localizer, DateTimeOffset now)
    {
        string duration = FormatDuration(
            incident.StartedAt,
            incident.IsResolved ? incident.ResolvedAt : null,
            now);

        string template = incident.IsResolved
            ? localizer.GetString(IncidentTimelineStrings.ResolvedBadge, "Resolved \u00b7 {{duration}}")
            : localizer.GetString(IncidentTimelineStrings.OpenBadge, "Open \u00b7 {{duration}}");

        return template.Replace("{{duration}}", duration, StringComparison.Ordinal);
    }

    private static string MetaLine(IncidentDetail incident, ILocalizer localizer, DateTimeOffset now)
    {
        string started = localizer
            .GetString(IncidentTimelineStrings.Started, "Started {{when}}")
            .Replace(
                "{{when}}",
                DateTimeFormatting.Format(incident.StartedAt, DateTimeVariant.Full, now),
                StringComparison.Ordinal);

        if (incident.ResolvedAt is { } resolvedAt)
        {
            string resolved = localizer
                .GetString(IncidentTimelineStrings.ResolvedMeta, "\u00b7 Resolved {{when}}")
                .Replace(
                    "{{when}}",
                    DateTimeFormatting.Format(resolvedAt, DateTimeVariant.Full, now),
                    StringComparison.Ordinal);
            return string.Create(CultureInfo.CurrentCulture, $"{started} {resolved}");
        }

        return started;
    }

    private static IncidentTimelineDisplay Shell(
        IncidentTimelineState state,
        string title,
        string subtitle,
        bool isLoading,
        string back,
        string backToStatus,
        string notFoundText,
        IReadOnlyList<IncidentTimelineStatusOption> statusOptions,
        string addUpdateTitle,
        string messageHint,
        string addLabel,
        string addingLabel,
        string confirmTitle,
        string confirmMessage,
        string resolveLabel,
        string cancelLabel,
        string automationName) =>
        new(
            State: state,
            Title: title,
            Subtitle: subtitle,
            IsLoading: isLoading,
            BackLabel: back,
            BackToStatusLabel: backToStatus,
            NotFoundText: notFoundText,
            SeverityGlyph: string.Empty,
            SeverityTone: StatusKind.Neutral,
            SeverityLabel: string.Empty,
            StatusText: string.Empty,
            StatusTone: StatusKind.Neutral,
            SourceText: string.Empty,
            HasSource: false,
            DurationBadgeText: string.Empty,
            DurationBadgeTone: StatusKind.Neutral,
            HasDescription: false,
            Description: string.Empty,
            HasAffects: false,
            AffectsText: string.Empty,
            MetaText: string.Empty,
            IsResolved: false,
            ResolveLabel: resolveLabel,
            TimelineTitle: string.Empty,
            EntriesText: string.Empty,
            Rows: Array.Empty<IncidentTimelineRow>(),
            AddUpdateTitle: addUpdateTitle,
            MessageHint: messageHint,
            StatusOptions: statusOptions,
            AddLabel: addLabel,
            AddingLabel: addingLabel,
            ConfirmTitle: confirmTitle,
            ConfirmMessage: confirmMessage,
            ConfirmLabel: resolveLabel,
            CancelLabel: cancelLabel,
            AutomationName: automationName);
}

/// <summary>
/// The i18n key catalog for the post-mortem page — the native anchor for every literal the web page ships
/// (web/src/features/system/pages/IncidentTimelinePage.tsx). Lifecycle status and severity labels reuse the
/// shared <c>status.incidents.*</c> keys (single-sourced with IncidentForm / IncidentsCard); page-specific copy
/// is keyed under <c>status.incidentTimeline.*</c>. Each English fallback doubles as the literal the web renders.
/// </summary>
public static class IncidentTimelineStrings
{
    /// <summary>Page title fallback when the incident is unknown (web <c>title="Incident"</c>).</summary>
    public const string Title = "status.incidentTimeline.title";

    /// <summary>Loading subtitle (web <c>subtitle="Loading…"</c>).</summary>
    public const string LoadingSubtitle = "status.incidentTimeline.loadingSubtitle";

    /// <summary>Not-found subtitle (web <c>subtitle="Not found"</c>).</summary>
    public const string NotFoundSubtitle = "status.incidentTimeline.notFoundSubtitle";

    /// <summary>Not-found body (web "Incident {id} not found or you don't have access.").</summary>
    public const string NotFound = "status.incidentTimeline.notFound";

    /// <summary>Per-incident subtitle (web "Incident #{id}").</summary>
    public const string IncidentNumber = "status.incidentTimeline.number";

    /// <summary>Back action label (web "Back").</summary>
    public const string Back = "status.incidentTimeline.back";

    /// <summary>Back-to-status link label (web "Back to System Status").</summary>
    public const string BackToStatus = "status.incidentTimeline.backToStatus";

    /// <summary>Open duration badge template (web "Open · {duration}").</summary>
    public const string OpenBadge = "status.incidentTimeline.openBadge";

    /// <summary>Resolved duration badge template (web "Resolved · {duration}").</summary>
    public const string ResolvedBadge = "status.incidentTimeline.resolvedBadge";

    /// <summary>Affected-components line template (web "Affects: …").</summary>
    public const string Affects = "status.incidentTimeline.affects";

    /// <summary>Started meta template (web "Started {when}").</summary>
    public const string Started = "status.incidentTimeline.started";

    /// <summary>Resolved meta suffix template (web "· Resolved {when}").</summary>
    public const string ResolvedMeta = "status.incidentTimeline.resolvedMeta";

    /// <summary>Resolve button label (web "Resolve").</summary>
    public const string Resolve = "status.incidentTimeline.resolve";

    /// <summary>Timeline heading (web "Timeline").</summary>
    public const string Timeline = "status.incidentTimeline.timeline";

    /// <summary>Timeline entry-count suffix template (web "{n} entries").</summary>
    public const string Entries = "status.incidentTimeline.entries";

    /// <summary>Append-form heading (web "Add update").</summary>
    public const string AddUpdate = "status.incidentTimeline.addUpdate";

    /// <summary>Append-form message hint (web textarea prompt copy).</summary>
    public const string MessageHint = "status.incidentTimeline.messageHint";

    /// <summary>Append submit label, idle (web "Add update").</summary>
    public const string Add = "status.incidentTimeline.add";

    /// <summary>Append submit label, busy (web "Adding…").</summary>
    public const string Adding = "status.incidentTimeline.adding";

    /// <summary>"Keep current status" option template (web "Keep status as {label}").</summary>
    public const string KeepStatus = "status.incidentTimeline.keepStatus";

    /// <summary>"→ Investigating" status option (web option label).</summary>
    public const string ToInvestigating = "status.incidentTimeline.toInvestigating";

    /// <summary>"→ Identified" status option (web option label).</summary>
    public const string ToIdentified = "status.incidentTimeline.toIdentified";

    /// <summary>"→ Monitoring" status option (web option label).</summary>
    public const string ToMonitoring = "status.incidentTimeline.toMonitoring";

    /// <summary>"→ Resolved" status option (web option label).</summary>
    public const string ToResolved = "status.incidentTimeline.toResolved";

    /// <summary>Resolve confirm-dialog title (web "Resolve incident?").</summary>
    public const string ConfirmTitle = "status.incidentTimeline.confirmTitle";

    /// <summary>Resolve confirm-dialog message (web confirm copy).</summary>
    public const string ConfirmMessage = "status.incidentTimeline.confirmMessage";

    /// <summary>Cancel button label (web "Cancel").</summary>
    public const string Cancel = "status.incidentTimeline.cancel";

    /// <summary>Toast: empty append message (web "Update message is required.").</summary>
    public const string MessageRequired = "status.incidentTimeline.messageRequired";

    /// <summary>Toast: append succeeded (web "Update added.").</summary>
    public const string UpdateAdded = "status.incidentTimeline.updateAdded";

    /// <summary>Toast: append failed fallback (web "Failed to append update").</summary>
    public const string AppendFailed = "status.incidentTimeline.appendFailed";

    /// <summary>Toast: resolve succeeded (web "Incident resolved.").</summary>
    public const string IncidentResolved = "status.incidentTimeline.incidentResolved";

    /// <summary>Toast: resolve failed fallback (web "Failed to resolve").</summary>
    public const string ResolveFailed = "status.incidentTimeline.resolveFailed";

    /// <summary>Investigating status label (shared incident key).</summary>
    public const string StatusInvestigating = "status.incidents.status.investigating";

    /// <summary>Identified status label (shared incident key).</summary>
    public const string StatusIdentified = "status.incidents.status.identified";

    /// <summary>Monitoring status label (shared incident key).</summary>
    public const string StatusMonitoring = "status.incidents.status.monitoring";

    /// <summary>Resolved status label (shared incident key).</summary>
    public const string StatusResolved = "status.incidents.status.resolved";

    /// <summary>Minor severity label (shared incident key).</summary>
    public const string SeverityMinor = "status.incidents.severity.minor";

    /// <summary>Major severity label (shared incident key).</summary>
    public const string SeverityMajor = "status.incidents.severity.major";

    /// <summary>Critical severity label (shared incident key).</summary>
    public const string SeverityCritical = "status.incidents.severity.critical";

    /// <summary>Every key the surface resolves — asserted in tests as the i18n catalog.</summary>
    public static IReadOnlyList<string> AllKeys => new[]
    {
        Title,
        LoadingSubtitle,
        NotFoundSubtitle,
        NotFound,
        IncidentNumber,
        Back,
        BackToStatus,
        OpenBadge,
        ResolvedBadge,
        Affects,
        Started,
        ResolvedMeta,
        Resolve,
        Timeline,
        Entries,
        AddUpdate,
        MessageHint,
        Add,
        Adding,
        KeepStatus,
        ToInvestigating,
        ToIdentified,
        ToMonitoring,
        ToResolved,
        ConfirmTitle,
        ConfirmMessage,
        Cancel,
        MessageRequired,
        UpdateAdded,
        AppendFailed,
        IncidentResolved,
        ResolveFailed,
        StatusInvestigating,
        StatusIdentified,
        StatusMonitoring,
        StatusResolved,
        SeverityMinor,
        SeverityMajor,
        SeverityCritical,
    };
}

/// <summary>
/// Canonical metadata for the post-mortem page — the diagnostics <see cref="Slug"/> emitted with the
/// <c>view.opened</c> event (P1/S11), the generated incident operation ids the source binds (web's three hooks),
/// the route path-parameter name and the validation bounds the append form enforces (web <c>maxLength</c>).
/// </summary>
public static class IncidentTimelineRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "IncidentTimelinePage";

    /// <summary>The web page this surface mirrors.</summary>
    public const string WebSource = "features/system/pages/IncidentTimelinePage.tsx";

    /// <summary>The route name the shell registers this page under (RouteTable <c>IncidentTimeline</c>).</summary>
    public const string RouteName = "IncidentTimeline";

    /// <summary>The route path-parameter carrying the incident id (web <c>:id</c>).</summary>
    public const string IdParam = "id";

    /// <summary>The generated operation id for <c>GET /status/incidents/{id}</c> (web <c>useIncident</c>).</summary>
    public const string FetchOperation = "get_api_v1_status_incidents_id";

    /// <summary>The generated operation id for <c>POST /status/incidents/{id}/updates</c> (web <c>useAppendIncidentUpdate</c>).</summary>
    public const string AppendOperation = "post_api_v1_status_incidents_id_updates";

    /// <summary>The generated operation id for <c>PATCH /status/incidents/{id}</c> (web <c>usePatchIncident</c>).</summary>
    public const string PatchOperation = "patch_api_v1_status_incidents_id";

    /// <summary>Maximum append-message length (web <c>maxLength={4000}</c> and the Go <c>IncidentMessageMaxLen</c>).</summary>
    public const int MessageMaxLength = 4000;

    /// <summary>Segoe Fluent "Back" glyph for the back affordance (web ArrowLeft).</summary>
    public const string BackGlyph = "\uE72B";

    /// <summary>Segoe Fluent "Completed" glyph for the resolve affordance (web CheckCircle2).</summary>
    public const string ResolveGlyph = "\uE930";

    /// <summary>Segoe Fluent "Message" glyph for the timeline heading (web MessageSquare).</summary>
    public const string TimelineGlyph = "\uE8BD";

    /// <summary>Segoe Fluent "Clock" glyph for the started-at meta line (web Clock).</summary>
    public const string ClockGlyph = "\uE823";
}

/// <summary>
/// PII-safe diagnostics for the post-mortem page (P1/S11). Records only operational counters with the surface
/// slug — never the incident title, description, components or update bodies — so a diagnostics line can never
/// leak incident content. Thread-safe.
/// </summary>
public sealed class IncidentTimelineDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _updatesAppended;
    private long _incidentsResolved;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public IncidentTimelineDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of updates appended from this surface.</summary>
    public long UpdatesAppended => Interlocked.Read(ref _updatesAppended);

    /// <summary>Number of incidents resolved from this surface.</summary>
    public long IncidentsResolved => Interlocked.Read(ref _incidentsResolved);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=IncidentTimelinePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        Emit("view.opened");
    }

    /// <summary>Record that an update was appended (the message body is never logged).</summary>
    public void RecordUpdateAppended()
    {
        Interlocked.Increment(ref _updatesAppended);
        Emit("status.incident.update.appended");
    }

    /// <summary>Record that the incident was resolved.</summary>
    public void RecordIncidentResolved()
    {
        Interlocked.Increment(ref _incidentsResolved);
        Emit("status.incident.resolved");
    }

    private void Emit(string @event) =>
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"{@event} slug={IncidentTimelineRegistration.Slug}"));
}
