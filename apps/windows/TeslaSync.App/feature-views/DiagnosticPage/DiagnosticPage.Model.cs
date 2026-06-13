using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.SystemDiagnostics;

/// <summary>
/// The mutually-exclusive top-level state of the <c>DiagnosticPage</c> surface — the native mirror of the data states
/// the web page renders (web/src/features/system/pages/DiagnosticPage.tsx). The web page runs the operator-initiated
/// <c>useRunDiagnostic</c> mutation (it never auto-runs) and renders, by precedence, the in-flight spinner
/// (<c>isRunning</c>), the resolved report (<c>report</c>) and otherwise the "no diagnostic run yet" empty surface.
/// A failed run is layered on top as a distinct error panel (see <see cref="DiagnosticDisplay.ShowError"/>) rather than
/// a separate top-level state, exactly as the web composes it.
/// </summary>
public enum DiagnosticState
{
    /// <summary>The diagnostic run is in flight (web <c>isRunning</c>) — the panel shows the busy spinner.</summary>
    Loading,

    /// <summary>No report has been produced this session (web <c>!report &amp;&amp; !isRunning</c>) — the empty surface.</summary>
    Empty,

    /// <summary>The run produced a report (web <c>report</c>) — the hero, actions and check cards render.</summary>
    Success,
}

/// <summary>
/// The health verdict of a single diagnostic check — the native mirror of the web <c>DiagnosticCheckStatus</c>
/// (<c>'ok' | 'warn' | 'fail'</c>). Unknown wire tokens collapse to <see cref="Fail"/>, matching the web's danger
/// fallthrough in <c>statusBadgeVariant</c> / <c>statusIcon</c>.
/// </summary>
public enum DiagnosticCheckStatus
{
    /// <summary>The check passed (web <c>'ok'</c>).</summary>
    Ok,

    /// <summary>The check passed with a warning (web <c>'warn'</c>).</summary>
    Warn,

    /// <summary>The check failed (web <c>'fail'</c>, plus the unknown-token fallthrough).</summary>
    Fail,
}

/// <summary>
/// The aggregate verdict of a diagnostic run — the native mirror of the web <c>DiagnosticOverallStatus</c>
/// (<c>'ok' | 'degraded' | 'down'</c>). Unknown wire tokens collapse to <see cref="Down"/>, matching the web's danger
/// fallthrough in <c>overallTone</c>.
/// </summary>
public enum DiagnosticOverallStatus
{
    /// <summary>All checks healthy (web <c>'ok'</c>).</summary>
    Ok,

    /// <summary>Some checks need attention (web <c>'degraded'</c>).</summary>
    Degraded,

    /// <summary>One or more checks failed (web <c>'down'</c>, plus the unknown-token fallthrough).</summary>
    Down,
}

