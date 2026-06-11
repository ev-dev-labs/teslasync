using System.Globalization;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// Feedback category — the native mirror of the web <c>FeedbackCategory</c> union
/// (<c>'bug' | 'feature' | 'other'</c>, web/src/api/types.ts). The wire form is the lower-case token the Go
/// API validates (<c>bug|feature|other</c>).
/// </summary>
public enum FeedbackCategory
{
    /// <summary>A defect report (web <c>bug</c>) — the form default.</summary>
    Bug,

    /// <summary>A feature request (web <c>feature</c>).</summary>
    Feature,

    /// <summary>A general question / other (web <c>other</c>).</summary>
    Other,
}

/// <summary>Wire mapping for <see cref="FeedbackCategory"/> — UI-free so it is asserted headlessly.</summary>
public static class FeedbackCategories
{
    /// <summary>The lower-case API token for <paramref name="category"/>.</summary>
    public static string ToWire(FeedbackCategory category) => category switch
    {
        FeedbackCategory.Bug => "bug",
        FeedbackCategory.Feature => "feature",
        FeedbackCategory.Other => "other",
        _ => "bug",
    };

    /// <summary>Parse an API token back to a <see cref="FeedbackCategory"/>; false for an unknown token.</summary>
    public static bool TryFromWire(string? wire, out FeedbackCategory category)
    {
        switch (wire)
        {
            case "bug":
                category = FeedbackCategory.Bug;
                return true;
            case "feature":
                category = FeedbackCategory.Feature;
                return true;
            case "other":
                category = FeedbackCategory.Other;
                return true;
            default:
                category = FeedbackCategory.Bug;
                return false;
        }
    }
}

/// <summary>
/// One captured diagnostic error in the shape the feedback payload attaches — the native mirror of the web
/// <c>FeedbackErrorReport</c> (web/src/lib/errorReporter.ts). snake_case <see cref="JsonPropertyNameAttribute"/>s
/// match the JSONB <c>user_feedback.recent_errors</c> column the backend persists, so the wire shape is identical
/// to the browser ring buffer's. <see cref="Stack"/> is omitted on the wire when null (web <c>stack?</c>).
/// </summary>
public sealed record FeedbackErrorReport(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("route")] string Route,
    [property: JsonPropertyName("occurred_at")] string OccurredAt,
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("stack")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Stack = null);

/// <summary>
/// The auto-collected context the modal shows before submit (so nothing is shipped without consent) — the native
/// analogue of the web modal's <c>useLocation().pathname</c> (<see cref="PageRoute"/>),
/// <c>import.meta.env.VITE_APP_VERSION</c> (<see cref="AppVersion"/>), <c>navigator.userAgent</c>
/// (<see cref="Runtime"/> — the Windows OS / app / locale descriptor), the <c>errorReporter</c> feedback ring
/// (<see cref="RecentErrors"/>) and the in-memory console tail (<see cref="ConsoleTail"/>). Captured synchronously
/// when the modal opens; there is no network read.
/// </summary>
public sealed record FeedbackContext(
    string PageRoute,
    string AppVersion,
    string Runtime,
    IReadOnlyList<FeedbackErrorReport> RecentErrors,
    string ConsoleTail)
{
    /// <summary>An empty context (root route, no version / runtime, no captured errors, no console tail).</summary>
    public static FeedbackContext Empty { get; } =
        new("/", string.Empty, string.Empty, Array.Empty<FeedbackErrorReport>(), string.Empty);

    /// <summary>The number of captured recent errors (the toggle's <c>{{count}}</c>).</summary>
    public int RecentErrorCount => RecentErrors.Count;
}

