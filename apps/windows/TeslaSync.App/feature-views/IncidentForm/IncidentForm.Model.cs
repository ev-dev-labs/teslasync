using System.Globalization;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Incident severity — the native mirror of the web <c>IncidentSeverity</c> union
/// (<c>'minor' | 'major' | 'critical'</c>, web/src/api/hooks/useIncidents.ts). The wire form is the
/// lower-case token the Go API validates (<c>ValidateIncidentSeverity</c>).
/// </summary>
public enum IncidentSeverity
{
    /// <summary>A low-impact incident (web <c>minor</c>) — the form default.</summary>
    Minor,

    /// <summary>A partial-degradation incident (web <c>major</c>).</summary>
    Major,

    /// <summary>A full-outage incident (web <c>critical</c>).</summary>
    Critical,
}

/// <summary>
/// Incident lifecycle status — the native mirror of the web <c>IncidentStatus</c> union
/// (<c>'investigating' | 'identified' | 'monitoring' | 'resolved'</c>). The wire form is the lower-case
/// token the Go API validates (<c>ValidateIncidentStatus</c>).
/// </summary>
public enum IncidentStatus
{
    /// <summary>Cause not yet known (web <c>investigating</c>) — the form default.</summary>
    Investigating,

    /// <summary>Cause identified, fix pending (web <c>identified</c>).</summary>
    Identified,

    /// <summary>Fix applied, watching for recovery (web <c>monitoring</c>).</summary>
    Monitoring,

    /// <summary>Incident closed (web <c>resolved</c>).</summary>
    Resolved,
}

/// <summary>Wire mapping for <see cref="IncidentSeverity"/> — UI-free so it is asserted headlessly.</summary>
public static class IncidentSeverities
{
    /// <summary>The lower-case API token for <paramref name="severity"/>.</summary>
    public static string ToWire(IncidentSeverity severity) => severity switch
    {
        IncidentSeverity.Minor => "minor",
        IncidentSeverity.Major => "major",
        IncidentSeverity.Critical => "critical",
        _ => "minor",
    };

    /// <summary>Parse an API token back to a <see cref="IncidentSeverity"/>; false for an unknown token.</summary>
    public static bool TryFromWire(string? wire, out IncidentSeverity severity)
    {
        switch (wire)
        {
            case "minor":
                severity = IncidentSeverity.Minor;
                return true;
            case "major":
                severity = IncidentSeverity.Major;
                return true;
            case "critical":
                severity = IncidentSeverity.Critical;
                return true;
            default:
                severity = IncidentSeverity.Minor;
                return false;
        }
    }
}

/// <summary>Wire mapping for <see cref="IncidentStatus"/> — UI-free so it is asserted headlessly.</summary>
public static class IncidentStatuses
{
    /// <summary>The lower-case API token for <paramref name="status"/>.</summary>
    public static string ToWire(IncidentStatus status) => status switch
    {
        IncidentStatus.Investigating => "investigating",
        IncidentStatus.Identified => "identified",
        IncidentStatus.Monitoring => "monitoring",
        IncidentStatus.Resolved => "resolved",
        _ => "investigating",
    };

    /// <summary>Parse an API token back to a <see cref="IncidentStatus"/>; false for an unknown token.</summary>
    public static bool TryFromWire(string? wire, out IncidentStatus status)
    {
        switch (wire)
        {
            case "investigating":
                status = IncidentStatus.Investigating;
                return true;
            case "identified":
                status = IncidentStatus.Identified;
                return true;
            case "monitoring":
                status = IncidentStatus.Monitoring;
                return true;
            case "resolved":
                status = IncidentStatus.Resolved;
                return true;
            default:
                status = IncidentStatus.Investigating;
                return false;
        }
    }
}