/// <summary>
/// One probed dependency in a diagnostic report — the native mirror of the web <c>DiagnosticCheck</c>. Field names
/// mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial object never throws. Pure data
/// (no WinUI types) so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">Stable check identifier (web <c>id</c>, e.g. <c>db.connectivity</c>).</param>
/// <param name="Name">Human-readable check name (web <c>name</c>).</param>
/// <param name="Status">The check verdict (web <c>status</c>).</param>
/// <param name="Detail">The one-line result detail (web <c>detail</c>).</param>
/// <param name="Remediation">Optional remediation hint shown for non-ok checks (web <c>remediation</c>).</param>
/// <param name="DurationMs">How long the probe took, in milliseconds (web <c>duration_ms</c>).</param>
public sealed record DiagnosticCheck(
    string Id,
    string Name,
    DiagnosticCheckStatus Status,
    string Detail,
    string? Remediation,
    long DurationMs)
{
    /// <summary>Read one check from a JSON object, tolerating missing / null fields.</summary>
    public static DiagnosticCheck FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return new DiagnosticCheck(string.Empty, string.Empty, DiagnosticCheckStatus.Fail, string.Empty, null, 0);
        }

        string? remediation = DiagnosticJson.Str(o, "remediation");
        return new DiagnosticCheck(
            Id: DiagnosticJson.Str(o, "id") ?? string.Empty,
            Name: DiagnosticJson.Str(o, "name") ?? string.Empty,
            Status: ParseStatus(DiagnosticJson.Str(o, "status")),
            Detail: DiagnosticJson.Str(o, "detail") ?? string.Empty,
            Remediation: string.IsNullOrEmpty(remediation) ? null : remediation,
            DurationMs: DiagnosticJson.Long(o, "duration_ms") ?? 0);
    }

    /// <summary>Map a wire status token to <see cref="DiagnosticCheckStatus"/> (unknown ⇒ <see cref="DiagnosticCheckStatus.Fail"/>).</summary>
    public static DiagnosticCheckStatus ParseStatus(string? token) => (token ?? string.Empty).ToLowerInvariant() switch
    {
        "ok" => DiagnosticCheckStatus.Ok,
        "warn" => DiagnosticCheckStatus.Warn,
        _ => DiagnosticCheckStatus.Fail,
    };

    /// <summary>The lower-case wire token for a status (web <c>check.status</c>).</summary>
    public static string Token(DiagnosticCheckStatus status) => status switch
    {
        DiagnosticCheckStatus.Ok => "ok",
        DiagnosticCheckStatus.Warn => "warn",
        _ => "fail",
    };
}

/// <summary>
/// A full diagnostic report — the native mirror of the web <c>DiagnosticReport</c>: when it was generated, the
/// aggregate <see cref="OverallStatus"/> and the per-dependency <see cref="Checks"/>. <see cref="Json"/> carries the
/// pretty-printed source JSON (the web <c>JSON.stringify(report, null, 2)</c> copied by the Copy action); it is empty
/// for reports constructed directly in tests. Pure data; parsing is null-tolerant.
/// </summary>
/// <param name="GeneratedAt">ISO-8601 generation timestamp (web <c>generated_at</c>).</param>
/// <param name="OverallStatus">The aggregate verdict (web <c>overall_status</c>).</param>
/// <param name="Checks">The probed dependencies (web <c>checks</c>).</param>
/// <param name="Json">The pretty-printed source JSON for the Copy action (empty when built directly).</param>
public sealed record DiagnosticReport(
    string GeneratedAt,
    DiagnosticOverallStatus OverallStatus,
    IReadOnlyList<DiagnosticCheck> Checks,
    string Json = "")
{
    private static readonly JsonSerializerOptions PrettyOptions = new() { WriteIndented = true };

    /// <summary>Read a report from a JSON object, tolerating missing / null fields. Non-object input yields a 0-check report.</summary>
    public static DiagnosticReport FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return new DiagnosticReport(string.Empty, DiagnosticOverallStatus.Down, Array.Empty<DiagnosticCheck>());
        }

        var checks = new List<DiagnosticCheck>();
        if (o.TryGetProperty("checks", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in arr.EnumerateArray())
            {
                checks.Add(DiagnosticCheck.FromJson(item));
            }
        }

        return new DiagnosticReport(
            GeneratedAt: DiagnosticJson.Str(o, "generated_at") ?? string.Empty,
            OverallStatus: ParseOverall(DiagnosticJson.Str(o, "overall_status")),
            Checks: checks,
            Json: Pretty(o));
    }

    /// <summary>Map a wire status token to <see cref="DiagnosticOverallStatus"/> (unknown ⇒ <see cref="DiagnosticOverallStatus.Down"/>).</summary>
    public static DiagnosticOverallStatus ParseOverall(string? token) => (token ?? string.Empty).ToLowerInvariant() switch
    {
        "ok" => DiagnosticOverallStatus.Ok,
        "degraded" => DiagnosticOverallStatus.Degraded,
        _ => DiagnosticOverallStatus.Down,
    };

    /// <summary>The lower-case wire token for the aggregate verdict (web <c>report.overall_status</c>).</summary>
    public static string Token(DiagnosticOverallStatus status) => status switch
    {
        DiagnosticOverallStatus.Ok => "ok",
        DiagnosticOverallStatus.Degraded => "degraded",
        _ => "down",
    };

    private static string Pretty(JsonElement element)
    {
        try
        {
            return JsonSerializer.Serialize(element, PrettyOptions);
        }
        catch (NotSupportedException)
        {
            return string.Empty;
        }
    }
}