/// <summary>
/// The <c>POST /api/v1/feedback</c> request body — the native mirror of the web <c>FeedbackSubmitInput</c>
/// (web/src/api/types.ts) the modal fills. Every property carries an explicit snake_case
/// <see cref="JsonPropertyNameAttribute"/> so the wire shape matches the Go <c>feedbackRequest</c> regardless of
/// the shared serializer's naming policy. <see cref="Category"/> / <see cref="Title"/> / <see cref="Body"/> /
/// <see cref="PageRoute"/> / <see cref="UserAgent"/> / <see cref="AppVersion"/> are always sent (the web modal
/// always assigns them); <see cref="RecentErrors"/> and <see cref="ConsoleTail"/> are omitted when null (the web
/// <c>if (…) payload.recent_errors = …</c> / <c>payload.console_tail = …</c> guards).
/// </summary>
public sealed record FeedbackSubmitRequest(
    [property: JsonPropertyName("category")] string Category,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("body")] string Body,
    [property: JsonPropertyName("page_route")] string PageRoute,
    [property: JsonPropertyName("user_agent")] string UserAgent,
    [property: JsonPropertyName("app_version")] string AppVersion,
    [property: JsonPropertyName("recent_errors")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<FeedbackErrorReport>? RecentErrors,
    [property: JsonPropertyName("console_tail")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? ConsoleTail);

/// <summary>One category choice for the category dropdown (value + localized label).</summary>
public sealed record FeedbackCategoryOption(FeedbackCategory Value, string Label);

/// <summary>
/// A localized transient message for the toast surface — the native analogue of the web <c>useSubmitFeedback</c>
/// success / error toasts. <see cref="IsError"/> selects the error vs. success presentation.
/// </summary>
public sealed record FeedbackModalToast(string Message, bool IsError);

/// <summary>
/// The outcome of a single feedback submit — the native analogue of the web <c>useSubmitFeedback</c> mutation
/// resolving. On success it carries no payload (the modal closes); on an HTTP fault it carries a classified
/// <see cref="Error"/> rather than throwing (web parity: the mutation resolves to a toast, never an unhandled
/// rejection).
/// </summary>
public sealed record FeedbackSubmitOutcome(bool Success, RepositoryError? Error)
{
    /// <summary>A successful submit.</summary>
    public static FeedbackSubmitOutcome Ok() => new(true, null);

    /// <summary>A classified failure.</summary>
    public static FeedbackSubmitOutcome Fail(RepositoryError error) => new(false, error);
}

/// <summary>
/// Canonical metadata, validation bounds, Segoe Fluent glyphs and i18n keys for the <c>FeedbackModal</c> surface —
/// the native mirror of <c>web/src/components/feedback/FeedbackModal.tsx</c>. The web component ships literal copy;
/// every literal is keyed here (with that literal as the English fallback) so the native view and view-model stay
/// free of inline strings and resolve through the i18n facade. Two browser-specific labels are adapted to the
/// Windows idiom while keeping the web i18n key: <c>feedback.context.userAgent</c> ("Browser" → "System", since the
/// captured value is the OS / app / locale runtime descriptor, not a browser UA) and <c>feedback.form.includeConsole*</c>
/// ("console" → "log", since the native diagnostics tail is an app log, not a browser console). UI-free so every key
/// + bound is asserted in tests.
/// </summary>
public static class FeedbackModalRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "FeedbackModal";

    /// <summary>Minimum trimmed title length (web zod <c>FEEDBACK_TITLE_MIN</c> and the Go 5-char floor).</summary>
    public const int TitleMinLength = 5;

    /// <summary>Maximum title length (web zod <c>FEEDBACK_TITLE_MAX</c> / <c>maxLength={120}</c>).</summary>
    public const int TitleMaxLength = 120;

    /// <summary>Minimum trimmed body length (web zod <c>FEEDBACK_BODY_MIN</c> and the Go 20-char floor).</summary>
    public const int BodyMinLength = 20;

    /// <summary>Maximum body length (web zod <c>FEEDBACK_BODY_MAX</c> / <c>maxLength={4000}</c>).</summary>
    public const int BodyMaxLength = 4000;

    /// <summary>Maximum attached console-tail length (web <c>CONSOLE_TAIL_MAX</c>): newest-last, sliced.</summary>
    public const int ConsoleTailMaxLength = 4000;

    /// <summary>Segoe Fluent "Feedback" glyph standing in for the web modal's report icon.</summary>
    public const string Glyph = "\uED15";

    /// <summary>The category values in web render order (bug, feature, other).</summary>
    public static IReadOnlyList<FeedbackCategory> CategoryOrder { get; } =
    [
        FeedbackCategory.Bug,
        FeedbackCategory.Feature,
        FeedbackCategory.Other,
    ];

    /// <summary>Modal title (web <c>title="Report a bug / Send feedback"</c>).</summary>
    public static string ModalTitle(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.title", "Report a bug / Send feedback");

    /// <summary>Category field label (web <c>What kind of feedback?</c>).</summary>
    public static string CategoryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.form.category.label", "What kind of feedback?");

    /// <summary>Title field label (web <c>Title</c>).</summary>
    public static string TitleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.form.title.label", "Title");

    /// <summary>Title field prompt (the web input hint).</summary>
    public static string TitlePrompt(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.form.title.placeholder", "Short summary (e.g. \u201CBattery widget shows NaN\u201D)"); // parity:allow web i18n key kept verbatim for catalog parity

    /// <summary>Body field label (web <c>Details</c>).</summary>
    public static string BodyLabel(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.form.body.label", "Details");

    /// <summary>Body field prompt (the web input hint).</summary>
    public static string BodyPrompt(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.form.body.placeholder", "What happened? What did you expect to happen? Steps to reproduce help a lot."); // parity:allow web i18n key kept verbatim for catalog parity

    /// <summary>Auto-attached context panel title (web <c>Auto-attached context</c>).</summary>
    public static string ContextTitle(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.context.title", "Auto-attached context");

    /// <summary>Context page-route row label (web <c>Page</c>).</summary>
    public static string ContextPageLabel(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.context.page", "Page");

    /// <summary>Context app-version row label (web <c>App version</c>).</summary>
    public static string ContextAppVersionLabel(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.context.appVersion", "App version");

    /// <summary>
    /// Context runtime row label. Keeps the web <c>feedback.context.userAgent</c> key but adapts the "Browser"
    /// literal to the Windows idiom "System" — the captured value is the OS / app / locale descriptor.
    /// </summary>
    public static string ContextRuntimeLabel(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.context.userAgent", "System");

    /// <summary>Fallback shown for a missing context value (web <c>unknown</c>).</summary>
    public static string ContextUnknown(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.context.unknown", "unknown");

    /// <summary>Recent-errors toggle hint (web <c>feedback.form.includeErrorsHint</c>).</summary>
    public static string IncludeErrorsHint(ILocalizer localizer) =>
        Require(localizer).GetString(
            "feedback.form.includeErrorsHint",
            "Includes the most recent uncaught errors from this session. Helps reproduce the bug.");

    /// <summary>
    /// Console / log toggle label. Keeps the web <c>feedback.form.includeConsole</c> key but adapts "console" to
    /// the Windows idiom "log" — the native diagnostics tail is an app log, not a browser console.
    /// </summary>
    public static string IncludeConsoleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.form.includeConsole", "Attach recent log messages");

    /// <summary>Console / log toggle hint (web <c>feedback.form.includeConsoleHint</c>, "console" → "log").</summary>
    public static string IncludeConsoleHint(ILocalizer localizer) =>
        Require(localizer).GetString(
            "feedback.form.includeConsoleHint",
            "Privacy: log output may include URLs and data you saw. Off by default.");

    /// <summary>Title field validation message shown when the title is touched and out of bounds (web zod issue).</summary>
    public static string TitleErrorMessage(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.form.title.error", "Title must be 5\u2013120 characters.");

    /// <summary>Body field validation message shown when the body is touched and out of bounds (web zod issue).</summary>
    public static string BodyErrorMessage(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.form.body.error", "Details must be 20\u20134000 characters.");

    /// <summary>Inline submit-failure message (web <c>feedback.submitError</c>).</summary>
    public static string SubmitError(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.submitError", "Failed to submit feedback. Please try again.");

    /// <summary>Submit-failure toast (web <c>useSubmitFeedback</c> <c>onError</c> → <c>toast.feedback.submit.error</c>).</summary>
    public static string SubmitErrorToast(ILocalizer localizer) =>
        Require(localizer).GetString("toast.feedback.submit.error", "Failed to submit feedback");

    /// <summary>Cancel button label (web <c>common.cancel</c>).</summary>
    public static string CancelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.cancel", "Cancel");

    /// <summary>Submit button label, idle (web <c>Send feedback</c>).</summary>
    public static string SubmitLabel(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.form.submit", "Send feedback");

    /// <summary>Submit button label, busy (web <c>Submitting\u2026</c>).</summary>
    public static string SubmittingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("feedback.form.submitting", "Submitting\u2026");

    /// <summary>Success toast (web <c>toast.feedback.submit.success</c>).</summary>
    public static string SuccessMessage(ILocalizer localizer) =>
        Require(localizer).GetString("toast.feedback.submit.success", "Thanks \u2014 feedback submitted");

    /// <summary>The localized recent-errors toggle label with the captured <paramref name="count"/> interpolated.</summary>
    public static string IncludeErrorsLabel(ILocalizer localizer, int count)
    {
        // Mirrors the web t('feedback.form.includeErrors', 'Attach recent errors ({{count}})', { count }).
        string template = Require(localizer).GetString("feedback.form.includeErrors", "Attach recent errors ({{count}})");
        return template.Replace(
            "{{count}}", count.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal);
    }

    /// <summary>The localized label for a category value (web option labels).</summary>
    public static string CategoryLabelFor(FeedbackCategory category, ILocalizer localizer) => category switch
    {
        FeedbackCategory.Bug => Require(localizer).GetString("feedback.category.bug", "Bug report"),
        FeedbackCategory.Feature => Require(localizer).GetString("feedback.category.feature", "Feature request"),
        FeedbackCategory.Other => Require(localizer).GetString("feedback.category.other", "Other / question"),
        _ => Require(localizer).GetString("feedback.category.bug", "Bug report"),
    };

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>FeedbackModal</c> surface — the native analogue of the web component's category
/// option list, zod title / body validation, console-tail slicing and payload assembly. Every user-visible string
/// flows through the i18n facade so the projection is unit-tested headlessly and the view-model never resolves a
/// literal.
/// </summary>
public static class FeedbackModalProjection
{
    /// <summary>The category dropdown options in web render order with localized labels.</summary>
    public static IReadOnlyList<FeedbackCategoryOption> CategoryOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var options = new List<FeedbackCategoryOption>(FeedbackModalRegistration.CategoryOrder.Count);
        foreach (var value in FeedbackModalRegistration.CategoryOrder)
        {
            options.Add(new FeedbackCategoryOption(value, FeedbackModalRegistration.CategoryLabelFor(value, localizer)));
        }

        return options;
    }

    /// <summary>The trimmed title (web zod trims before length checks via the submit <c>.trim()</c>).</summary>
    public static string NormalizeTitle(string? title) => (title ?? string.Empty).Trim();

    /// <summary>The trimmed body (web submit <c>body.trim()</c>).</summary>
    public static string NormalizeBody(string? body) => (body ?? string.Empty).Trim();

    /// <summary>True once the trimmed title is within the web zod <c>[5, 120]</c> bound.</summary>
    public static bool IsTitleValid(string? title)
    {
        int length = NormalizeTitle(title).Length;
        return length >= FeedbackModalRegistration.TitleMinLength
            && length <= FeedbackModalRegistration.TitleMaxLength;
    }

    /// <summary>True once the trimmed body is within the web zod <c>[20, 4000]</c> bound.</summary>
    public static bool IsBodyValid(string? body)
    {
        int length = NormalizeBody(body).Length;
        return length >= FeedbackModalRegistration.BodyMinLength
            && length <= FeedbackModalRegistration.BodyMaxLength;
    }

    /// <summary>True once both the title and body satisfy the web zod schema (the submit gate).</summary>
    public static bool IsValid(string? title, string? body) => IsTitleValid(title) && IsBodyValid(body);

    /// <summary>
    /// Slice the console tail to the last <see cref="FeedbackModalRegistration.ConsoleTailMaxLength"/> characters,
    /// newest-last — the exact web <c>getConsoleTail()</c> transform.
    /// </summary>
    public static string TruncateConsoleTail(string? tail)
    {
        string value = tail ?? string.Empty;
        return value.Length <= FeedbackModalRegistration.ConsoleTailMaxLength
            ? value
            : value[^FeedbackModalRegistration.ConsoleTailMaxLength..];
    }

    /// <summary>
    /// Assemble the submit request from the current field values, the captured context and the two attach toggles —
    /// the native analogue of the object the web passes to <c>submit.mutateAsync</c>. The title / body are trimmed;
    /// page_route / user_agent (the runtime descriptor) / app_version always come from the context; recent_errors is
    /// included only when its toggle is on and the ring is non-empty (web <c>if (… &amp;&amp; recentErrors.length &gt; 0)</c>);
    /// console_tail is included only when its toggle is on and the sliced tail is non-empty (web
    /// <c>if (values.includeConsoleTail) { … if (tail.length &gt; 0) … }</c>).
    /// </summary>
    public static FeedbackSubmitRequest BuildRequest(
        FeedbackCategory category,
        string? title,
        string? body,
        FeedbackContext context,
        bool includeRecentErrors,
        bool includeConsoleTail)
    {
        ArgumentNullException.ThrowIfNull(context);

        IReadOnlyList<FeedbackErrorReport>? recentErrors =
            includeRecentErrors && context.RecentErrors.Count > 0 ? context.RecentErrors : null;

        string? consoleTail = null;
        if (includeConsoleTail)
        {
            string sliced = TruncateConsoleTail(context.ConsoleTail);
            if (sliced.Length > 0)
            {
                consoleTail = sliced;
            }
        }

        return new FeedbackSubmitRequest(
            FeedbackCategories.ToWire(category),
            NormalizeTitle(title),
            NormalizeBody(body),
            context.PageRoute,
            context.Runtime,
            context.AppVersion,
            recentErrors,
            consoleTail);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>FeedbackModal</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never the feedback title, body, route, runtime, attached errors or
/// console tail — so a diagnostics line can never leak feedback content. Thread-safe.
/// </summary>
public sealed class FeedbackModalDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _feedbackSubmitted;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FeedbackModalDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of feedback reports successfully submitted from this surface.</summary>
    public long FeedbackSubmitted => Interlocked.Read(ref _feedbackSubmitted);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FeedbackModal</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={FeedbackModalRegistration.Slug}"));
    }

    /// <summary>Record that feedback was submitted (the title / body / context are never logged).</summary>
    public void RecordFeedbackSubmitted()
    {
        Interlocked.Increment(ref _feedbackSubmitted);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"feedback.submitted slug={FeedbackModalRegistration.Slug}"));
    }
}