/// <summary>
/// The <c>POST /api/v1/status/incidents</c> request body — the native mirror of the web
/// <c>CreateIncidentPayload</c> the form fills (web/src/features/system/components/status/IncidentForm.tsx
/// → <c>useCreateIncident</c>). Every property carries an explicit snake_case <see cref="JsonPropertyNameAttribute"/>
/// so the wire shape matches the Go <c>IncidentCreatePayload</c> regardless of the shared serializer's naming
/// policy. <see cref="InitialMessage"/> is omitted when null (web <c>initial_message: … || undefined</c>);
/// <see cref="AffectedComponents"/> is always sent, even when empty.
/// </summary>
public sealed record IncidentCreateRequest(
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("severity")] string Severity,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("affected_components")] IReadOnlyList<string> AffectedComponents,
    [property: JsonPropertyName("initial_message")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? InitialMessage);

/// <summary>One severity choice for the severity dropdown (value + localized label).</summary>
public sealed record IncidentSeverityOption(IncidentSeverity Value, string Label);

/// <summary>One status choice for the status dropdown (value + localized label).</summary>
public sealed record IncidentStatusOption(IncidentStatus Value, string Label);

/// <summary>
/// A localized transient message for the toast surface — the native analogue of the web <c>useToast</c>
/// <c>toast.success</c> / <c>toast.error</c> calls. <see cref="IsError"/> selects the error vs. success
/// presentation.
/// </summary>
public sealed record IncidentFormToast(string Message, bool IsError);

/// <summary>
/// The outcome of a single create attempt — the native analogue of the web <c>useCreateIncident</c> mutation
/// resolving. On success it carries no payload (the form just closes); on an HTTP fault it carries a classified
/// <see cref="Error"/> rather than throwing (web parity: the mutation resolves to a toast, never an unhandled
/// rejection).
/// </summary>
public sealed record IncidentFormSubmitOutcome(bool Success, RepositoryError? Error)
{
    /// <summary>A successful create.</summary>
    public static IncidentFormSubmitOutcome Ok() => new(true, null);

    /// <summary>A classified failure.</summary>
    public static IncidentFormSubmitOutcome Fail(RepositoryError error) => new(false, error);
}