/// <summary>
/// Serializes a <see cref="DiagnosticReport"/> to the plain-text support-ticket format — the native, 1:1 port of the
/// web <c>formatDiagnosticReportText</c> (one of this surface's two bound data sources). Kept pure / UI-free so it is
/// unit-tested and re-usable, exactly as the web keeps it outside the page component.
/// </summary>
public static class DiagnosticReportText
{
    /// <summary>The em-dash separator shared with the web report text.</summary>
    public const string EmDash = "\u2014";

    /// <summary>Render <paramref name="report"/> as the newline-joined plain-text report.</summary>
    public static string Format(DiagnosticReport report)
    {
        ArgumentNullException.ThrowIfNull(report);

        var lines = new List<string>
        {
            "TeslaSync diagnostic report",
            $"Generated: {report.GeneratedAt}",
            $"Overall:   {DiagnosticReport.Token(report.OverallStatus)}",
            string.Empty,
            "Checks:",
        };

        foreach (var c in report.Checks)
        {
            lines.Add($"  [{DiagnosticCheck.Token(c.Status).ToUpperInvariant()}] {c.Name} ({c.Id}) {EmDash} {c.DurationMs}ms");
            if (!string.IsNullOrEmpty(c.Detail))
            {
                lines.Add($"    detail:      {c.Detail}");
            }

            if (!string.IsNullOrEmpty(c.Remediation))
            {
                lines.Add($"    remediation: {c.Remediation}");
            }
        }

        lines.Add(string.Empty);
        return string.Join("\n", lines);
    }
}

/// <summary>
/// Builds the diagnostic download file name — the native port of the web <c>downloadFilename</c>. Replaces the
/// <c>{0}</c> slot in the localized <c>diagnostic.filename</c> template with a filesystem-safe ISO-8601 UTC slug
/// derived from the report's <c>generated_at</c> (colons ⇒ dashes, fractional seconds stripped), falling back to the
/// supplied <c>now</c> when the timestamp is unparseable so repeated saves never collide.
/// </summary>
public static class DiagnosticFilename
{
    /// <summary>Build the download file name from the report timestamp and the localized template.</summary>
    /// <param name="reportTimestamp">The report's <c>generated_at</c> value.</param>
    /// <param name="template">The localized <c>diagnostic.filename</c> template containing a single <c>{0}</c> slot.</param>
    /// <param name="now">Fallback instant used when <paramref name="reportTimestamp"/> cannot be parsed.</param>
    public static string Build(string? reportTimestamp, string template, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(template);

        DateTimeOffset stamp = DateTimeOffset.TryParse(
            reportTimestamp,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : now;

        string slug = stamp.ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ss", CultureInfo.InvariantCulture) + "Z";
        return string.Format(CultureInfo.InvariantCulture, template, slug);
    }
}

/// <summary>
/// The data port the <see cref="DiagnosticPageViewModel"/> runs the aggregated self-test through — the native parity of
/// the web <c>useRunDiagnostic</c> mutation (POST /system/diagnostic). The view never performs HTTP itself; the default
/// <see cref="EmptyDiagnosticRunner"/> surfaces "no runner configured", and the generated-client-backed
/// <see cref="DiagnosticClientRunner"/> binds to the generated OpenAPI contract client (ADR-004). A failing run throws
/// (carrying the HTTP status via <c>ApiException</c>) so the view-model surfaces the error panel exactly as the web
/// <c>onError</c> path does.
/// </summary>
public interface IDiagnosticRunner
{
    /// <summary>Run the aggregated diagnostic and resolve the report (web <c>useRunDiagnostic.mutate</c>).</summary>
    Task<DiagnosticReport> RunAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The default runner used by the parameterless page (the un-wired shell registration). The page never runs on mount,
/// so this is reached only if the operator presses Run with no contract client injected; it throws so the view-model
/// surfaces the diagnostic-failed panel rather than fabricating a report.
/// </summary>
public sealed class EmptyDiagnosticRunner : IDiagnosticRunner
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDiagnosticRunner Instance { get; } = new();

    private EmptyDiagnosticRunner()
    {
    }

    /// <inheritdoc />
    public Task<DiagnosticReport> RunAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        throw new InvalidOperationException("No diagnostic runner is configured for this surface.");
    }
}

/// <summary>
/// The port the view saves the downloaded report through — the native parity of the web blob-download flow
/// (<c>Blob</c> + <c>URL.createObjectURL</c> + anchor click). The default <see cref="DownloadsFolderReportDownloader"/>
/// writes the plain-text report to the user's Downloads folder; tests inject an in-memory recorder.
/// </summary>
public interface IDiagnosticReportDownloader
{
    /// <summary>Write <paramref name="content"/> under <paramref name="filename"/>, returning the user-facing saved name.</summary>
    Task<string> SaveAsync(string filename, string content, CancellationToken cancellationToken);
}

/// <summary>
/// The render-time data model the <c>DiagnosticPage</c> projects from — the native analogue of the web page's resolved
/// mutation state (web/src/features/system/pages/DiagnosticPage.tsx). Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="HasReport">Whether the latest run produced a report (web <c>report</c> truthiness).</param>
/// <param name="Report">The resolved report (web <c>runDiagnostic.data</c>), null until a successful run.</param>
/// <param name="IsRunning">Whether a run is in flight (web <c>runDiagnostic.isPending</c>).</param>
/// <param name="HasError">Whether the latest run failed (web <c>latestError</c> present).</param>
/// <param name="ErrorDetail">Optional failure message (web <c>latestError.message</c>).</param>
public sealed record DiagnosticModel(
    bool HasReport,
    DiagnosticReport? Report,
    bool IsRunning,
    bool HasError,
    string? ErrorDetail)
{
    /// <summary>The initial model — nothing has been run yet (the empty surface).</summary>
    public static DiagnosticModel Initial { get; } = new(
        HasReport: false,
        Report: null,
        IsRunning: false,
        HasError: false,
        ErrorDetail: null);
}