/// <summary>
/// Canonical metadata, validation bounds, Segoe Fluent glyphs and i18n keys for the <c>IncidentForm</c>
/// surface — the native mirror of <c>web/src/features/system/components/status/IncidentForm.tsx</c>. The web
/// component ships literal copy; every literal is keyed here (with that literal as the English fallback) so the
/// native view and view-model stay free of inline strings and resolve through the i18n facade. UI-free so every
/// key + bound is asserted in tests.
/// </summary>
public static class IncidentFormRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "IncidentForm";

    /// <summary>Minimum trimmed title length enforced client-side (web <c>t.length &lt; 3</c>) and by the API.</summary>
    public const int TitleMinLength = 3;

    /// <summary>Maximum title length (web <c>maxLength={200}</c> and the Go <c>IncidentTitleMaxLen</c>).</summary>
    public const int TitleMaxLength = 200;

    /// <summary>Maximum initial-message length (web <c>maxLength={4000}</c> and the Go <c>IncidentMessageMaxLen</c>).</summary>
    public const int MessageMaxLength = 4000;

    /// <summary>Segoe Fluent "ReportDocument" glyph standing in for the web modal's incident icon.</summary>
    public const string Glyph = "\uE7C3";

    /// <summary>Segoe Fluent "ErrorBadge" glyph for the inline / toast failure line (the web error toast).</summary>
    public const string ErrorGlyph = "\uEA39";

    /// <summary>Segoe Fluent "Completed" glyph for the success toast (the web success toast).</summary>
    public const string SuccessGlyph = "\uE930";

    /// <summary>The severity values in web render order (minor, major, critical).</summary>
    public static IReadOnlyList<IncidentSeverity> SeverityOrder { get; } =
    [
        IncidentSeverity.Minor,
        IncidentSeverity.Major,
        IncidentSeverity.Critical,
    ];

    /// <summary>The status values in web render order (investigating, identified, monitoring, resolved).</summary>
    public static IReadOnlyList<IncidentStatus> StatusOrder { get; } =
    [
        IncidentStatus.Investigating,
        IncidentStatus.Identified,
        IncidentStatus.Monitoring,
        IncidentStatus.Resolved,
    ];

    /// <summary>Modal title (web <c>title="Log an incident"</c>).</summary>
    public static string ModalTitle(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.title", "Log an incident");

    /// <summary>Title field label (web <c>Title</c>).</summary>
    public static string TitleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.titleLabel", "Title");

    /// <summary>Title field prompt (web <c>prompt</c>).</summary>
    public static string TitlePrompt(ILocalizer localizer) =>
        Require(localizer).GetString(
            "status.incidents.form.titlePrompt", "e.g. Wall connector restart at 14:00");

    /// <summary>Severity field label (web <c>Severity</c>).</summary>
    public static string SeverityLabel(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.severityLabel", "Severity");

    /// <summary>Status field label (web <c>Status</c>).</summary>
    public static string StatusLabel(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.statusLabel", "Status");

    /// <summary>Affected-components field label (web <c>Affected components</c>).</summary>
    public static string ComponentsLabel(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.componentsLabel", "Affected components");

    /// <summary>Affected-components helper note (web <c>(comma-separated, optional)</c>).</summary>
    public static string ComponentsHint(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.componentsHint", "(comma-separated, optional)");

    /// <summary>Affected-components prompt (web <c>prompt</c>).</summary>
    public static string ComponentsPrompt(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.componentsPrompt", "e.g. tesla, telemetry");

    /// <summary>Initial-message field label (web <c>Initial timeline message</c>).</summary>
    public static string MessageLabel(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.messageLabel", "Initial timeline message");

    /// <summary>Initial-message helper note (web <c>(optional)</c>).</summary>
    public static string MessageHint(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.messageHint", "(optional)");

    /// <summary>Initial-message prompt (web <c>prompt</c>).</summary>
    public static string MessagePrompt(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.messagePrompt", "What\u2019s the situation?");

    /// <summary>Cancel button label (web <c>Cancel</c>).</summary>
    public static string CancelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.cancel", "Cancel");

    /// <summary>Submit button label, idle (web <c>Log incident</c>).</summary>
    public static string SubmitLabel(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.submit", "Log incident");

    /// <summary>Submit button label, busy (web <c>Logging\u2026</c>).</summary>
    public static string SubmittingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.submitting", "Logging\u2026");

    /// <summary>Client-side title-too-short validation message (web <c>toast.error</c> copy).</summary>
    public static string TitleTooShortMessage(ILocalizer localizer) =>
        Require(localizer).GetString(
            "status.incidents.form.titleTooShort", "Title must be at least 3 characters.");

    /// <summary>Success toast (web <c>toast.success('Incident logged.')</c>).</summary>
    public static string SuccessMessage(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.success", "Incident logged.");

    /// <summary>Failure toast fallback (web <c>'Failed to log incident'</c>).</summary>
    public static string ErrorMessage(ILocalizer localizer) =>
        Require(localizer).GetString("status.incidents.form.error", "Failed to log incident");

    /// <summary>The localized label for a severity value (web option labels).</summary>
    public static string SeverityLabelFor(IncidentSeverity severity, ILocalizer localizer) => severity switch
    {
        IncidentSeverity.Minor => Require(localizer).GetString("status.incidents.severity.minor", "Minor"),
        IncidentSeverity.Major => Require(localizer).GetString("status.incidents.severity.major", "Major"),
        IncidentSeverity.Critical => Require(localizer).GetString("status.incidents.severity.critical", "Critical"),
        _ => Require(localizer).GetString("status.incidents.severity.minor", "Minor"),
    };

    /// <summary>The localized label for a status value (web option labels).</summary>
    public static string StatusLabelFor(IncidentStatus status, ILocalizer localizer) => status switch
    {
        IncidentStatus.Investigating =>
            Require(localizer).GetString("status.incidents.status.investigating", "Investigating"),
        IncidentStatus.Identified =>
            Require(localizer).GetString("status.incidents.status.identified", "Identified"),
        IncidentStatus.Monitoring =>
            Require(localizer).GetString("status.incidents.status.monitoring", "Monitoring"),
        IncidentStatus.Resolved =>
            Require(localizer).GetString("status.incidents.status.resolved", "Resolved"),
        _ => Require(localizer).GetString("status.incidents.status.investigating", "Investigating"),
    };

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>IncidentForm</c> surface — the native analogue of the web component's option
/// lists, comma-list parsing, client-side title validation and payload assembly. Every user-visible string
/// flows through the i18n facade so the projection is unit-tested headlessly and the view-model never resolves
/// a literal.
/// </summary>
public static class IncidentFormProjection
{
    /// <summary>The severity dropdown options in web render order with localized labels.</summary>
    public static IReadOnlyList<IncidentSeverityOption> SeverityOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var options = new List<IncidentSeverityOption>(IncidentFormRegistration.SeverityOrder.Count);
        foreach (var value in IncidentFormRegistration.SeverityOrder)
        {
            options.Add(new IncidentSeverityOption(value, IncidentFormRegistration.SeverityLabelFor(value, localizer)));
        }

        return options;
    }

    /// <summary>The status dropdown options in web render order with localized labels.</summary>
    public static IReadOnlyList<IncidentStatusOption> StatusOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var options = new List<IncidentStatusOption>(IncidentFormRegistration.StatusOrder.Count);
        foreach (var value in IncidentFormRegistration.StatusOrder)
        {
            options.Add(new IncidentStatusOption(value, IncidentFormRegistration.StatusLabelFor(value, localizer)));
        }

        return options;
    }

    /// <summary>The trimmed title (web <c>title.trim()</c>).</summary>
    public static string NormalizeTitle(string? title) => (title ?? string.Empty).Trim();

    /// <summary>True once the trimmed title meets the client-side minimum (web <c>t.length &gt;= 3</c>).</summary>
    public static bool IsTitleValid(string? title) =>
        NormalizeTitle(title).Length >= IncidentFormRegistration.TitleMinLength;

    /// <summary>
    /// Split a comma-separated component list into trimmed, non-empty tokens — the exact web transform
    /// (<c>components.split(',').map(trim).filter(Boolean)</c>).
    /// </summary>
    public static IReadOnlyList<string> ParseComponents(string? components)
    {
        if (string.IsNullOrWhiteSpace(components))
        {
            return Array.Empty<string>();
        }

        var result = new List<string>();
        foreach (var raw in components.Split(','))
        {
            string trimmed = raw.Trim();
            if (trimmed.Length > 0)
            {
                result.Add(trimmed);
            }
        }

        return result;
    }

    /// <summary>
    /// Assemble the create request from the current field values — the native analogue of the object the web
    /// passes to <c>create.mutateAsync</c>. The title is trimmed, the initial message is trimmed-or-null
    /// (omitted on the wire when empty) and the components are parsed into the affected-components array.
    /// </summary>
    public static IncidentCreateRequest BuildRequest(
        string? title,
        IncidentSeverity severity,
        IncidentStatus status,
        string? components,
        string? message)
    {
        string trimmedMessage = (message ?? string.Empty).Trim();
        return new IncidentCreateRequest(
            NormalizeTitle(title),
            IncidentSeverities.ToWire(severity),
            IncidentStatuses.ToWire(status),
            ParseComponents(components),
            trimmedMessage.Length > 0 ? trimmedMessage : null);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>IncidentForm</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never the incident title, components or message — so a
/// diagnostics line can never leak incident content. Thread-safe.
/// </summary>
public sealed class IncidentFormDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _incidentsLogged;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public IncidentFormDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of incidents successfully logged from this surface.</summary>
    public long IncidentsLogged => Interlocked.Read(ref _incidentsLogged);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=IncidentForm</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={IncidentFormRegistration.Slug}"));
    }

    /// <summary>Record that an incident was logged (the title / components are never logged).</summary>
    public void RecordIncidentLogged()
    {
        Interlocked.Increment(ref _incidentsLogged);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"status.incident.logged slug={IncidentFormRegistration.Slug}"));
    }
}