/// <summary>
/// One projected, render-ready check card (web <c>CheckCard</c>): the status glyph + tone, the name / id / detail, the
/// optional remediation block, the status badge label + tone, and the formatted probe duration. Pure data.
/// </summary>
public sealed record DiagnosticCheckDisplay(
    string Id,
    string Name,
    string Detail,
    bool ShowRemediation,
    string RemediationLabel,
    string Remediation,
    string StatusGlyph,
    StatusKind Tone,
    string StatusBadgeLabel,
    string DurationText);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade. Holds the always-visible header (title + subtitle +
/// run affordance), the five web regions (error panel, overall hero, the copy/download actions, the per-check cards,
/// and the running / empty surfaces) and their visibility flags. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record DiagnosticDisplay(
    DiagnosticState State,
    string Title,
    string Subtitle,
    string RunLabel,
    string RunGlyph,
    bool RunBusy,
    bool ShowError,
    string ErrorTitle,
    string ErrorMessage,
    bool ShowOverall,
    string OverallGlyph,
    StatusKind OverallTone,
    string OverallTitle,
    string LastRunText,
    string CheckCountText,
    bool ShowActions,
    string CopyReportLabel,
    string CopiedLabel,
    string CopyReportSuccess,
    string DownloadReportLabel,
    string ReportJson,
    string ReportText,
    string DownloadFilename,
    bool ShowChecks,
    IReadOnlyList<DiagnosticCheckDisplay> Checks,
    bool ShowRunning,
    string RunningText,
    bool ShowEmpty,
    string EmptyTitle,
    string EmptyMessage,
    string EmptyActionLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="DiagnosticModel"/> to its <see cref="DiagnosticDisplay"/> — the native port of the
/// render logic in web/src/features/system/pages/DiagnosticPage.tsx. Every visible literal resolves through the i18n
/// facade using the exact web key names; the report timestamp formats through <see cref="DateTimeFormatting"/> (the web
/// <c>formatDateTime</c>). Every chrome string is resolved on every projection (visibility is gated by the returned
/// flags), so the i18n contract holds in every data state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class DiagnosticProjection
{
    private const string PlayGlyph = "\uE768";      // Play
    private const string RefreshGlyph = "\uE72C";   // Refresh
    private const string CheckGlyphOk = "\uE930";   // Completed
    private const string WarnGlyph = "\uE7BA";      // Warning
    private const string FailGlyph = "\uEA39";      // ErrorBadge
    private const string ShieldGlyph = "\uEA18";    // Shield

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web mutation state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for timestamp formatting.</param>
    public static DiagnosticDisplay Project(DiagnosticModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Page header (web PageContainer title + subtitle) ────────────────────────────────────────────────
        string title = localizer.GetString("diagnostic.title", "System diagnostic");
        string subtitle = localizer.GetString(
            "diagnostic.subtitle",
            "Run an aggregated self-test against the database, MQTT broker, Redis, Tesla API, and resilience monitors. Use this when telemetry is missing, charge sessions don't appear, or notifications stop firing.");

        // ── Run affordance label (web run / rerun / running) ────────────────────────────────────────────────
        string runIdle = localizer.GetString("diagnostic.run", "Run diagnostic");
        string runAgain = localizer.GetString("diagnostic.rerun", "Re-run diagnostic");
        string runningText = localizer.GetString("diagnostic.running", "Running diagnostic\u2026");
        string runLabel = model.IsRunning ? runningText : model.HasReport ? runAgain : runIdle;

        // ── Error panel (web latestError GlassPanel) ────────────────────────────────────────────────────────
        string errorTitle = localizer.GetString("diagnostic.errorTitle", "Diagnostic failed to run");
        string errorBody = localizer.GetString(
            "diagnostic.errorBody",
            "The diagnostic endpoint returned an error. Check API logs and try again.");
        string errorMessage = !string.IsNullOrEmpty(model.ErrorDetail) ? model.ErrorDetail! : errorBody;

        // ── Overall hero (web OverallHero) ──────────────────────────────────────────────────────────────────
        var report = model.Report;
        var overall = report?.OverallStatus ?? DiagnosticOverallStatus.Down;
        string overallTitle = localizer.GetString(OverallTitleKey(overall), OverallTitleFallback(overall));
        string lastRunTemplate = localizer.GetString("diagnostic.lastRun", "Generated {0}");
        string lastRunWhen = FormatTimestamp(report?.GeneratedAt, now);
        string lastRunText = string.Format(CultureInfo.CurrentCulture, lastRunTemplate, lastRunWhen);

        int checkCount = report?.Checks.Count ?? 0;
        string checkCountSingular = localizer.GetString("diagnostic.checkCount", "{0} check");
        string checkCountPlural = localizer.GetString("diagnostic.checkCountOther", "{0} checks");
        string checkCountTemplate = checkCount == 1 ? checkCountSingular : checkCountPlural;
        string checkCountText = string.Format(
            CultureInfo.InvariantCulture,
            checkCountTemplate,
            checkCount.ToString(CultureInfo.InvariantCulture));

        // ── Actions (web CopyButton + Download) ─────────────────────────────────────────────────────────────
        string copyReportLabel = localizer.GetString("diagnostic.copyReport", "Copy report");
        string copiedLabel = localizer.GetString("common.copied", "Copied");
        string copyReportSuccess = localizer.GetString("diagnostic.copyReportSuccess", "Diagnostic report copied to clipboard");
        string downloadReportLabel = localizer.GetString("diagnostic.downloadReport", "Download .txt");
        string filenameTemplate = localizer.GetString("diagnostic.filename", "teslasync-diagnostic-{0}.txt");
        string downloadFilename = DiagnosticFilename.Build(report?.GeneratedAt, filenameTemplate, now);
        string reportText = report is null ? string.Empty : DiagnosticReportText.Format(report);
        string reportJson = report?.Json ?? string.Empty;

        // ── Check cards (web CheckCard list) ────────────────────────────────────────────────────────────────
        string remediationLabel = localizer.GetString("diagnostic.remediationLabel", "Remediation");
        string durationTemplate = localizer.GetString("diagnostic.duration", "{0}ms");
        string statusOk = localizer.GetString("diagnostic.status.ok", "OK");
        string statusWarn = localizer.GetString("diagnostic.status.warn", "Warning");
        string statusFail = localizer.GetString("diagnostic.status.fail", "Fail");

        var cards = new List<DiagnosticCheckDisplay>();
        if (report is not null)
        {
            foreach (var c in report.Checks)
            {
                bool hasRemediation = !string.IsNullOrEmpty(c.Remediation);
                cards.Add(new DiagnosticCheckDisplay(
                    Id: c.Id,
                    Name: c.Name,
                    Detail: c.Detail,
                    ShowRemediation: hasRemediation,
                    RemediationLabel: remediationLabel,
                    Remediation: c.Remediation ?? string.Empty,
                    StatusGlyph: CheckGlyph(c.Status),
                    Tone: CheckTone(c.Status),
                    StatusBadgeLabel: c.Status switch
                    {
                        DiagnosticCheckStatus.Ok => statusOk,
                        DiagnosticCheckStatus.Warn => statusWarn,
                        _ => statusFail,
                    },
                    DurationText: string.Format(
                        CultureInfo.InvariantCulture,
                        durationTemplate,
                        c.DurationMs.ToString(CultureInfo.InvariantCulture))));
            }
        }

        // ── Empty surface (web EmptyState) ──────────────────────────────────────────────────────────────────
        string emptyMessage = localizer.GetString(
            "diagnostic.noReport",
            "No diagnostic has been run in this session yet. Click \"Run diagnostic\" to probe every dependency.");

        // ── State selection (web render precedence) ─────────────────────────────────────────────────────────
        bool showSuccess = model.HasReport && !model.IsRunning;
        bool showRunning = model.IsRunning;
        bool showEmpty = !showSuccess && !showRunning;
        DiagnosticState state = showSuccess
            ? DiagnosticState.Success
            : showRunning
                ? DiagnosticState.Loading
                : DiagnosticState.Empty;

        return new DiagnosticDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            RunLabel: runLabel,
            RunGlyph: model.HasReport ? RefreshGlyph : PlayGlyph,
            RunBusy: model.IsRunning,
            ShowError: model.HasError,
            ErrorTitle: errorTitle,
            ErrorMessage: errorMessage,
            ShowOverall: showSuccess,
            OverallGlyph: OverallGlyphFor(overall),
            OverallTone: OverallToneFor(overall),
            OverallTitle: overallTitle,
            LastRunText: lastRunText,
            CheckCountText: checkCountText,
            ShowActions: showSuccess,
            CopyReportLabel: copyReportLabel,
            CopiedLabel: copiedLabel,
            CopyReportSuccess: copyReportSuccess,
            DownloadReportLabel: downloadReportLabel,
            ReportJson: reportJson,
            ReportText: reportText,
            DownloadFilename: downloadFilename,
            ShowChecks: showSuccess,
            Checks: cards,
            ShowRunning: showRunning,
            RunningText: runningText,
            ShowEmpty: showEmpty,
            EmptyTitle: title,
            EmptyMessage: emptyMessage,
            EmptyActionLabel: runIdle,
            AutomationName: title);
    }

    private static string CheckGlyph(DiagnosticCheckStatus status) => status switch
    {
        DiagnosticCheckStatus.Ok => CheckGlyphOk,
        DiagnosticCheckStatus.Warn => WarnGlyph,
        _ => FailGlyph,
    };

    private static StatusKind CheckTone(DiagnosticCheckStatus status) => status switch
    {
        DiagnosticCheckStatus.Ok => StatusKind.Success,
        DiagnosticCheckStatus.Warn => StatusKind.Warning,
        _ => StatusKind.Danger,
    };

    private static string OverallGlyphFor(DiagnosticOverallStatus status) => status switch
    {
        DiagnosticOverallStatus.Ok => CheckGlyphOk,
        DiagnosticOverallStatus.Degraded => WarnGlyph,
        _ => ShieldGlyph,
    };

    private static StatusKind OverallToneFor(DiagnosticOverallStatus status) => status switch
    {
        DiagnosticOverallStatus.Ok => StatusKind.Success,
        DiagnosticOverallStatus.Degraded => StatusKind.Warning,
        _ => StatusKind.Danger,
    };

    private static string OverallTitleKey(DiagnosticOverallStatus status) => status switch
    {
        DiagnosticOverallStatus.Ok => "diagnostic.overall.ok",
        DiagnosticOverallStatus.Degraded => "diagnostic.overall.degraded",
        _ => "diagnostic.overall.down",
    };

    private static string OverallTitleFallback(DiagnosticOverallStatus status) => status switch
    {
        DiagnosticOverallStatus.Ok => "All systems healthy",
        DiagnosticOverallStatus.Degraded => "Degraded \u2014 some checks need attention",
        _ => "One or more checks failed",
    };

    // web formatDateTime(generated_at): absolute date-time, or the em-dash fallback for unparseable input.
    private static string FormatTimestamp(string? raw, DateTimeOffset now)
    {
        if (!string.IsNullOrWhiteSpace(raw) && DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var value))
        {
            return DateTimeFormatting.Format(value, DateTimeVariant.Full, now);
        }

        return DateTimeFormatting.DefaultEmptyDisplay;
    }
}

/// <summary>
/// Canonical metadata for the <c>DiagnosticPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/system/pages/DiagnosticPage.tsx</c> (the web page is unrouted; the Windows shell registers it
/// under the <see cref="RouteName"/> deep-link seam).
/// </summary>
public static class DiagnosticRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DiagnosticPage";

    /// <summary>The page-factory route name this surface registers under (deep-link seam; web is unrouted).</summary>
    public const string RouteName = "Diagnostic";

    /// <summary>The generated OpenAPI operation id for the diagnostic run (web <c>useRunDiagnostic</c>).</summary>
    public const string Operation = "post_api_v1_system_diagnostic";

    /// <summary>The localized page title (web <c>diagnostic.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("diagnostic.title", "System diagnostic");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>DiagnosticPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never report content or a check detail — so a
/// diagnostics line can never leak a probe result. Thread-safe.
/// </summary>
public sealed class DiagnosticDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DiagnosticDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DiagnosticPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DiagnosticRegistration.Slug}");
    }
}

/// <summary>Small null-tolerant JSON readers shared by this surface's parsers (snake_case wire shape, never throwing).</summary>
internal static class DiagnosticJson
{
    /// <summary>Read a string property, or <see langword="null"/> when absent / null / non-string.</summary>
    public static string? Str(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    /// <summary>Read an integer property (number or numeric string), or <see langword="null"/>.</summary>
    public static long? Long(JsonElement o, string name)
    {
        if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.Number when v.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }
}
